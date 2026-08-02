import { beforeEach, describe, expect, it, vi } from "vitest";
import { LENGTH_UNITS } from "../css-length";
import { createNumField, type NumHandle, type NumSpec } from "./num-field";

/*
 * The field, driven the way a user drives it.
 *
 * None of this was reachable before — the package ran vitest on its Node
 * default, so the first `document` reference threw and no control had a test.
 * That is the direct reason a field that silently rewrote `50%` as `50px` on
 * blur, and committed a half-typed `12r`, stayed in the panel.
 *
 * dnd-kit owns the scrub, so the drag path is exercised through the panel
 * rather than here; everything below is typing, stepping and re-seeding.
 */

interface Field {
  commits: string[];
  handle: NumHandle;
  input: HTMLInputElement;
}

function field(spec: Partial<NumSpec> = {}, initial = "16px"): Field {
  const commits: string[] = [];
  const handle = createNumField(
    {
      label: "Padding top",
      scrub: false,
      unit: "px",
      units: [...LENGTH_UNITS],
      ...spec,
    },
    initial,
    (css) => commits.push(css)
  );
  document.body.append(handle.element);
  return { commits, handle, input: handle.input };
}

/** Type into the field the way a keyboard does, filter and all. */
function type(input: HTMLInputElement, text: string): void {
  for (const char of text) {
    const event = new InputEvent("beforeinput", {
      cancelable: true,
      data: char,
      inputType: "insertText",
    });
    input.dispatchEvent(event);
    if (!event.defaultPrevented) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + char + input.value.slice(end);
      input.setSelectionRange(start + 1, start + 1);
    }
  }
}

function clear(input: HTMLInputElement): void {
  input.value = "";
  input.setSelectionRange(0, 0);
}

function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent("blur"));
}

function press(
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {}
): void {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    })
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("display", () => {
  it("hides the unit when it is the field's own", () => {
    expect(field({}, "16px").input.value).toBe("16");
  });

  it("shows a unit that is not the field's own", () => {
    // The whole reason the old field could destroy one: a bare `50` in a px
    // field is indistinguishable from 50 pixels, to the user and to `commit`.
    expect(field({}, "50%").input.value).toBe("50%");
    expect(field({}, "1.5rem").input.value).toBe("1.5rem");
  });

  it("shows a keyword verbatim", () => {
    expect(field({ keywords: ["auto"] }, "auto").input.value).toBe("auto");
  });

  it("shows an unparseable seed verbatim", () => {
    // `Mixed` is a plain string flowing through the control untouched, which is
    // what lets a multi-selection reuse the same field.
    expect(field({}, "Mixed").input.value).toBe("Mixed");
  });
});

describe("commit", () => {
  it("appends the field's unit to a bare number", () => {
    const f = field();
    clear(f.input);
    type(f.input, "24");
    blur(f.input);
    expect(f.commits).toEqual(["24px"]);
  });

  it("keeps a unit the user typed", () => {
    const f = field();
    clear(f.input);
    type(f.input, "50%");
    blur(f.input);
    expect(f.commits).toEqual(["50%"]);
  });

  it("does not rewrite a percentage on a bare focus and blur", () => {
    // The exact regression: `display` dropped the `%` and `commit` put the
    // field default back, so tabbing through a percentage field turned it into
    // pixels without anyone touching a key.
    const f = field({}, "50%");
    blur(f.input);
    expect(f.commits).toEqual([]);
  });

  it("commits once on Enter, not twice", () => {
    // Enter used to commit and then blur, and blur committed again — the second
    // pass reading the field as the first had repainted it.
    const f = field();
    clear(f.input);
    type(f.input, "24");
    press(f.input, "Enter");
    blur(f.input);
    expect(f.commits).toEqual(["24px"]);
  });

  it("reverts on Escape without committing", () => {
    const f = field({}, "16px");
    clear(f.input);
    type(f.input, "99");
    press(f.input, "Escape");
    blur(f.input);
    expect(f.commits).toEqual([]);
    expect(f.input.value).toBe("16");
  });

  it("refuses a half-typed unit", () => {
    // `12r` is a legal way-point to `12rem` and must never be written. The old
    // field used one predicate for both and wrote it.
    const f = field();
    clear(f.input);
    type(f.input, "12r");
    expect(f.input.value).toBe("12r");
    blur(f.input);
    expect(f.commits).toEqual([]);
    expect(f.input.value).toBe("16");
  });

  it.each(["abc", "", "1.2.3", "-", "10pxx"])(
    "refuses %j and keeps the previous value",
    (garbage) => {
      const f = field();
      clear(f.input);
      // Straight to the value, bypassing the keystroke filter, the way a paste
      // that slipped through or a programmatic set would.
      f.input.value = garbage;
      blur(f.input);
      expect(f.commits).toEqual([]);
      expect(f.input.value).toBe("16");
    }
  );

  it("refuses a number too large to be finite", () => {
    const f = field();
    f.input.value = "9".repeat(320);
    blur(f.input);
    expect(f.commits).toEqual([]);
  });

  it("clamps to the spec's bounds", () => {
    const f = field({ max: 100, min: 0 }, "50px");
    clear(f.input);
    type(f.input, "500");
    blur(f.input);
    expect(f.commits).toEqual(["100px"]);
  });

  it("rounds a fractional value on an integer field", () => {
    // `z-index: 1.5` is not a smaller step, it is invalid — and used to be
    // accepted and then silently truncated by a `parseInt` downstream.
    const f = field({ integer: true, unit: "", units: [] }, "1");
    clear(f.input);
    type(f.input, "2.7");
    blur(f.input);
    expect(f.commits).toEqual(["3"]);
  });

  it("accepts a keyword the property takes", () => {
    const f = field({ keywords: ["auto"] }, "16px");
    clear(f.input);
    type(f.input, "auto");
    blur(f.input);
    expect(f.commits).toEqual(["auto"]);
  });

  it("refuses a keyword the property does not take", () => {
    const f = field({ keywords: [] }, "16px");
    f.input.value = "auto";
    blur(f.input);
    expect(f.commits).toEqual([]);
  });
});

describe("the keystroke filter", () => {
  it("lets a legal value be typed one character at a time", () => {
    const f = field();
    clear(f.input);
    type(f.input, "12rem");
    expect(f.input.value).toBe("12rem");
  });

  it("refuses characters that lead nowhere", () => {
    const f = field();
    clear(f.input);
    type(f.input, "1q2");
    expect(f.input.value).toBe("12");
  });

  it("refuses a minus on a field that clamps at zero", () => {
    const f = field({ min: 0 });
    clear(f.input);
    type(f.input, "-5");
    expect(f.input.value).toBe("5");
  });

  it("allows a minus where negatives are meaningful", () => {
    const f = field({ min: undefined });
    clear(f.input);
    type(f.input, "-5");
    expect(f.input.value).toBe("-5");
  });

  it("screens a paste, not just typing", () => {
    const f = field();
    clear(f.input);
    const event = new InputEvent("beforeinput", {
      cancelable: true,
      data: "not a length",
      inputType: "insertFromPaste",
    });
    f.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("arrow stepping", () => {
  it("steps by the spec's step", () => {
    const f = field({ step: 1 }, "16px");
    press(f.input, "ArrowUp");
    expect(f.commits).toEqual(["17px"]);
  });

  it("keeps the value's own unit", () => {
    // Stepping already did this correctly; commit did not, so the two disagreed
    // about what the field held.
    const f = field({}, "50%");
    press(f.input, "ArrowUp");
    expect(f.commits).toEqual(["51%"]);
  });

  it("multiplies by ten with shift and divides by ten with alt", () => {
    const f = field({ step: 1 }, "16px");
    press(f.input, "ArrowUp", { shiftKey: true });
    press(f.input, "ArrowDown", { altKey: true });
    expect(f.commits).toEqual(["26px", "25.9px"]);
  });

  it("steps off a keyword from zero, in the field's own unit", () => {
    const f = field({ keywords: ["auto"] }, "auto");
    press(f.input, "ArrowUp");
    expect(f.commits).toEqual(["1px"]);
  });

  it("respects the clamp", () => {
    const f = field({ min: 0, step: 1 }, "0px");
    press(f.input, "ArrowDown");
    expect(f.commits).toEqual(["0px"]);
  });

  it("brackets a held arrow into one gesture", () => {
    const begin = vi.fn();
    const end = vi.fn();
    const handle = createNumField(
      { label: "T", scrub: false, unit: "px", units: ["px"] },
      "0px",
      () => {
        // value ignored
      },
      { begin, end }
    );
    document.body.append(handle.element);
    handle.input.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "ArrowUp" })
    );
    handle.input.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "ArrowUp" })
    );
    expect(begin).toHaveBeenCalledTimes(1);
    handle.input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("setToken", () => {
  /*
   * The field stays the field.
   *
   * Binding a property used to replace the control with a differently-shaped
   * pill, so a row changed height, chrome and colour the moment you picked a
   * token — and a grid with some cells bound and some not stopped reading as
   * one kind of control. A binding is a fact about where the value comes from.
   */
  it("shows the token in the same input the number was in", () => {
    const f = field({}, "16px");
    const before = f.handle.element;
    f.handle.setToken("pk-space-md");
    expect(f.input.value).toBe("pk-space-md");
    expect(f.handle.element).toBe(before);
    expect(f.input.isConnected).toBe(true);
  });

  it("marks the wrapper so the tint has something to hang off", () => {
    const f = field();
    f.handle.setToken("pk-space-md");
    expect(f.handle.element.hasAttribute("data-token")).toBe(true);
    f.handle.setToken(null);
    expect(f.handle.element.hasAttribute("data-token")).toBe(false);
  });

  it("goes read-only, because the value is the design system's", () => {
    const f = field();
    f.handle.setToken("pk-space-md");
    expect(f.input.readOnly).toBe(true);
    f.handle.setToken(null);
    expect(f.input.readOnly).toBe(false);
  });

  it("keeps showing the token across a re-seed", () => {
    // The panel re-seeds controls from computed style between rebuilds. A bound
    // field that let that put the resolved number back would silently stop
    // showing its binding.
    const f = field({}, "16px");
    f.handle.setToken("pk-space-md");
    f.handle.setValue("24px");
    expect(f.input.value).toBe("pk-space-md");
  });

  it("puts the current value back when the binding is removed", () => {
    const f = field({}, "16px");
    f.handle.setToken("pk-space-md");
    f.handle.setValue("24px");
    f.handle.setToken(null);
    expect(f.input.value).toBe("24");
  });

  it("refuses to step a bound value", () => {
    // Nudging a bound field would mean nudging the token — a change to the
    // design system, not to this element.
    const f = field({ step: 1 }, "16px");
    f.handle.setToken("pk-space-md");
    press(f.input, "ArrowUp");
    expect(f.commits).toEqual([]);
    expect(f.input.value).toBe("pk-space-md");
  });
});

describe("setLocked", () => {
  /*
   * Locked is "the value is not yours to edit", without the field claiming to
   * be a token. The colour row's alpha needs exactly this: a bound paint's
   * opacity comes from the token, but the percentage is still worth showing.
   */
  it("keeps showing the value", () => {
    const f = field({}, "16px");
    f.handle.setLocked(true);
    expect(f.input.value).toBe("16");
  });

  it("refuses arrow stepping", () => {
    // `readOnly` alone does not: `keydown` still fires on a read-only input,
    // which is how a bound paint's alpha went on committing.
    const f = field({ step: 1 }, "16px");
    f.handle.setLocked(true);
    press(f.input, "ArrowUp");
    expect(f.commits).toEqual([]);
  });

  it("marks the wrapper and the input", () => {
    const f = field();
    f.handle.setLocked(true);
    expect(f.handle.element.hasAttribute("data-locked")).toBe(true);
    expect(f.input.readOnly).toBe(true);
    f.handle.setLocked(false);
    expect(f.handle.element.hasAttribute("data-locked")).toBe(false);
    expect(f.input.readOnly).toBe(false);
  });

  it("is implied by a binding", () => {
    const f = field();
    f.handle.setToken("pk-space-md");
    expect(f.handle.element.hasAttribute("data-locked")).toBe(true);
    f.handle.setToken(null);
    expect(f.handle.element.hasAttribute("data-locked")).toBe(false);
  });

  it("makes a locked field's own text open its picker", () => {
    // The bound field shows a token name, and the name is the obvious thing to
    // click. Leaving the 20px badge beside it as the only way in makes the
    // headline of the decision inert.
    const f = field();
    const open = vi.fn();
    f.handle.onActivate(open);
    f.handle.setToken("pk-space-md");
    // `pointerdown`, not `mousedown`: touch synthesises a mouse event only after
    // `touchend`, and not at all if the tap becomes a scroll — so a tap on a bound field
    // did nothing on a tablet.
    f.input.dispatchEvent(new MouseEvent("pointerdown", { cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens a locked field's picker from the keyboard", () => {
    // `preventDefault` on the press is what stops a caret landing in a `readOnly` field,
    // and it also stopped the field ever receiving focus — so there was no keyboard route
    // at all, and the only way in was a 20px badge.
    const open = vi.fn();
    const f = field({ label: "Padding" }, "16px");
    f.handle.onActivate(open);
    f.handle.setToken("pk-space-md");

    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "Enter" })
    );
    expect(open).toHaveBeenCalledTimes(1);

    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: " " })
    );
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("does not open the picker from the keyboard when the field is editable", () => {
    const open = vi.fn();
    const f = field({ label: "Padding" }, "16px");
    f.handle.onActivate(open);

    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "Enter" })
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves an editable field's clicks alone", () => {
    const f = field();
    const open = vi.fn();
    f.handle.onActivate(open);
    f.input.dispatchEvent(new MouseEvent("mousedown", { cancelable: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it("survives being destructured off the handle", () => {
    // It was a method reaching for `this`, which a caller taking the function
    // alone would have broken.
    const f = field();
    const { setLocked } = f.handle;
    setLocked(true);
    expect(f.input.readOnly).toBe(true);
  });
});

describe("setValue", () => {
  it("repaints without emitting", () => {
    const f = field();
    f.handle.setValue("24px");
    expect(f.input.value).toBe("24");
    expect(f.commits).toEqual([]);
  });

  it("never overwrites a field the user is typing into", () => {
    // The panel re-seeds on undo and on canvas resize, and both can land while
    // a caret is sitting in a half-finished number.
    const f = field();
    f.input.focus();
    clear(f.input);
    type(f.input, "9");
    f.handle.setValue("24px");
    expect(f.input.value).toBe("9");
  });

  it("lets the displayed value win when a push lands mid-edit", () => {
    // `setValue` on a focused field updates what the field *holds* but not what
    // it shows, so the user's half-finished number survives. On blur the shown
    // value is what commits — which is the only answer that matches what they
    // were looking at.
    const f = field();
    f.input.focus();
    f.handle.setValue("24px");
    f.input.blur();
    expect(f.commits).toEqual(["16px"]);
  });
});
