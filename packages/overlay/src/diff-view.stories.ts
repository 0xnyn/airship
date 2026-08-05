import type { Meta, StoryObj } from "@storybook/html-vite";
import { renderDiff } from "./diff-view";
import { cls, el } from "./dom";
import { dock, plainStage } from "./stories/chrome";
import { DIFF, NEW_DIFF, SMALL_DIFF } from "./stories/fixtures";

/*
 * The diff renderer.
 *
 * A deliberate deviation, and the README says so: this is a self-contained
 * renderer rather than `@pierre/diffs` + shiki, to keep the overlay IIFE small
 * and free of a syntax highlighter in the browser bundle. The server still
 * computes the patches with `diff`; this only draws them.
 *
 * So what these stories are really checking is whether an unhighlighted diff at
 * 11px mono, in a 360px column, is still readable — which is the whole bet that
 * deviation makes. The line-number gutters carry `data-old` / `data-new`,
 * because those are the anchors a pinned comment attaches itself to.
 */

const meta: Meta = {
  title: "Chat/Diff",
};

export default meta;

/** A diff inside the dock, at the width it is actually read at. */
function docked(...children: HTMLElement[]): HTMLElement {
  return dock(el("div", { class: cls("diffs") }, children), { label: "Agent" });
}

/**
 * A two-hunk change to one file.
 *
 * The common shape after an edit: a few lines replaced in one place and a block
 * appended in another. Watch the long line — a Tailwind class list is the case
 * that decides whether these wrap or scroll, and the answer has to be the same
 * for additions and deletions or the two columns stop lining up.
 */
export const TwoHunks: StoryObj = {
  render: () =>
    plainStage([docked(renderDiff(DIFF, { header: true }))], {
      try: "find the long Tailwind class list — whether it wraps or scrolls has to be the same for additions and deletions or the columns stop lining up",
      what: "The common shape after an edit: lines replaced in one place, a block appended in another.",
    }),
};

/** A single-line change — the short end, where the header dominates. */
export const OneLine: StoryObj = {
  render: () =>
    plainStage([docked(renderDiff(SMALL_DIFF, { header: true }))], {
      what: "A single-line change, where the header takes more room than the diff.",
    }),
};

/** A brand-new file. `isNew` changes the header, not the body. */
export const NewFile: StoryObj = {
  render: () =>
    plainStage([docked(renderDiff(NEW_DIFF, { header: true }))], {
      what: "A brand-new file. `isNew` changes the header and nothing else.",
    }),
};

/**
 * Several files from one edit, stacked.
 *
 * What an agent turn usually produces. The stack is where the header earns its
 * place: without a filename on each, three diffs in a column are one
 * indistinguishable block of green and red.
 */
export const Stacked: StoryObj = {
  render: () =>
    plainStage(
      [
        docked(
          renderDiff(DIFF, { header: true }),
          renderDiff(SMALL_DIFF, { header: true }),
          renderDiff(NEW_DIFF, { header: true })
        ),
      ],
      {
        what: "Three files from one edit. This is where the per-file header earns its place — without it a column of diffs is one block of green and red.",
      }
    ),
};

/** Headerless, as it renders when the filename is already stated above. */
export const NoHeader: StoryObj = {
  render: () =>
    plainStage([docked(renderDiff(DIFF))], {
      what: "Headerless, as it renders when the filename is already stated above it.",
    }),
};
