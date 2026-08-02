import { afterEach, describe, expect, it, vi } from "vitest";
import { cls } from "../../dom";
import { closeOpenPopover } from "../../popover-host";
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
