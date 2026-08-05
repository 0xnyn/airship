import type { JobHistorySummary, JobStatus } from "@airship/protocol";
import { cls, el } from "../dom";
import { emptyState } from "../empty";
import { type IconName, icon } from "../icons";

/** A conversation = a root job + all edits that descend from it. */
export interface ThreadSummary {
  count: number;
  rootJobId: string;
  status: JobStatus;
  title: string;
  updatedAt: number;
}

/** Walk `parentJobId` links up to the conversation root. */
function rootOf(
  entry: JobHistorySummary,
  byId: Map<string, JobHistorySummary>
): string {
  let cur = entry;
  const seen = new Set<string>();
  while (cur.parentJobId && !seen.has(cur.jobId)) {
    seen.add(cur.jobId);
    const parent = byId.get(cur.parentJobId);
    if (!parent) {
      break;
    }
    cur = parent;
  }
  return cur.jobId;
}

/**
 * Fold the server's flat history into conversation threads, newest activity
 * first. The root job's prompt titles the thread; the newest edit's timestamp
 * and status drive ordering and the status glyph.
 */
export function groupThreads(entries: JobHistorySummary[]): ThreadSummary[] {
  const byId = new Map(entries.map((e) => [e.jobId, e]));
  const roots = new Map<string, ThreadSummary>();
  for (const e of entries) {
    const rootId = rootOf(e, byId);
    const root = byId.get(rootId);
    const existing = roots.get(rootId);
    if (existing) {
      existing.count += 1;
      if (e.createdAt > existing.updatedAt) {
        existing.updatedAt = e.createdAt;
        existing.status = e.status;
      }
    } else {
      roots.set(rootId, {
        count: 1,
        rootJobId: rootId,
        status: e.status,
        title: (root ?? e).promptPreview || "Untitled edit",
        updatedAt: e.createdAt,
      });
    }
  }
  return [...roots.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Compact "2m" / "3h" / "5d" relative label. `now` is injectable for tests. */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) {
    return "now";
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  return `${Math.round(h / 24)}d`;
}

/** The glyph a thread wears, by the status of its newest edit. */
function statusMark(status: JobStatus): IconName {
  if (status === "done") {
    return "check";
  }
  return status === "failed" ? "close" : "dot";
}

export interface ThreadListOptions {
  /** Injectable clock, so a story or a test can pin the relative labels. */
  now?: number;
  /** Open a conversation. */
  onOpen: (rootJobId: string) => void;
}

/**
 * Render the grouped history into `host`.
 *
 * Here rather than in `AirshipApp`, where it was a private method, for the
 * reason `row-list.ts` gives for itself: the rows are a pure function of a
 * `JobHistorySummary[]`, and a renderer that can only be reached through a class
 * holding a socket, a stage and a selection controller cannot be looked at. The
 * alternative was a story that re-implemented this markup, which is a fixture
 * that drifts rather than a picture of the thing.
 *
 * Appends rather than clears: the drawer head is the caller's, and it is already
 * there.
 */
export function renderThreads(
  host: HTMLElement,
  entries: JobHistorySummary[],
  opts: ThreadListOptions
): void {
  const threads = groupThreads(entries);
  if (!threads.length) {
    // `md`, like the transcript this drawer covers: it is a full-dock surface,
    // not a card, so it gets the dock-sized treatment and centres in the space
    // under the head rather than hugging it.
    host.append(
      emptyState({
        body: "Every chat you send lands here.",
        title: "No conversations yet",
      })
    );
    return;
  }
  for (const thread of threads) {
    host.append(
      el(
        "div",
        {
          class: cls("thread-item"),
          onClick: () => opts.onOpen(thread.rootJobId),
        },
        [
          icon(statusMark(thread.status), "sm"),
          el("div", { class: cls("thread-main") }, [
            el("div", { class: cls("thread-title"), text: thread.title }),
            el("div", {
              class: cls("thread-meta"),
              text: `${relativeTime(thread.updatedAt, opts.now)} · ${thread.count} edit${
                thread.count === 1 ? "" : "s"
              }`,
            }),
          ]),
        ]
      )
    );
  }
}
