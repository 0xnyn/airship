/*
 * `font-family` is a *list*, and the panel used to treat it as a word.
 *
 * The field showed the first family and committed whatever it contained as the
 * whole declaration — so opening the Text section on
 * `"Inter", "Inter Fallback", system-ui, sans-serif`, changing nothing, and
 * tabbing away wrote `font-family: Inter`. Every fallback the author had chosen
 * for the case where Inter has not loaded, or does not cover a glyph, was gone,
 * and nothing said so.
 *
 * Editing the first family is the right *interaction* — it is the one people
 * mean by "change the font". It just has to be an edit to a list rather than a
 * replacement of it.
 */
import { splitTop } from "./css-value";

/**
 * A family that does not need quoting: a sequence of identifiers, which is what
 * the CSS grammar allows unquoted. `Times New Roman` is legal unquoted too, but
 * quoting it is what every stylesheet does and what round-trips unambiguously.
 */
const BARE_IDENT = /^-?[a-z_][\w-]*$/i;

/**
 * The generic families, which are keywords rather than names.
 *
 * Quoting one turns it into a request for a font *called* "sans-serif", which
 * almost certainly does not exist — so the fallback that was the whole point of
 * the last entry in the stack silently stops working.
 */
const GENERIC = new Set([
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

const SURROUNDING_QUOTES = /^["']|["']$/g;

/** Split a `font-family` value into its families, unquoted and trimmed. */
export function parseFontStack(value: string): string[] {
  return splitTop(value)
    .map((part) => part.trim().replace(SURROUNDING_QUOTES, "").trim())
    .filter(Boolean);
}

/** Serialise families back, quoting only the ones that need it. */
export function formatFontStack(families: readonly string[]): string {
  return families
    .filter(Boolean)
    .map((family) =>
      GENERIC.has(family.toLowerCase()) || BARE_IDENT.test(family)
        ? family
        : `"${family}"`
    )
    .join(", ");
}

/** The family the field shows: the first one the browser will try. */
export function firstFamily(value: string): string {
  return parseFontStack(value)[0] ?? "";
}

/**
 * Swap the first family, keeping every fallback behind it.
 *
 * The fallbacks are the author's answer to "what if this font is missing", and
 * they are still the right answer after the first choice changes. If the new
 * family is already somewhere further down the stack it is *moved* to the front
 * rather than duplicated — a stack that lists the same family twice is not
 * wrong, exactly, but it is not something anyone means.
 */
export function replaceFirstFamily(value: string, next: string): string {
  const family = next.trim().replace(SURROUNDING_QUOTES, "").trim();
  if (!family) {
    return value;
  }
  const rest = parseFontStack(value)
    .slice(1)
    .filter((f) => f.toLowerCase() !== family.toLowerCase());
  return formatFontStack([family, ...rest]);
}
