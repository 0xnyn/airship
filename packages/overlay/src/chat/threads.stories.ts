import type { JobHistorySummary } from "@airship/protocol";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { icon } from "../icons";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { HISTORY, HISTORY_NOW, noop } from "../stories/fixtures";
import { renderThreads } from "./threads";

/*
 * The past-chats drawer.
 *
 * A flat list of jobs arrives from the server and `groupThreads` folds it into
 * conversations by walking `parentJobId` to a root — so three refinements of one
 * edit are one row reading "3 edits", not three rows saying nearly the same
 * thing. The root job's prompt titles the thread; the *newest* edit's timestamp
 * and status drive the ordering and the glyph, which is what makes a
 * long-running conversation sort to the top rather than sinking to where it
 * started.
 *
 * These stories needed a small extraction to exist at all. The rows were built
 * by `AirshipApp.renderHistory`, a private method on a class that owns a socket,
 * a stage and a selection controller — unreachable from a story, and copying its
 * markup here would have been a fixture that drifts rather than a picture of the
 * thing. `renderThreads` now lives beside `groupThreads` and `renderHistory`
 * calls it.
 *
 * The clock is injected. `relativeTime` has four bands and the boundaries are
 * the interesting part, so pinning `now` turns "what does an old thread look
 * like" from something you wait a week for into something you read.
 */

const meta: Meta = {
  title: "Chat/Past chats",
};

export default meta;

/** The drawer, with the head `renderHistory` puts above the list. */
function drawer(entries: JobHistorySummary[], caption: Caption): HTMLElement {
  const host = el("div", { class: cls("drawer") }, [
    el("div", { class: cls("drawer-head") }, [
      el("div", { class: cls("eyebrow"), text: "Past chats" }),
      el(
        "button",
        {
          "aria-label": "Close",
          class: `${cls("action")} ${cls("action-icon")}`,
          type: "button",
        },
        [icon("close", "sm")]
      ),
    ]),
  ]);
  renderThreads(host, entries, { now: HISTORY_NOW, onOpen: noop });
  return plainStage([dock(host, { label: "Agent" })], caption);
}

/**
 * Three conversations, one of them three edits deep.
 *
 * `job-b1` → `job-b2` → `job-b3` chain through `parentJobId` and collapse into a
 * single row. Its title comes from the *root* prompt — "Tighten the card grid" —
 * while its timestamp and its running glyph come from the newest edit in the
 * chain, which is the pair of choices that makes the list read as conversations
 * rather than as a log.
 */
export const Grouped: StoryObj = {
  render: () =>
    drawer(HISTORY, {
      try: "find the “3 edits” row — that is five history entries folded into three threads",
      what: "The flat history folded into conversations. A thread is titled by its root and dated by its newest edit.",
    }),
};

/**
 * The three status glyphs.
 *
 * Done, running and failed, which in the running editor arrive minutes or days
 * apart. A thread takes the status of its newest edit, so a conversation that
 * ended in a failure reads as failed however well it started.
 */
export const Statuses: StoryObj = {
  render: () =>
    drawer(
      HISTORY.filter((e) => !e.parentJobId).concat(
        HISTORY.filter((e) => e.jobId === "job-b3")
      ),
      {
        what: "Check, dot and cross — done, running and failed, taken from the newest edit in each thread.",
      }
    ),
};

/**
 * `relativeTime`'s four bands, pinned.
 *
 * Under a minute is "now" rather than "0m"; then minutes, then hours, then days.
 * The fixture's timestamps are fixed offsets from an injected `now`, so this is
 * the same picture on every run — which is the whole reason the parameter exists.
 */
export const Ages: StoryObj = {
  render: () =>
    drawer(
      [
        HISTORY[0],
        { ...HISTORY[1], jobId: "age-m", parentJobId: undefined },
        { ...HISTORY[3], jobId: "age-h", parentJobId: undefined },
        { ...HISTORY[4], jobId: "age-d", parentJobId: undefined },
      ],
      {
        try: "read the meta lines top to bottom — now, 5m, 3h, 6d, which is every band the label has",
        what: "One thread per band of `relativeTime`, against a fixed clock so the labels never drift.",
      }
    ),
};

/** Nothing sent yet — the drawer's own designed state. */
export const Empty: StoryObj = {
  render: () =>
    drawer([], {
      what: "No conversations. `md` rather than `sm`, because this covers the whole dock rather than sitting inside a section.",
    }),
};
