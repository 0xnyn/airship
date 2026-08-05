import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { icon } from "../icons";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { BRAND, noop } from "../stories/fixtures";
import { type ChangeChip, renderChangeChips, shortValue } from "./change-chips";

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
 */

const meta: Meta = {
  title: "Chat/Change chips",
};

export default meta;

/** The accent selection chip the composer places before any change chips. */
function selectionChip(label: string): HTMLElement {
  return el("span", { class: cls("sel-chip"), "data-tip": label }, [
    icon("tool-move", "sm"),
    el("span", { text: label }),
    el("span", { class: cls("chip-x"), onClick: noop }, [icon("close", "sm")]),
  ]);
}

/**
 * One style chip, as `AirshipApp.styleChips` builds it.
 *
 * The glyph is `settings` for *every* style chip — not a per-property icon —
 * and the label carries the element, the property and a shortened value. That is
 * a real decision rather than an oversight: at chip size a distinct glyph per
 * CSS property would be forty unlearnable marks, and what distinguishes two
 * chips is the text. Structure chips use `drag`, which is the one distinction
 * that survives at this size.
 */
const chip = (
  element: string,
  property: string,
  value: string
): ChangeChip => ({
  icon: "settings",
  label: `${element} ${property} ${shortValue(value)}`,
  onRemove: noop,
  tip: `${element} — ${property}: ${value}`,
});

const moveChip = (element: string): ChangeChip => ({
  icon: "drag",
  label: `${element} moved`,
  onRemove: noop,
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
  const strip = el("div", { class: cls("sel-chips") }, [
    selectionChip("<button>"),
  ]);
  renderChangeChips(strip, chips, noop);

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
 * It scrolls horizontally with no visible scrollbar (`::-webkit-scrollbar {
 * display: none }`), which is a deliberate trade: a scrollbar inside a composer
 * field is three pixels of chrome on a control that is already dense. The chips
 * are `flex: 0 0 auto`, so they keep their size rather than compressing into
 * illegibility.
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
        try: "drag the strip sideways — it scrolls, and the scrollbar is hidden on purpose",
        what: "Nine chips in a strip built for four. They scroll rather than compress.",
      }
    ),
};

/**
 * Values long enough to need `shortValue`.
 *
 * A chip has to stay a chip. The label is truncated to fourteen characters and
 * the full value moves to the tooltip — which is why `ChangeChip` carries `tip`
 * separately rather than letting the label be the whole truth.
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
