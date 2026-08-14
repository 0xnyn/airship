/**
 * CSS gradients: parse, edit, serialize.
 *
 * The governing rule is **lossless round-tripping**. `paint.ts` argues, and is
 * right, that a text field holding `linear-gradient(...)` is strictly more
 * capable than a two-stop picker — so the editor this feeds is *additive*, and
 * anything it cannot fully model must survive being opened and closed.
 *
 * That rules out the shortcut of parsing into a lossy struct and re-emitting
 * from it. Instead everything the grammar allows is kept: the shape and extent
 * of a radial, its `at` position, colour hints, double-position stops, angles in
 * whatever unit they were written. `parseGradient` returns null rather than
 * guess when it meets something it does not understand, and the caller leaves
 * the original string alone.
 *
 * A naive equivalent discards radial shape and position, rejects `repeating-*`,
 * rounds every stop to a whole percent, and mishandles `turn`, `rad` and
 * negative angles — all of which are silent data loss on save.
 */
import { formatColor, parseColor, splitTop, splitWords } from "./css-value";

export type GradientKind = "linear" | "radial" | "conic";

export interface GradientStop {
  color: string;
  /**
   * Position as authored, with its unit (`50%`, `2rem`). Empty when the stop
   * carried none and the browser distributes it.
   */
  position: string;
  /** A double-position stop (`red 20% 40%`) — a hard colour band. */
  positionEnd?: string;
}

export interface Gradient {
  /**
   * `linear`/`conic`: the angle as authored (`45deg`, `0.25turn`, `to right`).
   * `radial`: the shape/extent/position prefix (`circle at 30% 40%`).
   * Empty when the gradient omitted it.
   */
  geometry: string;
  kind: GradientKind;
  repeating: boolean;
  stops: GradientStop[];
}

const GRADIENT_FN =
  /^(repeating-)?(linear|radial|conic)-gradient\s*\(([\s\S]*)\)$/i;
/** A leading geometry clause: `45deg`, `to right`, `circle at 50% 50%`, `from 0deg`. */
const GEOMETRY =
  /^\s*(to\s+[a-z\s]+|from\s+[-\d.]+(?:deg|rad|grad|turn)|[-\d.]+(?:deg|rad|grad|turn)|(?:circle|ellipse)[^,]*|at\s+[^,]+|closest-\w+|farthest-\w+)\s*$/i;
const LENGTH_OR_PERCENT = /^[-\d.]+(%|px|r?em|v[hw]|ch|ex|pt|cm|mm|in|pc)$/i;
const ANGLE = /^([-\d.]+)(deg|rad|grad|turn)$/i;
/** A conic gradient writes its angle as `from <angle>`. */
const FROM_KEYWORD = /^from\s+/;
/** A stop position already expressed as a percentage. */
const PERCENT_POSITION = /^([-\d.]+)%$/;

/** `to bottom` and friends, in degrees. */
const SIDE_ANGLES: Record<string, number> = {
  "to bottom": 180,
  "to bottom left": 225,
  "to bottom right": 135,
  "to left": 270,
  "to left bottom": 225,
  "to left top": 315,
  "to right": 90,
  "to right bottom": 135,
  "to right top": 45,
  "to top": 0,
  "to top left": 315,
  "to top right": 45,
};

/** Is this value a gradient of any kind, including the repeating variants? */
export function isGradient(value: string): boolean {
  return GRADIENT_FN.test(value.trim());
}

/**
 * Parse one gradient function. Null when it is not a gradient, or when the stop
 * list does not survive parsing — in which case the caller keeps the original
 * text rather than replacing it with a worse approximation.
 */
export function parseGradient(css: string): Gradient | null {
  const match = GRADIENT_FN.exec(css.trim());
  if (!match) {
    return null;
  }
  const [, repeating, rawKind, inner] = match;
  const parts = splitTop(inner);
  if (parts.length === 0) {
    return null;
  }

  let geometry = "";
  if (GEOMETRY.test(parts[0])) {
    geometry = parts[0].trim();
    parts.shift();
  }

  const stops = parts
    .map(parseStop)
    .filter((s): s is GradientStop => s !== null);
  // A gradient needs two colours to be one. Anything less means the parse went
  // wrong, and returning it would let the editor destroy the original.
  if (stops.length < 2) {
    return null;
  }

  return {
    geometry,
    kind: rawKind.toLowerCase() as GradientKind,
    repeating: Boolean(repeating),
    stops,
  };
}

/**
 * One `<color> <position>? <position>?` stop.
 *
 * A bare position with no colour is a *colour hint* — a midpoint marker, not a
 * stop. Those are dropped, which is the one deliberate lossy step here: the
 * editor has no way to show them, and keeping them would mean re-emitting a
 * hint between two stops the user may have since reordered.
 */
function parseStop(text: string): GradientStop | null {
  const words = splitWords(text.trim());
  if (words.length === 0) {
    return null;
  }
  /*
   * A part that is *only* positions is a colour hint, and is dropped.
   *
   * The docstring above has always said so; the code did not do it. The
   * `colorWords.length > 0` guard means a leading position has nothing before it to be
   * a position *of*, so it fell into `colorWords` — and `parseStop` returned a stop
   * whose colour was `"30%"`. `linear-gradient(red, 30%, blue)` therefore opened as a
   * three-row list with an unparseable middle swatch rendering as `#000000`, and editing
   * anything turned a midpoint marker into a black band.
   */
  if (words.every((word) => LENGTH_OR_PERCENT.test(word))) {
    return null;
  }
  const positions: string[] = [];
  const colorWords: string[] = [];
  for (const word of words) {
    if (LENGTH_OR_PERCENT.test(word) && colorWords.length > 0) {
      positions.push(word);
    } else {
      colorWords.push(word);
    }
  }
  const color = colorWords.join(" ");
  if (!color) {
    return null;
  }
  return {
    color,
    position: positions[0] ?? "",
    positionEnd: positions[1],
  };
}

/**
 * Serialise a gradient, stops in ascending rendered order.
 *
 * CSS clamps any stop whose position is below its predecessor, so authored order *is*
 * semantics — and `onAdd` appends to the end of the list. Clicking the middle of a
 * two-stop bar therefore emitted `linear-gradient(#fff 0%, #ccc 100%, <mix> 50%)`, where
 * the new stop is clamped to 100% and renders as a hard edge. `barCss` already sorted, so
 * the editor's own preview bar showed the gradient the user asked for while the page
 * showed a different one, with nothing on screen to say they disagreed.
 *
 * `sortedStops` rather than a local sort, so this, the preview bar and the bar's
 * hit-testing all order stops by the same `stopFraction` — including the implicit
 * positions of stops that declare none.
 */
export function formatGradient(gradient: Gradient): string {
  const parts: string[] = [];
  if (gradient.geometry) {
    parts.push(gradient.geometry);
  }
  for (const stop of sortedStops(gradient)) {
    parts.push(
      [stop.color, stop.position, stop.positionEnd].filter(Boolean).join(" ")
    );
  }
  const prefix = gradient.repeating ? "repeating-" : "";
  return `${prefix}${gradient.kind}-gradient(${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

/**
 * The gradient's angle in degrees, for the angle field.
 *
 * Understands every unit CSS allows plus the `to <side>` keywords, and
 * normalizes to 0–360. Radial gradients have no angle; conic ones write theirs
 * as `from <angle>`.
 */
export function angleOf(gradient: Gradient): number | null {
  if (gradient.kind === "radial") {
    return null;
  }
  const geometry = gradient.geometry.trim().toLowerCase();
  if (!geometry) {
    // CSS defaults: a linear gradient runs top-to-bottom, a conic from 0.
    return gradient.kind === "linear" ? 180 : 0;
  }
  const side = SIDE_ANGLES[geometry.replace(/\s+/g, " ")];
  if (side !== undefined) {
    return side;
  }
  const angle = ANGLE.exec(geometry.replace(FROM_KEYWORD, ""));
  if (!angle) {
    return null;
  }
  const [, magnitude, unit] = angle;
  return normalizeAngle(toDegrees(Number.parseFloat(magnitude), unit));
}

function toDegrees(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case "rad":
      return (value * 180) / Math.PI;
    case "grad":
      return value * 0.9;
    case "turn":
      return value * 360;
    default:
      return value;
  }
}

export function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Write a new angle, preserving the `from` keyword a conic gradient needs. */
export function withAngle(gradient: Gradient, degrees: number): Gradient {
  const value = `${normalizeAngle(degrees)}deg`;
  return {
    ...gradient,
    geometry: gradient.kind === "conic" ? `from ${value}` : value,
  };
}

// ---------------------------------------------------------------------------
// Stop editing
// ---------------------------------------------------------------------------

/** A stop's position as a 0–1 fraction, for the stop bar. */
export function stopFraction(
  stop: GradientStop,
  index: number,
  total: number
): number {
  const percent = PERCENT_POSITION.exec(stop.position.trim());
  if (percent) {
    return Math.min(1, Math.max(0, Number.parseFloat(percent[1]) / 100));
  }
  // No position, or one in a unit with no percentage equivalent: fall back to
  // the even distribution the browser itself would apply.
  return total <= 1 ? 0 : index / (total - 1);
}

/** Sort by rendered position without disturbing equal-positioned stops. */
export function sortedStops(gradient: Gradient): GradientStop[] {
  return gradient.stops
    .map((stop, index) => ({
      key: stopFraction(stop, index, gradient.stops.length),
      stop,
    }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.stop);
}

/**
 * Linear RGB interpolation, for the colour of a stop added by clicking.
 *
 * `node` names the realm the stop colours resolve against — a stop can be
 * `var(--brand)`, and a probe run in the wrong document answers about the wrong
 * custom property. See `parseColor`.
 */
export function interpolate(
  gradient: Gradient,
  fraction: number,
  node?: Element | null
): string {
  const { stops } = gradient;
  let [before] = stops;
  let after = stops.at(-1) as GradientStop;
  let beforeAt = 0;
  let afterAt = 1;
  stops.forEach((stop, i) => {
    const at = stopFraction(stop, i, stops.length);
    if (at <= fraction) {
      before = stop;
      beforeAt = at;
    }
    if (at >= fraction && afterAt === 1) {
      after = stop;
      afterAt = at;
    }
  });
  const span = afterAt - beforeAt;
  const t = span > 0 ? (fraction - beforeAt) / span : 0;
  return mix(before.color, after.color, t, node);
}

/**
 * Mix two colours. The nearer one wins only when a stop is genuinely unreadable.
 *
 * This used to carry its own `HEX` regex and `hexToRgb`, accepting three- and
 * six-digit hex and nothing else — a second, weaker colour parser living one
 * directory away from the real one. Everything it could not read fell into the
 * "nearer one wins" branch, and that branch is silent: clicking the gradient bar
 * inserted a stop that was an exact copy of one end instead of the blend at the
 * point clicked, with no indication anything had been approximated.
 *
 * What it could not read turned out to be most things. `oklch()` is Tailwind 4's
 * entire default palette, so no Tailwind project's gradients interpolated at
 * all; `rgb()`, `hsl()` and named colours were equally invisible. And because
 * the old serialiser emitted six-digit hex, mixing two `#rrggbbaa` stops threw
 * away both alphas.
 *
 * `parseColor` reads all of those, so the fallback now means what it says: a
 * `var()` that does not resolve, or a `currentColor` with no element to resolve
 * against. Alpha is the fourth channel and interpolates with the rest;
 * `formatColor` rounds and clamps, so the fractional results go straight to it.
 */
function mix(a: string, b: string, t: number, node?: Element | null): string {
  const ca = parseColor(a, node);
  const cb = parseColor(b, node);
  if (!(ca && cb)) {
    return t < 0.5 ? a : b;
  }
  const channel = (i: number): number => ca[i] + (cb[i] - ca[i]) * t;
  return formatColor([channel(0), channel(1), channel(2), channel(3)], "rgb");
}

/** A left-to-right preview of the stops, for the editor's bar. */
export function barCss(gradient: Gradient): string {
  const stops = sortedStops(gradient)
    .map(
      (stop, i, all) =>
        `${stop.color} ${Math.round(stopFraction(stop, i, all.length) * 100)}%`
    )
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}

/** Reverse the ramp: every stop's position mirrored, and the order flipped. */
export function reverse(gradient: Gradient): Gradient {
  const total = gradient.stops.length;
  const stops = gradient.stops
    .map((stop, i) => {
      const at = stopFraction(stop, i, total);
      return {
        ...stop,
        position: `${Math.round((1 - at) * 100)}%`,
        positionEnd: undefined,
      };
    })
    .reverse();
  return { ...gradient, stops };
}
