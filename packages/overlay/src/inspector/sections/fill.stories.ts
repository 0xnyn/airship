import type { Meta, StoryObj } from "@storybook/html-vite";
import { sectionStory } from "../../stories/story-panel";
import { renderFill } from "./fill";

/*
 * Fill — the section that exercises the most of the panel's machinery.
 *
 * It is the canary for the whole section-story approach, and deliberately the
 * first one written. Between them these stories drive:
 *
 * - `ctx.colorRow`, which registers a bracketed `[swatch][hex][alpha]` row
 * - `ctx.tokenSlot`, so a paint can be bound to the project's palette
 * - `ctx.repaintScope`, the disposing re-paint runner the layer list needs —
 *   without it, N repaints leave the panel holding N copies of each control and
 *   `reseed` writing into detached DOM
 * - `createRowList`, whose serialise round-trip is *lossy by design*: a disabled
 *   layer is dropped from the CSS, because a fill you switched off should not
 *   appear in the source
 * - the gradient editor, opened over the colour picker — the popover-on-popover
 *   stack that `closeOpenPopover` closes wholesale rather than one at a time
 *
 * Every one of those is real here. The section renders inside a real
 * `DesignPanel`, driven by a real element in a real browser, so the values it
 * shows are resolved by the browser's own cascade rather than seeded by hand.
 */

const meta: Meta = {
  title: "Inspector/Sections/Fill",
};

export default meta;

/**
 * A card with a flat white background.
 *
 * The common case, and the one to check first: one paint, an opaque colour, and
 * the alpha at 100%.
 */
export const Solid: StoryObj = {
  render: () =>
    sectionStory(renderFill, "card", {
      caption: {
        what: "One opaque paint at 100% — the common case, and the one to check first.",
      },
    }),
};

/**
 * A button whose background is a brand colour.
 *
 * Interesting because the element also has `:hover` and `:active` rules that
 * change it. The State control in the Scope row above is what reaches those; the
 * section itself shows the resting paint.
 */
export const Button: StoryObj = {
  render: () =>
    sectionStory(renderFill, "button", {
      caption: {
        try: "switch State in the Scope row to `:hover` — the section repaints against the hover rule",
        what: "A brand-coloured button that also has `:hover` and `:active` rules. The section shows the resting paint; the State control reaches the others.",
      },
    }),
};

/**
 * A tile painted with a gradient.
 *
 * `renderFill` branches on whether the value is a gradient, and the swatch shows
 * the ramp rather than a colour. Clicking it opens the gradient editor rather
 * than the colour picker — `canEditGradient` decides which.
 *
 * This story asked for `grid` until recently, which resolved `.tiles` — the
 * grid *container*, which paints nothing. `hasFill` reads `background-color`, got
 * `rgba(0, 0, 0, 0)`, and rendered the section empty. So the story captioned "a
 * tile painted with a gradient" had never once shown a gradient, and there was
 * no way to tell from the outside: an empty Fill section is a legitimate state
 * for an element with no fill, which is exactly what the panel was correctly
 * reporting about the wrong element.
 */
export const Gradient: StoryObj = {
  render: () =>
    sectionStory(renderFill, "tile", {
      caption: {
        try: "click the swatch — a gradient opens the gradient editor, not the colour picker; `canEditGradient` decides which",
        what: "A gradient fill, so the swatch shows a ramp rather than a colour.",
      },
    }),
};

/**
 * The same section with a design system in the registry.
 *
 * Every paint now carries a token badge, and the two that match a token exactly
 * are lit. The comparison with `Solid` above — same element, same section, one
 * with tokens and one without — is the clearest statement of what the affordance
 * costs in visual noise, which is the trade `createTokenBadge` returning `null`
 * for untokened properties exists to manage.
 */
export const WithTokens: StoryObj = {
  render: () =>
    sectionStory(renderFill, "card", {
      caption: {
        try: "compare with Solid above — same element, same section, and the badges are the entire difference",
        what: "The same fill with a design system loaded: every paint carries a badge, and exact matches are lit.",
      },
      tokens: true,
    }),
};

/**
 * Fill in the narrowest dock the app allows.
 *
 * The colour row is `[swatch][hex][alpha]` on one line and is the widest fixed
 * arrangement in the panel, so 280px is where the hex and the percentage are
 * closest to colliding.
 */
export const Narrow: StoryObj = {
  render: () =>
    sectionStory(renderFill, "card", {
      caption: {
        what: "`[swatch][hex][alpha]` is the widest fixed arrangement in the panel, and `MIN_DOCK_W` is where it comes closest to colliding.",
      },
      narrow: true,
    }),
};
