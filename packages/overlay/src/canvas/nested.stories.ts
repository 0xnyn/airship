import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { noop } from "../stories/fixtures";
import { onStoryTeardown } from "../stories/lifecycle";
import { CanvasResolver, localRect, NestedSurface } from "../surface";
import { FrameManager } from "./frames";
import { CanvasViewport } from "./viewport";

/*
 * Picking through a nested same-origin iframe — the #17 topology, with real
 * layout.
 *
 * The unit tier proves the descent and the arithmetic against stubbed rects;
 * this is the only tier where `getBoundingClientRect` is real, so it is what
 * actually guards the coordinate composition. The nested iframe is placed
 * behind a deliberate sidebar-width left inset and toolbar-height top inset,
 * with a border for `clientLeft`, so a missed offset cannot pass by luck —
 * and the assertions run at 1× *and* zoomed, because a bug that adds the
 * nested offset after the scale is invisible at 1×.
 *
 * The frame is written through `contentDocument`, never `mount()` — under
 * Storybook, `frameSrc()` is Storybook's own index, recursively (see
 * canvas.stories.ts).
 */

const meta: Meta = {
  title: "Canvas/Nested",
};

export default meta;

interface Rig {
  frames: FrameManager;
  resolver: CanvasResolver;
  viewport: CanvasViewport;
}

/** Handed from render to play; stories run one at a time in the test tier. */
let current: Rig | null = null;

function rig(): HTMLElement {
  let frames: FrameManager;
  const viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSelectionRect: () => null,
    onChange: noop,
    storageKey: "__airship-story:nested-viewport",
  });
  frames = new FrameManager({
    pathname: "/",
    storageKey: "__airship-story:nested-frames",
    world: viewport.world,
  });
  const resolver = new CanvasResolver(frames, viewport);
  current = { frames, resolver, viewport };
  onStoryTeardown(() => {
    frames.destroy();
    viewport.destroy();
    current = null;
  });
  return el(
    "div",
    {
      class: cls("stage"),
      style: "position: relative; width: 100%; height: 70vh;",
    },
    [viewport.element]
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function writeDoc(doc: Document): void {
  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  doc.body.style.cssText = "margin: 0; padding: 0; background: #fff;";
}

function close(a: number, b: number, what: string): void {
  if (Math.abs(a - b) > 1) {
    throw new Error(`${what}: expected ${b}, got ${a}`);
  }
}

async function assertNestedPicking(): Promise<void> {
  if (!current) {
    throw new Error("the story did not build its rig");
  }
  const { frames, resolver, viewport } = current;
  // After the append — writing an iframe before Storybook attaches the story
  // would be wiped when the element moves (moving an iframe reloads it).
  await nextFrame();

  const frame = frames.add({ height: 480, name: "outer", width: 760 });
  if (!frame?.doc) {
    throw new Error("frame did not build a document");
  }
  writeDoc(frame.doc);
  const nested = frame.doc.createElement("iframe");
  nested.title = "nested preview";
  nested.style.cssText =
    "position: absolute; left: 220px; top: 64px; width: 420px; height: 320px; border: 3px solid #888;";
  frame.doc.body.append(nested);
  const nestedDoc = nested.contentDocument;
  if (!nestedDoc) {
    throw new Error("nested iframe has no document");
  }
  writeDoc(nestedDoc);
  const target = nestedDoc.createElement("button");
  target.textContent = "pick me";
  target.style.cssText =
    "position: absolute; left: 24px; top: 40px; width: 120px; height: 32px;";
  nestedDoc.body.append(target);
  frame.mounted = true;

  const scene: Scene = { frame, nested, nestedDoc, resolver, target, viewport };
  // Sequential on purpose — each zoom needs its own layout pass; an offset
  // applied after the scale is invisible at 1× and glaring at 0.5×.
  await assertAtScale(1, scene);
  await assertAtScale(0.5, scene);
}

interface Scene {
  frame: NonNullable<ReturnType<FrameManager["add"]>>;
  nested: HTMLIFrameElement;
  nestedDoc: Document;
  resolver: CanvasResolver;
  target: Element;
  viewport: CanvasViewport;
}

async function assertAtScale(scale: number, scene: Scene): Promise<void> {
  const { frame, nested, nestedDoc, resolver, target, viewport } = scene;
  viewport.set({ scale, x: 24, y: 16 });
  await nextFrame();

  // Expected placement from the browser's own rects, composed by hand: frame
  // origin (post-transform), plus the nested viewport's offset and the
  // target's rect, both in untransformed CSS px, under the canvas scale.
  const fRect = frame.el.getBoundingClientRect();
  const nRect = nested.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  const expected = {
    height: tRect.height * scale,
    left: fRect.left + (nRect.left + nested.clientLeft + tRect.left) * scale,
    top: fRect.top + (nRect.top + nested.clientTop + tRect.top) * scale,
    width: tRect.width * scale,
  };
  const point = {
    x: expected.left + expected.width / 2,
    y: expected.top + expected.height / 2,
  };

  const surface = resolver.at(point);
  if (!(surface instanceof NestedSurface)) {
    throw new Error(
      `at ${scale}x: expected the nested surface, got ${surface?.id ?? "none"}`
    );
  }
  if (surface.doc !== nestedDoc) {
    throw new Error(`at ${scale}x: the surface's doc is not the nested one`);
  }
  if (surface.elementAtScreen(point) !== target) {
    throw new Error(`at ${scale}x: the hit under the cursor is not the target`);
  }
  if (resolver.of(target) !== surface) {
    throw new Error(
      `at ${scale}x: of(node) did not ascend to the same surface`
    );
  }

  const screen = surface.toScreen(localRect(target));
  close(screen.left, expected.left, `at ${scale}x: toScreen left`);
  close(screen.top, expected.top, `at ${scale}x: toScreen top`);
  close(screen.width, expected.width, `at ${scale}x: toScreen width`);
  close(screen.height, expected.height, `at ${scale}x: toScreen height`);
}

export const NestedPreview: StoryObj = {
  play: () => assertNestedPicking(),
  render: () => rig(),
};
