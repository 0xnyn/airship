import { describe, expect, it, vi } from "vitest";
import { cls } from "../dom";
import { blankShadow } from "./css-value";
import { createShadowList, shadowRow } from "./paint";

/*
 * The shape of a shadow row, which is the whole reason it was rebuilt.
 *
 * Four number fields across gave each of them 65px at the default dock width —
 * 39px of typable text after the glyph, about five characters, for values like
 * "-12.5px". The fix is not a track list with a minimum: with four equal
 * columns the count goes 4, 3, 2 as the panel narrows, and the three-wide band
 * (X, Y, Blur on one line, Spread orphaned under them) covers the default width
 * exactly. Pairing them in the DOM makes the *pair* the unit that wraps, so the
 * row is four across or a 2x2 and never 3+1 — which only holds while the pairs
 * are actually there, hence this.
 */

const row = () => shadowRow(blankShadow(), vi.fn());

const glyphs = (element: HTMLElement): string[] =>
  [...element.querySelectorAll(`.${cls("ctl-glyph-txt")}`)].map(
    (node) => node.textContent ?? ""
  );

describe("a shadow row", () => {
  it("groups its four numbers into two pairs", () => {
    const pairs = row().querySelectorAll(`.${cls("effect-pair")}`);
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.querySelectorAll(`.${cls("ctl-num")}`)).toHaveLength(2);
    }
  });

  it("pairs the offsets together and blur with spread", () => {
    const pairs = [
      ...row().querySelectorAll<HTMLElement>(`.${cls("effect-pair")}`),
    ];
    expect(glyphs(pairs[0])).toEqual(["X", "Y"]);
    expect(glyphs(pairs[1])).toEqual(["B", "S"]);
  });

  it("still offers all four, in order", () => {
    expect(glyphs(row())).toEqual(["X", "Y", "B", "S"]);
  });

  it("names its type and says the name opens something", () => {
    // It was a bare glyph with no caret — the only dropdown in the panel
    // without one — alone on a line that therefore said nothing.
    const kind = row().querySelector<HTMLElement>(`.${cls("effect-kind")}`);
    expect(kind?.textContent).toContain("Drop shadow");
    expect(kind?.querySelectorAll("svg")).toHaveLength(2);
  });

  it("hosts the list's own eye and minus on its header line", () => {
    /*
     * Beside the block they were centred on a 114px column — 57px down, in the
     * 2px gutter between the offsets and the blur, level with nothing. Worse,
     * the block shortens to 88px when the offsets fit four across, so the
     * anchor moved with the dock width.
     */
    const list = createShadowList("0 4px 8px #0003", vi.fn());
    const head = list.element.querySelector(`.${cls("effect-head")}`);
    const labels = [...(head?.querySelectorAll("button") ?? [])].map((b) =>
      b.getAttribute("aria-label")
    );
    expect(labels).toEqual(["Effect type: Drop shadow", "Hide", "Remove"]);
    // And nothing is left floating beside the row.
    const rowEl = list.element.querySelector(`.${cls("rows-row")}`);
    expect(rowEl?.children).toHaveLength(1);
  });

  it("names itself to a screen reader, and not twice to everyone else", () => {
    const kind = row().querySelector<HTMLElement>(`.${cls("effect-kind")}`);
    expect(kind?.getAttribute("aria-label")).toBe("Effect type: Drop shadow");
    // No tooltip: the button already reads "Drop shadow", so a tip repeated it
    // 6px lower, over the offsets it heads.
    expect(kind?.dataset.tip).toBeUndefined();
  });
});
