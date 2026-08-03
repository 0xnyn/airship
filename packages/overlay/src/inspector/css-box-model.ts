/**
 * The box-model diagram at the top of the CSS pane.
 *
 * Four nested rings — margin, border, padding, content — each side directly
 * editable. It is the one view that answers "why is there a gap here" without
 * reading a list, which is why DevTools puts it above everything else.
 *
 * Values are read through `computedStyle`, never `getBoundingClientRect`. On
 * the canvas a frame sits inside a CSS-transformed viewport, so a client rect
 * comes back multiplied by the zoom — the diagram would report 320×44 as
 * 480×66 at 150%. `computedStyle().width` is the used *content-box* size in
 * layout pixels regardless of `box-sizing`, and is zoom-independent.
 */
import { cls, el } from "../dom";
import { round } from "../num";
import { computedStyle } from "../realm";

/** A width that paints nothing, so needs no paired `border-style`. */
const ZERO_WIDTH = /^(0(\.0+)?([a-z%]+)?|none)$/i;
/** `border-top-width` and friends — a `<line-width>`, which takes no percentage. */
const BORDER_WIDTH = /^border-[a-z]+-width$/;

import { createNumField, type NumHandle } from "./controls/num-field";
import type { Gestures, OnChange } from "./controls/types";
import { keywordsFor, LENGTH_UNITS } from "./css-length";

export interface BoxModelView {
  /** Release the fields' gesture brackets and drag registrations. */
  destroy: () => void;
  element: HTMLElement;
  /** Re-read every value from the node. Cheap; safe to call on any refresh. */
  sync: (node: Element | null) => void;
}

type Side = "bottom" | "left" | "right" | "top";
type Ring = "border" | "margin" | "padding";

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
const RINGS: readonly Ring[] = ["margin", "border", "padding"];

/** The longhand a ring/side pair edits. Border is a width, not a size. */
function propertyFor(ring: Ring, side: Side): string {
  return ring === "border" ? `border-${side}-width` : `${ring}-${side}`;
}

/**
 * What the *content* readout shows: a rounded number, or an em dash.
 *
 * The per-side cells no longer come through here — `createNumField` owns their
 * display, and its rule (hide the unit only when it is the field's own) is the
 * one the rest of the panel uses. DevTools' "`-` for zero" convention is kept
 * only where it still applies, because a ring full of `0px` is noise and the
 * interesting thing about a box model is where the non-zero numbers are.
 */
function displaySize(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? value || "—" : String(round(n, 2));
}

export function createBoxModelDiagram(opts: {
  gestures: Gestures;
  getNode: () => Element | null;
  onChange: OnChange;
}): BoxModelView {
  const fields = new Map<string, NumHandle>();
  const handles: NumHandle[] = [];
  const size = el("span", { class: cls("css-bm-size"), text: "—" });

  const cell = (ring: Ring, side: Side): HTMLElement => {
    const property = propertyFor(ring, side);
    /*
     * The panel's one numeric field, not a bare `<input>`.
     *
     * These twelve cells were a second, far weaker implementation: no keystroke
     * filter, no bounds, no scrub, and a `normalize` whose fallback was `return
     * raw` — so `abc`, `1.2.3px`, a lone `-` and an unclamped negative padding
     * all went straight into the change set and on to the agent, while the
     * Design tab's padding control refused every one of them. Two views of the
     * same property disagreeing about what a valid value is was the clearest
     * symptom that the panel had two field implementations.
     */
    const handle = createNumField(
      {
        fieldKey: `bm:${property}`,
        // The diagram is the label; a glyph inside a 40px cell would not fit.
        label: property,
        // Padding and border widths cannot be negative; a margin can, and
        // pulling a child back out of its parent's padding is a technique.
        min: ring === "margin" ? undefined : 0,
        scrub: false,
        unit: "px",
        /*
         * A border width is a `<line-width>`, and a percentage is not one.
         *
         * `[...LENGTH_UNITS]` includes `%`, so `50%` was accepted here, previewed, and
         * sent to the agent — for a property where the browser simply drops it. The
         * field's whole contract is that a value it accepts is one the browser will
         * accept for that property.
         */
        units: BORDER_WIDTH.test(property)
          ? LENGTH_UNITS.filter((u) => u !== "%")
          : [...LENGTH_UNITS],
        // `auto` on a margin is how a box is centred, and this is the one view
        // that shows it. Asked of the property rather than assumed.
        ...{ keywords: keywordsFor(property) },
      },
      "",
      (value) => {
        const node = opts.getNode();
        if (node) {
          write(node, ring, side, property, value, opts);
        }
      },
      opts.gestures
    );
    handle.element.classList.add(cls("css-bm-field-wrap"));
    handles.push(handle);
    fields.set(property, handle);
    return el("span", { class: `${cls("css-bm-cell")}`, "data-side": side }, [
      handle.element,
    ]);
  };

  const ringEl = (ring: Ring, inner: HTMLElement): HTMLElement =>
    el("div", { class: `${cls("css-bm-ring")} ${cls(`css-bm-${ring}`)}` }, [
      el("span", { class: cls("css-bm-label"), text: ring }),
      ...SIDES.map((side) => cell(ring, side)),
      inner,
    ]);

  const content = el("div", { class: cls("css-bm-content") }, [
    el("span", { class: cls("css-bm-label"), text: "content" }),
    size,
  ]);

  // Built inside-out so each ring wraps the next.
  const element = el("div", { class: cls("css-bm") }, [
    RINGS.reduceRight<HTMLElement>(
      (inner, ring) => ringEl(ring, inner),
      content
    ),
  ]);

  return {
    destroy() {
      for (const handle of handles) {
        handle.destroy();
      }
    },
    element,
    sync(node) {
      if (!node) {
        for (const handle of fields.values()) {
          handle.setValue("");
        }
        size.textContent = "—";
        return;
      }
      const cs = computedStyle(node);
      for (const [property, handle] of fields) {
        // `setValue` already refuses to stomp a focused field.
        handle.setValue(cs.getPropertyValue(property).trim());
      }
      size.textContent = `${displaySize(cs.width)} × ${displaySize(cs.height)}`;
    },
  };
}

/**
 * Write one side, plus the `border-style` that makes a border width mean
 * anything.
 *
 * `border-top-width: 2px` renders nothing while `border-top-style` is `none`,
 * which is the default — so typing a width into an unstyled box would appear to
 * do nothing at all. The pair is bracketed as one gesture so it stays one undo
 * step rather than two.
 */
function write(
  node: Element,
  ring: Ring,
  side: Side,
  property: string,
  value: string,
  opts: { gestures: Gestures; onChange: OnChange }
): void {
  /*
   * A border width only paints if the side also has a style.
   *
   * The test was `Number.parseFloat(value) > 0`, which is `NaN` for every keyword — so
   * typing `thin` (a legal `border-width`) queued `border-top-width: thin` with
   * `border-top-style` still `none`, previewed it as though it had worked, and shipped it
   * to the agent. Nothing rendered, and nothing said why.
   *
   * Any value that is not an explicit nothing needs the style, keyword or number alike.
   */
  const paints = value.trim() !== "" && !ZERO_WIDTH.test(value.trim());
  // Empty counts as no style, not as unknown: `=== "none"` alone meant an engine that
  // reports "" for an unset border-style got no paired write, and the width painted
  // nothing — the very case this pairing exists to prevent.
  const currentStyle = computedStyle(node)
    .getPropertyValue(`border-${side}-style`)
    .trim();
  const needsStyle =
    ring === "border" &&
    paints &&
    (currentStyle === "" || currentStyle === "none");

  if (!needsStyle) {
    opts.onChange(property, value);
    return;
  }
  opts.gestures.begin?.();
  try {
    opts.onChange(`border-${side}-style`, "solid");
    opts.onChange(property, value);
  } finally {
    opts.gestures.end?.();
  }
}
