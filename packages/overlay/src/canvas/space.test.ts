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
  frameChain,
  frameToScreen,
  intersectRects,
  MAX_NEST_DEPTH,
  MIN_SCALE,
  nestOffset,
  projectInto,
  type Rect,
  screenToFrame,
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

// -- nested documents --------------------------------------------------------

/** Pin an element's screen rect — happy-dom does no layout. */
function stubRect(el: Element, rect: Partial<Rect>): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ height: 0, left: 0, top: 0, width: 0, ...rect }) as DOMRect;
}

function stubBorder(el: Element, left: number, top: number): void {
  Object.defineProperty(el, "clientLeft", { value: left });
  Object.defineProperty(el, "clientTop", { value: top });
}

/** A real same-origin iframe appended into `doc`, the text-edit.test idiom. */
function nestedIframe(doc: Document): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  doc.body.append(iframe);
  return iframe;
}

describe("frameChain", () => {
  it("is empty when the window already is the root", () => {
    expect(frameChain(window, window)).toEqual([]);
  });

  it("collects the iframes between a nested document and the root, innermost first", () => {
    const outer = nestedIframe(document);
    const outerDoc = outer.contentDocument as Document;
    const inner = nestedIframe(outerDoc);
    const innerWin = inner.contentWindow as Window;

    expect(frameChain(innerWin, window)).toEqual([inner, outer]);
    outer.remove();
  });

  it("returns null when the root is not an ancestor", () => {
    const stray = nestedIframe(document);
    const strayWin = stray.contentWindow as Window;
    const other = nestedIframe(document);
    const otherWin = other.contentWindow as Window;

    expect(frameChain(strayWin, otherWin)).toBeNull();
    stray.remove();
    other.remove();
  });

  it("gives up past the depth cap", () => {
    let doc = document;
    let iframe: HTMLIFrameElement | null = null;
    const top = nestedIframe(doc);
    doc = top.contentDocument as Document;
    for (let i = 0; i < MAX_NEST_DEPTH + 1; i += 1) {
      iframe = nestedIframe(doc);
      doc = iframe.contentDocument as Document;
    }

    expect(frameChain(doc.defaultView as Window, window)).toBeNull();
    top.remove();
  });

  it("treats a throwing hop as a cross-origin boundary", () => {
    const iframe = nestedIframe(document);
    const win = iframe.contentWindow as Window;
    Object.defineProperty(win, "frameElement", {
      get() {
        throw new DOMException("cross-origin");
      },
    });

    expect(frameChain(win, window)).toBeNull();
    iframe.remove();
  });
});

describe("nestOffset", () => {
  it("is zero for an empty chain — the single-level path unchanged", () => {
    expect(nestOffset([])).toEqual({ x: 0, y: 0 });
  });

  it("composes positions and borders across levels", () => {
    const outer = nestedIframe(document);
    const inner = nestedIframe(outer.contentDocument as Document);
    stubRect(outer, { left: 200, top: 100 });
    stubBorder(outer, 2, 2);
    stubRect(inner, { left: 30, top: 40 });
    stubBorder(inner, 1, 3);

    // Innermost first, the way frameChain hands them over.
    expect(nestOffset([inner, outer])).toEqual({ x: 233, y: 145 });
    outer.remove();
  });
});

describe("intersectRects", () => {
  it("returns the overlap", () => {
    const a: Rect = { height: 100, left: 0, top: 0, width: 100 };
    const b: Rect = { height: 100, left: 60, top: 40, width: 100 };
    expect(intersectRects(a, b)).toEqual({
      height: 60,
      left: 60,
      top: 40,
      width: 40,
    });
  });

  it("collapses to zero size when they miss, never negative", () => {
    const a: Rect = { height: 10, left: 0, top: 0, width: 10 };
    const b: Rect = { height: 10, left: 50, top: 50, width: 10 };
    const out = intersectRects(a, b);
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
  });
});

describe("frame⇄screen with a nested offset", () => {
  it("round-trips at a zoom that is not 1×", () => {
    // Deliberately not 1: a bug that adds the offset after the scale is
    // invisible at 1× and glaring at 2×.
    const frameEl = document.createElement("div");
    stubRect(frameEl, { left: 100, top: 50 });
    const offset = { x: 30, y: 20 };
    const rect: Rect = { height: 40, left: 10, top: 5, width: 60 };

    const screen = frameToScreen(frameEl, rect, 2, offset);
    expect(screen).toEqual({ height: 80, left: 180, top: 100, width: 120 });

    const back = screenToFrame(
      frameEl,
      { x: screen.left, y: screen.top },
      2,
      offset
    );
    expect(back.x).toBeCloseTo(rect.left, 6);
    expect(back.y).toBeCloseTo(rect.top, 6);
  });

  it("reduces to the plain conversion when the offset is absent", () => {
    const frameEl = document.createElement("div");
    stubRect(frameEl, { left: 100, top: 50 });
    const rect: Rect = { height: 40, left: 10, top: 5, width: 60 };

    expect(frameToScreen(frameEl, rect, 2)).toEqual(
      frameToScreen(frameEl, rect, 2, { x: 0, y: 0 })
    );
  });
});
