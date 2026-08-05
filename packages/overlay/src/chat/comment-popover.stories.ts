import type { Meta, StoryObj } from "@storybook/html-vite";
import { renderDiff } from "../diff-view";
import { cls, el } from "../dom";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { DIFF, noop } from "../stories/fixtures";
import { type CommentContext, openCommentPopover } from "./comment-popover";

/*
 * The box you type a review comment into.
 *
 * A popover rather than the composer, and the reasoning is worth restating
 * because the composer is the obvious place to put it. Prefilling the composer
 * would clobber whatever the user was already typing and — the real problem —
 * lose the anchor. The entire point of a comment is that it points at specific
 * lines; a message in the chat box points at nothing.
 *
 * The one thing to look at in all three of these is the header line, because it
 * is the only place the anchor is visible. `file`, `file:12` and `file:12–18`
 * are three different claims about what the comment is *about*, and the
 * difference between the second and third is one `===` in the module.
 *
 * All three open in a `play` rather than at render. `openPopover` positions
 * itself against a measured rect, and an anchor that is not yet in the document
 * measures as all zeros — the note `chrome.stories.ts` and
 * `gradient-editor.stories.ts` both carry for the same reason.
 */

const meta: Meta = {
  title: "Chat/Comment",
};

export default meta;

/** A real rendered diff, since that is the only thing a comment ever anchors to. */
function anchoredDiff(caption: Caption): HTMLElement {
  return plainStage(
    [
      dock(
        el("div", { class: cls("diffs") }, [
          renderDiff(DIFF, { header: true }),
        ]),
        { label: "Agent" }
      ),
    ],
    caption
  );
}

/** Open the popover on the diff, once the diff is measurable. */
function openOn(canvasElement: HTMLElement, ctx: CommentContext): void {
  const anchor = canvasElement.querySelector<HTMLElement>(
    `.${cls("diff-file")}`
  );
  if (anchor) {
    openCommentPopover(anchor, ctx, noop);
  }
}

/**
 * A comment on a whole file.
 *
 * No range, so the header is just the path. This is what the menu entry reading
 * "Comment on this change…" produces — the case where nothing was selected.
 */
export const OnAFile: StoryObj = {
  play: ({ canvasElement }) =>
    openOn(canvasElement, { file: "src/components/hero.tsx" }),
  render: () =>
    anchoredDiff({
      what: "No line range: the comment is about the file, and the header says only the path.",
    }),
};

/**
 * A comment on a range.
 *
 * What you get after selecting inside the diff. The range is latched on
 * `pointerdown` rather than read on `click`, because pressing a button collapses
 * the text selection before the click handler ever runs — so by the time the
 * menu is built, the thing it needs to name is already gone.
 */
export const OnLines: StoryObj = {
  play: ({ canvasElement }) =>
    openOn(canvasElement, {
      file: "src/components/hero.tsx",
      fromLine: 12,
      toLine: 18,
    }),
  render: () =>
    anchoredDiff({
      try: "press ⌘↵ in the field — it submits, matching the composer, and Escape closes rather than bubbling to the document",
      what: "A range: `file:12–18`, the shape the menu produces when lines were selected.",
    }),
};

/**
 * One line, spelled as one line.
 *
 * `from === to` renders `file:12` rather than `file:12–12`. A one-character
 * difference in the module, and the difference between a header that reads like
 * a line reference and one that reads like a bug.
 */
export const OnOneLine: StoryObj = {
  play: ({ canvasElement }) =>
    openOn(canvasElement, {
      file: "src/components/hero.tsx",
      fromLine: 12,
      toLine: 12,
    }),
  render: () =>
    anchoredDiff({
      try: "compare the header with OnLines above — this one collapses to a single number rather than saying 12–12",
      what: "A single-line anchor.",
    }),
};
