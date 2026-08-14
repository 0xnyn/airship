import { describe, expect, it } from "vitest";
import {
  categorizeToken,
  categoryForProperty,
  looksLikeColor,
  normalizeTokenValue,
} from "./tokens";

/*
 * Which scale a custom property belongs to.
 *
 * This had no tests at all, and it is the one place in the codebase where a
 * wrong answer becomes wrong CSS in somebody's source: a token in the wrong
 * category is offered by the wrong picker, and picking it writes its value into
 * a property it was never meant for. That is not hypothetical — a box-shadow
 * classified as a font family reached the font picker, and `firstFamily` served
 * up `0 8px 32px rgba(0` as a family name.
 *
 * Three tiers, best evidence first: the properties the token is used on, then
 * its name, then its value. Each block below is one tier, and the last is the
 * regression suite for the values that used to be misread.
 */

const at = (name: string, value: string, usedOn?: string[]) =>
  categorizeToken({ name, usedOn, value });

describe("tier 1 — the properties a token is used on", () => {
  it("beats both the name and the value", () => {
    // Named like spacing, valued like a length, used as a radius. Usage wins.
    expect(at("--space-2", "8px", ["border-radius"])).toBe("border-radius");
  });

  it("takes the majority when a token is used on several", () => {
    expect(
      at("--x", "8px", ["padding-top", "padding-left", "border-radius"])
    ).toBe("spacing");
  });

  it("abstains rather than guessing when no usage is in a known category", () => {
    // `transition-timing-function` is in no category, so the vote is empty and
    // the name and value tiers get their turn. This is why `--ease-*` has to be
    // caught below rather than here.
    expect(categoryForProperty("transition-timing-function")).toBeNull();
    expect(
      at("--ease-panel", "ease-in-out", ["transition-timing-function"])
    ).toBe(null);
  });
});

describe("tier 2 — the name", () => {
  it("reads an unprefixed name", () => {
    expect(at("--shadow-lg", "0 4px 8px #0003")).toBe("box-shadow");
    expect(at("--radius-sm", "4px")).toBe("border-radius");
    expect(at("--font-sans", "Whatever")).toBe("font-family");
  });

  /*
   * The bug this suite exists for. Every pattern was anchored at `^--`, so a
   * design system that namespaces its tokens got no name tier at all — and
   * `--pk-elevation-floating` fell through to the value tier, where the only
   * test it matched was "contains a comma".
   */
  it("reads a namespaced name, which it used to ignore entirely", () => {
    expect(at("--pk-elevation-floating", "0 8px 32px rgba(0,0,0,0.18)")).toBe(
      "box-shadow"
    );
    expect(at("--pk-radius-none", "0px")).toBe("border-radius");
    expect(at("--pk-radius-full", "9999px")).toBe("border-radius");
    expect(at("--brand-color-accent", "#0af")).toBe("colors");
  });

  it("still only matches at a segment boundary", () => {
    // Not "…-shadow", so the name says nothing and the value decides.
    expect(at("--overshadowed", "12px")).toBe("spacing");
  });
});

describe("tier 3 — the value", () => {
  it("reads colours, weights and bare lengths", () => {
    expect(at("--x", "#0af")).toBe("colors");
    expect(at("--x", "rgb(0 128 255)")).toBe("colors");
    expect(at("--x", "600")).toBe("font-weight");
    expect(at("--x", "12px")).toBe("spacing");
  });

  it("reads a font stack", () => {
    expect(at("--x", "Inter, system-ui, sans-serif")).toBe("font-family");
    expect(at("--x", '"Inter", "Inter Fallback", system-ui')).toBe(
      "font-family"
    );
    expect(at("--x", "JetBrains Mono, ui-monospace, monospace")).toBe(
      "font-family"
    );
  });

  it("reads a shadow, which had no branch here at all", () => {
    expect(at("--x", "0 8px 32px rgba(0,0,0,0.18)")).toBe("box-shadow");
    expect(
      at("--x", "0 0 0 0.5px rgba(0,0,0,0.15), 0 6px 20px 4px #0003")
    ).toBe("box-shadow");
    expect(at("--x", "inset 0 1px 2px #0002")).toBe("box-shadow");
  });

  it("declines a lone bare word", () => {
    /*
     * `Inter` is a plausible family and so is `none`, and this tier only runs
     * when usage and name have both declined to say. One unquoted word is not
     * evidence; a real single-family token is reached by its name or its use.
     */
    expect(at("--x", "Inter")).toBeNull();
    expect(at("--x", "none")).toBeNull();
    expect(at("--x", "auto")).toBeNull();
  });

  it("keeps a lone family that is quoted or generic", () => {
    expect(at("--x", '"Inter"')).toBe("font-family");
    expect(at("--x", "monospace")).toBe("font-family");
    expect(at("--x", "ui-monospace")).toBe("font-family");
  });
});

describe("the values that used to become fonts", () => {
  /*
   * `if (v.includes(","))` was the whole font-family test. A comma is shared by
   * shadows, easings, gradients, transforms and every multi-argument colour
   * function in CSS, so all of them landed in the font picker.
   */
  it("does not read an easing as a font", () => {
    for (const easing of [
      "cubic-bezier(0.215, 0.61, 0.355, 1)",
      "cubic-bezier(0.34, 1.56, 0.64, 1)",
    ]) {
      expect(at("--ease-x", easing)).not.toBe("font-family");
      // Nothing in the inspector can edit an easing, so `null` is the right
      // answer — `categorizeToken`'s callers drop what they cannot place.
      expect(at("--ease-x", easing)).toBeNull();
    }
  });

  it("does not read a shadow as a font", () => {
    expect(at("--x", "0 8px 32px rgba(0,0,0,0.18)")).not.toBe("font-family");
  });

  it("does not read a gradient or a transform as a font", () => {
    expect(at("--x", "linear-gradient(90deg, #fff, #000)")).not.toBe(
      "font-family"
    );
    expect(at("--x", "translate(4px, 8px)")).not.toBe("font-family");
  });

  it("does not read a breakpoint as a spacing step", () => {
    // Named, so the name tier catches it before the bare-length rule can.
    expect(at("--pk-layout-breakpoint-nav", "1240px")).toBe("sizing");
  });
});

/*
 * `normalizeTokenValue` is the key both scanners hash a token's value into, and
 * it did not touch hex — so the registry could not match its own tokens. A
 * design system authors `--brand: #0af`; every control reads back the *computed*
 * `rgb(0, 170, 255)`; the two hashed to different keys, and no hex-authored
 * colour token ever bound to a control. The badge simply never appeared.
 *
 * Hex is the one colour conversion that belongs in this module — it is exact
 * string math on 8-bit sRGB and needs no engine. Everything past it (`oklch()`,
 * named colours) is `sameColor`'s job in the overlay.
 */
describe("normalizeTokenValue", () => {
  it("collapses every spelling of one colour into one key", () => {
    const key = "rgb(0, 170, 255)";
    for (const spelling of [
      "#0af",
      "#00AAFF",
      "#00aaff",
      "rgb(0, 170, 255)",
      "rgb(0 170 255)",
      "  #0AF  ",
    ]) {
      expect(normalizeTokenValue(spelling)).toBe(key);
    }
  });

  it("carries the alpha of a four- or eight-digit hex", () => {
    // 0x80 / 255 = 0.502 — three decimals, matching the overlay's `formatColor`.
    expect(normalizeTokenValue("#00000080")).toBe("rgb(0, 0, 0, 0.502)");
    // `#0008` expands to `#00000088`, not to `#000` with a stray alpha.
    expect(normalizeTokenValue("#0008")).toBe("rgb(0, 0, 0, 0.533)");
    expect(normalizeTokenValue("#ffffffff")).toBe("rgb(255, 255, 255, 1)");
  });

  it("agrees with the four-argument rgb() the legacy branch already emits", () => {
    // The whole point is one colour, one key — so hex with alpha has to land on
    // the same string as the two spellings a browser and a stylesheet produce.
    expect(normalizeTokenValue("rgba(0, 0, 0, 0.5)")).toBe("rgb(0, 0, 0, 0.5)");
    expect(normalizeTokenValue("rgb(0 0 0 / 0.5)")).toBe("rgb(0, 0, 0, 0.5)");
  });

  it("leaves alone what it cannot convert exactly", () => {
    // No engine here, so these pass through for `sameColor` to settle.
    expect(normalizeTokenValue("oklch(0.7 0.1 200)")).toBe(
      "oklch(0.7 0.1 200)"
    );
    expect(normalizeTokenValue("REBECCAPURPLE")).toBe("rebeccapurple");
    expect(normalizeTokenValue("var(--brand)")).toBe("var(--brand)");
  });

  it("does not mistake a malformed hex for a colour", () => {
    for (const bad of ["#zzz", "#12345", "#1234567", "#", "#ff"]) {
      expect(normalizeTokenValue(bad)).toBe(bad.toLowerCase());
    }
  });

  it("still normalizes the non-hex forms it always did", () => {
    expect(normalizeTokenValue("255 229 202")).toBe("rgb(255, 229, 202)");
    expect(normalizeTokenValue("  8PX  ")).toBe("8px");
  });
});

/*
 * The prefix test the overlay used to keep a byte-identical copy of, under the
 * name `COLORISH`. Deliberately weak — it is a swatch gate, not a parser.
 */
describe("looksLikeColor", () => {
  it("accepts hex and every colour function", () => {
    for (const value of [
      "#0af",
      "rgb(0 0 0)",
      "rgba(0,0,0,.5)",
      "hsl(0 100% 50%)",
      "oklch(0.7 0.1 200)",
      "lab(50% 40 59)",
      "color(srgb 1 0 0)",
    ]) {
      expect(looksLikeColor(value)).toBe(true);
    }
  });

  it("rejects what does not start like one", () => {
    for (const value of ["8px", "bold", "var(--brand)", "255 229 202"]) {
      expect(looksLikeColor(value)).toBe(false);
    }
  });
});
