import { clamp01, round } from "../num";
import { ownerDocument } from "../realm";

/*
 * Parsing the handful of CSS values that are really *lists*.
 *
 * `box-shadow`, `background-image` and `filter` all hold a comma-separated
 * stack, which is what lets a design tool's Fill / Stroke / Effects sections be
 * repeatable rows rather than single fields. The only real subtlety is that a
 * naive `split(",")` is wrong for every one of them — colour functions contain
 * commas (`rgba(0, 0, 0, .2)`), and so do gradients.
 */

const WHITESPACE = /\s/;
const RUN_OF_WHITESPACE = /\s+/;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const SRGB_COLOR = /^color\(\s*srgb\s+([^)]+)\)$/;
const RGB_COLOR = /^rgba?\(([^)]+)\)$/;
const HSL_COLOR = /^hsla?\(([^)]+)\)$/;
/** `color(srgb …)` separates its channels with spaces and its alpha with `/`. */
const SRGB_SEPARATOR = /[\s/]+/;
/** `rgb()`/`rgba()` accept either the legacy comma form or the modern slash. */
const RGB_SEPARATOR = /[,/]/;
/** `hsl()` takes both the legacy comma form and the modern space-and-slash. */
const CHANNEL_SEPARATOR = /[,/\s]+/;

/**
 * Split on top-level commas only, respecting parentheses **and quotes**.
 *
 * Quotes matter because a `url()` can contain anything: `background-image:
 * url("a,b.png"), linear-gradient(red, blue)` split inside the quoted path and
 * produced `url("a` and `b.png")` as two separate fills. Worse, a quoted `"("`
 * permanently unbalanced `depth` and collapsed the whole rest of the list into one
 * layer. `splitSelectorList` in `css-rules.ts` has always tracked quotes; this is the
 * same fix for values.
 */
export function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) {
    parts.push(last);
  }
  return parts.filter(Boolean);
}

/** Split on top-level whitespace, respecting parentheses. */
export function splitWords(value: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of value) {
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    }
    if (WHITESPACE.test(c) && depth === 0) {
      if (cur) {
        words.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) {
    words.push(cur);
  }
  return words;
}

// -- Shadows -----------------------------------------------------------------

export interface Shadow {
  blur: string;
  color: string;
  /** Rows can be switched off without being deleted, like a design tool's eye toggle. */
  enabled: boolean;
  inset: boolean;
  spread: string;
  x: string;
  y: string;
}

export function blankShadow(inset = false): Shadow {
  return {
    blur: inset ? "4px" : "8px",
    color: "rgba(0, 0, 0, 0.25)",
    enabled: true,
    inset,
    spread: "0px",
    x: "0px",
    y: inset ? "2px" : "4px",
  };
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
 * Parse a `box-shadow` list.
 *
 * The grammar allows the colour anywhere in a layer, so this pulls the lengths
 * out positionally and treats whatever is left as the colour — which is what
 * every browser's serialised form (colour first) and every hand-written value
 * (colour last) both reduce to.
 */
export function parseShadowList(css: string): Shadow[] {
  if (!css || css === "none") {
    return [];
  }
  return splitTop(css).map((layer) => {
    const words = splitWords(layer);
    const inset = words.includes("inset");
    const rest = words.filter((w) => w !== "inset");
    const lengths = rest.filter((w) => LENGTH.test(w));
    const color = rest.filter((w) => !LENGTH.test(w)).join(" ") || "#000";
    return {
      blur: lengths[2] ?? "0px",
      color,
      enabled: true,
      inset,
      spread: lengths[3] ?? "0px",
      x: lengths[0] ?? "0px",
      y: lengths[1] ?? "0px",
    };
  });
}

/** Serialise back, dropping disabled rows — they must not reach the agent. */
export function formatShadowList(rows: Shadow[]): string {
  const on = rows.filter((r) => r.enabled);
  if (!on.length) {
    return "none";
  }
  return on
    .map((r) =>
      [r.inset ? "inset" : "", r.x, r.y, r.blur, r.spread, r.color]
        .filter(Boolean)
        .join(" ")
    )
    .join(", ");
}

// -- Fills -------------------------------------------------------------------

export type FillKind = "solid" | "gradient" | "image";

export interface Fill {
  enabled: boolean;
  kind: FillKind;
  /** For `solid`, a colour. For the others, the whole `background-image` layer. */
  value: string;
}

/**
 * Parse `background-image` into layers.
 *
 * The base `background-color` is handled separately by the caller and always
 * sits at the bottom of the stack, which mirrors how CSS paints them and how
 * design tools stack fills.
 */
export function parseFillLayers(css: string): Fill[] {
  if (!css || css === "none") {
    return [];
  }
  return splitTop(css).map((layer) => ({
    enabled: true,
    kind: layer.startsWith("url(") ? "image" : "gradient",
    value: layer,
  }));
}

export function formatFillLayers(rows: Fill[]): string {
  const on = rows.filter((r) => r.enabled && r.kind !== "solid");
  return on.length ? on.map((r) => r.value).join(", ") : "none";
}

// -- Colour ------------------------------------------------------------------

/** `[r, g, b, a]` — channels 0–255, alpha 0–1. */
export type RGBA = [number, number, number, number];

/**
 * Pull `[r, g, b, a]` (0–255, 0–1) out of any colour a browser will hand back.
 *
 * Chrome serialises some computed colours as `color(srgb 0.97 0.97 0.96)` —
 * a wide-gamut form with 0–1 components rather than 0–255. Treating that as
 * `rgb()` produced a swatch reading `COLOR(SRGB 0.968627…` in the hex field,
 * which is exactly the kind of thing that makes a panel feel unfinished.
 *
 * Exported because it is the whole conversion boundary for the colour picker:
 * this module owns `string ↔ RGBA` and the picker owns `RGBA ↔ HSVA`, so there
 * is exactly one CSS colour parser in the overlay.
 *
 * `node` names the realm `viaEngine` resolves against, and every wrapper below
 * takes it for one reason: for a long time none of them did, so the realm fix
 * `viaEngine` documents was unreachable. `withAlpha`, `alphaOf`, `opaque` and
 * `isParseableColor` each called `parseColor(color)` with no node, and they are
 * how the swatch, the hex field and `gates.ts` actually ask — so a `var()`
 * colour inside a canvas frame went on resolving against the overlay shell
 * exactly as before, and `hasFill` could answer `true` off the shell's inherited
 * colour. A parameter nothing passes is not a fix; the callers have to thread it.
 */
export function parseColor(color: string, node?: Element | null): RGBA | null {
  const c = color.trim().toLowerCase();

  // `transparent` is a real colour, not an absent one. Without this `withAlpha`
  // returns it unchanged and dragging the alpha slider on an empty fill does
  // nothing.
  if (c === "transparent") {
    return [0, 0, 0, 0];
  }
  // In order of how often each form is actually seen: computed styles are hex
  // or `rgb()`, `color(srgb …)` is Chrome's wide-gamut serialisation, and
  // `hsl()` is what this module's own `formatColor` writes.
  return (
    parseHex(c) ??
    parseSrgb(c) ??
    parseRgb(c) ??
    parseHsl(c) ??
    viaEngine(c, node ? ownerDocument(node) : null)
  );
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
function parseHex(c: string): RGBA | null {
  const hex = HEX_COLOR.exec(c);
  if (!hex) {
    return null;
  }
  const [, h] = hex;
  const full =
    h.length <= 4
      ? h
          .split("")
          .map((x) => x + x)
          .join("")
      : h;
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

/**
 * `color(srgb …)`, the wide-gamut form Chrome serialises some computed colours
 * as. Its components are 0–1 rather than 0–255; treating it as `rgb()` put
 * `COLOR(SRGB 0.968627…` in a six-character hex field.
 */
function parseSrgb(c: string): RGBA | null {
  const srgb = SRGB_COLOR.exec(c);
  if (!srgb) {
    return null;
  }
  const parts = srgb[1].split(SRGB_SEPARATOR).filter(Boolean);
  const rgb = parts.slice(0, 3).map(Number);
  if (parts.length < 3 || !rgb.every(Number.isFinite)) {
    return null;
  }
  const to255 = (v: number) => Math.round(clamp01(v) * 255);
  /*
   * The alpha goes through `alphaValue`, not `Number`.
   *
   * `color(srgb 1 0 0 / 50%)` is the spec's own spelling and the whole list used to be
   * `.map(Number)`d — so `"50%"` became `NaN`, the `Number.isFinite` test failed, and
   * the alpha silently fell back to `1`. A half-transparent background read as fully
   * opaque, the alpha field showed 100%, and the first edit wrote the opaque colour
   * back over it.
   */
  const a = parts[3] === undefined ? 1 : alphaValue(parts[3]);
  return [
    to255(rgb[0]),
    to255(rgb[1]),
    to255(rgb[2]),
    Number.isFinite(a) ? clamp01(a) : 1,
  ];
}

/** `rgb()` / `rgba()`, in both the legacy comma form and the modern slash one. */
function parseRgb(c: string): RGBA | null {
  const rgb = RGB_COLOR.exec(c);
  return rgb ? channels(rgb[1]) : null;
}

/**
 * The shared body of both `rgb()` spellings.
 *
 * A percentage means different things in the two positions, which is the bug this
 * used to have: `p.endsWith("%") ? parseFloat(p) / 100 : Number(p)` was applied to
 *every* component, so `rgb(100% 0% 0%)` — pure red, and valid CSS several
 * toolchains emit — parsed to `[1, 0, 0, 1]`. The swatch rendered near-black,
 * `opaque()` returned `#010000`, and dragging the alpha slider rewrote the colour as
 * `rgb(1 0 0 / .5)`, destroying it. `css-value.test.ts` covered `hsl(0 100% 50%)` and
 * never the `rgb()` percentage form.
 *
 * A channel percentage is a fraction of 255; an *alpha* percentage is a fraction of 1.
 */
function channels(body: string): RGBA | null {
  const parts = body
    .split(RGB_SEPARATOR)
    .flatMap((p) => p.trim().split(RUN_OF_WHITESPACE))
    .filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  const rgb = parts.slice(0, 3).map((p) => channelValue(p));
  if (!rgb.every(Number.isFinite)) {
    return null;
  }
  const a = parts[3] === undefined ? 1 : alphaValue(parts[3]);
  return [
    Math.round(clamp255(rgb[0])),
    Math.round(clamp255(rgb[1])),
    Math.round(clamp255(rgb[2])),
    Number.isFinite(a) ? clamp01(a) : 1,
  ];
}

/** One of r/g/b: `255`, or `100%` meaning the whole channel. */
function channelValue(part: string): number {
  return part.endsWith("%")
    ? (Number.parseFloat(part) / 100) * 255
    : Number(part);
}

/** Alpha: `0.5`, or `50%`. */
function alphaValue(part: string): number {
  return part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part);
}

function clamp255(n: number): number {
  return Math.min(255, Math.max(0, n));
}

/**
 * `hsl()` / `hsla()`, parsed here rather than delegated.
 *
 * This is the form `formatColor` emits in HSL display mode, so the module was
 * producing a value its own parser could not read: switch the picker to HSL,
 * pick a colour, and every later read of it — the swatch, the alpha slider,
 * `opaque` — fell back to `#000000`. A round trip through one's own output is
 * not something to leave to an engine probe that some environments stub out.
 */
function parseHsl(c: string): RGBA | null {
  const matched = HSL_COLOR.exec(c);
  if (!matched) {
    return null;
  }
  const [rawH, rawS, rawL, rawAlpha] = matched[1]
    .split(CHANNEL_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
  const h = Number.parseFloat(rawH);
  const s = Number.parseFloat(rawS) / 100;
  const l = Number.parseFloat(rawL) / 100;
  if (![h, s, l].every(Number.isFinite)) {
    return null;
  }
  const a = alphaFrom(rawAlpha);
  if (a === null) {
    return null;
  }
  const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l));
  return [r, g, b, clamp01(a)];
}

/** An optional trailing alpha channel: absent is 1, unparseable is a refusal. */
function alphaFrom(raw: string | undefined): number | null {
  if (raw === undefined) {
    return 1;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return null;
  }
  return raw.endsWith("%") ? n / 100 : n;
}

/** 0–255 channels from `[h 0–360, s 0–1, l 0–1]` — the inverse of `rgbToHsl`. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}

/**
 * Whatever is left, converted by the browser itself.
 *
 * The fast paths above cover what `getComputedStyle` hands back, which is why
 * they were enough for a long time. They are not enough for what people *write*:
 *
 * - `oklch()` — Tailwind 4's entire default palette, so every colour token in a
 *   Tailwind project came back unparseable and the swatch showing it rendered
 *   as the `Mixed` hairline;
 * - named colours, `lab()`, `color-mix()`, and anything else CSS grows next.
 *
 * Rather than chase the colour spec, ask the engine. The subtlety — and the
 * reason the first attempt at this did nothing — is *which* value to read back.
 * `probe.style.color` is the **specified** value, which for `oklch(…)` or `red`
 * is the string that just went in, so the fast paths failed on it exactly as
 * they failed on the input. It has to be the **computed** value, and that means
 * the probe has to be in the document: `getComputedStyle` on a detached element
 * returns nothing.
 *
 * The probe is inserted, read and removed within one task, and carries the same
 * markers `css-groups.ts`'s `defaultsFor` uses so the overlay's own guards and
 * any host `MutationObserver` can tell it apart from content.
 */
function viaEngine(value: string, realm?: Document | null): RGBA | null {
  const doc = realm ?? globalThis.document;
  const host = doc?.body ?? doc?.documentElement;
  if (!(doc && host)) {
    return null;
  }
  const probe = doc.createElement("span");
  probe.setAttribute("data-airship-probe", "");
  // Out of flow and out of the way: this is in the tree for one task, and must
  // not reflow the page or be picked up by the element picker.
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none";
  // A sentinel the setter overwrites only if it accepts the value, so an engine
  // that reports "" for an unset property and one that reports a default both
  // give the same answer.
  probe.style.color = "rgb(1, 2, 3)";
  probe.style.color = value;
  if (!probe.style.color || probe.style.color === "rgb(1, 2, 3)") {
    return null;
  }
  let resolved = "";
  try {
    host.append(probe);
    /*
     * The *probe's own* window, not the shell's.
     *
     * Every other read in the inspector goes through `realm.ts` for this reason
     * (`realm.ts` spells out why), and this one did not: a colour written as
     * `var(--brand)` inside a canvas frame was resolved against the overlay shell,
     * where `--brand` is undefined — so the probe computed to the shell's inherited
     * colour, the swatch showed the wrong colour, and `withAlpha` wrote that wrong
     * colour back into the frame.
     */
    const win = doc.defaultView ?? globalThis.window;
    resolved = win.getComputedStyle(probe).color;
  } catch {
    // A realm that refuses the insertion tells us nothing; fall through.
  } finally {
    probe.remove();
  }
  if (!resolved) {
    return null;
  }
  // A single fast path, never back into `parseColor` — a browser that hands
  // back a form it does not recognise must terminate rather than recurse. Every
  // engine normalises `color` to `rgb()`, which is why one is enough.
  return parseRgb(resolved.trim().toLowerCase());
}

/**
 * Fold an opacity into a colour rather than writing the `opacity` property.
 *
 * This matters: `opacity` composites the element *and all its children*, so a
 * fill at 50% would fade the text inside it. A design tool's fill opacity is the alpha
 * of that one paint, and `rgb(r g b / a)` is its exact CSS equivalent.
 */
export function withAlpha(
  color: string,
  alpha: number,
  node?: Element | null
): string {
  const parsed = parseColor(color, node);
  if (!parsed) {
    return color;
  }
  const [r, g, b] = parsed;
  return formatColor([r, g, b, alpha], "rgb");
}

/** The alpha already carried by a colour, as 0–1. */
export function alphaOf(color: string, node?: Element | null): number {
  if (color.trim() === "transparent") {
    return 0;
  }
  return parseColor(color, node)?.[3] ?? 1;
}

/**
 * `#rrggbb`, for the swatch and for feeding a native `<input type="color">`.
 *
 * Falls back to `#000000` rather than echoing an unparseable value: the hex
 * field is six characters wide, and putting `color(srgb 0.97 …)` in it is worse
 * than being slightly wrong about a colour nothing can edit anyway.
 */
export function opaque(color: string, node?: Element | null): string {
  const parsed = parseColor(color, node);
  if (!parsed) {
    return "#000000";
  }
  const [r, g, b] = parsed;
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Is this a hex colour? The one hex grammar, for every field that takes one.
 *
 * There were three of these. `color-picker.ts` gated its row's hex field on
 * `/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i` while the *same file's* popover field gated on
 * nothing and went straight to `parseColor` — so `FF0000AA` was accepted in one
 * field and silently reverted in the other. `gradient.ts` had a third,
 * `/^#([\da-f]{3}|[\da-f]{6})$/i`, behind its own hex parser.
 *
 * `HEX_COLOR` is the grammar `parseHex` actually implements, so a field that
 * gates on this can never refuse a value the parser would have read.
 */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim().toLowerCase());
}

/**
 * Can this value be shown in the picker at all? Guards `Mixed` and keywords.
 *
 * One of four colour predicates, which look interchangeable and are not. They
 * answer different questions, and picking the wrong one is how `none` came to
 * render as the `Mixed` hairline on every unstroked shape:
 *
 * - **this** — *can the picker render it?* Asks the engine, so it is the only
 *   one that knows about `oklch()` and named colours, and the only one that
 *   costs a style recalc.
 * - `looksLikeColor` (`@airship/protocol/tokens`) — *does it look like one?* A
 *   prefix test, no engine. For the places a wrong answer is cheap and a
 *   hundred style recalcs would not be.
 * - `isEditablePaint` (`svg-paint.ts`) — *is it a colour rather than a paint
 *   server?* SVG `fill`/`stroke` also take `url(#grad)` and `context-fill`,
 *   which are valid paints this module cannot read.
 * - `hasFill` / `hasStroke` (`gates.ts`) — *does the element have one at all?*
 *   About the element, not the string.
 *
 * And `sameColor`, above, is the one comparison. Nothing should be asking
 * whether two colours are equal with `===`.
 */
export function isParseableColor(
  color: string,
  node?: Element | null
): boolean {
  return parseColor(color, node) !== null;
}

/**
 * Are these the same colour? The comparison `===` cannot do.
 *
 * Three places in the overlay ask this question, and all three used to answer it
 * with string equality: the change set's no-op check, token matching, and the
 * gates. String equality is wrong here because every boundary in this codebase
 * hands back a *different spelling of the same colour*. `getComputedStyle`
 * returns the legacy comma form, `formatColor` writes the modern space form, and
 * a design system authors hex — so `#0af`, `rgb(0 170 255)` and
 * `rgb(0, 170, 255)` are one colour that compared unequal three ways.
 *
 * What that cost: a colour edited and then set back to its original was not
 * recognised as a no-op, so a change reading `background-color: rgb(59, 130,
 * 246) → rgb(59 130 246)` reached the agent asking it to do nothing.
 *
 * Exact, not approximate. `findToken` is right that colours have no meaningful
 * "near" — a slightly different hex is a different colour, not an approximation
 * of one — so this is equality with the spellings normalised away, never a
 * tolerance.
 *
 * The one place that reads as a tolerance and is not: alpha is compared as the
 * 8-bit channel it composites to. It has to be, because `formatColor` rounds
 * alpha to three decimals, so `#00000080` (128/255 = 0.50196…) serialises as
 * `rgb(0 0 0 / 0.502)` and would not equal itself across a round trip. Both
 * round to 128, which is the only sense in which they differ or don't.
 *
 * `node` picks the realm the engine probe resolves against — see `parseColor`.
 */
export function sameColor(
  a: string,
  b: string,
  node?: Element | null
): boolean {
  const ca = parseColor(a, node);
  const cb = parseColor(b, node);
  if (!(ca && cb)) {
    return false;
  }
  const alpha8 = (rgba: RGBA) => Math.round(clamp01(rgba[3]) * 255);
  return (
    ca[0] === cb[0] &&
    ca[1] === cb[1] &&
    ca[2] === cb[2] &&
    alpha8(ca) === alpha8(cb)
  );
}

// -- HSV ---------------------------------------------------------------------

/*
 * The picker holds HSVA, not RGBA, for the duration of an interaction.
 *
 * Round-tripping through RGB on every pointermove loses information the moment
 * a channel bottoms out: at `S = 0` or `V = 0` every hue maps to the same RGB
 * triple, so dragging the knob into the black corner and back out again returns
 * you to red rather than to the hue you started on. Holding H separately is the
 * only fix; the conversions below are the boundary.
 */

/** `[h 0–360, s 0–1, v 0–1]` from 0–255 channels. */
export function rgbToHsv(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** 0–255 channels from `[h 0–360, s 0–1, v 0–1]`. */
export function hsvToRgb(
  h: number,
  s: number,
  v: number
): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** `[h 0–360, s 0–1, l 0–1]` — for the picker's HSL readout only. */
export function rgbToHsl(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const [h, sv, v] = rgbToHsv(r, g, b);
  const l = v * (1 - sv / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return [h, s, l];
}

/**
 * Serialise a colour in the picker's current display mode.
 *
 * Alpha is written as a decimal rather than the `Math.round(a * 100)%` this
 * module used to emit everywhere: that quantised the alpha slider to 1% steps,
 * so a drag visibly stair-stepped and could not express the value the knob was
 * sitting on.
 */
export function formatColor(rgba: RGBA, mode: "hex" | "rgb" | "hsl"): string {
  const [r, g, b, rawA] = rgba;
  const a = round(clamp01(rawA));
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

  if (mode === "hex") {
    const hex = [ch(r), ch(g), ch(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (a >= 1) {
      return `#${hex}`;
    }
    return `#${hex}${Math.round(a * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }

  if (mode === "hsl") {
    const [h, s, l] = rgbToHsl(ch(r), ch(g), ch(b));
    const head = `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    return a >= 1 ? `hsl(${head})` : `hsl(${head} / ${a})`;
  }

  const head = `${ch(r)} ${ch(g)} ${ch(b)}`;
  return a >= 1 ? `rgb(${head})` : `rgb(${head} / ${a})`;
}
