/**
 * The coordinate module had no test at all, which is a strange gap for the one
 * file the overlay allows to do arithmetic — every outline, handle and drop
 * indicator on the canvas is placed by something in here.
 *
 * The cases below are the ones the minimap forced into the open. `projectInto`
 * exists because reaching for `fitTo` instead is a real, silent bug: `fitTo`
 * clamps to `MIN_SCALE`, so projecting a wide canvas into a small card returned
 * 0.1 and drew frames several times wider than the card holding them, with no
 * error anywhere. `visibleWorldRect` is asserted against `worldToScreen` rather
 * than against hand-computed numbers, because the property that matters is that
 * the two are inverses — a version that agreed with neither the transform nor
 * itself would still pass a literal-value test written from the same wrong
 * algebra.
 */

import { describe, expect, it } from "vitest";
import {
  centerAt,
  fitTo,
  MIN_SCALE,
  projectInto,
  type Rect,
  screenToWorld,
  type Viewport,
  visibleWorldRect,
  worldToScreen,
} from "./space";

const ORIGIN: Rect = { height: 800, left: 0, top: 0, width: 1200 };

/** A canvas viewport element that does not sit at the window's top-left. */
const OFFSET: Rect = { height: 800, left: 40, top: 24, width: 1200 };

describe("visibleWorldRect", () => {
  it("is the inverse of worldToScreen at the viewport's corners", () => {
    const vp: Viewport = { scale: 0.35, x: -220, y: 140 };
    const world = visibleWorldRect(vp, OFFSET);

    const topLeft = worldToScreen(vp, OFFSET, {
      x: world.left,
      y: world.top,
    });
    const bottomRight = worldToScreen(vp, OFFSET, {
      x: world.left + world.width,
      y: world.top + world.height,
    });

    expect(topLeft.x).toBeCloseTo(OFFSET.left, 6);
    expect(topLeft.y).toBeCloseTo(OFFSET.top, 6);
    expect(bottomRight.x).toBeCloseTo(OFFSET.left + OFFSET.width, 6);
    expect(bottomRight.y).toBeCloseTo(OFFSET.top + OFFSET.height, 6);
  });

  it("widens as the zoom goes out", () => {
    const near = visibleWorldRect({ scale: 1, x: 0, y: 0 }, ORIGIN);
    const far = visibleWorldRect({ scale: 0.25, x: 0, y: 0 }, ORIGIN);

    expect(near.width).toBe(1200);
    // A quarter of the zoom shows four times the world.
    expect(far.width).toBe(4800);
    expect(far.height).toBe(3200);
  });

  it("tracks the pan, in world units", () => {
    // Panning the world 300 screen px left at 0.5× moved us 600 world units right.
    const vp: Viewport = { scale: 0.5, x: -300, y: -150 };
    const world = visibleWorldRect(vp, ORIGIN);

    expect(world.left).toBe(600);
    expect(world.top).toBe(300);
  });
});

describe("centerAt", () => {
  it("puts the point at the middle of the box", () => {
    const vp = centerAt({ x: 900, y: 400 }, ORIGIN, 0.5);
    const screen = worldToScreen(vp, ORIGIN, { x: 900, y: 400 });

    expect(screen.x).toBeCloseTo(ORIGIN.width / 2, 6);
    expect(screen.y).toBeCloseTo(ORIGIN.height / 2, 6);
  });

  it("leaves the scale exactly as given", () => {
    // The whole point of centre-vs-fit: going somewhere must not change how
    // close you are standing.
    expect(centerAt({ x: 10, y: 10 }, ORIGIN, 2.5).scale).toBe(2.5);
    expect(centerAt({ x: 10, y: 10 }, ORIGIN, 0.13).scale).toBe(0.13);
  });
});

describe("projectInto", () => {
  const CARD = { height: 132, width: 200 };

  it("goes below MIN_SCALE, which is why it is not fitTo", () => {
    const wide: Rect = { height: 2000, left: 0, top: 0, width: 6000 };

    const projected = projectInto(wide, CARD, 8);
    const fitted = fitTo(wide, CARD, 8);

    expect(projected.scale).toBeLessThan(MIN_SCALE);
    // The bug: fitTo floors at 0.1, so the frames would be drawn 6000 * 0.1 =
    // 600px wide inside a 200px card.
    expect(fitted.scale).toBe(MIN_SCALE);
  });

  it("lands the bounds inside the padded box, centred", () => {
    const bounds: Rect = { height: 900, left: -400, top: -200, width: 1800 };
    const pad = 8;
    const map = projectInto(bounds, CARD, pad);

    const topLeft = worldToScreen(
      map,
      { height: CARD.height, left: 0, top: 0, width: CARD.width },
      { x: bounds.left, y: bounds.top }
    );
    const size = {
      height: bounds.height * map.scale,
      width: bounds.width * map.scale,
    };

    expect(topLeft.x).toBeGreaterThanOrEqual(pad - 0.001);
    expect(topLeft.y).toBeGreaterThanOrEqual(pad - 0.001);
    expect(topLeft.x + size.width).toBeLessThanOrEqual(
      CARD.width - pad + 0.001
    );
    expect(topLeft.y + size.height).toBeLessThanOrEqual(
      CARD.height - pad + 0.001
    );
    // Centred on the axis that is not the limiting one.
    expect(topLeft.x - pad).toBeCloseTo(
      CARD.width - pad - topLeft.x - size.width,
      6
    );
  });

  it("round-trips a press back to the world point under it", () => {
    // What a click on the minimap does: local px in, world coordinates out.
    const bounds: Rect = { height: 900, left: -400, top: -200, width: 1800 };
    const box = { height: CARD.height, left: 0, top: 0, width: CARD.width };
    const map = projectInto(bounds, CARD, 8);

    const point = { x: 137, y: 44 };
    const world = screenToWorld(map, box, point);
    const back = worldToScreen(map, box, world);

    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it("refuses a degenerate box rather than returning a nonsense scale", () => {
    const empty: Rect = { height: 0, left: 0, top: 0, width: 0 };
    expect(projectInto(empty, CARD, 8).scale).toBe(1);
    // A card smaller than twice its own padding — the collapsed-panel case.
    const bounds: Rect = { height: 100, left: 0, top: 0, width: 100 };
    expect(projectInto(bounds, { height: 10, width: 10 }, 8).scale).toBe(1);
  });
});
