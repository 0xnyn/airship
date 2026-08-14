/**
 * The marquee's negotiations with everything else that owns a drag.
 *
 * Two of these were shipped bugs. A space-drag pan also armed the marquee —
 * `stopPropagation` in the viewport cannot decline a sibling listener on the
 * same window node — and the trailing `click` a drag leaves behind was never
 * suppressed, so a completed marquee's own click promptly wiped (or collapsed
 * to one) the selection it had just made. The third is the inline surface:
 * `EditGuard` swallows `pointerup` at document capture, which runs after
 * window *capture* but before window bubble — the phase the handler used to
 * sit in, where it never fired inline at all.
 *
 * happy-dom does not synthesize a `click` from a pointer pair and reports
 * zero-size rects, so these assert on `guard.clickSuppressed` — the picker's
 * own click handler consumes exactly that flag — rather than on a selection
 * surviving a synthetic click.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChromeLayer } from "./chrome-layer";
import { SelectionController } from "./picker";
import { InlineResolver } from "./surface";

const layer = new ChromeLayer();

interface Rig {
  controller: SelectionController;
  gesturing: { on: boolean };
}

function rig(): Rig {
  const gesturing = { on: false };
  const controller = new SelectionController(
    { onSelect: () => undefined },
    {
      isGesturing: () => gesturing.on,
      layer,
      resolver: new InlineResolver(),
      swallowPresses: false,
    }
  );
  controller.setEditing(true);
  return { controller, gesturing };
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

beforeEach(() => {
  layer.mount(document.body);
});

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("marquee vs pan", () => {
  it("declines the press and swallows the trailing click of a real pan", () => {
    const { controller, gesturing } = rig();
    gesturing.on = true;
    document.body.dispatchEvent(pointer("pointerdown", 10, 10));
    // `endPan` has run by pointerup, so `isGesturing` is already false — the
    // decline must have been latched at pointerdown or it is unreachable.
    gesturing.on = false;
    document.body.dispatchEvent(pointer("pointerup", 60, 60));
    expect(controller.guard.clickSuppressed).toBe(true);
    controller.setEditing(false);
  });

  it("does not suppress the click of a stationary gesture press", () => {
    const { controller, gesturing } = rig();
    gesturing.on = true;
    document.body.dispatchEvent(pointer("pointerdown", 10, 10));
    gesturing.on = false;
    document.body.dispatchEvent(pointer("pointerup", 11, 11));
    // Below the 4px threshold this was a click, and clicks own their path.
    expect(controller.guard.clickSuppressed).toBe(false);
    controller.setEditing(false);
  });

  it("suppresses its own trailing click after a completed marquee", () => {
    // The latent bug, written down: without this, the click that follows a
    // release lands in `onClick` and deselects (empty canvas) or collapses
    // the multi-selection to the element under the release point.
    const { controller } = rig();
    document.body.dispatchEvent(pointer("pointerdown", 10, 10));
    document.body.dispatchEvent(pointer("pointerup", 60, 60));
    expect(controller.guard.clickSuppressed).toBe(true);
    controller.setEditing(false);
  });

  it("clears the latched gesture press on teardown", () => {
    const { controller, gesturing } = rig();
    gesturing.on = true;
    document.body.dispatchEvent(pointer("pointerdown", 10, 10));
    controller.setEditing(false);
    controller.setEditing(true);
    gesturing.on = false;
    document.body.dispatchEvent(pointer("pointerup", 60, 60));
    // No stale latch: the press this release would pair with was discarded.
    expect(controller.guard.clickSuppressed).toBe(false);
    controller.setEditing(false);
  });

  it("completes even when a document-capture handler swallows pointerup", () => {
    // The inline surface in miniature: EditGuard's press handler swallows
    // `pointerup` over app content at document capture. Window capture runs
    // first, so the marquee still completes — in the bubble phase it never
    // fired inline at all.
    const swallow = (e: Event): void => {
      e.stopPropagation();
    };
    document.addEventListener("pointerup", swallow, true);
    try {
      const { controller } = rig();
      document.body.dispatchEvent(pointer("pointerdown", 10, 10));
      document.body.dispatchEvent(pointer("pointerup", 60, 60));
      expect(controller.guard.clickSuppressed).toBe(true);
      controller.setEditing(false);
    } finally {
      document.removeEventListener("pointerup", swallow, true);
    }
  });
});
