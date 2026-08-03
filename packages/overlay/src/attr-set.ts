import type {
  AttrChange,
  AttrEditTarget,
  ElementContext,
  SourceLocation,
} from "@airship/protocol";

/**
 * Accumulates direct-manipulation *attribute* edits — `alt`, `loading`,
 * `autoplay`, `poster` and the rest of the media controls — alongside
 * {@link ChangeSet} (style), {@link MoveSet} (position) and
 * {@link StructureSet} (delete/duplicate/text).
 *
 * The fifth member of the pending-changes family, and modelled on the other four
 * down to the method names so `discard()` and `reconcileVisual()` in `app.ts`
 * each pick it up in two lines.
 *
 * Attributes are kept out of `ChangeSet` on purpose. A style delta is a
 * declaration the agent writes into a stylesheet or a `className`; an attribute
 * is a JSX prop on the element itself. Describing `alt="A cat"` as
 * `alt: "" → "A cat"` in the style list would ask the agent for something that
 * does not exist.
 *
 * As with the other sets, the DOM is changed immediately as a live preview and
 * the agent is told afterwards, so it is catching the source up to a page the
 * user is already looking at.
 */

export interface AttrRecord {
  attribute: string;
  element: ElementContext;
  /** The value before the *first* edit, so repeated edits still revert fully.
   * `null` means the attribute was absent. */
  from: string | null;
  node: Element;
  source: SourceLocation | null;
  /** `null` means "remove the attribute" — a boolean attribute switched off. */
  to: string | null;
}

/** One node's edits, keyed by attribute name. */
interface NodeEntry {
  attrs: Map<string, AttrRecord>;
  element: ElementContext;
  source: SourceLocation | null;
}

export class AttrSet {
  private readonly map = new Map<Element, NodeEntry>();

  /**
   * Record an attribute edit and apply it to the DOM.
   *
   * `from` is kept from the first edit of that attribute, so toggling a value
   * back to where it started drops it from the set rather than shipping a no-op.
   */
  record(rec: AttrRecord): void {
    let entry = this.map.get(rec.node);
    if (!entry) {
      entry = {
        attrs: new Map(),
        element: rec.element,
        source: rec.source,
      };
      this.map.set(rec.node, entry);
    }
    const existing = entry.attrs.get(rec.attribute);
    const from = existing ? existing.from : rec.from;
    this.write(rec.node, rec.attribute, rec.to);
    if (from === rec.to) {
      entry.attrs.delete(rec.attribute);
      if (entry.attrs.size === 0) {
        this.map.delete(rec.node);
      }
      return;
    }
    entry.attrs.set(rec.attribute, { ...rec, from });
  }

  /** The pending value for an attribute, or `undefined` if untouched. */
  pending(node: Element, attribute: string): string | null | undefined {
    const rec = this.map.get(node)?.attrs.get(attribute);
    return rec ? rec.to : undefined;
  }

  /** Every tracked edit, flattened — the composer renders one chip each. */
  entries(): AttrRecord[] {
    const out: AttrRecord[] = [];
    for (const entry of this.map.values()) {
      out.push(...entry.attrs.values());
    }
    return out;
  }

  /** Revert one attribute to its original and forget it (one chip's ✕). */
  remove(node: Element, attribute: string): void {
    const entry = this.map.get(node);
    const rec = entry?.attrs.get(attribute);
    if (!(entry && rec)) {
      return;
    }
    this.write(node, attribute, rec.from);
    entry.attrs.delete(attribute);
    if (entry.attrs.size === 0) {
      this.map.delete(node);
    }
  }

  count(): number {
    let n = 0;
    for (const entry of this.map.values()) {
      n += entry.attrs.size;
    }
    return n;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  /**
   * The wire payload: one target per edited node.
   *
   * `skip` drops a node without forgetting it — see `ChangeSet.targets`, which
   * takes the same predicate for the same reason: setting an `alt` on an element
   * the same turn asks the agent to delete is two contradictory instructions.
   */
  targets(skip?: (node: Element) => boolean): AttrEditTarget[] {
    const out: AttrEditTarget[] = [];
    // Entries, not values: the node is this map's key rather than a field on
    // `NodeEntry`, and `skip` is asked about the node.
    for (const [node, entry] of this.map) {
      if (skip?.(node)) {
        continue;
      }
      const changes: AttrChange[] = [...entry.attrs.values()].map((r) => ({
        attribute: r.attribute,
        from: r.from,
        to: r.to,
      }));
      if (changes.length) {
        out.push({
          changes,
          element: entry.element,
          source: entry.source,
        });
      }
    }
    return out;
  }

  /** Put every attribute back the way it was (Discard). */
  restore(): void {
    for (const entry of this.map.values()) {
      for (const rec of entry.attrs.values()) {
        this.write(rec.node, rec.attribute, rec.from);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  /** `null` removes; anything else sets. Boolean attributes use `""`. */
  private write(node: Element, attribute: string, value: string | null): void {
    if (value === null) {
      node.removeAttribute(attribute);
      return;
    }
    node.setAttribute(attribute, value);
  }
}
