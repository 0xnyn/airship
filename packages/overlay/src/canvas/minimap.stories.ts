import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../dom";
import { type Caption, plainStage } from "../stories/chrome";
import { onStoryTeardown } from "../stories/lifecycle";
import { FrameManager } from "./frames";
import { Minimap } from "./minimap";
import { CanvasViewport } from "./viewport";

/*
 * The minimap, over a real canvas.
 *
 * This one genuinely needs a browser and is close to useless without one. The
 * card is nothing but arithmetic turned into `left`/`top`/`width`/`height`, and
 * happy-dom answers every rect with zero — so `minimap.test.ts` asserts the
 * projection directly and leaves the rendered result untested by construction.
 * Here it is rendered, over a viewport with a real size, and you can drag it.
 *
 * The frames are real iframes with no `src`, appended to a real world element
 * under a real `CanvasViewport`. `mount()` is never called (under Storybook
 * `/?__airship=frame` is Storybook's own index, recursively — see the note at
 * the top of `canvas.stories.ts`), so they stay blank white rectangles. That is
 * the right fidelity for this story: the minimap draws *rectangles*, and what
 * is inside a frame is the one thing it can never show.
 *
 * The pairing is the point of the first story. The card and the canvas above it
 * are the same world twice, so a drag in one has to move the other — and the
 * indicator has to keep reporting where you are once you leave the frames
 * behind, which is what `FarField` is for.
 */

const meta: Meta = {
  title: "Canvas/Minimap",
};

export default meta;

const CANVAS_H = "60vh";

interface Rig {
  element: HTMLElement;
  frames: FrameManager;
  minimap: Minimap;
  viewport: CanvasViewport;
}

/**
 * A canvas with a minimap over it, wired the way `CanvasStage` wires them.
 *
 * `frames` is referred to inside `viewport`'s deps and vice versa; both
 * closures are lazy and nothing fires until a frame is added — the same knot
 * `frame-chrome.test.ts` and `canvas.stories.ts` both tie.
 */
function rig(): Rig {
  let frames: FrameManager;
  let minimap: Minimap;

  const viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSelectionRect: () => null,
    onChange: () => minimap.render(),
    storageKey: "__airship-story:viewport",
  });
  frames = new FrameManager({
    onChanged: () => minimap.render(),
    pathname: "/",
    storageKey: "__airship-story:frames",
    world: viewport.world,
  });
  minimap = new Minimap({ frames, viewport });

  // The card is `position: fixed` in the product. Pinned to the demo's own box
  // here instead, so two stories on one page do not stack in the same corner.
  minimap.element.style.position = "absolute";
  minimap.element.style.right = "12px";
  minimap.element.style.bottom = "12px";

  const element = el(
    "div",
    {
      style: `position: relative; width: 100%; height: ${CANVAS_H};
              overflow: hidden; border-radius: 6px;`,
    },
    [viewport.element, minimap.element]
  );

  onStoryTeardown(() => {
    minimap.destroy();
    frames.destroy();
    viewport.destroy();
  });

  return { element, frames, minimap, viewport };
}

/**
 * Build a board and let the layout settle before anything is measured.
 *
 * `viewport.rect` reads the element's own `getBoundingClientRect`, which is
 * zero until Storybook has appended the story — so a minimap rendered
 * synchronously would project against a zero-sized viewport and draw an
 * indicator covering the whole card.
 */
function board(
  build: (r: Rig) => void,
  caption: Caption,
  fit = true
): HTMLElement {
  const r = rig();
  requestAnimationFrame(() => {
    build(r);
    if (fit) {
      r.viewport.zoomToFit();
    }
    r.minimap.render();
  });
  return plainStage([r.element], caption);
}

/** The two frames a new project starts with, plus room to get lost in. */
function starter(frames: FrameManager): void {
  frames.add({ presetId: "desktop", x: 0, y: 0 });
  frames.add({ presetId: "iphone-16", x: 1560, y: 0 });
  frames.add({ presetId: "ipad-pro-12-9", x: 2080, y: 0 });
}

export const Default: StoryObj = {
  render: () =>
    board(({ frames }) => starter(frames), {
      try: "Press anywhere on the map — the canvas jumps there and keeps following until you let go. Wheel or ⌘-wheel over the canvas and watch the indicator track it.",
      what: "Three frames, fitted. The blue box is the part of the world the canvas is showing; the grey ones are the frames.",
    }),
};

/**
 * Zoomed in on one frame.
 *
 * The state the map is actually for: the indicator is small, most of the board
 * is off screen, and the card is the only thing on screen that says so.
 */
export const ZoomedIn: StoryObj = {
  render: () =>
    board(
      ({ frames, viewport }) => {
        starter(frames);
        viewport.set({ scale: 1.6, x: -180, y: -120 });
      },
      {
        what: "At 160%, showing a corner of the first frame. The indicator shrinks to match what is visible.",
      },
      false
    ),
};

/**
 * Panned off the end of the world.
 *
 * The bug this design exists to avoid: projecting the frames alone puts the
 * indicator off the card exactly here, at the moment a map is the only thing
 * that could help. The bounds include where you are looking, so the frames
 * shrink into a corner and the map keeps pointing back at them.
 */
export const FarField: StoryObj = {
  render: () =>
    board(
      ({ frames, viewport }) => {
        starter(frames);
        viewport.set({ scale: 0.4, x: -9000, y: -3400 });
      },
      {
        what: "Panned far past every frame. The frames collapse into a corner rather than the indicator sliding off the card — the projection covers the union of both.",
      },
      false
    ),
};

/** One frame, and nothing to get lost among. The map is honest about that. */
export const SingleFrame: StoryObj = {
  render: () =>
    board(
      ({ frames }) => {
        frames.add({ presetId: "desktop" });
      },
      {
        what: "A single frame at fit. The indicator is larger than the frame because a fit leaves padding around it — which is what the padding on the card is echoing.",
      }
    ),
};

/**
 * The selected frame.
 *
 * Selection is a *view-mode* idea — `frame-chrome.ts` restricts it to that
 * mode, which is the same mode this card only appears in — so the map marks it
 * in the accent rather than leaving eight identical grey boxes.
 */
export const WithSelection: StoryObj = {
  render: () =>
    board(
      ({ frames }) => {
        starter(frames);
        frames.setActive("f2");
      },
      {
        try: "Press the highlighted chip on the map: it selects that frame. Double-click it to zoom to it.",
        what: "The selected frame in the accent colour. Everything else is the same neutral fill.",
      }
    ),
};

/** The card at its widest content: a wall of frames at the cap. */
export const FullBoard: StoryObj = {
  render: () =>
    board(
      ({ frames }) => {
        for (let i = 0; i < 8; i += 1) {
          frames.add({
            presetId: i % 3 === 0 ? "desktop" : "iphone-16",
            x: i * 700,
            y: (i % 2) * 400,
          });
        }
      },
      {
        what: "Eight frames — the cap. At this width the projection is well under MIN_SCALE, which is the reason the minimap does not use `fitTo`.",
      }
    ),
};

/*
 * Dragging is deliberately not a story.
 *
 * The two gestures the card carries — grab the indicator and it travels with
 * the pointer, press outside it and the view goes there — are a *sequence* of
 * pointer events, and a story is one picture. They are fenced in
 * `minimap.test.ts` under `Minimap dragging`, which stubs the card's rect and
 * drives the events directly; the stories here are for the projection, which is
 * the half you have to look at to judge.
 */
