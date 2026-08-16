import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls, el } from "./dom";
import { keys } from "./keys/registry";
import {
  closeOpenPopover,
  createMenu,
  type MenuGroup,
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
    const off = keys.bind({ id: "element.nudge", run: nudge });
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
    const off = keys.bind({ id: "element.nudge", run: nudge });
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

/*
 * The reflow listener is registered in capture phase, which is what lets it see
 * scrolls inside `.insp-body` — and, for a long time, scrolls inside the popover
 * itself. `reposition` is `placePopover`, whose first act is to clear the
 * `max-height` it wrote so it can measure the content unconstrained. Under a
 * scrolled menu that let the box grow to full height, so the browser clamped
 * `scrollTop` back to zero before the cap went on again: every wheel tick over
 * the frame menu's twenty-seven rows snapped it to the top, which reads as a
 * menu that simply refuses to scroll.
 */
describe("a scrollable popover", () => {
  it("keeps its scroll position when the scroll came from inside it", () => {
    const { handle } = open(anchor());
    const shell = shells()[0] as HTMLElement;
    // happy-dom does no layout, so `scrollTop` will not stick on its own.
    let top = 0;
    Object.defineProperty(shell, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const spy = vi.spyOn(handle, "reposition");

    shell.scrollTop = 40;
    shell.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(shell.scrollTop).toBe(40);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still re-places when something else scrolls", () => {
    // The behaviour the guard must not cost: a scroller the popover is anchored
    // inside still moves the anchor, and the popover has to follow it.
    const scroller = el("div");
    document.body.append(scroller);
    const trigger = el("button", { type: "button" });
    scroller.append(trigger);
    const { handle } = open(trigger);
    const spy = vi.spyOn(handle, "reposition");

    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(spy).toHaveBeenCalled();
  });
});

/*
 * The accordion.
 *
 * A flat `pop-head` is right for three verbs and wrong for twenty-two device
 * presets, where the menu becomes a twenty-seven-item column that gets capped
 * and scrolled — so Delete ends up below the fold of a menu you opened to reach
 * it. What is worth pinning down is the part that is not visual: exactly one
 * group is open, a shut group's rows stay in the DOM but out of the keyboard
 * cursor, and a disclosure is not a choice.
 */
describe("a menu with collapsible groups", () => {
  const GROUPS: MenuGroup[] = [
    {
      group: "phone",
      items: [
        { label: "iPhone", run: () => undefined },
        { label: "Pixel", run: () => undefined },
      ],
      label: "Phone",
    },
    {
      group: "desktop",
      // Deliberately not "Desktop": a row sharing its group's label would make
      // the cursor test unable to tell a reachable row from a header.
      items: [{ label: "MacBook", run: () => undefined }],
      label: "Desktop",
    },
  ];

  const body = (content: ParentNode, id: string) =>
    content.querySelector<HTMLElement>(
      `[data-group="${id}"] .${cls("pop-group-body")}`
    );

  const head = (content: ParentNode, id: string) =>
    content.querySelector<HTMLElement>(
      `[data-group="${id}"] .${cls("pop-group-head")}`
    );

  const openGroups = (content: ParentNode) =>
    ["phone", "desktop"].filter(
      (id) => head(content, id)?.getAttribute("aria-expanded") === "true"
    );

  /**
   * Open a grouped menu and hand back its content.
   *
   * The content, not the shell: `openPopover` scopes the arrow-key bindings to
   * exactly that element, so a keypress dispatched from anywhere else is outside
   * the scope and does nothing.
   */
  function grouped(entries = GROUPS): HTMLElement {
    const handle = createMenu(entries);
    handle.open(anchor(), "below");
    const content = shells()[0]?.querySelector<HTMLElement>(
      `.${cls("pop-menu")}`
    );
    if (!content) {
      throw new Error("no menu");
    }
    return content;
  }

  function key(from: Node, name: string): void {
    from.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: name,
      })
    );
  }

  it("opens with exactly one group expanded", () => {
    // Never all-shut: a menu that opens as two headers and nothing to read makes
    // you work out that they are headers before it will show you anything.
    expect(openGroups(grouped())).toEqual(["phone"]);
  });

  it("honours the seeded group rather than always taking the first", () => {
    const content = grouped([GROUPS[0], { ...GROUPS[1], open: true }]);
    expect(openGroups(content)).toEqual(["desktop"]);
  });

  it("expands one at a time", () => {
    const content = grouped();
    head(content, "desktop")?.click();
    expect(openGroups(content)).toEqual(["desktop"]);
  });

  it("collapses the open group when its own header is clicked", () => {
    const content = grouped();
    head(content, "phone")?.click();
    expect(openGroups(content)).toEqual([]);
  });

  it("leaves a shut group's rows measured but unreachable", () => {
    /*
     * Detaching them would put them out of reach of anything that reads the
     * built menu back — the trap `frame-chrome.ts` documents for its own
     * accordion, where a collapsed group's current-device mark went stale.
     *
     * `inert` rather than the `hidden` utility, and that is the load-bearing
     * half. `.hidden` is `display: none !important`, so a shut group measured
     * zero width and the menu's shrink-to-fit box was one size with its groups
     * closed and another with one open — which `placePopover` then read back as
     * a different `offsetWidth` and turned into a sideways jump. An inert body
     * is still laid out, so it goes on setting the width it always did.
     */
    const content = grouped();
    head(content, "desktop")?.click();

    expect(body(content, "phone")?.hasAttribute("inert")).toBe(true);
    expect(body(content, "phone")?.classList.contains(cls("hidden"))).toBe(
      false
    );
    expect(
      content.querySelector(`[data-group="phone"] .${cls("pop-item")}`)
    ).not.toBeNull();
  });

  it("drops the inert mark from the group it opens", () => {
    const content = grouped();
    head(content, "desktop")?.click();

    expect(body(content, "desktop")?.hasAttribute("inert")).toBe(false);
  });

  it("keeps the keyboard cursor out of a collapsed group", () => {
    const content = grouped();
    // Phone is open, so its two rows are reachable and Desktop's one is not.
    // Both headers always are — they are the only way to open a group by key.
    key(content, "ArrowDown");
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(
        content
          .querySelector<HTMLElement>("[data-pop-active]")
          ?.textContent?.trim() ?? "?"
      );
      key(content, "ArrowDown");
    }
    expect(seen).not.toContain("MacBook");
    expect(seen).toContain("iPhone");
  });

  it("does not close the menu when a group is toggled", () => {
    // A row's click closes the popover before it runs; a disclosure must not,
    // or opening a group would dismiss the menu you were reading.
    const content = grouped();
    head(content, "desktop")?.click();
    expect(shells()).toHaveLength(1);
  });

  it("closes the menu when a row inside a group is chosen", () => {
    const run = vi.fn();
    const content = grouped([
      { group: "phone", items: [{ label: "iPhone", run }], label: "Phone" },
    ]);
    content.querySelector<HTMLElement>(`.${cls("pop-item")}`)?.click();

    expect(run).toHaveBeenCalledTimes(1);
    expect(shells()).toHaveLength(0);
  });

  it("drops a `node` entry in as its own row", () => {
    // The escape hatch for the custom width × height form.
    const custom = el("div", { class: "custom-form" });
    const handle = createMenu([GROUPS[0], { node: custom }]);
    handle.open(anchor(), "below");

    expect(shells()[0].querySelector(".custom-form")).toBe(custom);
  });
});

/*
 * The modal shape, the title bar, and the parts of both that no case reached.
 *
 * `popover-host.ts` grew by a third when the palette, the shortcuts sheet and
 * the movable title bar landed, and this file's diff for all of it was an import
 * path and two renamed literals. What follows covers the behaviour that has a
 * user-visible failure mode: a scrim that must take the press meant for the page
 * behind it, focus that must come back to whatever opened the modal, and a title
 * bar that must be a pointer affordance without pretending to be a keyboard one.
 */
describe("a modal popover", () => {
  it("puts a scrim behind it", () => {
    openPopover({ content: el("div"), modal: true });

    expect(popoverHost()?.querySelector(`.${cls("pop-scrim")}`)).not.toBeNull();
  });

  it("takes the scrim away again when it closes", () => {
    const handle = openPopover({ content: el("div"), modal: true });

    handle.close("programmatic");

    expect(popoverHost()?.querySelector(`.${cls("pop-scrim")}`)).toBeNull();
  });

  it("gives focus back to whatever opened it", () => {
    // Without this, dismissing the palette drops focus on the body and the next
    // keystroke goes nowhere — the composer the user was in is no longer live.
    const trigger = anchor();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // No option for it: the shell remembers whatever had focus when it opened,
    // and a modal passes no anchor, so this is the only thing it can go back to.
    const handle = openPopover({ content: el("div"), modal: true });
    // Focus has to actually leave, or the case proves nothing about restoring it.
    const [shell] = shells();
    (shell as HTMLElement).focus();
    expect(document.activeElement).not.toBe(trigger);

    handle.close("programmatic");

    expect(document.activeElement).toBe(trigger);
  });

  it("carries the class it was asked for", () => {
    // The palette and the shortcuts sheet size themselves through these, and
    // both were applied for a long time with no rule anywhere to receive them.
    openPopover({ className: "pop-palette", content: el("div"), modal: true });

    expect(
      popoverHost()?.querySelector(`.${cls("pop-palette")}`)
    ).not.toBeNull();
  });
});

describe("a popover with a title", () => {
  it("wears a draggable bar", () => {
    openPopover({ anchor: anchor(), content: el("div"), title: "Stroke" });

    const bar = popoverHost()?.querySelector(`.${cls("pop-bar")}`);
    expect(bar?.textContent).toContain("Stroke");
  });

  it("hides the bar from assistive tech and names the shell instead", () => {
    /*
     * The bar is a `POINTER_ONLY` draggable, and dnd-kit stamps
     * `aria-roledescription="draggable"` and a tab stop onto any handle. With no
     * keyboard sensor that is a control which announces itself as movable and
     * answers no key — the promise `POINTER_ONLY`'s own docstring says not to
     * make. The title moves to the shell so nothing is lost.
     */
    openPopover({ anchor: anchor(), content: el("div"), title: "Stroke" });

    const bar = popoverHost()?.querySelector(`.${cls("pop-bar")}`);
    const shell = popoverHost()?.querySelector(`.${cls("pop")}`);
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(shell?.getAttribute("aria-label")).toBe("Stroke");
    expect(shell?.getAttribute("role")).toBe("group");
  });

  it("keeps the hidden bar out of the tab order", () => {
    /*
     * The half that makes `aria-hidden` honest, and the half a browser decides
     * rather than this test's DOM: dnd-kit's Accessibility plugin writes
     * `tabindex="0"` onto any drag handle, guarded only by
     * `!activator.hasAttribute("tabindex")`. Writing one first is what stops it,
     * and without it the bar would be hidden from screen readers *and* reachable
     * by Tab — which is a worse trap than the one being fixed.
     */
    openPopover({ anchor: anchor(), content: el("div"), title: "Stroke" });

    const bar = popoverHost()?.querySelector(`.${cls("pop-bar")}`);
    expect(bar?.getAttribute("tabindex")).toBe("-1");
    expect((bar as HTMLElement).tabIndex).toBe(-1);
  });

  it("builds no bar at all without one", () => {
    openPopover({ anchor: anchor(), content: el("div") });

    expect(popoverHost()?.querySelector(`.${cls("pop-bar")}`)).toBeNull();
  });
});
