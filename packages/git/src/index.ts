/**
 * @airship/git — minimal git helpers for the daemon: optional auto-commit of an
 * accepted edit (with a Conventional-Commits message) and a content-restore
 * undo that rewrites files to their pre-edit state.
 *
 * Every invocation goes through `run`, which never throws and never discards
 * what went wrong. That is not incidental: this module used to be a wall of
 * `catch { return null }`, so a missing git, a missing commit identity, a stale
 * index.lock and a pathspec that matched nothing all reached the user as the
 * same three words — "commit failed" — and a git that could not run at all was
 * reported as "not a git repository".
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

/**
 * A single blob can exceed Node's 1MB default and would otherwise throw — and
 * the throw would be indistinguishable from every other failure. Applied to
 * every invocation rather than only the blob read, because `git push` against a
 * chatty remote can outrun 1MB of progress output just as easily.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/** How long a network call may block before it is killed. See `tryExec`. */
const NETWORK_TIMEOUT_MS = 120_000;

/**
 * The environment every child gets.
 *
 * `LC_ALL`/`LANG` because git's messages are translated when locales are
 * installed, and `fileAtHead` classifies "absent from HEAD" by matching git's
 * own wording — a French checkout would otherwise be read as an unavailable
 * baseline. It also keeps what the user is shown stable and searchable.
 *
 * The prompt-suppressing half matters most on Windows, where Git Credential
 * Manager opens a *GUI* behind the browser: the daemon is also proxying the
 * user's dev server, so a push that sits waiting on an invisible dialog hangs
 * the WebSocket handler with nothing to cancel it.
 */
const GIT_ENV = {
  GCM_INTERACTIVE: "never",
  GH_PROMPT_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  SSH_ASKPASS_REQUIRE: "never",
} as const;

/** Everything a failed invocation knows about itself. */
export interface GitFailure {
  /** The argv after `bin`, so a message can say which command failed. */
  args: string[];
  /** The executable — "git", or "gh" on the pull-request path. */
  bin: string;
  /** Exit status, or null when the process never started. */
  code: number | null;
  cwd?: string;
  /** `ENOENT` when the binary is not on PATH, `EACCES` when not executable. */
  errno?: string;
  stderr: string;
  /** Not a fallback for `stderr` — see `failureText`. */
  stdout: string;
}

type GitRun<T> = { ok: true; stdout: T } | { failure: GitFailure; ok: false };

/**
 * A diagnostic tap, for `--debug`. Deliberately *not* how error text reaches
 * the user: the daemon serves several sockets at once and a module-level sink
 * delivers a failure out of band from the call that produced it, so two clients
 * committing at the same time would cross wires and toast each other's error.
 * Text that must be correlated to a call travels on that call's return value.
 */
let sink: ((failure: GitFailure) => void) | undefined;

export function onGitFailure(
  fn: ((failure: GitFailure) => void) | undefined
): void {
  sink = fn;
}

function text(value: Buffer | string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

function toFailure(
  bin: string,
  args: string[],
  cwd: string | undefined,
  err: unknown
): GitFailure {
  // execFileSync throws an object whose `status` is the exit code, and whose
  // `code` is a spawn errno string only when the process never started.
  const e = err as {
    code?: number | string;
    status?: number | null;
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };
  return {
    args,
    bin,
    code: typeof e.status === "number" ? e.status : null,
    cwd,
    errno: typeof e.code === "string" ? e.code : undefined,
    stderr: text(e.stderr),
    stdout: text(e.stdout),
  };
}

function fail<T>(failure: GitFailure): GitRun<T> {
  sink?.(failure);
  return { failure, ok: false };
}

/**
 * `cwd` is checked before spawning because a directory that does not exist
 * makes spawn throw `ENOENT` — byte-identical to git not being installed. A
 * mistyped `--cwd` would otherwise be reported as a missing git, which is the
 * exact class of wrong answer this module exists to stop giving.
 */
function missingCwd(bin: string, args: string[], cwd: string): GitFailure {
  return {
    args,
    bin,
    code: null,
    cwd,
    errno: "ENOTDIR",
    stderr: `${cwd} does not exist`,
    stdout: "",
  };
}

function runBin(
  bin: string,
  cwd: string | undefined,
  args: string[]
): GitRun<string> {
  if (cwd !== undefined && !existsSync(cwd)) {
    return fail(missingCwd(bin, args, cwd));
  }
  try {
    return {
      ok: true,
      stdout: execFileSync(bin, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...GIT_ENV },
        maxBuffer: MAX_BUFFER,
        // stdin closed: a synchronous git must never be able to block on a
        // prompt. stdout/stderr piped so a failure carries git's own words.
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    };
  } catch (err) {
    return fail(toFailure(bin, args, cwd, err));
  }
}

function run(cwd: string | undefined, args: string[]): GitRun<string> {
  return runBin("git", cwd, args);
}

/**
 * The byte-exact variant, for content that must not be decoded on trust.
 * `fileAtHead` needs it: a blob that is not valid UTF-8 comes back through
 * `encoding: "utf8"` full of U+FFFD, and `restoreFiles` would then write that
 * corruption over the user's file.
 */
function runBytes(cwd: string, args: string[]): GitRun<Buffer> {
  if (!existsSync(cwd)) {
    return fail(missingCwd("git", args, cwd));
  }
  try {
    return {
      ok: true,
      stdout: execFileSync("git", args, {
        cwd,
        env: { ...process.env, ...GIT_ENV },
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    };
  } catch (err) {
    return fail(toFailure("git", args, cwd, err));
  }
}

/** git's own markers for the line that actually explains a failure. */
const GIT_MARKER = /^(?:fatal|error|remote|!)\b/;
/**
 * Status preamble that rides along on stdout and never explains anything. `git
 * commit` with nothing staged prints "On branch main" before the line that
 * matters, and leading with it buries the answer.
 */
const GIT_PREAMBLE = /^(?:On branch |Your branch |HEAD detached)/;
/** Both terminators: git output reaching us on Windows carries CRLF. */
const NEWLINE = /\r?\n/;
/**
 * Our own pathspec magic, stripped back out of anything a user reads.
 *
 * `commitEdit` wraps every path in `:(literal)` so a filename holding a glob
 * character is matched literally. That is an implementation detail, and leaving
 * it in `pathspec ':(literal)src/app.ts' did not match` reads as a bug in
 * airship rather than as a missing file.
 */
const LITERAL_MAGIC = /:\(literal\)/g;
const MAX_FAILURE_LINES = 3;
const MAX_FAILURE_CHARS = 300;

/**
 * The lines most likely to explain the failure.
 *
 * Marked lines first, then anything that is not status preamble, then whatever
 * there is. Each step only applies when it leaves something to say, so a
 * failure whose entire output is one unmarked preamble line still reports it
 * rather than reporting nothing.
 */
function explanatory(lines: string[]): string[] {
  const marked = lines.filter((line) => GIT_MARKER.test(line));
  if (marked.length > 0) {
    return marked;
  }
  const plain = lines.filter((line) => !GIT_PREAMBLE.test(line));
  return plain.length > 0 ? plain : lines;
}

/**
 * The one line worth showing a user: git's own words, or ours when it has none.
 *
 * `stdout` is not a fallback for `stderr`, it is half the input. `git commit`
 * with nothing staged exits 1 and prints "nothing to commit, working tree
 * clean" on *stdout* — the single commonest commit failure, which a
 * stderr-only formatter renders as the useless "git commit exited 1".
 *
 * Capped and joined onto one line because `toast()` in the overlay takes a
 * plain string and renders a single message. The full text is what `--debug`
 * is for.
 */
export function failureText(failure: GitFailure): string {
  if (failure.errno === "ENOTDIR") {
    return failure.stderr;
  }
  if (failure.errno === "ENOENT") {
    return `${failure.bin} is not installed or not on PATH`;
  }
  if (failure.errno === "EACCES") {
    return `${failure.bin} is not executable`;
  }
  // Windows only. Node has refused to spawn a .bat/.cmd without a shell since
  // 18.20/20.12, and a bare EINVAL here reads as a bug in airship rather than
  // as the fixable packaging problem it is. `gh` installed through npm or a
  // scoop shim is the way to reach this; the official gh.exe is not.
  if (failure.errno === "EINVAL") {
    return `${failure.bin} resolves to a .cmd or .bat shim, which cannot be launched directly`;
  }
  const lines = `${failure.stderr}\n${failure.stdout}`
    .split(NEWLINE)
    .map((line) => line.trim().replace(LITERAL_MAGIC, ""))
    .filter(Boolean);
  const chosen = explanatory(lines).slice(0, MAX_FAILURE_LINES);
  if (chosen.length === 0) {
    return `${failure.bin} ${failure.args[0] ?? "command"} exited ${failure.code ?? "abnormally"}`;
  }
  const joined = chosen.join(" · ");
  return joined.length > MAX_FAILURE_CHARS
    ? `${joined.slice(0, MAX_FAILURE_CHARS - 1)}…`
    : joined;
}

/** Lossy by design: for probes whose only question is yes/no. */
function tryGit(cwd: string, args: string[]): string | null {
  const result = run(cwd, args);
  return result.ok ? result.stdout.trim() : null;
}

/**
 * Untrimmed variant. NUL-delimited porcelain output carries significant
 * trailing bytes, so it cannot go through `tryGit`.
 */
function tryGitRaw(cwd: string, args: string[]): string | null {
  const result = run(cwd, args);
  return result.ok ? result.stdout : null;
}

/**
 * The async counterpart, for the two operations that touch the network.
 *
 * The rest of this module is deliberately synchronous — `rev-parse` returns in
 * microseconds and the call sites read better for it. `push` does not: it can
 * block for seconds on a slow remote, and this process is also proxying the
 * user's dev server, so a synchronous push would freeze their app mid-edit.
 *
 * The timeout is the other half of that. Without it a push waiting on
 * credentials never returns, the awaiting socket handler never replies, and no
 * child handle is kept anywhere that could kill it.
 */
async function tryExec(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number = NETWORK_TIMEOUT_MS
): Promise<{ error?: string; ok: boolean; stdout: string }> {
  if (!existsSync(cwd)) {
    return {
      error: failureText(missingCwd(bin, args, cwd)),
      ok: false,
      stdout: "",
    };
  }
  const pending = execFileAsync(bin, args, {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
    windowsHide: true,
  });
  // Nobody is going to write to it, and git will happily sit reading a pipe.
  pending.child.stdin?.end();
  try {
    const { stdout } = await pending;
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    const e = err as { killed?: boolean };
    if (e.killed) {
      return {
        error: `${bin} timed out after ${Math.round(timeoutMs / 1000)}s, most likely waiting on credentials`,
        ok: false,
        stdout: "",
      };
    }
    const failure = toFailure(bin, args, cwd, err);
    // execFile reports the exit status on `code`, where execFileSync uses
    // `status`; a numeric `code` is therefore an exit, not a spawn errno.
    const exit = (err as { code?: number | string }).code;
    if (typeof exit === "number") {
      failure.code = exit;
      failure.errno = undefined;
    }
    sink?.(failure);
    return { error: failureText(failure), ok: false, stdout: "" };
  }
}

/**
 * Is `cwd` inside a work tree?
 *
 * The cheap yes/no, and deliberately nothing more: one `rev-parse`, no reason
 * attached. It answers `false` for a bare repository, a directory that is not a
 * repository, and a git that will not run, which is why it is no longer what
 * anything user-facing asks. `gitStatus` is the answer that can be shown to
 * someone; this is the guard `commitEdit` takes before paying for one.
 */
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

export interface GitStatus {
  /**
   * The first thing that is wrong, phrased for a user.
   *
   * Short, and carrying no path: it is rendered in the overlay's tooltip box,
   * where the house budget is one line of about 44 characters. Callers with
   * more room, like the launch banner, add the directory themselves.
   */
  error?: string;
  /** HEAD resolves. A fresh `git init` has no commits and so no baseline. */
  hasCommits: boolean;
  /** The command that fixes `error`. */
  hint?: string;
  /** Both halves of the commit identity are configured. */
  identity: boolean;
  installed: boolean;
  /** e.g. "2.43.0". Present whenever `installed`. */
  version?: string;
  /** `cwd` is inside a work tree — not bare, not outside a repo. */
  workTree: boolean;
}

const GIT_VERSION = /(\d+\.\d+\.\d+)/;

const NOT_INSTALLED: GitStatus = {
  hasCommits: false,
  identity: false,
  installed: false,
  workTree: false,
};

/**
 * Why git will not work here, in the order the answers depend on each other.
 *
 * The same shape as `ghStatus`, and for the same reason its comment gives:
 * "installed but unusable" is the common case and fails much later with a
 * confusing message. Up to five spawns, so this is a preflight — `doctor`, the
 * launch banner, the PR gate and once per turn. Never per edit.
 */
export function gitStatus(cwd: string): GitStatus {
  // No `cwd`: "is git installed" has to be answerable when cwd is garbage.
  const version = run(undefined, ["--version"]);
  if (!version.ok) {
    return {
      ...NOT_INSTALLED,
      error: failureText(version.failure),
      hint: 'Install Git and make sure `git` is on PATH. On Windows, re-run the installer and choose "Git from the command line".',
    };
  }
  const base = {
    installed: true,
    version: GIT_VERSION.exec(version.stdout)?.[1],
  };
  const inside = run(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    return {
      ...base,
      error: "not a git repository",
      hasCommits: false,
      hint: "Run `git init` there, or point --cwd at a repository.",
      identity: false,
      workTree: false,
    };
  }
  // "false" rather than a failure: a bare repo answers the question and is
  // still unusable here. These were the same answer until this function existed.
  if (inside.stdout.trim() !== "true") {
    return {
      ...base,
      error: "this is a bare git repository",
      hasCommits: false,
      hint: "Airship edits a working tree; open a normal clone instead.",
      identity: false,
      workTree: false,
    };
  }
  const hasCommits = run(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok;
  const identity =
    Boolean(tryGit(cwd, ["config", "--get", "user.email"])) &&
    Boolean(tryGit(cwd, ["config", "--get", "user.name"]));
  if (!hasCommits) {
    return {
      ...base,
      error: "this repository has no commits yet",
      hasCommits,
      hint: "Make one commit. Without HEAD there is no baseline to diff or undo against.",
      identity,
      workTree: true,
    };
  }
  if (!identity) {
    return {
      ...base,
      error: "git has no commit identity",
      hasCommits,
      hint: 'Run `git config --global user.email you@example.com` and `git config --global user.name "Your Name"`.',
      identity,
      workTree: true,
    };
  }
  return { ...base, hasCommits, identity, workTree: true };
}

/**
 * What a file looked like at HEAD.
 *
 * Three answers, not two. "absent" is a fact about HEAD; "unavailable" is a
 * fact about us — and collapsing them into one null is what let undo delete
 * tracked files on a machine with no git on PATH: every read failed, every file
 * was therefore recorded as newly created, and undo deletes what an edit
 * created. See `restoreFiles`.
 */
export type HeadRead =
  | { kind: "absent" }
  | { kind: "content"; text: string }
  | { kind: "unavailable" };

const ABSENT_FROM_HEAD = /does not exist in|exists on disk, but not in/;
const UNKNOWN_OPTION = /unknown option|error: unknown switch/;

/**
 * Whether this git understands `cat-file --filters`, memoized.
 *
 * Deliberately not a version probe: parsing `git --version` costs a spawn and
 * distro builds spell it in ways worth not depending on ("2.39.5 (Apple
 * Git-154)"). One wasted invocation on a pre-2.11 git, once per process.
 */
let filtersSupported: boolean | undefined;

/**
 * Content of a file as of HEAD.
 *
 * This is how the Codex path reconstructs a diff's `before` side. That backend
 * has no pre-tool hook, so unlike the Claude path there is no opportunity to
 * snapshot a file *before* the agent writes it — by the time we learn a file
 * changed, the new content is already on disk. For a file that was clean when
 * the turn started, its HEAD blob is exactly the pre-turn content.
 *
 * `cat-file --filters` rather than `show`, because `before` is written straight
 * back to disk by `restoreFiles` and therefore has to be the *working tree*
 * form, not the stored blob. `core.autocrlf=true` is the Git-for-Windows
 * default, so `show` returns LF for a file that is CRLF on disk and undo
 * silently rewrote every line ending in the file. `--filters` applies the same
 * conversion a checkout would, including `.gitattributes` and LFS smudge.
 *
 * `path` may be absolute or relative to `cwd`; `HEAD:./…` resolves against the
 * working directory rather than the repo root, so a project root that sits in a
 * subdirectory of the repo still works.
 */
export function fileAtHead(cwd: string, path: string): HeadRead {
  // Both sides are canonicalized before being compared. Callers hand us paths
  // from mixed sources — some resolved through git, some as the user typed
  // them — and on macOS `/tmp` and `/var` are symlinks, so an uncanonicalized
  // comparison reads a perfectly normal path as escaping the project.
  const root = canonicalPath(cwd);
  const rel = relative(root, canonicalPath(resolve(cwd, path)));
  // `..` means the path really does escape the working directory. Unavailable
  // rather than absent: a file outside the tree may or may not have existed,
  // and guessing "it did not" is a licence to delete it.
  if (!rel || rel.startsWith("..")) {
    return { kind: "unavailable" };
  }
  const spec = `HEAD:./${rel.split(sep).join("/")}`;
  const result = readBlob(cwd, spec);
  if (!result.ok) {
    return ABSENT_FROM_HEAD.test(result.failure.stderr)
      ? { kind: "absent" }
      : { kind: "unavailable" };
  }
  try {
    // `fatal` is the precise test for "is this losslessly text". A blob that is
    // not — a PNG, a latin-1 source file — must not be decoded on trust and
    // then written back over the original.
    return {
      kind: "content",
      text: new TextDecoder("utf8", { fatal: true }).decode(result.stdout),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

function readBlob(cwd: string, spec: string): GitRun<Buffer> {
  if (filtersSupported !== false) {
    const filtered = runBytes(cwd, ["cat-file", "--filters", spec]);
    if (filtered.ok) {
      filtersSupported = true;
      return filtered;
    }
    if (!UNKNOWN_OPTION.test(filtered.failure.stderr)) {
      return filtered;
    }
    filtersSupported = false;
  }
  return runBytes(cwd, ["show", spec]);
}

/**
 * Resolve symlinks — and, on Windows, case and 8.3 short names — where
 * possible, falling back for paths that don't exist.
 *
 * `.native` on Windows is not a detail. The JS implementation resolves links
 * while preserving whatever spelling the caller passed, so `C:\Users\RUNNER~1`
 * stays short while anything that went through `GetFinalPathNameByHandle`
 * reads `C:\Users\runneradmin`. Two spellings of one directory make `relative`
 * above return a `..` path, and `fileAtHead` then reports every file as absent
 * from HEAD — which on the Codex path silently turns each edit into a
 * whole-file diff with no baseline.
 *
 * Exported, and re-exported by @airship/core's ./paths rather than
 * reimplemented there: core canonicalizes DiffCapture's map keys and hands the
 * results straight to `fileAtHead`, so a second implementation is a second
 * chance for the two to disagree. This package is the lowest one that touches
 * the filesystem, which makes it the place that owns the rule.
 */
const realpath =
  process.platform === "win32" ? realpathSync.native : realpathSync;

export function canonicalPath(path: string): string {
  try {
    return realpath(path);
  } catch {
    try {
      return resolve(realpath(dirname(path)), basename(path));
    } catch {
      return resolve(path);
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
  //
  // `-z` is also what makes `core.quotepath` a non-issue: with it git emits raw
  // bytes and never applies C-style quoting.
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

export function createBranch(
  cwd: string,
  name: string
): { error?: string; ok: boolean } {
  const result = run(cwd, ["checkout", "-b", name]);
  return result.ok
    ? { ok: true }
    : { error: failureText(result.failure), ok: false };
}

export interface GhStatus {
  authed: boolean;
  error?: string;
  installed: boolean;
}

/**
 * Whether `gh` is usable. Both halves matter — installed but unauthenticated is
 * the common case and fails much later with a confusing message.
 *
 * `cwd` is passed to `auth status` and not to `--version`: the first resolves
 * which host to check from the repository's own remote, the second must be
 * answerable anywhere.
 */
export function ghStatus(cwd?: string): GhStatus {
  const version = runBin("gh", undefined, ["--version"]);
  if (!version.ok) {
    return {
      authed: false,
      error: failureText(version.failure),
      installed: false,
    };
  }
  const auth = runBin("gh", cwd, ["auth", "status"]);
  if (auth.ok) {
    return { authed: true, installed: true };
  }
  // gh's own text, rather than a guess: an expired token, an unconfigured host
  // and a network failure are three different problems with three fixes.
  return {
    authed: false,
    error: `gh is installed but not usable: ${failureText(auth.failure)}`,
    installed: true,
  };
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
  // `gh` prints the PR URL as its last line. Split on both terminators: the
  // trim above only reaches the last one.
  const url = result.stdout.split(NEWLINE).filter(Boolean).pop();
  return { ok: true, url };
}

export function currentSha(cwd: string): string | null {
  return tryGit(cwd, ["rev-parse", "HEAD"]);
}

export interface CommitResult {
  error?: string;
  ok: boolean;
  sha?: string;
}

/**
 * Stage and commit exactly the given files with a Conventional-Commits message.
 *
 * Every path is wrapped in `:(literal)` because the arguments after `--` are
 * pathspecs, not filenames: without it `git add -- 'a[1].ts'` stages both
 * `a[1].ts` and any file the glob happens to match, so a single edited file can
 * sweep unrelated work into airship's commit.
 */
export function commitEdit(
  cwd: string,
  files: string[],
  summary: string
): CommitResult {
  if (files.length === 0) {
    return { error: "nothing to commit", ok: false };
  }
  // The cheap predicate first, and the five-spawn diagnosis only once it has
  // already failed. `isGitRepo` alone is what used to report a git that is not
  // installed as "not a git repository"; paying for the real answer on the
  // unhappy path costs nothing anybody waits for.
  if (!isGitRepo(cwd)) {
    return { error: gitStatus(cwd).error ?? "git is unavailable", ok: false };
  }
  const subject = `chore(airship): ${summary.trim() || "visual edit"}`.slice(
    0,
    100
  );
  const specs = files.map((file) => `:(literal)${file}`);
  const staged = run(cwd, ["add", "--", ...specs]);
  if (!staged.ok) {
    return { error: failureText(staged.failure), ok: false };
  }
  const committed = run(cwd, [
    "commit",
    "--no-verify",
    "-m",
    subject,
    "--",
    ...specs,
  ]);
  if (!committed.ok) {
    return { error: failureText(committed.failure), ok: false };
  }
  return { ok: true, sha: currentSha(cwd) ?? undefined };
}

export interface RestoreResult {
  /** Repo-relative paths that were rewritten or deleted. */
  restored: string[];
  /** Paths left alone, and why. */
  skipped: { file: string; reason: string }[];
}

/**
 * Content-restore undo: rewrite each touched file back to its pre-edit content
 * (deleting files the edit created). Pure filesystem — works whether or not the
 * project is a git repo.
 *
 * `noBaseline` is checked *before* `isNew`, and that order is the whole point.
 * A baseline we could not read used to look exactly like a file that never
 * existed, so undo deleted tracked source files on any machine where git could
 * not run. Refusing and saying so is the only safe answer.
 *
 * Nothing here may throw: `undo` is called straight out of the WebSocket
 * message handler, so an EACCES on one read-only file would otherwise take the
 * whole daemon down with it.
 */
export function restoreFiles(cwd: string, diffs: FileDiff[]): RestoreResult {
  const restored: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const d of diffs) {
    const abs = resolve(cwd, d.file);
    if (d.noBaseline) {
      skipped.push({
        file: d.file,
        reason: "no baseline was captured, so there is nothing to restore",
      });
      continue;
    }
    try {
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
        continue;
      }
      skipped.push({
        file: d.file,
        reason: "no previous content was recorded",
      });
    } catch (err) {
      skipped.push({
        file: d.file,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { restored, skipped };
}
