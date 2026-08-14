import { afterEach, describe, expect, it, vi } from "vitest";
import { cls } from "../../dom";
import { closeOpenPopover } from "../../popover-host";
import { recentColors } from "../recent-colors";
import { createColorRow } from "./color-picker";

/*
 * The paint row's bound state.
 *
 * A bound row locked its two text affordances and left the third — the swatch,
 * which is the one that actually edits the colour — fully live, so the colour
 * could be changed out from under a row still displaying a token name. The
 * alpha field was "locked" with `readOnly`, which stops typing and does nothing
 * about arrow keys or the drag grip.
 */

function row(value = "rgb(255, 0, 0)") {
  const commits: string[] = [];
  const handle = createColorRow({
    onChange: (next) => commits.push(next),
    tip: "Fill colour",
    value,
  });
  document.body.append(handle.element);
  const swatch = handle.element.querySelector<HTMLElement>(
    `.${cls("ctl-swatch")}`
  );
  const inputs = [
    ...handle.element.querySelectorAll<HTMLInputElement>(
      `.${cls("ctl-input")}`
    ),
  ];
  if (!swatch) {
    throw new Error("no swatch");
  }
  return { alpha: inputs[1], commits, handle, hex: inputs[0], swatch };
}

function press(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
  );
}

afterEach(() => {
  // Close rather than wiping the body: `popover-host` caches its mount in a
  // module variable, so clearing `document.body` detaches the host while the
  // host still believes it is mounted, and every later popover renders into a
  // node nothing can query.
  closeOpenPopover("programmatic");
});

describe("unbound", () => {
  it("shows the colour as hex and its alpha as a percentage", () => {
    const r = row("rgba(255, 0, 0, 0.5)");
    expect(r.hex.value).toBe("FF0000");
    expect(r.alpha.value).toBe("50");
  });

  it("opens the picker from the swatch", () => {
    const r = row();
    r.swatch.click();
    expect(document.querySelector(`.${cls("pop")}`)).not.toBeNull();
  });

  it("steps the alpha with the arrow keys", () => {
    const r = row("rgb(255, 0, 0)");
    press(r.alpha, "ArrowDown");
    expect(r.commits).toHaveLength(1);
  });
});

describe("bound to a token", () => {
  it("shows the token name in the hex slot", () => {
    const r = row();
    r.handle.setToken("pk-color-primary");
    expect(r.hex.value).toBe("pk-color-primary");
    expect(r.handle.element.hasAttribute("data-token")).toBe(true);
  });

  it("keeps painting the swatch, because a name is not a colour", () => {
    // Asserted through `data-mixed` rather than the background image: the
    // swatch paints with a `var()` for its checkerboard, which happy-dom's
    // style setter drops. What matters is that `reflect` still reaches
    // `paintSwatch` while bound — so a value the swatch cannot show still flips
    // the marker.
    const r = row("rgb(255, 0, 0)");
    r.handle.setToken("pk-color-primary");
    expect(r.swatch.hasAttribute("data-mixed")).toBe(false);
    r.handle.setValue("Mixed");
    expect(r.swatch.hasAttribute("data-mixed")).toBe(true);
  });

  it("goes on showing the alpha percentage", () => {
    const r = row("rgba(255, 0, 0, 0.5)");
    r.handle.setToken("pk-color-primary");
    expect(r.alpha.value).toBe("50");
  });

  it("refuses to step the alpha", () => {
    // `readOnly` was set and does nothing here: `keydown` still fires on a
    // read-only input, so the one field that was supposed to be locked was
    // committing a new `rgb(… / a)` on every arrow press.
    const r = row("rgb(255, 0, 0)");
    r.handle.setToken("pk-color-primary");
    press(r.alpha, "ArrowDown");
    expect(r.commits).toEqual([]);
  });

  it("does not open the picker from the swatch", () => {
    // The row's primary editing affordance, and the one thing nothing stopped:
    // the picker opened, the drag wrote a colour, and the row went on showing
    // a token name for a value that no longer came from it.
    const r = row();
    r.handle.setToken("pk-color-primary");
    r.swatch.click();
    expect(document.querySelector(`.${cls("pop")}`)).toBeNull();
  });

  it("opens the picker from the token name in the hex slot", () => {
    const r = row();
    const open = vi.fn();
    r.handle.onActivate(open);
    r.handle.setToken("pk-color-primary");
    r.hex.dispatchEvent(new MouseEvent("mousedown", { cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("puts the colour back when the binding is removed", () => {
    const r = row("rgb(255, 0, 0)");
    r.handle.setToken("pk-color-primary");
    r.handle.setToken(null);
    expect(r.hex.value).toBe("FF0000");
    expect(r.handle.element.hasAttribute("data-token")).toBe(false);
    r.swatch.click();
    expect(document.querySelector(`.${cls("pop")}`)).not.toBeNull();
  });

  it("keeps showing the token across a re-seed", () => {
    const r = row("rgb(255, 0, 0)");
    r.handle.setToken("pk-color-primary");
    r.handle.setValue("rgb(0, 0, 255)");
    expect(r.hex.value).toBe("pk-color-primary");
    // The swatch still follows the value — that is the part a name cannot say.
    expect(r.swatch.hasAttribute("data-mixed")).toBe(false);
  });
});

describe("teardown", () => {
  it("closes an open picker", () => {
    const r = row();
    r.swatch.click();
    expect(document.querySelector(`.${cls("pop")}`)).not.toBeNull();
    r.handle.destroy();
    expect(document.querySelector(`.${cls("pop")}`)).toBeNull();
  });
});

describe("the Mixed sentinel", () => {
  it("blanks the fields and marks the swatch", () => {
    const r = row("Mixed");
    expect(r.hex.value).toBe("");
    expect(r.swatch.hasAttribute("data-mixed")).toBe(true);
  });

  it("still opens the picker, because Mixed is a value to impose", () => {
    const r = row("Mixed");
    r.swatch.click();
    expect(document.querySelector(`.${cls("pop")}`)).not.toBeNull();
  });
});

describe("gestures", () => {
  it("brackets an alpha scrub into one undo step", () => {
    const begin = vi.fn();
    const end = vi.fn();
    const handle = createColorRow({
      gestures: { begin, end },
      onChange: () => {
        // value ignored
      },
      value: "rgb(255, 0, 0)",
    });
    document.body.append(handle.element);
    const [, alpha] = handle.element.querySelectorAll<HTMLInputElement>(
      `.${cls("ctl-input")}`
    );
    alpha.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "ArrowDown" })
    );
    expect(begin).toHaveBeenCalledTimes(1);
    alpha.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
    expect(end).toHaveBeenCalledTimes(1);
  });
});

/*
 * The two hex fields, which used to disagree with each other.
 *
 * The row's field gated on a private `/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i` while the
 * *same file's* popover field gated on nothing and went straight to
 * `parseColor` — so `FF0000AA` was accepted in one and silently reverted in the
 * other. Both now go through `isHexColor`, the grammar `parseHex` implements.
 *
 * And the row committed `formatColor(…, "rgb")` unconditionally, which made it
 * the one control performing the exact conversion the picker was fixed to stop
 * doing: "editing any Tailwind 4 palette colour silently rewrote it as `rgb()`
 * — a gamut and readability downgrade".
 */
describe("the row's hex field", () => {
  /** `bindField` commits on Enter and on blur, never on `change`. */
  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    press(input, "Enter");
  }

  it("accepts the four- and eight-digit hex parseColor reads", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "00FF00AA");
    expect(r.commits).toHaveLength(1);
    // Eight digits carry their own alpha: 0xAA / 255 = 0.667.
    expect(r.commits[0]).toBe("rgb(0 255 0 / 0.667)");
  });

  it("accepts four-digit hex, which the old gate also refused", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "0F08");
    expect(r.commits).toHaveLength(1);
    // `0F08` expands to `#00FF0088`; 0x88 / 255 = 0.533.
    expect(r.commits[0]).toBe("rgb(0 255 0 / 0.533)");
  });

  it("shows a typed alpha in the % field beside it", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "00FF00AA");
    // The row splits colour and alpha across two affordances, so an eight-digit
    // hex has to land in both rather than only in what gets committed.
    expect(r.hex.value).toBe("00FF00");
    expect(r.alpha.value).toBe("67");
  });

  it("leaves the alpha alone for a hex that does not carry one", () => {
    // Three and six digits say nothing about alpha, so the % field keeps what
    // the user last set there.
    const r = row("rgba(255, 0, 0, 0.5)");
    type(r.hex, "00FF00");
    expect(r.commits[0]).toBe("rgb(0 255 0 / 0.5)");
    expect(r.alpha.value).toBe("50");
  });

  it("commits hex as hex rather than downgrading it to rgb()", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "00FF00");
    expect(r.commits[0]).toBe("#00ff00");
  });

  it("falls back to rgb() only when an alpha has to be carried", () => {
    // The `%` field is holding a partial alpha that hex cannot express without
    // appending two digits the user did not type.
    const r = row("rgba(255, 0, 0, 0.5)");
    type(r.hex, "00FF00");
    expect(r.commits[0]).toBe("rgb(0 255 0 / 0.5)");
  });

  it("reverts rather than committing something that is not hex", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "nonsense");
    expect(r.commits).toHaveLength(0);
    expect(r.hex.value).toBe("FF0000");
  });

  it("reverts on a hex of a length that is not a colour", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.hex, "ABCDE");
    expect(r.commits).toHaveLength(0);
    expect(r.hex.value).toBe("FF0000");
  });
});

/*
 * The popover's hex field read an eight-digit hex's alpha and threw it away:
 * `state.a` was never assigned, so `FF000080` produced fully opaque red and the
 * alpha slider did not move. `setValue` and the recents row both assign it.
 */
describe("the popover's hex field", () => {
  it("keeps the alpha of an eight-digit hex", () => {
    const r = row("rgb(255, 0, 0)");
    r.swatch.click();
    const fields = [
      ...document.querySelectorAll<HTMLInputElement>(`.${cls("ctl-input")}`),
    ];
    // The popover's own hex field, not the row's — the row's is the first in
    // the document, the popover's is inside the `.ap-pop` subtree.
    const pop = document.querySelector(`.${cls("pop")}`) as HTMLElement;
    const hex = pop.querySelector<HTMLInputElement>(`.${cls("ctl-input")}`);
    expect(hex).not.toBeNull();
    expect(fields.length).toBeGreaterThan(1);
    if (!hex) {
      return;
    }
    hex.value = "00FF0080";
    hex.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      })
    );
    // 0x80 / 255 = 0.502. Before the fix this committed a fully opaque colour.
    expect(r.commits.at(-1)).toBe("#00ff0080");
  });
});

/*
 * The recents row is keyed on the raw string — `pushRecentColor` dedupes with
 * `c !== value` — so every caller has to push one colour in one notation. That
 * held only by accident until the row's hex field started committing hex: the
 * same colour typed here and picked in the popover produced two swatches.
 *
 * What notation reaches the user's source and what keys an in-memory palette
 * are separate questions, and this is where they were conflated.
 */
describe("the recents row", () => {
  it("records one swatch however the colour was chosen", () => {
    const r = row("rgb(255, 0, 0)");
    r.hex.value = "00FF00";
    press(r.hex, "Enter");
    // The source gets hex; the palette gets the canonical form every other
    // caller pushes.
    expect(r.commits.at(-1)).toBe("#00ff00");
    expect(recentColors()).toContain("rgb(0 255 0)");
    /*
     * The invariant, asserted over the whole list rather than by counting: the
     * module keeps its recents for the life of the page, so this file's earlier
     * cases have already pushed to it and there is no reset to call. "No entry
     * is in hex" is the property that actually stops a colour appearing twice,
     * and it does not care what else is in the list.
     */
    expect(recentColors().some((c) => c.startsWith("#"))).toBe(false);
  });
});

/*
 * The `%` field, now routed through `withAlpha`.
 *
 * `commitPct` was `withAlpha`'s body written out again, which made it the
 * second definition of a rule that already had a name — and left the exported
 * one with no callers at all, free to drift from the copy that was actually
 * running. The behaviour below is what both spellings owed.
 */
describe("the alpha field", () => {
  /** `createNumField` commits on blur, unlike `bindField`'s Enter-or-blur. */
  function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event("blur"));
  }

  it("folds the alpha into the colour rather than writing opacity", () => {
    // `opacity` composites the element and all its children, so a fill at 50%
    // would fade the text inside it. This is the whole reason the rule exists.
    const r = row("rgb(255, 0, 0)");
    type(r.alpha, "40");
    expect(r.commits.at(-1)).toBe("rgb(255 0 0 / 0.4)");
  });

  it("keeps the colour and changes only the channel it owns", () => {
    const r = row("rgba(0, 128, 255, 0.25)");
    type(r.alpha, "75");
    expect(r.commits.at(-1)).toBe("rgb(0 128 255 / 0.75)");
  });

  it("commits nothing on a row whose colour it cannot read", () => {
    // `withAlpha` returns its input unchanged when unparseable, which is how a
    // `Mixed` row falls through to `reflect` without a second parse.
    const r = row("Mixed");
    type(r.alpha, "40");
    expect(r.commits).toEqual([]);
  });

  it("commits nothing when the alpha did not actually change", () => {
    // The other half of the same `next === current` test.
    const r = row("rgb(255 0 0 / 0.4)");
    type(r.alpha, "40");
    expect(r.commits).toEqual([]);
  });

  it("reverts a value that is not a number", () => {
    const r = row("rgb(255, 0, 0)");
    type(r.alpha, "banana");
    expect(r.commits).toEqual([]);
    expect(r.alpha.value).toBe("100");
  });
});
