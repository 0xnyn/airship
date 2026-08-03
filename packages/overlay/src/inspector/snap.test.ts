import { describe, expect, it } from "vitest";
import type { Rect } from "../canvas/space";
import { edgeTargets, nearest, sizeTargets, snapAxis } from "./snap";

function rect(left: number, top: number, width: number, height: number): Rect {
  return { height, left, top, width };
}

/** A 400×200 content box at (100, 50), holding two 120-wide children. */
const parent = rect(100, 50, 400, 200);
const siblings = [rect(100, 50, 120, 60), rect(240, 50, 120, 60)];

describe("edgeTargets", () => {
  it("offers both edges and the centre of every reference", () => {
    const targets = edgeTargets(parent, siblings, true);
    const values = targets.map((t) => t.value);
    // Parent: 100, 500, 300. First sibling: 100, 220, 160. Second: 240, 360, 300.
    expect(values).toEqual([100, 500, 300, 100, 220, 160, 240, 360, 300]);
    expect(targets.filter((t) => t.center)).toHaveLength(3);
  });

  it("reads the vertical axis when asked for it", () => {
    const targets = edgeTargets(parent, [], false);
    expect(targets.map((t) => t.value)).toEqual([50, 250, 150]);
  });

  it("labels where each candidate came from", () => {
    const targets = edgeTargets(parent, siblings, true);
    expect(targets.slice(0, 3).every((t) => t.source === "parent")).toBe(true);
    expect(targets.slice(3).every((t) => t.source === "sibling")).toBe(true);
  });
});

describe("sizeTargets", () => {
  it("offers the parent's content extent and each sibling's", () => {
    expect(sizeTargets(parent, siblings, true).map((t) => t.value)).toEqual([
      400, 120, 120,
    ]);
    expect(sizeTargets(parent, siblings, false).map((t) => t.value)).toEqual([
      200, 60, 60,
    ]);
  });
});

describe("nearest", () => {
  const targets = edgeTargets(parent, siblings, true);

  it("finds a candidate inside the tolerance", () => {
    expect(nearest(223, targets, 5)?.value).toBe(220);
  });

  it("returns nothing outside it", () => {
    expect(nearest(228, targets, 5)).toBeNull();
  });

  it("matches exactly at the boundary", () => {
    expect(nearest(225, targets, 5)?.value).toBe(220);
    expect(nearest(226, targets, 5)).toBeNull();
  });

  it("prefers the parent when a sibling ties with it", () => {
    // 100 is both the parent's left edge and the first sibling's — landing on
    // the container is what was meant, and it is the match that can be a fill.
    expect(nearest(100, targets, 5)?.source).toBe("parent");
  });

  it("still takes a strictly closer sibling", () => {
    // The parent's centre and the second sibling's right edge are both 300.
    expect(nearest(361, targets, 5)?.value).toBe(360);
    expect(nearest(361, targets, 5)?.source).toBe("sibling");
  });
});

describe("snapAxis", () => {
  const edges = edgeTargets(parent, siblings, true);
  const sizes = sizeTargets(parent, siblings, true);
  const base = { edges, forward: true, sizes, threshold: 5 };

  it("pulls a growing east edge onto a sibling's edge", () => {
    // Anchored at the parent's left, 218 wide → right edge at 318. Nothing is
    // within 5 of 318, so nothing moves.
    expect(snapAxis({ ...base, anchor: 100, size: 218 }).size).toBe(218);
    // 118 wide → right edge at 218, two away from the sibling edge at 220.
    const snapped = snapAxis({ ...base, anchor: 100, size: 118 });
    expect(snapped.size).toBe(120);
    expect(snapped.match?.kind).toBe("edge");
  });

  it("pulls a shrinking west edge the other way", () => {
    // Anchored at the parent's right (500), so the moving edge is 500 − size.
    const snapped = snapAxis({
      ...base,
      anchor: 500,
      forward: false,
      size: 258,
    });
    // Left edge lands at 242, two from the second sibling's left at 240.
    expect(snapped.size).toBe(260);
    expect(snapped.match?.target.value).toBe(240);
  });

  it("reports a fill however the element got there", () => {
    // Anchored on the parent's left edge, so growing to 400 lands the moving
    // edge on the parent's right edge *and* matches the parent's width. Which
    // rule wins is an implementation detail; that it counts as a fill is not.
    const viaEdge = snapAxis({ ...base, anchor: 100, size: 397 });
    expect(viaEdge.size).toBe(400);
    expect(viaEdge.fill).toBe(true);

    // The same width reached from somewhere no edge is reachable from — only
    // the size can match here, and it still reports a fill.
    const viaSize = snapAxis({ ...base, anchor: 9000, size: 402 });
    expect(viaSize.size).toBe(400);
    expect(viaSize.fill).toBe(true);
    expect(viaSize.match?.kind).toBe("size");
  });

  it("does not call a sibling-width match a fill", () => {
    const snapped = snapAxis({ ...base, anchor: 900, size: 122 });
    expect(snapped.size).toBe(120);
    expect(snapped.fill).toBe(false);
    expect(snapped.match?.kind).toBe("size");
  });

  it("takes whichever match moves the element less", () => {
    // Anchored far from anything, so no edge is reachable; only the size can
    // match, which proves the two are considered independently.
    const snapped = snapAxis({ ...base, anchor: 9000, size: 401 });
    expect(snapped.match?.kind).toBe("size");
    expect(snapped.size).toBe(400);
  });

  it("does nothing at all when snapping is switched off", () => {
    const snapped = snapAxis({ ...base, anchor: 100, size: 118, threshold: 0 });
    expect(snapped.size).toBe(118);
    expect(snapped.match).toBeNull();
    expect(snapped.fill).toBe(false);
  });

  it("never produces a zero or negative size", () => {
    // The moving edge would land exactly on the anchor.
    const snapped = snapAxis({
      ...base,
      anchor: 100,
      size: 2,
      threshold: 5,
    });
    expect(snapped.size).toBeGreaterThanOrEqual(1);
  });
});
