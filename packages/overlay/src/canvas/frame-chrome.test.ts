import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeLayer } from "../chrome-layer";
import { cls } from "../dom";
import { mountToastHost } from "../toast";
import { FrameChrome } from "./frame-chrome";
import { FrameManager, MAX_FRAMES } from "./frames";
import { CanvasViewport } from "./viewport";

/*
 * The frame verb group in the bar, and the ⌫ that reaches the same delete.
 *
 * Unlike `frames.test.ts` this stands the real `FrameChrome` up, because what is
 * being checked is the wiring rather than the model: that a selection shows the
 * group, that the keybinding declines in the two states it must decline in, and
 * that a delete offers itself back. Constructing one subscribes to the dnd-kit
 * manager singleton and to `document` — both fine here, and `destroy` unwinds
 * both, which is why every test tears down.
 *
 * `frameScreenRect` needs layout that happy-dom does not do, so nothing here
 * asserts placement. Every assertion is on class, text or call state.
 */

let layer: ChromeLayer;
let viewport: CanvasViewport;
let frames: FrameManager;
let chrome: FrameChrome;
let host: HTMLElement;

/** The group `mountFrameTools` put in the bar's view-mode slot. */
function group(): HTMLElement {
  const node = host.querySelector<HTMLElement>(`.${cls("fbar-frame")}`);
  if (!node) {
    throw new Error("frame tools were never mounted");
  }
  return node;
}

function shown(): boolean {
  return !group().classList.contains(cls("hidden"));
}

/** A verb button in the group, by its `aria-label`. */
function verb(label: string): HTMLElement {
  const node = group().querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!node) {
    throw new Error(`no ${label} button`);
  }
  return node;
}

/** The dimensions button. Its glyph is fixed; the size rides in the tooltip. */
function dims(): HTMLElement {
  return verb("Frame dimensions");
}

function press(key: string): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: key === "Backspace" ? "Backspace" : key,
      key,
    })
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  mountToastHost(document.body);
  layer = new ChromeLayer();
  layer.mount(document.body);
  viewport = new CanvasViewport({
    getContentRects: () => [],
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-test:viewport",
  });
  frames = new FrameManager({
    // What `CanvasStage.onFramesChanged` does, minus the parts that need
    // layout: frames notify, the chrome re-renders. The closure is lazy, so
    // referring to `chrome` before it is built is fine — nothing fires until a
    // frame is added, which every test does after this block.
    onChanged: () => chrome.render(),
    pathname: "/",
    storageKey: "__airship-test:chrome",
    world: viewport.world,
  });
  chrome = new FrameChrome({
    frames,
    inCanvas: () => true,
    layer,
    onChanged: () => undefined,
    viewport,
  });
  host = document.createElement("div");
  document.body.append(host);
  chrome.mountFrameTools(host);
  chrome.mount(document.createElement("div"));
  // The stage starts in edit mode; these tests are about the mode where a frame
  // can be selected at all, so drop into view unless a test says otherwise.
  chrome.setEditing(false);
  frames.setEditing(false);
});

afterEach(() => {
  chrome.destroy();
  frames.destroy();
  viewport.destroy();
});

describe("the frame verb group", () => {
  it("stays hidden until a frame is selected", () => {
    frames.add({ name: "Desktop" });
    chrome.render();
    expect(shown()).toBe(false);
  });

  it("appears on selection and goes again on deselect", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    expect(shown()).toBe(true);

    frames.setActive(null);
    expect(shown()).toBe(false);
  });

  it("reads out the selected frame's dimensions, and follows a resize", () => {
    // In the tooltip, not the label: the button is a glyph now, so that the one
    // control in the bar carrying a live value stops resizing the group it is
    // in every time a frame changes shape.
    const frame = frames.add({ height: 900, name: "Desktop", width: 1440 });
    frames.setActive(frame?.id ?? null);
    expect(dims().getAttribute("data-tip")).toContain("1440 × 900");

    frames.resize(frame?.id ?? "", 800, 600);
    expect(dims().getAttribute("data-tip")).toContain("800 × 600");
  });

  it("follows the selection from one frame to another", () => {
    const wide = frames.add({ height: 900, name: "Desktop", width: 1440 });
    const tall = frames.add({ height: 852, name: "Phone", width: 393 });

    frames.setActive(wide?.id ?? null);
    expect(dims().getAttribute("data-tip")).toContain("1440 × 900");
    frames.setActive(tall?.id ?? null);
    expect(dims().getAttribute("data-tip")).toContain("393 × 852");
  });

  it("dims Duplicate at the cap, the way the + button dims", () => {
    for (let i = 0; i < MAX_FRAMES; i += 1) {
      frames.add({ name: `f${i}` });
    }
    frames.setActive(frames.all[0].id);

    const dup = verb("Duplicate frame");
    expect(dup.classList.contains(cls("fbar-off"))).toBe(true);
    expect(dup.getAttribute("title")).toBe(
      `Frame limit reached (${MAX_FRAMES})`
    );

    frames.remove(frames.all[1].id);
    expect(dup.classList.contains(cls("fbar-off"))).toBe(false);
    expect(dup.getAttribute("title")).toBe("Duplicate frame");
  });

  it("deletes the selected frame from its own button", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);

    verb("Delete frame").click();

    expect(frames.all).toHaveLength(0);
    expect(shown()).toBe(false);
  });

  it("offers the frame back on the toast, and puts it where it was", () => {
    frames.add({ name: "one" });
    const middle = frames.add({ height: 640, name: "two", width: 900 });
    frames.add({ name: "three" });
    frames.setActive(middle?.id ?? null);

    verb("Delete frame").click();
    expect(frames.all.map((f) => f.id)).toEqual(["f1", "f3"]);

    const undo = document.querySelector<HTMLElement>(`.${cls("toast-action")}`);
    expect(undo?.textContent).toBe("Undo");
    undo?.click();

    expect(frames.all.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    const back = frames.byId(middle?.id ?? "");
    expect(back?.name).toBe("two");
    expect(back?.width).toBe(900);
    // It was selected when it went, so it comes back selected — and the group
    // that vanished with it comes back too.
    expect(frames.active?.id).toBe(middle?.id);
    expect(shown()).toBe(true);
  });
});

describe("the delete shortcut", () => {
  it("removes the selected frame in view mode", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);

    press("Backspace");
    expect(frames.all).toHaveLength(0);

    // Delete is the other spelling of the same command.
    const second = frames.add({ name: "Phone" });
    frames.setActive(second?.id ?? null);
    press("Delete");
    expect(frames.all).toHaveLength(0);
  });

  it("declines, and does not swallow the key, with nothing selected", () => {
    frames.add({ name: "Desktop" });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Backspace",
      key: "Backspace",
    });
    document.dispatchEvent(event);

    expect(frames.all).toHaveLength(1);
    // The whole point of the `when` guard: an unmatched binding leaves the key
    // to whoever else wanted it.
    expect(event.defaultPrevented).toBe(false);
  });

  it("declines in edit mode, where the element delete owns the key", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    chrome.setEditing(true);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Backspace",
      key: "Backspace",
    });
    document.dispatchEvent(event);

    expect(frames.all).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("declines while a field in the shell has focus", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);

    const field = document.createElement("input");
    document.body.append(field);
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Backspace",
        key: "Backspace",
      })
    );

    expect(frames.all).toHaveLength(1);
  });

  it("stops answering once the chrome is destroyed", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    chrome.destroy();

    press("Backspace");
    expect(frames.all).toHaveLength(1);

    // `afterEach` destroys again; that has to be safe.
    chrome = new FrameChrome({
      frames,
      inCanvas: () => true,
      layer,
      onChanged: () => undefined,
      viewport,
    });
  });
});

describe("menus", () => {
  it("closes the device menu when its frame is deleted by key", () => {
    // Was the frame's own menu, opened from its size badge. That menu is gone —
    // the badge is a label again — but the hazard it guarded is not: a box left
    // open over a frame that no longer exists, with Escape still bound to it.
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    dims().click();
    expect(
      host.querySelector(`.${cls("fc-menu")}:not(.${cls("hidden")})`)
    ).not.toBeNull();

    press("Backspace");

    expect(
      host.querySelector(`.${cls("fc-menu")}:not(.${cls("hidden")})`)
    ).toBeNull();
  });

  it("closes the bar's dimensions menu when the selection goes", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    dims().click();
    expect(dims().getAttribute("aria-expanded")).toBe("true");

    frames.setActive(null);
    expect(dims().getAttribute("aria-expanded")).toBe("false");
  });

  it("applies a preset to whichever frame is selected, not the one at build", () => {
    const first = frames.add({ height: 900, name: "one", width: 1440 });
    const second = frames.add({ height: 900, name: "two", width: 1440 });

    frames.setActive(second?.id ?? null);
    dims().click();
    const iphone = document.querySelector<HTMLElement>(
      `.${cls("fbar-menu")} [data-preset="iphone-16"]`
    );
    iphone?.click();

    expect(frames.byId(second?.id ?? "")?.width).toBe(393);
    // The rows were built before either frame existed; the one that was never
    // selected must be untouched.
    expect(frames.byId(first?.id ?? "")?.width).toBe(1440);
  });
});

describe("edit mode", () => {
  it("closes an open dimensions menu on the way in", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);
    dims().click();
    expect(dims().getAttribute("aria-expanded")).toBe("true");

    chrome.setEditing(true);
    expect(dims().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the selection across a mode round-trip", () => {
    const frame = frames.add({ name: "Desktop" });
    frames.setActive(frame?.id ?? null);

    chrome.setEditing(true);
    chrome.setEditing(false);

    expect(frames.active?.id).toBe(frame?.id);
    expect(shown()).toBe(true);
  });
});

describe("the toast", () => {
  it("refuses a restore that no longer fits, and says so", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < MAX_FRAMES; i += 1) {
        frames.add({ name: `f${i}` });
      }
      frames.setActive(frames.all[0].id);
      verb("Delete frame").click();

      const undo = document.querySelector<HTMLElement>(
        `.${cls("toast-action")}`
      );
      // Fill the gap the delete opened, then try to take it back.
      frames.add({ name: "filler" });
      undo?.click();

      const box = document.querySelector(`.${cls("toast")}`);
      expect(box?.textContent).toContain(`Frame limit reached (${MAX_FRAMES})`);
      expect(box?.classList.contains(cls("toast-error"))).toBe(true);
      expect(frames.all).toHaveLength(MAX_FRAMES);
    } finally {
      vi.useRealTimers();
    }
  });
});
