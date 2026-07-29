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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { FileDiff } from "@airship/protocol";
import { createPatch } from "diff";

function readSafe(abs: string): string | null {
  try {
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a path so the same file always produces the same map key.
 *
 * Without this the two `before` sources silently fail to meet: git reports
 * paths through `rev-parse --show-toplevel`, which resolves symlinks, while
 * `cwd` arrives however the user typed it. On macOS that is the common case,
 * not an edge one — `/tmp` and `/var` are both symlinks. A mismatch here does
 * not throw; it just means `prime` records a baseline nobody ever reads, so the
 * user's own uncommitted edits get attributed to the agent and undone with it.
 *
 * Resolves the directory rather than the file, because the file frequently does
 * not exist yet — that is precisely the create case.
 */
function canonical(cwd: string, path: string): string {
  const abs = resolve(cwd, path);
  try {
    return resolve(realpathSync(dirname(abs)), basename(abs));
  } catch {
    // A path whose parent does not exist yet cannot be canonicalized; the raw
    // resolution is still a consistent key for it.
    return abs;
  }
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
    return (before ?? "") === (after ?? "") ? null : { after, before };
  }

  /** Net before→after diff for every file the agent touched. */
  finalize(): FileDiff[] {
    const diffs: FileDiff[] = [];
    for (const abs of this.touched) {
      const before = this.before.get(abs) ?? null;
      const after = readSafe(abs);
      if ((before ?? "") === (after ?? "")) {
        continue;
      }
      const rel = relative(this.root, abs);
      const patch = createPatch(rel, before ?? "", after ?? "");
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
