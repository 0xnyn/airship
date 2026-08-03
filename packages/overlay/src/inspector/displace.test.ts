import { describe, expect, it } from "vitest";
import type { Rect } from "../canvas/space";
import { occupiedSpan, shifts } from "./displace";

/** A vertical stack of `count` boxes, `size` tall, separated by `gap`. */
function column(count: number, size: number, gap: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    height: size,
    left: 0,
    top: i * (size + gap),
    width: 100,
  }));
}

/** The same, laid out along the horizontal axis. */
function row(count: number, size: number, gap: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    height: 40,
    left: i * (size + gap),
    top: 0,
    width: size,
  }));
}

describe("occupiedSpan", () => {
  it("includes the gap after the element", () => {
    // The hole an element leaves is its own extent plus the gap that collapses
    // with it — using the height alone leaves every sibling one gap short.
    expect(occupiedSpan(column(3, 50, 16), 0, false)).toBe(66);
  });

  it("measures the horizontal axis the same way", () => {
    expect(occupiedSpan(row(3, 80, 12), 1, true)).toBe(92);
  });

  it("falls back to the gap in front for the last child", () => {
    // No next sibling to measure against, so the distance is recovered from the
    // other side — same answer, arrived at backwards.
    expect(occupiedSpan(column(3, 50, 16), 2, false)).toBe(66);
  });

  it("handles a run with no gap at all", () => {
    expect(occupiedSpan(column(3, 40, 0), 0, false)).toBe(40);
    expect(occupiedSpan(column(3, 40, 0), 2, false)).toBe(40);
  });

  it("returns zero for a lone child, which has nothing to displace", () => {
    expect(occupiedSpan(column(1, 50, 16), 0, false)).toBe(0);
  });

  it("returns zero for an index that is not there", () => {
    expect(occupiedSpan(column(2, 50, 16), 7, false)).toBe(0);
  });
});

describe("shifts", () => {
  const span = 66;

  it("moves nothing when the element would land where it already is", () => {
    expect(shifts(4, 1, 1, span)).toEqual([0, 0, 0, 0]);
    // Dropping *before the next sibling* is the same position, said differently.
    expect(shifts(4, 1, 2, span)).toEqual([0, 0, 0, 0]);
  });

  it("closes the gap behind an element moving later", () => {
    // A → [B, C] → D becomes B, C, A, D: B and C each slide one place earlier.
    expect(shifts(4, 0, 3, span)).toEqual([0, -span, -span, 0]);
  });

  it("opens a gap in front of an element moving earlier", () => {
    // D moves to the front: A, B and C each slide one place later.
    expect(shifts(4, 3, 0, span)).toEqual([span, span, span, 0]);
  });

  it("moves everything after the drag when appending to the end", () => {
    expect(shifts(3, 0, 3, span)).toEqual([0, -span, -span]);
  });

  it("moves only the siblings between the two positions", () => {
    expect(shifts(5, 1, 4, span)).toEqual([0, 0, -span, -span, 0]);
    expect(shifts(5, 3, 1, span)).toEqual([0, span, span, 0, 0]);
  });

  it("never moves the dragged element itself", () => {
    for (const drop of [0, 1, 2, 3, 4]) {
      expect(shifts(4, 2, drop, span)[2]).toBe(0);
    }
  });

  it("does nothing when there is no space to reclaim", () => {
    expect(shifts(4, 0, 3, 0)).toEqual([0, 0, 0, 0]);
  });
});
