import type { Meta, StoryObj } from "@storybook/html-vite";
import { sectionStory } from "../../stories/story-panel";
import { renderStroke } from "./stroke";

/*
 * Stroke — borders, and the section that proves the re-paint contract.
 *
 * Changing the border style is the single best thing to try in this catalogue.
 * `renderStroke` rebuilds its own rows in place when the style changes — a
 * dashed border has controls a `none` border does not — and it does that through
 * `ctx.repaintScope()`, whose whole reason for existing is that the sections
 * doing this were leaking controls: each repaint called `colorRow`, `fieldCell`
 * and `register` again without unregistering what it replaced, so after N
 * repaints the panel held N copies of every control, `reseed` wrote into
 * detached DOM, and `renderBody`'s teardown ran `destroy()` on all of them.
 *
 * Because these stories drive the real panel rather than a stand-in context,
 * that path is genuinely under test here: switch the style a few times and the
 * rows must stay live and singular. A fake `SectionContext` would have made the
 * section *look* right while testing nothing.
 *
 * `STROKE_SIDES` is the other thing worth seeing — a border can be set on one
 * side, and the side picker is a five-cell affordance whose lit state has to
 * survive a repaint.
 */

const meta: Meta = {
  title: "Inspector/Sections/Stroke",
};

export default meta;

/** A card with a hairline border — the common case. */
export const Hairline: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "card", {
      caption: {
        try: "change the border style a few times — the rows must rebuild in place and stay live and singular",
        what: "A 1px border, and the section where `ctx.repaintScope` earns its existence.",
      },
    }),
};

/**
 * A button with no border at all.
 *
 * `border: 0`, so the section is at its emptiest: the style select and nothing
 * else. What a section shows when the property is absent is a design decision in
 * its own right, and this is where to check it.
 */
export const None: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "button", {
      caption: {
        what: "`border: 0`, so the section is at its emptiest — a style select and nothing else.",
      },
    }),
};

/**
 * A tile with a translucent border, where the alpha row matters.
 *
 * This asked for `grid` until recently, which resolved `.tiles` — the
 * grid *container*, which has no border. `hasStroke` was therefore false and the
 * section rendered exactly as `None` does two stories above, so the catalogue
 * contained the same picture twice under two names, one of them describing
 * something it did not show. The translucent border is on `.tile`, the item.
 */
export const Translucent: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "tile", {
      caption: {
        try: "compare with None above — that one has no border, and until this specimen was fixed the two were identical",
        what: "A border at 20% alpha, which is the only state where Stroke's alpha row has anything to say.",
      },
    }),
};

/** With a design system, so the border colour and width carry token badges. */
export const WithTokens: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "card", {
      caption: {
        what: "The same border with a design system loaded — the colour and the width both tokenise.",
      },
      tokens: true,
    }),
};

/** The narrow rail, where the side picker and the width field share a row. */
export const Narrow: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "card", {
      caption: {
        what: "`MIN_DOCK_W`, where the five-cell side picker and the width field have to share one row.",
      },
      narrow: true,
    }),
};

/**
 * Four edges that disagree — the specimen the catalogue was missing.
 *
 * None of the five stories above uses an element whose edges differ, which is
 * why nothing here caught the section answering for the whole box from
 * `border-top-*`. This one shows a red top, teal right, blue bottom and amber
 * left: the colour row must read `Mixed` and the width field must open split.
 *
 * Two things to try, both of which used to be wrong. Picking a colour imposes
 * it on all four edges — that is the point of `Mixed`, "several values, one of
 * which you are about to impose". And the eye must still hide the stroke after
 * `+` Add stroke has been pressed: it wrote the `border-style` shorthand while
 * `hasStroke` reads the longhands through `ctx.gate`, so a pending `solid`
 * shadowed it forever and the eye did nothing.
 */
export const MixedEdges: StoryObj = {
  render: () =>
    sectionStory(renderStroke, "mixedBorder", {
      caption: {
        try: "pick a colour — it must land on all four edges; then press the eye, `+` Add stroke, and the eye again",
        what: "Four differing edges. The colour row reads `Mixed` rather than claiming the top edge's red for the box.",
      },
    }),
};
