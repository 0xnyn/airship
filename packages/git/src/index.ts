/**
 * @airship/git — minimal git helpers for the daemon: optional auto-commit of an
 * accepted edit (with a Conventional-Commits message) and a content-restore
 * undo that rewrites files to their pre-edit state.
 */
import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileDiff } from "@airship/protocol";

const execFileAsync = promisify(execFile);

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/**
 * Untrimmed variant. File contents and NUL-delimited porcelain output both
 * carry significant leading/trailing bytes, so they cannot go through `git()`.
 */
function tryGitRaw(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      // A single blob can exceed Node's 1MB default and would otherwise throw.
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * The async counterpart, for the two operations that touch the network.
 *
 * The rest of this module is deliberately synchronous — `rev-parse` returns in
 * microseconds and the call sites read better for it. `push` does not: it can
 * block for seconds on a slow remote, and this process is also proxying the
 * user's dev server, so a synchronous push would freeze their app mid-edit.
 */
async function tryExec(
  bin: string,
  args: string[],
  cwd: string
): Promise<{ error?: string; ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(bin, args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      error: (e.stderr || e.message || "command failed").trim(),
      ok: false,
      stdout: "",
    };
  }
}

export function isGitRepo(cwd: string): boolean {
  return tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/** The checked-out branch, or null when detached / not a repo. */
export function currentBranch(cwd: string): string | null {
  const name = tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return name && name !== "HEAD" ? name : null;
}

/**
 * The remote's default branch, so "are we on main?" can be answered without
 * assuming what main is called. Falls back to whichever conventional name
 * actually exists.
 */
export function defaultBranch(cwd: string): string | null {
  const head = tryGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (head) {
    return head.replace("refs/remotes/origin/", "");
  }
  for (const name of ["main", "master"]) {
    if (tryGit(cwd, ["rev-parse", "--verify", name])) {
      return name;
    }
  }
  return null;
}

export function hasRemote(cwd: string, name = "origin"): boolean {
  return Boolean(tryGit(cwd, ["remote", "get-url", name]));
}

/**
 * Content of a file as of HEAD, or null when it does not exist there (untracked,
 * newly added, or outside the repo).
 *
 * This is how the Codex path reconstructs a diff's `before` side. That backend
 * has no pre-tool hook, so unlike the Claude path there is no opportunity to
 * snapshot a file *before* the agent writes it — by the time we learn a file
 * changed, the new content is already on disk. For a file that was clean when
 * the turn started, its HEAD blob is exactly the pre-turn content.
 *
 * `path` may be absolute or relative to `cwd`; `HEAD:./…` resolves against the
 * working directory rather than the repo root, so a project root that sits in a
 * subdirectory of the repo still works.
 */
export function fileAtHead(cwd: string, path: string): string | null {
  // Both sides are canonicalized before being compared. Callers hand us paths
  // from mixed sources — some resolved through git, some as the user typed
  // them — and on macOS `/tmp` and `/var` are symlinks, so an uncanonicalized
  // comparison reads a perfectly normal path as escaping the project.
  const root = realpathSafe(cwd);
  const rel = relative(root, realpathSafe(resolve(cwd, path)));
  // `..` means the path really does escape the working directory; `HEAD:./..`
  // is not valid git syntax and there is nothing sensible to return.
  if (!rel || rel.startsWith("..")) {
    return null;
  }
  return tryGitRaw(cwd, ["show", `HEAD:./${rel.split(sep).join("/")}`]);
}

/** Resolve symlinks where possible, falling back for paths that don't exist. */
function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    try {
      return resolve(realpathSync(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/**
 * Absolute paths of every file with uncommitted changes — staged, unstaged, or
 * untracked. Absolute rather than relative because `git status` reports against
 * the repo root while callers work in project-root terms, and resolving here
 * once removes an easy class of mismatch.
 */
export function dirtyFiles(cwd: string): Set<string> {
  const out = new Set<string>();
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  const raw = tryGitRaw(cwd, ["status", "--porcelain", "-z", "-uall"]);
  if (!(root && raw)) {
    return out;
  }
  // NUL-delimited records: `XY <path>`. A rename or copy spends a second field
  // on its origin path, which must be consumed as data rather than parsed as
  // the next status record — hence a cursor rather than a for-of.
  const fields = raw.split("\0");
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    i += 1;
    if (field.length < 4) {
      continue;
    }
    const status = field.slice(0, 2);
    out.add(resolve(root, field.slice(3)));
    if (status.includes("R") || status.includes("C")) {
      const origin = fields[i];
      i += 1;
      if (origin) {
        out.add(resolve(root, origin));
      }
    }
  }
  return out;
}

export function createBranch(cwd: string, name: string): boolean {
  return tryGit(cwd, ["checkout", "-b", name]) !== null;
}

export interface GhStatus {
  authed: boolean;
  error?: string;
  installed: boolean;
}

/** Whether `gh` is usable. Both halves matter — installed but unauthenticated
 * is the common case and fails much later with a confusing message. */
export function ghStatus(): GhStatus {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch {
    return { authed: false, error: "gh is not installed", installed: false };
  }
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return { authed: true, installed: true };
  } catch {
    return {
      authed: false,
      error: "gh is installed but not authenticated (`gh auth login`)",
      installed: true,
    };
  }
}

/** Push a branch and set upstream. Async — see `tryExec`. */
export async function pushBranch(
  cwd: string,
  branch: string
): Promise<{ error?: string; ok: boolean }> {
  const result = await tryExec(
    "git",
    ["push", "--set-upstream", "origin", branch],
    cwd
  );
  return { error: result.error, ok: result.ok };
}

export interface PrResult {
  error?: string;
  ok: boolean;
  url?: string;
}

/** Open a pull request via `gh`. Async — it is a network round trip. */
export async function createPr(
  cwd: string,
  opts: { base?: string; body: string; head: string; title: string }
): Promise<PrResult> {
  const args = [
    "pr",
    "create",
    "--head",
    opts.head,
    "--title",
    opts.title,
    "--body",
    opts.body,
  ];
  if (opts.base) {
    args.push("--base", opts.base);
  }
  const result = await tryExec("gh", args, cwd);
  if (!result.ok) {
    return { error: result.error, ok: false };
  }
  // `gh` prints the PR URL as its last line.
  const url = result.stdout.split("\n").filter(Boolean).pop();
  return { ok: true, url };
}

export function currentSha(cwd: string): string | null {
  return tryGit(cwd, ["rev-parse", "HEAD"]);
}

/**
 * Stage and commit exactly the given files with a Conventional-Commits message.
 * Returns the new commit sha, or null if nothing was committed.
 */
export function commitEdit(
  cwd: string,
  files: string[],
  summary: string
): string | null {
  if (files.length === 0 || !isGitRepo(cwd)) {
    return null;
  }
  const subject = `chore(airship): ${summary.trim() || "visual edit"}`.slice(
    0,
    100
  );
  try {
    git(cwd, ["add", "--", ...files]);
    git(cwd, ["commit", "--no-verify", "-m", subject, "--", ...files]);
    return currentSha(cwd);
  } catch {
    return null;
  }
}

/**
 * Content-restore undo: rewrite each touched file back to its pre-edit content
 * (deleting files the edit created). Pure filesystem — works whether or not the
 * project is a git repo. Returns the repo-relative paths that were restored.
 */
export function restoreFiles(cwd: string, diffs: FileDiff[]): string[] {
  const restored: string[] = [];
  for (const d of diffs) {
    const abs = resolve(cwd, d.file);
    if (d.isNew) {
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
      }
      restored.push(d.file);
      continue;
    }
    if (typeof d.before === "string") {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, d.before, "utf8");
      restored.push(d.file);
    }
  }
  return restored;
}
