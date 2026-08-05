/*
 * Undo and redo for direct manipulation.
 *
 * Easier here than it looks, because the edit sets are already `(from, to)` diff
 * buffers — so undo is a journal of *operations*, not a stack of snapshots.
 *
 * **The invariant, and the only rule this file has:** an op may be journalled
 * if and only if enacting it puts the DOM *and* the set that owns it back
 * together. Airship previews an edit by mutating the live page and tells the
 * agent about it separately, so a DOM-only undo does not undo anything — it
 * makes the page disagree with the payload, silently, until the agent runs and
 * re-applies the change the user just took back. `style` got this right from the
 * start by replaying through `ChangeSet`; `insert`, `remove` and `text` did not,
 * and moves and attribute edits were never journalled at all.
 *
 * That is why this file no longer knows what an op *means*. It owns the stacks,
 * the batching and the direction; `history-ops.ts` owns enactment and is the one
 * place with every set in scope. A new op kind cannot be added here without
 * giving it an arm there, which is exactly the coupling that was missing.
 *
 * The one genuinely fiddly part is coalescing: a number scrub emits a change per
 * pointermove, so without `batch()` a single drag would leave 200 undo steps.
 */
import type { ElementContext, SourceLocation } from "@airship/protocol";
import type { Change } from "./change-set";
import type { MoveRecord } from "./move-set";
import type { StructureRecord } from "./structure-set";

/** Which way an op is being enacted. */
export type Direction = "redo" | "undo";

export type Op =
  | {
      kind: "move";
      node: Element;
      fromParent: Element;
      fromNext: Node | null;
      toParent: Element;
      toNext: Node | null;
      /**
       * The `MoveSet` entry on either side of this drag, restored verbatim.
       *
       * A node can be dragged more than once, and `MoveSet` keeps the *original*
       * position across all of them while its destination fields track the
       * latest drop. Re-deriving either from the DOM after an undo is not
       * possible — the destination is recorded as resolved element contexts, not
       * as live nodes — so both sides are captured at drag time instead.
       * `null` means the node was not tracked as moved, which is the state a
       * first drag comes from and the state its undo must return to.
       */
      prev: MoveRecord | null;
      next: MoveRecord;
    }
  | {
      /**
       * A delete or a duplicate. One kind rather than the `insert`/`remove` pair
       * it replaces, because `StructureRecord.op` already says which, and the
       * two used to differ only in a DOM call that `StructureSet` owns anyway.
       */
      kind: "structure";
      record: StructureRecord;
    }
  | {
      kind: "text";
      node: Element;
      element: ElementContext;
      source: SourceLocation | null;
      from: string;
      to: string;
    }
  | {
      kind: "attr";
      node: Element;
      element: ElementContext;
      source: SourceLocation | null;
      attribute: string;
      from: string | null;
      to: string | null;
    }
  | {
      /**
       * Anything that happens to one pending style declaration: a value edit, a
       * disable toggle, a delete, a token binding, a detach.
       *
       * One kind for all of them, holding the whole `Change` on each side rather
       * than the `(property, from, to)` a value edit would need. Three reasons,
       * and each was a bug before:
       *
       * - **Redo could not re-create.** Undoing back to the original value drops
       *   the declaration entirely, by design — so the redo had nothing to write
       *   into and quietly restored the page without the payload.
       * - **`from` cannot be recomputed.** Rebuilding a declaration through the
       *   ordinary write path reads the current DOM, which the undo has already
       *   stripped the preview from, turning `16px → 24px` into `24px → 24px`.
       * - **Intent is part of the state.** A token binding and a detach live on
       *   the `Change`; replaying only a value silently dropped them.
       *
       * `null` on either side means "no declaration", which is where a first
       * edit comes from and where a delete goes.
       */
      kind: "decl";
      node: Element;
      /** Rebuilding a dropped entry needs its context back; `Change` has none. */
      element: ElementContext;
      source: SourceLocation | null;
      before: Change | null;
      after: Change | null;
    };

/** A single undoable step. Several ops when a drag or a multi-property control
 * produced them together. */
type Step = Op[];

export interface HistoryDeps {
  /**
   * Put one op into effect, DOM and payload together. See `history-ops.ts`.
   *
   * This used to be a single `applyStyle` callback, with every other op kind
   * enacted by this file reaching straight into the DOM — which is precisely
   * how they came to disagree with the sets.
   */
  apply: (op: Op, direction: Direction) => void;
  /**
   * Either stack moved. For the toolbar's Undo/Redo buttons, which are the only
   * thing here that has to *look* different when the stacks are empty — the
   * keyboard has `when()` and needs no notification.
   */
  onChange?: () => void;
  /** Re-read the panel after a replay — controls hold stale values otherwise. */
  refresh: () => void;
}

const LIMIT = 200;

export class History {
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  /** Non-null while a batch is open; ops accumulate here instead of stacking. */
  private batching: Step | null = null;
  private depth = 0;
  /** True while replaying, so the ops a replay causes are not re-recorded. */
  private replaying = false;

  private readonly deps: HistoryDeps;

  constructor(deps: HistoryDeps) {
    this.deps = deps;
  }

  /**
   * Is a gesture still in progress?
   *
   * For work that is only worth doing once the value has settled. The panel's
   * shape check is the case: it reads computed style, and a scrub writes per
   * pointermove, so running it on every frame would cost a style recalculation
   * for a shape that cannot be final until the drag ends.
   */
  get isBatching(): boolean {
    return this.depth > 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Group everything recorded inside into one undo step.
   *
   * Nestable, because a drag can span a control that itself batches — only the
   * outermost `batch` closes the step.
   */
  batch<T>(fn: () => T): T {
    this.depth += 1;
    this.batching ??= [];
    try {
      return fn();
    } finally {
      this.depth -= 1;
      if (this.depth === 0) {
        const step = this.batching ?? [];
        this.batching = null;
        if (step.length) {
          this.commit(step);
        }
      }
    }
  }

  /** Open a batch without a callback — for drags, which span two events. */
  open(): void {
    this.depth += 1;
    this.batching ??= [];
  }

  close(): void {
    if (this.depth === 0) {
      return;
    }
    this.depth -= 1;
    if (this.depth === 0) {
      const step = this.batching ?? [];
      this.batching = null;
      if (step.length) {
        this.commit(step);
      }
    }
  }

  push(op: Op): void {
    if (this.replaying) {
      return;
    }
    if (this.batching) {
      this.batching.push(op);
      return;
    }
    this.commit([op]);
  }

  private commit(step: Step): void {
    this.undoStack.push(step);
    if (this.undoStack.length > LIMIT) {
      this.undoStack.shift();
    }
    // Any new edit forks the timeline; the redo branch is unreachable.
    this.redoStack.length = 0;
    this.deps.onChange?.();
  }

  /**
   * Replay one step backwards. Returns false when the stack was empty.
   *
   * A boolean rather than a toast from in here, because the two callers want
   * different answers to the same non-event: a disabled toolbar button should
   * say nothing at all on a click it cannot receive, while ⌘Z on an empty stack
   * has no disabled state to explain itself with and should. `History` is a
   * model whose only contact with the outside is `HistoryDeps` — `apply` and
   * `refresh` are injected precisely so it never learns what a panel or a
   * chrome layer is — and reaching for the toast module would undo that on the
   * first line.
   */
  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) {
      return false;
    }
    /*
     * `finally`, because a throwing op used to disable undo for the whole session.
     *
     * `replaying` suppresses re-recording the ops a replay causes, and `push` returns
     * early while it is set. It was cleared on the line *after* the loop, so one op that
     * threw — `history-ops.ts` does `node.textContent = …` and `parent.insertBefore`,
     * both of which can throw on a node whose parent changed under HMR — left the flag
     * set forever: every later edit was silently not journalled, and ⌘Z stopped working
     * with nothing surfaced to say why.
     */
    this.replaying = true;
    try {
      // Reverse order: the ops in a step were applied forwards, so undoing them
      // backwards is the only order that survives interdependence (an insert
      // followed by a style on the inserted node).
      for (const op of [...step].reverse()) {
        this.deps.apply(op, "undo");
      }
    } finally {
      this.replaying = false;
    }
    this.redoStack.push(step);
    this.deps.refresh();
    this.deps.onChange?.();
    return true;
  }

  /** Replay one step forwards. Returns false when the stack was empty. */
  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) {
      return false;
    }
    // See `undo` — `finally` so a throwing op cannot latch `replaying` on.
    this.replaying = true;
    try {
      for (const op of step) {
        this.deps.apply(op, "redo");
      }
    } finally {
      this.replaying = false;
    }
    this.undoStack.push(step);
    this.deps.refresh();
    this.deps.onChange?.();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batching = null;
    this.depth = 0;
    this.deps.onChange?.();
  }
}
