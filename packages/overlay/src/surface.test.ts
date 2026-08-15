import { afterEach, describe, expect, it } from "vitest";
import { type Frame, FrameManager } from "./canvas/frames";
import type { CanvasViewport } from "./canvas/viewport";
import { cls, PREFIX } from "./dom";
import {
  CanvasResolver,
  InlineResolver,
  InlineSurface,
  NestedSurface,
} from "./surface";

/*
 * Hit-testing through the editor's own overlay.
 *
 * Inline, the editor shares a document with the app, and some of its chrome is
 * deliberately opaque to the pointer — the reorder drag proxy above all, which
 * is pinned over the selection with `pointer-events: auto` so dnd-kit can arm a
 * grab from anywhere on it, and which is deliberately *not* tagged as chrome for
 * `event.target` purposes so a click landing on it can still resolve to whatever
 * is underneath.
 *
 * That resolution only ever worked on the canvas, where the hit-test asks the
 * *frame's* document and the proxy lives in the shell's. Inline it is one
 * document, so `elementFromPoint` genuinely returned the proxy: every gesture
 * over the current selection resolved to a chrome div. Hovering it drew a box
 * labelled `div.__airship-drag-proxy`, and double-click-to-edit could never fire
 * at all, because the second click of every double-click lands on the proxy the
 * first one armed.
 *
 * happy-dom has no layout, so the stack is stubbed — what is under test is the
 * filter, not the browser's hit test.
 */

/**
 * Stub the document's hit test with a fixed stack, topmost first.
 *
 * `defineProperty` rather than `vi.spyOn`, because happy-dom does not implement
 * `elementsFromPoint` at all and there is nothing to spy on — which is also why
 * `elementAtScreen` carries a fallback to the single-element hit test.
 */
function stack(nodes: Element[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => nodes,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, "elementsFromPoint");
});

function div(className?: string, id?: string): HTMLElement {
  const node = document.createElement("div");
  if (className) {
    node.className = className;
  }
  if (id) {
    node.id = id;
  }
  document.body.append(node);
  return node;
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("InlineSurface.elementAtScreen", () => {
  const at = (): Element | null =>
    new InlineSurface().elementAtScreen({ x: 10, y: 10 });

  it("returns the topmost app node", () => {
    const app = div("card");
    stack([app, document.body]);
    expect(at()).toBe(app);
  });

  it("looks through the reorder drag proxy", () => {
    // The regression. The proxy sits directly over the selection, so it is
    // topmost for every gesture aimed at the thing you most want to edit.
    const app = div("heading");
    stack([div(cls("drag-proxy")), app, document.body]);
    expect(at()).toBe(app);
  });

  it("looks through several layers of chrome at once", () => {
    const app = div("heading");
    stack([
      div(cls("drag-proxy")),
      div(`${cls("layer")} ${cls("sel-box")}`),
      app,
      document.body,
    ]);
    expect(at()).toBe(app);
  });

  it("looks through the overlay root's subtree", () => {
    const root = div(undefined, `${PREFIX}-root`);
    const button = document.createElement("button");
    root.append(button);
    const app = div("heading");
    stack([button, app, document.body]);
    expect(at()).toBe(app);
  });

  it("answers null when there is nothing but chrome", () => {
    stack([div(cls("drag-proxy")), div(cls("hover-box"))]);
    expect(at()).toBeNull();
  });

  it("answers null over an empty stack", () => {
    stack([]);
    expect(at()).toBeNull();
  });
});

// -- nested documents ---------------------------------------------------------
// happy-dom does no layout, so each document's single-element hit test is
// stubbed; what is under test is the descent, the ascent and the composition.

/** Pin one document's hit test to a fixed answer. */
function stubHit(doc: Document, node: Element | null): void {
  Object.defineProperty(doc, "elementFromPoint", {
    configurable: true,
    value: () => node,
    writable: true,
  });
}

/** Pin an element's screen rect — see space.test.ts for the same idiom. */
function stubRect(el: Element, left: number, top: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ height: 0, left, top, width: 0 }) as DOMRect;
}

interface NestedFixture {
  frame: Frame;
  frames: FrameManager;
  nested: HTMLIFrameElement;
  nestedDoc: Document;
  resolver: CanvasResolver;
  target: Element;
  world: HTMLElement;
}

function nestedFixture(scale = 1): NestedFixture {
  const world = document.createElement("div");
  document.body.append(world);
  const frames = new FrameManager({
    pathname: "/",
    storageKey: "__airship-test:surface",
    world,
  });
  const frame = frames.add({ name: "one" });
  if (!frame?.doc) {
    throw new Error("frame did not build");
  }
  const nested = frame.doc.createElement("iframe");
  frame.doc.body.append(nested);
  const nestedDoc = nested.contentDocument as Document;
  const target = nestedDoc.createElement("button");
  nestedDoc.body.append(target);

  stubHit(frame.doc, nested);
  stubHit(nestedDoc, target);

  const resolver = new CanvasResolver(frames, {
    scale,
  } as unknown as CanvasViewport);
  return { frame, frames, nested, nestedDoc, resolver, target, world };
}

describe("CanvasResolver, over a nested same-origin iframe", () => {
  afterEach(() => {
    // The fixture's manager owns the global ready-hook; drop it.
    for (const child of Array.from(document.body.children)) {
      child.remove();
    }
  });

  it("descends to the deepest surface instead of returning the iframe", () => {
    const { resolver, nestedDoc, target } = nestedFixture();
    // happy-dom's zero-size rects put {0,0} inside the frame.
    const surface = resolver.at({ x: 0, y: 0 });

    expect(surface).toBeInstanceOf(NestedSurface);
    expect(surface?.doc).toBe(nestedDoc);
    expect(surface?.elementAtScreen({ x: 0, y: 0 })).toBe(target);
  });

  it("resolves a nested node back to the same nested surface", () => {
    const { resolver, nestedDoc, target } = nestedFixture();
    const surface = resolver.of(target);

    expect(surface).toBeInstanceOf(NestedSurface);
    expect(surface?.doc).toBe(nestedDoc);
    // Identity is stable across calls — the picker compares surfaces by it.
    expect(resolver.of(target)).toBe(surface);
    expect(resolver.at({ x: 0, y: 0 })).toBe(surface);
  });

  it("keeps the frame surface for the frame's own nodes", () => {
    const { resolver, frame } = nestedFixture();
    const own = frame.doc?.body as Element;

    expect(resolver.of(own)).not.toBeInstanceOf(NestedSurface);
    expect(resolver.of(own)?.doc).toBe(frame.doc);
  });

  it("composes the nested offset under the canvas scale", () => {
    const { resolver, target, frame, nested } = nestedFixture(2);
    stubRect(frame.el, 100, 50);
    stubRect(nested, 30, 40);

    const surface = resolver.of(target);
    const screen = surface?.toScreen({ height: 4, left: 10, top: 5, width: 6 });

    // left = frame.left + (rect.left + offset.x) * scale = 100 + 40*2.
    expect(screen).toEqual({ height: 8, left: 180, top: 140, width: 12 });

    const back = surface?.toLocal({ x: 180, y: 140 });
    expect(back?.x).toBeCloseTo(10, 6);
    expect(back?.y).toBeCloseTo(5, 6);
  });

  it("stops at a boundary whose document is unreachable", () => {
    const { resolver, frame, nested } = nestedFixture();
    Object.defineProperty(nested, "contentDocument", {
      configurable: true,
      get() {
        return null;
      },
    });

    const surface = resolver.at({ x: 0, y: 0 });
    expect(surface).not.toBeInstanceOf(NestedSurface);
    expect(surface?.doc).toBe(frame.doc);
  });
});

describe("InlineResolver, over a nested same-origin iframe", () => {
  it("descends and ascends with the page as the root", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const innerDoc = iframe.contentDocument as Document;
    const target = innerDoc.createElement("p");
    innerDoc.body.append(target);

    stack([iframe, document.body]);
    stubHit(innerDoc, target);

    const resolver = new InlineResolver();
    const surface = resolver.at({ x: 10, y: 10 });
    expect(surface.doc).toBe(innerDoc);
    expect(surface.elementAtScreen({ x: 10, y: 10 })).toBe(target);
    expect(resolver.of(target)).toBe(surface);
    // The top document keeps the one inline surface.
    expect(resolver.of(document.body).doc).toBe(document);
  });
});
