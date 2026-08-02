import type { Meta, StoryObj } from "@storybook/html-vite";
import { emptyPanelStory, panelStory } from "../stories/story-panel";

/*
 * The whole Design panel, as the right dock, beside the page it is inspecting.
 *
 * No shadowing here and nothing partial: this is `DesignPanel` doing exactly
 * what it does in the product, with `harness()` supplying the collaborators that
 * would otherwise need a socket, a stage and a live selection controller.
 *
 * These are the stories to reach for when the question is about the panel as a
 * whole rather than about one control — the order of the sections, how much
 * vertical space a typical element consumes, whether the Scope row earns its
 * place at the top. `renderSections`'s own comment states the invariant that
 * makes the set vary: anything gating a section there must also appear in
 * `shapeKey`, or the section fails to appear or disappear when the element
 * changes under a refresh rather than a reselect. Each subject below lands on a
 * different branch of that gate, so between them they are the visual statement
 * of what `shapeKey` is for.
 *
 * Which makes the accuracy of the subjects the whole point, and until recently
 * two of these were wrong. `Vector` asked for `icon`, which resolved the `<svg>`
 * root — where `isSvgChild` is false *by definition* — so the story documenting
 * the most aggressively gated path in the panel was showing the ungated one, and
 * that path had no coverage anywhere in the catalogue. It now asks for `path`
 * and `SvgRoot` covers what it used to show, which are genuinely two different
 * pictures.
 */

const meta: Meta = {
  title: "Inspector/Panel",
};

export default meta;

/**
 * A flex card — the fullest the Design tab gets.
 *
 * Position, Constraints, Size, Auto layout, Spacing, Appearance, Fill, Stroke
 * and Effects, in that order.
 */
export const Card: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "scroll the panel — its body is the scroller, and the header, the tabs and the Scope row stay put",
        what: "Every section the Design tab has for an ordinary element, in order.",
      },
    }),
};

/**
 * A heading, which adds the Text section.
 *
 * Gated on `hasText`, so a bare layout div does not get six typography controls
 * that cannot do anything.
 */
export const Text: StoryObj = {
  render: () =>
    panelStory("title", {
      caption: {
        what: "A heading, which is the only thing here that brings the Text section — `hasText` gates it.",
      },
    }),
};

/**
 * An absolutely-positioned badge.
 *
 * Constraints appears and Position has real insets to show. This is the subject
 * for judging whether the geometry sections read well when they actually have
 * something to say.
 */
export const Positioned: StoryObj = {
  render: () =>
    panelStory("badge", {
      caption: {
        what: "`position: absolute` brings the Constraints section, and gives Position real insets to show.",
      },
    }),
};

/**
 * An `<img>`, which brings the Media section and its HTML attributes.
 *
 * `alt` and `loading` are not declarations: they land in `AttrSet` rather than
 * `ChangeSet`, ship in their own array, and are described to the agent as JSX
 * props rather than styles.
 */
export const Media: StoryObj = {
  render: () =>
    panelStory("image", {
      caption: {
        what: "An `<img>`: the Media section, plus `alt` and `loading` — attributes, not declarations, so they travel in their own array.",
      },
    }),
};

/**
 * A `<video>`, which is media without being an image.
 *
 * The comparison with `Media` above is the point: `isMedia` is true for both, so
 * both get `object-fit` and `object-position`, but `isRasterImage` is false here
 * and the three `<img>`-only attributes are withheld. Writing `alt` on a
 * `<video>` produces an attribute the browser ignores, which is the quietest
 * possible kind of broken.
 */
export const Video: StoryObj = {
  render: () =>
    panelStory("video", {
      caption: {
        try: "compare with Media above — same section, minus the three attributes a <video> does not have",
        what: "Media on a `<video>`: `object-fit` stays, `alt`/`loading`/`decoding` are withheld.",
      },
    }),
};

/**
 * A hero with a photograph behind it, reaching Media the other way.
 *
 * Not a media *element* at all — `hasBackgroundImage` is the second route into
 * that section, and this is the exact shape the predicate had to be rewritten
 * for: a gradient scrim over a `url()`. The old whole-value test reported no
 * background image the moment any layer was a gradient, which made
 * `background-size` and `background-position` unreachable for the single most
 * common hero treatment on the web.
 */
export const BackgroundImage: StoryObj = {
  render: () =>
    panelStory("hero", {
      caption: {
        what: "Media on an element that is not a media element — a two-layer background, gradient over `url()`.",
      },
    }),
};

/**
 * An SVG child, which is the most aggressively gated case.
 *
 * `isSvgChild` suppresses Position, Constraints, Auto layout, Spacing, Text,
 * Fill and Stroke outright — a `<path>` has no box, no padding and no text flow,
 * so those would be seven sections of controls that cannot do anything — and
 * shows Vector instead.
 */
export const Vector: StoryObj = {
  render: () =>
    panelStory("path", {
      caption: {
        try: "count what is missing — seven sections suppressed at once, which is the most the panel ever hides",
        what: "A `<path>` inside an SVG: no box, so `isSvgChild` takes the box sections away and leaves Vector.",
      },
    }),
};

/**
 * The `<svg>` element itself, which is the opposite branch.
 *
 * An `<svg>` lays out like any other box — it has a width, padding and a
 * position — so it gets Vector *and* everything `path` above loses. The pair is
 * the clearest statement of why `isSvgRoot` and `isSvgChild` are two predicates
 * rather than one.
 */
export const SvgRoot: StoryObj = {
  render: () =>
    panelStory("icon", {
      caption: {
        try: "compare with Vector above — same graphic, one node up, and seven sections come back",
        what: "The `<svg>` root: Vector *plus* the box sections, because an `<svg>` has a box.",
      },
    }),
};

/**
 * A multi-selection, which is where `Mixed` comes from.
 *
 * Two cards with different `max-width` values. `seed()` returns the primary's
 * value when the rest of the selection agrees and the `MIXED` sentinel when it
 * does not — a plain string, which is what lets it flow through the existing
 * controls untouched: a number field renders it as text, a segmented group
 * matches no option and shows nothing active. Both are exactly right, and
 * neither needed a new code path. This is the story that shows both at once.
 */
export const MultiSelection: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "find the fields showing `Mixed` — those are the ones the two cards disagree about",
        what: "Two cards at once. Fields agree or they show the `MIXED` sentinel, which is a plain string and needs no special control.",
      },
      extra: [".card--wide"],
    }),
};

/**
 * The CSS tab, on a subject in its own document.
 *
 * The frame is not decoration, and the difference is measurable. `stubSurface()`
 * reports `doc: document`, which in Storybook is the preview iframe carrying
 * Storybook's own stylesheets — and `matchedRules` walks them. Same subject, two
 * topologies:
 *
 *     framed          1 matching of  17 rules
 *     same-document   1 matching of 114 rules
 *
 * `isOwnSheet` skips the overlay's own sheet and knows nothing about
 * Storybook's, so those extra 97 rules are live candidates. `.card` wins either
 * way, but for anything Storybook's reset actually touches — `*`, `body`,
 * `button` — the pane would report Storybook's rules as the app's provenance:
 * plausible, and wrong.
 *
 * Putting the subject in its own document fixes it by being *more* faithful:
 * this is the production topology, which is why `realm.ts` exists.
 *
 * It is also the only place the CSS pane can be seen at all. `style-model.ts`
 * notes that happy-dom implements no `CSSStyleDeclaration` iterator, "which is
 * why the CSS pane could never be rendered in a test" — and the specimen
 * stylesheet uses `@layer`, native nesting and `@supports`, all of which
 * happy-dom drops outright.
 */
export const CssTab: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "read the provenance column — those rule origins are the specimen's own sheet, not Storybook's reset",
        what: "The CSS tab, on a subject in its own document. The frame is what keeps Storybook's stylesheets out of the answer.",
      },
      frame: true,
      tab: "css",
    }),
};

/** The DOM tab — the element tree, with drag-to-reparent. */
export const DomTab: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "drag a row onto another — the tree reparents, and the move is queued as a structural edit",
        what: "The DOM tab: the element tree around the selection.",
      },
      tab: "dom",
    }),
};

/**
 * The whole panel with a design system in the registry.
 *
 * Every tokenable property grows a badge. Seeing it at panel scale rather than
 * per-field is the only way to judge the density cost, which is the trade
 * `createTokenBadge` returning `null` for untokened properties exists to manage.
 */
export const WithTokens: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "compare with Card above — the badges are the whole difference, and the question is whether they crowd it",
        what: "The same card with a design system loaded, so every tokenable property carries a badge.",
      },
      tokens: true,
    }),
};

/**
 * No selection.
 *
 * Its own designed state rather than a blank: "Pick an element to start
 * tweaking", with a line telling you how. Worth having in the catalogue because
 * it is the first thing every user sees and the easiest thing to leave
 * unconsidered.
 */
export const Empty: StoryObj = {
  render: () =>
    emptyPanelStory({
      what: "Nothing selected — a designed state rather than a blank, and the first thing every user sees.",
    }),
};

/** The whole panel at `MIN_DOCK_W`, which is the real stress test. */
export const Narrow: StoryObj = {
  render: () =>
    panelStory("card", {
      caption: {
        try: "look for a label that elides or a pair of fields that collide — this is the width the splitter clamps to",
        what: "The whole panel at `MIN_DOCK_W`, the narrowest the dock can be dragged.",
      },
      narrow: true,
    }),
};
