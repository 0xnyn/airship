import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../../dom";
import {
  type Caption,
  inspectorBody,
  section,
  stage,
} from "../../stories/chrome";
import { noop, withTokens } from "../../stories/fixtures";
import { STROKE_SIDES } from "../descriptors";
import { labelled } from "../sections/row";
import { createCorners } from "./corners";
import { createQuadField, type QuadSpec } from "./quad-field";
import { createTokenBadge } from "./token-field";

/*
 * One value, with a switch to four.
 *
 * `box-model.stories` covers `createPadding`, which is a third instance of this
 * idea with enough of its own behaviour — the horizontal/vertical pairing — to
 * be a separate module. This file is the primitive underneath corner radius and
 * per-side stroke width, and the two behaviours worth seeing here are both about
 * *when the control changes shape by itself*.
 *
 * **It opens split when the sides already disagree.** Not as a nicety: a
 * collapsed field can only show one of four values, so a control that opened
 * collapsed over `4px 12px 4px 0` would display `4px` and silently flatten the
 * other three on the first edit.
 *
 * **It changes mode under `setValue` — but not mid-gesture.** `modeStillFits`
 * decides, and the guard above it is the interesting part: an incoming value
 * identical to the one already held returns early, because scrubbing Top until
 * it happens to equal Bottom used to collapse the four-side view *during the
 * drag* and destroy the `NumHandle` being dragged.
 */

const meta: Meta = {
  title: "Inspector/Controls/Quad field",
};

export default meta;

const RADIUS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
];

const uniform = (value: string) =>
  new Map(RADIUS.map((property) => [property, value]));

function corners(values: Map<string, string>, caption: Caption): HTMLElement {
  return stage(
    inspectorBody([
      section(
        "Appearance",
        labelled("Radius", createCorners(values, noop).element)
      ),
    ]),
    { caption }
  );
}

/** Four sides agreeing, which is the resting shape. */
export const Collapsed: StoryObj = {
  render: () =>
    corners(uniform("8px"), {
      try: "press the mode toggle — it opens split, and the split view takes the whole row rather than trying to be a 2×2",
      what: "All four corners at 8px: one field, one toggle.",
    }),
};

/**
 * Sides that disagree at construction.
 *
 * The control opens split by itself and is promoted to the full row —
 * `data-mode="sides"` is how the stylesheet knows. Four fields cannot be a 2×2
 * inside a half-width grid cell: Appearance would need a 424px dock before each
 * one cleared its own floor.
 */
export const AutoSplit: StoryObj = {
  render: () =>
    corners(
      new Map([
        ["border-top-left-radius", "12px"],
        ["border-top-right-radius", "4px"],
        ["border-bottom-left-radius", "0px"],
        ["border-bottom-right-radius", "24px"],
      ]),
      {
        try: "compare the width with Collapsed above — the split view is promoted to the whole row, which the collapsed one never is",
        what: "Four corners that disagree. The control opens split rather than showing one value and flattening the rest.",
      }
    ),
};

/**
 * Bound to a design token.
 *
 * The field keeps its shape and the token replaces only what it *reads*. This
 * used to return the slot's element instead of the field when bound — left over
 * from a design where the slot was a pill carrying the name — so a bound corner
 * radius, padding, margin or stroke width rendered as a 20px ghost icon with no
 * value at all, and the field it replaced stayed built and registered against an
 * element nothing had appended.
 */
export const Bound: StoryObj = {
  render: () => {
    withTokens();
    // The panel builds these from the live registry; a story only needs the
    // three members the quad field actually reads — `element`, `label` and
    // `open` — and the rest answer honestly for a slot nothing will act on.
    const control = createCorners(uniform("8px"), noop, undefined, () => ({
      apply: noop,
      bound: true,
      element: createTokenBadge({
        current: {
          exact: true,
          kind: "css-var",
          name: "--pk-radius-md",
          via: "reference",
        },
        onApply: noop,
        onUnlink: noop,
        property: "border-top-left-radius",
      }) as HTMLElement,
      label: "radius-md",
      open: noop,
      unlink: noop,
    }));
    return stage(
      inspectorBody([
        section("Appearance", labelled("Radius", control.element)),
      ]),
      {
        caption: {
          what: "A bound radius: the badge sits beside the field, and the field still looks like a field.",
        },
      }
    );
  },
};

/**
 * The mode flipping under an external write.
 *
 * `setValue` is what a re-seed calls after an undo or an agent edit. Making the
 * four sides agree collapses the control; the story does it in `render` so the
 * result is the picture rather than the gesture.
 *
 * The `play` asserts the mode actually changed, because a control that failed to
 * collapse looks like a control that was simply built collapsed.
 */
export const ModeFlip: StoryObj = {
  play: ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(`.${cls("pad-row")}`);
    if (row?.dataset.mode !== "one") {
      throw new Error(
        `Expected data-mode="one" after the sides were made to agree, got ` +
          `"${row?.dataset.mode}". See modeStillFits in quad-field.ts.`
      );
    }
  },
  render: () => {
    const control = createCorners(
      new Map([
        ["border-top-left-radius", "12px"],
        ["border-top-right-radius", "4px"],
        ["border-bottom-left-radius", "0px"],
        ["border-bottom-right-radius", "24px"],
      ]),
      noop
    );
    // Built split, then told the sides agree — which is exactly the shape of an
    // undo landing on a control whose four values were last edited apart.
    for (const property of RADIUS) {
      control.setValue?.(property, "8px");
    }
    return stage(
      inspectorBody([
        section("Appearance", labelled("Radius", control.element)),
      ]),
      {
        caption: {
          what: "Built split, then handed four agreeing values. It collapses itself — which is what an undo looks like from in here.",
        },
      }
    );
  },
};

/**
 * The two instances side by side.
 *
 * Corner radius and stroke width are the same control with a different
 * vocabulary: the same mode toggle, in the same place, with the same glyph. Two
 * features sharing a shape is what makes a panel read as a system rather than a
 * pile of controls, and it is only checkable when they are adjacent.
 */
export const StrokeWidth: StoryObj = {
  render: () => {
    const spec: QuadSpec = {
      collapsed: { glyph: "stroke-width", label: "Stroke width" },
      sides: STROKE_SIDES.map((s) => ({
        glyph: s.icon,
        label: s.label,
        property: `border-${s.name}-width`,
      })),
      toggle: { glyph: "corners-independent", label: "Independent sides" },
    };
    const widths = createQuadField(
      spec,
      new Map(
        STROKE_SIDES.map((s) => [`border-${s.name}-width`, "1px"] as const)
      ),
      noop
    );
    return stage(
      inspectorBody([
        section("Stroke", labelled("Weight", widths.element)),
        section(
          "Appearance",
          labelled("Radius", createCorners(uniform("8px"), noop).element)
        ),
      ]),
      {
        caption: {
          try: "open both — same toggle, same position, same glyph, different nouns",
          what: "Stroke width above corner radius: two features that are one control.",
        },
      }
    );
  },
};
