/**
 * The frame list — its rows, its rename, and the one thing about it that is a
 * trap.
 *
 * The trap is `delete`. `FrameManager.remove` is one call and looks like the
 * whole job, and a panel that reached for it directly would ship a delete with
 * no way back: the undo for a frame is not in the model, it rides on the toast
 * that `frame-verbs.ts` raises (see that file's header). Nothing about the
 * manager's API would have refused, and nothing afterwards would have said so —
 * hence `routes delete through the shared verb`, which asserts on the toast
 * rather than on the frame being gone, because the frame being gone is the part
 * that was never in doubt.
 *
 * The rest is the render contract. `render` runs on every frame of a canvas pan
 * (it is driven from `CanvasStage.notify`), so the tests that matter are the
 * ones about what it does *not* do: rebuild rows that already exist, and
 * overwrite a name the user is in the middle of typing.
 *
 * No geometry here. happy-dom does no layout, so the reorder drag — which
 * resolves its target by hit-testing row rects — is covered at the model layer
 * in `frames.test.ts` instead, where the invariant it exists to protect (no
 * iframe is re-parented) actually lives.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { closeOpenPopover, mountPopoverHost } from "../popover-host";
import { mountToastHost } from "../toast";
import { FrameManager, MAX_FRAMES } from "./frames";
import { dropStackIndex, FramesPanel } from "./frames-panel";
import { CanvasViewport } from "./viewport";

let world: HTMLElement;
let frames: FrameManager;
let viewport: CanvasViewport;
let panel: FramesPanel;

function rows(): HTMLElement[] {
  return [...panel.element.querySelectorAll<HTMLElement>(`.${cls("fp-row")}`)];
}

function names(): string[] {
  return rows().map(
    (row) => row.querySelector(`.${cls("fp-name")}`)?.textContent ?? "?"
  );
}

function labelOf(id: string): HTMLElement {
  const node = panel.element.querySelector<HTMLElement>(
    `[data-frame="${id}"] .${cls("fp-name")}`
  );
  if (!node) {
    throw new Error(`no row for ${id}`);
  }
  return node;
}

function type(label: HTMLElement, text: string): void {
  label.textContent = text;
}

function key(label: HTMLElement, name: string): void {
  label.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name })
  );
}

/** The live toasts, by their text. */
function toasts(): string[] {
  return [...document.querySelectorAll(`.${cls("toast")}`)].map(
    (node) => node.textContent ?? ""
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  mountToastHost(document.body);
  /*
   * Re-mounted per test, not once.
   *
   * `popover-host` caches its mount in a module variable, so the
   * `replaceChildren` above detaches the host while the host still believes it
   * is mounted — and every menu opened afterwards is appended to a node that is
   * not in the document, where nothing can find it. `mountPopoverHost`
   * re-appends the cached node, so this is both idempotent and the repair. Same
   * trap `popover-host.test.ts` and `token-field.test.ts` document.
   */
  mountPopoverHost(document.body);
  world = document.createElement("div");
  document.body.append(world);
  viewport = new CanvasViewport({
    getContentRects: () => frames.worldRects(),
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-test:viewport",
  });
  frames = new FrameManager({
    onChanged: () => panel?.render(),
    pathname: "/",
    storageKey: "__airship-test:frames",
    world,
  });
  panel = new FramesPanel({ frames, viewport });
  document.body.append(panel.element);
  panel.render();
});

afterEach(() => {
  closeOpenPopover("programmatic");
  panel.destroy();
  frames.destroy();
  viewport.destroy();
  world.remove();
});

describe("FramesPanel rows", () => {
  it("lists the frames front-most first", () => {
    // The reverse of `frames.all`, which is paint order: `applyOrder` writes the
    // array index out as `z-index`, so the *last* frame is the one on top. A
    // layers panel puts that one at the top of the list, and until it did the
    // restack verbs pointed the wrong way. A frame added later is in front, so
    // it lands above the ones already there.
    frames.add({ name: "Desktop" });
    frames.add({ name: "iPhone" });

    expect(names()).toEqual(["iPhone", "Desktop"]);
    expect(rows().map((r) => r.dataset.frame)).toEqual(["f2", "f1"]);
  });

  it("follows a reorder", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    frames.add({ name: "three" });

    // Stack index 0 is the back, so "three" goes to the *bottom* of the list.
    frames.reorder("f3", 0);

    expect(names()).toEqual(["two", "one", "three"]);
  });

  it("shows the size and keeps it current", () => {
    frames.add({ height: 900, name: "Kiosk", width: 1200 });
    const dims = (): string =>
      panel.element.querySelector(`.${cls("fp-dims")}`)?.textContent ?? "";
    expect(dims()).toBe("1200 × 900");

    frames.resize("f1", 800, 600);
    expect(dims()).toBe("800 × 600");
  });

  it("marks the selected frame, and only that one", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    frames.setActive("f2");

    const on = panel.element.querySelectorAll(`.${cls("fp-row-on")}`);
    expect(on).toHaveLength(1);
    expect((on[0] as HTMLElement).dataset.frame).toBe("f2");
  });

  it("counts against the cap and stops offering to add past it", () => {
    const count = (): string =>
      panel.element.querySelector(`.${cls("fp-count")}`)?.textContent ?? "";
    const add = panel.element.querySelector<HTMLButtonElement>(
      `.${cls("fp-add")}`
    );
    expect(count()).toBe(`0 of ${MAX_FRAMES} frames`);
    expect(add?.disabled).toBe(false);

    for (let i = 0; i < MAX_FRAMES; i += 1) {
      frames.add({ name: `f${i}` });
    }

    expect(count()).toBe(`${MAX_FRAMES} of ${MAX_FRAMES} frames`);
    expect(add?.disabled).toBe(true);
  });

  it("opens its own device menu against its own button", () => {
    // Not the stage's. The `+` used to call `FrameChrome.openAddMenu`, which
    // places its menu against the bottom bar — so a press in the left dock
    // popped the device list open in the middle of the window. Picking the size
    // up front rather than guessing one is still the rule; where the menu
    // appears is what changed.
    panel.element.querySelector<HTMLElement>(`.${cls("fp-add")}`)?.click();

    const menu = document.querySelector(`.${cls("pop-menu")}`);
    expect(menu).not.toBeNull();
    expect(
      menu?.querySelectorAll(`.${cls("pop-group")}`).length
    ).toBeGreaterThan(1);
    // Opening the menu is not adding a frame; choosing a device is.
    expect(frames.all).toHaveLength(0);

    menu?.querySelector<HTMLElement>(`.${cls("pop-item")}`)?.click();
    expect(frames.all).toHaveLength(1);
  });

  it("keeps a shut group's rows in layout, so the menu cannot resize", () => {
    /*
     * The width jump this row menu shipped with: `.hidden` is
     * `display: none !important`, so a collapsed device group contributed
     * nothing to the shrink-to-fit box — about 158px with everything shut,
     * about 250 with one group open — and `seedOpenGroup` opens one at build
     * time, so the menu painted wide and snapped narrow on the first collapse.
     * Because `placePopover` derives `left` from `offsetWidth`, that was a
     * sideways jump as well as a resize.
     *
     * happy-dom does no layout, so what is asserted here is the mechanism: a
     * shut body is `inert` and still carries its rows, rather than being taken
     * out of the box model. The pixels are asserted in the browser tier.
     */
    frames.add({ name: "one" });
    panel.element.querySelector<HTMLElement>(`.${cls("fp-more")}`)?.click();

    const shut = [
      ...document.querySelectorAll<HTMLElement>(`.${cls("pop-group-body")}`),
    ].filter((body) => body.hasAttribute("inert"));

    expect(shut.length).toBeGreaterThan(0);
    for (const body of shut) {
      expect(body.classList.contains(cls("hidden"))).toBe(false);
      expect(
        body.querySelectorAll(`.${cls("pop-item")}`).length
      ).toBeGreaterThan(0);
    }
  });

  it("reuses rows when nothing about the set has changed", () => {
    // `render` is driven from the stage's `notify`, which fires on every frame
    // of a pan. Rebuilding there would destroy and recreate a dnd entity per
    // row sixty times a second.
    frames.add({ name: "one" });
    const [first] = rows();
    panel.render();
    panel.render();

    expect(rows()[0]).toBe(first);
  });
});

describe("FramesPanel accessibility", () => {
  it("names the drag handle instead of hiding it", () => {
    // The bug: a drag handle looks like decoration, so it was `aria-hidden`.
    // dnd-kit then stamps `tabindex="0"` and `role="button"` onto it as a
    // handle — a focusable node inside a hidden subtree, which is axe's
    // `aria-hidden-focus`, and a tab stop announcing nothing.
    frames.add({ name: "Desktop" });
    const grip = panel.element.querySelector(`.${cls("fp-grip")}`);

    expect(grip?.hasAttribute("aria-hidden")).toBe(false);
    expect(grip?.getAttribute("aria-label")).toBe("Reorder Desktop");
  });

  it("declines the attributes dnd-kit would put on the row", () => {
    /*
     * The row is the drag handle now, so it is what the Accessibility plugin
     * writes to — and every one of its writes is skipped when the attribute is
     * already there. Two of the three would be wrong here: a second tab stop per
     * row on top of the grip's, and a description telling a screen-reader user
     * to press the space bar, which `POINTER_ONLY` guarantees does nothing.
     */
    frames.add({ name: "Desktop" });
    const [row] = rows();

    expect(row.getAttribute("tabindex")).toBe("-1");
    expect(row.getAttribute("role")).toBe("listitem");
    // Pointed at the grip, which is the control that actually restacks.
    const describedBy = row.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toBe(
      row.querySelector(`.${cls("fp-grip")}`)
    );
  });

  it("keeps every derived name current through a rename", () => {
    frames.add({ name: "Desktop" });
    frames.rename("f1", "Marketing");

    const row = panel.element.querySelector(`.${cls("fp-row")}`);
    expect(
      row?.querySelector(`.${cls("fp-grip")}`)?.getAttribute("aria-label")
    ).toBe("Reorder Marketing");
    expect(
      row?.querySelector(`.${cls("fp-more")}`)?.getAttribute("aria-label")
    ).toBe("Options for Marketing");
    expect(
      row?.querySelector(`.${cls("fp-pick")}`)?.getAttribute("aria-label")
    ).toContain("Marketing");
  });

  it("keeps the rows a real list", () => {
    // dnd-kit stamps its role onto the *handle*, not the element — so the row
    // stays a `listitem`. Asserted rather than assumed: if that ever moves to
    // the element, `role="list"` would be left with non-listitem children.
    frames.add({ name: "one" });
    frames.add({ name: "two" });

    const list = panel.element.querySelector(`.${cls("fp-list")}`);
    expect(list?.getAttribute("role")).toBe("list");
    expect(rows().map((n) => n.getAttribute("role"))).toEqual([
      "listitem",
      "listitem",
    ]);
    // The drop line is a child of the list too — it has to be, or its offsets
    // are measured against one box and drawn against another. It must not be
    // announced as a row, and `dropIndexAt` must not count it as one.
    const line = list?.querySelector(`.${cls("fp-drop")}`);
    expect(line?.parentElement).toBe(list);
    expect(line?.hasAttribute("role")).toBe(false);
  });

  it("does not count the drop line as a row", () => {
    // The bug this guards: `dropIndexAt` used to walk `list.children`, so
    // moving the line inside the list would have silently added a phantom row
    // at the end and shifted every drop by one.
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    frames.add({ name: "three" });

    expect(rows()).toHaveLength(3);
    // happy-dom gives every rect zeroes, so every midpoint test is false and
    // the answer is 0 — what matters is that it is bounded by the row count
    // and not the child count.
    const index = (
      panel as unknown as { dropIndexAt: (y: number) => number }
    ).dropIndexAt(1e6);
    expect(index).toBe(3);
  });
});

describe("FramesPanel keyboard restack", () => {
  function arrow(id: string, name: string): void {
    panel.element
      .querySelector(`[data-frame="${id}"] .${cls("fp-grip")}`)
      ?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: name,
        })
      );
  }

  it("moves a row with the arrow keys", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    frames.add({ name: "three" });
    // Front-first, so the newest is on top: three, two, one.

    arrow("f1", "ArrowUp");
    expect(names()).toEqual(["three", "one", "two"]);

    arrow("f1", "ArrowDown");
    expect(names()).toEqual(["three", "two", "one"]);
  });

  it("moves the frame forward when the row moves up", () => {
    /*
     * The direction, asserted where it actually lives.
     *
     * Every other test here reads row order, which cannot tell a correct
     * restack from an inverted one — the row moves either way. `applyOrder`
     * writes the array index straight out as `z-index`, so this is the only
     * assertion that says the frame ended up in *front*. It is the regression
     * the whole reversal exists for: "Bring forward" used to run `moveBy(-1)`
     * against a back-first list and send the frame behind its neighbour.
     */
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    const z = (id: string) => Number(frames.byId(id)?.el.style.zIndex);
    expect(z("f1")).toBeLessThan(z("f2"));

    // "one" is the bottom row, because it is the back-most frame.
    arrow("f1", "ArrowUp");

    expect(z("f1")).toBeGreaterThan(z("f2"));
    expect(names()).toEqual(["one", "two"]);
  });

  it("keeps focus on the handle across the rebuild", () => {
    // `reorder` fires `onChanged`, which rebuilds every row — so the element
    // the keypress arrived on is gone by the time the handler returns. Without
    // re-taking focus the second press lands on the body and does nothing.
    frames.add({ name: "one" });
    frames.add({ name: "two" });

    arrow("f1", "ArrowUp");
    expect(names()).toEqual(["one", "two"]);
    expect(document.activeElement).toBe(
      panel.element.querySelector(`[data-frame="f1"] .${cls("fp-grip")}`)
    );
  });

  it("refuses to move past either end", () => {
    frames.add({ name: "one" });
    frames.add({ name: "two" });
    // "two" is the top row and "one" the bottom, so these are the two ends.

    arrow("f2", "ArrowUp");
    expect(names()).toEqual(["two", "one"]);

    arrow("f1", "ArrowDown");
    expect(names()).toEqual(["two", "one"]);
  });

  it("swallows the arrow even when the move is refused", () => {
    // Otherwise the panel scrolls under a keypress that changed nothing, which
    // reads as the row having moved.
    frames.add({ name: "one" });
    const grip = panel.element.querySelector(`.${cls("fp-grip")}`);
    const e = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    grip?.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves other keys alone", () => {
    frames.add({ name: "one" });
    const grip = panel.element.querySelector(`.${cls("fp-grip")}`);
    const e = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    grip?.dispatchEvent(e);

    // The Tab that dnd-kit's keyboard sensor used to eat. Nothing here may
    // claim it — see `POINTER_ONLY`.
    expect(e.defaultPrevented).toBe(false);
  });

  it("registers rows pointer-only, so no keyboard drag can latch", () => {
    // The bug: a `FEEDBACK.none` draggable can start a keyboard drag it can
    // never move and cannot be tabbed out of. The row must carry its own
    // sensor list rather than inheriting the manager's.
    frames.add({ name: "one" });
    const [entity] = (
      panel as unknown as { scope: { entities: { sensors?: unknown[] }[] } }
    ).scope.entities;

    expect(entity.sensors).toHaveLength(1);
  });
});

describe("FramesPanel navigation", () => {
  it("selects and centres on a click, without changing the zoom", () => {
    frames.add({ height: 1000, name: "one", width: 1000, x: 0, y: 0 });
    viewport.set({ scale: 2, x: 0, y: 0 });

    panel.element.querySelector<HTMLElement>(`.${cls("fp-pick")}`)?.click();

    expect(frames.active?.id).toBe("f1");
    // The whole point of centre-over-fit: a list you can step through while
    // staying at the scale you were working at.
    expect(viewport.scale).toBe(2);
  });
});

describe("FramesPanel rename", () => {
  it("commits on Enter", () => {
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Marketing");
    key(label, "Enter");

    expect(frames.byId("f1")?.name).toBe("Marketing");
    expect(label.isContentEditable).toBe(false);
  });

  it("restores the old name on Escape", () => {
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Nope");
    key(label, "Escape");

    expect(frames.byId("f1")?.name).toBe("Desktop");
    expect(label.textContent).toBe("Desktop");
  });

  it("refuses an empty name instead of leaving an unreadable row", () => {
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "   ");
    key(label, "Enter");

    expect(frames.byId("f1")?.name).toBe("Desktop");
    expect(label.textContent).toBe("Desktop");
  });

  it("restores the right name when the same row is renamed twice", () => {
    /*
     * The bug: the label is reused rather than rebuilt, and every `beginRename`
     * added a `keydown` listener that was never removed while `finish` guarded
     * on the shared `this.renaming`. On a second rename both listeners matched
     * and the *older* one ran first — so Escape restored the name from before
     * the first rename, over a model holding the second, and it stayed wrong
     * until something else happened to re-render.
     */
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");

    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Marketing");
    key(label, "Enter");
    expect(frames.byId("f1")?.name).toBe("Marketing");

    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Scratch");
    key(label, "Escape");

    // Back to what the model actually holds, not to the original name.
    expect(frames.byId("f1")?.name).toBe("Marketing");
    expect(label.textContent).toBe("Marketing");
  });

  it("does not leave a listener behind per rename", () => {
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    for (let i = 0; i < 3; i += 1) {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      key(label, "Escape");
    }

    // A fourth session must see exactly one live handler: if the previous three
    // were still attached, the oldest would win `finish` and revert to its own
    // stale `before`.
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Final");
    key(label, "Enter");
    expect(frames.byId("f1")?.name).toBe("Final");
  });

  it("does not let a render overwrite what is being typed", () => {
    // The bug this prevents: `render` runs on every frame of a canvas pan, and
    // an unguarded `sync` would rewrite the label from the model on each one —
    // so renaming a frame while the canvas drifted would silently erase itself.
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    type(label, "Half-typ");

    panel.render();

    expect(label.textContent).toBe("Half-typ");
  });

  it("keeps the keystrokes away from the canvas bindings", () => {
    // ⌫ deletes the selected *frame* in view mode (`FrameChrome`'s binding), so
    // a backspace that escaped the rename would delete the thing being renamed.
    frames.add({ name: "Desktop" });
    const label = labelOf("f1");
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    let reached = false;
    document.addEventListener("keydown", () => {
      reached = true;
    });
    key(label, "Backspace");

    expect(reached).toBe(false);
  });
});

describe("FramesPanel dragging", () => {
  it("stops the options button from arming a drag", () => {
    /*
     * The whole row is the drag target, and dnd-kit's pointer sensor listens on
     * it — so without this guard a press on `⋯` starts a drag. The 4px threshold
     * means the click still lands and the menu still opens, which is what makes
     * the bug quiet: the row fades and a drop line appears under a pointer that
     * was only reaching for a menu.
     */
    frames.add({ name: "Desktop" });
    const more = panel.element.querySelector<HTMLElement>(`.${cls("fp-more")}`);
    const press = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    let reachedRow = false;
    rows()[0].addEventListener("pointerdown", () => {
      reachedRow = true;
    });
    more?.dispatchEvent(press);

    expect(reachedRow).toBe(false);
  });

  it("leaves the rest of the row free to start one", () => {
    // The complement, and the point of the change: a press on the row's body
    // must reach the row, because that is what the sensor is listening on.
    frames.add({ name: "Desktop" });
    let reachedRow = false;
    rows()[0].addEventListener("pointerdown", () => {
      reachedRow = true;
    });
    panel.element
      .querySelector<HTMLElement>(`.${cls("fp-pick")}`)
      ?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true })
      );

    expect(reachedRow).toBe(true);
  });
});

describe("FramesPanel verbs", () => {
  it("routes delete through the shared verb, so it still offers Undo", () => {
    frames.add({ name: "Desktop" });
    const before = frames.all.length;

    panel.element.querySelector<HTMLElement>(`.${cls("fp-more")}`)?.click();
    const del = [
      ...document.querySelectorAll<HTMLElement>("[data-pop-item]"),
    ].find((node) => node.textContent?.includes("Delete"));
    del?.click();

    expect(frames.all).toHaveLength(before - 1);
    // The assertion that matters. A panel calling `frames.remove` directly
    // would pass every other test in this file and lose the undo.
    expect(toasts().join(" ")).toContain("Undo");
  });
});

/*
 * The drop's arithmetic, on its own.
 *
 * Driving a real drag needs dnd-kit's manager and a DOM that lays out, and this
 * one has neither — but the part of a drop that can be wrong is not the plumbing,
 * it is these two corrections. Both are off-by-one shaped, and both move the
 * frame one place from where the drop line promised, which reads as a sloppy
 * drop rather than as a bug.
 */
describe("dropStackIndex", () => {
  // Three rows, front-first: list 0,1,2 ↔ stack 2,1,0.
  const TOTAL = 3;

  it("puts a row dropped at the top at the front of the stack", () => {
    // Dragged from the bottom row to slot 0 — nothing was lifted from above it,
    // so the slot is the landing position.
    expect(dropStackIndex(0, 2, TOTAL)).toBe(2);
  });

  it("puts a row dropped past the end at the back of the stack", () => {
    // Slot 3 is past the last row; lifting the top row out shifts it to 2.
    expect(dropStackIndex(3, 0, TOTAL)).toBe(0);
  });

  it("discounts the row's own slot when it travelled downward", () => {
    // Top row to slot 2: the two rows it passed have moved up, so it lands at 1.
    expect(dropStackIndex(2, 0, TOTAL)).toBe(1);
  });

  it("does not discount when it travelled upward", () => {
    // Bottom row to slot 1: nothing between it and the slot moved.
    expect(dropStackIndex(1, 2, TOTAL)).toBe(1);
  });

  it("is a no-op for a drop onto the row's own slot", () => {
    for (const at of [0, 1, 2]) {
      expect(dropStackIndex(at, at, TOTAL)).toBe(TOTAL - 1 - at);
    }
  });
});
