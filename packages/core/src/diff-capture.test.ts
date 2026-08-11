/**
 * Covers the three ways the Codex path can arrive at a `before` side.
 *
 * Worth testing specifically because a wrong `before` fails quietly rather than
 * loudly: `restoreFiles` skips any diff whose `before` is not a string, so the
 * only symptom is undo reporting "restored 0/1 files" long after the fact.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirtyFiles, fileAtHead } from "@airship/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiffCapture } from "./diff-capture";

let repo: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function write(rel: string, body: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "airship-diff-test-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write("committed.txt", "one\ntwo\nthree\n");
  write("dirty.txt", "original\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
});

afterEach(() => {
  rmSync(repo, { force: true, recursive: true });
});

function capture(): DiffCapture {
  return new DiffCapture(repo, (abs) => fileAtHead(repo, abs));
}

describe("DiffCapture on the Codex path", () => {
  it("uses the HEAD blob as the baseline for a file that was clean", () => {
    const dc = capture();
    dc.prime(dirtyFiles(repo));

    write("committed.txt", "one\nTWO\nthree\n");
    dc.recordAfterTheFact("committed.txt");

    const [diff] = dc.finalize();
    expect(diff.file).toBe("committed.txt");
    expect(diff.before).toBe("one\ntwo\nthree\n");
    expect(diff.isNew).toBe(false);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it("uses the pre-turn working copy for a file the user had already edited", () => {
    // The user's own uncommitted edit is not part of this turn's diff, so the
    // baseline must be what was on disk when the turn began — not HEAD, which
    // would attribute their change to the agent.
    write("dirty.txt", "user edit\n");

    const dc = capture();
    dc.prime(dirtyFiles(repo));

    write("dirty.txt", "user edit\nagent edit\n");
    dc.recordAfterTheFact("dirty.txt");

    const [diff] = dc.finalize();
    expect(diff.before).toBe("user edit\n");
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);
  });

  it("reports a file that exists in neither HEAD nor the working copy as new", () => {
    const dc = capture();
    dc.prime(dirtyFiles(repo));

    write("fresh.txt", "brand new\n");
    dc.recordAfterTheFact("fresh.txt");

    const [diff] = dc.finalize();
    expect(diff.file).toBe("fresh.txt");
    expect(diff.before).toBeNull();
    expect(diff.isNew).toBe(true);
  });

  it("leaves a primed file out of the diff unless something writes to it", () => {
    write("dirty.txt", "user edit\n");
    const dc = capture();
    dc.prime(dirtyFiles(repo));
    // Priming records a baseline; it must not by itself claim the file changed.
    expect(dc.finalize()).toEqual([]);
  });

  it("exposes a before/after pair only for a file that actually changed", () => {
    const dc = capture();
    dc.prime(dirtyFiles(repo));

    write("committed.txt", "one\ntwo\nthree\nfour\n");
    dc.recordAfterTheFact("committed.txt");

    expect(dc.pairFor("committed.txt")).toEqual({
      after: "one\ntwo\nthree\nfour\n",
      before: "one\ntwo\nthree\n",
    });
    // Never touched, so there is nothing to report.
    expect(dc.pairFor("dirty.txt")).toBeNull();
  });

  it("still snapshots directly when a head reader is not supplied", () => {
    // The Claude path: `recordBefore` runs ahead of the write.
    const dc = new DiffCapture(repo);
    dc.recordBefore("committed.txt");
    write("committed.txt", "replaced\n");

    const [diff] = dc.finalize();
    expect(diff.before).toBe("one\ntwo\nthree\n");
  });
});

/**
 * The Windows shape, reproducible anywhere: `core.autocrlf=true` leaves a CRLF
 * working tree, every agent's edit tool writes LF, and the HEAD blob the Codex
 * path reads back is LF too. Comparing those byte-for-byte makes every line
 * differ by its terminator, so a one-line edit reports as a whole-file rewrite.
 */
describe("DiffCapture with CRLF line endings", () => {
  it("diffs only the line that changed, not every line", () => {
    write("crlf.txt", "one\r\ntwo\r\nthree\r\n");
    const dc = new DiffCapture(repo);
    dc.recordBefore("crlf.txt");
    // The agent rewrites the file with LF, changing exactly one line.
    write("crlf.txt", "one\nTWO\nthree\n");

    const [diff] = dc.finalize();
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it("keeps the bytes on disk in before/after so undo round-trips exactly", () => {
    // The patch is normalized for display; `restoreFiles` writes `before` back
    // verbatim, so it has to carry the CRLF the file actually had.
    write("crlf.txt", "one\r\ntwo\r\n");
    const dc = new DiffCapture(repo);
    dc.recordBefore("crlf.txt");
    write("crlf.txt", "one\nCHANGED\n");

    const [diff] = dc.finalize();
    expect(diff.before).toBe("one\r\ntwo\r\n");
    expect(diff.after).toBe("one\nCHANGED\n");
  });

  it("does not report a first-line change when only the BOM was dropped", () => {
    // Visual Studio writes a BOM; agent edit tools generally do not put it
    // back, and readFileSync surfaces it as a real character.
    write("bom.txt", "﻿one\ntwo\n");
    const dc = new DiffCapture(repo);
    dc.recordBefore("bom.txt");
    write("bom.txt", "one\nCHANGED\n");

    const [diff] = dc.finalize();
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it("reports no change when only the line endings were rewritten", () => {
    write("crlf.txt", "one\r\ntwo\r\n");
    const dc = new DiffCapture(repo);
    dc.recordBefore("crlf.txt");
    write("crlf.txt", "one\ntwo\n");

    expect(dc.finalize()).toEqual([]);
    expect(dc.pairFor("crlf.txt")).toBeNull();
  });
});
