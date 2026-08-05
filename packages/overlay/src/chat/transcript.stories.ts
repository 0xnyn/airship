import type { JobDiffBundle } from "@airship/protocol";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { type Caption, dock, plainStage } from "../stories/chrome";
import {
  BUNDLE,
  BUNDLE_FAILED,
  BUNDLE_FAILED_SILENT,
  BUNDLE_MANY,
  BUNDLE_NO_COST,
  noop,
  TIMELINE,
} from "../stories/fixtures";
import {
  type AssistantActions,
  assistantTurn,
  fillAssistant,
  setTurnStatus,
  userBubble,
} from "./transcript";

/*
 * A whole agent turn: the question, the work, and the result.
 *
 * The half of the product with no catalogue entry until now. `tool-row.stories`
 * covers the individual rows of the activity log, but the thing those rows sit
 * inside — the user bubble, the live status pill, the result slot with its
 * summary, its meta line, its folded diffs and its kebab — had none, and it is
 * where most of the product decisions in the chat dock actually live.
 *
 * The structural fact worth knowing before reading any of these: **the timeline
 * and the result are two different nodes, and only one of them is ever
 * cleared.** `fillAssistant` writes to `turn.result`, not to `turn.root`.
 * Pointing it at the root is what used to wipe the streamed activity the moment
 * a job finished, so the record of *how* an edit was reached survived exactly
 * until the edit arrived.
 *
 * Every one of these is a shape a live agent produces on its own schedule. A
 * failed job with an empty error string, a bundle with tokens but no price, a
 * five-file edit — getting those on demand, in one place, for a screenshot, is
 * otherwise a matter of luck and a deliberately broken repo.
 */

const meta: Meta = {
  title: "Chat/Transcript",
};

export default meta;

/** Everything a finished turn can offer. Stories narrow this to show gating. */
const ACTIONS: AssistantActions = {
  onBranch: noop,
  onComment: noop,
  onCommit: noop,
  onCopyPath: noop,
  onCreatePr: noop,
  onFollowUp: noop,
  onOpenIn: noop,
  onUndo: noop,
};

/** The left dock, which is where a transcript actually lives. */
function transcript(children: HTMLElement[], caption: Caption): HTMLElement {
  return plainStage(
    [
      dock(el("div", { class: cls("transcript") }, children), {
        label: "Agent",
      }),
    ],
    caption
  );
}

/** A finished exchange: the prompt, the activity, and the filled result slot. */
function finished(
  bundle: JobDiffBundle,
  caption: Caption,
  actions: AssistantActions = ACTIONS
): HTMLElement {
  const turn = assistantTurn();
  turn.timeline.hydrate(bundle.timeline ?? []);
  turn.timeline.setCollapsed(true);
  turn.status.remove();
  fillAssistant(turn.result, bundle, actions);
  return transcript([userBubble(bundle.prompt), turn.root], caption);
}

/**
 * A turn in flight.
 *
 * The status pill is the only part of this that is not append-only: it is
 * replaced on every step and then removed outright when the job finishes, which
 * is why it is a sibling of the timeline rather than a row in it.
 */
export const Exchange: StoryObj = {
  render: () => {
    const turn = assistantTurn();
    turn.timeline.hydrate(TIMELINE);
    setTurnStatus(turn.status, "Editing src/components/hero.tsx…");
    return transcript([userBubble(BUNDLE.prompt), turn.root], {
      try: "note that the timeline above the pill is append-only — nothing here will be cleared when the job lands",
      what: "A turn still running: the prompt, the live activity log, and the status pill under it.",
    });
  },
};

/**
 * The finished turn, which is what most of the dock's design is about.
 *
 * Markdown summary, the meta line, two diffs folded shut, the kebab, and the
 * follow-up suggestions behind their own disclosure.
 */
export const Finished: StoryObj = {
  render: () =>
    finished(BUNDLE, {
      try: "open a diff — every file lands folded, because the summary above has already said what happened",
      what: "A completed edit: summary, counts, folded diffs, actions, and suggested follow-ups.",
    }),
};

/**
 * Tokens reported, no price.
 *
 * Codex does this, and so does Claude under subscription auth. The meta line
 * used to be gated on the cost being a number, so this bundle rendered *no*
 * meta line at all — the file count and the ±lines disappeared along with the
 * dollar figure they had nothing to do with.
 */
export const NoCost: StoryObj = {
  render: () =>
    finished(BUNDLE_NO_COST, {
      try: "compare the meta line with Finished above — same counts, no price, and the counts are the part that must not depend on the price",
      what: "The same edit from a backend that reports no cost.",
    }),
};

/** A failed job, which puts the error class on the bubble and stops there. */
export const Failed: StoryObj = {
  render: () =>
    finished(BUNDLE_FAILED, {
      what: "A failure: the bubble takes the error treatment and the result slot carries the message instead of a diff.",
    }),
};

/**
 * A failure with nothing to say.
 *
 * `bundle.error || "Edit failed."` — and the `||` is deliberate where a `??`
 * would be wrong, because an agent that dies without a message sends an empty
 * string rather than omitting the field.
 */
export const FailedSilently: StoryObj = {
  render: () =>
    finished(BUNDLE_FAILED_SILENT, {
      what: "The same failure with an empty error string, which falls through to the generic message rather than rendering a blank line.",
    }),
};

/**
 * Five files from one edit.
 *
 * The case that folding exists for. Every diff used to render fully expanded, so
 * a five-file turn buried its own summary — and the summary is the part that
 * says what happened.
 */
export const ManyFiles: StoryObj = {
  render: () =>
    finished(BUNDLE_MANY, {
      what: "Five changed files, all folded. Expanded, this turn would be several thousand pixels of diff above its own summary.",
    }),
};

/**
 * The turn kebab, open.
 *
 * Three groups — what to do with this change, how to continue from it, and where
 * to open it. This was three always-visible icon buttons, and the set only grows:
 * undo, commit, push, PR, two editors, copy path. Six glyphs under every message
 * is furniture; one is a place to look.
 */
export const TurnMenu: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLElement>(`.${cls("actions")} button`)
      ?.click();
  },
  render: () =>
    finished(BUNDLE, {
      what: "The turn's kebab: everything you can do with a finished change, grouped.",
    }),
};

/**
 * The same kebab with only one action wired.
 *
 * `hasTurnActions` gates the whole row, and each group inside it gates
 * separately — so a host that offers only Undo gets one entry and no headers,
 * rather than a menu of three empty sections.
 */
export const TurnMenuMinimal: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLElement>(`.${cls("actions")} button`)
      ?.click();
  },
  render: () =>
    finished(
      BUNDLE,
      {
        try: "compare with TurnMenu above — the grouping collapses rather than rendering headers over nothing",
        what: "A host offering only `onUndo`. The menu shrinks to one entry.",
      },
      { onUndo: noop }
    ),
};

/**
 * The pull-request confirmation.
 *
 * Pushing is the only thing in this application that cannot be taken back —
 * everything else has Undo or Discard — so it takes a second deliberate click.
 * A second menu rather than a native `confirm()`: it says exactly what will
 * happen, names the file count, and looks like the rest of the editor.
 *
 * The one genuine product decision in this file, and nothing else shows it.
 */
export const PrConfirm: StoryObj = {
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLElement>(`.${cls("actions")} button`)
      ?.click();
    // The menu builds its rows on open, so the entry does not exist until the
    // click above has run and the popover host has painted.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const entries = [
      ...document.querySelectorAll<HTMLElement>("[data-pop-item]"),
    ];
    entries.find((e) => e.textContent?.includes("Create pull"))?.click();
  },
  render: () =>
    finished(BUNDLE, {
      what: "The second click before a push. “This cannot be undone” is a header rather than a label, so it cannot be chosen by mistake.",
    }),
};

/**
 * A single file's ⋯ menu.
 *
 * Comment, open, copy path — scoped to one file rather than the turn. The
 * comment entry reads the *latched* line selection: pressing the button
 * collapses any text range before `click` fires, so the range is captured on
 * `pointerdown` and the menu built a moment later can still name the lines.
 */
export const FileMenu: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(`.${cls("diff-more")}`)?.click();
  },
  render: () =>
    finished(BUNDLE, {
      try: "select a few lines inside an expanded diff first, then open the ⋯ — the comment entry names the range",
      what: "The per-file menu, which is a different scope from the turn kebab below it.",
    }),
};
