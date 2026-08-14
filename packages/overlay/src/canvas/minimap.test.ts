/**
 * The minimap's geometry, and the one behaviour that is not geometry.
 *
 * Two bugs are being fenced off here and both are silent — a wrong minimap
 * looks like a minimap.
 *
 * The first is the bounds. Projecting the frames alone is the obvious reading
 * of "show me my canvas", and it means the indicator slides off the card the
 * moment you pan past your content — which is precisely when a map is the only
 * thing that could help. `minimapProjection` unions the visible rect in for
 * that reason, and `stays on the card` is the assertion that says so.
 *
 * The second is `MIN_SCALE`. `projectInto` exists because `fitTo` clamps, and
 * the reason it clamps is that its result is a *zoom level* — reusing it here
 * would floor a wide canvas at 0.1 and draw the frames several times wider than
 * the box holding them. `space.test.ts` proves the helper; this proves the
 * minimap reaches for the right one.
 *
 * Geometry is asserted through the pure projection rather than through the
 * rendered card, because happy-dom does no layout: the card's own rect reads
 * zero, so a conversion through it would be dividing by nothing. Everything that
 * needs the browser's answer is `getBoundingClientRect`, and it is stubbed where
 * a test needs it — which is what lets `Minimap dragging` exercise the pointer
 * path for real rather than leaving the whole gesture unverified.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { MINIMAP_H, MINIMAP_PAD, MINIMAP_W } from "../styles/const";
import { FrameManager } from "./frames";
import { Minimap, minimapProjection } from "./minimap";
import { MIN_SCALE, type Rect, worldRectToScreen } from "./space";
import { CanvasViewport } from "./viewport";

const BOX: Rect = { height: MINIMAP_H, left: 0, top: 0, width: MINIMAP_W };

let world: HTMLElement;
let frames: FrameManager;
let viewport: CanvasViewport;
let minimap: Minimap;
/** What the open docks are covering. Mutable, so one test can open one. */
let inset: { left: number; right: number };

/** The canvas viewport's own screen rect, which happy-dom will not compute. */
function sizeCanvas(width: number, height: number): void {
  viewport.element.getBoundingClientRect = () =>
    ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
    }) as DOMRect;
}

function chips(): string[] {
  return [...minimap.element.querySelectorAll(`.${cls("minimap-frame")}`)].map(
    (node) => node.getAttribute("data-frame") ?? "?"
  );
}

/** Is a rect entirely inside the projection box? */
function inside(rect: Rect): boolean {
  return (
    rect.left >= -0.001 &&
    rect.top >= -0.001 &&
    rect.left + rect.width <= MINIMAP_W + 0.001 &&
    rect.top + rect.height <= MINIMAP_H + 0.001
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  world = document.createElement("div");
  document.body.append(world);
  inset = { left: 0, right: 0 };
  viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSafeInset: () => inset,
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-test:viewport",
  });
  sizeCanvas(1200, 800);
  frames = new FrameManager({
    pathname: "/",
    storageKey: "__airship-test:frames",
    world,
  });
  minimap = new Minimap({ frames, viewport });
  minimap.mount(document.body);
});

afterEach(() => {
  minimap.destroy();
  frames.destroy();
  viewport.destroy();
  world.remove();
});

describe("minimapProjection", () => {
  const FRAME: Rect = { height: 1024, left: 0, top: 0, width: 1440 };

  it("fits the frames inside the box", () => {
    const seen: Rect = { height: 800, left: 0, top: 0, width: 1200 };
    const projection = minimapProjection([FRAME], seen);

    expect(inside(worldRectToScreen(projection.map, BOX, FRAME))).toBe(true);
  });

  it("scales below MIN_SCALE for a wide canvas", () => {
    // Eight desktop frames in a row is well inside what the canvas allows, and
    // it is already an order of magnitude past what a zoom level may be.
    const wide: Rect = { height: 1024, left: 0, top: 0, width: 12_000 };
    const projection = minimapProjection([wide], wide);

    expect(projection.map.scale).toBeLessThan(MIN_SCALE);
  });

  it("keeps the viewport indicator on the card when it leaves the frames", () => {
    // Panned far off to the right of everything, which is the case that made
    // the frames-only version useless.
    const seen: Rect = { height: 800, left: 40_000, top: 9000, width: 1200 };
    const projection = minimapProjection([FRAME], seen);

    expect(inside(worldRectToScreen(projection.map, BOX, seen))).toBe(true);
    // …and the frames are still on it, so the map says which way to go back.
    expect(inside(worldRectToScreen(projection.map, BOX, FRAME))).toBe(true);
  });

  it("holds still while the viewport is inside the frames' bounds", () => {
    // The cost of unioning the visible rect in is that the projection can
    // rescale as you pan. It must not do that over your own content, or the
    // map would shift under the pointer on every gesture.
    const wall: Rect = { height: 1024, left: 0, top: 0, width: 6000 };
    const a = minimapProjection([wall], {
      height: 400,
      left: 500,
      top: 100,
      width: 600,
    });
    const b = minimapProjection([wall], {
      height: 400,
      left: 3200,
      top: 300,
      width: 600,
    });

    expect(a.map.scale).toBe(b.map.scale);
    expect(a.map.x).toBe(b.map.x);
  });

  it("leaves a margin, so the indicator never merges with the card's edge", () => {
    const seen: Rect = { height: 1024, left: 0, top: 0, width: 1440 };
    const rect = worldRectToScreen(
      minimapProjection([FRAME], seen).map,
      BOX,
      FRAME
    );

    expect(rect.left).toBeGreaterThanOrEqual(MINIMAP_PAD - 0.001);
    expect(rect.top).toBeGreaterThanOrEqual(MINIMAP_PAD - 0.001);
  });

  it("answers for an empty canvas rather than refusing to", () => {
    // No frames at all, and a viewport that has not been laid out — the state
    // the very first render runs in. `projectInto` gives back the identity for
    // a degenerate box, so nothing downstream has to defend against a zero or
    // negative scale.
    const map = minimapProjection([], { height: 0, left: 0, top: 0, width: 0 });
    expect(map.map.scale).toBe(1);
    expect(Number.isFinite(map.bounds.width)).toBe(true);
  });
});

describe("Minimap rendering", () => {
  it("tracks the set of frames", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    minimap.render();
    expect(chips()).toEqual(["f1", "f2"]);

    frames.remove("f1");
    minimap.render();
    expect(chips()).toEqual(["f2"]);
  });

  it("marks the selected frame", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    frames.setActive("f2");
    minimap.render();

    const on = minimap.element.querySelectorAll(`.${cls("minimap-frame-on")}`);
    expect(on).toHaveLength(1);
    expect(on[0].getAttribute("data-frame")).toBe("f2");
  });

  it("reuses chips rather than rebuilding them on every render", () => {
    // The render path runs on every frame of a pan. Rebuilding would throw away
    // and recreate a node per frame sixty times a second, and is the reason
    // `syncChips` is a diff rather than a `clear`.
    frames.add({ name: "one" });
    minimap.render();
    const first = minimap.element.querySelector(`[data-frame="f1"]`);
    minimap.render();
    minimap.render();

    expect(minimap.element.querySelector(`[data-frame="f1"]`)).toBe(first);
  });

  it("keeps the indicator painting over the frames", () => {
    // `syncChips` inserts before the indicator specifically so a frame added
    // later cannot end up on top of the box that says where you are looking.
    frames.add({ name: "one" });
    minimap.render();
    frames.add({ name: "two" });
    minimap.render();

    const body = minimap.element.querySelector(`.${cls("minimap-body")}`);
    const classes = [...(body?.children ?? [])].map((n) => n.className);
    expect(classes.at(-1)).toContain(cls("minimap-view"));
  });
});

describe("Minimap accessibility", () => {
  it("hides the graphic and puts nothing focusable inside it", () => {
    // The card is a pointer-only enhancement: everything it does is reachable
    // through ⇧1, ⇧2 and the frame list. That is only honest while the drawing
    // itself stays out of the tree *and* contains no tab stop — an
    // `aria-hidden` subtree with a focusable node in it is axe's
    // `aria-hidden-focus`, which is the trap the frame list's drag handle fell
    // into.
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    minimap.render();

    const body = minimap.element.querySelector(`.${cls("minimap-body")}`);
    expect(body?.getAttribute("aria-hidden")).toBe("true");
    expect(body?.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(
      0
    );
  });

  it("names the card, and offers no way to dismiss it", () => {
    expect(minimap.element.getAttribute("role")).toBe("group");
    expect(minimap.element.getAttribute("aria-label")).toBe("Canvas minimap");
    // The card used to carry a close button whose only counterpart was a
    // checkbox under the zoom readout. Nothing hides the map now, so nothing
    // has to be found to bring it back.
    expect(minimap.element.querySelectorAll("button")).toHaveLength(0);
  });
});

/*
 * The pointer path.
 *
 * happy-dom does no layout, so the card's own rect reads zero and every
 * conversion through it collapses. `sizeMap` is what makes these tests possible
 * at all: it gives the body the rect the stylesheet would have given it, which
 * is the one number the geometry cannot derive for itself.
 */
describe("Minimap dragging", () => {
  /** The card's body rect, which happy-dom will not compute. */
  function sizeMap(): void {
    const body = minimap.element.querySelector<HTMLElement>(
      `.${cls("minimap-body")}`
    );
    if (!body) {
      throw new Error("no minimap body");
    }
    body.getBoundingClientRect = () =>
      ({
        bottom: MINIMAP_H,
        height: MINIMAP_H,
        left: 0,
        right: MINIMAP_W,
        top: 0,
        width: MINIMAP_W,
      }) as DOMRect;
  }

  function press(x: number, y: number): void {
    minimap.element
      .querySelector(`.${cls("minimap-body")}`)
      ?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y })
      );
  }

  function move(x: number, y: number): void {
    minimap.element
      .querySelector(`.${cls("minimap-body")}`)
      ?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y })
      );
  }

  /** The indicator's box in card px, as `render` last drew it. */
  function indicator(): Rect {
    const node = minimap.element.querySelector<HTMLElement>(
      `.${cls("minimap-view")}`
    );
    return {
      height: Number.parseFloat(node?.style.height ?? "0"),
      left: Number.parseFloat(node?.style.left ?? "0"),
      top: Number.parseFloat(node?.style.top ?? "0"),
      width: Number.parseFloat(node?.style.width ?? "0"),
    };
  }

  beforeEach(() => {
    // A wall of frames, so the map has a real scale rather than projecting the
    // viewport onto itself.
    frames.add({ height: 1024, name: "one", width: 1440 });
    frames.add({ height: 1024, name: "two", width: 1440 });
    sizeMap();
    minimap.render();
  });

  it("keeps the grab offset instead of snapping the box to the cursor", () => {
    // The whole of the reported over-sensitivity: pressing inside the indicator
    // used to centre it on the pointer, so taking hold near an edge jumped the
    // camera by half a box before the pointer had travelled at all.
    const before = indicator();
    press(before.left + 1, before.top + 1);
    minimap.render();

    const after = indicator();
    expect(after.left).toBeCloseTo(before.left, 1);
    expect(after.top).toBeCloseTo(before.top, 1);
  });

  it("carries the box with the pointer, one for one", () => {
    const before = indicator();
    press(before.left + 1, before.top + 1);
    move(before.left + 21, before.top + 1);
    minimap.render();

    expect(indicator().left).toBeCloseTo(before.left + 20, 0);
  });

  it("jumps to a press outside the box, then tracks from there", () => {
    const before = indicator();
    // Well clear of the indicator, along the row of frames.
    const target = before.left + before.width + 20;
    press(target, before.top + before.height / 2);
    minimap.render();

    const jumped = indicator();
    expect(jumped.left + jumped.width / 2).toBeCloseTo(target, 0);

    move(target + 10, before.top + before.height / 2);
    minimap.render();
    const tracked = indicator();
    expect(tracked.left + tracked.width / 2).toBeCloseTo(target + 10, 0);
  });

  it("holds the projection still for the length of a drag", () => {
    // `minimapProjection` folds the visible rect into its bounds, so panning
    // past the frames rescales the map. Recomputed mid-gesture that changes how
    // far the next pointer move travels — the rubber-banding this snapshot
    // exists to stop. The chips are the projection made visible: if they move,
    // the map rescaled under the pointer.
    const chip = () =>
      minimap.element.querySelector<HTMLElement>(`[data-frame="f1"]`)?.style
        .width;
    const before = indicator();
    press(before.left + before.width / 2, before.top + before.height / 2);
    const width = chip();

    // Drag hard against the edge, which is far outside the frames' union.
    move(MINIMAP_W - 1, MINIMAP_H - 1);
    minimap.render();
    expect(chip()).toBe(width);
  });

  it("recomputes the projection once the drag is over", () => {
    const chip = () =>
      minimap.element.querySelector<HTMLElement>(`[data-frame="f1"]`)?.style
        .width;
    const before = indicator();
    press(before.left + before.width / 2, before.top + before.height / 2);
    move(MINIMAP_W - 1, MINIMAP_H - 1);
    minimap.render();
    const frozen = chip();

    minimap.element
      .querySelector(`.${cls("minimap-body")}`)
      ?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    minimap.render();

    // The camera is now well outside the frames, so the union — and with it the
    // scale — has to have moved on.
    expect(chip()).not.toBe(frozen);
  });

  it("centres on the rect it draws, docks and all", () => {
    // The indicator is drawn from `visibleSafeRect` and `centerOn` aims at the
    // same box. Drawn from the full canvas rect instead, the two disagreed by
    // half the open docks' width — a constant drift between where you pressed
    // and where the camera landed.
    inset = { left: 280, right: 0 };
    minimap.render();
    const before = indicator();
    // Outside the box, so this is a jump rather than a grab — a jump is the
    // gesture that has to land exactly where it was aimed.
    const target = before.left + before.width + 20;
    press(target, before.top + before.height / 2);
    minimap.render();

    const after = indicator();
    expect(after.left + after.width / 2).toBeCloseTo(target, 0);
  });
});
