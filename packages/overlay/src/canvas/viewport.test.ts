/**
 * `centerOn` and `fitToRect` — and really the safe-area shift underneath both.
 *
 * There was no test for `CanvasViewport` at all, which left `inSafe` uncovered:
 * the two lines that move an aim computed against the *size* of the uncovered
 * canvas onto its *position*. Every "take me there" in the editor goes through
 * them — the frame list, the minimap, ⇧1, ⇧2 — and getting them wrong does not
 * throw or look broken. It parks what you asked for underneath a dock, which
 * reads as the canvas being slightly off rather than as a bug.
 *
 * So the cases below are all about the inset. `fitTo` and `centerAt` centre
 * within a box whose origin is `(0, 0)`; with a 340px panel open, the answer
 * has to land in the middle of the 860px that is left, not the middle of the
 * 1200px window. The assertions are written as "where does this world point end
 * up on screen", through `worldToScreen`, rather than against hand-computed
 * transforms — a test written from the same algebra as the code would agree
 * with it while both were wrong.
 *
 * happy-dom does no layout, so the viewport's own rect is stubbed. That is the
 * only fake here: the transform arithmetic is the real thing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, type Rect, worldToScreen } from "./space";
import { CanvasViewport, type SafeInset } from "./viewport";

const WIDTH = 1200;
const HEIGHT = 800;

let viewport: CanvasViewport;
let inset: SafeInset;

/** Where a world point lands on screen, under the viewport as it stands. */
function screenOf(x: number, y: number): { x: number; y: number } {
  return worldToScreen(viewport.viewport, viewport.rect, { x, y });
}

/** The middle of the part no dock is covering. */
function safeCentre(): { x: number; y: number } {
  return {
    x: inset.left + (WIDTH - inset.left - inset.right) / 2,
    y: HEIGHT / 2,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  inset = { left: 0, right: 0 };
  viewport = new CanvasViewport({
    getContentRects: () => [],
    getSafeInset: () => inset,
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-test:viewport",
  });
  // The canvas is full-bleed and pinned at the window's origin.
  viewport.element.getBoundingClientRect = () =>
    ({
      bottom: HEIGHT,
      height: HEIGHT,
      left: 0,
      right: WIDTH,
      top: 0,
      width: WIDTH,
    }) as DOMRect;
});

describe("centerOn", () => {
  it("puts the point in the middle of the canvas when nothing is covering it", () => {
    viewport.set({ scale: 0.5, x: 0, y: 0 });
    viewport.centerOn({ x: 4000, y: 1000 });

    const at = screenOf(4000, 1000);
    expect(at.x).toBeCloseTo(WIDTH / 2, 3);
    expect(at.y).toBeCloseTo(HEIGHT / 2, 3);
  });

  it("aims at the uncovered canvas, not the window", () => {
    // The bug this exists to catch: with the frame list open, a click in it
    // would centre the frame under the panel it was clicked from.
    inset = { left: 348, right: 0 };
    viewport.set({ scale: 0.5, x: 0, y: 0 });
    viewport.centerOn({ x: 4000, y: 1000 });

    const at = screenOf(4000, 1000);
    expect(at.x).toBeCloseTo(safeCentre().x, 3);
    expect(at.x).toBeGreaterThan(inset.left);
  });

  it("keeps the zoom exactly", () => {
    // The whole reason this is not a fit: stepping through a list must not
    // change how close you are standing.
    for (const scale of [0.25, 1, 2.75]) {
      viewport.set({ scale, x: 0, y: 0 });
      viewport.centerOn({ x: 10, y: 10 });
      expect(viewport.scale).toBe(scale);
    }
  });

  it("is reachable from anywhere, at any zoom", () => {
    inset = { left: 348, right: 360 };
    viewport.set({ scale: 4, x: -99_999, y: -99_999 });
    viewport.centerOn({ x: 0, y: 0 });

    const at = screenOf(0, 0);
    expect(at.x).toBeCloseTo(safeCentre().x, 3);
    expect(at.y).toBeCloseTo(safeCentre().y, 3);
  });
});

describe("fitToRect", () => {
  const BOX: Rect = { height: 1024, left: 2000, top: 500, width: 1440 };

  it("centres the box in the uncovered canvas", () => {
    inset = { left: 348, right: 0 };
    viewport.fitToRect(BOX);

    const topLeft = screenOf(BOX.left, BOX.top);
    const bottomRight = screenOf(BOX.left + BOX.width, BOX.top + BOX.height);
    const mid = (topLeft.x + bottomRight.x) / 2;

    expect(mid).toBeCloseTo(safeCentre().x, 3);
    // …and the whole box is inside the part you can see.
    expect(topLeft.x).toBeGreaterThanOrEqual(inset.left);
    expect(bottomRight.x).toBeLessThanOrEqual(WIDTH);
  });

  it("scales to fit, and stops at 100% by default", () => {
    viewport.fitToRect(BOX);
    const topLeft = screenOf(BOX.left, BOX.top);
    const bottomRight = screenOf(BOX.left + BOX.width, BOX.top + BOX.height);

    expect(bottomRight.x - topLeft.x).toBeLessThanOrEqual(WIDTH);
    expect(bottomRight.y - topLeft.y).toBeLessThanOrEqual(HEIGHT);
    // A 1440×1024 box does not fit in 1200×800, so this is a genuine shrink.
    expect(viewport.scale).toBeLessThan(1);
  });

  it("does not magnify past 100% unless asked", () => {
    const tiny: Rect = { height: 24, left: 0, top: 0, width: 24 };
    viewport.fitToRect(tiny);
    expect(viewport.scale).toBe(1);

    viewport.fitToRect(tiny, 96, MAX_SCALE);
    expect(viewport.scale).toBeGreaterThan(1);
  });

  it("stays inside the zoom bounds", () => {
    const vast: Rect = { height: 400_000, left: 0, top: 0, width: 400_000 };
    viewport.fitToRect(vast);
    expect(viewport.scale).toBe(MIN_SCALE);
  });

  it("refuses a degenerate box rather than aiming at nothing", () => {
    viewport.set({ scale: 1.5, x: 12, y: 34 });
    viewport.fitToRect({ height: 0, left: 0, top: 0, width: 0 });

    // Untouched — a zero box has no centre, and `fitTo` would answer with the
    // identity, which would silently throw away where you were looking.
    expect(viewport.viewport).toEqual({ scale: 1.5, x: 12, y: 34 });
  });

  it("survives both docks covering almost everything", () => {
    // `safeRect` floors the uncovered strip at MIN_SAFE_W rather than letting a
    // negative width reach `fitTo`, which would produce a nonsense scale.
    inset = { left: 700, right: 700 };
    viewport.fitToRect(BOX);

    expect(Number.isFinite(viewport.scale)).toBe(true);
    expect(viewport.scale).toBeGreaterThan(0);
  });
});
