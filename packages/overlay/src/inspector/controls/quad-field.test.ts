import { describe, expect, it, vi } from "vitest";
import { cls } from "../../dom";
import { createQuadField, type QuadSpec } from "./quad-field";

/*
 * The mode a quad field is in, as the stylesheet reads it.
 *
 * Split, this control is four fields, and four of them do not fit a 2x2 inside
 * the half-width grid cell Appearance gives it — so `.grid > .pad-row[data-mode
 * ="sides"]` promotes it to the whole row. That rule is the only thing standing
 * between the corner radius control and four ~59px fields, and it is keyed to
 * an attribute nothing else asserts.
 */

const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];

function spec(): QuadSpec {
  return {
    collapsed: { glyph: "corner-tl", label: "Corner radius" },
    sides: CORNERS.map((corner) => ({
      glyph: "corner-tl" as const,
      label: corner,
      property: `border-${corner}-radius`,
    })),
    toggle: { glyph: "corners-independent", label: "Independent corners" },
  };
}

/** The four longhands, all at `value` unless `overrides` says otherwise. */
function values(value: string, overrides: Record<string, string> = {}) {
  return new Map(
    CORNERS.map((corner) => {
      const property = `border-${corner}-radius`;
      return [property, overrides[property] ?? value];
    })
  );
}

const modeOf = (element: HTMLElement): string | undefined =>
  element.dataset.mode;

const fieldCount = (element: HTMLElement): number =>
  element.querySelectorAll(`.${cls("ctl-num")}`).length;

describe("a quad field's published mode", () => {
  it("is collapsed when the sides agree", () => {
    const control = createQuadField(spec(), values("8px"), vi.fn());
    expect(modeOf(control.element)).toBe("one");
    // Collapsed really is one field, which is why .pad-fields uses auto-fit:
    // a lone child in a fixed two-track grid took half the box.
    expect(fieldCount(control.element)).toBe(1);
  });

  it("is split when they disagree", () => {
    const control = createQuadField(
      spec(),
      values("8px", { "border-top-left-radius": "2px" }),
      vi.fn()
    );
    expect(modeOf(control.element)).toBe("sides");
    expect(fieldCount(control.element)).toBe(4);
  });

  it("follows the toggle", () => {
    const control = createQuadField(spec(), values("8px"), vi.fn());
    control.element
      .querySelector<HTMLElement>(`.${cls("pad-mode")}`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modeOf(control.element)).toBe("sides");
    expect(fieldCount(control.element)).toBe(4);
  });

  it("follows a re-seed that changes the shape", () => {
    // An undo re-seeds rather than rebuilding. The mode has to move with it,
    // or the promotion rule holds the panel in the wrong layout.
    const control = createQuadField(spec(), values("8px"), vi.fn());
    control.setValue?.("border-top-left-radius", "2px");
    expect(modeOf(control.element)).toBe("sides");
    control.setValue?.("border-top-left-radius", "8px");
    expect(modeOf(control.element)).toBe("one");
  });
});
