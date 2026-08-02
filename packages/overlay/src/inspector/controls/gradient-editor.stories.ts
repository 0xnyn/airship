import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../../dom";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { BRAND } from "../../stories/fixtures";
import { labelled } from "../sections/row";
import { canEditGradient, openGradientEditor } from "./gradient-editor";

/*
 * The gradient editor — a popover over a popover.
 *
 * It opens from a fill row's swatch, and opening a stop's colour opens the
 * colour picker *on top of it*. That stack is why `closeOpenPopover` closes the
 * whole thing rather than the top of it, and why `closeGradientEditor` exists as
 * its own export.
 *
 * `canEditGradient` is the gate: a value this editor cannot round-trip must not
 * open it, because opening and then silently rewriting the gradient into
 * something simpler is worse than declining. The `Editable` story is that
 * predicate run over a spread of real gradient syntaxes, which is a more useful
 * thing to see than any single editor screenshot — it is the list of what the
 * control claims to handle.
 */

const meta: Meta = {
  title: "Inspector/Controls/Gradient",
};

export default meta;

const GRADIENTS = [
  `linear-gradient(${BRAND}, #2ECC71)`,
  `linear-gradient(90deg, ${BRAND} 0%, #2ECC71 100%)`,
  "linear-gradient(to bottom right, #FF4D4F, #F5C84C 40%, #2ECC71)",
  "linear-gradient(180deg, rgb(13 153 255 / 0.8) 0%, transparent 100%)",
  `radial-gradient(circle, ${BRAND}, #00355F)`,
  "conic-gradient(from 90deg, #FF4D4F, #F5C84C, #2ECC71, #FF4D4F)",
  "repeating-linear-gradient(45deg, #313131 0 8px, #242424 8px 16px)",
  BRAND,
  "none",
];

/** A swatch painted with the gradient, which is how the fill row shows one. */
function swatch(value: string): HTMLElement {
  return el("button", {
    class: cls("ctl-swatch"),
    style: `background-image: ${value};`,
    type: "button",
  });
}

/**
 * What `canEditGradient` accepts, over the syntaxes a real stylesheet contains.
 *
 * A row marked "no" is not a bug — it is the editor correctly declining a value
 * it could not put back unchanged. The fill row falls through to the plain
 * colour picker or to the CSS tab for those.
 */
export const Editable: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "canEditGradient",
          el(
            "div",
            { style: "display: grid; gap: 8px;" },
            GRADIENTS.map((value) =>
              el(
                "div",
                {
                  style:
                    "display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center;",
                },
                [
                  swatch(value),
                  el("span", {
                    style:
                      "font: 400 10px var(--ap-font-mono); opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
                    text: value,
                  }),
                  el("span", {
                    style: `font: 400 10px var(--ap-font-mono); color: ${
                      canEditGradient(value)
                        ? "var(--ap-semantic-success)"
                        : "var(--ap-text-tertiary)"
                    };`,
                    text: canEditGradient(value) ? "yes" : "no",
                  }),
                ]
              )
            )
          )
        ),
      ]),
      {
        caption: {
          what: "`canEditGradient` run over the syntaxes a real stylesheet contains. A “no” is the editor declining a value it could not put back unchanged.",
        },
      }
    ),
};

/**
 * The editor, open on a three-stop gradient.
 *
 * Three stops rather than two on purpose: the middle one is draggable along the
 * ramp and is the only way to see that a stop's position and its colour are two
 * separate edits.
 */
export const Open: StoryObj = {
  render: () => {
    const anchor = swatch(GRADIENTS[2]);
    const node = stage(
      inspectorBody([section("Fill", grid([labelled("Gradient", anchor)]))]),
      {
        caption: {
          try: "open a stop's colour — the picker stacks on top, which is why `closeOpenPopover` closes the whole stack at once",
          what: "The editor on a three-stop gradient. Three rather than two, because only a middle stop shows that position and colour are separate edits.",
        },
      }
    );
    // Opened after the anchor is in the document: the popover positions itself
    // against a measured rect, and a detached anchor measures as all zeros.
    queueMicrotask(() => {
      openGradientEditor(anchor, {
        onChange: () => undefined,
        value: GRADIENTS[2],
      });
    });
    return node;
  },
};
