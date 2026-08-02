import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../../dom";
import { inspectorBody, section, stage } from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import { SPACING_GROUP } from "../descriptors";
import { createCorners } from "./corners";
import { createPadding, type PaddingSpec } from "./padding";
import type { ControlHandle } from "./types";

/*
 * The paired-or-four controls: padding, margin and corner radius.
 *
 * All three are the same idea — one value that is really four, with a switch —
 * and all three open split automatically when the four already disagree.
 * `createQuadField`'s comment says why that has to be automatic: a collapsed
 * field showing one of four values would silently flatten the other three on
 * first edit.
 *
 * The split geometry is the thing to look at. Four fields cannot be a 2×2 inside
 * a half-width grid cell — the stylesheet's note works it out: Appearance would
 * need a 424px dock before each field cleared its own floor — so a split quad is
 * promoted to the full row. That promotion is invisible until you see collapsed
 * and split side by side, which is what these stories arrange.
 *
 * Margin carries `signed: true` and padding does not, because a negative margin
 * is a technique and a negative padding is a typo. The `Signed` story is the two
 * together, which is the only way to see that the minus key is accepted by one
 * and refused by the other.
 */

const meta: Meta = {
  title: "Inspector/Controls/Box model",
};

export default meta;

const SIDES = (group: "padding" | "margin") =>
  SPACING_GROUP.descriptors.filter((d) => d.compoundGroup === group);

/** `DesignPanel.spacingControl`'s spec, minus the panel. */
function spacingSpec(group: "padding" | "margin"): PaddingSpec {
  const padding = group === "padding";
  return {
    collapsed: padding
      ? { h: "pad-h", v: "pad-v" }
      : { h: "gap-h", v: "gap-v" },
    descriptors: SIDES(group),
    noun: group,
    signed: !padding,
    toggle: { glyph: "pad-individual", label: `Independent ${group}` },
  };
}

function spacing(
  group: "padding" | "margin",
  values: Record<string, string>
): ControlHandle {
  return createPadding(
    spacingSpec(group),
    new Map(Object.entries(values)),
    noop
  );
}

/** A labelled group row, as `renderSpacing` builds one. */
function groupRow(label: string, control: ControlHandle): HTMLElement {
  return el("div", { class: `${cls("row")} ${cls("group")}` }, [
    el("span", { class: cls("row-label"), text: label }),
    control.element,
  ]);
}

const even = (prefix: string, value: string) => ({
  [`${prefix}-bottom`]: value,
  [`${prefix}-left`]: value,
  [`${prefix}-right`]: value,
  [`${prefix}-top`]: value,
});

/**
 * Collapsed and split, one above the other.
 *
 * The top row's four sides agree, so it renders as a horizontal/vertical pair
 * with the switch beside it. The bottom row's do not, so the control opens split
 * on its own and takes the whole row for it.
 */
export const PaddingModes: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Agreeing",
          groupRow("Padding", spacing("padding", even("padding", "16px")))
        ),
        section(
          "Pairs",
          groupRow(
            "Padding",
            spacing("padding", {
              "padding-bottom": "8px",
              "padding-left": "24px",
              "padding-right": "24px",
              "padding-top": "8px",
            })
          )
        ),
        section(
          "All four different",
          groupRow(
            "Padding",
            spacing("padding", {
              "padding-bottom": "12px",
              "padding-left": "4px",
              "padding-right": "32px",
              "padding-top": "8px",
            })
          )
        ),
      ]),
      {
        caption: {
          try: "compare the three rows — the split one is promoted to full width, which is invisible until you see it beside a collapsed one",
          what: "Agreeing, paired and all-four-different, stacked. A quad opens split by itself when the sides disagree, and takes the whole row when it does.",
        },
      }
    ),
};

/**
 * Padding beside margin — the signed and unsigned cases together.
 *
 * The margin row holds a negative value, which is the state padding refuses to
 * reach. Same control, two vocabularies.
 */
export const Signed: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Spacing",
          el("div", {}, [
            groupRow("Padding", spacing("padding", even("padding", "16px"))),
            groupRow(
              "Margin",
              spacing("margin", {
                "margin-bottom": "0px",
                "margin-left": "auto",
                "margin-right": "auto",
                "margin-top": "-8px",
              })
            ),
          ])
        ),
      ]),
      {
        caption: {
          what: "Padding beside margin. Same control, two vocabularies: a negative margin is a technique, a negative padding is a typo.",
        },
      }
    ),
};

/**
 * Corner radius, which is `createQuadField` under another name.
 *
 * Three states: uniform, a pill (`9999px`, where the number is longer than the
 * slot), and four independent corners — the last being the case that has to take
 * the whole row.
 */
export const Corners: StoryObj = {
  render: () => {
    const corners = (values: Record<string, string>) =>
      createCorners(new Map(Object.entries(values)), noop).element;
    const all = (v: string) => ({
      "border-bottom-left-radius": v,
      "border-bottom-right-radius": v,
      "border-top-left-radius": v,
      "border-top-right-radius": v,
    });
    return stage(
      inspectorBody([
        section("Uniform", corners(all("8px"))),
        section("Pill", corners(all("9999px"))),
        section(
          "Independent",
          corners({
            "border-bottom-left-radius": "0px",
            "border-bottom-right-radius": "24px",
            "border-top-left-radius": "12px",
            "border-top-right-radius": "4px",
          })
        ),
      ]),
      {
        caption: {
          what: "Corner radius, which is the same quad field again — uniform, a pill, and four independent corners.",
        },
      }
    );
  },
};

/**
 * The narrow dock, where the split view is under the most pressure.
 *
 * Four fields across 280px minus the section's own inset. `.pad-fields` takes
 * `auto-fit` rather than the grid's `auto-fill` precisely so it can collapse
 * here instead of overflowing.
 */
export const Narrow: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Padding",
          groupRow(
            "Padding",
            spacing("padding", {
              "padding-bottom": "12px",
              "padding-left": "4px",
              "padding-right": "32px",
              "padding-top": "8px",
            })
          )
        ),
      ]),
      {
        caption: {
          what: "Four fields at `MIN_DOCK_W`, which is why `.pad-fields` uses `auto-fit` and the surrounding grid uses `auto-fill`.",
        },
        narrow: true,
      }
    ),
};
