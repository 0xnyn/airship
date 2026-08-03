/**
 * The `filter` / `backdrop-filter` model.
 *
 * Two design points worth stating, because both are places the obvious
 * implementation is wrong:
 *
 * **Units are preserved, not assumed.** `brightness(1.2)` and `brightness(120%)`
 * are the same filter written two ways, and a parser that reads the number and
 * re-emits it with the *canonical* unit turns the first into `brightness(1.2%)`
 * — a 98% darkening, silently, on a value the user never touched. Each function
 * therefore carries the unit it was authored with, and only a value typed fresh
 * into an empty field gets the default.
 *
 * **The whole chain round-trips.** Anything unrecognised — `url(#goo)`, a
 * vendor-prefixed function, something from a spec that postdates this file — is
 * kept as an opaque row and re-emitted verbatim, in place. Dropping it would
 * mean the inspector silently deleted a filter for the crime of being unusual.
 */
import { round } from "../num";
import { splitWords } from "./css-value";

export type FilterKind =
  | "blur"
  | "brightness"
  | "contrast"
  | "drop-shadow"
  | "grayscale"
  | "hue-rotate"
  | "invert"
  | "opacity"
  | "saturate"
  | "sepia"
  /** Anything we do not model. Round-tripped verbatim. */
  | "other";

export interface FilterConfig {
  /** Unit written when the field is filled from empty. */
  defaultUnit: string;
  defaultValue: number;
  label: string;
  max: number;
  min: number;
  step: number;
  /** Units this function legally accepts, for the field's parser. */
  units: string[];
}

/**
 * Every filter function CSS defines. A partial implementation ships seven of
 * these and is missing `grayscale`, `opacity` and `drop-shadow` entirely.
 */
export const FILTER_CONFIG: Record<
  Exclude<FilterKind, "other" | "drop-shadow">,
  FilterConfig
> = {
  blur: {
    defaultUnit: "px",
    defaultValue: 4,
    label: "Blur",
    max: 100,
    min: 0,
    step: 1,
    units: ["px", "em", "rem"],
  },
  brightness: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Brightness",
    max: 300,
    min: 0,
    step: 1,
    units: ["%"],
  },
  contrast: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Contrast",
    max: 300,
    min: 0,
    step: 1,
    units: ["%"],
  },
  grayscale: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Grayscale",
    max: 100,
    min: 0,
    step: 1,
    units: ["%"],
  },
  "hue-rotate": {
    defaultUnit: "deg",
    defaultValue: 0,
    label: "Hue rotate",
    max: 360,
    min: -360,
    step: 1,
    units: ["deg", "turn", "rad"],
  },
  invert: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Invert",
    max: 100,
    min: 0,
    step: 1,
    units: ["%"],
  },
  opacity: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Opacity",
    max: 100,
    min: 0,
    step: 1,
    units: ["%"],
  },
  saturate: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Saturate",
    max: 300,
    min: 0,
    step: 1,
    units: ["%"],
  },
  sepia: {
    defaultUnit: "%",
    defaultValue: 100,
    label: "Sepia",
    max: 100,
    min: 0,
    step: 1,
    units: ["%"],
  },
};

/** Order the `+` menu offers them in. */
export const FILTER_KINDS = Object.keys(
  FILTER_CONFIG
) as (keyof typeof FILTER_CONFIG)[];

export interface FilterEntry {
  enabled: boolean;
  kind: FilterKind;
  /**
   * For a modelled function, the argument as authored (`1.2`, `120%`, `4px`).
   * For `drop-shadow`, its full argument list. For `other`, the entire source
   * text of the function including its name.
   */
  value: string;
}

const FUNCTION = /^([a-zA-Z-]+)\((.*)\)$/s;

/** Split a filter chain into its top-level functions, paren-aware. */
function splitFunctions(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  const tail = css.slice(start).trim();
  if (tail) {
    out.push(tail);
  }
  return out.filter(Boolean);
}

export function parseFilters(css: string): FilterEntry[] {
  const text = css.trim();
  if (!text || text === "none") {
    return [];
  }
  const out: FilterEntry[] = [];
  for (const chunk of splitFunctions(text)) {
    const match = FUNCTION.exec(chunk);
    if (!match) {
      out.push({ enabled: true, kind: "other", value: chunk });
      continue;
    }
    const name = match[1].toLowerCase();
    if (name === "drop-shadow") {
      out.push({ enabled: true, kind: "drop-shadow", value: match[2].trim() });
      continue;
    }
    if (name in FILTER_CONFIG) {
      // The argument verbatim — this is the unit preservation.
      out.push({
        enabled: true,
        kind: name as FilterKind,
        value: match[2].trim(),
      });
      continue;
    }
    out.push({ enabled: true, kind: "other", value: chunk });
  }
  return out;
}

export function formatFilters(entries: FilterEntry[]): string {
  const parts = entries
    .filter((e) => e.enabled)
    .map((e) => {
      if (e.kind === "other") {
        return e.value;
      }
      return `${e.kind}(${e.value})`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" ") : "none";
}

/** A bare number, with nothing after it — no unit, no function, no second value. */
const UNITLESS = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * One filter's argument, in the unit its field commits in.
 *
 * The ratio filters accept two spellings of the same thing — `brightness(120%)` and
 * `brightness(1.2)` — and every engine *computes* them to the unitless one. Their
 * fields are configured in `%` because that is the scale their labels, steps and
 * min/max describe, so a computed `1.2` arrived at the field as a bare number and
 * `createNumField.commit` re-attached the field's own default unit to it:
 * `brightness(1.2%)`, a 98.8% darkening, produced by focusing the field and tabbing
 * away without typing anything. `opacity(0.5)` became `opacity(0.5%)`.
 *
 * Scaling on the way in fixes it at the seam where the mismatch actually is. The
 * field then round-trips: it shows `120`, commits `120%`, the engine computes that
 * back to `1.2`, and the next read scales it to `120%` again.
 *
 * Only unitless input is touched, so an author who wrote `120%` keeps it verbatim —
 * which is what `parseFilters` promises.
 */
export function seedFilterValue(kind: FilterKind, value: string): string {
  const config = FILTER_CONFIG[kind as keyof typeof FILTER_CONFIG];
  const raw = value.trim();
  if (config?.defaultUnit !== "%" || !UNITLESS.test(raw)) {
    return raw;
  }
  return `${round(Number(raw) * 100, 4)}%`;
}

export function blankFilter(kind: keyof typeof FILTER_CONFIG): FilterEntry {
  const config = FILTER_CONFIG[kind];
  return {
    enabled: true,
    kind,
    value: `${config.defaultValue}${config.defaultUnit}`,
  };
}

/** A `drop-shadow(...)` argument list, for the shadow row's four fields. */
export interface DropShadow {
  blur: string;
  color: string;
  x: string;
  y: string;
}

/**
 * Does this word occupy a *length* slot in a shadow?
 *
 * Deliberately broad. The old test was `/^-?[\d.]+(px|r?em|%|v[hw]|pt)?$/`, and
 * `parseShadowList` treats every non-matching word as part of the **colour** — so
 * `box-shadow: 0 2px var(--shadow-blur) rgba(0,0,0,.15)` parsed two lengths and a
 * colour of `"var(--shadow-blur) rgba(0,0,0,.15)"`, and re-serialised to
 * `0 2px 0px 0px var(--shadow-blur) rgba(0,0,0,.15)` — invalid, dropped by the
 * browser, and *that string* is what reached the agent. `2vmin`, `1ch`, `3q` and any
 * `calc()` all took the same path.
 *
 * So: anything that starts like a number, and any `calc()`/`var()`/`clamp()`-shaped
 * function, counts as a length. A colour never starts with a digit or a sign, and the
 * colour functions are named, so the two sets do not overlap.
 */
const LENGTH = /^[+-]?(?:\d|\.\d)|^(?:calc|var|min|max|clamp|env)\(/i;

/**
 * `drop-shadow` takes the same `<length>{2,3} <color>` grammar as `box-shadow`
 * minus the spread and `inset`, and in either order — so lengths are taken
 * positionally and whatever is left over is the colour.
 */
export function parseDropShadow(value: string): DropShadow {
  const lengths: string[] = [];
  const rest: string[] = [];
  for (const word of splitWords(value)) {
    if (LENGTH.test(word)) {
      lengths.push(word);
    } else {
      rest.push(word);
    }
  }
  return {
    blur: lengths[2] ?? "0",
    /*
     * An omitted colour stays omitted.
     *
     * CSS uses the element's own `color` when `drop-shadow()`'s colour argument is
     * absent, so inventing `rgb(0 0 0 / 0.25)` was a real change of appearance:
     * `drop-shadow(4px 4px 2px)` on a red icon has a *red* shadow, and scrubbing the X
     * offset turned it black. `formatDropShadow` omits an empty colour, so the
     * declaration keeps meaning what it meant; the caller supplies the element's colour
     * when it needs something to *show* in the swatch.
     */
    color: rest.join(" "),
    x: lengths[0] ?? "0",
    y: lengths[1] ?? "0",
  };
}

export function formatDropShadow(shadow: DropShadow): string {
  return `${shadow.x} ${shadow.y} ${shadow.blur} ${shadow.color}`.trim();
}
