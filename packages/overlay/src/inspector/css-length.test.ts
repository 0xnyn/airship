import { describe, expect, it } from "vitest";
import {
  formatLength,
  isPrefix,
  isUnit,
  keywordsFor,
  LENGTH_UNITS,
  type Length,
  parseLength,
  toPx,
} from "./css-length";

/*
 * The table of things a field must refuse.
 *
 * Every string below reached the agent's payload at some point through one of
 * the three parsers this module replaced, and none of them is a value any CSS
 * property will take.
 */
const GARBAGE = [
  "abc",
  "",
  " ",
  "-",
  "+",
  ".",
  "..",
  "1.2.3",
  "10pxx",
  "px",
  "%",
  "12r", // a legal way-point to `12rem`, not a legal value
  "1e", // ...to `1em`
  "3v", // ...to `3vw`
  "10 px",
  "16px extra",
  "e5",
  "NaN",
  "Infinity",
  "1/2",
  "calc(100% - 10px)", // legal CSS, but not a *length* this module parses
];

describe("parseLength", () => {
  it.each(GARBAGE)("refuses %j", (raw) => {
    expect(parseLength(raw)).toBeNull();
  });

  it("reads a plain pixel length", () => {
    expect(parseLength("16px")).toEqual<Length>({ unit: "px", value: 16 });
  });

  it("keeps the unit the user actually typed", () => {
    // The regression at the heart of this: `50%` used to come back `50px`.
    expect(parseLength("50%")).toEqual<Length>({ unit: "%", value: 50 });
    expect(parseLength("1.5rem")).toEqual<Length>({ unit: "rem", value: 1.5 });
    expect(parseLength("2em")).toEqual<Length>({ unit: "em", value: 2 });
  });

  it("reads a bare number as unitless", () => {
    expect(parseLength("1.5")).toEqual<Length>({ unit: "", value: 1.5 });
    expect(parseLength("0")).toEqual<Length>({ unit: "", value: 0 });
  });

  it("accepts every sign and fraction form", () => {
    expect(parseLength("-5px")).toEqual<Length>({ unit: "px", value: -5 });
    expect(parseLength("+5px")).toEqual<Length>({ unit: "px", value: 5 });
    expect(parseLength(".5em")).toEqual<Length>({ unit: "em", value: 0.5 });
    expect(parseLength("5.px")).toEqual<Length>({ unit: "px", value: 5 });
  });

  it("normalises unit case, as CSS does", () => {
    expect(parseLength("10PX")).toEqual<Length>({ unit: "px", value: 10 });
    expect(parseLength("1REM")).toEqual<Length>({ unit: "rem", value: 1 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseLength("  16px  ")).toEqual<Length>({ unit: "px", value: 16 });
  });

  it("rejects a number too large to be finite", () => {
    // `Infinitypx` was reachable: `parseFloat` overflows silently and nothing
    // downstream checked.
    expect(parseLength("9".repeat(320))).toBeNull();
    expect(parseLength(`${"9".repeat(320)}px`)).toBeNull();
  });

  it("honours a restricted unit set", () => {
    expect(parseLength("50%", ["px"])).toBeNull();
    expect(parseLength("50px", ["px"])).toEqual<Length>({
      unit: "px",
      value: 50,
    });
  });

  it("round-trips through formatLength", () => {
    for (const raw of ["16px", "50%", "1.5rem", "-4px", "0"]) {
      const parsed = parseLength(raw);
      expect(parsed).not.toBeNull();
      expect(parseLength(formatLength(parsed as Length))).toEqual(parsed);
    }
  });
});

describe("isPrefix", () => {
  it("accepts the way-points a complete value passes through", () => {
    // Rejecting these would make the field untypeable, which is how a
    // well-meant validator becomes a worse bug than the one it fixed.
    for (const raw of ["", "1", "1.", "12", "12r", "12re", "-", ".", "-5"]) {
      expect(isPrefix(raw, LENGTH_UNITS)).toBe(true);
    }
  });

  it("accepts a keyword being typed out", () => {
    for (const raw of ["a", "au", "aut", "auto"]) {
      expect(isPrefix(raw, LENGTH_UNITS, ["auto"])).toBe(true);
    }
  });

  it("refuses a unit with no number in front of it", () => {
    expect(isPrefix("px", LENGTH_UNITS)).toBe(false);
    expect(isPrefix("rem", LENGTH_UNITS)).toBe(false);
  });

  it("refuses letters that lead nowhere", () => {
    expect(isPrefix("12q", LENGTH_UNITS)).toBe(false);
    expect(isPrefix("abc", LENGTH_UNITS)).toBe(false);
    expect(isPrefix("+", LENGTH_UNITS)).toBe(false);
  });

  it("is strictly weaker than parseLength, and deliberately so", () => {
    // The distinction the old code missed: `12r` is fine to type and must never
    // be committed. One predicate served both, so it was committed.
    expect(isPrefix("12r", LENGTH_UNITS)).toBe(true);
    expect(parseLength("12r")).toBeNull();
  });
});

describe("isUnit", () => {
  it("matches only complete units", () => {
    expect(isUnit("rem", LENGTH_UNITS)).toBe(true);
    expect(isUnit("REM", LENGTH_UNITS)).toBe(true);
    expect(isUnit("r", LENGTH_UNITS)).toBe(false);
    expect(isUnit("rems", LENGTH_UNITS)).toBe(false);
  });
});

describe("keywordsFor", () => {
  it("offers sizing words only where they are legal", () => {
    expect(keywordsFor("width")).toContain("max-content");
    expect(keywordsFor("height")).toContain("auto");
  });

  it("does not offer `auto` to a font size", () => {
    // The exact bug: one shared keyword list handed `auto` to every length
    // field, so `font-size: auto` was accepted, repainted as if it had worked,
    // and queued for the agent.
    expect(keywordsFor("font-size")).not.toContain("auto");
    expect(keywordsFor("padding-top")).not.toContain("auto");
    expect(keywordsFor("border-radius")).not.toContain("auto");
    expect(keywordsFor("opacity")).not.toContain("auto");
  });

  it("keeps `auto` on margins, where it centres things", () => {
    expect(keywordsFor("margin-left")).toContain("auto");
    expect(keywordsFor("margin")).toContain("auto");
  });

  it("gives max-* `none` rather than `auto`", () => {
    expect(keywordsFor("max-width")).toContain("none");
    expect(keywordsFor("max-width")).not.toContain("auto");
  });

  it("offers `normal` only to properties that have one", () => {
    expect(keywordsFor("line-height")).toContain("normal");
    expect(keywordsFor("letter-spacing")).toContain("normal");
    expect(keywordsFor("width")).not.toContain("normal");
  });

  it("always offers the global keywords, which are legal everywhere", () => {
    for (const property of ["font-size", "padding-top", "opacity", "width"]) {
      expect(keywordsFor(property)).toEqual(
        expect.arrayContaining(["inherit", "initial", "revert", "unset"])
      );
    }
  });
});

describe("toPx", () => {
  it("passes pixels through", () => {
    expect(toPx("16px")).toBe(16);
  });

  it("resolves rem against the root font size", () => {
    // 16 is the CSS initial value and this module's fallback, so a bare
    // environment still gives the answer a browser would.
    expect(toPx("1rem")).toBe(16);
    expect(toPx("1.5rem")).toBe(24);
  });

  it("reads a bare number as a length", () => {
    expect(toPx("16")).toBe(16);
  });

  it("refuses units it cannot convert without a layout", () => {
    expect(toPx("50%")).toBeNull();
    expect(toPx("10vw")).toBeNull();
  });

  it("refuses garbage", () => {
    for (const raw of ["abc", "", "-", "1.2.3", "16px extra"]) {
      expect(toPx(raw)).toBeNull();
    }
  });
});
