/**
 * `airship doctor` — why it did not work.
 *
 * The CLI has never had an answer to that. Every failure mode it has (an agent
 * that is not signed in, a dev server that is not running, a project that is not
 * a git repo, an overlay bundle that was never built) previously surfaced either
 * as a warning buried in a launch it was too late to stop, or as nothing at all.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { type AgentKind, checkAuth, gitStatus } from "@airship/server";
import { defineCommand } from "citty";
import {
  AGENTS,
  argsFor,
  assertKnownFlags,
  GLOBAL_FLAGS,
  requirePort,
} from "../lib/args";
import { asBoolean, asString, CONFIG_FILENAME } from "../lib/config";
import { detectTarget, isListening } from "../lib/detect";
import { resolveSettings } from "../lib/settings";
import {
  note,
  out,
  setColorEnabled,
  shouldColor,
  style,
} from "../lib/terminal";
import { VERSION } from "../lib/version";

export const DOCTOR_FLAGS: readonly string[] = [
  "cwd",
  "target",
  "agent",
  ...GLOBAL_FLAGS,
];

type Level = "ok" | "warn" | "fail";

interface Check {
  /** What to do about it. Omitted when there is nothing to do. */
  hint?: string;
  label: string;
  level: Level;
  value: string;
}

const MARKS: Record<Level, (text: string) => string> = {
  fail: (text) => style.red(text),
  ok: (text) => style.green(text),
  warn: (text) => style.yellow(text),
};

const GLYPHS: Record<Level, string> = { fail: "✗", ok: "✓", warn: "⚠" };

/** Node's own floor, from the workspace `engines` field. */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

function checkNode(): Check {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  const ok =
    major > MIN_NODE_MAJOR ||
    (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  return {
    hint: ok
      ? undefined
      : `airship needs Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer.`,
    label: "node",
    level: ok ? "ok" : "fail",
    value: process.versions.node,
  };
}

async function checkAgents(preferred: AgentKind | undefined): Promise<Check[]> {
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      const auth = await checkAuth(agent as AgentKind);
      // Only the agent actually being used is a failure; the other two not
      // being installed is the normal state and must not read as broken.
      const isPreferred = agent === (preferred ?? "claude");
      let level: Level = "ok";
      if (!auth.ok) {
        level = isPreferred ? "fail" : "warn";
      }
      return {
        hint: auth.ok ? undefined : auth.reason,
        label: `agent ${agent}`,
        level,
        value: auth.ok ? "ready" : "not available",
      } satisfies Check;
    })
  );
  return results;
}

function checkOverlay(): Check {
  const require = createRequire(import.meta.url);
  try {
    require.resolve("@airship/overlay/bundle");
    return { label: "overlay bundle", level: "ok", value: "built" };
  } catch {
    // Same two-place lookup the proxy does, and for the same reason: in a
    // published install @airship/overlay is not on disk, and the bundle lives
    // in this CLI's own dist/vendor/. Checking only the workspace copy would
    // report "missing" on every working npm install.
    const vendored = fileURLToPath(
      new URL("./vendor/overlay.global.js", import.meta.url)
    );
    if (existsSync(vendored)) {
      return { label: "overlay bundle", level: "ok", value: "bundled" };
    }
    return {
      hint: "Run `pnpm build` — without it the editor cannot be injected.",
      label: "overlay bundle",
      level: "fail",
      value: "missing",
    };
  }
}

function render(checks: readonly Check[]): string {
  const width = Math.max(...checks.map((check) => check.label.length));
  const lines: string[] = [""];
  for (const check of checks) {
    const mark = MARKS[check.level](GLYPHS[check.level]);
    const label = check.label.padEnd(width);
    lines.push(`  ${mark} ${label}  ${check.value}`);
    if (check.hint) {
      lines.push(`    ${style.dim(`↳ ${check.hint}`)}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function checkConfig(configSource: string | undefined): Check {
  return {
    hint: configSource
      ? undefined
      : `No ${CONFIG_FILENAME} found — run \`airship init\` to create one.`,
    label: "config",
    level: configSource ? "ok" : "warn",
    value: configSource ?? "none (flags and env only)",
  };
}

/**
 * Two checks, because they fail for different reasons and have different fixes:
 * whether git can run at all, and whether this directory is somewhere it can
 * usefully run. They used to be one line that reported `isGitRepo` and nothing
 * else, so a machine with no git on PATH was told it was not in a repository.
 *
 * The level follows the same rule `checkAgents` uses: only the backend actually
 * being used can turn a missing dependency into a failure. Claude snapshots its
 * own before-state through a pre-tool hook, so it edits and undoes without git
 * at all; codex and opencode reconstruct their baseline from HEAD and cannot.
 * `doctor` exits non-zero on any `fail` and is documented as scriptable, so a
 * working Claude install must not be reported as broken.
 */
function checkGit(cwd: string, preferred: AgentKind | undefined): Check[] {
  const status = gitStatus(cwd);
  const needsGit = (preferred ?? "claude") !== "claude";
  const blocked: Level = needsGit ? "fail" : "warn";

  if (!status.installed) {
    return [
      {
        hint: status.hint,
        label: "git",
        level: blocked,
        value: "not installed",
      },
    ];
  }
  const version: Check = {
    label: "git",
    level: "ok",
    value: status.version ?? "installed",
  };
  if (!status.workTree) {
    return [
      version,
      {
        hint: status.hint,
        label: "git repo",
        level: blocked,
        value: `${status.error ?? "unusable"} (${cwd})`,
      },
    ];
  }
  if (!status.hasCommits) {
    return [
      version,
      {
        hint: status.hint,
        label: "git repo",
        level: blocked,
        value: "no commits yet",
      },
    ];
  }
  if (!status.identity) {
    return [
      version,
      // Always a warning, whichever backend: it breaks committing, which is one
      // opt-in button, and nothing else.
      { hint: status.hint, label: "git repo", level: "warn", value: cwd },
    ];
  }
  return [version, { label: "git repo", level: "ok", value: cwd }];
}

/**
 * A named `--target` is a claim the user made, so a dead port there is a
 * failure. A detected one is only a guess, so the same dead port is a warning.
 */
async function checkDevServer(
  cwd: string,
  targetFlag: string | undefined
): Promise<Check> {
  if (targetFlag) {
    const port = requirePort(targetFlag, "target");
    const live = await isListening(port);
    return {
      hint: live ? undefined : "Start it, or pass a different --target.",
      label: "dev server",
      level: live ? "ok" : "fail",
      value: live ? `listening on ${port}` : `nothing on ${port}`,
    };
  }

  const detected = await detectTarget(cwd);
  if (!detected) {
    return {
      hint: "Pass --target <port>.",
      label: "dev server",
      level: "warn",
      value: "no candidate ports found",
    };
  }
  return {
    hint: detected.listening
      ? undefined
      : "Start your dev server, or pass --target <port>.",
    label: "dev server",
    level: detected.listening ? "ok" : "warn",
    value: `${detected.listening ? "listening on" : "nothing on"} ${detected.port} (${detected.reason})`,
  };
}

export const doctor = defineCommand({
  args: argsFor(DOCTOR_FLAGS),
  meta: {
    description: "Check your environment and report what is wrong.",
    name: "doctor",
  },
  run: async ({ args, rawArgs }) => {
    assertKnownFlags(rawArgs, DOCTOR_FLAGS);
    const { configSource, cwd, settings } = resolveSettings({
      args,
      names: DOCTOR_FLAGS,
      rawArgs,
    });
    const json = asBoolean(settings, "json");
    setColorEnabled(shouldColor({ json }));

    const agent = asString(settings, "agent") as AgentKind | undefined;

    const checks: Check[] = [
      checkNode(),
      { label: "airship", level: "ok", value: VERSION },
      checkConfig(configSource),
      ...checkGit(cwd, agent),
      checkOverlay(),
      ...(await checkAgents(agent)),
      // The dev server last: it is the check most likely to be a transient
      // "not started yet", and it reads better after the things that stay true.
      await checkDevServer(cwd, asString(settings, "target")),
    ];

    if (json) {
      out(`${JSON.stringify({ checks, cwd }, null, 2)}\n`);
    } else {
      note(render(checks));
    }

    // A failing check is a failing run, so `airship doctor && airship` is a
    // usable thing to write in a script.
    if (checks.some((check) => check.level === "fail")) {
      process.exitCode = 1;
    }
  },
});
