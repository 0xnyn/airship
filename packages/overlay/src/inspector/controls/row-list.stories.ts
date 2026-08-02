import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../../dom";
import {
  type Caption,
  grid,
  inspectorBody,
  section,
  stage,
} from "../../stories/chrome";
import { noop } from "../../stories/fixtures";
import { splitTop } from "../css-value";
import { labelled } from "../sections/row";
import { createNumField } from "./num-field";
import { createRowList, type RowListSpec } from "./row-list";

/*
 * The repeatable-layer engine behind Fill, Stroke, Effects and Filters.
 *
 * Those four sections are the same control four times — a list of layers, each
 * with an eye to disable it and a minus to remove it, and a `+` in the section
 * header to add one. Writing that four times is how four sections end up subtly
 * disagreeing about what the eye does, so it is written once, and this is the
 * only place it can be looked at on its own.
 *
 * Two things here are behaviour rather than appearance, and neither is visible
 * in a screenshot:
 *
 * **The eye is a row-local flag, not a CSS property.** A disabled row keeps its
 * values and is dropped from the serialised output, because a shadow you
 * switched off should not appear in the source the agent reads. That makes the
 * round trip through CSS *lossy by design*, and the whole of `setValue` exists
 * to stop that loss eating the rows the eye is meant to be keeping. `EchoIgnored`
 * below is that guard, run.
 *
 * **Reordering is two buttons, not a drag.** Order is semantics in every list
 * this renders — shadows paint back-to-front, and `blur()` before `brightness()`
 * is a different image from the reverse — and for a long time there was no way
 * to reorder at all. Buttons rather than a drag because two icons are
 * keyboard-operable, announceable, and need no hit-testing, pointer capture or
 * autoscroll. A list of two to five rows does not need a drag to be quick.
 */

const meta: Meta = {
  title: "Inspector/Controls/Row list",
};

export default meta;

/** A minimal layer type: enough to serialise, enough to disable. */
interface Layer {
  on: boolean;
  value: string;
}

/**
 * `splitTop`, not `String.split(",")`.
 *
 * Every value in these lists contains commas *inside* parentheses —
 * `rgba(0, 0, 0, .06)` is one shadow, not four — so a naive split turns three
 * layers into eleven. The real specs all use this for the same reason.
 */
const parse = (css: string): Layer[] =>
  splitTop(css)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => ({ on: true, value }));

const serialize = (rows: Layer[]): string =>
  rows
    .filter((r) => r.on)
    .map((r) => r.value)
    .join(", ");

/** A one-line row, which is the shape that needs no action slot. */
const SPEC: RowListSpec<Layer> = {
  blank: () => ({ on: true, value: "0 1px 2px rgba(0,0,0,.12)" }),
  cssProperty: "box-shadow",
  enabled: (row) => row.on,
  parse,
  render: (row, onEdit) =>
    createNumField(
      { glyph: "effect-drop-shadow", label: "Shadow", unit: "" },
      row.value,
      (next) => onEdit({ ...row, value: String(next) })
    ).element,
  serialize,
  setEnabled: (row, on) => ({ ...row, on }),
};

/**
 * A row that stacks, and therefore names the line its actions belong on.
 *
 * `actionSlot` exists for exactly this. With `align-items: center` the eye and
 * minus landed at the geometric midpoint of the block — for a shadow, 57px down
 * a 114px column, in the 2px gutter between the offsets and the blur — and
 * because the block gets shorter when the offsets fit four across, where they
 * landed moved with the dock width.
 */
const STACKED_SPEC: RowListSpec<Layer> = {
  ...SPEC,
  // The same selector `sections/filters.ts` uses, and for the same reason: only
  // the stacking row has a head, and returning `null` for the rest is what keeps
  // a one-line row's actions beside it.
  actionSlot: (content) =>
    content.querySelector<HTMLElement>(`.${cls("filter-shadow-head")}`),
  render: (row, onEdit) => {
    const head = el("div", { class: cls("filter-shadow-head") }, [
      el("span", { class: cls("filter-name") }, [
        el("span", { class: cls("filter-label"), text: "Drop shadow" }),
      ]),
    ]);
    return el("div", { class: cls("filter-shadow") }, [
      head,
      el("div", { class: cls("filter-shadow-nums") }, [
        grid([
          createNumField({ glyph: "X", label: "X", unit: "px" }, "0", noop)
            .element,
          createNumField({ glyph: "Y", label: "Y", unit: "px" }, "8", noop)
            .element,
          createNumField(
            { glyph: "effect-blur", label: "Blur", unit: "px" },
            "24",
            noop
          ).element,
          createNumField(
            { glyph: "effect-drop-shadow", label: "Spread", unit: "px" },
            "0",
            (next) => onEdit({ ...row, value: String(next) })
          ).element,
        ]),
      ]),
    ]);
  },
};

function list(
  spec: RowListSpec<Layer>,
  initial: string,
  caption: Caption,
  label = "Effects"
): HTMLElement {
  return stage(
    inspectorBody([section(label, createRowList(spec, initial, noop).element)]),
    { caption }
  );
}

/**
 * Three layers, the middle one switched off.
 *
 * The disabled row keeps its value and takes `.rows-off`. Note the arrows:
 * disabled at the ends rather than hidden, so a row's controls do not reflow as
 * it moves through the list.
 */
export const Layers: StoryObj = {
  render: () => {
    const handle = createRowList(
      SPEC,
      "0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08), inset 0 0 0 1px #0D99FF",
      noop
    );
    // Through the eye rather than by seeding a disabled row, because the state
    // this story is about is one the control produced, not one it was handed.
    handle.element
      .querySelectorAll<HTMLElement>(`.${cls("rows-row")}`)[1]
      ?.querySelector<HTMLElement>('[aria-label="Hide"]')
      ?.click();

    return stage(inspectorBody([section("Effects", handle.element)]), {
      caption: {
        try: "move a row with the arrows — order is semantics here, since shadows paint back-to-front",
        what: "Three layers with the middle one switched off. It keeps its value and leaves the serialised CSS.",
      },
    });
  },
};

/**
 * One row, which gets no arrows at all.
 *
 * `rows.length > 1` gates them, because a control offering to reorder a
 * single-item list is offering nothing.
 */
export const Single: StoryObj = {
  render: () =>
    list(SPEC, "0 8px 24px rgba(0,0,0,.08)", {
      what: "A single layer: eye and minus, and no reorder arrows, because there is nowhere to move to.",
    }),
};

/**
 * Nothing. Not a "None" row.
 *
 * This used to render one, reasoning that a placeholder sized to the control
 * height stopped the section jumping when the first layer was added. It buys
 * that at the cost of stating a value the element does not have, and it does not
 * survive contact with a section that stacks two lists: Filters showed "Layer /
 * None / Background / None" for the overwhelmingly common case of an element
 * with no filters at all.
 */
export const Empty: StoryObj = {
  render: () =>
    list(SPEC, "", {
      what: "An empty list, which renders nothing. The section header's `+` is the affordance, and it already exists.",
    }),
};

/**
 * A stacking row, with its actions pinned to its first line.
 *
 * The comparison with `Layers` above is the whole story: same eye, same minus,
 * same arrows, deliberately placed rather than centred.
 */
export const StackedActions: StoryObj = {
  render: () =>
    list(
      STACKED_SPEC,
      "0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)",
      {
        try: "drag the dock's edge narrower — the actions stay on the row's first line rather than sliding with the block's height",
        what: "A row that stacks a label over four fields, with the eye and minus anchored to the line they act on.",
      }
    ),
};

/**
 * The echo guard, run.
 *
 * `panel.reseed` pushes computed style back at every registered control after
 * any refresh — a nudge, an undo, a discard. That value is the browser's
 * normalisation of what this list itself last wrote, so a naive `setValue` would
 * re-parse it, find the disabled rows missing (they are absent from the CSS *by
 * design*) and delete them. Hiding a shadow and then pressing an arrow key used
 * to remove it outright, with no undo entry for the deletion.
 *
 * This story disables a row and then feeds the control its own serialised
 * output. The `play` asserts the row survived.
 */
export const EchoIgnored: StoryObj = {
  play: ({ canvasElement }) => {
    const rows = canvasElement.querySelectorAll(`.${cls("rows-row")}`);
    if (rows.length !== 3) {
      throw new Error(
        `Expected 3 rows after the echo, found ${rows.length}. The lossy round ` +
          "trip has eaten a disabled row — see `setValue` in row-list.ts."
      );
    }
    if (!rows[1].classList.contains(cls("rows-off"))) {
      throw new Error("The middle row is no longer disabled.");
    }
  },
  render: () => {
    const handle = createRowList(
      SPEC,
      "0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08), inset 0 0 0 1px #0D99FF",
      noop
    );
    handle.element
      .querySelectorAll<HTMLElement>(`.${cls("rows-row")}`)[1]
      ?.querySelector<HTMLElement>('[aria-label="Hide"]')
      ?.click();

    // The echo: exactly what this list just serialised, which is what a reseed
    // hands back. The disabled row is not in it, and must survive anyway.
    handle.setValue?.(
      "box-shadow",
      "0 1px 2px rgba(0,0,0,.06), inset 0 0 0 1px #0D99FF"
    );

    return stage(
      inspectorBody([
        section("Effects", handle.element),
        section(
          "What just happened",
          labelled(
            "Echo",
            el("span", {
              style:
                "font: 400 10px var(--ap-font-mono); color: var(--ap-text-tertiary);",
              text: "setValue with its own output",
            })
          )
        ),
      ]),
      {
        caption: {
          try: "there must still be three rows, and the middle one must still be off — the `play` fails the story if not",
          what: "A disabled row, followed by the control being handed back its own serialised value, which does not contain it.",
        },
      }
    );
  },
};
