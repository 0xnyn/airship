import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { icon } from "../icons";
import { plainStage } from "../stories/chrome";
import { noop } from "../stories/fixtures";
import { onStoryTeardown } from "../stories/lifecycle";
import { ALL_COMMANDS, ALL_GESTURES, displayChord } from "./catalog";
import { closePalette, openPalette } from "./palette";
import { keys } from "./registry";
import { closeShortcuts, openShortcuts } from "./shortcuts-panel";

/*
 * The input catalogue, and the two surfaces that render it.
 *
 * Everything here reads one table — `keys/catalog.ts`. Chords used to be string
 * literals at each `keys.bind` call site, which made three things impossible at
 * once: nothing could enumerate them (so there was no panel and no palette),
 * nothing could document them (so the README's six hand-written rows were the
 * whole reference, and its copy under `apps/cli/` had already drifted), and a
 * tooltip found its chord by matching its own *text* against a binding's label,
 * so rewording a tooltip silently dropped the chip.
 *
 * The first story is the visual canary for `displayChord`. Everything else in
 * the editor renders one chord at a time, in a tooltip, which is exactly the
 * condition under which a wrong glyph goes unnoticed for a year — the zoom
 * menu shipped `"⌘+"` for a binding that is `mod+=`, and shipped it to Windows.
 */

const meta: Meta = {
  title: "Foundations/Shortcuts",
};

export default meta;

/**
 * Every chord in the catalog, in both platforms' spelling.
 *
 * Side by side on purpose. `displayChord` takes the platform as an argument
 * rather than probing `navigator`, and this is where you can see that the two
 * columns really differ — a regression that collapsed them would be invisible
 * in the product to anyone on the platform they develop on.
 */
export const Catalogue: StoryObj = {
  render: () =>
    plainStage(
      [
        el(
          "div",
          {
            class: cls("sc-body"),
            style: "columns: 1; max-width: 720px; padding: 20px;",
          },
          ALL_COMMANDS.map((spec) =>
            el("div", { class: cls("sc-row") }, [
              el("span", { class: cls("sc-name") }, [
                el("span", { text: spec.title }),
                el("span", { class: cls("sc-why"), text: spec.group }),
              ]),
              el(
                "span",
                { class: cls("sc-keys") },
                (spec.primary ?? spec.keys).flatMap((chord) => [
                  el("kbd", {
                    class: cls("sc-key"),
                    text: displayChord(chord, "mac"),
                  }),
                  el("kbd", {
                    class: cls("sc-key"),
                    text: displayChord(chord, "pc"),
                  }),
                ])
              ),
            ])
          )
        ),
      ],
      {
        try: "compare the two chips on each row — macOS first, then Windows and Linux",
        what: `All ${ALL_COMMANDS.length} commands, rendered from the catalog in both platforms' spelling.`,
      }
    ),
};

/** The pointer half, which has no chord and used to have no documentation. */
export const Gestures: StoryObj = {
  render: () =>
    plainStage(
      [
        el(
          "div",
          {
            class: cls("sc-body"),
            style: "columns: 1; max-width: 720px; padding: 20px;",
          },
          ALL_GESTURES.map((spec) =>
            el("div", { class: cls("sc-row") }, [
              el("span", { class: cls("sc-name") }, [
                el("span", { text: spec.title }),
                el("span", { class: cls("sc-why"), text: spec.device }),
              ]),
              el("span", { class: cls("sc-keys") }, [
                el("kbd", { class: cls("sc-key"), text: spec.input }),
              ]),
            ])
          )
        ),
      ],
      {
        what: `All ${ALL_GESTURES.length} pointer gestures. Each names the symbol that implements it, and \`gestures.test.ts\` checks both directions.`,
      }
    ),
};

/** Bind enough of the catalog that the two surfaces have something to show. */
function bindSome(): void {
  for (const id of [
    "history.undo",
    "history.redo",
    "element.delete",
    "element.duplicate",
    "element.editText",
    "element.nudge",
    "selection.deselect",
    "tool.move",
    "tool.inspect",
    "chat.send",
    "help.shortcuts",
    "help.palette",
  ] as const) {
    onStoryTeardown(keys.bind({ id, run: noop }));
  }
}

/**
 * The `?` sheet.
 *
 * Rendered from the whole catalog, with the rows that are not live dimmed and
 * labelled — "canvas only", "edit mode". That is the opposite of the palette
 * below and it is the point: a reference that hides what you cannot currently
 * do is useless for the reason people open one. Here the zoom set is dimmed,
 * because this story binds no viewport.
 */
export const ShortcutsSheet: StoryObj = {
  play: () => {
    openShortcuts();
    // `closeShortcuts`, not a second `openShortcuts`: the opener toggles, so a
    // teardown that calls it again *opens* the sheet whenever the story left it
    // closed — the one case teardown exists for.
    onStoryTeardown(closeShortcuts);
  },
  render: () => {
    // The bindings in `render`, the open in `play`. `preview.ts` mounts the
    // popover host only *after* `story()` returns, so there is nowhere to open
    // into until then — the same ordering `tooltip.stories.ts` documents.
    bindSome();
    return plainStage([el("div", { style: "height: 520px;" })], {
      try: "look at the dimmed rows — each says why it is not live, rather than being hidden",
      what: "The shortcuts sheet, rendered from the catalog.",
    });
  },
};

/**
 * The ⌘K palette.
 *
 * Rendered from `keys.available()` — bound *and* allowed by its guard right
 * now. An action surface has to be able to run every row it shows, so the zoom
 * commands that the sheet above dims are simply absent here.
 */
export const Palette: StoryObj = {
  play: () => {
    openPalette();
    // Closed explicitly, for the reason the sheet above gives.
    onStoryTeardown(closePalette);
  },
  render: () => {
    bindSome();
    return plainStage([el("div", { style: "height: 520px;" })], {
      try: "type a few letters — the ranking is subsequence-first, so “dpl” finds Duplicate",
      what: "The command palette. Only what is runnable this second.",
    });
  },
};

/** The bar button that opens the sheet, with its chord resolved from the catalog. */
export const HelpButton: StoryObj = {
  render: () => {
    bindSome();
    return plainStage(
      [
        el("div", { class: cls("bar") }, [
          el(
            "button",
            {
              "aria-label": "Keyboard shortcuts",
              class: cls("iconbtn"),
              "data-key": "help.shortcuts",
              "data-tip": "Keyboard shortcuts",
              type: "button",
            },
            [icon("keyboard", "sm")]
          ),
        ]),
      ],
      {
        what: "The bar's help button. Outside both mode lists, so it survives the mode you are stuck in.",
      }
    );
  },
};
