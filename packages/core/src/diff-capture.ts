/**
 * Captures before/after content of files the agent edits, computed at finalize
 * (read after) against a `before` side gathered one of two ways.
 *
 * Claude drives this from a `PreToolUse` hook: `recordBefore` snapshots each
 * file just before the write. More robust than parsing assistant tool-use
 * blocks, since it sees the real filesystem state regardless of how the model
 * phrased the edit.
 *
 * Codex has no pre-tool hook — the first we hear of a write is a `file_change`
 * item reporting one that already happened. There `prime` seeds the files that
 * were already dirty when the turn began, and `recordAfterTheFact` reconstructs
 * everything else from the file's HEAD blob. See the two methods for why that
 * covers every case.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { FileDiff } from "@airship/protocol";
import { createPatch } from "diff";
import { canonicalPath, toPosixPath } from "./paths";

const CRLF = /\r\n/g;
const BOM = /^﻿/;

function readSafe(abs: string): string | null {
  try {
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Line endings, flattened for comparison and diffing only.
 *
 * On Windows `core.autocrlf=true` is the Git-for-Windows default, so the
 * working tree is CRLF while every agent's edit tool writes LF — and the HEAD
 * blob `fileAtHead` returns for the Codex path is LF too. Comparing those
 * directly makes every line of every file differ by its terminator, so a
 * one-line edit renders as a whole-file rewrite with garbage `+N −M` counts and
 * review comments that anchor to the wrong lines.
 *
 * Only the comparison and the patch are normalized. `FileDiff.before`/`after`
 * keep the bytes actually on disk, because `restoreFiles` writes `before` back
 * verbatim and undo has to round-trip exactly.
 *
 * The leading BOM goes the same way and for the same reason. Visual Studio and
 * several Windows editors write one; agent edit tools generally do not preserve
 * it, and `readFileSync(…, "utf8")` hands it back as a real `﻿` character
 * rather than stripping it — so dropping it would otherwise show up as the
 * first line having changed when its text is identical.
 *
 * One consequence worth knowing: an edit that changes *nothing but* line
 * endings or the BOM now reads as no change at all, so it is neither shown nor
 * committed. That is the intended trade — it is noise, not an edit.
 */
function forDiff(text: string | null): string {
  return text === null ? "" : text.replace(BOM, "").replace(CRLF, "\n");
}

/**
 * Canonicalize a path so the same file always produces the same map key.
 *
 * Without this the two `before` sources silently fail to meet: git reports
 * paths through `rev-parse --show-toplevel`, which resolves symlinks, while
 * `cwd` arrives however the user typed it. On macOS that is the common case,
 * not an edge one — `/tmp` and `/var` are both symlinks; on Windows it is any
 * two spellings that differ in case, including the drive letter. A mismatch
 * here does not throw; it just means `prime` records a baseline nobody ever
 * reads, so the user's own uncommitted edits get attributed to the agent and
 * undone with it.
 *
 * `canonicalPath` falls back to canonicalizing the containing directory when
 * the file itself does not exist, which is precisely the create case.
 */
function canonical(cwd: string, path: string): string {
  return canonicalPath(resolve(cwd, path));
}

/** Reads a path's content as of git HEAD. Injected so core need not know how. */
export type HeadReader = (absPath: string) => string | null;

export class DiffCapture {
  private readonly before = new Map<string, string | null>();
  private readonly touched = new Set<string>();
  /** Keys are canonical, so the root they are made relative to must be too. */
  private readonly root: string;

  private readonly cwd: string;
  /** Only supplied on the Codex path, where `before` must come from git. */
  private readonly readHead?: HeadReader;

  constructor(cwd: string, readHead?: HeadReader) {
    this.cwd = cwd;
    this.readHead = readHead;
    this.root = canonical(cwd, ".");
  }

  /** Called from the PreToolUse hook before each Write/Edit. */
  recordBefore(filePath: string): void {
    const abs = canonical(this.cwd, filePath);
    if (!this.before.has(abs)) {
      this.before.set(abs, readSafe(abs));
    }
    this.touched.add(abs);
  }

  /**
   * Seed `before` for files that were already modified when the turn started,
   * without marking them as touched.
   *
   * The distinction is the whole point: a file the user had edited by hand
   * before the turn must not show up in this turn's diff, but if the agent then
   * edits it too, its pre-turn on-disk content — not its HEAD blob — is the
   * correct baseline. Priming records that baseline while leaving the file out
   * of `touched` until something actually reports writing to it.
   */
  prime(dirty: Iterable<string>): void {
    for (const path of dirty) {
      const abs = canonical(this.cwd, path);
      if (!this.before.has(abs)) {
        this.before.set(abs, readSafe(abs));
      }
    }
  }

  /**
   * Record a write we learned about only after it happened.
   *
   * If the path was primed, its pre-turn content is already the baseline. If it
   * was not, the file was clean at the start of the turn, so its HEAD blob is
   * exactly the pre-turn content. A file that exists in neither (newly created,
   * or untracked) resolves to null, which `finalize` renders as `isNew`.
   */
  recordAfterTheFact(filePath: string): void {
    const abs = canonical(this.cwd, filePath);
    if (!this.before.has(abs)) {
      this.before.set(abs, this.readHead?.(abs) ?? null);
    }
    this.touched.add(abs);
  }

  /**
   * The before/after pair for one path, or null when it is unchanged or
   * unknown. Lets the Codex adapter synthesize a real `+N −M` count for a
   * `file_change` timeline row, which its SDK does not provide.
   */
  pairFor(
    filePath: string
  ): { after: string | null; before: string | null } | null {
    const abs = canonical(this.cwd, filePath);
    if (!this.touched.has(abs)) {
      return null;
    }
    const before = this.before.get(abs) ?? null;
    const after = readSafe(abs);
    return forDiff(before) === forDiff(after) ? null : { after, before };
  }

  /** Net before→after diff for every file the agent touched. */
  finalize(): FileDiff[] {
    const diffs: FileDiff[] = [];
    for (const abs of this.touched) {
      const before = this.before.get(abs) ?? null;
      const after = readSafe(abs);
      if (forDiff(before) === forDiff(after)) {
        continue;
      }
      // Forward slashes from here on. This value is a git pathspec in
      // `commitEdit` (where backslash is wildmatch's escape character), a key
      // the browser splits on "/", and a string embedded in JSON headed for the
      // model, where every backslash arrives doubled.
      const rel = toPosixPath(relative(this.root, abs));
      const patch = createPatch(rel, forDiff(before), forDiff(after));
      const { additions, deletions } = countChanges(patch);
      diffs.push({
        additions,
        after,
        before,
        deletions,
        file: rel,
        isDeleted: after === null,
        isNew: before === null,
        patch,
      });
    }
    return diffs;
  }
}

function countChanges(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}
