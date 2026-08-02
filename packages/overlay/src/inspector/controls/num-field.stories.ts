import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls } from "../../dom";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import { LENGTH_UNITS } from "../css-length";
import { APPEARANCE_GROUP, SIZE_GROUP, SPACING_GROUP } from "../descriptors";
import { labelled } from "../sections/row";
import { createNumField, createTextField, type NumSpec } from "./num-field";
import { createNumberScrub, specOf } from "./number-scrub";

/*
 * The number field — the control the inspector is mostly made of.
 *
 * `createNumField` is deliberately *not* a `ControlHandle`; its own header says
 * so. It knows nothing about CSS properties, the change set or the selection —
 * it is a value, a unit vocabulary and a glyph that doubles as a drag handle.
 * That is why it can be stood up here with nothing around it, and why the panel
 * has to adapt it (`numControl`) rather than register it directly.
 *
 * These stories exist for the states the field can reach that a running editor
 * makes awkward to arrange:
 *
 * - **The two-column grid.** Half-width fields pair up; this is the only place
 *   in the catalogue where that geometry is under test. `.__airship-grid` is
 *   `repeat(auto-fill, minmax(max(--field-min, (100% - gutter) / 2), 1fr))`,
 *   and it is a guarantee of two tracks rather than a reflow — but only at the
 *   width the dock actually is.
 * - **Locked and token-bound.** Two different refusals to be edited, which look
 *   similar and mean different things. `setLocked` keeps the number and stops
 *   the edit; `setToken` replaces what the field *reads* with a token name. The
 *   comment on `NumHandle.setLocked` explains why the colour row needs both.
 * - **Keyword and unit values.** `keywordsFor` gives each property the words it
 *   genuinely accepts, after a shared list let `font-size: auto` through.
 */

const meta: Meta = {
  title: "Inspector/Controls/Number field",
};

export default meta;

/** A bare field at a value, wrapped as a grid cell like `fieldCell` does. */
function field(spec: NumSpec, value: string): HTMLElement {
  const handle = createNumField(spec, value, noop);
  handle.element.classList.add(cls("cell"));
  return handle.element;
}

/** The descriptor-driven path, which is what the panel actually calls. */
function scrub(key: string, value: string): HTMLElement {
  const descriptor = [
    ...SIZE_GROUP.descriptors,
    ...SPACING_GROUP.descriptors,
    ...APPEARANCE_GROUP.descriptors,
  ].find((d) => d.key === key);
  if (!descriptor) {
    throw new Error(`No descriptor keyed ${key}`);
  }
  const control = createNumberScrub(descriptor, value, noop);
  control.element.classList.add(cls("cell"));
  return control.element;
}

/**
 * The Size grid — six fields, two columns, the geometry this control lives in.
 *
 * If this renders as one column or as four, the dock is not at its real width
 * and nothing else in the catalogue can be trusted either.
 */
export const Grid: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Size",
          grid([
            scrub("width", "240px"),
            scrub("height", "48px"),
            scrub("minWidth", "auto"),
            scrub("maxWidth", "100%"),
            scrub("minHeight", "auto"),
            scrub("maxHeight", "none"),
          ])
        ),
      ]),
      {
        caption: {
          try: "count the columns — one or four means the dock is not at its real width, and nothing else in the catalogue can be trusted",
          what: "Six fields in the two-column grid the panel is mostly made of.",
        },
      }
    ),
};

/**
 * Glyph slots: an icon, one letter, two letters, and none.
 *
 * The glyph is the field's identity in place of a label rail *and* the scrub
 * grip, so it has to read at 11px in all four forms. "Min W" is the longest
 * `fieldLabel` the panel uses and is the one that decides the slot width.
 */
export const Glyphs: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Glyph slot",
          grid([
            field({ glyph: "size-fixed", label: "Width", unit: "px" }, "240"),
            field({ glyph: "W", label: "Width", unit: "px" }, "240"),
            field({ glyph: "Min W", label: "Min width", unit: "px" }, "120"),
            field({ label: "No glyph", unit: "px" }, "16"),
          ])
        ),
      ]),
      {
        caption: {
          what: "The glyph slot at its four widths: an icon, one letter, two letters, and none. It is the field's label *and* its scrub grip.",
        },
      }
    ),
};

/**
 * Values that are not numbers, and numbers that are not px.
 *
 * A length field accepts a bare word from its own `keywords` list and any unit
 * from `units`; `%`, `rem`, `vh` and `auto` all have to sit in the same slot
 * without the value colliding with the suffix or the glyph.
 */
export const ValueShapes: StoryObj = {
  render: () => {
    const spec: NumSpec = {
      glyph: "W",
      keywords: ["auto", "max-content", "min-content", "fit-content"],
      label: "Width",
      unit: "px",
      units: [...LENGTH_UNITS],
    };
    return stage(
      inspectorBody([
        section(
          "Lengths",
          grid([
            field(spec, "240px"),
            field(spec, "100%"),
            field(spec, "12.5rem"),
            field(spec, "50vh"),
            field(spec, "auto"),
            field(spec, "max-content"),
            field(spec, "calc(100% - 32px)"),
            field(spec, ""),
          ])
        ),
        section(
          "Suffixes and unitless",
          grid([
            field({ glyph: "opacity", label: "Opacity", suffix: "%" }, "60"),
            field({ glyph: "Z", integer: true, label: "Z", unit: "" }, "10"),
            field(
              { glyph: "rotate", label: "Rotation", suffix: "°", unit: "deg" },
              "45"
            ),
            field({ label: "Line height", unit: "" }, "1.5"),
          ])
        ),
      ]),
      {
        caption: {
          what: "Values that are not plain px — keywords, percentages, rem, calc, suffixes and unitless — all sharing one slot.",
        },
      }
    );
  },
};

/**
 * The three ways a field refuses to be edited, side by side.
 *
 * They look alike and are not alike. `setToken` swaps what the field *reads* for
 * a token name while keeping its chrome — the whole point of `TokenSlot`, which
 * exists because an earlier version replaced the control outright and made
 * binding a property visibly restructure its row. `setLocked` keeps the number
 * and refuses the edit, including the arrow keys and the scrub grip, which
 * `readOnly` alone did not. `placeholder` is the third: no value at all, where
 * the absence means something.
 */
export const Refusals: StoryObj = {
  render: () => {
    const spec: NumSpec = { glyph: "W", label: "Width", unit: "px" };

    const bound = createNumField(spec, "240px", noop);
    bound.setToken("size-6");

    const longBound = createNumField(spec, "240px", noop);
    longBound.setToken("spacing-container-gutter-large");

    const locked = createNumField(spec, "240px", noop);
    locked.setLocked(true);

    const empty = createNumField({ ...spec, placeholder: "Mixed" }, "", noop);

    for (const handle of [bound, longBound, locked, empty]) {
      handle.element.classList.add(cls("cell"));
    }

    return stage(
      inspectorBody([
        section(
          "Bound, locked, empty",
          grid([
            labelled("Token", bound.element),
            labelled("Long name", longBound.element),
            labelled("Locked", locked.element),
            labelled("Mixed", empty.element),
          ])
        ),
      ]),
      {
        caption: {
          what: "The three ways a field declines to be edited. They look alike and mean different things: bound, locked, and empty.",
        },
      }
    );
  },
};

/**
 * Bounds, from a real descriptor.
 *
 * `specOf` derives the spec from the descriptor, and `min: 0` is load-bearing
 * beyond clamping: a field that cannot go negative refuses the minus key
 * outright, because offering an edit that will be silently clamped away is
 * worse than refusing it.
 */
export const Bounded: StoryObj = {
  render: () => {
    const opacity = APPEARANCE_GROUP.descriptors.find(
      (d) => d.cssProperty === "opacity"
    );
    if (!opacity) {
      throw new Error("No opacity descriptor");
    }
    return stage(
      inspectorBody([
        section(
          "Bounded",
          grid([
            field(specOf(opacity), "1"),
            field({ label: "Unbounded", unit: "px" }, "-40"),
          ])
        ),
      ]),
      {
        caption: {
          what: "`min: 0` from a real descriptor, which refuses the minus key outright rather than accepting an edit it would silently clamp.",
        },
      }
    );
  },
};

/**
 * The plain text field, for the HTML attributes the inspector also edits.
 *
 * `createTextField` shares `num-field`'s chrome and none of its behaviour — no
 * units, no scrub, no stepping. It is here because it sits next to number fields
 * in the Media section and has to look like it belongs.
 */
export const TextFields: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Attributes",
          grid([
            labelled(
              "Alt",
              createTextField({
                label: "Alt text",
                placeholder: "Describe the image",
              }).element
            ),
            labelled(
              "Poster",
              createTextField({ label: "Poster", placeholder: "URL" }).element
            ),
          ])
        ),
      ]),
      {
        caption: {
          what: "The plain text field, which shares the number field's chrome and none of its behaviour. It has to look like it belongs beside one.",
        },
      }
    ),
};
