import type {
  ElementContext,
  SourceLocation,
  StructuralEdit,
  StructuralOp,
  TextEditTarget,
} from "@airship/protocol";

/**
 * Accumulates direct-manipulation *structure* changes — deletes, duplicates and
 * in-place text edits — alongside {@link ChangeSet} (style) and {@link MoveSet}
 * (position).
 *
 * Modelled on `MoveSet` on purpose, down to the method names: `discard()` in the
 * panel and `reconcileVisual()` in the app each pick up a new edit set with two
 * lines rather than a new branch, and the three sets can be reasoned about as
 * one thing.
 *
 * As with the other two, the DOM is changed immediately as a live preview and
 * the agent is told afterwards, so it is catching the source up to a page the
 * user is already looking at.
 */

export interface StructureRecord {
  element: ElementContext;
  node: Element;
  op: StructuralOp;
  /** Where it was, so Discard can put it back (delete) or remove it (duplicate). */
  origNext: Node | null;
  origParent: Element;
  source: SourceLocation | null;
}

export interface TextRecord {
  element: ElementContext;
  /** The text before the *first* edit, so repeated edits still revert fully. */
  from: string;
  node: Element;
  source: SourceLocation | null;
  to: string;
}

export class StructureSet {
  private readonly structure = new Map<Element, StructureRecord>();
  private readonly text = new Map<Element, TextRecord>();

  record(rec: StructureRecord): void {
    this.structure.set(rec.node, rec);
  }

  /**
   * Record a text change. The `from` is kept from the first edit, so typing,
   * blurring and typing again still reverts to the original string — and a node
   * edited back to exactly what it said drops out of the set rather than
   * shipping a no-op to the agent.
   */
  recordText(rec: TextRecord): void {
    const existing = this.text.get(rec.node);
    const from = existing?.from ?? rec.from;
    if (from === rec.to) {
      this.text.delete(rec.node);
      return;
    }
    this.text.set(rec.node, { ...rec, from });
  }

  count(): number {
    return this.structure.size + this.text.size;
  }

  /** Every tracked delete/duplicate — one composer chip per entry. */
  entries(): StructureRecord[] {
    return [...this.structure.values()];
  }

  /** Every tracked text edit — one composer chip per entry. */
  textEntries(): TextRecord[] {
    return [...this.text.values()];
  }

  /** Undo one delete/duplicate and forget it (one chip's ✕). */
  remove(node: Element): void {
    const entry = this.structure.get(node);
    if (!entry) {
      return;
    }
    this.undoStructure(entry);
    this.structure.delete(node);
  }

  /** Restore one node's original string and forget it (one chip's ✕). */
  removeText(node: Element): void {
    const entry = this.text.get(node);
    if (!entry) {
      return;
    }
    this.undoText(entry);
    this.text.delete(node);
  }

  /**
   * Redo a delete or a duplicate: perform it on the DOM and track it again.
   *
   * The exact inverse of `remove`, which is the undo. Both live here because the
   * DOM operation a `StructuralOp` implies is this set's own knowledge —
   * `History` used to carry a second copy of it and, having no way to reach the
   * set, updated only the page. Undoing a delete put the element back on screen
   * and left the agent still being told to remove it.
   */
  reapply(rec: StructureRecord): void {
    if (rec.op === "delete") {
      rec.node.remove();
    } else if (rec.origParent.isConnected) {
      const ref =
        rec.origNext && rec.origNext.parentNode === rec.origParent
          ? rec.origNext
          : null;
      // A duplicate sits immediately after the node it was cloned from, which
      // is what `origNext` points at.
      rec.origParent.insertBefore(rec.node, ref);
    }
    this.record(rec);
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  targets(): StructuralEdit[] {
    return [...this.structure.values()].map((e) => ({
      element: e.element,
      op: e.op,
      source: e.source,
    }));
  }

  /**
   * `skip` drops a node without forgetting it — see `ChangeSet.targets`. Retyping
   * the label on an element the same turn asks the agent to delete is two
   * contradictory instructions.
   */
  textTargets(skip?: (node: Element) => boolean): TextEditTarget[] {
    return [...this.text.values()]
      .filter((e) => !skip?.(e.node))
      .map((e) => ({
        element: e.element,
        from: e.from,
        source: e.source,
        to: e.to,
      }));
  }

  /**
   * The nodes this turn will delete, so other sets can decline to also edit them.
   *
   * Roots, not a flat node list: a delete takes its whole subtree with it, so a
   * style change on a descendant is just as contradictory as one on the element
   * itself. Callers test with `contains`.
   */
  deletedRoots(): Element[] {
    const out: Element[] = [];
    for (const e of this.structure.values()) {
      if (e.op === "delete") {
        out.push(e.node);
      }
    }
    return out;
  }

  /** Undo every structural change and restore every original string. */
  restore(): void {
    for (const e of this.structure.values()) {
      this.undoStructure(e);
    }
    for (const e of this.text.values()) {
      this.undoText(e);
    }
  }

  /** Undo one delete (re-insert) or duplicate (drop the clone). */
  private undoStructure(e: StructureRecord): void {
    if (e.op !== "delete") {
      // A duplicate is undone by removing the clone, which *is* `node`.
      e.node.remove();
      return;
    }
    if (!e.origParent.isConnected) {
      return;
    }
    const ref =
      e.origNext && e.origNext.parentNode === e.origParent ? e.origNext : null;
    e.origParent.insertBefore(e.node, ref);
  }

  private undoText(e: TextRecord): void {
    if (e.node.isConnected) {
      e.node.textContent = e.from;
    }
  }

  clear(): void {
    this.structure.clear();
    this.text.clear();
  }
}
