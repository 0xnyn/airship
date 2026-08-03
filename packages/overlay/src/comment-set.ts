import type { ReviewComment } from "@airship/protocol";

/**
 * Review comments the user has left on an edit the agent already made.
 *
 * The fourth member of the pending-changes family, alongside {@link ChangeSet},
 * {@link MoveSet} and {@link StructureSet} — same shape, same lifecycle, so
 * `discard()` and `reconcileVisual()` each pick it up in two lines. The simplest
 * of the four: a comment has no live DOM preview, so nothing has to be reverted
 * when one is dropped.
 *
 * Keyed by id rather than by node, because a comment is attached to a range of
 * a file's diff, not to an element on the page.
 */
export interface CommentRecord {
  body: string;
  createdAt: number;
  file: string;
  /** 1-based inclusive range in the post-edit file; absent for a whole-file note. */
  fromLine?: number;
  id: string;
  /** The job whose diff this comments on. */
  jobId: string;
  /** The lines pointed at, so the agent can re-find them if numbers drift. */
  snippet: string;
  toLine?: number;
}

/** Keeps one comment from carrying a whole file into the prompt. */
const MAX_SNIPPET_LINES = 60;
const MAX_SNIPPET_CHARS = 4000;

let seq = 0;

export class CommentSet {
  private readonly map = new Map<string, CommentRecord>();

  add(rec: Omit<CommentRecord, "createdAt" | "id">): CommentRecord {
    seq += 1;
    const record: CommentRecord = {
      ...rec,
      createdAt: Date.now(),
      id: `c${seq}`,
      snippet: clamp(rec.snippet),
    };
    this.map.set(record.id, record);
    return record;
  }

  clear(): void {
    this.map.clear();
  }

  count(): number {
    return this.map.size;
  }

  entries(): CommentRecord[] {
    return [...this.map.values()];
  }

  isEmpty(): boolean {
    return this.map.size === 0;
  }

  remove(id: string): void {
    this.map.delete(id);
  }

  /** The job to resume, so feedback continues the session that made the edit. */
  parentJobId(): string | undefined {
    return this.entries()[0]?.jobId;
  }

  /** The wire payload. */
  targets(): ReviewComment[] {
    return this.entries().map((c) => ({
      body: c.body,
      file: c.file,
      fromLine: c.fromLine,
      jobId: c.jobId,
      snippet: c.snippet,
      toLine: c.toLine,
    }));
  }
}

function clamp(snippet: string): string {
  const lines = snippet.split("\n").slice(0, MAX_SNIPPET_LINES).join("\n");
  return lines.length > MAX_SNIPPET_CHARS
    ? `${lines.slice(0, MAX_SNIPPET_CHARS)}\n…`
    : lines;
}
