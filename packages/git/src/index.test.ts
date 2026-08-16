/**
 * The package had no tests at all, which is how it shipped a data-loss bug.
 *
 * Two things are pinned here that nothing else can pin. The first is that a
 * failure keeps its reason: every helper used to funnel through `catch { return
 * null }`, so a missing commit identity, a stale index.lock, a pathspec that
 * matched nothing and a git that was not installed all reached the user as
 * "commit failed". The second is the distinction between "this file was not in
 * HEAD" and "we could not ask": collapsing those made undo delete tracked
 * source files on any machine where git could not run.
 *
 * Everything runs against a real temp repo and a real git binary. There is no
 * mock — the whole subject is what the real one does on the day it goes wrong.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileDiff } from "@airship/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalPath,
  commitEdit,
  createBranch,
  dirtyFiles,
  failureText,
  fileAtHead,
  type GitFailure,
  gitStatus,
  isGitRepo,
  onGitFailure,
  restoreFiles,
} from "./index";

const VERSION = /^\d+\.\d+/;
const SHA = /^[0-9a-f]{40}$/;
/** git words this several ways across versions, so match the subject. */
const IDENTITY = /email|identity/i;

let repo: string;
/** An empty directory, used as a PATH with no git in it. */
let empty: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function write(rel: string, body: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

/** A `FileDiff` with only the fields the restore path reads. */
function diff(over: Partial<FileDiff> & { file: string }): FileDiff {
  return {
    additions: 0,
    deletions: 0,
    isDeleted: false,
    isNew: false,
    patch: "",
    ...over,
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "airship-git-test-"));
  empty = mkdtempSync(join(tmpdir(), "airship-git-nopath-"));
  // `-b main` keeps `init.defaultBranch` advice off stderr, which would
  // otherwise be the first line `failureText` picks out of an unrelated failure.
  git("init", "-q", "-b", "main");
  // The developer's own global config must not decide what these assert — the
  // identity case in particular passes vacuously on a machine that has one.
  // `GIT_CONFIG_GLOBAL=/dev/null` is not portable; an empty file is.
  writeFileSync(join(repo, ".gitconfig-empty"), "");
  process.env.GIT_CONFIG_GLOBAL = join(repo, ".gitconfig-empty");
  process.env.GIT_CONFIG_SYSTEM = join(repo, ".gitconfig-empty");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  // Pinned, so a runner or developer with `core.autocrlf=true` does not turn
  // the non-EOL cases into a coin flip. The CRLF case sets its own rule.
  git("config", "core.autocrlf", "false");
  write("committed.txt", "one\ntwo\nthree\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
});

afterEach(() => {
  onGitFailure(undefined);
  // `delete`, not `= undefined`: assigning to `process.env` coerces, so that
  // would leave the literal string "undefined" behind as a config path.
  delete process.env.GIT_CONFIG_GLOBAL;
  delete process.env.GIT_CONFIG_SYSTEM;
  for (const dir of [repo, empty]) {
    // maxRetries: on Windows a git process can still hold a handle inside .git
    // for a moment after it exits, which surfaces as EBUSY.
    rmSync(dir, { force: true, maxRetries: 3, recursive: true });
  }
});

describe("gitStatus", () => {
  it("reports a healthy repository", () => {
    const status = gitStatus(repo);
    expect(status.installed).toBe(true);
    expect(status.version).toMatch(VERSION);
    expect(status.workTree).toBe(true);
    expect(status.hasCommits).toBe(true);
    expect(status.identity).toBe(true);
    expect(status.error).toBeUndefined();
  });

  it("still lists dirty files in a repository with no commits", () => {
    // `runner.ts` gates priming on `workTree` and reading HEAD on `hasCommits`,
    // separately, because of this: status answers without a HEAD, so a fresh
    // repository still gets a real on-disk baseline for every file it holds.
    const fresh = mkdtempSync(join(tmpdir(), "airship-git-nohead-"));
    execFileSync("git", ["init", "-q"], { cwd: fresh, stdio: "ignore" });
    writeFileSync(join(fresh, "a.txt"), "hi\n");
    const dirty = dirtyFiles(fresh);
    expect(dirty.size).toBe(1);
    expect([...dirty][0].endsWith("a.txt")).toBe(true);
    rmSync(fresh, { force: true, maxRetries: 3, recursive: true });
  });

  it("separates a repository with no commits from a broken one", () => {
    const fresh = mkdtempSync(join(tmpdir(), "airship-git-fresh-"));
    execFileSync("git", ["init", "-q"], { cwd: fresh, stdio: "ignore" });
    const status = gitStatus(fresh);
    expect(status.workTree).toBe(true);
    expect(status.hasCommits).toBe(false);
    expect(status.error).toContain("no commits");
    rmSync(fresh, { force: true, maxRetries: 3, recursive: true });
  });

  it("names a bare repository rather than calling it not-a-repository", () => {
    // The regression this pins: `isGitRepo` answers "false" for a bare repo and
    // null for a hard failure, and both used to render the same sentence.
    const bare = mkdtempSync(join(tmpdir(), "airship-git-bare-"));
    execFileSync("git", ["init", "-q", "--bare"], {
      cwd: bare,
      stdio: "ignore",
    });
    const status = gitStatus(bare);
    expect(status.installed).toBe(true);
    expect(status.workTree).toBe(false);
    expect(status.error).toContain("bare");
    rmSync(bare, { force: true, maxRetries: 3, recursive: true });
  });

  it("reports a directory that is not a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "airship-git-plain-"));
    expect(gitStatus(plain).error).toBe("not a git repository");
    rmSync(plain, { force: true, maxRetries: 3, recursive: true });
  });

  it("reports a missing commit identity", () => {
    git("config", "--unset", "user.email");
    const status = gitStatus(repo);
    expect(status.identity).toBe(false);
    expect(status.error).toContain("identity");
    expect(status.hint).toContain("user.email");
  });

  it("does not report a nonexistent cwd as a missing git", () => {
    // Spawning into a directory that does not exist throws ENOENT, which is
    // byte-identical to git not being installed. A mistyped --cwd must not be
    // reported as "install git".
    const status = gitStatus(join(repo, "no-such-directory"));
    expect(status.installed).toBe(true);
    expect(status.error).toBe("not a git repository");
  });

  it("keeps every reason inside the overlay's one-line tooltip budget", () => {
    // `GitStatus.error` is rendered in the turn menu's tooltip, where the house
    // rule is 44 characters. A path in the message would blow that, which is
    // why the banner adds the directory and this does not.
    const plain = mkdtempSync(join(tmpdir(), "airship-git-copy-"));
    for (const status of [gitStatus(plain), gitStatus(repo)]) {
      expect((status.error ?? "").length).toBeLessThanOrEqual(44);
      expect(status.error ?? "").not.toContain("—");
    }
    rmSync(plain, { force: true, maxRetries: 3, recursive: true });
  });
});

describe("commitEdit", () => {
  it("returns the new sha", () => {
    write("committed.txt", "one\ntwo\nfour\n");
    const result = commitEdit(repo, ["committed.txt"], "change three to four");
    expect(result.ok).toBe(true);
    expect(result.sha).toMatch(SHA);
    expect(result.error).toBeUndefined();
  });

  it("surfaces a pathspec that matched nothing, without leaking our magic", () => {
    const result = commitEdit(repo, ["nowhere.txt"], "x");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not match any files");
    expect(result.error).toContain("nowhere.txt");
    // `:(literal)` is ours, not something the user typed. Leaving it in reads
    // as a bug in airship rather than as a missing file.
    expect(result.error).not.toContain("literal");
  });

  it("surfaces 'nothing to commit', which git prints on stdout", () => {
    // The case a stderr-only formatter gets wrong. `git commit` exits 1 here and
    // says nothing on stderr at all, so the message has to come off stdout.
    const result = commitEdit(repo, ["committed.txt"], "no change");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("nothing to commit, working tree clean");
    // "On branch main" rides along on stdout and explains nothing; leading with
    // it buries the half that does.
    expect(result.error).not.toContain("On branch");
  });

  it("surfaces a missing commit identity", () => {
    git("config", "--unset", "user.email");
    git("config", "--unset", "user.name");
    // Without this git invents an identity from the hostname and the commit
    // succeeds, so the interesting case would never run on a machine that has
    // a resolvable one. `useConfigOnly` is exactly the "do not guess" switch.
    git("config", "user.useConfigOnly", "true");
    write("committed.txt", "one\ntwo\nfive\n");
    const result = commitEdit(repo, ["committed.txt"], "x");
    expect(result.ok).toBe(false);
    // git words this several ways across versions ("no email was given and
    // auto-detection is disabled", "unable to auto-detect email address",
    // "Author identity unknown"), so match the subject rather than a sentence.
    expect(result.error).toMatch(IDENTITY);
  });

  it("refuses outside a repository, and says which problem it is", () => {
    const plain = mkdtempSync(join(tmpdir(), "airship-git-nc-"));
    expect(commitEdit(plain, ["a.txt"], "x").error).toBe(
      "not a git repository"
    );
    rmSync(plain, { force: true, maxRetries: 3, recursive: true });
  });

  it("treats a filename with glob characters literally", () => {
    // Without `:(literal)`, `git add -- 'a[1].ts'` also stages `a1.ts` — so one
    // edited file could sweep unrelated work into airship's commit.
    write("a[1].ts", "bracketed\n");
    write("a1.ts", "decoy, must not be committed\n");
    const result = commitEdit(repo, ["a[1].ts"], "literal pathspec");
    expect(result.ok).toBe(true);
    const staged = execFileSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      {
        cwd: repo,
        encoding: "utf8",
      }
    );
    expect(staged).toContain("a[1].ts");
    expect(staged).not.toContain("a1.ts\n");
  });
});

describe("createBranch", () => {
  it("reports why a branch could not be created", () => {
    expect(createBranch(repo, "feature").ok).toBe(true);
    const again = createBranch(repo, "feature");
    expect(again.ok).toBe(false);
    expect(again.error).toContain("already exists");
  });
});

describe("fileAtHead", () => {
  it("reads a tracked file", () => {
    const read = fileAtHead(repo, join(repo, "committed.txt"));
    expect(read).toEqual({ kind: "content", text: "one\ntwo\nthree\n" });
  });

  it("reports an untracked file as absent, not unavailable", () => {
    write("fresh.txt", "new\n");
    expect(fileAtHead(repo, join(repo, "fresh.txt"))).toEqual({
      kind: "absent",
    });
  });

  it("reports a path outside the work tree as unavailable, not absent", () => {
    // A file we cannot even ask about is not a file that did not exist. Calling
    // it absent marks the diff `isNew`, and undo deletes what an edit created.
    expect(fileAtHead(repo, join(repo, "..", "outside.txt"))).toEqual({
      kind: "unavailable",
    });
  });

  it("reports a binary blob as unavailable rather than decoding it", () => {
    writeFileSync(
      join(repo, "logo.bin"),
      Buffer.from([0x00, 0xff, 0xfe, 0x41])
    );
    git("add", "-A");
    git("commit", "-q", "-m", "binary");
    // Decoded as UTF-8 it would come back full of U+FFFD, and `restoreFiles`
    // would write that corruption over the user's file.
    expect(fileAtHead(repo, join(repo, "logo.bin"))).toEqual({
      kind: "unavailable",
    });
  });

  it("returns the working-tree form, not the stored blob", () => {
    // `.gitattributes` rather than `core.autocrlf`, so this is the same test on
    // Linux and Windows. The blob is LF; a checkout of it is CRLF; `before` has
    // to be the second, because `restoreFiles` writes it straight back to disk.
    write(".gitattributes", "*.txt text eol=crlf\n");
    write("crlf.txt", "alpha\nbeta\n");
    git("add", "-A");
    git("commit", "-q", "-m", "crlf");
    const read = fileAtHead(repo, join(repo, "crlf.txt"));
    expect(read).toEqual({ kind: "content", text: "alpha\r\nbeta\r\n" });
  });
});

describe("restoreFiles", () => {
  it("rewrites a file from its before content", () => {
    write("committed.txt", "edited\n");
    const result = restoreFiles(repo, [
      diff({ before: "one\ntwo\nthree\n", file: "committed.txt" }),
    ]);
    expect(result.restored).toEqual(["committed.txt"]);
    expect(result.skipped).toEqual([]);
    expect(fileAtHead(repo, join(repo, "committed.txt"))).toEqual({
      kind: "content",
      text: "one\ntwo\nthree\n",
    });
  });

  it("deletes a file the edit created", () => {
    write("added.txt", "new\n");
    const result = restoreFiles(repo, [
      diff({ file: "added.txt", isNew: true }),
    ]);
    expect(result.restored).toEqual(["added.txt"]);
    expect(existsSync(join(repo, "added.txt"))).toBe(false);
  });

  it("refuses a file with no baseline instead of deleting it", () => {
    // The headline regression. `noBaseline` is checked before `isNew`, because a
    // baseline that could not be read used to be indistinguishable from a file
    // that never existed, and undo deleted the difference.
    write("committed.txt", "edited by the agent\n");
    const result = restoreFiles(repo, [
      diff({ file: "committed.txt", isNew: true, noBaseline: true }),
    ]);
    expect(result.restored).toEqual([]);
    expect(result.skipped).toEqual([
      {
        file: "committed.txt",
        reason: "no baseline was captured, so there is nothing to restore",
      },
    ]);
    // Still on disk, and still holding the agent's edit: refusing is the point.
    expect(readFileSync(join(repo, "committed.txt"), "utf8")).toBe(
      "edited by the agent\n"
    );
  });

  it("reports a write failure instead of throwing", () => {
    // `undo` is called straight out of the WebSocket message handler with no
    // try/catch of its own, so a throw here takes the whole daemon down with it.
    //
    // A directory standing where the file should be, rather than a read-only
    // bit: the POSIX permission bits do not mean the same thing on NTFS, and
    // this failure is identical on both.
    mkdirSync(join(repo, "blocked.txt"), { recursive: true });
    const result = restoreFiles(repo, [
      diff({ before: "original\n", file: "blocked.txt" }),
    ]);
    expect(result.restored).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].file).toBe("blocked.txt");
  });
});

describe("failureText", () => {
  const base: GitFailure = {
    args: ["commit"],
    bin: "git",
    code: 1,
    stderr: "",
    stdout: "",
  };

  it("names a missing binary", () => {
    expect(failureText({ ...base, code: null, errno: "ENOENT" })).toBe(
      "git is not installed or not on PATH"
    );
  });

  it("prefers git's own marked lines over its progress output", () => {
    expect(
      failureText({
        ...base,
        stderr: "Enumerating objects: 5, done.\nfatal: repository not found",
      })
    ).toBe("fatal: repository not found");
  });

  it("falls back to a description when there is no output at all", () => {
    expect(failureText(base)).toBe("git commit exited 1");
  });

  it("stays on one line", () => {
    const text = failureText({
      ...base,
      stderr: `fatal: ${"x".repeat(400)}`,
    });
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThanOrEqual(300);
  });
});

describe("with git not on PATH", () => {
  /*
   * The reported scenario, and the one that used to end in deleted files.
   *
   * Git for Windows' "Git from Git Bash only" install option leaves git.exe off
   * the system PATH, so every call from the daemon fails while `git` works
   * perfectly in the contributor's own terminal.
   *
   * PATH is set to a real empty directory rather than to "", which behaves
   * differently across platforms. On Windows `process.env` lookup is
   * case-insensitive, so assigning `PATH` also overrides an existing `Path`;
   * CreateProcess additionally searches the application directory and the cwd,
   * neither of which holds a git.
   */
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.PATH;
    process.env.PATH = empty;
  });

  afterEach(() => {
    process.env.PATH = saved;
  });

  it("reports git as missing rather than the directory as not-a-repository", () => {
    const status = gitStatus(repo);
    expect(status.installed).toBe(false);
    expect(status.error).toBe("git is not installed or not on PATH");
    expect(status.hint).toContain("PATH");
  });

  it("makes fileAtHead unavailable, never absent", () => {
    // The single most important assertion in this file. `absent` here would
    // mark every edited file `isNew`, and undo deletes what an edit created.
    expect(fileAtHead(repo, join(repo, "committed.txt"))).toEqual({
      kind: "unavailable",
    });
  });

  it("makes commitEdit say so", () => {
    const result = commitEdit(repo, ["committed.txt"], "x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("git is not installed or not on PATH");
  });

  it("still answers the yes/no probes without throwing", () => {
    expect(isGitRepo(repo)).toBe(false);
    expect(dirtyFiles(repo).size).toBe(0);
  });

  it("hands every failure to the diagnostic sink", () => {
    const seen: GitFailure[] = [];
    onGitFailure((failure) => seen.push(failure));
    isGitRepo(repo);
    expect(seen).toHaveLength(1);
    expect(seen[0].bin).toBe("git");
    expect(seen[0].errno).toBe("ENOENT");
    expect(seen[0].args).toEqual(["rev-parse", "--is-inside-work-tree"]);
  });
});

describe("canonicalPath", () => {
  it("resolves a path that does not exist via its parent", () => {
    // The create case: `DiffCapture` keys on a file before it is written.
    expect(canonicalPath(join(repo, "not-yet.txt"))).toBe(
      join(canonicalPath(repo), "not-yet.txt")
    );
  });
});
