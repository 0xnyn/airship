/*
 * The two numeric helpers the overlay kept re-deriving.
 *
 * There were six `clamp`s across the codebase and two of them disagreed —
 * `app.ts`'s rounded its result and `popover.ts`'s did not — so "clamp" meant
 * two things depending on which file you were in. These are the shared,
 * unsurprising definitions; the domain-specific ones (`clampScale`,
 * `clampWidth`) keep their own names because they are not clamps in general,
 * they are one bound with a meaning.
 */

/**
 * Constrain a number to a range. Either bound may be absent, which is what a
 * CSS field usually wants: `min: 0` on a padding with no upper limit at all.
 *
 * A non-finite input is returned untouched rather than silently becoming a
 * bound — `Math.min(100, Infinity)` is 100, and a field that turns a typo into
 * its own maximum is worse than one that rejects it. Callers reject first.
 */
export function clamp(n: number, min?: number, max?: number): number {
  if (!Number.isFinite(n)) {
    return n;
  }
  let v = n;
  if (min !== undefined) {
    v = Math.max(min, v);
  }
  if (max !== undefined) {
    v = Math.min(max, v);
  }
  return v;
}

/** Constrain to 0–1, the range every alpha and progress value lives in. */
export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Default precision for a CSS number: enough for a scaled length, not noise. */
const DEFAULT_PLACES = 3;

/**
 * Round to a fixed number of decimal places.
 *
 * `Math.round(n * 1000) / 1000` inline, which is what this was in three places,
 * quietly reintroduces the float error it exists to remove once the multiplier
 * overflows — and there was no shared answer for how many places a CSS value
 * deserves.
 */
export function round(n: number, places = DEFAULT_PLACES): number {
  if (!Number.isFinite(n)) {
    return n;
  }
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}
