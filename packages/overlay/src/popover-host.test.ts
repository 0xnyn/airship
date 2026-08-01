import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls, el } from "./dom";
import { keys } from "./keys";
import {
  closeOpenPopover,
  mountPopoverHost,
  openPopover,
  type PopoverHandle,
  popoverHost,
} from "./popover-host";

/*
 * Popovers nest, shallowly.
 *
 * The singleton this replaced made "a control inside a popover opens a popover"
 * impossible, and impossible in the worst way: the inner open closed the
 * popover it was standing in, which detached its own trigger mid-click, so the
 * new one measured a zero-width anchor and the watchdog closed it a frame later.
 * Nothing appeared and nothing errored. Stroke's Advanced form has two selects
 * and the gradient editor has a swatch per stop; all of them were dead.
 *
 * The rules worth pinning down are the ones that were one line each when there
 * was a single slot and are now statements about a stack.
 */

/** A trigger in the page, outside every popover. */
function anchor(): HTMLElement {
  const node = el("button", { type: "button" });
  document.body.append(node);
  return node;
}

/** Open a popover, and hand back its shell and a spy on its close reason. */
function open(from: HTMLElement, content = el("div")) {
  const onClose = vi.fn();
  const handle = openPopover({ anchor: from, content, onClose });
  return { content, handle, onClose };
}

const shells = (): Element[] => [
  ...(popoverHost()?.querySelectorAll(`.${cls("pop")}`) ?? []),
];

/*
 * Mount the host, and never wipe the body.
 *
 * `popover-host` caches its mount in a module variable, so
 * `document.body.replaceChildren()` detaches the host while the host still
 * believes it is mounted — and then every `isConnected` in here reads false for
 * a reason that has nothing to do with what is being tested. `mountPopoverHost`
 * re-appends the cached node, so calling it per test is both idempotent and the
 * repair. Same trap `token-field.test.ts` documents.
 */
beforeEach(() => {
  mountPopoverHost(document.body);
});

afterEach(() => {
  closeOpenPopover("programmatic");
  for (const node of [...document.body.children]) {
    if (node !== popoverHost()) {
      node.remove();
    }
  }
});

describe("a popover opened from the page", () => {
  it("hands off: opening from a different anchor closes the first", () => {
    const a = open(anchor());
    open(anchor());
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect(shells()).toHaveLength(1);
  });

  it("toggles shut when its own anchor opens again", () => {
    const trigger = anchor();
    const first = open(trigger);
    open(trigger);
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(shells()).toHaveLength(0);
  });
});

describe("a popover opened from inside another", () => {
  /** A parent, and a child anchored to a trigger living in the parent's shell. */
  function nested() {
    const parent = open(anchor());
    // The child's trigger is inside the parent's content — a select in the
    // stroke form, a swatch in a gradient stop.
    const trigger = el("button", { type: "button" });
    parent.content.append(trigger);
    const child = open(trigger);
    return { child, parent, trigger };
  }

  it("leaves its parent open", () => {
    const { parent } = nested();
    expect(parent.onClose).not.toHaveBeenCalled();
    expect(shells()).toHaveLength(2);
  });

  it("keeps its anchor attached, which is what used to break", () => {
    // The old prologue closed the incumbent unconditionally, and `shell.remove()`
    // took the trigger with it — so placement measured a detached node.
    const { trigger } = nested();
    expect(trigger.isConnected).toBe(true);
  });

  it("paints above its parent, by DOM order alone", () => {
    const { parent, child } = nested();
    const order = shells();
    expect(order.indexOf(parent.handle.element)).toBeLessThan(
      order.indexOf(child.handle.element)
    );
  });

  it("closes alone, leaving the parent up", () => {
    const { parent, child } = nested();
    child.handle.close("escape");
    expect(child.onClose).toHaveBeenCalledTimes(1);
    expect(parent.onClose).not.toHaveBeenCalled();
    expect(shells()).toHaveLength(1);
  });

  it("goes when its parent goes, and each closes exactly once", () => {
    const { parent, child } = nested();
    parent.handle.close("outside");
    expect(child.onClose).toHaveBeenCalledTimes(1);
    expect(parent.onClose).toHaveBeenCalledTimes(1);
    expect(shells()).toHaveLength(0);
  });

  it("is closed before its parent leaves the DOM", () => {
    /*
     * Ordering, not just eventual state. A child's anchor lives inside its
     * parent's shell, so a child that outlives its parent by even one frame is
     * a popover anchored to a detached node — which is the state the watchdog
     * exists to catch, and it would catch it with a visible flicker.
     */
    const { parent, child } = nested();
    let parentStillMounted: boolean | null = null;
    child.onClose.mockImplementation(() => {
      parentStillMounted = parent.handle.element.isConnected;
    });
    parent.handle.close("programmatic");
    expect(parentStillMounted).toBe(true);
  });

  it("survives a parent whose onClose closes it again", () => {
    /*
     * `createSelect.destroy` calls `menu?.close()`, and a parent's `onClose`
     * destroys the controls it owns — so a close can re-enter from underneath.
     * Idempotence is what makes that safe, not luck about ordering.
     */
    const { parent, child } = nested();
    parent.onClose.mockImplementation(() => child.handle.close("programmatic"));
    expect(() => parent.handle.close("outside")).not.toThrow();
    expect(child.onClose).toHaveBeenCalledTimes(1);
    expect(shells()).toHaveLength(0);
  });

  it("gives way to a hand-off from outside the stack", () => {
    nested();
    open(anchor());
    expect(shells()).toHaveLength(1);
  });
});

describe("closeOpenPopover", () => {
  it("closes the whole stack, not the top of it", () => {
    // `DesignPanel.renderBody` is about to destroy every anchor in the panel;
    // closing only the top would leave a parent pointing at a dead control.
    const parent = open(anchor());
    const trigger = el("button", { type: "button" });
    parent.content.append(trigger);
    const child = open(trigger);

    closeOpenPopover("anchor-gone");
    expect(parent.onClose).toHaveBeenCalledWith("anchor-gone");
    expect(child.onClose).toHaveBeenCalledWith("anchor-gone");
    expect(shells()).toHaveLength(0);
  });

  it("is safe with nothing open", () => {
    mountPopoverHost(document.body);
    expect(() => closeOpenPopover()).not.toThrow();
  });
});

/*
 * The keyboard, which this file used to say nothing about at all.
 *
 * That silence is why every menu in the overlay shipped with Escape and its
 * arrow keys dead: `openPopover` registers both through the key registry, the
 * registry had folded "inside a popover" into its "is the user typing" guard,
 * and so the popover's own bindings skipped themselves. Nothing dispatched a
 * key from inside a shell, so nothing noticed.
 *
 * These press from the *item*, not from `document`, because that is the whole
 * point — `openPopover` focuses the first row on open, so a real keystroke
 * always originates inside the shell.
 */
describe("a popover's own keys", () => {
  /** A roving menu with three rows, as `createMenu` builds one. */
  function menu(): { content: HTMLElement; handle: PopoverHandle } {
    const content = el("div");
    for (const label of ["One", "Two", "Three"]) {
      content.append(
        el("button", { "data-pop-item": "", text: label, type: "button" })
      );
    }
    const handle = openPopover({ anchor: anchor(), content, roving: true });
    return { content, handle };
  }

  const rows = (content: HTMLElement): HTMLElement[] => [
    ...content.querySelectorAll<HTMLElement>("[data-pop-item]"),
  ];

  const cursor = (content: HTMLElement): string | null =>
    content.querySelector<HTMLElement>("[data-pop-active]")?.textContent ??
    null;

  function press(from: Node, key: string): void {
    from.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  }

  it("seeds the roving cursor on the first row", () => {
    const { content } = menu();
    expect(cursor(content)).toBe("One");
  });

  it("closes on Escape pressed from the focused row", () => {
    const { content } = menu();
    press(rows(content)[0], "Escape");
    expect(shells()).toHaveLength(0);
  });

  it("moves the cursor down and back up", () => {
    const { content } = menu();
    press(rows(content)[0], "ArrowDown");
    expect(cursor(content)).toBe("Two");
    press(rows(content)[1], "ArrowUp");
    expect(cursor(content)).toBe("One");
  });

  it("wraps past the last row rather than dead-ending", () => {
    const { content } = menu();
    press(rows(content)[0], "End");
    expect(cursor(content)).toBe("Three");
    press(rows(content)[2], "ArrowDown");
    expect(cursor(content)).toBe("One");
  });

  it("jumps to the first row on Home", () => {
    const { content } = menu();
    press(rows(content)[0], "End");
    press(rows(content)[2], "Home");
    expect(cursor(content)).toBe("One");
  });

  it("closes a non-roving popover from a plain node inside it", () => {
    // No rows to focus, so nothing moves focus into the shell on open — but a
    // keystroke that originates there still belongs to the popover.
    const content = el("div");
    const inside = el("div");
    content.append(inside);
    const onClose = vi.fn();
    openPopover({ anchor: anchor(), content, onClose });

    press(inside, "Escape");

    expect(onClose).toHaveBeenCalledWith("escape");
    expect(shells()).toHaveLength(0);
  });

  it("leaves a global binding standing while it is open", () => {
    // The guard's purpose, from the other side: the canvas nudge must not run
    // under an open menu.
    const nudge = vi.fn();
    const off = keys.bind({ keys: "arrowdown", label: "Nudge", run: nudge });
    try {
      const { content } = menu();
      press(rows(content)[0], "ArrowDown");
      expect(nudge).not.toHaveBeenCalled();
      expect(cursor(content)).toBe("Two");
    } finally {
      off();
    }
  });

  it("hands the keys back when it closes", () => {
    const nudge = vi.fn();
    const off = keys.bind({ keys: "arrowdown", label: "Nudge", run: nudge });
    try {
      const { content } = menu();
      press(rows(content)[0], "Escape");
      press(document.body, "ArrowDown");
      expect(nudge).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });
});
