/*
 * Reading a position back out of CSS.
 *
 * Small enough to have lived at the bottom of `panel.ts`, and wrong to leave
 * there: `renderPosition` and the panel's own arrow-key `nudge` both need them,
 * and a helper two modules use is a module.
 */
import { readValue } from "../style-model";

const RUN_OF_WHITESPACE = /\s+/;

export function parseTranslate(value: string): { x: number; y: number } {
  if (!value || value === "none") {
    return { x: 0, y: 0 };
  }
  const parts = value.split(RUN_OF_WHITESPACE).map((p) => Number.parseFloat(p));
  return { x: parts[0] || 0, y: parts[1] || 0 };
}

/** One resolved inset in px. `auto` reads as zero, which is what it lays out as. */
export function insetOf(node: Element, side: string): number {
  const n = Number.parseFloat(readValue(node, side));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * The element's rotation in degrees.
 *
 * The standalone `rotate` property is the one this panel writes, because it
 * composes with `translate` instead of fighting it. But plenty of apps style
 * their elements with `transform: rotate(30deg)`, and reading only `rotate`
 * reported those as 0 — so the next nudge of the dial *added* a second rotation
 * on top of the first and the element jumped 30 degrees.
 *
 * The fallback reads the angle back out of the computed matrix. `matrix(a, b,
 * ...)` is a rotation composed with a scale, and `atan2(b, a)` recovers the
 * angle from the first column regardless of uniform scaling.
 */
export function readRotation(node: Element): number {
  const own = readValue(node, "rotate");
  if (own && own !== "none") {
    const n = Number.parseFloat(own);
    if (!Number.isNaN(n)) {
      return Math.round(n * 100) / 100;
    }
  }
  const transform = readValue(node, "transform");
  if (!transform || transform === "none") {
    return 0;
  }
  const nums = transform
    .slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"))
    .split(",")
    .map((p) => Number.parseFloat(p));
  if (nums.length < 4 || Number.isNaN(nums[0]) || Number.isNaN(nums[1])) {
    return 0;
  }
  const deg = (Math.atan2(nums[1], nums[0]) * 180) / Math.PI;
  // Normalised to (−180, 180]: 350° and −10° are the same rotation, and the
  // dial should show whichever is the shorter way round.
  return Math.round(deg * 100) / 100;
}
