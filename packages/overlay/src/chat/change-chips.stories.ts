import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { icon } from "../icons";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { BRAND, noop } from "../stories/fixtures";
import { onStoryTeardown } from "../stories/lifecycle";
import {
  attachRailKeys,
  attachRailWheel,
  type ChangeChip,
  renderChangeChips,
  shortValue,
} from "./change-chips";

/*
 * The composer's pending-change strip.
 *
 * Every direct-manipulation edit waiting to be sent gets its own chip with its
 * own ✕. This replaced a single filled-accent pill reading "3 style changes + 1
 * move", whose ✕ discarded *everything* — so backing out one bad tweak meant
 * throwing away the other four and redoing them by hand.
 *
 * Two things about this strip are decisions rather than styling, and both are
 * only legible when you can see several chips at once, which the running editor
 * makes you assemble by hand one tweak at a time:
 *
 * **The chips are deliberately quiet.** A hover surface, a hairline border,
 * secondary text. They sit inches from the accent-filled Send button, and two
 * blue things side by side both claiming to be the important one is worse than
 * either. The *selection* chip keeps the accent, which makes it the one coloured
 * thing in the row — the hierarchy the strip actually wants, and the reason
 * every story here places it first.
 *
 * **"Discard all" appears at two chips, not one.** With a single chip it would
 * be a second control doing exactly what the first one does.
 *
 * **A chip is three fields, not a sentence.** Subject, detail and value, told
 * apart by tone alone, because the strip has no colour left to spend. They were
 * one space-joined string until a user pointed at "RootDocument flex 0 0" and
 * asked what it meant.
 */

const meta: Meta = {
  title: "Chat/Change chips",
};

export default meta;

/** The accent selection chip the composer places before any change chips. */
function selectionChip(label: string): HTMLElement {
  return el(
    "span",
    {
      class: cls("sel-chip"),
      "data-chip": "",
      "data-tip": label,
      tabindex: "-1",
    },
    [
      icon("tool-move", "sm"),
      el("span", { class: cls("chip-subject"), text: label }),
      el(
        "span",
        { class: cls("chip-x"), onClick: noop, role: "button", tabindex: "-1" },
        [icon("close", "sm")]
      ),
    ]
  );
}

/**
 * One style chip, as `AirshipApp.styleChips` builds it.
 *
 * No glyph. A style chip used to carry `settings` — the same mark on every one
 * of them, which is the one fact a strip of style chips never needs told twelve
 * times, and it cost 26px of rail each time. A per-property icon was never the
 * alternative: at chip size that would be forty unlearnable marks. What tells
 * two chips apart is the text, so the text is all there is. The kinds that stay
 * distinguishable at this size keep theirs — `drag` for a move, `minus` and
 * `plus` for a delete and a duplicate.
 */
const chip = (
  element: string,
  property: string,
  value: string
): ChangeChip => ({
  detail: property,
  onRemove: noop,
  subject: element,
  tip: `${element} — ${property}: ${value}`,
  value: shortValue(value),
});

const moveChip = (element: string): ChangeChip => ({
  detail: "moved",
  icon: "drag",
  onRemove: noop,
  subject: element,
  tip: `${element} moved`,
});

const CHIPS: ChangeChip[] = [
  chip("Button", "border-radius", "12px"),
  chip("Button", "padding", "24px 32px"),
  chip("Button", "background", BRAND),
  moveChip("Badge"),
];

/**
 * The strip inside a real composer field.
 *
 * `.field` is the single bordered box the chips, the textarea and Send all
 * share — the composer used to spend ~145px at rest on its own padding and a
 * labelled Send pill on a line of its own. A chip strip shown outside it is a
 * row of pills with nothing to be crowded by, which is the only question worth
 * asking about them.
 */
function composer(chips: ChangeChip[], caption: Caption): HTMLElement {
  const strip = el("div", { class: `${cls("sel-chips")} ${cls("scroll-x")}` }, [
    selectionChip("<button>"),
  ]);
  renderChangeChips(strip, chips, noop);
  // The rail's behaviour is the point of the Overflow story, and it lives in
  // listeners rather than in CSS — so the stories install it the way the
  // composer does rather than rendering a strip that only looks right.
  onStoryTeardown(attachRailWheel(strip));
  onStoryTeardown(attachRailKeys(strip));

  const field = el("div", { class: cls("field") }, [
    strip,
    el("div", {
      class: cls("input"),
      text: "Describe a change…",
    }),
    el(
      "button",
      {
        "aria-label": "Send",
        class: `${cls("action")} ${cls("action-icon")} ${cls("primary")} ${cls("send")}`,
        type: "button",
      },
      [icon("chev-up", "sm")]
    ),
  ]);

  return plainStage(
    [
      dock(el("div", { class: cls("composer") }, [field]), {
        label: "Agent",
      }),
    ],
    caption
  );
}

/**
 * One pending change.
 *
 * No "Discard all", by the two-chip rule. The single ✕ already does everything
 * a bulk action could.
 */
export const One: StoryObj = {
  render: () =>
    composer([CHIPS[0]], {
      what: "A single pending edit beside the selection chip. No bulk action, because there is nothing for it to do that the chip's own ✕ does not.",
    }),
};

/**
 * Four changes and the bulk discard.
 *
 * The ordinary working state after a minute in the inspector, and the one to
 * judge the hierarchy on: the selection chip is accented, the change chips are
 * not, and Send is the only other coloured thing in the row.
 */
export const Several: StoryObj = {
  render: () =>
    composer(CHIPS, {
      try: "look at what is coloured — the selection chip and Send, and nothing between them",
      what: "Four pending edits, which is where “Discard all” appears.",
    }),
};

/**
 * More chips than the strip is wide.
 *
 * The chips are `flex: 0 0 auto`, so they keep their size rather than
 * compressing into illegibility — which means the strip has to scroll, and for
 * a long time it did so in complete silence. The scrollbar was hidden
 * (`scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`), there
 * was no wheel handler, and nothing marked the ends.
 *
 * That reads as a clean composer on a trackpad, where a two-finger swipe sends
 * `deltaX` and scrolls the rail natively. On a mouse it is a bug: every wheel a
 * mouse sends is `deltaY`, a box that only overflows on X ignores it, and the
 * ninth chip cannot be reached at all. The people who built it were on
 * trackpads. This is the story that would have caught it.
 *
 * Four affordances now, and it takes all four: a thin scrollbar that tints on
 * hover, a fade on whichever end has more, a wheel handler that turns vertical
 * delta into horizontal scroll, and ←/→ to walk the chips.
 */
export const Overflow: StoryObj = {
  render: () =>
    composer(
      [
        ...CHIPS,
        chip("Button", "box-shadow", "0 8px 24px rgba(0,0,0,.12)"),
        chip("Card", "width", "min(100%, 420px)"),
        chip("Card", "gap", "12px"),
        chip("Title", "font-weight", "650"),
        chip("Title", "opacity", "0.92"),
      ],
      {
        try: "scroll with a wheel over the strip, then tab to it and walk it with ← and →",
        what: "Nine chips in a strip built for four. They scroll rather than compress, and now they say so.",
      }
    ),
};

/**
 * Values long enough to need `shortValue`.
 *
 * A chip has to stay a chip. `shortValue` truncates the *value* to fourteen
 * characters and the full text moves to the tooltip — which is why `ChangeChip`
 * carries `tip` separately rather than letting the visible fields be the whole
 * truth.
 *
 * The subject is not truncated in TS at all: it ellipsises in CSS, so it is the
 * field that gives way first when the rail is narrow. That is deliberate — a
 * component display name has a long tail, and losing the end of "PricingCardHeader"
 * costs less than losing the property you changed.
 */
export const LongValues: StoryObj = {
  render: () =>
    composer(
      [
        chip("Button", "transition", "cubic-bezier(0.16, 1, 0.3, 1) 240ms"),
        chip(
          "Title",
          "font-family",
          'ui-sans-serif, system-ui, "Segoe UI", Roboto'
        ),
        chip("Tile", "background", "linear-gradient(160deg, #e9f2ff, #cfe2ff)"),
      ],
      {
        try: "hover one — the truncated label is the chip, and the tooltip is the value",
        what: "Values well past `shortValue`'s fourteen-character budget.",
      }
    ),
};
