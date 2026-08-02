import type { TokenRef } from "@airship/protocol";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { el } from "../../dom";
import { grid, inspectorBody, section, stage } from "../../stories/chrome";
import { noop, withTokens } from "../../stories/fixtures";
import { labelled } from "../sections/row";
import { createTokenBadge, shortName } from "./token-field";

/*
 * The design-token badge — the smallest control in the panel and the one
 * carrying the most design argument.
 *
 * It is 20px beside a field, and it is *always* beside the field rather than
 * instead of it. An earlier version returned a pill that stood in for the whole
 * control, which meant binding a property visibly restructured its row: a
 * different height, a different colour, and a grid where bound and unbound cells
 * no longer looked like the same kind of thing. The rule that replaced it is in
 * `TokenSlot`'s docstring — binding is a fact about where a value comes from,
 * not a different kind of control.
 *
 * Two states that read almost identically and are not the same claim:
 *
 * - **Lit** — there is a real binding. The value came from this token.
 * - **Unlit** — the value merely *equals* a token's. `createTokenBadge`'s
 *   comment: "a value that merely equals a token's is worth a tooltip, not a
 *   claim." Clicking such a row is how a coincidence becomes a binding.
 *
 * `createTokenBadge` returns `null` when the project declares no token that
 * could apply to the property, and the absence is the design: a badge on every
 * field would hide the one decision the affordance is asking about. The
 * `NoTokens` story is that case.
 */

const meta: Meta = {
  title: "Inspector/Controls/Token badge",
};

export default meta;

/**
 * A real reference: the element names the token outright. `via: "reference"` is
 * what makes "detach" meaningful — offering it against a mere value match asked
 * the user to unlink something they had never linked.
 */
const BOUND: TokenRef = {
  exact: true,
  kind: "css-var",
  name: "--pk-space-md",
  via: "reference",
};

/** A badge for one property, or a note saying the registry offered none. */
function badge(property: string, current?: TokenRef): HTMLElement {
  const node = createTokenBadge({
    current,
    onApply: noop,
    onUnlink: noop,
    property,
  });
  return (
    node ??
    el("span", {
      style: "font: 400 10px var(--ap-font-mono); opacity: .5;",
      text: "null — no tokens for this property",
    })
  );
}

/**
 * Bound, coincidental and absent, in that order.
 *
 * The three states the badge can be in, which in the running editor need three
 * different projects to see.
 */
export const States: StoryObj = {
  render: () => {
    withTokens();
    return stage(
      inspectorBody([
        section(
          "Badge states",
          grid([
            labelled("Bound", badge("padding-top", BOUND)),
            labelled("Equal, unbound", badge("padding-top")),
            labelled("No token for it", badge("z-index")),
          ])
        ),
      ]),
      {
        caption: {
          what: "Bound, coincidentally equal, and absent. Lit means a real binding; unlit means the value merely equals a token's.",
        },
      }
    );
  },
};

/**
 * The picker, open.
 *
 * One list, ordered by whether the token resolves on this element — a token out
 * of scope here is still a real token and still applies correctly, so it is
 * annotated rather than hidden. The bound row detaches; every other row applies.
 * Detach used to be a separate entry under a separator, which left the bound row
 * doing nothing at all.
 */
export const Picker: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(".__airship-token-badge")?.click();
  },
  render: () => {
    withTokens();
    return stage(
      inspectorBody([
        section("Padding", grid([labelled("Top", badge("padding-top"))])),
      ]),
      {
        caption: {
          what: "The picker: one list, ordered by whether the token resolves here. Out of scope is annotated rather than hidden, because it still applies correctly.",
        },
      }
    );
  },
};

/**
 * `shortName` against the names design systems actually produce.
 *
 * The badge and the bound field both show this, in a slot narrower than most of
 * these strings. Rendered as a table because the interesting thing is the rule
 * rather than any one result.
 */
export const ShortNames: StoryObj = {
  render: () => {
    const names = [
      "--pk-space-md",
      "--pk-gutter",
      "--pk-semantic-success-background-subtle",
      "--color-blue-600",
      "--radius",
      ".p-4",
      ".bg-slate-900",
    ];
    return stage(
      inspectorBody([
        section(
          "shortName",
          el(
            "div",
            { style: "display: grid; gap: 6px;" },
            names.map((name) =>
              el(
                "div",
                {
                  style:
                    "display: grid; grid-template-columns: 1fr auto; gap: 12px; font: 400 10px var(--ap-font-mono);",
                },
                [
                  el("span", { style: "opacity: .55;", text: name }),
                  el("span", {
                    style: "color: var(--ap-blue-400);",
                    text: shortName(name),
                  }),
                ]
              )
            )
          )
        ),
      ]),
      {
        caption: {
          what: "`shortName` against the names design systems actually produce, since the badge shows this in a slot narrower than most of them.",
        },
      }
    );
  },
};

/**
 * A registry with nothing in it — every badge is `null`.
 *
 * The default state of every story, since `preview.ts` clears the registry. It
 * is here explicitly because "no badges anywhere" is what a project without a
 * design system looks like, and the panel has to be complete without them.
 */
export const NoTokens: StoryObj = {
  render: () =>
    stage(
      inspectorBody([
        section(
          "Unseeded registry",
          grid([
            labelled("Padding", badge("padding-top")),
            labelled("Colour", badge("color")),
          ])
        ),
      ]),
      {
        caption: {
          what: "An empty registry, where every badge is `null` — which is what a project without a design system looks like.",
        },
      }
    ),
};
