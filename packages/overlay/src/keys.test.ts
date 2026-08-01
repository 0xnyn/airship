import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFIX } from "./dom";
import { isInsidePopover, keys } from "./keys";

/*
 * The two questions the registry asks before it runs anything: "is the user
 * typing?" and "is this keystroke inside a popover?".
 *
 * They used to be one flag, and that is the bug this file exists to hold shut.
 * `isInsidePopover` was folded into `typing`, so a single `continue` skipped
 * every binding without `allowWhileTyping` — including the ones `popover-host`
 * registers for the popover *itself*, which carry no such flag. Every menu in
 * the overlay lost Escape and its arrow keys, and nothing caught it because
 * nothing here dispatched a key inside a popover.
 *
 * `within` is what separates them now, so the cases below are mostly about which
 * of the two guards a binding is standing behind.
 */

/** Undo every binding a test registered. The registry is a singleton. */
const disposers: (() => void)[] = [];

function bind(binding: Parameters<typeof keys.bind>[0]): () => void {
  const off = keys.bind(binding);
  disposers.push(off);
  return off;
}

/**
 * Dispatch from a specific node.
 *
 * `bubbles` so the event reaches `document`, where the registry listens. The
 * chord only needs `key` — `physicalKey` falls back to `e.key.toLowerCase()`
 * for everything outside the digit and letter rows.
 */
function press(from: Node, key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  from.dispatchEvent(e);
  return e;
}

/** A popover shell, as `popover-host` builds it: the class is what is matched. */
function popover(): { item: HTMLElement; shell: HTMLElement } {
  const shell = document.createElement("div");
  shell.className = `${PREFIX}-pop`;
  const item = document.createElement("button");
  shell.append(item);
  document.body.append(shell);
  return { item, shell };
}

function plain(tag = "button"): HTMLElement {
  const node = document.createElement(tag);
  document.body.append(node);
  return node;
}

afterEach(() => {
  for (const off of disposers.splice(0)) {
    off();
  }
  document.body.replaceChildren();
});

describe("isInsidePopover", () => {
  it("is true for a node inside a popover shell and false outside one", () => {
    const { item } = popover();
    expect(isInsidePopover(item)).toBe(true);
    expect(isInsidePopover(plain())).toBe(false);
  });

  it("is false for a target that is not an element", () => {
    // `document` and `window` reach the handler too, and neither has `closest`.
    expect(isInsidePopover(document)).toBe(false);
    expect(isInsidePopover(null)).toBe(false);
  });
});

describe("a binding scoped with `within`", () => {
  it("fires for a keystroke inside its element", () => {
    const { item, shell } = popover();
    const run = vi.fn();
    bind({ keys: "escape", label: "Close", run, within: shell });

    press(item, "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("declines a keystroke from outside its element", () => {
    const { shell } = popover();
    const run = vi.fn();
    bind({ keys: "escape", label: "Close", run, within: shell });

    press(plain(), "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("does not reach a sibling popover's rows", () => {
    // The nesting case: a menu opened from inside a popover is the host's
    // sibling, not its descendant, so the outer scope must not contain it.
    const outer = popover();
    const inner = popover();
    const outerRun = vi.fn();
    const innerRun = vi.fn();
    bind({
      keys: "arrowdown",
      label: "Next option",
      run: outerRun,
      within: outer.shell,
    });
    bind({
      keys: "arrowdown",
      label: "Next option",
      run: innerRun,
      within: inner.shell,
    });

    press(inner.item, "ArrowDown");

    expect(innerRun).toHaveBeenCalledTimes(1);
    expect(outerRun).not.toHaveBeenCalled();
  });

  it("declines a target in another document, where `contains` cannot reach", () => {
    // The `observe` path: a frame's own document shares this binding table.
    const { shell } = popover();
    const run = vi.fn();
    bind({ keys: "escape", label: "Close", run, within: shell });

    const other = document.implementation.createHTMLDocument();
    const node = other.createElement("button");
    other.body.append(node);
    keys.observe(other);
    disposers.push(() => keys.observe(other));

    press(node, "Escape");

    expect(run).not.toHaveBeenCalled();
  });
});

describe("an unscoped binding", () => {
  it("fires normally outside a popover", () => {
    const run = vi.fn();
    bind({ keys: "escape", label: "Deselect", run });

    press(plain(), "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is suppressed while the keystroke comes from inside a popover", () => {
    // The guard's whole purpose: the canvas nudge must not run under an open
    // colour picker, whose sliders are focusable divs and so read as "not typing".
    const { item } = popover();
    const run = vi.fn();
    bind({ keys: "arrowright", label: "Nudge", run });

    press(item, "ArrowRight");

    expect(run).not.toHaveBeenCalled();
  });

  it("yields to the popover's own binding on the same chord", () => {
    const { item, shell } = popover();
    const global = vi.fn();
    const scoped = vi.fn();
    bind({ keys: "escape", label: "Deselect", run: global });
    bind({ keys: "escape", label: "Close", run: scoped, within: shell });

    press(item, "Escape");

    expect(scoped).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe("typing still outranks scope", () => {
  it("withholds a scoped binding from a field inside the popover", () => {
    // A field owns its own Escape — the token picker clears its query on the
    // first press and closes on the second, and `bindField` reverts a value.
    // The registry matching first would `preventDefault` both out of existence.
    const { shell } = popover();
    const field = document.createElement("input");
    shell.append(field);
    const run = vi.fn();
    bind({ keys: "escape", label: "Close", run, within: shell });

    press(field, "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("still lets an `allowWhileTyping` binding through in a field", () => {
    const field = document.createElement("input");
    document.body.append(field);
    const run = vi.fn();
    bind({
      allowWhileTyping: true,
      keys: "escape",
      label: "Send",
      run,
    });

    press(field, "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a binding that matches", () => {
  it("consumes the event so nothing underneath sees it", () => {
    const { item, shell } = popover();
    bind({
      keys: "escape",
      label: "Close",
      run: () => undefined,
      within: shell,
    });

    const e = press(item, "Escape");

    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves the event alone when scope declines it", () => {
    const { shell } = popover();
    bind({
      keys: "escape",
      label: "Close",
      run: () => undefined,
      within: shell,
    });

    const e = press(plain(), "Escape");

    expect(e.defaultPrevented).toBe(false);
  });
});
