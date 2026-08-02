import { describe, expect, it } from "vitest";
import {
  alphaOf,
  formatColor,
  isParseableColor,
  opaque,
  parseColor,
  type RGBA,
  splitTop,
  splitWords,
  withAlpha,
} from "./css-value";

/*
 * The colour boundary.
 *
 * `parseColor` is the whole `string → RGBA` conversion for the overlay, and the
 * gap that mattered was not exotic: it could not read back what `formatColor`
 * itself emitted in HSL mode, and it could not read `oklch()` — which is every
 * colour in a Tailwind 4 project, so every colour token resolved to black.
 */

describe("splitTop", () => {
  it("splits on top-level commas only", () => {
    expect(splitTop("rgba(0, 0, 0, .2) 0 1px, red 0 2px")).toEqual([
      "rgba(0, 0, 0, .2) 0 1px",
      "red 0 2px",
    ]);
  });

  it("survives nested parentheses", () => {
    expect(
      splitTop("linear-gradient(to right, rgb(1, 2, 3), #fff), url(a.png)")
    ).toEqual(["linear-gradient(to right, rgb(1, 2, 3), #fff)", "url(a.png)"]);
  });

  it("drops empty parts", () => {
    expect(splitTop("a,,b")).toEqual(["a", "b"]);
    expect(splitTop("")).toEqual([]);
  });
});

describe("splitWords", () => {
  it("keeps a function call together", () => {
    expect(splitWords("inset 0 2px rgba(0, 0, 0, .2)")).toEqual([
      "inset",
      "0",
      "2px",
      "rgba(0, 0, 0, .2)",
    ]);
  });
});

describe("parseColor", () => {
  it("reads hex in every length", () => {
    expect(parseColor("#fff")).toEqual<RGBA>([255, 255, 255, 1]);
    expect(parseColor("#ffffff")).toEqual<RGBA>([255, 255, 255, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.502, 2);
    expect(parseColor("#0000")).toEqual<RGBA>([0, 0, 0, 0]);
  });

  it("reads both rgb spellings", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual<RGBA>([1, 2, 3, 1]);
    expect(parseColor("rgb(1 2 3 / 0.5)")).toEqual<RGBA>([1, 2, 3, 0.5]);
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual<RGBA>([1, 2, 3, 0.5]);
  });

  it("reads the wide-gamut form Chrome serialises", () => {
    // `color(srgb …)` uses 0–1 components; treating it as `rgb()` put
    // `COLOR(SRGB 0.968627…` in a six-character hex field.
    expect(parseColor("color(srgb 1 1 1)")).toEqual<RGBA>([255, 255, 255, 1]);
  });

  it("treats `transparent` as a colour, not an absence", () => {
    // Without this, dragging the alpha slider on an empty fill does nothing.
    expect(parseColor("transparent")).toEqual<RGBA>([0, 0, 0, 0]);
  });

  it("reads back what formatColor writes, in every mode", () => {
    const source: RGBA = [17, 34, 51, 0.5];
    for (const mode of ["hex", "rgb", "hsl"] as const) {
      const written = formatColor(source, mode);
      const read = parseColor(written);
      expect(read, `${mode}: ${written}`).not.toBeNull();
      const [r, g, b, a] = read as RGBA;
      expect(Math.abs(r - source[0]), written).toBeLessThanOrEqual(1);
      expect(Math.abs(g - source[1]), written).toBeLessThanOrEqual(1);
      expect(Math.abs(b - source[2]), written).toBeLessThanOrEqual(1);
      expect(a).toBeCloseTo(source[3], 1);
    }
  });

  it("reads both hsl spellings", () => {
    expect(parseColor("hsl(0 100% 50%)")).toEqual<RGBA>([255, 0, 0, 1]);
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual<RGBA>([255, 0, 0, 1]);
    expect(parseColor("hsla(0, 100%, 50%, 0.5)")).toEqual<RGBA>([
      255, 0, 0, 0.5,
    ]);
    expect(parseColor("hsl(0 100% 50% / 0.25)")).toEqual<RGBA>([
      255, 0, 0, 0.25,
    ]);
  });

  it("refuses a malformed hsl rather than guessing", () => {
    expect(parseColor("hsl(0 100%)")).toBeNull();
    expect(parseColor("hsl(a b c)")).toBeNull();
  });

  it("refuses what is not a colour", () => {
    for (const raw of ["", "  ", "not-a-colour", "16px", "#12345"]) {
      expect(parseColor(raw), raw).toBeNull();
    }
  });

  it("terminates on a form no fast path recognises", () => {
    /*
     * The engine fallback must not recurse: it reads the browser's answer with
     * the fast paths only, never by calling back into `parseColor`.
     *
     * What it *returns* here depends on the environment. happy-dom does not
     * normalise colours at all, so these come back null; a browser resolves
     * them to `rgb()` and they parse. The contract asserted here is the one
     * that holds everywhere — it answers, it does not throw, it does not spin.
     * The wiring that makes a browser succeed is asserted below.
     */
    for (const raw of [
      "oklch(0.7 0.15 250)",
      "red",
      "color-mix(in srgb, red, blue)",
    ]) {
      expect(() => parseColor(raw), raw).not.toThrow();
    }
  });

  it("reads the engine's COMPUTED value, not the specified one", () => {
    /*
     * The bug this replaced: the probe read `probe.style.color`, which for
     * `oklch(…)` or `red` is the string that just went in — so the fast paths
     * failed on it exactly as they had failed on the input, and every colour in
     * a Tailwind 4 palette came back unparseable and rendered as `Mixed`.
     *
     * The engine is stubbed rather than trusted, because no test environment
     * normalises colours. What is under test is our side: that the probe is put
     * in the document and the *computed* value is what gets parsed.
     */
    const real = globalThis.getComputedStyle;
    const seen: Element[] = [];
    globalThis.getComputedStyle = ((element: Element) => {
      seen.push(element);
      return { color: "rgb(255, 0, 0)" } as CSSStyleDeclaration;
    }) as typeof globalThis.getComputedStyle;
    try {
      // `red` is the case that isolates it: happy-dom's setter accepts the
      // value and hands it straight back as `"red"`, so a specified-value read
      // parses to null while a computed-value read parses correctly.
      expect(parseColor("red")).toEqual<RGBA>([255, 0, 0, 1]);
      expect(seen).toHaveLength(1);
      expect(seen[0].isConnected).toBe(false);
    } finally {
      globalThis.getComputedStyle = real;
    }
  });

  it("leaves no probe behind", () => {
    parseColor("oklch(0.7 0.15 250)");
    expect(document.querySelector("[data-airship-probe]")).toBeNull();
  });
});

describe("alpha helpers", () => {
  it("reads the alpha a colour carries", () => {
    expect(alphaOf("rgba(0, 0, 0, 0.25)")).toBe(0.25);
    expect(alphaOf("#000")).toBe(1);
    expect(alphaOf("transparent")).toBe(0);
  });

  it("folds an opacity into the colour rather than the element", () => {
    // `opacity` composites the element *and its children*, so a fill at 50%
    // would fade the text inside it.
    expect(withAlpha("#ffffff", 0.5)).toBe("rgb(255 255 255 / 0.5)");
  });

  it("leaves an unparseable colour alone", () => {
    expect(withAlpha("not-a-colour", 0.5)).toBe("not-a-colour");
  });
});

describe("opaque", () => {
  it("gives a six-character hex for the swatch", () => {
    expect(opaque("rgba(255, 0, 0, 0.5)")).toBe("#ff0000");
  });

  it("falls back to black rather than echoing something unshowable", () => {
    expect(opaque("not-a-colour")).toBe("#000000");
  });
});

describe("isParseableColor", () => {
  it("guards the Mixed sentinel and keywords", () => {
    expect(isParseableColor("Mixed")).toBe(false);
    expect(isParseableColor("#abcdef")).toBe(true);
  });
});
