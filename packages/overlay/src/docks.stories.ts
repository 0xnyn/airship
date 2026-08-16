import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el, PREFIX } from "./dom";
import { dock, inspectorBody, plainStage } from "./stories/chrome";
import { MIN_DOCK_H, MIN_DOCK_W } from "./styles/const";

/*
 * The docks, and the two axes they can be sized on.
 *
 * Both panels resized in width and only in width, from a splitter on the inner
 * edge, and "Reset width" put that one number back. Height was half built: a
 * *floating* panel's height was written at tear-off, clamped, persisted and
 * restored, and nothing could change it; a *docked* panel had no height at all,
 * being anchored `top` and `bottom` with no `height` between them.
 *
 * So there are two shapes here, and the difference between them is the whole
 * design. Unpinned, a docked panel fills its edge and re-fits a resized window
 * with no JS at all. Pinned, it drops the `bottom` anchor and takes
 * `--*-h`. That is also why the reset *removes* the pin rather than replacing
 * it with a number: "the edge" is a fact about the window, and a literal for it
 * would be stale the moment the window changed size.
 */

const meta: Meta = {
  title: "Chrome/Docks",
};

export default meta;

/** Enough rows to give the panel something to be a height *of*. */
function filler(rows: number): HTMLElement {
  return inspectorBody(
    Array.from({ length: rows }, (_, i) =>
      el("div", { class: cls("sect") }, [
        el("div", { class: cls("sect-head") }, [
          el("span", { class: cls("sect-title"), text: `Section ${i + 1}` }),
        ]),
      ])
    )
  );
}

/**
 * Unpinned and pinned, side by side.
 *
 * The left panel has no height of its own and runs the full stage; the right one
 * carries `.dock-h` and stops where it was dragged to. Both carry the two
 * splitters, which is the only place in the catalogue you can see them: they are
 * 7px transparent strips that show a 2px hairline on hover and nothing
 * otherwise, which is why both resize gestures shipped undocumented until
 * `keys/catalog.ts` grew rows for them.
 */
export const Resizing: StoryObj = {
  play: ({ canvasElement }) => {
    const docks = [
      ...canvasElement.querySelectorAll<HTMLElement>("[data-story-dock]"),
    ];
    if (docks.length !== 2) {
      throw new Error(
        `Expected two docks in the stage, found ${docks.length}.`
      );
    }
    const [filling, pinned] = docks;

    /*
     * What is asserted, and what deliberately is not.
     *
     * `stories/chrome.ts` neutralises `position` and `inset` on
     * `[data-story-dock]` so a dock can sit in a story stage rather than pinned
     * to the viewport. That takes the *edge-filling* half of the design out of
     * reach here — neither of these has an edge to fill, so comparing their
     * heights would only be measuring how tall eight section headers happen to
     * be, and it would flip the day somebody changed the filler. Better stated
     * than faked; the real anchoring is `app.ts`'s business and
     * `dock-size.test.ts` covers the state that drives it.
     *
     * What this can prove is the *branch*, which is what the `h: 0` sentinel
     * exists to keep honest: pinned carries `.dock-h` and is exactly its
     * `--*-h`, unpinned carries neither and is sized by its content.
     */
    if (!pinned.classList.contains(cls("dock-h"))) {
      throw new Error("The pinned dock is missing `.dock-h`.");
    }
    if (pinned.offsetHeight !== 260) {
      throw new Error(
        `A pinned dock should be exactly its --*-h, but it is ${pinned.offsetHeight}px.`
      );
    }
    if (filling.classList.contains(cls("dock-h"))) {
      throw new Error("The unpinned dock should not carry `.dock-h`.");
    }
    if (filling.style.getPropertyValue(`--${PREFIX}-right-h`) !== "") {
      throw new Error(
        "The unpinned dock published a height it has no rule to read."
      );
    }

    // Both strips are present and neither is lying across the panel. The bottom
    // one resets `top` and `width`, which `.splitter` sets — without that it
    // would be a 7px full-height column eating clicks down the panel's left
    // edge, and it would still look correct in a screenshot.
    for (const node of docks) {
      const bottom = node.querySelector<HTMLElement>(
        `.${cls("splitter-bottom")}`
      );
      if (!bottom) {
        throw new Error("No bottom splitter on the dock.");
      }
      if (bottom.offsetHeight !== 7) {
        throw new Error(
          `The bottom splitter is ${bottom.offsetHeight}px tall, not 7 — it is ` +
            "still taking `.splitter`'s `top: 0; bottom: 0`."
        );
      }
      if (bottom.offsetWidth < node.offsetWidth - 2) {
        throw new Error(
          "The bottom splitter does not span the dock — it is still 7px wide."
        );
      }
    }
  },
  render: () =>
    plainStage(
      [
        dock(filler(8), { label: "Fills its edge", splitters: true }),
        dock(filler(8), {
          height: 260,
          label: "Pinned height",
          splitters: true,
          width: 300,
        }),
      ],
      {
        try: "hover each edge — the inner strip is width, the bottom one is height, and a double-click on either resets both",
        what: "A docked panel with no height of its own, beside one whose bottom edge has been dragged.",
      }
    ),
};

/**
 * The floors, on both axes.
 *
 * `MIN_DOCK_W` is what a splitter clamps to and `MIN_DOCK_H` is its twin, and
 * both live in `styles/const.ts` rather than in `app.ts` so the stylesheet, the
 * clamp and this story cannot disagree about them. There is deliberately no
 * `MAX_DOCK_H` to match `MAX_DOCK_W`: half the viewport is a sensible ceiling
 * for a side column's width and a nonsense one for its height.
 */
export const AtTheFloor: StoryObj = {
  render: () =>
    plainStage(
      [
        dock(inspectorBody([]), {
          height: MIN_DOCK_H,
          label: "Smallest",
          narrow: true,
        }),
      ],
      {
        what: `The narrowest and shortest a panel can be dragged — ${MIN_DOCK_W} × ${MIN_DOCK_H}. Below either it is a title bar with a sliver under it.`,
      }
    ),
};
