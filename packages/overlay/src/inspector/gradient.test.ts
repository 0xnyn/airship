import { describe, expect, it } from "vitest";
import {
  angleOf,
  formatGradient,
  type Gradient,
  isGradient,
  parseGradient,
  reverse,
  sortedStops,
} from "./gradient";

/** Parse and re-serialise. Returns "" when the parse declined, so the caller's
 * own assertion reports the mismatch rather than a helper throwing out of band. */
function roundTrip(css: string): string {
  const parsed = parseGradient(css);
  return parsed ? formatGradient(parsed) : "";
}

describe("parseGradient / formatGradient", () => {
  it("round-trips all three gradient types", () => {
    for (const css of [
      "linear-gradient(45deg, #fff 0%, #000 100%)",
      "radial-gradient(circle, #fff 0%, #000 100%)",
      "conic-gradient(from 45deg, #fff 0%, #000 100%)",
    ]) {
      expect(roundTrip(css)).toBe(css);
    }
  });

  it("round-trips the repeating variants", () => {
    for (const css of [
      "repeating-linear-gradient(90deg, #fff 0px, #000 10px)",
      "repeating-radial-gradient(circle, #fff 0%, #000 20%)",
      "repeating-conic-gradient(from 0deg, #fff 0%, #000 25%)",
    ]) {
      expect(roundTrip(css)).toBe(css);
    }
  });

  it("preserves a radial's shape, extent and position", () => {
    // A naive parser discards all three; losing `at 30% 40%` moves the gradient.
    const css =
      "radial-gradient(ellipse farthest-corner at 30% 40%, #fff 0%, #000 100%)";
    expect(roundTrip(css)).toBe(css);
  });

  it("preserves to-side keywords rather than converting them", () => {
    expect(roundTrip("linear-gradient(to bottom right, #fff, #000)")).toBe(
      "linear-gradient(to bottom right, #fff, #000)"
    );
  });

  it("preserves angle units as authored", () => {
    for (const css of [
      "linear-gradient(0.25turn, #fff, #000)",
      "linear-gradient(1.5708rad, #fff, #000)",
      "linear-gradient(100grad, #fff, #000)",
      "linear-gradient(-45deg, #fff, #000)",
    ]) {
      expect(roundTrip(css)).toBe(css);
    }
  });

  it("keeps stop positions in whatever unit they were written", () => {
    // Rounding these to whole percentages is silent data loss.
    const css = "linear-gradient(90deg, #fff 0px, #aaa 2.5rem, #000 100%)";
    expect(roundTrip(css)).toBe(css);
  });

  it("keeps double-position stops (hard colour bands)", () => {
    const css = "linear-gradient(90deg, #fff 20% 40%, #000 60% 80%)";
    expect(roundTrip(css)).toBe(css);
  });

  it("keeps stops with no position at all", () => {
    expect(roundTrip("linear-gradient(#fff, #000)")).toBe(
      "linear-gradient(#fff, #000)"
    );
  });

  it("does not split a comma-bearing colour function", () => {
    const css = "linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #fff 100%)";
    const parsed = parseGradient(css);
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0].color).toBe("rgba(0, 0, 0, 0.5)");
    expect(roundTrip(css)).toBe(css);
  });

  it("returns null for anything that is not a gradient", () => {
    expect(parseGradient("url(cat.png)")).toBeNull();
    expect(parseGradient("none")).toBeNull();
    expect(parseGradient("#fff")).toBeNull();
  });

  it("returns null rather than mangle a one-stop gradient", () => {
    // The caller keeps the original text when this happens.
    expect(parseGradient("linear-gradient(90deg, red)")).toBeNull();
  });
});

describe("isGradient", () => {
  it("recognises every spelling, including repeating and conic", () => {
    expect(isGradient("linear-gradient(#fff, #000)")).toBe(true);
    expect(isGradient("conic-gradient(#fff, #000)")).toBe(true);
    expect(isGradient("repeating-radial-gradient(#fff, #000)")).toBe(true);
    expect(isGradient("url(x.png)")).toBe(false);
  });
});

describe("angleOf", () => {
  const at = (css: string): number | null =>
    angleOf(parseGradient(css) as Gradient);

  it("converts every angle unit to degrees", () => {
    expect(at("linear-gradient(0.25turn, #fff, #000)")).toBe(90);
    expect(at("linear-gradient(100grad, #fff, #000)")).toBe(90);
    expect(at("linear-gradient(90deg, #fff, #000)")).toBe(90);
    expect(at("linear-gradient(1.5707963rad, #fff, #000)")).toBeCloseTo(90, 4);
  });

  it("normalizes negatives into 0–360", () => {
    expect(at("linear-gradient(-45deg, #fff, #000)")).toBe(315);
  });

  it("resolves to-side keywords", () => {
    expect(at("linear-gradient(to right, #fff, #000)")).toBe(90);
    expect(at("linear-gradient(to top, #fff, #000)")).toBe(0);
    expect(at("linear-gradient(to bottom left, #fff, #000)")).toBe(225);
  });

  it("uses the CSS default when no angle is given", () => {
    expect(at("linear-gradient(#fff, #000)")).toBe(180);
    expect(at("conic-gradient(#fff, #000)")).toBe(0);
  });

  it("has no angle for a radial gradient", () => {
    expect(at("radial-gradient(circle, #fff, #000)")).toBeNull();
  });
});

describe("stop ordering", () => {
  it("sorts by rendered position, not authored order", () => {
    const parsed = parseGradient(
      "linear-gradient(90deg, #f00 80%, #0f0 10%, #00f 50%)"
    ) as Gradient;
    expect(sortedStops(parsed).map((s) => s.color)).toEqual([
      "#0f0",
      "#00f",
      "#f00",
    ]);
  });

  it("reverses the ramp", () => {
    const parsed = parseGradient(
      "linear-gradient(90deg, #fff 0%, #000 100%)"
    ) as Gradient;
    const flipped = reverse(parsed);
    expect(flipped.stops.map((s) => `${s.color} ${s.position}`)).toEqual([
      "#000 0%",
      "#fff 100%",
    ]);
  });
});
