import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { LENGTH_UNITS } from "../css-length";
import type { Descriptor } from "../descriptors";
import type { TokenSlotFor } from "../sections/context";
import { createNumField, type NumHandle } from "./num-field";
import type { ControlHandle, Gestures, OnChange } from "./types";

/*
 * The padding control: two fields (horizontal / vertical) with a switch to
 * four (top / right / bottom / left).
 *
 * The collapsed mode is the one people spend their time in, and offering four
 * boxes for what is nearly always a symmetric pair is most of why the old
 * box-model cross felt like a form.
 *
 * H/V mode writes **longhands** — `padding-left` and `padding-right` as two
 * separate records, not one `padding-inline`. Two reasons, both practical:
 * `applyPreview` sets one property at a time, and the agent's prompt reads
 * `padding-left: 8px → 16px` far better than a logical shorthand it then has to
 * decide how to express in the project's own idiom.
 *
 * It takes a spec rather than being hard-wired to padding because **margin is
 * the same control**. A design tool has no margin — its frames space their children
 * with gap and padding, full stop — but this is a DOM editor and margin is half
 * of how web layouts are actually spaced. The one behavioural difference is
 * `signed`: padding clamps at zero, margin does not, because pulling a child
 * back out of its parent's padding with a negative margin is a technique rather
 * than a mistake.
 */

type Mode = "pair" | "sides";

interface Side {
  descriptor: Descriptor;
  glyph: IconName;
  key: "top" | "right" | "bottom" | "left";
}

/** Per-side glyphs, when a descriptor does not name its own. */
const GLYPH: Record<string, IconName> = {
  bottom: "pad-bottom",
  left: "pad-left",
  right: "pad-right",
  top: "pad-top",
};

export interface PaddingSpec {
  /** Glyph for the collapsed horizontal and vertical fields. */
  collapsed: { h: IconName; v: IconName };
  descriptors: Descriptor[];
  /** Names the thing being spaced, for tooltips: "padding", "margin". */
  noun: string;
  /** `padding` clamps at zero; `margin` does not — negative margins are a technique. */
  signed?: boolean;
  toggle: { glyph: IconName; label: string };
  /**
   * The token affordance for the longhands one field writes.
   *
   * Padding and margin are the largest spacing surface in the panel and had no
   * token picker at all — the affordance existed only on the descriptor
   * pipeline, which these controls do not go through.
   */
  tokenSlot?: TokenSlotFor;
}

export function createPadding(
  spec: PaddingSpec,
  initial: Map<string, string>,
  onChange: OnChange,
  gestures?: Gestures
): ControlHandle {
  const sides: Side[] = spec.descriptors.map((descriptor) => {
    const key = descriptor.cssProperty.split("-")[1] as Side["key"];
    return { descriptor, glyph: descriptor.fieldIcon ?? GLYPH[key], key };
  });
  const by = (k: Side["key"]): Side => sides.find((s) => s.key === k) as Side;
  const prop = (k: Side["key"]): string => by(k).descriptor.cssProperty;

  const values = new Map<string, string>();
  for (const { descriptor } of sides) {
    values.set(
      descriptor.cssProperty,
      initial.get(descriptor.cssProperty) ?? descriptor.defaultValue
    );
  }

  /** Start in the mode the element is already in: split values need four fields. */
  const asymmetric =
    values.get(prop("left")) !== values.get(prop("right")) ||
    values.get(prop("top")) !== values.get(prop("bottom"));
  let mode: Mode = asymmetric ? "sides" : "pair";

  const fields = el("div", { class: cls("pad-fields") });
  // Held so a re-render can dispose the dnd-kit grips it is about to drop —
  // otherwise flipping the mode switch a few times leaves detached draggables
  // in the shared registry, each still answering queries.
  let mounted: NumHandle[] = [];

  function write(property: string, css: string): void {
    values.set(property, css);
    onChange(property, css);
  }

  /**
   * The fields currently on screen, by the properties each one shows.
   *
   * Held so `setValue` can push a value into the one field that displays it
   * rather than rebuilding all of them — see the note there.
   */
  let shown: { handle: NumHandle; properties: string[] }[] = [];

  /** One glyph-fielded, scrubbable input. */
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
        min: spec.signed ? undefined : 0,
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
    for (const handle of mounted) {
      handle.destroy();
    }
    mounted = [];
    shown = [];
    fields.replaceChildren();
    if (mode === "pair") {
      fields.append(
        field(
          spec.collapsed.h,
          `Horizontal ${spec.noun}`,
          `${spec.noun}-h`,
          values.get(prop("left")) ?? "0px",
          [prop("left"), prop("right")],
          (css) => {
            write(prop("left"), css);
            write(prop("right"), css);
          }
        ),
        field(
          spec.collapsed.v,
          `Vertical ${spec.noun}`,
          `${spec.noun}-v`,
          values.get(prop("top")) ?? "0px",
          [prop("top"), prop("bottom")],
          (css) => {
            write(prop("top"), css);
            write(prop("bottom"), css);
          }
        )
      );
      return;
    }
    for (const key of ["top", "right", "bottom", "left"] as const) {
      const side = by(key);
      fields.append(
        field(
          side.glyph,
          `${key[0].toUpperCase()}${key.slice(1)} ${spec.noun}`,
          side.descriptor.cssProperty,
          values.get(side.descriptor.cssProperty) ?? "0px",
          [side.descriptor.cssProperty],
          (css) => write(side.descriptor.cssProperty, css)
        )
      );
    }
  }

  /** Do the four sides still agree the way the current mode assumes? */
  function modeStillFits(): boolean {
    const split =
      values.get(prop("left")) !== values.get(prop("right")) ||
      values.get(prop("top")) !== values.get(prop("bottom"));
    return split === (mode === "sides");
  }

  const toggle = el(
    "button",
    {
      "aria-label": spec.toggle.label,
      "aria-pressed": String(mode === "sides"),
      class: cls("pad-mode"),
      "data-tip": spec.toggle.label,
      onClick: () => {
        mode = mode === "pair" ? "sides" : "pair";
        toggle.classList.toggle(cls("pad-mode-on"), mode === "sides");
        toggle.setAttribute("aria-pressed", String(mode === "sides"));
        wrap.dataset.mode = mode;
        render();
      },
      type: "button",
    },
    [icon(spec.toggle.glyph, "sm")]
  );
  toggle.classList.toggle(cls("pad-mode-on"), mode === "sides");

  render();
  const wrap = el("div", { class: cls("pad-row") }, [fields, toggle]);
  wrap.dataset.mode = mode;

  return {
    destroy() {
      for (const handle of mounted) {
        handle.destroy();
      }
      mounted = [];
    },
    element: wrap,
    properties: sides.map((s) => s.descriptor.cssProperty),
    /*
     * Push the value into the one field that shows it.
     *
     * This used to call `render()`, which destroys and rebuilds all of them —
     * and the panel re-seeds every property in turn, so a single refresh tore
     * the group down four times over. That also defeated `createNumField`'s
     * "never overwrite a focused field" guard, because the input holding the
     * caret was not overwritten, it was replaced: an undo or a canvas resize
     * landing mid-type took the caret with it.
     *
     * A rebuild is still right when the *shape* has to change — four sides that
     * have just been made equal should collapse back to a pair — so that case
     * is asked for explicitly rather than paid for every time.
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
      mode = mode === "pair" ? "sides" : "pair";
      wrap.dataset.mode = mode;
      toggle.classList.toggle(cls("pad-mode-on"), mode === "sides");
      toggle.setAttribute("aria-pressed", String(mode === "sides"));
      render();
    },
  };
}
