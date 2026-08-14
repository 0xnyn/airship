import { describe, expect, it } from "vitest";
import { expandShorthands, stripStates } from "./cascade";

function expand(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(expandShorthands(new Map(Object.entries(input))));
}

describe("expandShorthands", () => {
  it("fans a one-value box shorthand out to four sides", () => {
    expect(expand({ padding: "10px" })).toEqual({
      "padding-bottom": "10px",
      "padding-left": "10px",
      "padding-right": "10px",
      "padding-top": "10px",
    });
  });

  it("applies the 2-value rule as vertical / horizontal", () => {
    expect(expand({ margin: "10px 20px" })).toEqual({
      "margin-bottom": "10px",
      "margin-left": "20px",
      "margin-right": "20px",
      "margin-top": "10px",
    });
  });

  it("applies the 3-value rule as top / horizontal / bottom", () => {
    expect(expand({ padding: "1px 2px 3px" })).toEqual({
      "padding-bottom": "3px",
      "padding-left": "2px",
      "padding-right": "2px",
      "padding-top": "1px",
    });
  });

  it("applies the 4-value rule clockwise from the top", () => {
    expect(expand({ padding: "1px 2px 3px 4px" })).toEqual({
      "padding-bottom": "3px",
      "padding-left": "4px",
      "padding-right": "2px",
      "padding-top": "1px",
    });
  });

  it("expands border-radius clockwise from the TOP LEFT, not T/R/B/L", () => {
    // The corner order differs from every other box shorthand. Getting it wrong
    // swaps two corners and looks like a rendering glitch, not a parser bug.
    expect(expand({ "border-radius": "1px 2px 3px 4px" })).toEqual({
      "border-bottom-left-radius": "4px",
      "border-bottom-right-radius": "3px",
      "border-top-left-radius": "1px",
      "border-top-right-radius": "2px",
    });
  });

  it("keeps only the horizontal half of an elliptical radius", () => {
    expect(expand({ "border-radius": "10px / 20px" })).toEqual({
      "border-bottom-left-radius": "10px",
      "border-bottom-right-radius": "10px",
      "border-top-left-radius": "10px",
      "border-top-right-radius": "10px",
    });
  });

  it("expands gap to row-gap and column-gap", () => {
    expect(expand({ gap: "4px 8px" })).toEqual({
      "column-gap": "8px",
      "row-gap": "4px",
    });
    expect(expand({ gap: "4px" })).toEqual({
      "column-gap": "4px",
      "row-gap": "4px",
    });
  });

  it("lets an explicit longhand win over the shorthand", () => {
    // The author wrote both; the specific one is what they meant.
    expect(expand({ padding: "10px", "padding-top": "99px" })).toEqual({
      "padding-bottom": "10px",
      "padding-left": "10px",
      "padding-right": "10px",
      "padding-top": "99px",
    });
  });

  it("expands border-width and border-color", () => {
    expect(expand({ "border-width": "1px 2px" })).toEqual({
      "border-bottom-width": "1px",
      "border-left-width": "2px",
      "border-right-width": "2px",
      "border-top-width": "1px",
    });
    expect(expand({ "border-color": "red" })).toEqual({
      "border-bottom-color": "red",
      "border-left-color": "red",
      "border-right-color": "red",
      "border-top-color": "red",
    });
  });

  it("leaves non-shorthand declarations alone", () => {
    expect(expand({ color: "red", "padding-top": "4px" })).toEqual({
      color: "red",
      "padding-top": "4px",
    });
  });

  /*
   * `border`'s three parts are order-independent and all optional, so each word
   * is classified rather than positioned — and a `var()` is the one word that
   * could be any of them.
   *
   * `LOOKS_LIKE_LENGTH` matches `^var\(`, which it has to: `border-width:
   * var(--w)` is ordinary. But so is `border: 1px solid var(--border)`, and
   * there the `var()` is the *colour*. With no guard the last matching word won,
   * so `var(--border)` overwrote the `1px` and the colour was dropped entirely —
   * a forced-state preview for such a rule got `border-*-width: var(--border)`
   * and no colour at all.
   */
  it("does not let a var() colour overwrite the border width", () => {
    expect(expand({ border: "1px solid var(--border)" })).toEqual({
      "border-bottom-color": "var(--border)",
      "border-bottom-style": "solid",
      "border-bottom-width": "1px",
      "border-left-color": "var(--border)",
      "border-left-style": "solid",
      "border-left-width": "1px",
      "border-right-color": "var(--border)",
      "border-right-style": "solid",
      "border-right-width": "1px",
      "border-top-color": "var(--border)",
      "border-top-style": "solid",
      "border-top-width": "1px",
    });
  });

  it("still reads a lone var() as the width, which is the ambiguous case", () => {
    // Nothing in the string says which slot it fills, and first-wins puts it in
    // the one a single `var()` most often means.
    expect(expand({ "border-top": "var(--w) solid" })).toEqual({
      "border-top-style": "solid",
      "border-top-width": "var(--w)",
    });
  });

  it("keeps a calc() width beside a var() colour", () => {
    // `calc(` is in the same regex as `var(` and took the same wrong branch.
    expect(expand({ "border-top": "calc(1px + 1px) dashed var(--c)" })).toEqual(
      {
        "border-top-color": "var(--c)",
        "border-top-style": "dashed",
        "border-top-width": "calc(1px + 1px)",
      }
    );
  });
});

describe("stripStates", () => {
  it("removes a trailing state", () => {
    expect(stripStates(".btn:hover")).toBe(".btn");
  });

  it("removes a state from the middle of a descendant selector", () => {
    expect(stripStates(".card:hover .title")).toBe(".card .title");
  });

  it("removes every state in a compound", () => {
    expect(stripStates(".btn:hover:focus")).toBe(".btn");
  });

  it("leaves other pseudo-classes intact", () => {
    // `:first-child` is structural — stripping it would change what matches.
    expect(stripStates(".item:first-child")).toBe(".item:first-child");
  });
});
