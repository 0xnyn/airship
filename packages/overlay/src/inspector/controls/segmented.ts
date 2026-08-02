import { cls, el } from "../../dom";
import { icon } from "../../icons";
import type { Descriptor } from "../descriptors";
import type { ControlHandle, OnChange } from "./types";

/**
 * A segmented button group for enum-valued CSS properties.
 *
 * When every option carries a glyph the group switches to square icon cells —
 * which is what a design tool's segmented controls actually are. Text pills and icon
 * cells are different shapes doing different jobs, and mixing them in one row is
 * most of why a property sheet reads as a web form.
 */
export interface SegmentedOptions {
  /**
   * Recompute which option is active from the live element. Paired with
   * `properties` — when any of them changes externally, the group asks this
   * rather than trying to match the raw value.
   */
  derive?: () => string;
  /**
   * Write the choice. Replaces the default single-property write, for the
   * groups where one click means more than one declaration — picking Wrap sets
   * `flex-direction` *and* `flex-wrap`, and Outside stroke is a `box-sizing`
   * value under a different name.
   */
  onSelect?: (value: string) => void;
  /** What this group reflects, when it is not just `descriptor.cssProperty`. */
  properties?: readonly string[];
}

export function createSegmented(
  descriptor: Descriptor,
  initial: string,
  onChange: OnChange,
  opts: SegmentedOptions = {}
): ControlHandle {
  const options = descriptor.enumValues ?? [];
  const active = cls("ctl-seg-on");
  const buttons: { btn: HTMLElement; value: string }[] = [];
  const allIcons = options.length > 0 && options.every((o) => o.icon);
  const properties = opts.properties ?? [descriptor.cssProperty];

  function setActive(value: string): void {
    for (const { btn, value: v } of buttons) {
      const on = v === value;
      btn.classList.toggle(active, on);
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  /*
   * A named group, not a bare row of buttons.
   *
   * Only the individual cells were labelled, so a screen reader announced "Horizontal,
   * pressed" with nothing to say what was horizontal. `role="group"` plus the
   * descriptor's own label is what ties the three cells to the decision they make.
   */
  const container = el("div", {
    "aria-label": descriptor.label,
    class: cls("ctl-seg"),
    role: "group",
  });
  if (allIcons) {
    container.dataset.variant = "icon";
  }
  for (const opt of options) {
    const btn = el(
      "button",
      {
        "aria-label": opt.label,
        class: cls("ctl-seg-btn"),
        // `data-tip` rather than `title`: the overlay's own tooltip renders it
        // with the shortcut hint, and native titles cannot be styled.
        //
        // Only where the cell is a glyph. A word pill already says what it is,
        // and a tooltip repeating the word under the pointer is one more thing
        // covering the row below for no information at all.
        ...(opt.icon ? { "data-tip": opt.label } : {}),
        onClick: () => {
          setActive(opt.value);
          if (opts.onSelect) {
            opts.onSelect(opt.value);
          } else {
            onChange(descriptor.cssProperty, opt.value);
          }
        },
        type: "button",
      },
      opt.icon ? [icon(opt.icon, "sm")] : [el("span", { text: opt.label })]
    );
    buttons.push({ btn, value: opt.value });
    container.append(btn);
  }
  setActive(initial || descriptor.defaultValue);

  return {
    element: container,
    properties,
    setValue(cssProperty, value) {
      if (!properties.includes(cssProperty)) {
        return;
      }
      setActive(opts.derive ? opts.derive() : value);
    },
  };
}
