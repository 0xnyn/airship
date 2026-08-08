/*
 * The pure maths behind the hero's measuring layer.
 *
 * Everything here is a function of numbers in and strings out — no DOM, no
 * refs, no side effects. That split is not tidiness for its own sake: it keeps
 * the effect in hero-stage.tsx down to about forty lines of orchestration.
 */

/** A rectangle, in the coordinate space of whatever measured it. */
export interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * A point expressed as a percentage of a container.
 *
 * The cursor's `left`/`top` are percentages so it keeps its position when the
 * hero is resized between measurements — a pixel offset would be silently wrong
 * for the frame or two before the resize handler catches up.
 */
export function toPercent(
  point: { x: number; y: number },
  container: Rect
): { x: string; y: string } {
  /*
   * Rounded to 3dp — about a thousandth of the stage, far below a device pixel.
   *
   * The precision is not cosmetic. These strings are written to custom
   * properties that live `@keyframes` read, and in Chrome writing such a
   * property restarts the animation. Full float precision meant every resize
   * produced a different string for the same position, so `measureHero` could
   * never tell "nothing moved" from "moved imperceptibly".
   */
  return {
    x: `${(((point.x - container.left) / container.width) * 100).toFixed(3)}%`,
    y: `${(((point.y - container.top) / container.height) * 100).toFixed(3)}%`,
  };
}

/** The centre of a rect, in the same space the rect was measured in. */
export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
