/**
 * Runs the workspace's own build of the CLI, rebuilding it first if it is stale.
 *
 * This is what `./airship` and `airship.cmd` call. It is a PASSTHROUGH: every
 * argument goes to the CLI untouched, so `./airship <anything>` behaves exactly
 * like the published `airship` binary. `make run` and friends are presets on
 * top of it, not a different path.
 *
 *   ./airship --target 3000 --cwd ../my-app
 *   ./airship doctor
 *   ./airship                       # the real wizard, same as a user gets
 *
 * Why it exists at all: apps/cli/tsup.config.ts sets `noExternal: [/^@airship\//]`,
 * so every workspace package is INLINED into apps/cli/dist/index.js — that is why
 * they are all devDependencies, and why the published tarball declares no
 * @airship/* dependency. The consequence is easy to miss: a change anywhere in
 * packages/* does nothing until the CLI is rebuilt. The Makefile could not catch
 * that (`$(CLI):` was a file rule with no source prerequisites, so it only fired
 * when dist was missing), which meant editing the overlay and running `make run`
 * silently ran the old bundle.
 *
 * So: mtime-scan the sources, and shell out to turbo only when something moved.
 * The scan is NOT a reimplementation of turbo's cache — turbo remains the source
 * of truth for what actually needs rebuilding. The scan is a ~8ms doorman in
 * front of a ~150ms turbo run, which is worth having on a command you type all
 * day. It is deliberately coarse: a false positive costs one cached turbo run,
 * a false negative runs stale code.
 *
 * Wrapper-owned flags, consumed here and never forwarded:
 *
 *   --skip-build    skip the scan and the build       (AIRSHIP_SKIP_BUILD=1)
 *   --force-build   build regardless of the scan      (AIRSHIP_FORCE_BUILD=1)
 *
 * They are NOT airship flags and will not appear in `airship --help`.
 *
 * They are deliberately not called `--no-build`, which is the obvious name and
 * the wrong one: apps/cli/src/lib/args.ts generates `--no-<name>` for every
 * boolean flag, and the README documents that as user-facing syntax. `--no-build`
 * therefore reads as CLI syntax, and would become argv this script silently ate
 * the day anyone adds a boolean `build` flag. Anything before a `--` is fair game
 * for us; anything after it is the CLI's, matching `assertKnownFlags`.
 */

import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_PACKAGE = "@airshiplabs/cli";
const CLI_ENTRY = join(ROOT, "apps", "cli", "dist", "index.js");

// vendor-assets.mjs copies the overlay IIFEs and the editor fonts in here after
// tsup runs. `tsup --watch` (apps/cli's `dev` script) has `clean: true` and does
// NOT re-run that step, so a watch loop leaves this missing — which is a dist
// that no longer matches the published layout, and worth rebuilding for.
const VENDOR_PROBE = join(ROOT, "apps", "cli", "dist", "vendor");

// Directories that are build output or machinery, never input. Skipping `dist`
// is not an optimisation but a correctness requirement: the scan compares
// against dist/index.js, so walking dist/ would always find something at least
// as new and rebuild forever. Skipping node_modules likewise — pnpm symlinks
// every workspace package into apps/cli/node_modules/@airship/*, so the walk
// would otherwise wander into the store. Dotted names are skipped separately.
const SKIP = new Set(["dist", "node_modules", "storybook-static"]);

// Same spelling convention as the CLI's own AIRSHIP_* booleans, so there is one
// rule to learn. See apps/cli/src/lib/config.ts.
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

const COLOR = Boolean(
  process.env.FORCE_COLOR || (process.stderr.isTTY && !process.env.NO_COLOR)
);
const CYAN = COLOR ? "\u001b[0;36m" : "";
const RED = COLOR ? "\u001b[0;31m" : "";
const RESET = COLOR ? "\u001b[0m" : "";

/**
 * Progress goes to stderr, never stdout: `airship --json` writes machine-readable
 * output on stdout and a rebuild notice in the middle of it would corrupt the
 * parse. Same reason turbo's own output is redirected in runBuild().
 */
function note(message) {
  process.stderr.write(`${CYAN}»${RESET} ${message}\n`);
}

function fail(message, hint, code = 1) {
  process.stderr.write(`${RED}✖${RESET} ${message}\n`);
  if (hint) {
    process.stderr.write(`  ${hint}\n`);
  }
  process.exit(code);
}

function envBoolean(name) {
  const raw = process.env[name];
  if (raw === undefined) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  if (TRUTHY.has(value)) {
    return true;
  }
  if (FALSY.has(value)) {
    return false;
  }
  return fail(
    `${name} is not a boolean: '${raw}'`,
    "Use 1/true/yes/on or 0/false/no/off."
  );
}

/** 0 for anything unreadable, which callers read as "older than everything". */
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function splitArgs(argv) {
  const passthrough = [];
  let skip = envBoolean("AIRSHIP_SKIP_BUILD");
  let force = envBoolean("AIRSHIP_FORCE_BUILD");
  let ours = true;

  for (const arg of argv) {
    if (ours && arg === "--") {
      // Everything past here belongs to the CLI, including tokens that look
      // like ours. Mirrors assertKnownFlags in apps/cli/src/lib/args.ts.
      ours = false;
      passthrough.push(arg);
      continue;
    }
    if (ours && arg === "--skip-build") {
      skip = true;
      continue;
    }
    if (ours && arg === "--force-build") {
      force = true;
      continue;
    }
    passthrough.push(arg);
  }

  return { force, passthrough, skip };
}

/**
 * apps/cli plus every packages/* — the package ROOTS, not their src/.
 *
 * Scanning src/ alone would be wrong, and quietly so. `turbo run build
 * --filter=@airshiplabs/cli --dry=json` reports the real input set, and it
 * reaches well outside src/: the CLI hashes README.md, package.json,
 * tsconfig.json, tsup.config.ts, vitest.config.ts and scripts/vendor-assets.mjs,
 * while @airship/editor-icons is generated from 507 SVGs under assets/ plus
 * ICONS.md — edit an icon and a src/-only scan would see nothing at all.
 *
 * Globbing packages/* rather than walking the CLI's real dependency graph
 * over-scans by exactly one package (site-tokens, which only apps/web uses).
 * That never drifts as the graph changes, and the cost of the false positive is
 * one cached turbo run. apps/web is not scanned: it cannot affect the bundle.
 */
function scanRoots() {
  const roots = [join(ROOT, "apps", "cli")];
  const packages = join(ROOT, "packages");
  let entries;
  try {
    entries = readdirSync(packages, { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      roots.push(join(packages, entry.name));
    }
  }
  return roots;
}

/** First path under `dir` newer than `since`, or null. Stops at the first hit. */
function findNewer(dir, since) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that is not there — a package removed, a partial checkout — is not
    // this script's problem to report. turbo is the authority on what builds.
    return null;
  }

  // The directory's own mtime counts. Deleting a source file moves no surviving
  // file's timestamp, only its parent's, and a deletion changes the bundle.
  if (mtimeOf(dir) > since) {
    return dir;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findNewer(path, since);
      if (found) {
        return found;
      }
      continue;
    }
    if (mtimeOf(path) > since) {
      return path;
    }
  }
  return null;
}

function findStaleInput(builtAt) {
  for (const root of scanRoots()) {
    const found = findNewer(root, builtAt);
    if (found) {
      return found;
    }
  }
  return null;
}

function runBuild() {
  // Captured BEFORE the build, and used as the stamp afterwards. Stamping with
  // the finish time instead would mask a file saved while a slow build was
  // running: it would land between start and finish, be missed by the build,
  // and then look older than the bundle forever after.
  const startedAt = new Date();
  const require = createRequire(import.meta.url);
  let turbo;
  try {
    // turbo/bin/turbo is a Node script that dispatches to the platform binary,
    // so running it under process.execPath works identically on Windows without
    // a node_modules/.bin/*.cmd shim or `shell: true` (which Node 22 would
    // demand for a .cmd, and which reintroduces quoting bugs).
    turbo = require.resolve("turbo/bin/turbo");
  } catch {
    return fail(
      "turbo is not installed.",
      "Run `pnpm install` at the repo root first."
    );
  }

  const result = spawnSync(
    process.execPath,
    [
      turbo,
      "run",
      "build",
      `--filter=${CLI_PACKAGE}`,
      // Show only the tasks that actually ran. Without this, turbo replays the
      // full cached log of all nine packages — hundreds of lines — every time
      // one source file moved, which buries the one task that did work.
      "--output-logs=new-only",
    ],
    {
      cwd: ROOT,
      // Both streams to fd 2: turbo's progress is diagnostic, and letting it
      // reach stdout would corrupt `airship --json`.
      stdio: ["ignore", 2, 2],
    }
  );

  if (result.error) {
    return fail(`could not run turbo: ${result.error.message}`);
  }
  if (result.status !== 0) {
    // Deliberately does not fall through to the bundle already on disk.
    // Launching yesterday's binary after a failed build is the exact confusion
    // this wrapper exists to end.
    return fail(
      "the build failed — not launching the stale bundle.",
      "To run the existing bundle anyway: ./airship --skip-build …",
      result.status ?? 1
    );
  }

  // Stamp the entry, or the gate never closes. On a cache hit turbo replays the
  // logs and leaves the existing dist/ untouched — the bundle is correct, but
  // its mtime is still older than the source you just edited, so the next run
  // would find it stale and rebuild again, and again, forever. Stamping makes
  // the mtime mean "when the wrapper last confirmed this bundle matches the
  // sources", which is the question actually being asked. Turbo hashes inputs,
  // not output timestamps, so this cannot affect its caching.
  //
  // Only when turbo did NOT rewrite the entry, though. A real build already
  // wrote it, later than everything it consumed, and stamping backwards to
  // startedAt would reopen a window: tsup has `clean: true`, so it recreates
  // apps/cli/dist and thereby bumps apps/cli's own directory mtime past
  // startedAt, costing one redundant rebuild on the next run. A missing entry
  // is left for the check below to report.
  if (mtimeOf(CLI_ENTRY) < startedAt.getTime()) {
    try {
      utimesSync(CLI_ENTRY, startedAt, startedAt);
    } catch {
      // A stamp we cannot write costs one redundant cached build next run.
      // Never worth failing a launch over.
    }
  }
}

// apps/cli builds for node22 and its engines field says >=22.13.0. Catch that
// here rather than letting it surface as a syntax error from inside the bundle.
const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split(".")[0]) < MIN_NODE_MAJOR) {
  fail(
    `airship needs Node ${MIN_NODE_MAJOR}.13 or later — this is ${process.versions.node}.`,
    "The version this repo expects is in .nvmrc."
  );
}

const { force, passthrough, skip } = splitArgs(process.argv.slice(2));

if (!skip) {
  // Ordered, and the dist checks come first unconditionally: `pnpm clean`
  // removes apps/cli/dist, so anything that trusted a timestamp alone would
  // happily call a deleted bundle fresh.
  const builtAt = mtimeOf(CLI_ENTRY);
  if (builtAt === 0) {
    note(`${relative(ROOT, CLI_ENTRY)} is missing — building ${CLI_PACKAGE}`);
    runBuild();
  } else if (mtimeOf(VENDOR_PROBE) === 0) {
    note(
      `${relative(ROOT, VENDOR_PROBE)} is missing — building ${CLI_PACKAGE}`
    );
    runBuild();
  } else if (force) {
    note(`--force-build — rebuilding ${CLI_PACKAGE}`);
    runBuild();
  } else {
    const stale = findStaleInput(builtAt);
    if (stale) {
      note(
        `${relative(ROOT, stale)} is newer than the CLI bundle — rebuilding ${CLI_PACKAGE}`
      );
      runBuild();
    }
  }
}

if (mtimeOf(CLI_ENTRY) === 0) {
  // Two ways to land here, and they want opposite advice: --skip-build over a
  // tree that was never built, or a "successful" build that emitted no entry.
  fail(
    `${relative(ROOT, CLI_ENTRY)} does not exist.`,
    skip
      ? "Drop --skip-build so the wrapper can build it, or run `make build`."
      : "The build reported success but produced no entry — try `make build`."
  );
}

// No `cwd` here, on purpose. `--cwd` is resolved against process.cwd()
// (apps/cli/src/lib/settings.ts), loadConfig walks upward from it, and a bare
// run passes it to the wizard — so moving the cwd would silently change what
// `./airship --cwd ../my-app` means.
const child = spawn(process.execPath, [CLI_ENTRY, ...passthrough], {
  stdio: "inherit",
});

// Signals are split by where they come from, and the difference matters.
//
// SIGINT (and SIGBREAK) originate at the terminal, which delivers them to the
// whole foreground process group — the child has already got its own copy. All
// we must do is not die: serve.ts drains the proxy, stops any --exec dev server
// and exits 0, and if we took the default action we would hand the shell back a
// prompt while that was still running, orphaning a process on the port.
// Forwarding here would be actively harmful, because a second SIGINT is the
// CLI's own "stop waiting, exit now" escape hatch (serve.ts:398).
//
// SIGTERM has no terminal behind it — it arrives from `kill`, a supervisor or a
// CI runner, addressed to this pid alone. Swallowing it would hang, so it is the
// one we pass on, and let the CLI shut down the same way.
const swallow = () => undefined;
process.on("SIGINT", swallow);
if (process.platform === "win32") {
  process.on("SIGBREAK", swallow);
}
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});

child.on("error", (error) => {
  fail(`could not start the CLI: ${error.message}`);
});

child.on("close", (code, signal) => {
  if (signal) {
    // Drop our handler first or the re-raise hits the no-op above and hangs.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
