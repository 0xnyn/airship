/**
 * Proportional resizing — the one real "lock" in the inspector.
 *
 * Every other paired control here (padding, margin, corners, border widths) is
 * an expand/collapse: collapsed writes all sides at once, expanded writes them
 * separately, and there is no third state. Width and height are different —
 * they are always two fields, and locking changes the *relationship* between
 * them rather than how many there are. Hence a lock rather than a toggle.
 *
 * The ratio is captured when the lock is engaged, not read live. Deriving it
 * from the current box on every keystroke would make it drift: each rounded
 * write feeds the next read, and a few edits later a 16:9 image is 1.7788:1.
 */

import { parseLength } from "./css-length";

/** Ratio (width ÷ height) per element, while its lock is engaged. */
const locked = new WeakMap<Element, number>();

/** Media that has an intrinsic aspect, so proportional is the sane default. */
const INTRINSIC = new Set(["IMG", "VIDEO", "PICTURE", "CANVAS", "SVG"]);

export function isLocked(node: Element): boolean {
  return locked.has(node);
}

export function ratioOf(node: Element): number | undefined {
  return locked.get(node);
}

/**
 * Engage the lock, capturing the element's current proportions.
 *
 * A zero-height element has no ratio to capture, so the lock is refused rather
 * than stored as `Infinity` — which would make the first width edit set the
 * height to zero and the element vanish.
 */
export function lock(node: Element): boolean {
  const rect = node.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) {
    return false;
  }
  locked.set(node, rect.width / rect.height);
  return true;
}

export function unlock(node: Element): void {
  locked.delete(node);
}

export function toggleLock(node: Element): boolean {
  if (locked.has(node)) {
    unlock(node);
    return false;
  }
  return lock(node);
}

/** The other axis's value, in px, for a given edit. Null when not locked. */
export function counterpart(
  node: Element,
  axis: "w" | "h",
  value: string
): string | null {
  const ratio = locked.get(node);
  if (!ratio) {
    return null;
  }
  /*
   * Pixels only, and a bare number read as pixels.
   *
   * The ratio is a ratio of rendered pixels, so there is no arithmetic to do on
   * `auto`, `max-content`, or a percentage of a containing block this function
   * cannot see. `parseFloat` accepted all three — it read `50%` as `50` and set
   * the locked axis from it, which is a number with no relationship to anything
   * on the page.
   */
  const px = parseLength(value, ["px"]);
  if (!px) {
    return null;
  }
  const n = px.value;
  return axis === "w"
    ? `${Math.round(n / ratio)}px`
    : `${Math.round(n * ratio)}px`;
}

/**
 * Should a resize drag hold proportions?
 *
 * Three cases, and the defaults differ because the expectations do:
 *
 * | element                    | Shift up | Shift held      |
 * | -------------------------- | -------- | --------------- |
 * | lock engaged in the panel  | locked   | free            |
 * | img/video/canvas/svg       | locked   | free            |
 * | anything else              | free     | locked, corners |
 *
 * Media is proportional by default because distorting a photo is almost never
 * what someone means; a div is not, because resizing one axis of a container is
 * the common case. Shift inverts whichever default applies, which is the
 * convention every design tool shares.
 *
 * For the free-by-default case the constraint is corners-only: dragging the
 * east edge of a div with Shift held and watching its height change too would
 * be surprising, whereas a corner already implies both axes.
 */
export function shouldConstrain(
  node: Element,
  handle: string,
  shiftKey: boolean
): boolean {
  const isCorner = handle.length === 2;
  const defaultsLocked = locked.has(node) || INTRINSIC.has(node.tagName);
  if (defaultsLocked) {
    return !shiftKey;
  }
  return isCorner && shiftKey;
}

/**
 * Apply the ratio to a drag's raw width/height.
 *
 * On a corner the axis that moved *further* wins, so the box follows the
 * pointer rather than snapping to whichever axis the handle happens to name.
 * On an edge the dragged axis drives and the other follows.
 */
export function constrain(
  width: number,
  height: number,
  ratio: number,
  handle: string
): { height: number; width: number } {
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");

  if (horizontal && vertical) {
    // The axis that moved further wins, so the box follows the pointer.
    //
    // The opposite comparison — taking whichever candidate is *smaller* — also
    // preserves the ratio and is common elsewhere, but it feels broken: drag a
    // corner 200px to the right on a 2:1 box and the element grows by 20px,
    // because the barely-moved vertical axis is the one that got to decide.
    return width / ratio > height
      ? { height: width / ratio, width }
      : { height, width: height * ratio };
  }
  if (horizontal) {
    return { height: width / ratio, width };
  }
  return { height, width: height * ratio };
}
