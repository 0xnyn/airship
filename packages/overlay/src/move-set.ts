import type {
  ElementContext,
  MoveEdit,
  SourceLocation,
} from "@airship/protocol";

export interface MoveRecord {
  /** The anchor it now renders before; null ⇒ appended as last child. */
  before: ElementContext | null;
  beforeSource: SourceLocation | null;
  /** Moved element context/source (captured pre-move from the selection). */
  element: ElementContext;
  /** Resolved destination context (null when unresolved). */
  newParent: ElementContext | null;
  newParentSource: SourceLocation | null;
  node: Element;
  origNext: Node | null;
  /** Parent + next-sibling *before* the first drag, so Discard can restore. */
  origParent: Element;
  source: SourceLocation | null;
  toIndex: number;
}

type Entry = MoveRecord;

/**
 * Accumulates the direct-manipulation structural moves made in the design
 * inspector (drag-to-reposition), keyed by the live DOM node. The DOM is
 * repositioned immediately as a live preview; on Apply the overlay ships
 * {@link targets} and the agent relocates the element's JSX. Parallels
 * {@link ChangeSet}, but for tree structure rather than style deltas.
 */
export class MoveSet {
  private readonly map = new Map<Element, Entry>();

  /**
   * Record a completed move. The *original* position is kept from the first time
   * a node is seen (so repeated drags still restore to the true origin); the
   * destination fields always reflect the latest drop. A node dragged back to
   * exactly where it started drops out of the set.
   */
  record(rec: MoveRecord): void {
    const existing = this.map.get(rec.node);
    const origParent = existing?.origParent ?? rec.origParent;
    const origNext = existing ? existing.origNext : rec.origNext;

    if (
      rec.node.parentElement === origParent &&
      rec.node.nextSibling === origNext
    ) {
      this.map.delete(rec.node);
      return;
    }

    this.map.set(rec.node, { ...rec, origNext, origParent });
  }

  count(): number {
    return this.map.size;
  }

  /** Every tracked move — the composer renders one chip per entry. */
  entries(): MoveRecord[] {
    return [...this.map.values()];
  }

  /** Drop one move, putting just that node back (one chip's ✕). */
  remove(node: Element): void {
    const entry = this.map.get(node);
    if (!entry) {
      return;
    }
    this.restoreOne(entry);
    this.map.delete(node);
  }

  /** The tracked move for a node, if any — read before a drag so undo has a
   * state to return to. */
  get(node: Element): MoveRecord | undefined {
    return this.map.get(node);
  }

  /**
   * Put the bookkeeping for one node into a known state, without touching the
   * DOM. The undo path's half of a move.
   *
   * Deliberately verbatim rather than derived. `record` recomputes the entry
   * from a live drop — which is right for a drag and impossible for an undo,
   * where the destination the node is returning to was recorded as resolved
   * element contexts and no longer exists as live nodes. `History` owns the DOM
   * side of a move (it has the tolerance for a reference sibling that has since
   * moved); this owns the payload side, and the two are called together.
   */
  restoreEntry(node: Element, entry: MoveRecord | null): void {
    if (entry) {
      this.map.set(node, entry);
    } else {
      this.map.delete(node);
    }
  }

  isEmpty(): boolean {
    return this.map.size === 0;
  }

  nodes(): Element[] {
    return [...this.map.keys()];
  }

  /** The wire payload: one target per moved node. */
  targets(): MoveEdit[] {
    return [...this.map.values()].map((e) => ({
      before: e.before,
      beforeSource: e.beforeSource,
      element: e.element,
      newParent: e.newParent,
      newParentSource: e.newParentSource,
      source: e.source,
      toIndex: e.toIndex,
    }));
  }

  /** Put every moved node back where it started (revert the live DOM). */
  restore(): void {
    for (const e of this.map.values()) {
      this.restoreOne(e);
    }
  }

  /**
   * Put one node back. Shared by `restore` and `remove` so "undo a move" has a
   * single definition — the anchor check matters in both: the sibling we were
   * inserted before may itself have been moved or removed since.
   */
  private restoreOne(e: Entry): void {
    if (!e.origParent.isConnected) {
      return;
    }
    const ref =
      e.origNext && e.origNext.parentNode === e.origParent ? e.origNext : null;
    e.origParent.insertBefore(e.node, ref);
  }

  clear(): void {
    this.map.clear();
  }
}
