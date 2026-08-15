import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls, el } from "./dom";
import { sizeOf } from "./inspector/test-support";
import type { CommandId } from "./keys/catalog";
// `tip` is taken here by the local helper that finds the rendered tip node.
import { keys, tip as tipAttrs } from "./keys/registry";
import { Tooltips } from "./tooltip";

/*
 * What a tooltip has to get right.
 *
 * Two of these are regressions rather than features. The tip used to declare
 * `white-space: nowrap` next to a width cap, so its text laid out wider than the
 * box painted behind it — and `offsetWidth`, which is what the centring and the
 * dock clamp are computed from, reported the cap instead of the label. Fixing the
 * CSS then exposed a second one: `placePopover` leaves a `left` behind, and a
 * box that wraps measures itself inside whatever room that `left` leaves it. The
 * cases named "measures" below are those two, and they are the reason this file
 * exists at all.
 */

/**
 * Make a command answerable, undone after the test. `keys` is a singleton.
 *
 * The chip does not actually need this any more — `keys.hint` reads the catalog
 * and does not care whether anything is bound — but leaving it in keeps the
 * case honest about the shape of the real thing.
 */
function bindChord(id: CommandId): void {
  unbind.push(keys.bind({ id, run: () => undefined }));
}
let unbind: Array<() => void> = [];

let host: HTMLElement;
let tips: Tooltips;

/** The shared tip node, as `Tooltips` created it. */
const tip = (): HTMLElement =>
  host.querySelector(`.${cls("tip")}`) as HTMLElement;

const shown = (): boolean => !tip().classList.contains(cls("hidden"));

/** A control carrying `data-tip`, placed in `parent`. */
function control(
  text: string,
  parent: HTMLElement = document.body,
  id?: CommandId
) {
  const node = el("button", { type: "button", ...tipAttrs(text, id) });
  parent.append(node);
  sizeOf(node, { height: 24, left: 100, top: 400, width: 24 });
  return node;
}

function hover(node: HTMLElement): void {
  node.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
}

/** Report a fixed width, and record the `left` in force when it was read. */
function stubWidth(node: HTMLElement, width: number): string[] {
  const seen: string[] = [];
  Object.defineProperty(node, "offsetWidth", {
    configurable: true,
    get() {
      seen.push(node.style.left);
      return width;
    },
  });
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Wide enough that `placePopover`'s viewport clamp never fires: these cases
  // are about the dock clamp, and the two are indistinguishable at 1024px.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900,
  });
  host = el("div");
  document.body.append(host);
  tips = new Tooltips(host);
});

afterEach(() => {
  tips.destroy();
  for (const off of unbind) {
    off();
  }
  unbind = [];
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("opening", () => {
  it("waits out the delay before showing", () => {
    hover(control("Undo"));
    vi.advanceTimersByTime(399);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown()).toBe(true);
  });

  it("opens the next one instantly while the chain is warm", () => {
    hover(control("Undo"));
    vi.advanceTimersByTime(400);

    hover(control("Redo"));
    // No delay at all: scanning a toolbar should not cost 400ms a button.
    vi.advanceTimersByTime(0);
    expect(shown()).toBe(true);
    expect(tip().textContent).toContain("Redo");
  });

  it("waits again once the chain has gone cold", () => {
    hover(control("Undo"));
    vi.advanceTimersByTime(400);
    tips.destroy();
    tips = new Tooltips(host);

    vi.advanceTimersByTime(500);
    hover(control("Redo"));
    vi.advanceTimersByTime(399);
    expect(shown()).toBe(false);
  });

  it("ignores a control with no tip", () => {
    const bare = el("button", { type: "button" });
    document.body.append(bare);
    hover(bare);
    vi.advanceTimersByTime(400);
    expect(shown()).toBe(false);
  });

  it("declines to show for a control that left the document", () => {
    const node = control("Undo");
    hover(node);
    node.remove();
    vi.advanceTimersByTime(400);
    expect(shown()).toBe(false);
  });
});

describe("content", () => {
  it("puts the text in the span the line clamp targets", () => {
    hover(control("Remove fill"));
    vi.advanceTimersByTime(400);

    const text = tip().querySelector(`.${cls("tip-text")}`);
    expect(text?.textContent).toBe("Remove fill");
  });

  it("appends the chord for a control that names a command", () => {
    bindChord("history.undo");
    hover(control("Undo", document.body, "history.undo"));
    vi.advanceTimersByTime(400);

    expect(tip().querySelector(`.${cls("tip-key")}`)?.textContent).toBeTruthy();
  });

  it("keeps the chord when the copy is reworded", () => {
    // The failure this whole redesign is about. The chip used to be found by
    // matching the tooltip's own text against a binding's label, so rewording
    // a tooltip dropped its shortcut silently — nothing threw, nothing rendered
    // wrong, the chip was simply gone.
    bindChord("history.undo");
    hover(control("Undo the last change", document.body, "history.undo"));
    vi.advanceTimersByTime(400);

    expect(tip().querySelector(`.${cls("tip-key")}`)?.textContent).toBeTruthy();
  });

  it("is text alone when nothing is bound to it", () => {
    hover(control("Remove fill"));
    vi.advanceTimersByTime(400);

    expect(tip().children).toHaveLength(1);
    expect(tip().querySelector(`.${cls("tip-key")}`)).toBeNull();
  });
});

describe("placement", () => {
  it("measures from a known origin, not from where it last sat", () => {
    // The regression. `placePopover` writes a `left` and never clears it, so a
    // tip that wraps would measure itself inside `viewport - previous left`.
    const seen = stubWidth(tip(), 260);

    hover(control("Undo"));
    vi.advanceTimersByTime(400);
    hover(control("Redo"));
    vi.advanceTimersByTime(0);

    // Twice per placement, because both modules measure: `Tooltips.place` to
    // centre the tip, `placePopover` to clamp it. Each resets `left` first, and
    // the count is here so that losing either reset shows up as a failure.
    expect(seen).toHaveLength(4);
    expect(seen.every((left) => left === "0px")).toBe(true);
  });

  it("stays inside the dock it belongs to", () => {
    const dock = el("div", { class: cls("dock") });
    document.body.append(dock);
    sizeOf(dock, { height: 600, left: 900, top: 0, width: 280 });
    const node = control("Advanced stroke settings", dock);
    sizeOf(node, { height: 24, left: 1150, top: 400, width: 24 });
    stubWidth(tip(), 260);

    hover(node);
    vi.advanceTimersByTime(400);

    // Centred on the control would put it at 1032, which hangs past the panel's
    // right border with nothing under it. 1180 - 260 - 6 is the last position
    // that does not.
    expect(tip().style.left).toBe("914px");
  });

  it("opens below a control in the chrome", () => {
    const node = control("Undo");
    stubWidth(tip(), 120);

    hover(node);
    vi.advanceTimersByTime(400);

    expect(Number.parseInt(tip().style.top, 10)).toBeGreaterThan(424);
  });

  it("opens above a control in the inspector body", () => {
    // Panel rows stack six pixels apart, so a tip below one lands on the row you
    // are on your way to.
    const body = el("div", { class: cls("insp-body") });
    document.body.append(body);
    const node = control("Remove fill", body);
    stubWidth(tip(), 120);

    hover(node);
    vi.advanceTimersByTime(400);

    expect(Number.parseInt(tip().style.top, 10)).toBeLessThan(400);
  });
});

describe("hiding", () => {
  const open = (): HTMLElement => {
    const node = control("Undo");
    hover(node);
    vi.advanceTimersByTime(400);
    return node;
  };

  it("hides on a press", () => {
    open();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(shown()).toBe(false);
  });

  it("hides when the pointer leaves the window", () => {
    const node = open();
    node.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null })
    );
    expect(shown()).toBe(false);
  });

  it("stays up while the pointer moves within the control", () => {
    const node = open();
    node.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: node })
    );
    expect(shown()).toBe(true);
  });

  it("hides on a scroll rather than following", () => {
    open();
    window.dispatchEvent(new Event("scroll"));
    expect(shown()).toBe(false);
  });

  it("hides when the pointer reaches something with no tip", () => {
    open();
    const bare = el("div");
    document.body.append(bare);
    hover(bare);
    expect(shown()).toBe(false);
  });
});

describe("destroy", () => {
  it("takes the node and every listener with it", () => {
    const node = tip();
    tips.destroy();
    expect(node.isConnected).toBe(false);

    hover(control("Undo"));
    vi.advanceTimersByTime(400);
    expect(host.querySelector(`.${cls("tip")}`)).toBeNull();
  });

  it("cancels a tip that was still counting down", () => {
    hover(control("Undo"));
    vi.advanceTimersByTime(200);
    const node = tip();
    tips.destroy();

    vi.advanceTimersByTime(400);
    expect(node.classList.contains(cls("hidden"))).toBe(true);
  });
});
