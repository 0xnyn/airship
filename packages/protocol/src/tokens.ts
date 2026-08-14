/**
 * @airship/protocol/tokens — the design-token vocabulary, shared by the server
 * scanner (`@airship/source/tokens`) and the overlay's registry/resolver.
 *
 * **This module must never import zod.** It is a separate entry point precisely
 * so the overlay can import the category table and the normalizer as *values*
 * without pulling `index.ts` — and therefore zod — into the injected browser
 * bundle. Everything here is plain data and pure functions: no DOM, no Node.
 *
 * The wire-validated `TokenRef` lives in `index.ts` instead, because it rides
 * inside `CreateJobRequest` and the server does validate that.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * What kind of scale a token belongs to. A token only ever matches a value on a
 * property in its own category — without this, `opacity: 1` matches a
 * `--line-height-1` and the agent is told to write nonsense.
 *
 * There was a `layout` category here, over `display`, `flex-direction`,
 * `align-items`, `justify-content`, `flex-wrap` and `position`. It is gone,
 * because none of those is a *scale*. Nobody ships a `--display-3`, so the only
 * things that ever landed in it were single-declaration component rules the
 * scanner could not tell apart from a token — `.hamburger { display: flex }` —
 * and the controls that edit those properties are segmented groups and selects,
 * which have no way to show a binding. A category with no scale behind it and
 * no control in front of it was a badge that could only ever mislead.
 */
export const TOKEN_CATEGORIES = [
  "spacing",
  "sizing",
  "colors",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "font-family",
  "border-radius",
  "border-width",
  "box-shadow",
  "opacity",
] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

/** Physical + logical sides, the shape most box properties repeat. */
const SIDES = ["top", "right", "bottom", "left"] as const;
const LOGICAL_SIDES = [
  "inline-start",
  "inline-end",
  "block-start",
  "block-end",
] as const;

function box(prefix: string, suffix = ""): string[] {
  const tail = suffix ? `-${suffix}` : "";
  return [
    `${prefix}${tail}`,
    ...SIDES.map((s) => `${prefix}-${s}${tail}`),
    `${prefix}-inline${tail}`,
    `${prefix}-block${tail}`,
    ...LOGICAL_SIDES.map((s) => `${prefix}-${s}${tail}`),
  ];
}

const CATEGORY_PROPERTIES: Record<TokenCategory, readonly string[]> = {
  "border-radius": [
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "border-start-start-radius",
    "border-start-end-radius",
    "border-end-start-radius",
    "border-end-end-radius",
  ],
  "border-width": [
    "border-width",
    ...SIDES.map((s) => `border-${s}-width`),
    ...LOGICAL_SIDES.map((s) => `border-${s}-width`),
    "outline-width",
    // Vector strokes share the border scale — the Vector section writes this.
    "stroke-width",
  ],
  "box-shadow": ["box-shadow"],
  colors: [
    "color",
    "background-color",
    "border-color",
    ...SIDES.map((s) => `border-${s}-color`),
    ...LOGICAL_SIDES.map((s) => `border-${s}-color`),
    "outline-color",
    "text-decoration-color",
    "accent-color",
    "caret-color",
    "fill",
    "stroke",
  ],
  "font-family": ["font-family"],
  "font-size": ["font-size"],
  "font-weight": ["font-weight"],
  "letter-spacing": ["letter-spacing"],
  "line-height": ["line-height"],
  opacity: ["opacity"],
  sizing: [
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "inline-size",
    "block-size",
    "min-inline-size",
    "max-inline-size",
    "min-block-size",
    "max-block-size",
  ],
  spacing: [
    ...box("padding"),
    ...box("margin"),
    "gap",
    "row-gap",
    "column-gap",
  ],
};

/** Reverse index, built once. */
const PROPERTY_CATEGORY: ReadonlyMap<string, TokenCategory> = new Map(
  TOKEN_CATEGORIES.flatMap((category) =>
    CATEGORY_PROPERTIES[category].map(
      (property) => [property, category] as const
    )
  )
);

/** The category a kebab-case CSS property draws its tokens from, if any. */
export function categoryForProperty(property: string): TokenCategory | null {
  return PROPERTY_CATEGORY.get(property) ?? null;
}

/** Every property that draws on a given category. */
export function propertiesForCategory(
  category: TokenCategory
): readonly string[] {
  return CATEGORY_PROPERTIES[category];
}

// ---------------------------------------------------------------------------
// Categorizing a custom property
//
// A utility class declares the property it affects, so its category is a lookup.
// A custom property declares nothing — `--brand: #0af` could be a colour, and
// `--step-2: 8px` could be spacing or sizing. Three tiers, best evidence first,
// shared by the static and runtime scanners so a token cannot land in one
// category on disk and another in the browser.
// ---------------------------------------------------------------------------

/**
 * Name-shaped hints, in priority order. Only consulted when usage says nothing.
 *
 * Every one of these used to be anchored at `^--`, which made the whole tier
 * dead for any design system that namespaces. `--pk-elevation-floating` never
 * matched the `elevation` rule written for it, fell through to the value tier,
 * and was classified by the one thing its value had in common with a font stack:
 * a comma. The sole exception was `-(spacing|space)-`, unanchored — and
 * `--pk-space-4` was correspondingly the only `--pk-*` token that landed right.
 *
 * `SEG` generalises that exception: a segment boundary is the start of the name
 * or a hyphen, so `--pk-elevation-` and `--elevation-` both match and `--x-not-
 * elevation` still does not have to be special-cased. Prefixes are ordinary
 * naming, not a special case to be tolerated grudgingly.
 */
const SEG = "(?:^--|-)";
const NAME_PATTERNS: [RegExp, TokenCategory][] = [
  [
    new RegExp(`${SEG}(spacing|space|gap|pad|padding|margin|inset)\\b`, "i"),
    "spacing",
  ],
  /*
   * `breakpoint`, `screen`, `container` and `layout` are here because otherwise
   * nothing claims them and the value tier files every one under spacing — so a
   * padding field offered `1240px` as a step. They are widths a box is measured
   * against, which is what sizing means. Spacing is tested first, so a
   * `--container-padding` still reaches the right one.
   */
  [
    new RegExp(
      `${SEG}(size|width|height|measure|breakpoint|screen|container|layout)\\b`,
      "i"
    ),
    "sizing",
  ],
  [
    new RegExp(
      `${SEG}(color|colour|bg|background|foreground|fg|text-color|border-color|accent|muted|destructive|primary|secondary|surface|brand|success|warning|danger|error|info)\\b`,
      "i"
    ),
    "colors",
  ],
  [
    new RegExp(`${SEG}(font-size|text)-(?:xs|sm|base|md|lg|xl|\\d)`, "i"),
    "font-size",
  ],
  [new RegExp(`${SEG}(font-weight|weight)\\b`, "i"), "font-weight"],
  [new RegExp(`${SEG}(leading|line-height)\\b`, "i"), "line-height"],
  [new RegExp(`${SEG}(tracking|letter-spacing)\\b`, "i"), "letter-spacing"],
  [
    new RegExp(
      `${SEG}(font-family|font)-(?:sans|serif|mono|display|body|heading)`,
      "i"
    ),
    "font-family",
  ],
  [
    new RegExp(`${SEG}(radius|rounded|border-radius|corner)\\b`, "i"),
    "border-radius",
  ],
  [
    new RegExp(`${SEG}(border-width|border-w|stroke-width|stroke)\\b`, "i"),
    "border-width",
  ],
  [new RegExp(`${SEG}(shadow|elevation)\\b`, "i"), "box-shadow"],
  [new RegExp(`${SEG}(opacity|alpha)\\b`, "i"), "opacity"],
  [new RegExp(`${SEG}(font|text)\\b`, "i"), "font-size"],
];

const HEX_OR_FUNC_COLOR =
  /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;

/**
 * Does this value *look* like a colour? A shape test, not a parse.
 *
 * Deliberately weak, and only used where being wrong is cheap. It answers on the
 * prefix alone — `#`, and the names of the colour functions — so `#zzz` and a
 * bare `rgb(` both pass. Its two callers can afford that: `categoryFromValue`,
 * picking a scale for a custom property when usage and name have both declined
 * to say, and the token picker, deciding whether a menu row gets a swatch.
 *
 * The overlay *has* a real answer — `isParseableColor` in `css-value.ts`, which
 * asks the engine — and the picker deliberately does not call it. That path
 * inserts a probe element and forces a style recalc per call, and a colour scale
 * routinely runs to a hundred rows; a hundred recalcs to open a menu is a worse
 * bug than the occasional swatch that paints nothing.
 *
 * Exported because the overlay held a byte-identical copy of this regex under
 * the name `COLORISH`. Two spellings of one rule in two packages is how they
 * drift apart.
 */
export function looksLikeColor(value: string): boolean {
  return HEX_OR_FUNC_COLOR.test(value.trim());
}
const NUMERIC_LENGTH = /^-?[\d.]+(px|r?em|%|v[hw]|ch|ex)$/;
const THREE_DIGITS = /^\d{3}$/;
/** Whole-value now, not a prefix — so `ui-` has to spell out what it heads. */
const GENERIC_FAMILY =
  /^(ui-[a-z-]+|system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|fantasy|emoji|math)$/i;

/** A quoted name, or a bare one: letters, digits, spaces, hyphens. Nothing else. */
const FAMILY_NAME = /^(?:"[^"]*"|'[^']*'|[a-z][a-z0-9\s-]*)$/i;
const QUOTED = /^["']/;
/** The keyword no other kind of token value uses. */
const INSET = /(^|\s)inset(\s|$)/i;
/** Whitespace-delimited numbers, with or without a unit — a bare `0` counts. */
const SHADOW_LENGTHS = /(?:^|\s)-?[\d.]+(?:px|r?em|%|v[hw]|ch|ex)?(?=\s|$)/g;
/** Any length, with or without a unit — `0` counts, which is why `\b` is needed. */
const LENGTH = /(^|[\s(])-?[\d.]+(px|r?em|%|v[hw]|ch|ex)?\b/i;

/**
 * Is this a font stack?
 *
 * It used to be `value.includes(",")`, which is how `0 8px 32px rgba(0,0,0,.18)`
 * and `cubic-bezier(0.23, 1, 0.32, 1)` became font families — and, once there,
 * how `0 8px 32px rgba(0` came to be offered in a font picker and written into
 * somebody's stylesheet as a real `font-family`. A comma is the weakest possible
 * evidence: it is punctuation shared by shadows, easings, gradients, transforms
 * and every multi-argument colour function in CSS.
 *
 * Stated positively instead: every part has to look like a family name — which
 * rejects anything carrying a length, a function call or a digit-led word.
 *
 * A lone bare word is not enough. `Inter` is a plausible family and so is
 * `none`, `auto` and every other CSS keyword, and this tier only runs when
 * usage and name have both already declined to say — so the safe reading of one
 * unquoted word with no other evidence is "no idea", which drops the token. A
 * real single-family token is reached by its name (`--font-sans`) or by the
 * declaration that uses it; quoted or generic, it is unambiguous and kept.
 */
function isFontStack(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    return false;
  }
  const looksLikeFamily = (part: string): boolean =>
    GENERIC_FAMILY.test(part) || (FAMILY_NAME.test(part) && !LENGTH.test(part));
  const [only] = parts;
  if (parts.length === 1) {
    return GENERIC_FAMILY.test(only) || QUOTED.test(only);
  }
  return parts.every(looksLikeFamily);
}

/**
 * Is this a box-shadow?
 *
 * Two or more lengths in the first layer — offset-x and offset-y are required
 * and everything else is optional — or the `inset` keyword, which nothing else
 * in a token value uses. Deliberately checks only the first comma-separated
 * layer: a stack of shadows is still a shadow, and the layers after the first
 * add nothing to the question.
 */
function isShadow(value: string): boolean {
  if (INSET.test(value)) {
    return true;
  }
  const [first = ""] = value.split(",");
  return (first.match(SHADOW_LENGTHS)?.length ?? 0) >= 2;
}

/**
 * Custom properties that are somebody's machinery rather than somebody's design
 * decision. Offering `--tw-ring-offset-shadow` in a token picker would be like
 * offering a minified variable name.
 *
 * `--ap-` is ours: the editor's own chrome palette, generated from
 * `packages/editor-tokens/EDITOR.md`. It has no business being offered as the
 * user's design system, and it was — the static scan walks up to the workspace
 * root, found `packages/editor-tokens/dist/tokens.css`, and served 93 of the 144
 * colour tokens `apps/web` was shown out of a stylesheet that app never loads.
 * Applying one wrote a `var()` the page could not resolve, which is what blanked
 * backgrounds and left text looking unchanged.
 *
 * Excluding by prefix rather than by "does it resolve right now" is deliberate:
 * this list can only ever be wrong about names we own, whereas a resolvability
 * test would quietly drop a `--brand` that happens to live under `.dark` or
 * inside a media query that is not currently matching.
 */
export const INTERNAL_TOKEN_PREFIXES = [
  "--ap-",
  "--tw-",
  "--chakra-",
  "--mantine-",
  "--radix-",
  "--nextui-",
  "--shiki-",
] as const;

export function isInternalToken(name: string): boolean {
  return INTERNAL_TOKEN_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Values that are keywords rather than design decisions.
 *
 * Both scanners treat a one-declaration class rule as a utility token, which is
 * right for `.text-brand { color: #6b4 }` and wrong for `.h-auto { height:
 * auto }`. Tailwind emits dozens of the latter, and every one of them was
 * landing in the registry as a token: the picker offered them, `matchByValue`
 * linked controls to them, and the badge then offered to "detach from .h-auto".
 *
 * A token names a *value* on a scale. `auto` is not on a scale — it is the
 * absence of one, and there is nothing for the agent to swap it for.
 */
const KEYWORD_VALUES: ReadonlySet<string> = new Set([
  "auto",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "none",
  "normal",
  "hidden",
  "visible",
  "transparent",
]);

/** Is this value worth offering as a token? */
export function isTokenizableValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length > 0 && !KEYWORD_VALUES.has(v);
}

/** Majority vote across the properties the token is actually used on. */
function categoryFromUsage(usedOn?: Iterable<string>): TokenCategory | null {
  if (!usedOn) {
    return null;
  }
  const votes = new Map<TokenCategory, number>();
  for (const property of usedOn) {
    const category = categoryForProperty(property);
    if (category) {
      votes.set(category, (votes.get(category) ?? 0) + 1);
    }
  }
  let best: TokenCategory | null = null;
  let bestCount = 0;
  for (const [category, count] of votes) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function categoryFromName(name: string): TokenCategory | null {
  for (const [pattern, category] of NAME_PATTERNS) {
    if (pattern.test(name)) {
      return category;
    }
  }
  return null;
}

function categoryFromValue(value: string): TokenCategory | null {
  const v = value.trim();
  if (looksLikeColor(v) || isChannelTriple(v)) {
    return "colors";
  }
  if (THREE_DIGITS.test(v)) {
    return "font-weight";
  }
  /*
   * Before the font test, not after it.
   *
   * A shadow is the value most likely to be mistaken for a font stack — it is
   * comma-separated and its parts are not lengths on their own — and there was
   * no branch for it here at all. `0 8px 32px rgba(0,0,0,0.18)` could only ever
   * reach `box-shadow` through usage or a name starting `--shadow`; miss both
   * and it was guaranteed to land somewhere wrong. Note `HEX_OR_FUNC_COLOR` is
   * anchored, so a shadow's trailing `rgba(` does not catch it above either.
   */
  if (isShadow(v)) {
    return "box-shadow";
  }
  if (isFontStack(v)) {
    return "font-family";
  }
  if (NUMERIC_LENGTH.test(v)) {
    // Deliberately spacing rather than sizing: a bare length in a design system
    // is overwhelmingly a spacing step, and a wrong guess costs only a token
    // offered on the wrong control.
    return "spacing";
  }
  return null;
}

/**
 * Which scale a custom property belongs to. `usedOn` is the set of CSS
 * properties seen referencing it, and is by far the strongest signal —
 * `color: var(--brand)` settles the question that no name or value heuristic
 * can. Returns null when nothing identifies it, and the token is dropped rather
 * than guessed into a category where it would mismatch real values.
 */
export function categorizeToken(input: {
  name: string;
  usedOn?: Iterable<string>;
  value: string;
}): TokenCategory | null {
  return (
    categoryFromUsage(input.usedOn) ??
    categoryFromName(input.name) ??
    categoryFromValue(input.value)
  );
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

const SPACE_RUN = /\s+/g;
const LEGACY_RGB = /^rgba?\(([^)]+)\)$/;
/** Tailwind v4 / UDS channel triples: `--brand: 255 229 202`. */
const SPACE_RGB = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;
/** Commas, slashes and whitespace all separate colour channels. */
const CHANNEL_SEPARATOR = /[,/\s]+/;
/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` — already lowercased by the caller. */
const HEX = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/;

/**
 * A hex colour as `rgb()` — pure string math, no DOM, no colour science.
 *
 * This is the one colour conversion that belongs in this module. It is exact
 * (hex *is* 8-bit sRGB, so nothing is approximated), it needs no engine, and
 * without it the registry could not match its own tokens: `byValue` is keyed on
 * the value as **authored**, and a design system authors `--brand: #0af` while
 * every control reads back the *computed* `rgb(0, 170, 255)`. Those are the same
 * colour and they hashed to two different keys, so no hex-authored colour token
 * ever bound to a control.
 *
 * `oklch()`, named colours and `hsl()` need a real parser and cannot be done
 * here — `css-value.ts` in the overlay handles those, which is why `match.ts`
 * has a second, engine-backed comparison behind this one.
 */
function hexToRgb(value: string): string | null {
  const matched = HEX.exec(value);
  if (!matched) {
    return null;
  }
  const [, digits] = matched;
  const full =
    digits.length <= 4
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  const rgb = `${channel(0)}, ${channel(2)}, ${channel(4)}`;
  if (full.length === 8) {
    /*
     * `rgb(r, g, b, a)`, not `rgba(…)` — the four-argument `rgb(` is what the
     * legacy branch below already produces for both `rgba(0, 0, 0, .5)` and the
     * modern `rgb(0 0 0 / .5)`, and the whole point of this function is that one
     * colour gets one key. Three decimals, matching the overlay's `formatColor`,
     * so a round trip through either side lands on the same string.
     */
    const alpha = Math.round((channel(6) / 255) * 1000) / 1000;
    return `rgb(${rgb}, ${alpha})`;
  }
  return `rgb(${rgb})`;
}

/** True when a bare value is three space-separated 0–255 channels. */
export function isChannelTriple(value: string): boolean {
  const m = SPACE_RGB.exec(value.trim());
  return (
    m !== null && [m[1], m[2], m[3]].every((n) => Number.parseInt(n, 10) <= 255)
  );
}

/**
 * Canonical form for value comparison. Both the server scanner and the browser
 * registry key `byValue` through this, so a token found statically and the same
 * token found at runtime collapse to one entry instead of two.
 *
 * Still not a colour parser, with one exception that earns its place. Hex is
 * converted, because hex *is* 8-bit sRGB — the conversion is exact string math,
 * needs no engine, and without it this function could not do the job named in
 * the paragraph above: a design system authors `--brand: #0af`, every control
 * reads back the computed `rgb(0, 170, 255)`, and the two hashed to different
 * keys, so no hex-authored colour token ever matched anything.
 *
 * Everything past hex — `oklch()`, named colours, `hsl()`, `color-mix()` — needs
 * a real parser and an engine probe, which this module cannot have and must not
 * grow. Those go through `css-value.ts`'s `sameColor` in the overlay, which
 * `tokens/match.ts` consults as a second pass behind this one.
 */
export function normalizeTokenValue(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(SPACE_RUN, " ");
  if (isChannelTriple(trimmed)) {
    return `rgb(${trimmed.replace(SPACE_RUN, ", ")})`;
  }
  const hex = hexToRgb(trimmed);
  if (hex) {
    return hex;
  }
  const legacy = LEGACY_RGB.exec(trimmed);
  if (legacy) {
    // `rgb(0,0,0)` and `rgb(0 0 0)` are the same colour; make them one key.
    const parts = legacy[1].split(CHANNEL_SEPARATOR).filter(Boolean).join(", ");
    return `rgb(${parts})`;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** How a token is referenced in source. */
export type TokenKind = "css-var" | "utility-class";

/** Where a token was found. Server-scanned tokens carry a real file. */
export type TokenOrigin = "static" | "runtime";

export interface DesignToken {
  /**
   * The token this one is a straight alias of — its authored value was exactly
   * `var(--other)`.
   *
   * Design systems routinely define a primitive scale and then re-export it
   * under app-facing names (Tailwind v4's `@theme { --radius-md:
   * var(--pk-radius-md) }` is the case in this repo's own example). Both names
   * are real and both resolve to the same value, so without this the picker
   * offers the user two identical `8px` entries and the prompt cannot say which
   * name the codebase actually writes.
   */
  aliasOf?: string;
  category: TokenCategory;
  /** Repo-relative file, when statically scanned. */
  file?: string;
  kind: TokenKind;
  /** 1-based, when statically scanned. */
  line?: number;
  /** `--pk-space-4` for a custom property, `.p-4` for a utility class. */
  name: string;
  origin: TokenOrigin;
  /**
   * For a utility class, which properties it declares and at what value. A
   * custom property has the single synthetic key `""` holding its own value,
   * so both kinds read through one code path.
   */
  values: Record<string, string>;
}

export type CssFramework = "tailwind" | "custom" | "unknown";

/** What a single scan (static or runtime) produced. */
export interface TokenScanResult {
  framework: CssFramework;
  tokens: DesignToken[];
}

/** The merged, indexed view the inspector and the prompt read from. */
export interface TokenRegistry {
  byCategory: Record<TokenCategory, DesignToken[]>;
  byName: Record<string, DesignToken>;
  /** `"${property}:${normalizeTokenValue(value)}"` → tokens providing it. */
  byValue: Record<string, DesignToken[]>;
  framework: CssFramework;
}

/** An empty registry — the "not scanned yet" value, so callers never null-check. */
export function emptyRegistry(): TokenRegistry {
  const byCategory = {} as Record<TokenCategory, DesignToken[]>;
  for (const category of TOKEN_CATEGORIES) {
    byCategory[category] = [];
  }
  return { byCategory, byName: {}, byValue: {}, framework: "unknown" };
}
