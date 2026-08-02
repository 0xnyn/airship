import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { createMenu, type MenuHandle } from "../../popover-host";
import type { Descriptor } from "../descriptors";
import type { ControlHandle, OnChange } from "./types";

/**
 * A dropdown for word-labelled enums.
 *
 * `createSegmented` is the right control when the options are glyphs or short
 * words — it shows every choice at once, which is faster. It stops being right
 * around five text labels: `Static / Relative / Absolute / Fixed / Sticky` wraps
 * onto two rows in a 320px panel, and a control that reflows as you resize the
 * dock reads as a bug. Design tools use a select for exactly these.
 */
export function createSelect(
  descriptor: Descriptor,
  initial: string,
  onChange: OnChange
): ControlHandle {
  const options = descriptor.enumValues ?? [];
  let current = initial || descriptor.defaultValue;

  const label = el("span", {
    text: options.find((o) => o.value === current)?.label ?? current,
  });

  const button = el(
    "button",
    {
      // The label as an `aria-label`, not a `data-tip`. A select lives in a
      // labelled row and shows its current value, so the tooltip repeated the
      // word sitting two inches to its left — and being a full-width anchor, it
      // opened centred over whatever row came next. The name is still worth
      // stating, just to the one reader who cannot see the rail.
      "aria-expanded": "false",
      /*
       * `menu`, matching what actually opens.
       *
       * This claimed `listbox` while `popover-host` renders `role="menu"` with
       * `role="menuitem"` children — so the promise the trigger made to a screen reader
       * was contradicted by the thing it opened, and neither `aria-activedescendant`
       * nor `aria-selected` existed to make the listbox reading true. Naming the menu is
       * the honest half of the fix; the current value is announced through
       * `aria-label` below.
       */
      "aria-haspopup": "menu",
      "aria-label": descriptor.label,
      class: cls("select"),
      type: "button",
    },
    [label, icon("caret-down", "xs")]
  );

  /*
   * The menu is built when it opens, not when the control is.
   *
   * `createMenu` freezes `on:` into the markup it returns, so a menu built once
   * at construction kept whichever check mark was right at that moment for the
   * life of the control. Pick a value and reopen: the tick was still against
   * the old one. Same for `setValue` — undo would move the button's label and
   * leave the list disagreeing with it.
   *
   * Reading `current` inside the click handler costs one array map per open and
   * removes the entire class of bug.
   */
  let menu: MenuHandle | null = null;

  button.addEventListener("click", () => {
    menu = createMenu(
      options.map((opt) => ({
        label: opt.label,
        on: opt.value === current,
        run: () => {
          current = opt.value;
          label.textContent = opt.label;
          onChange(descriptor.cssProperty, opt.value);
        },
      }))
    );
    button.setAttribute("aria-expanded", "true");
    // Width-matched, because a dropdown narrower than the control it hangs off
    // reads as a different widget rather than as that control's list.
    menu.open(button, "below", {
      matchAnchorWidth: true,
      // However the menu went away — outside press, Escape, a choice, or the
      // panel rebuilding under it — the button stops claiming to be expanded.
      // This used to be a `document` pointerdown listener of its own, which
      // could only see one of those four.
      onClose: () => {
        button.setAttribute("aria-expanded", "false");
        menu = null;
      },
    });
  });

  return {
    destroy() {
      menu?.close();
    },
    element: el("div", { class: cls("select-wrap") }, [button]),
    properties: [descriptor.cssProperty],
    setValue(cssProperty, value) {
      if (cssProperty !== descriptor.cssProperty) {
        return;
      }
      current = value;
      label.textContent =
        options.find((o) => o.value === value)?.label ?? value;
    },
  };
}
