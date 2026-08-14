import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../dom";
import { dock, plainStage } from "../stories/chrome";
import { onStoryTeardown } from "../stories/lifecycle";
import { FrameManager, MAX_FRAMES } from "./frames";
import { FramesPanel } from "./frames-panel";
import { CanvasViewport } from "./viewport";

/*
 * The frame list — the left dock's view-mode body.
 *
 * Rendered inside a real `dock` at a real width, because the whole design of
 * the row is about width: it is a three-column grid, and the only interesting
 * question is what happens to a long device name when the size readout beside
 * it will not shrink. A story at 1200px is a picture of a panel that does not
 * exist. `Narrow` is the same list at `MIN_DOCK_W`, which is as small as the
 * splitter will let a user make it.
 *
 * The `FrameManager` here is real and so are its frames — they are real
 * same-origin iframes, appended to a world element that is never put on screen.
 * `mount()` is never called, so no `src` is ever set and nothing loads; this
 * file only ever asks the manager about names, sizes and order, which is all
 * the panel reads. `viewport` is real too and is genuinely driven: clicking a
 * row centres it, and with no canvas on screen that is invisible but harmless,
 * which is why the caption points at the rename and the menu instead.
 *
 * Every key is prefixed `__airship-story:` and nothing calls `restore()` or
 * `save()`, so the catalogue leaves no state behind.
 */

const meta: Meta = {
  title: "Canvas/Frames panel",
};

export default meta;

interface Rig {
  frames: FrameManager;
  panel: FramesPanel;
}

function rig(): Rig {
  const world = el("div");
  const viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-story:viewport",
  });
  const frames: FrameManager = new FrameManager({
    onChanged: () => panel.render(),
    pathname: "/",
    storageKey: "__airship-story:frames",
    world,
  });
  // No `addFrame` shim any more, which is the point: the `+` used to delegate to
  // the bottom bar's menu, so this rig substituted a straight `add` and the
  // story never showed what the button actually did. It owns its own device
  // menu now, anchored to itself — press `+` here and you get the real one.
  const panel = new FramesPanel({ frames, viewport });

  onStoryTeardown(() => {
    panel.destroy();
    frames.destroy();
    viewport.destroy();
  });

  return { frames, panel };
}

/** A board worth looking at: two devices, a duplicate, and a custom size. */
function fill(frames: FrameManager): void {
  frames.add({ presetId: "desktop" });
  frames.add({ presetId: "iphone-16" });
  frames.add({ presetId: "ipad-pro-12-9" });
  frames.add({ height: 720, name: "Checkout kiosk", width: 1280 });
}

export const Default: StoryObj = {
  render: () => {
    const { frames, panel } = rig();
    fill(frames);
    frames.setActive("f2");
    return plainStage([dock(panel.element, { label: "Frames" })], {
      try: "Double-click a name to rename it. The ⋯ menu carries the device list, rotate, reload, duplicate and delete — and delete offers itself back.",
      what: "The list in its ordinary state, with one frame selected. Rows are paint order, so dragging the grip restacks overlapping frames.",
    });
  },
};

/**
 * The empty state, which is also the first thing a new project sees before
 * `CanvasStage.mount` adds its two starting frames.
 */
export const Empty: StoryObj = {
  render: () => {
    const { panel } = rig();
    return plainStage([dock(panel.element, { label: "Frames" })], {
      what: "No frames. The count still reads, which is the one place the cap of eight is stated before you hit it.",
    });
  },
};

/**
 * At the cap.
 *
 * The add button goes disabled here rather than letting you press it and taking
 * a toast for an answer — the refusal is spoken only where there is no control
 * to disable, which is the row menu's Duplicate.
 */
export const AtTheCap: StoryObj = {
  render: () => {
    const { frames, panel } = rig();
    for (let i = 0; i < MAX_FRAMES; i += 1) {
      frames.add({ presetId: i % 2 ? "iphone-16" : "desktop" });
    }
    return plainStage([dock(panel.element, { label: "Frames" })], {
      what: `All ${MAX_FRAMES} frames. The + is disabled and says why; the list scrolls inside the dock rather than growing it.`,
    });
  },
};

/**
 * Long names at the narrowest the panel can be.
 *
 * The row is a grid with `minmax(0, 1fr)` on the name, so the name is the
 * column that gives — the size readout is the one thing on the row that must
 * never be ambiguous, and a truncated `1440 × 10…` is worse than no readout.
 */
export const Narrow: StoryObj = {
  render: () => {
    const { frames, panel } = rig();
    frames.add({
      name: "Marketing site — pricing page, wide",
      presetId: "desktop",
    });
    frames.add({ presetId: "iphone-16-pro-max" });
    frames.add({
      height: 720,
      name: "Checkout kiosk (landscape)",
      width: 1280,
    });
    return plainStage(
      [dock(panel.element, { label: "Frames", narrow: true })],
      {
        what: "The same rows at MIN_DOCK_W with names that do not fit. The name truncates; the size never does.",
      }
    );
  },
};
