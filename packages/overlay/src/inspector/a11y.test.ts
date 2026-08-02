import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenPopover } from "../popover-host";
import { createColorRow, openColorPicker } from "./controls/color-picker";
import { createSegmented } from "./controls/segmented";
import { createSelect } from "./controls/select";
import { isPrefix, LENGTH_UNITS, parseLength } from "./css-length";
import { resetDocument } from "./test-support";

/*
 * Accessibility, and the keyboard routes that did not exist.
 *
 * All DOM, so all cheap to assert — which is part of why none of it was caught: nothing
 * was looking. The three colour sliders were `<div tabindex="-1">` with no role, name or
 * value; the segmented group had no role at all; the select promised a listbox and opened
 * a menu; and a bound field could only be reached with a mouse.
 */

const DESCRIPTOR = {
  controlType: "segmented" as const,
  cssProperty: "flex-direction",
  defaultValue: "row",
  enumValues: [
    { label: "Horizontal", value: "row" },
    { label: "Vertical", value: "column" },
  ],
  group: "layout" as const,
  key: "flexDirection",
  label: "Direction",
};

describe("segmented group", () => {
  beforeEach(resetDocument);

  it("names the group, not just its cells", () => {
    // A screen reader announced "Horizontal, pressed" with nothing to say what was
    // horizontal.
    const control = createSegmented(DESCRIPTOR, "row", () => undefined);
    expect(control.element.getAttribute("role")).toBe("group");
    expect(control.element.getAttribute("aria-label")).toBe("Direction");
  });

  it("still marks the active cell", () => {
    const control = createSegmented(DESCRIPTOR, "column", () => undefined);
    const pressed = Array.from(
      control.element.querySelectorAll("button")
    ).filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe("Vertical");
  });
});

describe("select trigger", () => {
  beforeEach(resetDocument);

  it("advertises the menu it actually opens", () => {
    // It claimed `listbox` while `popover-host` renders `role="menu"` with menuitem
    // children, and had neither `aria-activedescendant` nor `aria-selected` to make the
    // listbox reading true.
    const control = createSelect(
      { ...DESCRIPTOR, controlType: "select" },
      "row",
      () => undefined
    );
    const trigger = control.element.querySelector("button");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-label")).toBe("Direction");
  });
});

describe("colour picker sliders", () => {
  /*
   * `closeOpenPopover`, not `resetDocument`.
   *
   * The popover host is a module-scoped element appended to `body` once, so emptying the
   * body detaches it permanently and every later popover mounts into a tree
   * `document.querySelector` cannot see. Closing the stack is the teardown that actually
   * matches how the host is built.
   */
  beforeEach(() => {
    closeOpenPopover();
  });

  /**
   * The picker, against a real anchor so the popover host can place it.
   *
   * Opened directly rather than by clicking the row's swatch: the row opens it on a
   * deferred pointer path that needs layout happy-dom does not do, and what these tests
   * are about is the picker's own markup and keys.
   */
  function open() {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const onChange = vi.fn();
    openColorPicker({ anchor, onChange, value: "#3b82f6" });
    return { onChange };
  }

  function slider(label: string): HTMLElement | null {
    return document.querySelector(`[aria-label="${label}"]`);
  }

  it("gives hue and opacity real slider semantics", () => {
    open();
    for (const label of ["Hue", "Opacity"]) {
      const el = slider(label);
      expect(el, label).not.toBeNull();
      expect(el?.getAttribute("role")).toBe("slider");
      // Reachable by keyboard at all, which `tabindex="-1"` prevented.
      expect(el?.getAttribute("tabindex")).toBe("0");
      expect(el?.getAttribute("aria-valuemin")).toBe("0");
      expect(el?.getAttribute("aria-valuenow")).not.toBeNull();
    }
  });

  it("names the saturation square and makes it focusable", () => {
    open();
    const sv = slider("Saturation and brightness");
    expect(sv).not.toBeNull();
    expect(sv?.getAttribute("tabindex")).toBe("0");
  });

  it("changes the colour from the keyboard", () => {
    /*
     * The whole point: the only keyboard route to a colour was the R/G/B/H/S/L number
     * fields, and to alpha the opacity field. The wiring for this was also, at first,
     * placed after the enclosing function's `return` — so it was unreachable and never
     * attached; biome's `noUnreachable` caught that.
     */
    const { onChange } = open();
    const hue = slider("Hue");
    hue?.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "ArrowRight" })
    );
    expect(onChange).toHaveBeenCalled();
  });

  it("takes a coarse step with shift", () => {
    const { onChange } = open();
    const hue = slider("Hue");
    const fine = () => {
      onChange.mockClear();
      hue?.dispatchEvent(
        new KeyboardEvent("keydown", { cancelable: true, key: "ArrowRight" })
      );
      return String(onChange.mock.calls.at(-1)?.[0] ?? "");
    };
    const first = fine();
    onChange.mockClear();
    hue?.dispatchEvent(
      new KeyboardEvent("keydown", {
        cancelable: true,
        key: "ArrowRight",
        shiftKey: true,
      })
    );
    const coarse = String(onChange.mock.calls.at(-1)?.[0] ?? "");
    // Different colours, so the modifier is doing something.
    expect(coarse).not.toBe(first);
  });

  it("ignores keys that are not arrows", () => {
    const { onChange } = open();
    slider("Hue")?.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: "a" })
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("colour row", () => {
  beforeEach(resetDocument);

  it("gives its swatch an accessible name", () => {
    const row = createColorRow({
      onChange: () => undefined,
      tip: "Fill",
      value: "#fff",
    });
    document.body.append(row.element);
    const named = row.element.querySelector("[aria-label]");
    expect(named).not.toBeNull();
    row.destroy?.();
  });
});

describe("locale decimal separator", () => {
  it("accepts the comma a German or French keyboard produces", () => {
    /*
     * `isPrefix("1,")` was false, so the `beforeinput` filter `preventDefault`ed the
     * comma outright: the key was simply inert, with nothing to say why. CSS itself only
     * takes `.`, so this normalises rather than widening the grammar.
     */
    expect(isPrefix("1,", [...LENGTH_UNITS])).toBe(true);
    expect(parseLength("1,5")).toEqual({ unit: "", value: 1.5 });
    expect(parseLength("1,5rem")?.value).toBeUndefined();
  });

  it("does not rewrite a comma that is a separator", () => {
    // Only a lone comma between digits is a decimal point. A comma anywhere else is a
    // list separator, and rewriting one of those would be far worse than refusing it.
    expect(parseLength("1,2,3")).toBeNull();
  });
});
