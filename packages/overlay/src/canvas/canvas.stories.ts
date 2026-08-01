import type { Meta, StoryObj } from "@storybook/html-vite";
import { ChromeLayer } from "../chrome-layer";
import { cls, el } from "../dom";
import { type Caption, plainStage } from "../stories/chrome";
import { noop } from "../stories/fixtures";
import { onStoryTeardown } from "../stories/lifecycle";
import { buildSpecimenIn, type SubjectName } from "../stories/subjects";
import { FrameChrome } from "./frame-chrome";
import { type Frame, FrameManager, MAX_FRAMES } from "./frames";
import { CanvasViewport } from "./viewport";

/*
 * The canvas: real frames, at real device widths, with the real chrome on top.
 *
 * This file replaces a story called `FullBoard` that drew eight grey rectangles
 * with inline styles under a heading reading "At MAX_FRAMES". It was as close as
 * the catalogue came to showing the canvas, and it showed none of it — not a
 * title bar, not a grip, not what happens to chrome at 20% zoom, and above all
 * not the thing the whole of `frame-chrome.ts` is designed around: **chrome is
 * drawn in screen space over a world that scales.** A 2px selection border at
 * 10% zoom would be 0.2px if it scaled with the frames; it does not, and that is
 * only visible if something actually zooms.
 *
 * The argument against a story here used to be that `FrameChrome` is a
 * controller over a live viewport with sensors bound to it, so a story would be
 * a mock of a viewport rather than a picture of the chrome. `frame-chrome.test.ts`
 * refutes that in its own `beforeEach`: it stands up the real quartet —
 * `ChromeLayer`, `CanvasViewport`, `FrameManager`, `FrameChrome` — in about
 * thirty lines, and its docstring names the one thing it cannot do, which is
 * assert placement, "because `frameScreenRect` needs layout that happy-dom does
 * not do". A browser is exactly the missing ingredient.
 *
 * ## What genuinely does not work here, and what stands in for it
 *
 * **No live app inside the frames.** `FrameManager.mount()` sets
 * `iframe.src = "/?__airship=frame"`, which under Storybook is Storybook's own
 * index, recursively. So `mount()` is never called; instead each frame's
 * `contentDocument` — an unset `src` gives a same-origin, writable
 * `about:blank` — is written with `buildSpecimenIn`, the same specimens the
 * inspector stories point at. That is *more* faithful than a drawing, not less:
 * these are real iframes at real viewport widths, so a 393px frame reports
 * `innerWidth === 393` to the document inside it and that document's media
 * queries fire, which is the entire argument of `frames.ts`. Setting `mounted`
 * afterwards is what stops anything later clobbering the write.
 *
 * **No wheel forwarding from inside a frame.** `__airshipOnFrameWheel` needs
 * `frame-agent.ts` running in the frame, which the proxy serves and Storybook
 * does not. Everything the *shell* binds works, because `CanvasViewport.bind()`
 * listens on `window` in capture phase — so wheel-pan, ⌘-wheel zoom-at-cursor
 * and space-drag are all live here.
 *
 * **No picker.** `SelectionController` is fifteen hundred lines over nine
 * collaborators. Frame *selection* is `FrameChrome`'s own and works; element
 * selection inside a frame is a different machine and stays out.
 *
 * **`localStorage` is bounded.** Every key here is prefixed `__airship-story:`
 * and `restore()` is never called. "Zoom to fit" calls `viewport.save()`, so one
 * key does get written; that is the whole footprint.
 */

const meta: Meta = {
  title: "Canvas/Canvas",
};

export default meta;

interface Board {
  chrome: FrameChrome;
  element: HTMLElement;
  frames: FrameManager;
  viewport: CanvasViewport;
}

/**
 * The four real objects, wired as `shell-app.ts` wires them.
 *
 * `frames` is referred to inside `viewport`'s deps and vice versa; both closures
 * are lazy and nothing fires until a frame is added, which is the same knot
 * `frame-chrome.test.ts` ties and for the same reason.
 */
function board(): Board {
  const layer = new ChromeLayer();

  // Declared before they are built, because each of the three deps objects
  // below closes over one of the others. Every such closure is lazy and nothing
  // fires until a frame is added, which is the knot `frame-chrome.test.ts` ties
  // in its own `beforeEach` for the same reason.
  let frames: FrameManager;
  let chrome: FrameChrome;

  const viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSelectionRect: () => null,
    onChange: () => chrome.render(),
    storageKey: "__airship-story:viewport",
  });

  frames = new FrameManager({
    // `shell-app.ts` also calls `updateMounts()` here, which would set every
    // frame's `src`. See the note at the top of this file.
    onChanged: () => chrome.render(),
    pathname: "/",
    storageKey: "__airship-story:frames",
    world: viewport.world,
  });

  chrome = new FrameChrome({
    frames,
    inCanvas: () => true,
    layer,
    onChanged: noop,
    viewport,
  });

  const bar = el("div", { class: cls("bar") });
  chrome.mountFrameTools(bar);
  chrome.mount(el("div"));

  const element = el(
    "div",
    { style: "position: relative; width: 100%; height: 70vh;" },
    [viewport.element, layer.element, bar]
  );

  onStoryTeardown(() => {
    chrome.destroy();
    frames.destroy();
    viewport.destroy();
    layer.destroy();
  });

  return { chrome, element, frames, viewport };
}

/** Write a specimen into a frame's own document, once it is in the DOM. */
function fill(frame: Frame, name: SubjectName): void {
  const { doc } = frame;
  if (!doc) {
    return;
  }
  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  doc.body.style.cssText = "margin: 0; padding: 24px; background: #fff;";
  doc.body.append(buildSpecimenIn(doc, name).page);
  // So nothing later decides this frame still needs loading.
  frame.mounted = true;
}

interface BoardOptions {
  /** Select this frame, by index. */
  active?: number;
  /** Leave the frames blank — the state before an app has loaded. */
  blank?: boolean;
  /** Frames to add, as `[presetId, specimen]`. */
  frames: [string, SubjectName][];
  /** Set the transform explicitly instead of fitting. */
  viewport?: { scale: number; x: number; y: number };
}

/**
 * Build a board and hand it back once its frames are written.
 *
 * The write waits a frame for the reason the whole repo keeps restating:
 * **moving an iframe in the DOM reloads it**, so anything written before
 * Storybook has appended the story is wiped, silently, leaving a blank pane.
 */
function stage(
  opts: BoardOptions,
  caption: Caption,
  after?: (b: Board) => void
): HTMLElement {
  const b = board();

  requestAnimationFrame(() => {
    const added = opts.frames
      .map(([presetId], i) => b.frames.add({ presetId, x: i * 60, y: i * 40 }))
      .filter((f): f is Frame => f !== null);

    if (!opts.blank) {
      for (const [i, frame] of added.entries()) {
        fill(frame, opts.frames[i][1]);
      }
    }
    if (opts.active !== undefined && added[opts.active]) {
      b.frames.setActive(added[opts.active].id);
    }
    if (opts.viewport) {
      b.viewport.set(opts.viewport);
    } else {
      b.viewport.zoomToFit();
    }
    b.chrome.render();
    after?.(b);
  });

  return plainStage([b.element], caption);
}

/**
 * Three frames at three device widths, each running a real specimen.
 *
 * The frames are genuine same-origin iframes at the preset's exact viewport, so
 * the document inside a 393px frame reports `innerWidth === 393` and lays out
 * accordingly — at any zoom. That is the claim `frames.ts` opens with, and this
 * is the only place it is visible.
 */
export const Board: StoryObj = {
  render: () =>
    stage(
      {
        frames: [
          ["desktop", "card"],
          ["iphone-16", "button"],
          ["ipad-pro-11", "tiles"],
        ],
      },
      {
        try: "wheel to pan and ⌘-wheel to zoom — the shell binds those on `window` in capture phase, so they work here",
        what: "A real board: three frames at three device widths, each with a specimen laid out inside it.",
      }
    ),
};

/**
 * A selected frame, and the verbs that appear with it.
 *
 * `mountFrameTools` puts a frame-scoped group into the bottom bar, which only
 * has anything to say once a frame is chosen. A newly *added* frame is
 * deliberately not selected — selection is something the user does, and the
 * highlight only means anything if it stays that way.
 */
export const Selected: StoryObj = {
  render: () =>
    stage(
      {
        active: 1,
        frames: [
          ["desktop", "card"],
          ["iphone-16", "button"],
        ],
      },
      {
        what: "The middle frame selected: `.fc-active` on the frame, and the bar's frame verbs switched on.",
      }
    ),
};

/**
 * The board at 20%.
 *
 * The whole argument for screen-space chrome, in one picture. The frames shrink
 * with the world; the titles, the size badges and the grips do not. Scaled with
 * the world they would be two-pixel smudges here, which is what a design tool
 * spends real effort avoiding.
 */
export const ZoomedOut: StoryObj = {
  render: () =>
    stage(
      {
        frames: [
          ["desktop", "card"],
          ["iphone-16", "button"],
          ["ipad-pro-11", "tiles"],
        ],
        viewport: { scale: 0.2, x: 40, y: 40 },
      },
      {
        try: "compare a title here with the same one in Board above — same 11px, five times the frame",
        what: "The same board at 20%. Frames scale; chrome does not.",
      }
    ),
};

/** The add-frame menu — the device catalogue, grouped, with one group open. */
export const AddMenu: StoryObj = {
  render: () =>
    stage(
      { frames: [["desktop", "card"]] },
      {
        what: "The add-frame menu: the preset table as it is actually chosen from, rather than as a diagram.",
      },
      (b) => b.chrome.openAddMenu()
    ),
};

/**
 * The dimensions menu, with its custom W×H row.
 *
 * Built once in the constructor and outliving every selection there will ever
 * be, so its rows resolve the frame at click time rather than closing over one.
 * That is also why no current-device mark is seeded at build time: it would be
 * answering for a frame that had not been chosen yet.
 */
export const DimensionsMenu: StoryObj = {
  render: () =>
    stage(
      {
        active: 0,
        frames: [["iphone-16", "button"]],
      },
      {
        what: "A selected frame's size menu, including the custom width and height row.",
      },
      (b) => {
        // By tooltip rather than a class, because `barButton` gives every entry
        // in the group the same class and the tip is what distinguishes them.
        b.element
          .querySelector<HTMLElement>('[data-tip="Frame dimensions"]')
          ?.click();
      }
    ),
};

/**
 * The board at its cap, unwritten.
 *
 * `MAX_FRAMES` exists because every frame is a live document running the user's
 * app, and eight of those is already a lot of JavaScript for one tab — so
 * leaving them blank here is not a shortcut, it is the honest picture of the
 * state the cap is protecting against. The `+` should be refusing to add a
 * ninth.
 */
export const AtTheCap: StoryObj = {
  render: () =>
    stage(
      {
        blank: true,
        frames: Array.from(
          { length: MAX_FRAMES },
          (_, i) =>
            [i % 2 ? "iphone-16" : "desktop", "card"] as [string, SubjectName]
        ),
      },
      {
        try: "open the add menu — `FrameManager.add` returns null at the cap, so nothing should appear",
        what: `All ${MAX_FRAMES} frames, none of them loaded. The cap exists because each one is a live document.`,
      }
    ),
};

/**
 * One frame that has not loaded.
 *
 * The blank white card every frame is for a few hundred milliseconds, and the
 * state the old fake board was accidentally a picture of. Worth having on
 * purpose rather than by accident: it is what a slow dev server looks like.
 */
export const Unloaded: StoryObj = {
  render: () =>
    stage(
      { blank: true, frames: [["desktop", "card"]] },
      {
        what: "A frame before its document exists — chrome, a border, and nothing inside.",
      }
    ),
};

/** Renaming a frame in place, from a double-click on its title. */
export const Rename: StoryObj = {
  render: () =>
    stage(
      {
        active: 0,
        frames: [["desktop", "card"]],
      },
      {
        what: "The inline rename input, which is what a frame's title becomes when you double-click it.",
      },
      (b) => {
        // The handler is on `.fc-label`, the wrapper — `.fc-name` is the span
        // inside it that `renameFrame` replaces with the input.
        b.element
          .querySelector<HTMLElement>(`.${cls("fc-label")}`)
          ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
    ),
};
