/**
 * The chat timeline: an append-only list of agent activity, plus the reducer
 * that folds live socket deltas into it.
 *
 * This mirrors `TimelineRecorder` in `@airship/core` — the same fold, written
 * twice. That duplication is deliberate: the protocol package imports zod at
 * module scope, and the overlay only ever imports it `import type`, which is
 * what keeps zod out of the bundle injected into the host page. Sharing the
 * reducer would mean shipping it.
 */
import type {
  TimelineItem,
  TimelineItemPatch,
  TimelineTextItem,
  TimelineThinkingItem,
  TimelineToolItem,
  TodoItem,
} from "@airship/protocol";
import { clear, cls, el } from "../dom";
import { type TimelineRow, timelineRow } from "./tool-row";

/** The two socket events the timeline consumes. */
export type TimelineDelta =
  | { item: TimelineItem; type: "job:timeline" }
  | { id: string; patch: TimelineItemPatch; type: "job:timeline:patch" };

export interface TimelineView {
  /** Fold one live delta in. O(1) — appends a row, or patches one in place. */
  apply: (ev: TimelineDelta) => void;
  /** Rebuild from a persisted array. Idempotent; used for replay and repair. */
  hydrate: (items: TimelineItem[]) => void;
  isEmpty: () => boolean;
  root: HTMLElement;
  /** Post-completion resting state: every expandable row folds shut. */
  setCollapsed: (collapsed: boolean) => void;
}

export function timelineView(): TimelineView {
  const root = el("div", { class: cls("tl") });
  /** id → {item, row}. Keyed by id and appended in arrival order, which is why
   * parallel tool calls and MultiEdit need no special handling. */
  const rows = new Map<string, { item: TimelineItem; row: TimelineRow }>();

  const append = (item: TimelineItem): void => {
    if (rows.has(item.id)) {
      return;
    }
    const row = timelineRow(item);
    rows.set(item.id, { item, row });
    root.append(row.root);
  };

  const patch = (id: string, p: TimelineItemPatch): void => {
    const entry = rows.get(id);
    // An unknown id means we joined mid-job and never saw the append. Dropping
    // it is correct — `job:done` hydrates the whole list and repairs us.
    if (!entry) {
      return;
    }
    applyPatch(entry.item, p);
    entry.row.update(entry.item);
  };

  return {
    apply(ev) {
      if (ev.type === "job:timeline") {
        append(ev.item);
      } else {
        patch(ev.id, ev.patch);
      }
    },

    hydrate(items) {
      clear(root);
      rows.clear();
      for (const item of items) {
        append(item);
      }
    },

    isEmpty: () => rows.size === 0,

    root,

    setCollapsed(collapsed) {
      // Drive each row's own disclosure rather than putting a class on the
      // root. The class version hid bodies with a descendant `display: none`,
      // which a row could never argue with — so once a turn finished (or was
      // replayed from history) every tool row was frozen shut: the click
      // handler ran, the body was appended, and nothing appeared.
      if (!collapsed) {
        return;
      }
      for (const { row } of rows.values()) {
        row.setOpen?.(false);
      }
    },
  };
}

/**
 * Merge a patch into an item. `textDelta` appends; `text` replaces outright and
 * always wins — the streamed deltas arrive *before* the assistant message that
 * repeats the same prose, so an append-only model would render it twice.
 */
function applyPatch(item: TimelineItem, patch: TimelineItemPatch): void {
  const tool = item as TimelineToolItem;
  const prose = item as TimelineTextItem | TimelineThinkingItem;

  if (patch.phase !== undefined) {
    tool.phase = patch.phase;
  }
  if (patch.result !== undefined) {
    tool.result = patch.result;
  }
  if (patch.endedAt !== undefined) {
    tool.endedAt = patch.endedAt;
  }
  if (patch.textDelta !== undefined) {
    prose.text = (prose.text ?? "") + patch.textDelta;
  }
  if (patch.text !== undefined) {
    prose.text = patch.text;
  }
  if (patch.streaming !== undefined) {
    prose.streaming = patch.streaming;
  }
  if (patch.estimatedTokens !== undefined) {
    (item as TimelineThinkingItem).estimatedTokens = patch.estimatedTokens;
  }
  if (patch.todos !== undefined) {
    (item as { todos?: TodoItem[] }).todos = patch.todos;
  }
}
