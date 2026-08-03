/*
 * The constraints widget, and the `position` control it belongs to.
 *
 * Two deliberate departures from a literal port:
 *
 * **The widget is drawn in CSS, not inlined as 25 SVGs.** The imported set ships
 * `constraints-1.svg` through `constraints-25.svg` — every combination of
 * horizontal and vertical anchor as a separate glyph, ~20 KB in total. But it is
 * two independent three-state choices, so it composes: a frame at the set's own
 * 0.3 tone with anchors at 0.9, exactly the two-tone grammar the imported icons
 * use. Cheaper, and it can animate between states.
 *
 * **"Make absolute" measures first.** Setting `position: absolute` on a flow
 * element normally makes it jump to wherever its offset parent's origin is,
 * which is a terrible first impression for a button whose whole purpose is to
 * unlock precise positioning. Measuring the current rect against the offset
 * parent and writing that as the initial inset costs ~20 lines and means the
 * element does not move at all.
 */
import { round } from "../num";
import { computedStyle, ownerWindow } from "../realm";
import { splitWords } from "./css-value";
import { declaredValue } from "./sizing";

export type Anchor = "start" | "center" | "end" | "stretch" | "scale";
export type Axis = "h" | "v";

interface Decl {
  property: string;
  value: string;
}

const SIDES: Record<Axis, [string, string]> = {
  h: ["left", "right"],
  v: ["top", "bottom"],
};

/** Is this node positioned such that insets mean anything? */
export function isPositioned(node: Element): boolean {
  const p = computedStyle(node).position;
  return p === "absolute" || p === "fixed";
}

/**
 * The element's coordinates inside its offset parent — the design-tool X and Y.
 *
 * The single definition of "where is this thing", used by the Position fields,
 * by `pinInPlace` and by `currentInset`. They used to measure independently and
 * they did not agree, which is a 1px jump waiting to happen the first time you
 * pin a child of a bordered parent.
 *
 * `offsetLeft`/`offsetTop` rather than subtracting two client rects, for two
 * reasons that both bite:
 *
 * 1. `getBoundingClientRect()` on a **rotated** element returns the axis-aligned
 *    bounding box of the rotated shape, not the layer box. X and Y would then
 *    drift as you turn the rotation dial, which is not what a design tool reports and
 *    not what anyone means by "where is it".
 * 2. `offsetLeft` is already relative to `offsetParent`'s padding box, which is
 *    the coordinate space `left`/`top` are resolved in. The rect subtraction is
 *    relative to its *border* box, so the two differ by the parent's border
 *    width — small, silent, and wrong.
 *
 * SVG and other non-HTML elements have no `offsetLeft`, so they fall back to
 * the rect subtraction. It is the less correct measure, but it is the only one
 * available and the error is a border width.
 *
 * Canvas zoom does not enter into it. The world transform lives on an element
 * in the *shell* document (`canvas/viewport.ts`) and a frame is a same-origin
 * iframe inside it — an ancestor's transform in the parent document does not
 * scale the child document's own coordinate system. Both measures here are
 * taken inside the node's document, so they are real CSS pixels at every zoom
 * level, which is the same reason the frames are iframes and not scaled
 * screenshots.
 */
export function measureXY(node: Element): { x: number; y: number } {
  const html = node as HTMLElement;
  if (typeof html.offsetLeft === "number") {
    return { x: html.offsetLeft, y: html.offsetTop };
  }
  const rect = node.getBoundingClientRect();
  const base = html.offsetParent?.getBoundingClientRect();
  return base
    ? { x: rect.left - base.left, y: rect.top - base.top }
    : { x: rect.left, y: rect.top };
}

/*
 * The anchor is editor-local state, not something read back out of CSS.
 *
 * Inferring it from the declarations was the original design and it does not
 * survive contact with the rest of the panel. Two reasons, both real:
 *
 * 1. **Computed insets are resolved.** Every browser turns `left: 50%` into a
 *    pixel value in `getComputedStyle`, so the `=== "50%"` test for `center`
 *    essentially never matched — an element the user had explicitly centred
 *    read back as `start` the next time the widget rendered.
 * 2. **The delta writer overwrites the evidence.** Nudging X on a positioned
 *    element writes `left: 312px`. If `scale` is inferred from an inline `%`,
 *    that one edit silently demotes a scaling constraint to a fixed one, and
 *    nothing on screen says so.
 *
 * So the choice is remembered where it was made. `readAnchor` still sniffs the
 * CSS the first time it sees an element — that is the only way to give a node
 * the editor did not create a sensible starting anchor — and from then on the
 * map is the answer. It is per-session, like `ChangeSet` and the panel's own
 * `locked` and `expanded` sets, and a reload discards it along with everything
 * else that has not been applied.
 */
const ANCHORS = new WeakMap<Element, Partial<Record<Axis, Anchor>>>();

/** The current anchor for one axis: remembered if set, else inferred once. */
export function readAnchor(node: Element, axis: Axis): Anchor {
  const known = ANCHORS.get(node)?.[axis];
  if (known) {
    return known;
  }
  const inferred = inferAnchor(node, axis);
  rememberAnchor(node, axis, inferred);
  return inferred;
}

function rememberAnchor(node: Element, axis: Axis, anchor: Anchor): void {
  const entry = ANCHORS.get(node) ?? {};
  entry[axis] = anchor;
  ANCHORS.set(node, entry);
}

/**
 * First-sight guess, from whatever the element already declares.
 *
 * Every test here is against the **authored** value. The computed inset of a
 * positioned element is its *used* value in px — never `auto` — so asking computed
 * style whether a side is pinned answered "yes" for all four on every absolutely
 * positioned element: the widget lit all four bars, both axes read Stretch, and
 * `moveTo` then took the stretch branch and *resized* the element when you typed an
 * X. The `50%` test below was already written against the inline value for exactly
 * this reason; the `!== "auto"` tests were not.
 *
 * `declaredValue` rather than the inline attribute alone, so a class-positioned
 * element is read as accurately as an inline-styled one.
 */
function inferAnchor(node: Element, axis: Axis): Anchor {
  const [a, b] = SIDES[axis];
  const valueA = declaredValue(node, a);
  const valueB = declaredValue(node, b);
  const hasA = Boolean(valueA) && valueA !== "auto";
  const hasB = Boolean(valueB) && valueB !== "auto";
  if (hasA && hasB) {
    // Both pinned: a stretch, unless both are percentages, which is a scale.
    return valueA.endsWith("%") && valueB.endsWith("%") ? "scale" : "stretch";
  }
  if (hasA && valueA === "50%") {
    return "center";
  }
  if (hasA) {
    return "start";
  }
  if (hasB) {
    return "end";
  }
  return "start";
}

/**
 * The declarations for an anchor choice.
 *
 * `center` uses `translate` rather than a negative margin so it works without
 * knowing the element's size — and `translate` is already the property the
 * Position section's X/Y fields write, so the two compose instead of fighting.
 */
export function writeAnchor(
  node: Element,
  axis: Axis,
  anchor: Anchor,
  px: number
): Decl[] {
  rememberAnchor(node, axis, anchor);
  const [a, b] = SIDES[axis];
  switch (anchor) {
    case "start":
      return [
        { property: a, value: `${Math.round(px)}px` },
        { property: b, value: "auto" },
      ];
    case "end":
      return [
        { property: b, value: `${Math.round(px)}px` },
        { property: a, value: "auto" },
      ];
    case "center":
      return [
        { property: a, value: "50%" },
        { property: b, value: "auto" },
        // Composed with the other axis, not written over it.
        { property: "translate", value: centerTranslate(node, axis) },
      ];
    case "stretch":
      return [
        { property: a, value: `${Math.round(px)}px` },
        { property: b, value: `${Math.round(px)}px` },
      ];
    default: {
      /*
       * Scale: hold the element's *current* insets, as proportions of the parent.
       *
       * This branch discarded the measured `px` entirely and returned a hardcoded
       * `5%`/`5%`. An absolutely positioned element at `left: 340px; width: 200px`
       * therefore teleported and resized to 90% of its parent the moment Scale was
       * picked — nothing about the control hinted that was what it meant.
       */
      const extent = parentExtent(node, axis);
      if (extent <= 0) {
        return [
          { property: a, value: `${Math.round(px)}px` },
          { property: b, value: `${Math.round(px)}px` },
        ];
      }
      const asPercent = (value: number) =>
        `${round((value / extent) * 100, 2)}%`;
      return [
        { property: a, value: asPercent(px) },
        { property: b, value: asPercent(farInset(node, axis, px, extent)) },
      ];
    }
  }
}

/**
 * The `translate` value that centres this axis without dropping the other one.
 *
 * `translate` is one property holding both axes, and this used to write the whole
 * thing: `-50% 0` for horizontal, `0 -50%` for vertical. So centring an absolute card
 * horizontally and then vertically clobbered the first correction with the second, and
 * the card sat half its width to the right of centre. It also wiped the `translate`
 * that `position.ts`'s `moveTo` and the panel's nudge use for in-flow offsets.
 *
 * Read, then compose: whichever axis is not being centred keeps whatever it had.
 */
function centerTranslate(node: Element, axis: Axis): string {
  const [x = "0", y = "0"] = splitWords(
    declaredValue(node, "translate") || "0 0"
  );
  return axis === "h" ? `-50% ${y}` : `${x} -50%`;
}

/** The containing block's extent along one axis, in the units insets divide up. */
function parentExtent(node: Element, axis: Axis): number {
  const parent = (node as HTMLElement).offsetParent as HTMLElement | null;
  if (parent) {
    return axis === "h" ? parent.clientWidth : parent.clientHeight;
  }
  const win = ownerWindow(node);
  if (!win) {
    return 0;
  }
  return axis === "h" ? win.innerWidth : win.innerHeight;
}

/** The far-side inset implied by holding the element's current size in place. */
function farInset(
  node: Element,
  axis: Axis,
  near: number,
  extent: number
): number {
  const html = node as HTMLElement;
  const size =
    (axis === "h" ? html.offsetWidth : html.offsetHeight) ||
    (axis === "h"
      ? node.getBoundingClientRect().width
      : node.getBoundingClientRect().height);
  return Math.max(0, extent - near - size);
}

/**
 * Pin the element where it already is, then take it out of flow.
 *
 * This used to be a "Make absolute" button sitting directly under a dropdown
 * that already offered Absolute — two controls for one decision, and the
 * dropdown was the worse of the two because picking Absolute from it wrote a
 * bare `position: absolute` and let the element snap to its offset parent's
 * origin. The measurement belongs to the choice, not to a second button beside
 * it, so it moved here and the button is gone.
 *
 * The containing block differs by mode, and getting this wrong is exactly the
 * jump the function exists to prevent:
 *
 * - `absolute` resolves against the nearest positioned ancestor — `offsetParent`
 *   — or the initial containing block when there is none.
 * - `fixed` resolves against the **viewport**, so its insets are the element's
 *   client rect as-is. Measuring it against `offsetParent` would offset it by
 *   the parent's position on every pin.
 *
 * The one case deliberately not handled: an ancestor carrying `transform`,
 * `filter` or `will-change` becomes the containing block for `fixed`
 * descendants, so a fixed pin inside one lands relative to that ancestor
 * instead of the viewport. Detecting it means walking every ancestor's computed
 * style on a click, and the overlay's own canvas is the main place it happens —
 * where the frame is a separate document and the transform is outside it.
 */
export function pinInPlace(
  node: Element,
  mode: "absolute" | "fixed" = "absolute"
): Decl[] {
  const rect = node.getBoundingClientRect();
  const { x, y } =
    mode === "fixed" ? { x: rect.left, y: rect.top } : measureXY(node);
  return [
    { property: "position", value: mode },
    { property: "left", value: `${Math.round(x)}px` },
    { property: "top", value: `${Math.round(y)}px` },
    { property: "width", value: `${Math.round(rect.width)}px` },
    { property: "height", value: `${Math.round(rect.height)}px` },
  ];
}

/**
 * Release a pin: put the insets back to `auto` so the element returns to flow
 * where the document puts it.
 *
 * Without this, going Absolute → Static leaves `left: 340px` behind, which on a
 * `relative` element visibly shifts it and on a `static` one lies dormant until
 * something later makes it positioned. `width`/`height` stay — they mean the
 * same thing in flow, and dropping them would resize the element on a mode
 * switch, which is the same class of surprise in the other direction.
 */
export function releasePin(): Decl[] {
  return [
    { property: "left", value: "auto" },
    { property: "top", value: "auto" },
    { property: "right", value: "auto" },
    { property: "bottom", value: "auto" },
  ];
}

/**
 * The inset to preserve when switching anchors, in px from the chosen side.
 *
 * The `start` case is `measureXY` — same number, same definition. `end` is the
 * only one that needs the parent's size as well, because it measures from the
 * far edge inwards.
 */
export function currentInset(
  node: Element,
  axis: Axis,
  anchor: Anchor
): number {
  const { x, y } = measureXY(node);
  if (anchor !== "end") {
    return axis === "h" ? x : y;
  }
  const parent = (node as HTMLElement).offsetParent as HTMLElement | null;
  if (!parent) {
    /*
     * No offset box — an SVG child, or a `display: none` ancestor.
     *
     * The old fallback returned `rect.left` here, which is a **viewport** coordinate
     * being handed back as an inset from the element's *right* edge: an absolutely
     * positioned `<svg>` at x=340 inside a card got `right: 340px` and jumped clean out
     * of it. `offsetWidth` is also `undefined` on those nodes, so the parent branch
     * below would have produced `NaNpx` anyway.
     *
     * Measured against the viewport instead, which is the containing block when there
     * is no positioned ancestor, and is at least the right *kind* of number.
     */
    const win = ownerWindow(node);
    const rect = node.getBoundingClientRect();
    if (!win) {
      return axis === "h" ? rect.left : rect.top;
    }
    return axis === "h"
      ? Math.max(0, win.innerWidth - rect.right)
      : Math.max(0, win.innerHeight - rect.bottom);
  }
  // clientWidth/Height is the padding box, which is the space `left`/`right`
  // divide up — the same box `offsetLeft` is measured in, so the two subtract
  // cleanly. `getBoundingClientRect().width` would be the border box and would
  // leave the border counted twice.
  return axis === "h"
    ? parent.clientWidth - x - (node as HTMLElement).offsetWidth
    : parent.clientHeight - y - (node as HTMLElement).offsetHeight;
}
