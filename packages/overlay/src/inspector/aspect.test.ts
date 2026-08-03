import { describe, expect, it } from "vitest";
import { constrain, shouldConstrain } from "./aspect";

/** A stand-in element: `shouldConstrain` only reads `tagName`. */
function node(tagName: string): Element {
  return { tagName } as Element;
}

describe("shouldConstrain", () => {
  it("holds proportions on media by default, and frees them with Shift", () => {
    for (const tag of ["IMG", "VIDEO", "PICTURE", "CANVAS", "SVG"]) {
      expect(shouldConstrain(node(tag), "se", false)).toBe(true);
      expect(shouldConstrain(node(tag), "se", true)).toBe(false);
      // Media is constrained on edges too, not only corners.
      expect(shouldConstrain(node(tag), "e", false)).toBe(true);
    }
  });

  it("leaves an ordinary element free by default", () => {
    expect(shouldConstrain(node("DIV"), "se", false)).toBe(false);
    expect(shouldConstrain(node("DIV"), "e", false)).toBe(false);
  });

  it("constrains an unlocked element only on corners, only with Shift", () => {
    expect(shouldConstrain(node("DIV"), "se", true)).toBe(true);
    // An edge drag that silently changed the other axis would be surprising.
    expect(shouldConstrain(node("DIV"), "e", true)).toBe(false);
    expect(shouldConstrain(node("DIV"), "n", true)).toBe(false);
  });
});

describe("constrain", () => {
  const ratio = 2; // 2:1, width ÷ height

  it("follows the axis that moved further on a corner", () => {
    // Width grew a lot, height barely: width should drive.
    expect(constrain(400, 110, ratio, "se")).toEqual({
      height: 200,
      width: 400,
    });
    // Height grew a lot, width barely: height should drive.
    expect(constrain(210, 300, ratio, "se")).toEqual({
      height: 300,
      width: 600,
    });
  });

  it("lets the dragged axis drive on an edge", () => {
    expect(constrain(400, 999, ratio, "e")).toEqual({
      height: 200,
      width: 400,
    });
    expect(constrain(999, 300, ratio, "s")).toEqual({
      height: 300,
      width: 600,
    });
    expect(constrain(400, 999, ratio, "w")).toEqual({
      height: 200,
      width: 400,
    });
    expect(constrain(999, 300, ratio, "n")).toEqual({
      height: 300,
      width: 600,
    });
  });

  it("preserves the ratio exactly, without rounding drift", () => {
    const out = constrain(333, 1000, 16 / 9, "e");
    expect(out.width / out.height).toBeCloseTo(16 / 9, 10);
  });
});
