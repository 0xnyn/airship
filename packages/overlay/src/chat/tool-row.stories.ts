import type { TimelineItem } from "@airship/protocol";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { dock, plainStage } from "../stories/chrome";
import { TIMELINE, TODOS } from "../stories/fixtures";
import { timelineView } from "./timeline";

/*
 * The chat timeline's rows — one renderer per `TimelineItem` kind.
 *
 * The grammar is Claude Code's, translated into the editor's tokens: a glyph
 * leading the tool name, an elbow rail under it carrying the one-line result,
 * and the full output behind a disclosure. One departure, and it is the point of
 * the design: where Claude Code repeats a single dot down the whole transcript,
 * the leading glyph here says *which* tool, which is what makes a long turn
 * skimmable without reading a label.
 *
 * These are the easiest stories in the catalogue and among the most useful,
 * because a timeline row is a pure function of one protocol object. Getting a
 * live agent to produce a failed `Bash`, a truncated `Read` and a still-pending
 * `Edit` in the same turn — on demand, for a screenshot — is otherwise a matter
 * of luck and a broken repo.
 *
 * They go through `timelineView().hydrate()` rather than calling `timelineRow`
 * directly. That is the same door replay uses, so a story cannot drift from what
 * a persisted `~/.airship/history` bundle actually renders as.
 */

const meta: Meta = {
  title: "Chat/Timeline rows",
};

export default meta;

/** A timeline inside the left dock, which is where it actually lives. */
function transcript(items: TimelineItem[], collapsed = false): HTMLElement {
  const view = timelineView();
  view.hydrate(items);
  view.setCollapsed(collapsed);
  return dock(el("div", { class: cls("transcript") }, [view.root]), {
    label: "Agent",
  });
}

/**
 * A whole turn: thinking, four tools, a todo list and streaming prose.
 *
 * The first thing to judge is the rhythm down the left edge. The glyph column is
 * what carries the skim, and it only works if the glyphs stay distinguishable at
 * 12px from a metre away.
 */
export const Turn: StoryObj = {
  render: () =>
    plainStage([transcript(TIMELINE)], {
      try: "judge the rhythm down the left edge — the glyph column is what carries the skim, and only works if the glyphs stay apart at 12px",
      what: "A whole turn: thinking, four tools, a todo list and streaming prose.",
    }),
};

/**
 * The same turn folded shut — the post-completion resting state.
 *
 * `setCollapsed` drives each row's own `setOpen` rather than putting a class on
 * the timeline root. Doing the latter is what made every finished turn's rows
 * permanently un-expandable: a descendant `display: none` outranks the row's own
 * bookkeeping, so clicking a header appended the body and flipped
 * `aria-expanded` while the body stayed invisible.
 */
export const Collapsed: StoryObj = {
  render: () =>
    plainStage([transcript(TIMELINE, true)], {
      try: "expand a row — it must actually open, which it did not when collapsing was a class on the timeline root",
      what: "The same turn folded shut, which is its resting state once finished.",
    }),
};

/**
 * The three tool phases together.
 *
 * `pending` has no `endedAt` and no `result` — the row must say the tool is
 * running without implying a result it does not have. `error` carries a real
 * stderr tail. `ok` carries the one-line summary that has to be readable while
 * collapsed, which is why it sits outside the disclosure.
 */
export const Phases: StoryObj = {
  render: () =>
    plainStage([transcript(TIMELINE.filter((i) => i.kind === "tool"))], {
      what: "All three tool phases together: pending with no result to imply, error with a real stderr tail, and ok with its one-line summary.",
    }),
};

/**
 * A truncated result.
 *
 * `ToolResultSummary` is pre-capped by `@airship/core` — a `Read` returns a whole
 * file and a build returns hundreds of KB, none of which should cross the wire
 * or land in `~/.airship/history`. `droppedLines` is what the "… +N lines"
 * affordance counts, and `truncated` is what makes the row admit it rather than
 * presenting a clipped tail as if it were the whole output.
 */
export const Truncated: StoryObj = {
  render: () => {
    const item = TIMELINE.find((i) => i.kind === "tool" && i.result?.truncated);
    if (!item) {
      throw new Error("No truncated fixture in TIMELINE");
    }
    return plainStage([transcript([item])], {
      what: "A capped result. `droppedLines` is what the “+N lines” affordance counts, and `truncated` is what makes the row admit it rather than passing a clipped tail off as the whole output.",
    });
  },
};

/**
 * The todo list, with all three statuses.
 *
 * Keyed on the `TodoWrite` tool-use id, so a re-write patches the list in place
 * rather than appending a second one — which is why a long turn shows one
 * evolving checklist instead of six copies of it.
 */
export const Todos: StoryObj = {
  render: () =>
    plainStage(
      [transcript([{ id: "todo", kind: "todos", startedAt: 0, todos: TODOS }])],
      {
        what: "The todo list at all three statuses. It is keyed on the tool-use id, so a re-write patches in place instead of appending a second list.",
      }
    ),
};

/**
 * Thinking, streaming and redacted.
 *
 * The redacted case is real rather than hypothetical: during it the API streams
 * only token estimates, so `text` is `""` and the row renders `estimatedTokens`
 * instead of an empty box.
 */
export const Thinking: StoryObj = {
  render: () =>
    plainStage(
      [
        transcript([
          {
            id: "th1",
            kind: "thinking",
            startedAt: 0,
            streaming: true,
            text: "The hero button is probably Tailwind-styled. I should find the component rather than guessing at class names.",
          },
          {
            estimatedTokens: 1280,
            id: "th2",
            kind: "thinking",
            startedAt: 10,
            streaming: true,
            text: "",
          },
        ]),
      ],
      {
        what: "Thinking, streaming and redacted. The redacted case is real: the API streams only token estimates, so the row shows a count rather than an empty box.",
      }
    ),
};

/**
 * Assistant prose, which is markdown rendered in sans.
 *
 * Deliberately outside the tool grammar — no glyph, no rail. It is the agent
 * talking, and it should not look like a tool call.
 */
export const Prose: StoryObj = {
  render: () =>
    plainStage(
      [
        transcript([
          {
            id: "p1",
            kind: "text",
            startedAt: 0,
            text: "I've updated the hero button to use a **larger radius** and the `blue-600` background.\n\n- Padding is now `px-6 py-3`\n- The hover state brightens rather than darkening\n\nOne type error came back from `pnpm typecheck`, which I'm fixing now.",
          },
        ]),
      ],
      {
        what: "Assistant prose — markdown in sans, deliberately outside the tool grammar with no glyph and no rail.",
      }
    ),
};

/** An empty timeline — what the dock shows before the first turn. */
export const Empty: StoryObj = {
  render: () =>
    plainStage([transcript([])], {
      what: "A timeline with nothing in it yet, which is what the first few hundred milliseconds of every turn look like.",
    }),
};
