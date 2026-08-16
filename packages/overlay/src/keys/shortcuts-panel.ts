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
 *
 * ## A scope is a section, not a label
 *
 * Nineteen commands are live only while some particular thing is on screen, and
 * the catalog says so in a `where` phrase. The sheet used to print that phrase
 * on every row — "in an open menu" six times down one section, "on the change
 * strip" five times down another — and dim the row for it, because `unavailable`
 * returned one value for two different questions.
 *
 * The Menus section was where that stopped being a wart. Its eleven commands are
 * all bound by a surface that is up only while it is up, and `openShortcuts`
 * builds every section *before* it opens its own popover — so the section was
 * grey every time anybody looked at it, as a matter of arithmetic rather than of
 * anything about their editor.
 *
 * So a scope is a heading now, printed once, over the rows it applies to, and
 * those rows are never dimmed — see `unavailable`. `Menus` disappears as a
 * heading in the process: every one of its commands is scoped, so it contributes
 * three sections and none of its own. `COMMAND_GROUPS` still names it, which is
 * what puts "In an open menu" after "Help" rather than somewhere alphabetical.
 */
import { cls, el } from "../dom";
import { icon } from "../icons";
import { openPopover, type PopoverHandle } from "../popover-host";
import {
  ALL_COMMANDS,
  ALL_GESTURES,
  COMMAND_GROUPS,
  type Command,
  type CommandGroup,
  type GestureSpec,
  NOTES,
} from "./catalog";
import { chordChips } from "./chips";
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
 *
 * `where` used to be *returned* from here, and that was the bug: "is this live"
 * is a boolean and "where does it apply" is a place, and the two were being
 * printed as one grey phrase at the end of every row. Nineteen commands carry a
 * `where`, so nineteen rows repeated their own scope — "in an open menu" six
 * times down one section — and went grey for it.
 *
 * The Menus section was the reductio. Every `popover.*` and `palette.*` binding
 * exists only while that surface is up, and `openShortcuts` builds all of its
 * sections *before* it calls `openPopover` — so the section was 100% dim by
 * construction, every single time it was opened. A reference that greys out a
 * whole section as a matter of arithmetic is not reporting anything.
 *
 * The scope is a section heading now, printed once, and a scoped row is simply
 * never dimmed: it is not unavailable, it is *elsewhere*, and the section it is
 * under already says where. That guard sits above the surface and mode branches
 * rather than below them, which is the whole of the second bug here. Below them,
 * the three scoped commands that are also `surface: "canvas"` —
 * `frame.bringForward`, `frame.sendBackward` and `frameMenu.close` — exit early
 * with "canvas only". The first two are bound whenever the frame list exists, so
 * they recover; `frameMenu.close` is bound *only while the device menu is open*,
 * and the sheet builds its sections before any menu is up. So "In the device
 * menu" came out as a one-row section, grey, labelled "canvas only", while you
 * were standing on the canvas — the same grey-by-arithmetic failure this change
 * set out to delete, moved from Menus into a section of its own.
 *
 * What is left below is the question this function can still answer honestly: is
 * there a *mode* or a *surface* reason you cannot reach this from where you are
 * standing.
 */
function unavailable(spec: Command): string | null {
  if (keys.isBound(spec.id)) {
    return null;
  }
  if (spec.where) {
    return null;
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

function commandRow(spec: Command): HTMLElement {
  const why = unavailable(spec);
  const row = el("div", { class: cls("sc-row") }, [
    el("span", { class: cls("sc-name") }, [
      el("span", { text: spec.title }),
      // No placeholder when there is no reason. The row is a grid now, so the
      // columns come from the track list rather than from a node holding a slot
      // open, and an empty `sc-why` was a node that meant nothing.
      why && el("span", { class: cls("sc-why"), text: why }),
    ]),
    chordChips(keys.chordParts(spec.id)),
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
      note && el("span", { class: cls("sc-why"), text: note }),
    ]),
    chordChips([[spec.input]]),
  ]);
}

function section(
  title: string,
  rows: HTMLElement[],
  modifier?: string
): HTMLElement {
  return el(
    "section",
    {
      class: [cls("sc-sect"), modifier && cls(modifier)]
        .filter(Boolean)
        .join(" "),
    },
    [el("h3", { class: cls("sc-head"), text: title }), ...rows]
  );
}

/**
 * "in an open menu" → "In an open menu".
 *
 * The catalog writes `where` as a prepositional phrase because that is how it
 * reads *inside* a sentence — it lands mid-row in a `CONTROLS.md` table cell —
 * and a heading that starts lowercase reads as a fragment somebody forgot to
 * finish. Done here rather than with `::first-letter` so the DOM says what the
 * screen says, which is what lets a test assert the heading.
 */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A group's own section, then one section per scope inside it.
 *
 * Two orderings, both the catalog's. The unscoped rows keep their table order,
 * and the scopes appear in the order their first row does — neither is sorted,
 * because a reference whose sections move when a command is added is a reference
 * you cannot learn the shape of.
 *
 * A group with no unscoped rows emits no section of its own. That is not a
 * degenerate case, it is Menus: all eleven of its commands carry a `where`, so
 * the group contributes nothing but its scopes, and a "MENUS" heading over
 * nothing would be a heading advertising the wrong list.
 *
 * The scopes go immediately after their parent group rather than being swept up
 * at the end, which is the whole reason they are derived per group: "On the
 * change strip" belongs under Agent, and read on its own it is a place with no
 * subject.
 */
function groupSections(group: CommandGroup): HTMLElement[] {
  const inGroup = ALL_COMMANDS.filter((c) => c.group === group);
  const out: HTMLElement[] = [];
  const unscoped = inGroup.filter((c) => !c.where);
  if (unscoped.length) {
    out.push(section(group, unscoped.map(commandRow)));
  }
  const scopes: string[] = [];
  for (const spec of inGroup) {
    if (spec.where && !scopes.includes(spec.where)) {
      scopes.push(spec.where);
    }
  }
  for (const where of scopes) {
    out.push(
      section(
        sentence(where),
        inGroup.filter((c) => c.where === where).map(commandRow)
      )
    );
  }
  return out;
}

export function openShortcuts(): void {
  if (open) {
    closeShortcuts();
    return;
  }

  const sections: HTMLElement[] = COMMAND_GROUPS.flatMap(groupSections);
  // Its own modifier, because a gesture's input is a *phrase* — "Wheel over the
  // selected frame" — where a command's is a chord, and one chip track cannot
  // be sized for both. See `--sc-chord-w` in `help.css.ts`.
  sections.push(
    section("Mouse and trackpad", ALL_GESTURES.map(gestureRow), "sc-sect-input")
  );

  // The field-local conventions, which are real and are not commands: they
  // belong to the input they commit, so there is nothing to bind and nothing a
  // palette could run. See the note in `catalog.ts`.
  //
  // Prose nodes rather than `sc-row`/`sc-name`: rendered as rows they came out
  // as three shortcuts with an empty chord column, which reads as a rendering
  // fault rather than as a note.
  sections.push(
    section(
      "In any field",
      NOTES.map((note) => el("p", { class: cls("sc-note"), text: note }))
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
            chordChips([[c.chord]]),
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
        icon("question", "sm"),
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
