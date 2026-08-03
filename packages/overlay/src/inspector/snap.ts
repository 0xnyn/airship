/**
 * Snapping a resize to the things already on the page.
 *
 * Two kinds of match, because they answer two different questions:
 *
 * - **Edge**: the edge being dragged lines up with a sibling's edge or centre,
 *   or with the inside of the parent. This is alignment, and it is what the red
 *   guides draw.
 * - **Size**: the element ends up exactly as wide as a sibling, or exactly as
 *   wide as the space it sits in. The second of those is worth more than the
 *   first — landing on the parent's content width is how "make this fill the
 *   row" gets expressed, and it deserves to be written as `fill` rather than as
 *   whatever pixel number happened to be under the pointer that day.
 *
 * Both are per axis and independent, which is what lets a corner drag snap its
 * width to a sibling while its height snaps to the parent.
 *
 * **The tolerance is a screen distance, converted in.** Everything here works in
 * the surface's own pixels, because that is what the rects and the values being
 * written are in — but "close enough to snap" is a fact about the pointer, not
 * about the document. Five surface pixels is a fifth of a screen pixel at 10%
 * zoom, which never triggers, and twenty screen pixels at 400%, which never lets
 * go. Callers divide by `surface.scale`; see `SNAP_SCREEN_PX`.
 *
 * Pure arithmetic over rects and numbers, with one thin DOM read
 * (`contentRect`) kept at the edge so the rest can be tested without a layout
 * engine.
 */
import type { Rect } from "../canvas/space";
import { computedStyle } from "../realm";

/**
 * How close the pointer has to get, in **screen** pixels.
 *
 * Five is the figure every editor converges on. Below about four a snap feels
 * like it is being withheld; above about seven the element stops going where it
 * is put.
 */
export const SNAP_SCREEN_PX = 5;

/** Where a candidate came from, which decides how strongly it is preferred. */
export type SnapSource = "parent" | "sibling";

export interface SnapTarget {
  /** True for a centre line rather than an edge. */
  center: boolean;
  /** The rect this came from, so a guide can mark the edges that matched. */
  rect: Rect;
  source: SnapSource;
  /** The coordinate (edge target) or length (size target), in surface px. */
  value: number;
}

export interface SnapMatch {
  /** How far the value had to move to land on the target. */
  correction: number;
  kind: "edge" | "size";
  target: SnapTarget;
}

export interface AxisSnapResult {
  /**
   * True when the size landed on the parent's content extent.
   *
   * Surfaced separately because it is not just a number: it is the moment to
   * write `fill` instead of a pixel length, which keeps the element responsive
   * instead of freezing it at whatever the container happened to be.
   */
  fill: boolean;
  /** What matched, if anything — the guide overlay's input. */
  match: SnapMatch | null;
  /** The size to use, in surface px. */
  size: number;
}

/**
 * The parent's content box, in the same space `getBoundingClientRect` reports.
 *
 * Border *and* padding are subtracted, unlike the measurement overlay's parent
 * mode, which stops at the padding box. The difference is what the number is
 * for: measurement answers "how big is the gap you can see", and padding is part
 * of that gap; snapping answers "how wide can this child be", and padding is not
 * available to it.
 */
export function contentRect(node: Element): Rect {
  const r = node.getBoundingClientRect();
  const style = computedStyle(node);
  const num = (property: string): number =>
    Number.parseFloat(style.getPropertyValue(property)) || 0;
  const left = num("border-left-width") + num("padding-left");
  const right = num("border-right-width") + num("padding-right");
  const top = num("border-top-width") + num("padding-top");
  const bottom = num("border-bottom-width") + num("padding-bottom");
  return {
    height: Math.max(0, r.height - top - bottom),
    left: r.left + left,
    top: r.top + top,
    width: Math.max(0, r.width - left - right),
  };
}

/**
 * Coordinates the dragged edge can land on: three per reference rect.
 *
 * Near edge, far edge and centre — nine pairings against the dragged element's
 * own three, which is what makes "align its left with that one's centre" a snap
 * the user never has to ask for.
 */
export function edgeTargets(
  parentContent: Rect,
  siblings: readonly Rect[],
  horizontal: boolean
): SnapTarget[] {
  const out: SnapTarget[] = [];
  push(out, parentContent, "parent", horizontal);
  for (const rect of siblings) {
    push(out, rect, "sibling", horizontal);
  }
  return out;
}

function push(
  out: SnapTarget[],
  rect: Rect,
  source: SnapSource,
  horizontal: boolean
): void {
  const near = horizontal ? rect.left : rect.top;
  const extent = horizontal ? rect.width : rect.height;
  out.push({ center: false, rect, source, value: near });
  out.push({ center: false, rect, source, value: near + extent });
  out.push({ center: true, rect, source, value: near + extent / 2 });
}

/** Lengths the element can land on: the parent's content extent, and each sibling's. */
export function sizeTargets(
  parentContent: Rect,
  siblings: readonly Rect[],
  horizontal: boolean
): SnapTarget[] {
  const extent = (r: Rect): number => (horizontal ? r.width : r.height);
  const out: SnapTarget[] = [
    {
      center: false,
      rect: parentContent,
      source: "parent",
      value: extent(parentContent),
    },
  ];
  for (const rect of siblings) {
    out.push({ center: false, rect, source: "sibling", value: extent(rect) });
  }
  return out;
}

/**
 * The closest target within `threshold`, or null.
 *
 * A linear scan. The reference implementation sorts and binary-searches, which
 * is the right instinct at a different scale — over the few dozen candidates a
 * real container produces, the sort costs more than the scan it saves, and the
 * scan cannot get the boundary conditions wrong.
 *
 * Ties go to the parent. Landing on the container is almost always what was
 * meant when a sibling happens to share that coordinate, and it is the match
 * that can be written as `fill`.
 */
export function nearest(
  value: number,
  targets: readonly SnapTarget[],
  threshold: number
): SnapTarget | null {
  let best: SnapTarget | null = null;
  // Not seeded with `threshold`: a candidate sitting *exactly* on it is inside
  // the tolerance and has to be able to win, and seeding it there meant the
  // first such candidate could only tie with the bound and be discarded.
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const distance = Math.abs(target.value - value);
    if (distance > threshold) {
      continue;
    }
    const closer = distance < bestDistance;
    const parentBreaksTie =
      distance === bestDistance &&
      best?.source === "sibling" &&
      target.source === "parent";
    if (closer || parentBreaksTie) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export interface AxisSnapSpec {
  /** The edge that is *not* moving, in surface px. */
  anchor: number;
  edges: readonly SnapTarget[];
  /** True when the moving edge is on the far side of the anchor (e/s grips). */
  forward: boolean;
  /** The size the drag asked for, before snapping. */
  size: number;
  sizes: readonly SnapTarget[];
  /** Tolerance in **surface** px — i.e. already divided by the canvas scale. */
  threshold: number;
}

/**
 * Snap one axis of a resize, preferring whichever match moves the element less.
 *
 * Both kinds are tried because they disagree usefully. Matching a sibling's
 * width and aligning with a sibling's edge are different intentions, and
 * which one is meant is answered by which one the pointer is closer to — not by
 * a mode, and not by a priority order that would make one of them unreachable
 * whenever the other happened to be in range.
 */
export function snapAxis(spec: AxisSnapSpec): AxisSnapResult {
  const { anchor, forward, size, threshold } = spec;
  if (threshold <= 0) {
    return { fill: false, match: null, size };
  }

  const movingEdge = forward ? anchor + size : anchor - size;
  const edge = nearest(movingEdge, spec.edges, threshold);
  const sized = nearest(size, spec.sizes, threshold);

  const edgeCorrection = edge
    ? Math.abs(edge.value - movingEdge)
    : Number.POSITIVE_INFINITY;
  const sizeCorrection = sized
    ? Math.abs(sized.value - size)
    : Number.POSITIVE_INFINITY;

  let match: SnapMatch | null = null;
  let snapped = size;
  if (edge && edgeCorrection <= sizeCorrection) {
    match = { correction: edgeCorrection, kind: "edge", target: edge };
    snapped = Math.max(1, Math.abs(edge.value - anchor));
  } else if (sized) {
    match = { correction: sizeCorrection, kind: "size", target: sized };
    snapped = Math.max(1, sized.value);
  }

  return { fill: isFill(snapped, spec.sizes), match, size: snapped };
}

/**
 * Did the element end up exactly filling its parent's content box?
 *
 * Asked of the *result*, not of which rule produced it. Dragging the right edge
 * of a left-aligned child onto the container's right edge is an edge match, and
 * matching the container's width is a size match, but they are the same
 * intention arrived at from two directions and they produce the same number.
 * Deciding from the winning branch made one of them a fill and the other a
 * frozen pixel width, which is a difference the user did nothing to ask for.
 */
function isFill(size: number, sizes: readonly SnapTarget[]): boolean {
  for (const target of sizes) {
    if (target.source === "parent" && Math.abs(target.value - size) < 0.5) {
      return true;
    }
  }
  return false;
}
