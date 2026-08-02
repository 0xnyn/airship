import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../../dom";
import { inspectorBody, section, stage } from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import { labelled } from "../sections/row";
import { createAlignPad } from "./align-pad";

/*
 * The 3×3 alignment pad, from Auto layout.
 *
 * Nine cells standing for a `justify-content` × `align-items` pair — and which
 * axis is which *depends on `flex-direction`*. `createAlignPad` takes
 * `getDirection` as a thunk rather than a value for exactly that reason: the
 * same pair of CSS values lands on a different cell in a row container than in a
 * column one, and the pad has to re-read the direction rather than cache it.
 *
 * That transposition is the whole story here. Row and column side by side, at
 * the same CSS values, is a comparison the running editor cannot show you — you
 * would have to flip the direction and remember what the previous one looked
 * like.
 *
 * The other case worth seeing is the one with no cell lit at all. `coords()`
 * returns `null` when either value is not one of the three simple positions —
 * `space-between` is the common one — because there is no cell in a 3×3 that
 * means "distribute the free space". Lighting the nearest one would be a lie
 * about what the element is doing.
 */

const meta: Meta = {
  title: "Inspector/Controls/Alignment pad",
};

export default meta;

const POSITIONS = ["flex-start", "center", "flex-end"] as const;

function pad(
  direction: "row" | "column",
  justify: string,
  align: string
): HTMLElement {
  return createAlignPad(() => direction, { align, justify }, noop).element;
}

/** A small caption under a pad, naming the CSS it stands for. */
function captioned(label: string, node: HTMLElement, css: string): HTMLElement {
  return el(
    "div",
    { style: "display: grid; gap: 6px; justify-items: start;" },
    [
      el("span", {
        style:
          "font: 400 10px var(--ap-font-sans); color: var(--ap-text-secondary);",
        text: label,
      }),
      node,
      el("span", {
        style:
          "font: 400 9px var(--ap-font-mono); color: var(--ap-text-tertiary);",
        text: css,
      }),
    ]
  );
}

/**
 * Every cell of the pad, in a row container.
 *
 * Nine pads, each lit at one position. In a `row` container `justify-content` is
 * the horizontal axis, so the pair reads in the order you would guess.
 */
export const EveryCell: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Row container",
          el(
            "div",
            {
              style:
                "display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;",
            },
            POSITIONS.flatMap((align) =>
              POSITIONS.map((justify) =>
                captioned(
                  "",
                  pad("row", justify, align),
                  `${justify.replace("flex-", "")} / ${align.replace("flex-", "")}`
                )
              )
            )
          )
        ),
      ]),
      {
        caption: {
          what: "All nine positions the pad can represent, in a row container, where `justify-content` is the horizontal axis.",
        },
      }
    ),
};

/**
 * The same three CSS pairs in a row container and a column container.
 *
 * The axes swap, so the lit cell moves. If these two columns ever agree, the
 * `getDirection` thunk has stopped being consulted.
 */
export const Transposed: StoryObj = {
  render: () => {
    const pairs: [string, string][] = [
      ["flex-start", "flex-end"],
      ["center", "flex-start"],
      ["flex-end", "center"],
    ];
    return stage(
      inspectorBody([
        section(
          "Row",
          el(
            "div",
            { style: "display: flex; gap: 16px;" },
            pairs.map(([justify, align]) =>
              captioned(
                "row",
                pad("row", justify, align),
                `${justify.replace("flex-", "")} / ${align.replace("flex-", "")}`
              )
            )
          )
        ),
        section(
          "Column",
          el(
            "div",
            { style: "display: flex; gap: 16px;" },
            pairs.map(([justify, align]) =>
              captioned(
                "column",
                pad("column", justify, align),
                `${justify.replace("flex-", "")} / ${align.replace("flex-", "")}`
              )
            )
          )
        ),
      ]),
      {
        caption: {
          try: "read across — the two rows are the same CSS at different directions, so if the lit cells ever agree the `getDirection` thunk has stopped being consulted",
          what: "Identical CSS pairs in a row container and a column container. The axes swap, so the lit cell moves.",
        },
      }
    );
  },
};

/**
 * Values with no cell to light.
 *
 * `space-between`, `space-around`, `stretch` and `baseline` are all legitimate
 * and none of them is a point in a 3×3. The pad shows nothing selected, which is
 * the honest answer; the value itself is still visible and editable in the CSS
 * tab.
 */
export const Unrepresentable: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "No cell means this",
          el(
            "div",
            { style: "display: flex; gap: 16px; flex-wrap: wrap;" },
            [
              ["space-between", "center"],
              ["space-around", "stretch"],
              ["center", "baseline"],
            ].map(([justify, align]) =>
              captioned("", pad("row", justify, align), `${justify} / ${align}`)
            )
          )
        ),
        section(
          "For comparison",
          labelled("Simple", pad("row", "center", "center"))
        ),
      ]),
      {
        caption: {
          what: "Legitimate values that are not points in a 3×3. Nothing is lit, which is the honest answer — `space-between` has no cell.",
        },
      }
    ),
};
