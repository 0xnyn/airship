import { describe, expect, it } from "vitest";
import { hasBounds, hasFill, hasStroke, type Reader } from "./gates";

/** A reader over a fixed map, standing in for pending-then-computed. */
function reads(values: Record<string, string>): Reader {
  return (property) => values[property] ?? "";
}

describe("hasFill", () => {
  it("is true for an opaque colour", () => {
    expect(hasFill(reads({ "background-color": "rgb(255, 0, 0)" }))).toBe(true);
  });

  it("is false for a fully transparent one", () => {
    // What computed style reports for "no background": showing `000000 / 0%`
    // for every unstyled div is technically true and reads as a bug.
    expect(hasFill(reads({ "background-color": "rgba(0, 0, 0, 0)" }))).toBe(
      false
    );
  });

  it("understands the `transparent` keyword a pending edit writes", () => {
    // Computed style never says `transparent`, but the remove button does — and
    // the gate now reads pending values, so both spellings reach it.
    expect(hasFill(reads({ "background-color": "transparent" }))).toBe(false);
  });

  it("is true for a partly transparent colour", () => {
    expect(hasFill(reads({ "background-color": "rgba(255, 0, 0, 0.2)" }))).toBe(
      true
    );
  });

  it("is false when there is nothing to read", () => {
    expect(hasFill(reads({}))).toBe(false);
  });

  it("does not drop a colour it cannot parse", () => {
    // `oklch()` in an environment whose engine will not resolve it. Refusing to
    // parse a colour is not evidence that there is no fill, and treating it as
    // such would delete the row.
    expect(hasFill(reads({ "background-color": "oklch(0.7 0.15 250)" }))).toBe(
      true
    );
  });
});

describe("hasStroke", () => {
  it("follows the border style", () => {
    expect(hasStroke(reads({ "border-top-style": "solid" }))).toBe(true);
    expect(hasStroke(reads({ "border-top-style": "none" }))).toBe(false);
  });
});

describe("hasBounds", () => {
  it("is true once any min or max is set", () => {
    expect(hasBounds(reads({ "min-width": "200px" }))).toBe(true);
    expect(hasBounds(reads({ "max-height": "40rem" }))).toBe(true);
  });

  it("ignores the values that mean `unset`", () => {
    expect(
      hasBounds(
        reads({
          "max-height": "none",
          "max-width": "none",
          "min-height": "auto",
          "min-width": "0px",
        })
      )
    ).toBe(false);
  });

  it("is false for an element with none of them", () => {
    expect(hasBounds(reads({}))).toBe(false);
  });
});
