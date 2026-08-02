import type { Meta, StoryObj } from "@storybook/html-vite";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import {
  ALIGN_ITEMS_GRID,
  CONSTRAIN_H,
  CONSTRAIN_V,
  type Descriptor,
  FLEX_DIRECTION,
  FONT_OPTICAL_SIZING,
  JUSTIFY_ITEMS,
  STROKE_POSITION,
  TEXT_CASE,
  VERTICAL_ALIGN,
} from "../descriptors";
import { labelled } from "../sections/row";
import { createSegmented } from "./segmented";

/*
 * Segmented groups — the row-of-cells control.
 *
 * `createSegmented` branches on whether *every* option carries an icon
 * (`allIcons`), and the two branches are different controls to look at: a row of
 * glyphs reads as one object, a row of words reads as a list. Which one a new
 * group should be is a judgement you can only make by seeing both at the width
 * they actually get, which is what these stories are for. `select.ts` states the
 * rule this control lives under — five word options wrap onto two rows in this
 * rail, and a control that reflows as you resize the dock reads as a bug — and
 * the `Narrow` story is where you check it still holds.
 *
 * Only genuinely segmented descriptors appear here. Several neighbouring
 * properties that look like they should be — `grid-auto-flow`, `position`,
 * `border-style` — are `select`s precisely because their options are words and
 * there are too many of them; they live in the Select stories.
 */

const meta: Meta = {
  title: "Inspector/Controls/Segmented",
};

export default meta;

/** One group in a full-width labelled row, as the sections build them. */
function group(descriptor: Descriptor, value: string): HTMLElement {
  return labelled(
    descriptor.label,
    createSegmented(descriptor, value, noop).element
  );
}

/**
 * The direction group at its default — the canonical case.
 *
 * Three glyphs and a label in a 360px rail, which is the shape the control was
 * designed around.
 */
export const Direction: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section("Auto layout", grid([group(FLEX_DIRECTION, "row")])),
      ]),
      {
        caption: {
          what: "The canonical case: three glyphs and a label in a 360px rail.",
        },
      }
    ),
};

/**
 * Every segmented group the inspector builds, glyph groups above word groups.
 *
 * The comparison no single story can make. Three, four and five cells all
 * appear here: the constraint groups are the widest the control ever gets, and
 * they are the ones to watch when a label grows.
 */
export const Gallery: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Glyph groups",
          grid([
            group(FLEX_DIRECTION, "row"),
            group(VERTICAL_ALIGN, "center"),
            group(JUSTIFY_ITEMS, "center"),
            group(ALIGN_ITEMS_GRID, "center"),
            group(TEXT_CASE, "uppercase"),
          ])
        ),
        section(
          "Five cells",
          grid([group(CONSTRAIN_H, "stretch"), group(CONSTRAIN_V, "start")])
        ),
        section(
          "Word groups",
          grid([
            group(STROKE_POSITION, "center"),
            group(FONT_OPTICAL_SIZING, "auto"),
          ])
        ),
      ]),
      {
        caption: {
          what: "Every segmented group the inspector builds, glyph groups above word groups — the comparison no single story can make.",
        },
      }
    ),
};

/**
 * One group with each of its cells selected in turn.
 *
 * `setActive` toggles `aria-pressed` alongside the lit class, so a screen reader
 * hears "Left, Constrain horizontally, pressed". Stacking the states is the
 * quickest way to check the lit cell stays legible at both ends of the group,
 * where it meets the group's own border radius, as well as in the middle.
 */
export const EveryState: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Constrain horizontally",
          grid(
            (CONSTRAIN_H.enumValues ?? []).map((option) =>
              labelled(
                option.label,
                createSegmented(CONSTRAIN_H, option.value, noop).element
              )
            )
          )
        ),
      ]),
      {
        caption: {
          what: "One group with each cell lit in turn, so the lit state can be checked at both ends of the group as well as the middle.",
        },
      }
    ),
};

/**
 * The same groups in the narrowest dock the app allows.
 *
 * 280px is `MIN_DOCK_W` in `app.ts` — the floor the splitter clamps to. A
 * five-cell glyph group beside its own label is the tightest thing in the
 * inspector, so if anything is going to elide or wrap it does so here and
 * nowhere else.
 */
export const Narrow: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "At MIN_DOCK_W",
          grid([
            group(CONSTRAIN_H, "stretch"),
            group(FLEX_DIRECTION, "column"),
            group(STROKE_POSITION, "outside"),
          ])
        ),
      ]),
      {
        caption: {
          what: "`MIN_DOCK_W`: a five-cell glyph group beside its own label is the tightest arrangement in the inspector.",
        },
        narrow: true,
      }
    ),
};
