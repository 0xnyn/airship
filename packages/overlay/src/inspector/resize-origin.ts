/**
 * Holding the far edge still while a resize grip drags the near one.
 *
 * Dragging the west handle should move the element's left edge and leave its
 * right edge exactly where it was — that is what a resize grip means everywhere,
 * and it is what our own frame grips already do (`canvas/frame-chrome.ts`). The
 * element grips did not: they turned every drag into a width or height write, so
 * a west drag grew the element rightwards and the side under the pointer stayed
 * put. (The obvious reference implementation has the identical defect, for the
 * identical reason — worth knowing before treating it as the authority here.)
 *
 * Width alone cannot express it. Which edge stays depends on what is holding the
 * element in place, and there are three answers:
 *
 * - **Anchored by the near side** (`left` / `top` authored): the far edge only
 *   holds if the near inset moves with the drag.
 * - **Anchored by the far side** (`right` / `bottom`): the far edge is already
 *   pinned, so a *near*-side drag needs nothing at all — but a *far*-side drag
 *   needs the inset, or growing the element pushes the near edge instead.
 * - **In normal flow**: there is no inset to move, so the offset goes on
 *   `translate` — the same property `moveTo` and the panel's arrow-key `nudge`
 *   write, so all three compose rather than fighting over the same pixels.
 *
 * This module is the arithmetic only: edge deltas in, declarations out. The
 * reading of the element is one function, `readOrigin`, latched once at drag
 * start — re-reading mid-drag would fold each frame's own write back into the
 * next frame's baseline and accelerate the element off the screen.
 */
import {
  type Anchor,
  type Axis,
  isPositioned,
  readAnchor,
} from "./constraints";
import { insetOf, parseTranslate } from "./sections/measure";
import { readValue } from "./style-model";

/** One axis of the element's positioning, as it stood when the drag began. */
interface AxisOrigin {
  anchor: Anchor;
  /** The far inset (`right` / `bottom`) in px. */
  far: number;
  /** The near inset (`left` / `top`) in px. */
  near: number;
}

/** Everything about how an element is held in place, latched at drag start. */
export interface OriginStart {
  h: AxisOrigin;
  positioned: boolean;
  translate: { x: number; y: number };
  v: AxisOrigin;
}

/**
 * How far each edge moved over the gesture, in the element's own CSS pixels.
 *
 * Signed in screen terms: positive `left` means the left edge moved right.
 * Derived from the *final* box rather than the raw pointer delta, so a
 * Shift-constrained drag reports the edges the aspect lock actually produced.
 */
export interface EdgeShift {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface OriginResult {
  /** Property → value, ready to hand to the same recorder a panel edit uses. */
  decls: Record<string, string>;
  /**
   * Axes whose size must *not* be written after all.
   *
   * A stretched element is pinned to both edges, so its size is a consequence of
   * its insets. Writing `width` as well would over-constrain the box — and in a
   * left-to-right document the browser resolves that by dropping `right`, which
   * silently unpins the element and leaves the Constraints widget describing
   * something that is no longer true.
   */
  skipHeight: boolean;
  skipWidth: boolean;
}

/** Read how an element is held in place. Call once, at drag start. */
export function readOrigin(node: Element): OriginStart {
  return {
    h: axisOrigin(node, "h"),
    positioned: isPositioned(node),
    translate: parseTranslate(readValue(node, "translate")),
    v: axisOrigin(node, "v"),
  };
}

function axisOrigin(node: Element, axis: Axis): AxisOrigin {
  const [near, far] = axis === "h" ? ["left", "right"] : ["top", "bottom"];
  return {
    anchor: readAnchor(node, axis),
    far: insetOf(node, far),
    near: insetOf(node, near),
  };
}

/**
 * The declarations that keep the undragged edges where they are.
 *
 * Returns an empty result — today's size-only behaviour — for the two anchors
 * where "hold the opposite edge" has no unambiguous answer. A `center` element
 * is positioned by its middle, so both edges move when it resizes and neither
 * one is the one being held; a `scale` element's insets are percentages, and
 * writing a px inset onto it would quietly convert it to a fixed offset and
 * destroy the constraint the user chose. In both cases the honest thing is to
 * leave the constraint alone: it is changed in the Constraints widget, which is
 * what that widget is for, not as a side effect of dragging a handle.
 */
export function originDecls(
  start: OriginStart,
  shift: EdgeShift
): OriginResult {
  if (!start.positioned) {
    return flowDecls(start, shift);
  }
  const h = axisDecls(start.h, "h", shift.left, shift.right);
  const v = axisDecls(start.v, "v", shift.top, shift.bottom);
  return {
    decls: { ...h.decls, ...v.decls },
    skipHeight: v.skip,
    skipWidth: h.skip,
  };
}

/**
 * In normal flow there is no inset to move, so the offset goes on `translate`.
 *
 * Resolved for both axes at once, unlike the positioned case, because
 * `translate` is a *single* declaration carrying an x and a y. Computing the two
 * axes independently and merging the results writes one of them and then
 * overwrites it with the other — which silently loses half of every corner drag.
 */
function flowDecls(start: OriginStart, shift: EdgeShift): OriginResult {
  // Only the near edges need anything: a far-edge drag moves the far edge by
  // growing the box, which is what the size write already does.
  if (shift.left === 0 && shift.top === 0) {
    return { decls: {}, skipHeight: false, skipWidth: false };
  }
  const x = round(start.translate.x + shift.left);
  const y = round(start.translate.y + shift.top);
  return {
    decls: { translate: `${x}px ${y}px` },
    skipHeight: false,
    skipWidth: false,
  };
}

function axisDecls(
  origin: AxisOrigin,
  axis: Axis,
  nearShift: number,
  farShift: number
): { decls: Record<string, string>; skip: boolean } {
  const [nearSide, farSide] =
    axis === "h" ? ["left", "right"] : ["top", "bottom"];

  if (origin.anchor === "stretch") {
    // Pinned both sides: the inset on the dragged side *is* the resize, and the
    // size write has to stand down (see `skipWidth`).
    if (nearShift !== 0) {
      return {
        decls: { [nearSide]: px(origin.near + nearShift) },
        skip: true,
      };
    }
    if (farShift !== 0) {
      return { decls: { [farSide]: px(origin.far - farShift) }, skip: true };
    }
    return { decls: {}, skip: false };
  }

  if (origin.anchor === "start") {
    // The far edge holds only if the near inset moves with the drag; a far-edge
    // drag is already handled by the size write.
    return nearShift === 0
      ? { decls: {}, skip: false }
      : { decls: { [nearSide]: px(origin.near + nearShift) }, skip: false };
  }

  if (origin.anchor === "end") {
    // The mirror image: the near edge is held by the far inset for free, but a
    // far-edge drag has to move that inset or the box grows out of the near side
    // instead of following the pointer.
    return farShift === 0
      ? { decls: {}, skip: false }
      : { decls: { [farSide]: px(origin.far - farShift) }, skip: false };
  }

  return { decls: {}, skip: false };
}

function px(n: number): string {
  return `${round(n)}px`;
}

function round(n: number): number {
  return Math.round(n);
}
