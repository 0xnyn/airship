import type { Meta, StoryObj } from "@storybook/html-vite";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { BRAND, noop } from "../../stories/fixtures";
import { labelled } from "../sections/row";
import { createColorRow } from "./color-picker";

/*
 * The colour row, and the picker behind its swatch.
 *
 * `[swatch][hex][alpha %]` — and the alpha is the *paint's* alpha, not the
 * element's `opacity`. That distinction is the whole design of this control:
 * A design tool's fill opacity fades one paint, while `opacity` fades the element and
 * everything inside it, and `rgb(r g b / a)` is the exact equivalent of the
 * former. A row showing 40% is telling you about the colour, not the layer.
 *
 * Worth looking at here rather than in the running editor:
 *
 * - **Every input syntax in one column.** `parseColor` accepts hex, `rgb()`,
 *   modern slash-alpha, `hsl()`, named colours and `transparent`, and they all
 *   have to normalise into the same six-character slot without the hex and the
 *   percentage colliding.
 * - **The picker itself**, which is a popover. `Open` is the story that proves
 *   it inherits the token scope — see the note on the Select stories.
 * - **A bound row**, where the hex is replaced by a token name and the alpha is
 *   locked but still readable. `NumHandle.setLocked`'s comment explains why the
 *   two are different affordances: the percentage remains a true fact about the
 *   paint, so a token name in its place would say less.
 */

const meta: Meta = {
  title: "Inspector/Controls/Colour",
};

export default meta;

function row(label: string, value: string): HTMLElement {
  return labelled(
    label,
    createColorRow({ onChange: noop, tip: label, value }).element
  );
}

/** Colour syntaxes, all normalising into the same slot. */
export const Syntaxes: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Opaque",
          grid([
            row("Hex", BRAND),
            row("Hex short", "#f0a"),
            row("rgb()", "rgb(46, 204, 113)"),
            row("hsl()", "hsl(280 70% 55%)"),
            row("Named", "rebeccapurple"),
          ])
        ),
        section(
          "With alpha",
          grid([
            row("Hex 8", `${BRAND}80`),
            row("Slash alpha", "rgb(255 77 79 / 0.4)"),
            row("rgba()", "rgba(0, 0, 0, 0.06)"),
            row("Transparent", "transparent"),
          ])
        ),
      ]),
      {
        caption: {
          what: "Every syntax `parseColor` accepts, all normalising into the same six-character slot.",
        },
      }
    ),
};

/**
 * The alpha ramp, so the swatch's checkerboard can be judged.
 *
 * A translucent swatch has to read as translucent rather than as a lighter
 * colour, which is what the chequer behind it is for. At 4% — the value the
 * subtle border tokens use — that is a genuinely hard thing to draw.
 */
export const Alpha: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Alpha",
          grid(
            [100, 80, 60, 40, 20, 8, 4, 0].map((pct) =>
              row(`${pct}%`, `rgb(13 153 255 / ${pct / 100})`)
            )
          )
        ),
      ]),
      {
        caption: {
          try: "compare 8% and 4% — the subtle border tokens live down there",
          what: "The alpha ramp down to 4%, which is where the swatch's chequer has to work hardest to read as translucent rather than pale.",
        },
      }
    ),
};

/**
 * A row bound to a design token.
 *
 * The swatch still shows the resolved colour — the binding changes where the
 * value comes from, not what it is — while the hex slot shows the token's short
 * name and the alpha is locked. The row keeps its shape throughout, which is the
 * rule `TokenSlot` was written to enforce.
 */
export const Bound: StoryObj = {
  render: () => {
    const handle = createColorRow({
      onChange: noop,
      tip: "Fill",
      value: BRAND,
    });
    handle.setToken("brand-primary");

    const long = createColorRow({
      onChange: noop,
      tip: "Fill",
      value: "#2ECC71",
    });
    long.setToken("semantic-success-background-subtle");

    return stage(
      inspectorBody([
        section(
          "Bound",
          grid([
            labelled("Token", handle.element),
            labelled("Long name", long.element),
            row("Literal", BRAND),
          ])
        ),
      ]),
      {
        caption: {
          what: "A bound row: the swatch still shows the resolved colour, the hex slot shows the token, and the alpha is locked but readable.",
        },
      }
    );
  },
};

/**
 * The picker, open.
 *
 * HSV area, hue and alpha sliders, a mode cycle across hex/rgb/hsl, the recent
 * swatches, and the eyedropper where `EyeDropper` exists — which is a real
 * branch, so this story looks different in Firefox and that is correct rather
 * than broken.
 */
export const Open: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(".__airship-ctl-swatch")?.click();
  },
  render: () =>
    stage(inspectorBody([section("Fill", grid([row("Colour", BRAND)]))]), {
      caption: {
        try: "if the eyedropper is missing you are in Firefox, which has no `EyeDropper` — that is a real branch, not a broken story",
        what: "The picker itself — HSV area, hue and alpha sliders, the mode cycle, recent swatches.",
      },
    }),
};
