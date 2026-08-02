import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { LENGTH_UNITS } from "../css-length";
import type { TokenSlotFor } from "../sections/context";
import { createNumField, type NumHandle } from "./num-field";
import type { ControlHandle, Gestures, OnChange } from "./types";

/*
 * One value, with a switch to four.
 *
 * Corner radius and stroke width are the same control twice: a symmetric field
 * that expands to a per-side set, with the mode toggle in the same place and the
 * same glyph. Padding is a third instance with enough of its own behaviour
 * (the horizontal/vertical pairing) to stay separate.
 *
 * Written once because the alternative is two copies that quietly disagree about
 * what "0" means or when the split view opens — which is exactly how a panel
 * stops reading as a system.
 */

export interface QuadSide {
  glyph: IconName;
  /** Names the side: "Top left", "Top". */
  label: string;
  property: string;
}

export interface QuadSpec {
  /** Glyph and label for the collapsed, all-four-at-once field. */
  collapsed: { glyph: IconName; label: string };
  /** Fired after each write, for implications the caller wants to enforce. */
  onWrote?: (property: string, css: string) => void;
  sides: QuadSide[];
  /** Suffix appended to each side's label in the split view ("radius"). */
  suffix?: string;
  toggle: { glyph: IconName; label: string };
  /** The token affordance for the longhands one field writes. See `padding.ts`. */
  tokenSlot?: TokenSlotFor;
}

export function createQuadField(
  spec: QuadSpec,
  initial: Map<string, string>,
  onChange: OnChange,
  gestures?: Gestures
): ControlHandle {
  const values = new Map(initial);
  const get = (p: string): string => values.get(p) ?? "0px";
  // Open split when the sides already disagree — otherwise the collapsed field
  // would show one of four values and silently flatten the rest on first edit.
  let split = new Set(spec.sides.map((s) => get(s.property))).size > 1;

  const fields = el("div", { class: cls("pad-fields") });
  /*
   * The root, built here so `render` can publish the mode on it — the way
   * `createPadding` already publishes its own.
   *
   * Split, this control is four fields, and four fields cannot be a 2x2 inside
   * a half-width grid cell: Appearance would need a 424px dock before each one
   * cleared its floor. So the stylesheet promotes a split quad to the whole row
   * and `data-mode` is how it can tell. Collapsed the control is a single
   * field, hence "one" rather than padding's "pair".
   */
  const wrap = el("div", { class: cls("pad-row") }, [fields]);
  // Held so a re-render can dispose the dnd-kit grips it is about to drop.
  let mounted: NumHandle[] = [];

  function write(property: string, css: string): void {
    values.set(property, css);
    onChange(property, css);
    spec.onWrote?.(property, css);
  }

  /** The fields on screen, by the properties each shows. See `setValue`. */
  let shown: { handle: NumHandle; properties: string[] }[] = [];

  function field(
    glyph: IconName,
    tip: string,
    key: string,
    value: string,
    properties: string[],
    commit: (css: string) => void
  ): HTMLElement {
    const handle = createNumField(
      {
        fieldKey: key,
        glyph,
        label: tip,
        min: 0,
        unit: "px",
        units: [...LENGTH_UNITS],
      },
      value,
      commit,
      gestures
    );
    mounted.push(handle);
    shown.push({ handle, properties });
    const slot = spec.tokenSlot?.(properties);
    if (!slot) {
      return handle.element;
    }
    /*
     * The field keeps its shape; the token replaces only what it reads.
     *
     * This used to return `slot.element` when bound, left over from an earlier
     * design where the slot *was* a pill carrying the token name. It is the
     * badge now — a 20px ghost icon — so a bound padding, margin, corner radius
     * or stroke width rendered as an icon with no value at all, and the field it
     * replaced stayed built and registered against an element nothing appended.
     */
    handle.setToken(slot.label);
    handle.onActivate(() => slot.open());
    return el("div", { class: cls("token-cell") }, [
      handle.element,
      slot.element,
    ]);
  }

  function render(): void {
    wrap.dataset.mode = split ? "sides" : "one";
    for (const handle of mounted) {
      handle.destroy();
    }
    mounted = [];
    shown = [];
    fields.replaceChildren();
    if (split) {
      for (const side of spec.sides) {
        const tip = spec.suffix ? `${side.label} ${spec.suffix}` : side.label;
        fields.append(
          field(
            side.glyph,
            tip,
            side.property,
            get(side.property),
            [side.property],
            (css) => write(side.property, css)
          )
        );
      }
      return;
    }
    fields.append(
      field(
        spec.collapsed.glyph,
        spec.collapsed.label,
        `${spec.sides[0].property}-all`,
        get(spec.sides[0].property),
        spec.sides.map((s) => s.property),
        (css) => {
          for (const side of spec.sides) {
            write(side.property, css);
          }
        }
      )
    );
  }

  /** Do the sides still agree the way the current mode assumes? */
  function modeStillFits(): boolean {
    const disagree = new Set(spec.sides.map((s) => get(s.property))).size > 1;
    return disagree === split;
  }

  const toggle = el(
    "button",
    {
      "aria-label": spec.toggle.label,
      "aria-pressed": String(split),
      class: cls("pad-mode"),
      "data-tip": spec.toggle.label,
      onClick: () => {
        split = !split;
        toggle.classList.toggle(cls("pad-mode-on"), split);
        toggle.setAttribute("aria-pressed", String(split));
        render();
      },
      type: "button",
    },
    [icon(spec.toggle.glyph, "sm")]
  );
  toggle.classList.toggle(cls("pad-mode-on"), split);
  wrap.append(toggle);

  render();

  return {
    destroy() {
      for (const handle of mounted) {
        handle.destroy();
      }
      mounted = [];
    },
    element: wrap,
    properties: spec.sides.map((s) => s.property),
    /*
     * Push the value into the field that shows it, and rebuild only when the
     * shape has to change. See the longer note in `padding.ts`: a `render()` on
     * every re-seed replaced the very input holding the caret, so an undo or a
     * canvas resize landing mid-type took the caret with it.
     */
    setValue(cssProperty, value) {
      if (!values.has(cssProperty)) {
        return;
      }
      if (values.get(cssProperty) === value) {
        // Already what we hold. Falling through would re-`setValue` every shown
        // field, and — when the mode no longer fits — `render()` the control out
        // from under a live gesture: scrubbing Top until it equals Bottom
        // collapsed the four-side view to the pair view *mid-drag* and destroyed
        // the `NumHandle` being dragged.
        return;
      }
      values.set(cssProperty, value);
      if (modeStillFits()) {
        for (const entry of shown) {
          if (entry.properties.includes(cssProperty)) {
            entry.handle.setValue(value);
          }
        }
        return;
      }
      split = !split;
      toggle.classList.toggle(cls("pad-mode-on"), split);
      toggle.setAttribute("aria-pressed", String(split));
      render();
    },
  };
}
