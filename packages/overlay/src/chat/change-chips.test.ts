import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls, el } from "../dom";
import { keys } from "../keys/registry";
import {
  attachRailKeys,
  attachRailWheel,
  type ChangeChip,
  renderChangeChips,
  shortValue,
} from "./change-chips";

/*
 * The pending-change rail.
 *
 * Two of the three things under test here are invisible to the person who wrote
 * them, because they only fail on hardware that person was not using:
 *
 * - A rail that overflows on X ignores a mouse's `deltaY` entirely. On a
 *   trackpad the same gesture arrives as `deltaX` and the browser scrolls the
 *   rail for free, so the strip is perfect on a laptop and broken on a desk.
 * - Most mouse wheels report *lines*, not pixels — a notch is `deltaY: 3`. Read
 *   unconverted that scrolls a rail three pixels, which reads as a dead strip
 *   rather than a slow one.
 *
 * happy-dom does no layout, so `scrollWidth` and `clientWidth` are patched per
 * node by `rail()`. That is the same stubbing `inspector/test-support.ts` does
 * for `getBoundingClientRect`, and for the same reason.
 */

const DISPOSERS: (() => void)[] = [];

/** A rail with a measurable overflow, since happy-dom measures nothing. */
function rail(opts: { clientWidth?: number; scrollWidth?: number } = {}) {
  const node = el("div", { class: `${cls("sel-chips")} ${cls("scroll-x")}` });
  Object.defineProperty(node, "scrollWidth", {
    configurable: true,
    value: opts.scrollWidth ?? 600,
  });
  Object.defineProperty(node, "clientWidth", {
    configurable: true,
    value: opts.clientWidth ?? 200,
  });
  document.body.append(node);
  return node;
}

function wheel(node: HTMLElement, init: WheelEventInit): boolean {
  return node.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init })
  );
}

/** Scroll a rail to its far end and let it notice. */
function atEnd(node: HTMLElement): void {
  node.scrollLeft = node.scrollWidth - node.clientWidth;
  node.dispatchEvent(new Event("scroll"));
}

function press(node: HTMLElement, key: string): void {
  node.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: key,
      key,
    })
  );
}

const chip = (subject: string, over: Partial<ChangeChip> = {}): ChangeChip => ({
  detail: "flex",
  onRemove: () => {
    // Overridden where a case cares.
  },
  subject,
  tip: `${subject} · flex: 0 0`,
  value: "0 0",
  ...over,
});

function keep(off: () => void): void {
  DISPOSERS.push(off);
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const off of DISPOSERS.splice(0)) {
    off();
  }
  keys.destroy();
});

describe("the rail's wheel", () => {
  it("turns a mouse's vertical wheel into horizontal scroll", () => {
    const node = rail();
    keep(attachRailWheel(node));

    const survived = wheel(node, { deltaMode: 0, deltaX: 0, deltaY: 120 });

    expect(node.scrollLeft).toBe(120);
    expect(survived).toBe(false);
  });

  it("converts a line-mode notch rather than reading it as pixels", () => {
    const node = rail();
    keep(attachRailWheel(node));

    // What a real mouse sends: three lines, not 120 pixels.
    wheel(node, { deltaMode: 1, deltaX: 0, deltaY: 3 });

    // 3 lines × LINE_HEIGHT. Unconverted this would have been 3px.
    expect(node.scrollLeft).toBe(120);
  });

  it("leaves a horizontal wheel to the browser", () => {
    const node = rail();
    keep(attachRailWheel(node));

    const survived = wheel(node, { deltaMode: 0, deltaX: 40, deltaY: 10 });

    expect(node.scrollLeft).toBe(0);
    expect(survived).toBe(true);
  });

  it("declines at the end so the wheel chains to the transcript", () => {
    const node = rail();
    keep(attachRailWheel(node));
    node.scrollLeft = 400; // scrollWidth 600 - clientWidth 200

    const survived = wheel(node, { deltaMode: 0, deltaX: 0, deltaY: 120 });

    expect(node.scrollLeft).toBe(400);
    expect(survived).toBe(true);
  });

  it("ignores a rail with nothing to scroll", () => {
    const node = rail({ clientWidth: 600, scrollWidth: 600 });
    keep(attachRailWheel(node));

    const survived = wheel(node, { deltaMode: 0, deltaX: 0, deltaY: 120 });

    expect(node.scrollLeft).toBe(0);
    expect(survived).toBe(true);
  });
});

describe("the rail's overflow flag", () => {
  it("says nothing when everything fits", () => {
    const node = rail({ clientWidth: 600, scrollWidth: 600 });
    keep(attachRailWheel(node));

    expect(node.dataset.overflow).toBeUndefined();
  });

  it("tracks which ends have more", () => {
    const node = rail();
    keep(attachRailWheel(node));
    // A fresh rail sits at its start, so the only fade is on the right.
    expect(node.dataset.overflow).toBe("right");

    node.scrollLeft = 200;
    node.dispatchEvent(new Event("scroll"));
    expect(node.dataset.overflow).toBe("both");

    node.scrollLeft = 400;
    node.dispatchEvent(new Event("scroll"));
    expect(node.dataset.overflow).toBe("left");
  });

  it("keeps the selection chip in view when a change arrives", () => {
    // The rail starts unpinned, unlike the transcript. Its leftmost item is the
    // selection chip — the one accent-coloured thing in the composer, and the
    // only thing saying what these edits are *about*. Following the end from
    // the start scrolled it off on the very first tweak.
    const node = rail();
    keep(attachRailWheel(node));

    renderChangeChips(node, [chip("Button")]);

    expect(node.scrollLeft).toBe(0);
  });

  it("follows the end for a reader who is already there", () => {
    const node = rail();
    keep(attachRailWheel(node));
    atEnd(node);

    renderChangeChips(node, [chip("Button")]);

    expect(node.scrollLeft).toBe(400);
  });

  it("leaves a rail alone once it has been scrolled back", () => {
    const node = rail();
    keep(attachRailWheel(node));
    atEnd(node);
    node.scrollLeft = 120;
    node.dispatchEvent(new Event("scroll"));

    renderChangeChips(node, [chip("Button")]);

    // Unpinned again, so chip twelve arriving does not interrupt reading three.
    expect(node.scrollLeft).toBe(120);
  });
});

describe("a chip's fields", () => {
  it("renders subject, detail and value as separate spans, in order", () => {
    const node = rail();
    renderChangeChips(node, [chip("RootDocument")]);

    const spans = [...node.querySelectorAll("span[class]")]
      .map((s) => s.className)
      .filter((c) => c.includes("chip-"));

    expect(spans[0]).toContain(cls("chip-subject"));
    expect(spans[1]).toContain(cls("chip-detail"));
    expect(spans[2]).toContain(cls("chip-value"));
    expect(node.querySelector(`.${cls("chip-subject")}`)?.textContent).toBe(
      "RootDocument"
    );
  });

  it("gives a style chip no glyph", () => {
    const node = rail();
    renderChangeChips(node, [chip("Button")]);

    // The ✕ carries the only icon on a style chip.
    const chipEl = node.querySelector("[data-chip]");
    expect(chipEl?.querySelector(`.${cls("ic")}`)?.closest("[data-chip]")).toBe(
      chipEl
    );
    expect(chipEl?.children[0].className).toContain(cls("chip-subject"));
  });

  it("keeps a glyph where the kind is not spoken by the text", () => {
    const node = rail();
    renderChangeChips(node, [
      chip("Badge", { detail: "moved", icon: "drag", value: undefined }),
    ]);

    const chipEl = node.querySelector("[data-chip]");
    expect(chipEl?.children[0].className).toContain(cls("ic"));
    expect(chipEl?.querySelector(`.${cls("chip-value")}`)).toBeNull();
  });

  it("truncates only the value", () => {
    expect(shortValue("cubic-bezier(0.16, 1, 0.3, 1)")).toBe("cubic-bezier(…");
    expect(shortValue("0 0")).toBe("0 0");
  });

  it("makes the rail one tab stop, not one per chip", () => {
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B"), chip("C")]);
    keep(attachRailKeys(node));

    const tabbable = [...node.querySelectorAll<HTMLElement>("[tabindex='0']")];
    expect(tabbable).toHaveLength(1);
    expect(
      node.querySelectorAll(`.${cls("chip-x")}[tabindex='0']`)
    ).toHaveLength(0);
  });

  it("counts the natively-tabbable Discard all as part of the roving", () => {
    /*
     * `[tabindex='0']` alone cannot see this, which is how it got through.
     *
     * "Discard all" is a real `<button>`, so it is a tab stop with no
     * `tabindex` at all — and it carried no `data-chip`, so `attachRailKeys`
     * never adopted it. The rail was two tab stops while the case above went on
     * reporting one. This asks the question the other way: every element in the
     * rail that the browser would stop on must be one the roving owns.
     */
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B")], () => undefined);
    keep(attachRailKeys(node));

    const stops = [...node.querySelectorAll<HTMLElement>("*")].filter(
      (n) => n.tabIndex === 0
    );
    expect(stops).toHaveLength(1);
    // And the button really is present, or the case proves nothing.
    expect(node.querySelector(`.${cls("chip-all")}`)).not.toBeNull();
    expect(
      node.querySelector(`.${cls("chip-all")}`)?.getAttribute("data-chip")
    ).toBe("");
  });
});

describe("arrowing through the chips", () => {
  it("walks forward and back, and stops at the ends", () => {
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B"), chip("C")]);
    keep(attachRailKeys(node));
    const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
    chips[0].focus();

    press(chips[0], "ArrowRight");
    expect(document.activeElement).toBe(chips[1]);

    press(chips[1], "ArrowRight");
    press(chips[2], "ArrowRight");
    expect(document.activeElement).toBe(chips[2]);

    press(chips[2], "ArrowLeft");
    expect(document.activeElement).toBe(chips[1]);
  });

  it("jumps to the ends with Home and End", () => {
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B"), chip("C")]);
    keep(attachRailKeys(node));
    const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
    chips[1].focus();

    press(chips[1], "End");
    expect(document.activeElement).toBe(chips[2]);

    press(chips[2], "Home");
    expect(document.activeElement).toBe(chips[0]);
  });

  it("scrolls the chip it lands on into view", () => {
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B")]);
    keep(attachRailKeys(node));
    const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
    const seen = vi.fn();
    chips[1].scrollIntoView = seen;
    chips[0].focus();

    press(chips[0], "ArrowRight");

    expect(seen).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("drops the focused chip on Backspace and keeps focus in the rail", () => {
    const node = rail();
    const dropped: string[] = [];
    const three = ["A", "B", "C"].map((s) =>
      chip(s, { onRemove: () => dropped.push(s) })
    );
    renderChangeChips(node, three);
    keep(attachRailKeys(node));
    const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
    chips[1].focus();

    press(chips[1], "Backspace");

    expect(dropped).toEqual(["B"]);
    // Nothing re-rendered the rail in this test, so the chip is still present;
    // what matters is that focus stayed on a chip rather than escaping.
    expect(
      (document.activeElement as HTMLElement | null)?.hasAttribute("data-chip")
    ).toBe(true);
  });

  it("never fires outside its own rail", () => {
    const node = rail();
    renderChangeChips(node, [chip("A"), chip("B")]);
    keep(attachRailKeys(node));
    const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
    chips[0].focus();

    // The same chord, from a node the rail does not contain. Without `within`
    // this is the nudge binding's keystroke and the rail would steal it.
    const outside = el("div", { tabindex: "0" });
    document.body.append(outside);
    press(outside, "ArrowRight");

    expect(document.activeElement).toBe(chips[0]);
  });

  it("describes itself as a toolbar", () => {
    const node = rail();
    keep(attachRailKeys(node));

    expect(node.getAttribute("role")).toBe("toolbar");
    expect(node.getAttribute("aria-orientation")).toBe("horizontal");
    expect(node.getAttribute("aria-label")).toBe("Pending changes");
  });
});
