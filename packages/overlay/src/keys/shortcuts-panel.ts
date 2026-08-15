/**
 * The keyboard-and-mouse reference, opened with `?`.
 *
 * Before this there was no discovery surface at all. Twenty-seven of the
 * thirty-three shortcuts appeared nowhere in the product and nowhere in the
 * READMEs, and the only way to find one was to hover a button whose tooltip
 * happened to name a binding — which left Nudge, Deselect, Duplicate, Edit
 * text, Zoom to 100%, Zoom to selection and every popover key invisible.
 *
 * Rendered from the **catalog**, not from `keys.available()`. That is the one
 * real design decision here and it is the opposite of the palette's: this is a
 * reference, so a row you cannot currently use still has to be on it, dimmed
 * and labelled with *why* — "edit mode", "canvas only". Hiding it would answer
 * "what can I do right now", which is a question the palette already answers
 * better, and would make the panel useless for the thing people open a
 * shortcuts sheet to do, which is learn what exists.
 *
 * Gestures share the sheet. They are the half of the input surface that has no
 * chord and no palette row, and the half the user was complaining about.
 */
import { cls, el } from "../dom";
import { icon } from "../icons";
import { openPopover, type PopoverHandle } from "../popover-host";
import {
  ALL_COMMANDS,
  ALL_GESTURES,
  COMMAND_GROUPS,
  type Command,
  type GestureSpec,
  NOTES,
} from "./catalog";
import { keys } from "./registry";

let open: PopoverHandle | null = null;

export function closeShortcuts(): void {
  open?.close("programmatic");
  open = null;
}

/**
 * Why a row is not live, or null if it is.
 *
 * Read off the catalog rather than from the binding table, because the answer
 * has to be a *sentence* — "canvas only" tells you to switch surfaces, while
 * "not bound" tells you nothing you can act on.
 */
function unavailable(spec: Command): string | null {
  if (keys.isBound(spec.id)) {
    return null;
  }
  // `where` first: a scoped command is live exactly while some particular
  // thing is on screen, which neither `mode` nor `surface` can express.
  if (spec.where) {
    return spec.where;
  }
  if (spec.surface === "canvas") {
    return "canvas only";
  }
  if (spec.surface === "inline") {
    return "inline only";
  }
  if (spec.mode === "edit") {
    return "edit mode";
  }
  if (spec.mode === "view") {
    return "view mode";
  }
  return "not available here";
}

function chordChips(chords: string[]): HTMLElement {
  return el(
    "span",
    { class: cls("sc-keys") },
    chords.map((c) => el("kbd", { class: cls("sc-key"), text: c }))
  );
}

function commandRow(spec: Command): HTMLElement {
  const why = unavailable(spec);
  const row = el("div", { class: cls("sc-row") }, [
    el("span", { class: cls("sc-name") }, [
      el("span", { text: spec.title }),
      why ? el("span", { class: cls("sc-why"), text: why }) : el("span"),
    ]),
    chordChips(keys.chords(spec.id)),
  ]);
  row.classList.toggle(cls("sc-row-off"), Boolean(why));
  return row;
}

function gestureRow(spec: GestureSpec): HTMLElement {
  // The device only when it is *a* device. Every gesture that works on both
  // rendered the literal word "any" next to its name, which is fourteen rows of
  // noise saying nothing; the two that are mouse-only are the ones a trackpad
  // user wants flagged, and they still are.
  const note = spec.device === "any" ? null : `${spec.device} only`;
  return el("div", { class: cls("sc-row") }, [
    el("span", { class: cls("sc-name") }, [
      el("span", { text: spec.title }),
      note ? el("span", { class: cls("sc-why"), text: note }) : el("span"),
    ]),
    chordChips([spec.input]),
  ]);
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  return el("section", { class: cls("sc-sect") }, [
    el("h3", { class: cls("sc-head"), text: title }),
    ...rows,
  ]);
}

export function openShortcuts(): void {
  if (open) {
    closeShortcuts();
    return;
  }

  const sections: HTMLElement[] = [];
  for (const group of COMMAND_GROUPS) {
    const rows = ALL_COMMANDS.filter((c) => c.group === group).map(commandRow);
    if (rows.length) {
      sections.push(section(group, rows));
    }
  }
  sections.push(section("Mouse and trackpad", ALL_GESTURES.map(gestureRow)));

  // The field-local conventions, which are real and are not commands: they
  // belong to the input they commit, so there is nothing to bind and nothing a
  // palette could run. See the note in `catalog.ts`.
  sections.push(
    section(
      "In any field",
      NOTES.map((note) =>
        el("div", { class: cls("sc-row") }, [
          el("span", { class: cls("sc-name") }, [el("span", { text: note })]),
        ])
      )
    )
  );

  // A diagnostic, shown rather than logged: this module ships inside somebody
  // else's page and has no business writing to their console. Empty in a
  // healthy editor, which is what `catalog.test.ts` asserts statically.
  const clashes = keys.conflicts();
  if (clashes.length) {
    sections.push(
      section(
        "Conflicts",
        clashes.map((c) =>
          el("div", { class: cls("sc-row") }, [
            el("span", { class: cls("sc-name") }, [
              el("span", { text: c.ids.join(", ") }),
            ]),
            chordChips([c.chord]),
          ])
        )
      )
    );
  }

  const card = el(
    "div",
    {
      "aria-label": "Keyboard shortcuts",
      "aria-modal": "true",
      class: cls("sc"),
      role: "dialog",
    },
    [
      el("div", { class: cls("sc-bar") }, [
        icon("keyboard", "sm"),
        el("span", { class: cls("sc-title"), text: "Shortcuts" }),
      ]),
      el(
        "div",
        { class: `${cls("sc-body")} ${cls("scroll-y")}`, tabindex: "0" },
        sections
      ),
    ]
  );

  open = openPopover({
    className: "pop-shortcuts",
    content: card,
    modal: true,
    onClose: () => {
      open = null;
    },
    roving: false,
  });
  // The body, not the card: it is the scroller, so it is what Page Down and the
  // arrows have to be inside for the sheet to be readable without a mouse.
  card.querySelector<HTMLElement>(`.${cls("sc-body")}`)?.focus();
}
