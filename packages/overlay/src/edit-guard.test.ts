import { afterEach, describe, expect, it } from "vitest";
import { PREFIX } from "./dom";
import { pressVerdict, SWALLOWED } from "./edit-guard";

/*
 * The press precedence, which used to be implicit in the order of three early
 * returns inside `onPress`.
 *
 * Tested against `pressVerdict` rather than an `EditGuard`, because constructing
 * one subscribes to the dnd-kit manager singleton — that is the reason the
 * function was split out, and this is the thing it bought.
 */

function node(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as Element;
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("pressVerdict", () => {
  it("ignores the editor's own chrome", () => {
    const root = document.createElement("div");
    root.id = `${PREFIX}-root`;
    root.innerHTML = "<button>Send</button>";
    document.body.append(root);
    expect(pressVerdict(root.firstElementChild, null, [])).toBe("ignore");
  });

  it("swallows a press on the app", () => {
    expect(pressVerdict(node("<button>Buy</button>"), null, [])).toBe(
      "swallow"
    );
  });

  it("hatches a press on the node being edited", () => {
    const text = node("<p>Hello</p>");
    expect(pressVerdict(text, text, [])).toBe("text");
  });

  it("hatches a press on a descendant of it", () => {
    const text = node("<p>Hi <b>there</b></p>");
    const inner = text.querySelector("b") as Element;
    expect(pressVerdict(inner, text, [])).toBe("text");
  });

  it("hatches a press on a registered drag source", () => {
    const proxy = node("<div>proxy</div>");
    expect(pressVerdict(proxy, null, [() => proxy])).toBe("drag");
  });

  it("prefers text over drag when a node is both", () => {
    // The reorder proxy sits over the selection, which is exactly the node you
    // are most likely to be editing. Answering "drag" there would kill the
    // default and take the caret away.
    const both = node("<p>Hello</p>");
    expect(pressVerdict(both, both, [() => both])).toBe("text");
  });

  it("skips a provider that currently has no element", () => {
    const app = node("<button>Buy</button>");
    expect(pressVerdict(app, null, [() => null, () => null])).toBe("swallow");
  });

  it("swallows a press with no target at all", () => {
    expect(pressVerdict(null, node("<p>Hi</p>"), [])).toBe("swallow");
  });
});

describe("SWALLOWED", () => {
  it("leaves click, dblclick and contextmenu to the picker", () => {
    // All three are the picker's outright — one selects, one enters in-place
    // text editing, one opens the editor's menu on the selection. Putting any
    // back here gives the event two owners and silently breaks the picker's,
    // since `onPress` runs first.
    expect(SWALLOWED).not.toContain("click");
    expect(SWALLOWED).not.toContain("dblclick");
    expect(SWALLOWED).not.toContain("contextmenu");
  });

  it("still covers the presses that would wake the app", () => {
    expect(SWALLOWED).toContain("pointerdown");
    expect(SWALLOWED).toContain("mousedown");
    expect(SWALLOWED).toContain("auxclick");
  });
});
