import type { Meta, StoryObj } from "@storybook/html-vite";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import {
  type Descriptor,
  FONT_VARIANT,
  GRID_AUTO_FLOW,
  LAYOUT_GROUP,
  POSITION_MODE,
  STROKE_STYLE,
} from "../descriptors";
import { enumDescriptor, labelled } from "../sections/row";
import { createSelect } from "./select";

/*
 * The dropdown — the control for properties whose values are words.
 *
 * The rule this control exists to serve is stated in `select.ts` itself and is
 * worth checking rather than trusting: five word-labelled options wrap onto two
 * rows as a segmented group in a 360px rail, and a control that reflows as you
 * resize the dock reads as a bug. So `display`, `position`, `border-style`,
 * `grid-auto-flow` and `font-variant` are selects, and their glyph-labelled
 * neighbours are not.
 *
 * The trigger is worth a look on its own. It claims `aria-haspopup="menu"`,
 * matching what `popover-host` actually renders — an earlier version claimed
 * `listbox` while opening a `role="menu"`, so the promise made to a screen
 * reader was contradicted by the thing it opened. The current value is announced
 * through `aria-label` rather than a tooltip, because a select in a labelled row
 * already shows its value and the tooltip repeated the word two inches to its
 * left.
 *
 * The menu is built lazily on open, so the check mark cannot freeze at the value
 * the control had when it was constructed. `Open` below is the story that shows
 * it, and it is also what proves the popover host is parented inside
 * `#__airship-root` — an unstyled menu means `preview.ts` lost that fight.
 */

const meta: Meta = {
  title: "Inspector/Controls/Select",
};

export default meta;

function select(descriptor: Descriptor, value: string): HTMLElement {
  return labelled(
    descriptor.label,
    createSelect(descriptor, value, noop).element
  );
}

const DISPLAY = LAYOUT_GROUP.descriptors.find(
  (d) => d.cssProperty === "display"
) as Descriptor;

/** Every select in the inspector, at a representative value. */
export const Gallery: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Layout",
          grid([select(DISPLAY, "flex"), select(GRID_AUTO_FLOW, "row dense")])
        ),
        section(
          "Position and stroke",
          grid([
            select(POSITION_MODE, "absolute"),
            select(STROKE_STYLE, "dashed"),
          ])
        ),
        section("Text", grid([select(FONT_VARIANT, "small-caps")])),
      ]),
      {
        caption: {
          what: "Every select in the inspector. These are selects rather than segmented groups because their options are words and there are too many.",
        },
      }
    ),
};

/**
 * The same control at each of one descriptor's values.
 *
 * The trigger shows the option's *label*, not the CSS value — "Inline" for
 * `inline-flex` — so this is the check that the two never drift apart. A
 * descriptor with a value absent from `enumValues` falls back to showing the raw
 * value, which is the last row here.
 */
export const EveryValue: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Display",
          grid([
            ...(DISPLAY.enumValues ?? []).map((option) =>
              labelled(
                option.label,
                createSelect(DISPLAY, option.value, noop).element
              )
            ),
            labelled(
              "Unlisted",
              createSelect(DISPLAY, "table-row-group", noop).element
            ),
          ])
        ),
      ]),
      {
        caption: {
          what: "One descriptor at each of its values. The trigger shows the option's *label*, not the CSS value, and the last row is a value the table does not list.",
        },
      }
    ),
};

/**
 * The menu, open.
 *
 * Opened in a `play` function rather than at render, because `createMenu` builds
 * its contents on open by design. This is the story that proves the popover host
 * is inside `#__airship-root`: mounted anywhere else, the menu still opens and
 * still works, and every `var(--ap-*)` in `pop.css.ts` is dropped as
 * invalid-at-computed-value-time — so it appears as unstyled black text on
 * white, in the middle of an otherwise correct dock.
 */
export const Open: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(".__airship-select")?.click();
  },
  render: () =>
    stage(
      inspectorBody([section("Display", grid([select(DISPLAY, "flex")]))]),
      {
        caption: {
          try: "if this is unstyled black-on-white, the popover host is outside `#__airship-root` and every `var(--ap-*)` in it was dropped",
          what: "The menu, opened in a `play` because `createMenu` builds its contents on open.",
        },
      }
    ),
};

/**
 * A select built by `enumDescriptor` rather than from the static table.
 *
 * The sections use it for the enums that are local to one section and not worth
 * a top-level descriptor. Same control, so this is really a check that the
 * helper's defaults — `span: "full"`, `controlType: "select"` — still match what
 * the table produces.
 */
export const FromHelper: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Ad hoc",
          grid([
            select(
              enumDescriptor(
                "objectFit",
                "object-fit",
                "Fit",
                [
                  { label: "Fill", value: "fill" },
                  { label: "Contain", value: "contain" },
                  { label: "Cover", value: "cover" },
                  { label: "None", value: "none" },
                  { label: "Scale down", value: "scale-down" },
                ],
                "fill"
              ),
              "cover"
            ),
          ])
        ),
      ]),
      {
        caption: {
          what: "A select built by `enumDescriptor` rather than the static table — really a check that the helper's defaults still match.",
        },
      }
    ),
};
