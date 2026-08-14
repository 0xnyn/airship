import { normalizeTokenValue } from "@airship/protocol/tokens";
import { describe, expect, it } from "vitest";
import {
  alphaOf,
  formatColor,
  isHexColor,
  isParseableColor,
  opaque,
  parseColor,
  type RGBA,
  sameColor,
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

/*
 * `sameColor` — the comparison, and the reason `===` is not it.
 *
 * Three places asked "are these the same colour?" and all three answered with
 * string equality, which is wrong because every boundary here hands back a
 * different spelling: computed style gives the legacy comma form, `formatColor`
 * writes the modern space form, and stylesheets author hex.
 */
describe("sameColor", () => {
  it("sees through the spelling", () => {
    const same = [
      ["#0af", "rgb(0, 170, 255)"],
      ["#0af", "rgb(0 170 255)"],
      ["#00AAFF", "#0af"],
      ["rgb(59, 130, 246)", "rgb(59 130 246)"],
      ["rgba(0, 0, 0, 0.5)", "rgb(0 0 0 / 50%)"],
      ["transparent", "rgba(0, 0, 0, 0)"],
    ];
    for (const [a, b] of same) {
      expect(sameColor(a, b), `${a} vs ${b}`).toBe(true);
    }
  });

  it("survives a round trip through formatColor", () => {
    /*
     * The case that forces alpha to be compared as an 8-bit channel rather than
     * a float. `#00000080` is 128/255 = 0.50196…, and `formatColor` rounds alpha
     * to three decimals — so the value it writes back is `0.502`, and exact
     * float equality would report a colour as different from itself.
     */
    const parsed = parseColor("#00000080") as RGBA;
    expect(sameColor("#00000080", formatColor(parsed, "rgb"))).toBe(true);
    expect(sameColor("#00000080", formatColor(parsed, "hex"))).toBe(true);
  });

  it("still calls a different colour different", () => {
    // No tolerance: `findToken` is right that a slightly different hex is a
    // different colour, not an approximation of one.
    expect(sameColor("#000000", "#010000")).toBe(false);
    expect(sameColor("rgb(0 0 0 / 0.5)", "rgb(0 0 0 / 0.6)")).toBe(false);
    expect(sameColor("#000000", "rgba(0, 0, 0, 0.99)")).toBe(false);
  });

  it("refuses rather than guessing when either side is unreadable", () => {
    // `Mixed` is the sentinel the panel uses for a multi-select disagreement;
    // it must never compare equal to anything, including itself.
    expect(sameColor("Mixed", "Mixed")).toBe(false);
    expect(sameColor("#000000", "Mixed")).toBe(false);
  });
});

/*
 * The one hex grammar. There were three, and the two in `color-picker.ts` and
 * `gradient.ts` both refused four- and eight-digit hex that `parseHex` reads.
 */
describe("isHexColor", () => {
  it("accepts every length parseHex implements, in either case", () => {
    for (const value of ["#abc", "#abcd", "#aabbcc", "#aabbccdd", "#AABBCC"]) {
      expect(isHexColor(value), value).toBe(true);
    }
  });

  it("rejects the lengths that are not hex colours", () => {
    for (const value of ["#ab", "#abcde", "#abcdefg", "#", "abc", "#zzz"]) {
      expect(isHexColor(value), value).toBe(false);
    }
  });

  it("never refuses something parseColor would have read", () => {
    // The property that makes it safe as a field gate.
    for (const value of ["#abc", "#abcd", "#aabbcc", "#aabbccdd"]) {
      expect(parseColor(value), value).not.toBeNull();
    }
  });
});

/*
 * The realm the engine probe runs in.
 *
 * `parseColor` has always taken a `node` for this, and for a long time nothing
 * passed one: `withAlpha`, `alphaOf`, `opaque` and `isParseableColor` are how
 * the swatch, the hex field and `gates.ts` actually ask, and all four dropped
 * it. So a `var(--brand)` inside a canvas frame went on resolving against the
 * overlay shell — where `--brand` is undefined — and the swatch showed the
 * shell's inherited colour while `withAlpha` wrote that wrong colour back.
 *
 * A parameter nothing passes is not a fix, so what is asserted here is the
 * threading, not just the signature.
 */
describe("the realm a colour resolves in", () => {
  /** A stand-in frame: a real probe element, but its own window for the read. */
  function frame(color: string) {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[] = [];
    const doc = {
      body: host,
      createElement: (tag: string) => document.createElement(tag),
      defaultView: {
        getComputedStyle: () => {
          seen.push(color);
          return { color } as CSSStyleDeclaration;
        },
      },
    } as unknown as Document;
    return {
      node: { nodeType: 1, ownerDocument: doc } as unknown as Element,
      seen,
      teardown: () => host.remove(),
    };
  }

  /** The shell answers a colour nothing in the frame would ever produce. */
  function withShellSaying<T>(color: string, run: () => T): T {
    const real = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() =>
      ({ color }) as CSSStyleDeclaration) as typeof real;
    try {
      return run();
    } finally {
      globalThis.getComputedStyle = real;
    }
  }

  it("asks the node's own window, not the shell's", () => {
    const f = frame("rgb(0, 170, 255)");
    try {
      withShellSaying("rgb(1, 1, 1)", () => {
        expect(parseColor("var(--brand)", f.node)).toEqual<RGBA>([
          0, 170, 255, 1,
        ]);
      });
      expect(f.seen).toHaveLength(1);
    } finally {
      f.teardown();
    }
  });

  it("threads that realm through every wrapper", () => {
    const f = frame("rgba(0, 170, 255, 0.5)");
    try {
      withShellSaying("rgb(1, 1, 1)", () => {
        // Each of these is a route the panel actually takes. Without the node
        // every one of them reports the shell's opaque `rgb(1, 1, 1)`.
        expect(opaque("var(--brand)", f.node)).toBe("#00aaff");
        expect(alphaOf("var(--brand)", f.node)).toBe(0.5);
        expect(isParseableColor("var(--brand)", f.node)).toBe(true);
        expect(withAlpha("var(--brand)", 1, f.node)).toBe("rgb(0 170 255)");
        expect(sameColor("var(--brand)", "rgb(0 170 255 / 0.5)", f.node)).toBe(
          true
        );
      });
    } finally {
      f.teardown();
    }
  });

  it("still falls back to the shell when given no node", () => {
    // The old behaviour, which is correct for a colour that belongs to no frame.
    withShellSaying("rgb(1, 1, 1)", () => {
      expect(parseColor("var(--brand)")).toEqual<RGBA>([1, 1, 1, 1]);
    });
  });
});

/*
 * The two hex grammars that are left, held together.
 *
 * There is no way to get to one. `@airship/protocol` is a leaf and must stay
 * DOM-free, so it cannot import `parseHex`; the overlay's grammar has to live
 * beside the expansion logic it describes. Two definitions in two packages is
 * structural — three in one package was the bug.
 *
 * What can be guaranteed is that they never disagree, which is the failure that
 * would matter: `normalizeTokenValue` keys the registry and `parseColor` reads
 * the control, so a hex one accepts and the other refuses is a token that
 * silently stops binding. This is the seam where that would show up.
 */
describe("the overlay and protocol agree about hex", () => {
  it("accepts the same set of hex colours", () => {
    for (const value of [
      "#abc",
      "#abcd",
      "#aabbcc",
      "#aabbccdd",
      "#ABC",
      "#ab",
      "#abcde",
      "#abcdefg",
      "#zzz",
    ]) {
      const overlay = parseColor(value) !== null;
      // Protocol converts what it recognises and passes the rest through, so a
      // changed value is exactly "this was hex to me".
      const protocolSaw = normalizeTokenValue(value) !== value.toLowerCase();
      expect(protocolSaw, value).toBe(overlay);
    }
  });

  it("resolves them to the same colour", () => {
    for (const value of ["#0af", "#00aaff", "#0af8", "#00aaff88"]) {
      const viaOverlay = parseColor(value) as RGBA;
      // `normalizeTokenValue`'s output is `rgb()`, which the overlay parses on a
      // fast path — so a disagreement anywhere in either expansion shows here.
      const viaProtocol = parseColor(normalizeTokenValue(value)) as RGBA;
      expect(viaProtocol[0], value).toBe(viaOverlay[0]);
      expect(viaProtocol[1], value).toBe(viaOverlay[1]);
      expect(viaProtocol[2], value).toBe(viaOverlay[2]);
      // Alpha survives protocol's three-decimal rounding to the same 8-bit step.
      expect(sameColor(value, normalizeTokenValue(value)), value).toBe(true);
    }
  });
});
