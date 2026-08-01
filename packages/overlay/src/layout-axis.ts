import type { Rect } from "./canvas/space";

/**
 * Which way a run of children is laid out, read from where they ended up.
 *
 * Measured rather than declared, and that is the point. `flex-direction` answers
 * this for a flex container and for nothing else — a grid, a row of
 * inline-blocks, a set of floats and a table row all lay out horizontally
 * without any property saying so, and each of them would be read as a column by
 * a CSS-first check. The rects cannot be wrong about it.
 *
 * The test is overlap on the cross axis: two children sharing more than half
 * their height are side by side. Half rather than any overlap, because a single
 * pixel of shared band happens all the time between stacked items with rounded
 * or overflowing content.
 *
 * A run of fewer than two children is a column, which is also the right answer
 * for anything that wraps to one item per line.
 */
export function isRowLayout(rects: readonly Rect[]): boolean {
  for (let i = 1; i < rects.length; i += 1) {
    const a = rects[i - 1];
    const b = rects[i];
    const overlap =
      Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    if (overlap > Math.min(a.height, b.height) * 0.5) {
      return true;
    }
  }
  return false;
}
