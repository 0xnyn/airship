import { describe, expect, it } from "vitest";
import {
  blankFilter,
  formatDropShadow,
  formatFilters,
  parseDropShadow,
  parseFilters,
} from "./filters";

describe("parseFilters", () => {
  it("treats none and empty as no filters", () => {
    expect(parseFilters("none")).toEqual([]);
    expect(parseFilters("")).toEqual([]);
  });

  it("preserves the authored unit rather than assuming one", () => {
    // The bug this exists to prevent: reading 1.2 and re-emitting `1.2%` turns
    // a 20% brightening into a 98% darkening.
    const parsed = parseFilters("brightness(1.2)");
    expect(parsed[0].value).toBe("1.2");
    expect(formatFilters(parsed)).toBe("brightness(1.2)");
  });

  it("round-trips a percentage unchanged", () => {
    expect(formatFilters(parseFilters("brightness(120%)"))).toBe(
      "brightness(120%)"
    );
  });

  it("keeps chain order across a round trip", () => {
    const css = "blur(4px) grayscale(50%) hue-rotate(90deg)";
    expect(formatFilters(parseFilters(css))).toBe(css);
  });

  it("parses every modelled function including the three naive parsers lack", () => {
    const css =
      "blur(1px) brightness(100%) contrast(100%) grayscale(100%) hue-rotate(0deg) invert(100%) opacity(50%) saturate(100%) sepia(100%)";
    const kinds = parseFilters(css).map((f) => f.kind);
    expect(kinds).toContain("grayscale");
    expect(kinds).toContain("opacity");
    expect(kinds).toHaveLength(9);
    expect(formatFilters(parseFilters(css))).toBe(css);
  });

  it("round-trips an unrecognised function verbatim and in place", () => {
    // Dropping `url(#goo)` would silently delete a filter for being unusual.
    const css = "blur(2px) url(#goo) saturate(150%)";
    const parsed = parseFilters(css);
    expect(parsed[1].kind).toBe("other");
    expect(formatFilters(parsed)).toBe(css);
  });

  it("keeps a drop-shadow's whole argument list", () => {
    const parsed = parseFilters("drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.5))");
    expect(parsed[0].kind).toBe("drop-shadow");
    // The comma-bearing colour must not have been split.
    expect(parsed[0].value).toBe("2px 4px 6px rgba(0, 0, 0, 0.5)");
    expect(formatFilters(parsed)).toBe(
      "drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.5))"
    );
  });

  it("drops disabled rows from the output but keeps their values", () => {
    const parsed = parseFilters("blur(4px) sepia(50%)");
    parsed[0].enabled = false;
    expect(formatFilters(parsed)).toBe("sepia(50%)");
    expect(parsed[0].value).toBe("4px");
  });

  it("serialises an empty or fully-disabled list as none", () => {
    expect(formatFilters([])).toBe("none");
    const parsed = parseFilters("blur(4px)");
    parsed[0].enabled = false;
    expect(formatFilters(parsed)).toBe("none");
  });
});

describe("blankFilter", () => {
  it("uses each function's own identity-ish default and unit", () => {
    expect(blankFilter("blur").value).toBe("4px");
    expect(blankFilter("brightness").value).toBe("100%");
    expect(blankFilter("hue-rotate").value).toBe("0deg");
    expect(blankFilter("grayscale").value).toBe("100%");
  });
});

describe("drop-shadow arguments", () => {
  it("takes lengths positionally and the remainder as the colour", () => {
    expect(parseDropShadow("2px 4px 6px #f00")).toEqual({
      blur: "6px",
      color: "#f00",
      x: "2px",
      y: "4px",
    });
  });

  it("handles the colour-first spelling", () => {
    expect(parseDropShadow("red 1px 2px")).toEqual({
      blur: "0",
      color: "red",
      x: "1px",
      y: "2px",
    });
  });

  it("round-trips", () => {
    const shadow = parseDropShadow("2px 4px 6px rgb(0 0 0 / 0.5)");
    expect(formatDropShadow(shadow)).toBe("2px 4px 6px rgb(0 0 0 / 0.5)");
  });
});
