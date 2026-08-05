import type { DesignToken, TokenScanResult } from "@airship/protocol/tokens";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `match.ts` reads the root font size through `realm` to convert rem to px.
// A 16px root is the browser default and the only thing these cases need.
vi.mock("../realm", () => ({
  computedStyle: () => ({ fontSize: "16px", getPropertyValue: () => "" }),
  ownerDocument: () => null,
  ownerWindow: () => null,
}));

import { toPx } from "../inspector/css-length";
import { findToken, hasTokensFor } from "./match";
import { setStaticTokens } from "./registry";

function token(
  name: string,
  value: string,
  category: DesignToken["category"] = "spacing"
): DesignToken {
  return {
    category,
    kind: "css-var",
    name,
    origin: "static",
    values: { "": value },
  };
}

function load(tokens: DesignToken[]): void {
  setStaticTokens({ framework: "custom", tokens } as TokenScanResult);
}

describe("toPx", () => {
  it("passes px through and converts rem against the root size", () => {
    expect(toPx("16px")).toBe(16);
    expect(toPx("1rem")).toBe(16);
    expect(toPx("1.5rem")).toBe(24);
  });

  it("rejects values with no comparable length", () => {
    expect(toPx("auto")).toBeNull();
    expect(toPx("50%")).toBeNull();
    expect(toPx("#fff")).toBeNull();
  });
});

describe("findToken", () => {
  beforeEach(() => {
    load([
      token("--space-1", "4px"),
      token("--space-2", "8px"),
      token("--space-3", "12px"),
      token("--space-4", "16px"),
      token("--brand", "#0af", "colors"),
    ]);
  });

  it("returns an exact match as exact", () => {
    const ref = findToken("padding-top", "16px");
    expect(ref?.name).toBe("--space-4");
    expect(ref?.exact).toBe(true);
    expect(ref?.actual).toBeUndefined();
  });

  it("matches across units — the bug a parseFloat comparison has", () => {
    // A rem-based scale against a px computed value is the common case, and a
    // unit-blind comparison never matches any of it.
    load([token("--space-4", "1rem")]);
    const ref = findToken("padding-top", "16px");
    expect(ref?.name).toBe("--space-4");
    expect(ref?.exact).toBe(true);
  });

  it("offers the nearest token as a suggestion, with its real value", () => {
    const ref = findToken("gap", "13px");
    expect(ref?.name).toBe("--space-3");
    expect(ref?.exact).toBe(false);
    // The actual value is what lets the prompt phrase it as a question.
    expect(ref?.actual).toBe("12px");
  });

  it("stays silent past the tolerance", () => {
    // 40px is nowhere near a 16px top-of-scale; max(2, 10%) = 4px.
    expect(findToken("gap", "40px")).toBeUndefined();
  });

  it("uses the relative tolerance on larger values", () => {
    load([token("--space-10", "100px")]);
    // Within 10%.
    expect(findToken("gap", "108px")?.exact).toBe(false);
    // Outside it.
    expect(findToken("gap", "120px")).toBeUndefined();
  });

  it("never approximates a colour", () => {
    // A near-miss hex is a different colour, not an approximation of one.
    expect(findToken("color", "#0af")?.name).toBe("--brand");
    expect(findToken("color", "#0ab")).toBeUndefined();
  });

  it("does not offer a token from another category", () => {
    // `--space-4` is 16px and so is a 16px font-size, but they are not the
    // same scale and swapping one for the other would be wrong.
    expect(findToken("font-size", "16px")).toBeUndefined();
  });

  it("returns nothing for a property no token category covers", () => {
    expect(findToken("cursor", "pointer")).toBeUndefined();
  });
});

describe("hasTokensFor", () => {
  it("gates the badge on the category actually having tokens", () => {
    load([token("--space-4", "16px")]);
    expect(hasTokensFor("padding-top")).toBe(true);
    expect(hasTokensFor("font-size")).toBe(false);
    expect(hasTokensFor("cursor")).toBe(false);
  });
});
