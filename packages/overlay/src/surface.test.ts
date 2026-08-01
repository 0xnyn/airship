import { afterEach, describe, expect, it } from "vitest";
import { cls, PREFIX } from "./dom";
import { InlineSurface } from "./surface";

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
