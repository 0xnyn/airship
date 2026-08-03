import type { Meta, StoryObj } from "@storybook/html-vite";
import type { SectionStoryOptions } from "../../stories/story-panel";
import { sectionStory } from "../../stories/story-panel";
import type { SubjectName } from "../../stories/subjects";
import { GROUPS } from "../descriptors";
import { renderText } from "./text";

/*
 * Text — the typography section.
 *
 * Gated on `hasText(node)`, and the gate is the point: a Text section on a bare
 * layout div is six controls that cannot do anything. `hasText` answers yes for
 * a tag that carries text even when it has element children (a button, a link,
 * a heading) and for any node with a non-empty text child.
 *
 * The font-family field is the one control in the panel that owns its own token
 * list. `TokenSlot.apply` exists for it alone: the family menu offers design
 * system families and installed ones from a single menu, because to the person
 * choosing they are one question. Everything else keeps the badge as its
 * trigger, and that seam is deliberately narrow.
 *
 * Real fonts matter here more than anywhere else in the catalogue. The font menu
 * lists what the browser actually has, and the sample rendering in each row is
 * drawn in the face it names — neither of which exists under happy-dom.
 */

const meta: Meta = {
  title: "Inspector/Sections/Text",
};

export default meta;

const TYPOGRAPHY = GROUPS.find((g) => g.id === "typography");
if (!TYPOGRAPHY) {
  throw new Error("No typography group in GROUPS");
}

/** Every story here is the same section; only the subject and the options move. */
const text = (name: SubjectName, opts: SectionStoryOptions = {}) =>
  sectionStory((ctx, node) => renderText(ctx, node, TYPOGRAPHY), name, opts);

/** A heading — large, tight tracking, heavy weight. */
export const Heading: StoryObj = {
  render: () =>
    text("title", {
      caption: {
        try: "open the font family menu — it lists what this browser actually has, which is the part happy-dom can never show",
        what: "A heading: large, heavy, and tracked in slightly.",
      },
    }),
};

/** Body copy, at the default size and a normal weight. */
export const Paragraph: StoryObj = {
  render: () =>
    text("paragraph", {
      caption: {
        what: "Body copy at the default size and weight, where line height is the control that matters most.",
      },
    }),
};

/**
 * Text on a `<div>`, which reaches `hasText` the other way.
 *
 * The gate has two arms — the `TEXTY` tag set, and a scan for a non-empty text
 * child — and every other story here lands on the first. A `<div>` with words in
 * it is the far more common shape in a real app, and it is the arm that would
 * silently stop working if the scan were ever dropped.
 */
export const Note: StoryObj = {
  render: () =>
    text("note", {
      caption: {
        what: "A `<div>` with text in it: `hasText` says yes via the text-node scan, not the tag set.",
      },
    }),
};

/**
 * A button's label.
 *
 * `hasText` returns true for a `<button>` even though it also has an element
 * child — the `TEXTY` set is what encodes that. Without it the section would
 * vanish from the one element people most often want to restyle.
 */
export const Button: StoryObj = {
  render: () =>
    text("button", {
      caption: {
        what: "A `<button>`, which has an element child and still counts as text — that is what the `TEXTY` set encodes.",
      },
    }),
};

/**
 * With a design system in the registry.
 *
 * Font size, weight and colour all become bindable. Weight is the interesting
 * one: it is a segmented group, which has no `setToken`, so `fieldCell` declines
 * to put a badge on it rather than advertising an affordance the control cannot
 * honour. The CSS tab remains the way to write such a value by hand.
 */
export const WithTokens: StoryObj = {
  render: () =>
    text("title", {
      caption: {
        try: "look at Weight — it is a segmented group, has no `setToken`, and so declines the badge rather than faking one",
        what: "Size, weight and colour all become bindable — except the one control that cannot honour a token.",
      },
      tokens: true,
    }),
};

/** The narrow rail, where the font-family row has the least room to elide. */
export const Narrow: StoryObj = {
  render: () =>
    text("title", {
      caption: {
        what: "`MIN_DOCK_W`, where the font-family row has the least room before it has to elide.",
      },
      narrow: true,
    }),
};
