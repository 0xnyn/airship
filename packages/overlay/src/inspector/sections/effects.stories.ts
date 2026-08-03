import type { Meta, StoryObj } from "@storybook/html-vite";
import { sectionStory } from "../../stories/story-panel";
import { renderAppearance } from "./appearance";
import { renderEffects } from "./effects";
import { renderFilters } from "./filters";
import { renderMedia } from "./media";
import { renderVector } from "./vector";

/*
 * The remaining sections: Appearance, Effects, Filters, Media and Vector.
 *
 * Together they cover the two kinds of gating `renderSections` does.
 *
 * **By element kind.** Media appears for `<img>`, `<video>` and friends; Vector
 * for SVG. Both are branches on `isMedia` / `isSvgChild`, and `renderSections`
 * carries an explicit invariant about them: anything gating a section there
 * *must* also appear in `shapeKey`, or the section fails to appear or disappear
 * when the element changes under a refresh rather than a reselect.
 *
 * **By repeatable layer.** Effects and Filters are both `createRowList` — a list
 * of layers with an eye, a minus and reorder controls. The round trip through
 * CSS is lossy by design: `serialize` drops disabled rows, because a shadow you
 * switched off should not appear in the source. That is why the list keeps what
 * it last serialised, so `setValue` can recognise its own echo and not mistake
 * it for an external change that should blow away the disabled rows.
 *
 * Media is also the section with HTML *attributes* rather than declarations —
 * `alt`, `loading`, `poster`. Those go through `ctx.onAttr` into `AttrSet`, ship
 * in their own array, and are described to the agent as JSX props rather than
 * styles. They are also the controls that need `ControlHandle.resync`, since no
 * CSS property carries their value and the re-seed pass could never reach them.
 *
 * Both kind-gated sections used to be demonstrated by the wrong element. `Vector`
 * asked for the `<svg>` root, where `isSvgChild` is false by definition, so the
 * story explaining what that predicate suppresses was pointed at the node it does
 * not apply to. `Media` only ever showed the `<img>` branch, which is the one of
 * three that the section's own logic treats as the special case.
 */

const meta: Meta = {
  title: "Inspector/Sections/Effects and kinds",
};

export default meta;

/**
 * Appearance — opacity and blend mode, the two properties that affect the
 * element as a whole rather than one of its paints.
 */
export const Appearance: StoryObj = {
  render: () =>
    sectionStory(renderAppearance, "card", {
      caption: {
        what: "Opacity and blend mode — the two properties that act on the whole element rather than one of its paints.",
      },
    }),
};

/**
 * Effects on a card with two shadows.
 *
 * `.card` declares `box-shadow: 0 1px 2px …, 0 8px 24px …` — two layers, which
 * is what makes this the right subject. A shadow row *stacks* (a type, four
 * offsets and a colour), and `RowListSpec.actionSlot` exists precisely for that:
 * with `align-items: center` the eye and minus landed at the geometric midpoint
 * of the block, 57px down a 114px column, in the 2px gutter between the offsets
 * and the blur — and moved with the dock width.
 */
export const Effects: StoryObj = {
  render: () =>
    sectionStory(renderEffects, "card", {
      caption: {
        try: "switch a shadow off with the eye — it stays in the list and leaves the CSS, which is the lossy round trip working as designed",
        what: "Two stacked shadow layers, and the row whose action slot had to be pinned to its first line rather than centred.",
      },
    }),
};

/** Effects on an element with no shadow — the empty list and its `+`. */
export const EffectsEmpty: StoryObj = {
  render: () =>
    sectionStory(renderEffects, "button", {
      caption: {
        what: "No shadow at all: the empty list, and the `+` that is the only thing in it.",
      },
    }),
};

/**
 * Filters on the button, which declares a `filter` only on `:hover`.
 *
 * The resting state has none, so this is the empty list — and the interesting
 * part is that the value *does* exist one state away. The State control in the
 * Scope row above is what reaches it.
 */
export const Filters: StoryObj = {
  render: () =>
    sectionStory(renderFilters, "button", {
      caption: {
        try: "switch State to `:hover` — the filter this element declares is one state away, and the section fills in",
        what: "An empty filter list on an element that does have a filter, just not in its resting state.",
      },
    }),
};

/**
 * Media, on a real `<img>`.
 *
 * `alt`, `loading` and the object-fit controls. The attribute fields read the
 * element's own markup rather than any CSS property, so they are the reason
 * `ControlHandle.resync` exists: without it an undo — or an agent edit — left
 * them showing text the element no longer had, and blurring the field
 * re-committed the stale value.
 */
export const Media: StoryObj = {
  render: () =>
    sectionStory(renderMedia, "image", {
      caption: {
        what: "An `<img>`: object-fit alongside `alt` and `loading`, which are attributes and travel a different path entirely.",
      },
    }),
};

/**
 * Media on a `<video>` — the branch without the `<img>`-only attributes.
 *
 * `isMedia` is true, so `object-fit` and `object-position` render; `isRasterImage`
 * is false, so `alt`, `loading` and `decoding` do not. That distinction is the
 * entire reason `element-kind.ts` keeps two predicates where `node-kind.ts` folds
 * `<video>` and `<img>` together, and nothing showed it before.
 */
export const MediaVideo: StoryObj = {
  render: () =>
    sectionStory(renderMedia, "video", {
      caption: {
        try: "compare with Media above — the object-fit controls stay, the three attribute fields are gone",
        what: "The same section on a `<video>`, where three of the controls would write attributes the element does not have.",
      },
    }),
};

/**
 * Media reached through `hasBackgroundImage` instead of an element kind.
 *
 * A hero with a gradient scrim over a photograph. The predicate tests each
 * background *layer* rather than the whole value, because the whole-value version
 * reported no background image as soon as any layer was a gradient — which is
 * true of essentially every darkened hero on the web, and left `background-size`
 * and `background-position` unreachable for all of them.
 */
export const MediaBackground: StoryObj = {
  render: () =>
    sectionStory(renderMedia, "hero", {
      caption: {
        what: "The section on an element that is not media at all: a two-layer background, gradient over `url()`.",
      },
    }),
};

/**
 * Vector, on the arrow inside the button.
 *
 * An SVG child has no box, no padding and no text flow, so `renderSections`
 * suppresses Position, Constraints, Auto layout, Spacing, Text, Fill and Stroke
 * for it entirely and shows this instead — fill, stroke and the path's own
 * geometry.
 *
 * This asked for `icon` until recently, which is the `<svg>` root. `isSvgChild`
 * is `!isSvgRoot(node) && closest("svg")`, so on the root it is false and none of
 * the suppression this story exists to describe was happening.
 */
export const Vector: StoryObj = {
  render: () =>
    sectionStory(renderVector, "path", {
      caption: {
        what: "A `<path>`: fill, stroke and geometry, on a node with no box for the other seven sections to act on.",
      },
    }),
};

/**
 * Vector on the `<svg>` root, which keeps its box.
 *
 * The other side of the predicate pair. An `<svg>` element lays out like any
 * other box, so it gets this section *and* Position, Size and the rest — which is
 * why `isSvgRoot` and `isSvgChild` are two questions rather than one.
 */
export const VectorRoot: StoryObj = {
  render: () =>
    sectionStory(renderVector, "icon", {
      caption: {
        try: "compare with Vector above — same graphic, one node up, and the box sections come back",
        what: "The same section on the `<svg>` root, which is a box and keeps everything a box gets.",
      },
    }),
};

/** Effects with a design system, so shadow colours can be bound. */
export const WithTokens: StoryObj = {
  render: () =>
    sectionStory(renderEffects, "card", {
      caption: {
        what: "The shadow list with a design system loaded, so a shadow colour can be bound to the palette.",
      },
      tokens: true,
    }),
};
