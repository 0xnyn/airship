/**
 * Siblings stepping aside to open a hole where a dragged element will land.
 *
 * This replaces the insertion line for a reorder *within one parent*, and the
 * replacement is the point rather than an optimisation of it. A line between two
 * elements tells you an index; the elements physically moving tell you the
 * result. You stop reading the indicator and start seeing the layout you are
 * about to get, which is the difference between a drop that feels aimed and one
 * that feels guessed. The reference implementation arrived at the same place and
 * left a note where its indicator used to be.
 *
 * The line is not gone — it still does the job it is good at, which is showing
 * an insertion point in a container the element is not currently in. See
 * `reorder.ts`.
 *
 * Two details carry the whole effect.
 *
 * **The step is the space the element occupies, not the space it fills.** Those
 * differ by the flex or grid gap, and using the height alone leaves every
 * sibling short by exactly one gap — close enough to look like a rounding bug
 * and far enough to look wrong. Measuring the distance between two adjacent
 * siblings' leading edges folds the gap in without having to parse it.
 *
 * **The transition is killed before the transforms are removed**, not after.
 * They are removed at the moment the real `insertBefore` happens, so leaving the
 * transition on animates every sibling from its shifted position back to a
 * resting place that is now somewhere else — the layout lands correctly and then
 * visibly slides, which reads as the drop bouncing.
 */
import type { Rect } from "../canvas/space";
import { isRowLayout } from "../layout-axis";
import { DISPLACING_CLASS } from "../styles/portable.css";

/**
 * How much room a sibling gives up when the dragged element leaves.
 *
 * Measured leading-edge to leading-edge against the next sibling, which includes
 * whatever gap sits between them. The last child has no next sibling, so it
 * falls back to its own extent plus the gap behind it — the same distance,
 * arrived at from the other side.
 *
 * Returns 0 for a single child, where there is nothing to displace anyway.
 */
export function occupiedSpan(
  rects: readonly Rect[],
  index: number,
  horizontal: boolean
): number {
  const near = (r: Rect): number => (horizontal ? r.left : r.top);
  const extent = (r: Rect): number => (horizontal ? r.width : r.height);
  const self = rects[index];
  if (!self) {
    return 0;
  }
  const next = rects[index + 1];
  if (next) {
    return near(next) - near(self);
  }
  const prev = rects[index - 1];
  if (!prev) {
    return 0;
  }
  const gap = near(self) - (near(prev) + extent(prev));
  return extent(self) + Math.max(0, gap);
}

/**
 * How far each sibling moves, by index, for a drop before `dropIndex`.
 *
 * `dropIndex` is expressed in the *current* child order, the one the element is
 * still sitting in — so dropping at its own index, or at the one immediately
 * after it, are both no-ops and everything between the two positions shifts by
 * one place. The dragged element itself always gets 0: it is hidden, and the
 * ghost is what shows where it has gone.
 *
 * `dropIndex === count` means "after the last child".
 */
export function shifts(
  count: number,
  dragIndex: number,
  dropIndex: number,
  span: number
): number[] {
  const out = new Array<number>(count).fill(0);
  if (span === 0 || dropIndex === dragIndex || dropIndex === dragIndex + 1) {
    return out;
  }
  if (dropIndex < dragIndex) {
    // Moving earlier: everything from the drop point up to the element's old
    // slot slides one place later to make room.
    for (let i = dropIndex; i < dragIndex; i += 1) {
      out[i] = span;
    }
    return out;
  }
  // Moving later: everything between the old slot and the drop point closes up.
  for (let i = dragIndex + 1; i < dropIndex; i += 1) {
    out[i] = -span;
  }
  return out;
}

/**
 * Drive the shift on the live nodes.
 *
 * Separate from the arithmetic above so the arithmetic stays testable without a
 * DOM, and so this half can be read for what it actually is: a very small amount
 * of state whose only job is to be undone correctly.
 */
export class SiblingDisplacer {
  private nodes: HTMLElement[] = [];
  private rects: Rect[] = [];
  private dragIndex = -1;
  private horizontal = false;
  private span = 0;
  /** The last applied vector, so an unchanged target costs no style writes. */
  private applied: number[] = [];
  /**
   * Each displaced sibling's own inline `transform`/`transition`, so teardown restores
   * rather than deletes. See `end`.
   */
  private savedInline = new WeakMap<
    Element,
    Record<string, { priority: string; value: string } | null>
  >();
  /**
   * Watches for the host app re-rendering mid-drag.
   *
   * A React reconcile replaces or re-writes the nodes we have transformed, which
   * would either strand a transform on an element after the drag or drop ours on
   * the floor. Either way the honest response is to stop displacing rather than
   * to fight the framework for the same attribute.
   */
  private observer: MutationObserver | null = null;

  get isActive(): boolean {
    return this.nodes.length > 0;
  }

  /**
   * Snapshot the parent's children and arm the transition.
   *
   * Measured once. The whole point is that the rects stop being true the moment
   * anything shifts, so re-measuring mid-drag would compound each frame's own
   * displacement into the next frame's baseline.
   */
  begin(node: Element, parent: Element, siblings: Element[]): void {
    this.end();
    const index = siblings.indexOf(node);
    if (index === -1 || siblings.length < 2) {
      return;
    }
    this.nodes = siblings as HTMLElement[];
    this.rects = siblings.map(rectOf);
    this.dragIndex = index;
    this.horizontal = isRowLayout(this.rects);
    this.span = occupiedSpan(this.rects, index, this.horizontal);
    this.applied = new Array<number>(siblings.length).fill(0);
    this.savedInline = new WeakMap();
    for (const sibling of this.nodes) {
      // Snapshot before the first write — see `end`, which restores these.
      this.savedInline.set(sibling, {
        transform: inlineEntry(sibling, "transform"),
        transition: inlineEntry(sibling, "transition"),
      });
      sibling.classList.add(DISPLACING_CLASS);
    }
    this.watch(parent);
  }

  /**
   * Move the siblings for a drop before child `dropIndex`; `null` puts them back.
   *
   * Called from the collision handler rather than from `dragmove`, because that
   * is where the drop index is resolved — and resolving it twice, in two places,
   * is how an indicator and an outcome end up disagreeing.
   */
  update(dropIndex: number | null): void {
    if (!this.isActive) {
      return;
    }
    const next =
      dropIndex === null
        ? new Array<number>(this.nodes.length).fill(0)
        : shifts(this.nodes.length, this.dragIndex, dropIndex, this.span);
    for (const [i, node] of this.nodes.entries()) {
      if (next[i] === this.applied[i]) {
        continue;
      }
      node.style.transform = offsetOf(next[i], this.horizontal);
    }
    this.applied = next;
  }

  /** Put every sibling back, without animating the return. */
  end(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const node of this.nodes) {
      // Order matters: the transition has to be off *before* the transform goes,
      // or the reset animates from the shifted position to a resting place that
      // the imminent DOM move is about to change anyway.
      node.classList.remove(DISPLACING_CLASS);
      node.style.transition = "none";
      node.style.removeProperty("transform");
      node.style.removeProperty("transition");
      /*
       * Put back what the app had inline, rather than leaving it deleted.
       *
       * `begin` snapshots rects and nothing else, and these two `removeProperty` calls
       * were unconditional — so reordering a child inside a list animated by Framer
       * Motion or GSAP stripped every sibling's own inline `transform` and `transition`.
       * Those libraries write their state there, so the layout jumped and stayed jumped.
       */
      const saved = this.savedInline.get(node);
      if (saved) {
        for (const [property, entry] of Object.entries(saved)) {
          if (entry) {
            node.style.setProperty(property, entry.value, entry.priority);
          }
        }
      }
    }
    this.savedInline = new WeakMap();
    this.nodes = [];
    this.rects = [];
    this.applied = [];
    this.dragIndex = -1;
    this.span = 0;
  }

  private watch(parent: Element): void {
    const win = parent.ownerDocument?.defaultView;
    if (!win?.MutationObserver) {
      return;
    }
    this.observer = new win.MutationObserver(() => this.end());
    this.observer.observe(parent, { childList: true });
  }
}

function rectOf(node: Element): Rect {
  const r = node.getBoundingClientRect();
  return { height: r.height, left: r.left, top: r.top, width: r.width };
}

function offsetOf(distance: number, horizontal: boolean): string {
  if (distance === 0) {
    return "";
  }
  return horizontal ? `translateX(${distance}px)` : `translateY(${distance}px)`;
}

/** One inline declaration as it stands, or null when the element does not set it. */
function inlineEntry(
  node: HTMLElement,
  property: string
): { priority: string; value: string } | null {
  const value = node.style.getPropertyValue(property);
  return value
    ? { priority: node.style.getPropertyPriority(property), value }
    : null;
}
