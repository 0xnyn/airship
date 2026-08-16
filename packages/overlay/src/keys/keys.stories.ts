import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el, PREFIX } from "../dom";
import { icon } from "../icons";
import { plainStage } from "../stories/chrome";
import { noop } from "../stories/fixtures";
import { onStoryTeardown } from "../stories/lifecycle";
import { ALL_COMMANDS, ALL_GESTURES, displayChordParts } from "./catalog";
import { chordChips } from "./chips";
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
            // The chip track is a custom property, normally set by the `.sc-sect`
            // these rows would be inside. There is no section here, and both
            // stories need more room than a command section's 112px anyway:
            // `Catalogue` puts *two* chips on every row (mac, then pc — four for
            // Redo) and `Gestures` puts a phrase.
            style: `columns: 1; max-width: 720px; padding: 20px; --${PREFIX}-sc-chord-w: 260px;`,
          },
          ALL_COMMANDS.map((spec) =>
            el("div", { class: cls("sc-row") }, [
              el("span", { class: cls("sc-name") }, [
                el("span", { text: spec.title }),
                el("span", { class: cls("sc-why"), text: spec.group }),
              ]),
              // Both spellings of every chord, through the product's own chip
              // renderer — so a regression in how a chord is broken into keys
              // shows up here rather than only in the two live surfaces.
              chordChips(
                (spec.primary ?? spec.keys).flatMap((chord) => [
                  displayChordParts(chord, "mac"),
                  displayChordParts(chord, "pc"),
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
            // The chip track is a custom property, normally set by the `.sc-sect`
            // these rows would be inside. There is no section here, and both
            // stories need more room than a command section's 112px anyway:
            // `Catalogue` puts *two* chips on every row (mac, then pc — four for
            // Redo) and `Gestures` puts a phrase.
            style: `columns: 1; max-width: 720px; padding: 20px; --${PREFIX}-sc-chord-w: 260px;`,
          },
          ALL_GESTURES.map((spec) =>
            el("div", { class: cls("sc-row") }, [
              el("span", { class: cls("sc-name") }, [
                el("span", { text: spec.title }),
                el("span", { class: cls("sc-why"), text: spec.device }),
              ]),
              chordChips([[spec.input]]),
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
 *
 * Its `play` is the assertion that the rows are in columns. That is not a thing
 * the unit suite can see — happy-dom does no layout — and it is exactly what was
 * wrong: the row composed `.pop-item`, whose `justify-content: space-between`
 * put the body between two zero-width placeholders, so a title's x-position was
 * a function of the icon and chord widths beside it and no two rows agreed.
 */
export const Palette: StoryObj = {
  play: async () => {
    openPalette();
    // Closed explicitly, for the reason the sheet above gives.
    onStoryTeardown(closePalette);
    // The tracks are `max-content`/`fit-content`, so they are only right once
    // the real face has replaced the fallback and been measured against.
    await document.fonts.ready;

    const titles = [
      ...document.querySelectorAll<HTMLElement>(`.${cls("palette-title")}`),
    ];
    if (titles.length < 5) {
      throw new Error(
        `The palette listed ${titles.length} rows, expected more.`
      );
    }
    const lefts = new Set(
      titles.map((node) => Math.round(node.getBoundingClientRect().left))
    );
    if (lefts.size !== 1) {
      throw new Error(
        `Titles start at ${lefts.size} different edges: ${[...lefts].join(", ")}px. ` +
          "The columns come from `.palette-list`'s subgrid, not from each row."
      );
    }

    const docs = [
      ...document.querySelectorAll<HTMLElement>(`.${cls("palette-doc")}`),
    ];
    const docLefts = new Set(
      docs.map((node) => Math.round(node.getBoundingClientRect().left))
    );
    if (docLefts.size !== 1) {
      throw new Error(
        `Sentences start at ${docLefts.size} different edges: ${[...docLefts].join(", ")}px.`
      );
    }
    /*
     * And the sentence is the thing that gives way.
     *
     * Asserted as "the chord column does not move" rather than "some sentence is
     * truncated", which would be a test that the palette is too narrow — it
     * would start failing the day the copy got shorter, which is the wrong way
     * round. What matters is that a long sentence cannot push anything: it used
     * to be a flex item with the initial `min-width: auto`, so its min-content
     * width was the whole sentence and it widened the row rather than eliding,
     * which is also why the ellipsis it declared could never fire.
     */
    const chords = [
      ...document.querySelectorAll<HTMLElement>(
        `.${cls("palette-row")} > .${cls("keys")}`
      ),
    ];
    const rights = new Set(
      chords.map((node) => Math.round(node.getBoundingClientRect().right))
    );
    if (rights.size !== 1) {
      throw new Error(
        `Chords end at ${rights.size} different edges: ${[...rights].join(", ")}px — ` +
          "a sentence is pushing the row rather than eliding."
      );
    }
    const list = document.querySelector<HTMLElement>(`.${cls("palette-list")}`);
    if (list && list.scrollWidth > list.clientWidth + 1) {
      throw new Error(
        `The results overflow their card by ${list.scrollWidth - list.clientWidth}px.`
      );
    }
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
            [icon("question", "sm")]
          ),
        ]),
      ],
      {
        what: "The bar's help button. Outside both mode lists, so it survives the mode you are stuck in.",
      }
    );
  },
};
