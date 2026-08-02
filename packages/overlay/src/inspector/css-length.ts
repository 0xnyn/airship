/*
 * The one grammar for a CSS length, and the words a given property accepts
 * in place of one.
 *
 * There were three implementations of "parse a length" and they agreed on
 * nothing that mattered:
 *
 * - `num-field.ts` took the longest numeric prefix and re-attached whichever
 *   unit the field defaulted to, so a typed `50%` came back `50px` the next
 *   time the field lost focus, and a half-typed `12r` committed verbatim.
 * - `css-box-model.ts` matched `/^-?[\d.]+$/` and returned *everything else
 *   unchanged*, so `abc`, `1.2.3px` and a bare `-` all reached the agent.
 * - `tokens/match.ts` had the only correct one — unit-aware, realm-aware — and
 *   nothing outside the token matcher ever called it.
 *
 * The rules here are deliberately conservative in one direction only: a value
 * this module rejects is never written, and a value it accepts is one the
 * browser will accept for that property. It knows nothing about controls, the
 * change set or the DOM beyond the realm lookup `toPx` needs, so every rule
 * below is a table-driven test rather than a thing you have to click to check.
 */
import { round } from "../num";
import { computedStyle, ownerDocument, ownerWindow } from "../realm";

/** Units a length field offers. Deliberately not every unit CSS has — `ch`,
 * `ex` and `cap` are legal and nobody types them into a visual editor, and each
 * extra entry is one more way for a prefix test to accept a typo. */
export const LENGTH_UNITS = ["px", "%", "em", "rem", "vw", "vh"] as const;

/** Angle units, for rotation and gradient direction. */
export const ANGLE_UNITS = ["deg", "rad", "turn"] as const;

/**
 * Valid on every property, so never worth listing per-property.
 *
 * These are the reason a blanket keyword list looked defensible for so long:
 * `inherit` really is legal on `font-size`. `auto` is not, and the old shared
 * list ran the two together.
 */
const GLOBAL_KEYWORDS = ["inherit", "initial", "revert", "unset"] as const;

const SIZE_KEYWORDS = ["auto", "fit-content", "max-content", "min-content"];
const MAX_SIZE_KEYWORDS = ["fit-content", "max-content", "min-content", "none"];

/** Physical and logical sides, the shape most box properties repeat. */
const SIDES = ["top", "right", "bottom", "left"];

function forEachSide(prefix: string, suffix = ""): string[] {
  const tail = suffix ? `-${suffix}` : "";
  return SIDES.map((side) => `${prefix}-${side}${tail}`);
}

function entries(
  properties: readonly string[],
  keywords: readonly string[]
): [string, readonly string[]][] {
  return properties.map((property) => [property, keywords]);
}

/**
 * The words each property takes in place of a number.
 *
 * Absent means "numbers only" — which is the right answer for padding, radius
 * and opacity, and was not what they were being offered.
 */
const PROPERTY_KEYWORDS = new Map<string, readonly string[]>([
  ...entries(["width", "height", "inline-size", "block-size"], SIZE_KEYWORDS),
  ...entries(
    ["min-width", "min-height", "min-inline-size", "min-block-size"],
    SIZE_KEYWORDS
  ),
  ...entries(
    ["max-width", "max-height", "max-inline-size", "max-block-size"],
    MAX_SIZE_KEYWORDS
  ),
  ...entries(["margin", ...forEachSide("margin")], ["auto"]),
  ...entries(["inset", ...SIDES], ["auto"]),
  ...entries(["flex-basis"], ["auto", "content", ...SIZE_KEYWORDS]),
  ...entries(["line-height"], ["normal"]),
  ...entries(["letter-spacing", "word-spacing"], ["normal"]),
  ...entries(["gap", "row-gap", "column-gap"], ["normal"]),
  ...entries(["z-index"], ["auto"]),
  ...entries(
    ["border-width", ...forEachSide("border", "width"), "outline-width"],
    ["medium", "thick", "thin"]
  ),
]);

/**
 * Everything this property accepts as a whole word, globals included.
 *
 * Replaces `number-scrub.ts`'s single `LENGTH_KEYWORDS` list, which handed
 * `auto` to every length field in the panel: typing it into a font size was
 * accepted, repainted as though it had worked, and queued for the agent as
 * `font-size: auto`.
 */
export function keywordsFor(property: string): string[] {
  return [...(PROPERTY_KEYWORDS.get(property) ?? []), ...GLOBAL_KEYWORDS];
}

/** A parsed length: a finite number and the unit written after it. */
export interface Length {
  /** `""` for a unitless value — an opacity, a `line-height: 1.5`, a z-index. */
  unit: string;
  value: number;
}

/** A number, optionally signed, with an optional fractional part. Nothing else. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)/;

/** A single comma used where a decimal point belongs: `1,5`, `,5`, `1,`. */
const DECIMAL_COMMA = /^([+-]?\d*),(\d*)$/;

/**
 * Accept the comma a German or French keyboard puts where a decimal point goes.
 *
 * CSS itself only takes `.`, so this normalises rather than widening the grammar — the
 * value written is still `1.5`. Without it the `beforeinput` filter rejected the comma
 * outright: typing `1,5` left the key apparently dead, with nothing to say why, because
 * `isPrefix` saw the tail `","` and matched no unit prefix.
 *
 * Deliberately narrow. Only a *lone* comma between digits is a decimal point; a comma
 * anywhere else in a value is a separator (`rgb(1, 2, 3)`, a font stack, a shadow list)
 * and rewriting one of those would be much worse than refusing it.
 */
function localizedDecimal(text: string): string {
  const match = DECIMAL_COMMA.exec(text);
  return match ? `${match[1]}.${match[2]}` : text;
}

/**
 * Parse `raw` as a length in one of `units`, or return null.
 *
 * Strict where the old parsers were not:
 *
 * - the numeric part must consume cleanly, so `1.2.3` is rejected rather than
 *   read as `1.2` and re-emitted with the stray `.3` glued back on;
 * - the value must be finite, so three hundred nines is rejected instead of
 *   becoming `Infinitypx`;
 * - the trailing unit must be a *complete* member of `units`, so `12r` is
 *   rejected at commit even though the field lets you type it on the way to
 *   `12rem`.
 *
 * A bare number is accepted and reported with `unit: ""`. Whether that is
 * meaningful is the caller's business: an opacity wants it, a width does not
 * and supplies its own default.
 */
export function parseLength(
  raw: string,
  units: readonly string[] = LENGTH_UNITS
): Length | null {
  const text = localizedDecimal(raw.trim());
  const head = NUMBER.exec(text)?.[0];
  if (!head) {
    return null;
  }
  const value = Number.parseFloat(head);
  if (!Number.isFinite(value)) {
    return null;
  }
  // Deliberately not trimmed: `text` already is, so any space left between the
  // number and the unit is one the user typed, and `10 px` is not a length.
  const unit = text.slice(head.length);
  if (unit === "") {
    return { unit: "", value };
  }
  const matched = matchUnit(unit, units);
  return matched === null ? null : { unit: matched, value };
}

/**
 * The canonically-cased spelling of a unit the user typed, or null when it is
 * not one of `units`. Case-insensitive, as CSS is.
 */
function matchUnit(tail: string, units: readonly string[]): string | null {
  const lower = tail.toLowerCase();
  return units.find((u) => u.toLowerCase() === lower) ?? null;
}

/** Is `tail` a complete unit from `units`? */
export function isUnit(tail: string, units: readonly string[]): boolean {
  return matchUnit(tail, units) !== null;
}

/**
 * Could `raw` still *become* something legal?
 *
 * The distinction this module exists to draw. You cannot type `1.5` without
 * passing through `1`, or `rem` without passing through `r` — so the filter
 * that runs on every keystroke has to accept prefixes, and the check that runs
 * on commit must not. Sharing one predicate between them is what let `12r`
 * through: it was a legal way-point, and nothing asked again at the end.
 */
export function isPrefix(
  raw: string,
  units: readonly string[],
  keywords: readonly string[] = []
): boolean {
  const text = localizedDecimal(raw.trim());
  if (text === "") {
    return true;
  }
  const lower = text.toLowerCase();
  if (keywords.some((k) => k.toLowerCase().startsWith(lower))) {
    return true;
  }
  const head = NUMBER.exec(text)?.[0] ?? "";
  const tail = text.slice(head.length).toLowerCase();
  if (!head) {
    // "-" and "." on their own are legal way-points to "-5" and ".5"; a lone
    // "+" is not, because nobody types one.
    return text === "-" || text === ".";
  }
  if (!tail) {
    return true;
  }
  return units.some((u) => u.toLowerCase().startsWith(tail));
}

/** Serialise a parsed length back to CSS. */
export function formatLength(length: Length): string {
  return `${length.value}${length.unit}`;
}

// ---------------------------------------------------------------------------
// Resolving to pixels
// ---------------------------------------------------------------------------

/** The CSS initial value, and the fallback whenever a root cannot be measured. */
const DEFAULT_ROOT_FONT_SIZE = 16;

/**
 * A length in px, or null if it is not a comparable length.
 *
 * The unit conversion is the part a bare `parseFloat` gets wrong: a `1rem`
 * token never matches a computed `16px` — which is every token in a rem-based
 * design system, against every computed value the browser reports. Resolving
 * both to px is what makes the token matcher work at all.
 *
 * Lived in `tokens/match.ts`, where it was the repo's only correct length
 * parser and the only one the inspector never called.
 */
export function toPx(value: string, node?: Element): number | null {
  const parsed = parseLength(value, ["px", "rem", "em"]);
  if (!parsed) {
    return null;
  }
  switch (parsed.unit) {
    case "":
      // A bare number is a length only where it was written as one; the token
      // matcher compares it against unitless token values.
      return parsed.value;
    case "px":
      return parsed.value;
    case "rem":
      return parsed.value * rootFontSize(node);
    case "em":
      return parsed.value * elementFontSize(node);
    default:
      return null;
  }
}

/**
 * A px measurement expressed in the unit the value was *authored* in.
 *
 * The panel seeds every length control from `getComputedStyle`, which is always px.
 * So `.hero { padding: 2rem }` showed `32`, and one arrow key wrote
 * `padding-left: 33px` — the `rem` gone, and the agent told to hardcode a pixel value
 * into a scale-based design system. `width: 50%` read `660px`, and a single nudge
 * turned a fluid column into a fixed one.
 *
 * `toPx` is the forward direction; this is the inverse that was missing. `null` means
 * the conversion cannot be done faithfully, and the caller should keep px:
 *
 * - `%` depends on which property it is (a percentage width resolves against the
 *   containing block, a percentage `line-height` against the font size), so it is not
 *   invertible from a length alone. Handled by `relativeTo` instead, which the caller
 *   supplies when it knows the basis.
 * - `vw`/`vh`/`ch`/`ex` and friends need a viewport or font metric this does not take.
 *
 * Rounded to four places, because the point is to keep `2rem` readable as `2.0625rem`
 * rather than to be exact to the float.
 */
export function fromPx(
  px: number,
  unit: string,
  node?: Element,
  relativeTo?: number
): string | null {
  if (!Number.isFinite(px)) {
    return null;
  }
  const basis = basisFor(unit, node, relativeTo);
  if (basis === null || basis === 0) {
    return null;
  }
  return formatLength({ unit, value: round(px / basis, 4) });
}

/** How many px one of `unit` is worth here, or null when that is unknowable. */
function basisFor(
  unit: string,
  node?: Element,
  relativeTo?: number
): number | null {
  switch (unit) {
    case "":
    case "px":
      return 1;
    case "rem":
      return rootFontSize(node);
    case "em":
      return elementFontSize(node);
    case "%":
      // Only when the caller knows what the percentage is *of*.
      return relativeTo === undefined ? null : relativeTo / 100;
    default:
      return null;
  }
}

/**
 * The root font size of the node's own realm, for rem conversion.
 *
 * A node's realm matters: a frame can set its own root size, and measuring
 * against the shell's would convert every rem in that frame incorrectly. With
 * no node — comparing two authored values — the globals are used when they
 * exist, and 16 when they do not.
 */
function rootFontSize(node?: Element): number {
  const doc = node ? ownerDocument(node) : globalThis.document;
  const win = node ? ownerWindow(node) : globalThis.window;
  const root = doc?.documentElement;
  if (!(root && win)) {
    return DEFAULT_ROOT_FONT_SIZE;
  }
  const size = Number.parseFloat(win.getComputedStyle(root).fontSize);
  return Number.isFinite(size) ? size : DEFAULT_ROOT_FONT_SIZE;
}

function elementFontSize(node?: Element): number {
  if (!node) {
    return rootFontSize();
  }
  const size = Number.parseFloat(computedStyle(node).fontSize);
  return Number.isFinite(size) ? size : rootFontSize(node);
}
