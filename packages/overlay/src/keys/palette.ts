/**
 * ⌘K — search everything the editor can do right now, and run it.
 *
 * The counterpart to the shortcuts panel, and deliberately not the same list.
 * This one renders `keys.available()`: commands that are bound *and* whose
 * guards say yes this second. It is an action surface, so every row has to do
 * something — a palette that offers "Zoom to fit" on the inline overlay, where
 * there is no canvas, has lied to you before you press Enter. The panel renders
 * the whole catalog with the unavailable rows dimmed, because a reference that
 * hides what you cannot currently do is useless for learning.
 *
 * That distinction is the whole reason no mode enum was needed for either. The
 * `when` closures are pure predicates each subsystem already maintains, so
 * asking all of them at once *is* the live answer — `tools.ts` made that
 * argument first ("consulted per keypress rather than latched — it asks").
 *
 * ## Two things that look like details and are not
 *
 * **Focus stays in the search field.** The active row moves by
 * `aria-activedescendant`, never by `focus()`. `popover-host`'s own roving
 * helpers move real focus, which is right for a menu and would take the caret
 * out of the field here on the first ↓.
 *
 * **The navigation is four scoped commands, not a keydown listener.** The
 * field has focus the whole time, so the registry skips every binding without
 * `allowWhileTyping`; these four carry it, and `within` keeps them from leaking
 * to a page where ↓ means something else.
 */
import { cls, el } from "../dom";
import { icon } from "../icons";
import { openPopover, type PopoverHandle } from "../popover-host";
import type { Command, CommandGroup } from "./catalog";
import { keys, type LiveCommand } from "./registry";

/** Only one can be open, and ⌘K while it is up should close it. */
let open: PopoverHandle | null = null;

/**
 * Rank a command against a query, or `null` if it does not match.
 *
 * Subsequence rather than substring, so "zf" finds "Zoom to fit" — the thing
 * people actually type into a palette. Lower is better. No fuzzy-search
 * dependency: the corpus is forty rows, and a scoring function nobody can
 * explain is worse than one that occasionally ranks a row second.
 */
function score(spec: Command, query: string): number | null {
  const haystack = `${spec.title} ${spec.group} ${spec.doc}`.toLowerCase();
  const title = spec.title.toLowerCase();
  if (!query) {
    return 0;
  }
  // A title that starts with the query is what the user meant, every time.
  if (title.startsWith(query)) {
    return 0;
  }
  if (title.includes(query)) {
    return 1;
  }
  let at = 0;
  for (const ch of query) {
    at = title.indexOf(ch, at);
    if (at === -1) {
      // Fall back to the whole haystack, so "canvas" finds the View group's
      // rows through their group name and their sentence.
      return haystack.includes(query) ? 3 : null;
    }
    at += 1;
  }
  return 2;
}

function matches(query: string): LiveCommand[] {
  const q = query.trim().toLowerCase();
  return (
    keys
      .available()
      .map((c) => ({ c, rank: score(c.spec, q) }))
      .filter((r): r is { c: LiveCommand; rank: number } => r.rank !== null)
      // Stable within a rank, so an empty query keeps catalog order and the
      // groups below stay contiguous.
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.c)
  );
}

export function closePalette(): void {
  open?.close("programmatic");
  open = null;
}

export function paletteIsOpen(): boolean {
  return open !== null;
}

export function openPalette(): void {
  if (open) {
    closePalette();
    return;
  }

  const field = el("input", {
    "aria-autocomplete": "list",
    "aria-controls": `${cls("palette-list")}`,
    "aria-expanded": "true",
    class: cls("palette-field"),
    placeholder: "Search commands…",
    role: "combobox",
    type: "text",
  }) as HTMLInputElement;

  const list = el("div", {
    class: `${cls("palette-list")} ${cls("scroll-y")}`,
    id: cls("palette-list"),
    role: "listbox",
  });

  const empty = el("div", {
    class: cls("palette-empty"),
    text: "Nothing matches.",
  });

  const card = el(
    "div",
    {
      "aria-label": "Command palette",
      "aria-modal": "true",
      class: cls("palette"),
      role: "dialog",
    },
    [
      el("div", { class: cls("palette-head") }, [icon("search", "sm"), field]),
      list,
    ]
  );

  /** The rows currently rendered, in display order. */
  let rows: { el: HTMLElement; run: () => void }[] = [];
  let active = 0;

  const setActive = (i: number): void => {
    if (!rows.length) {
      field.removeAttribute("aria-activedescendant");
      return;
    }
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((row, at) => {
      row.el.classList.toggle(cls("palette-row-on"), at === active);
      row.el.setAttribute("aria-selected", String(at === active));
    });
    const chosen = rows[active].el;
    field.setAttribute("aria-activedescendant", chosen.id);
    chosen.scrollIntoView({ block: "nearest" });
  };

  const render = (): void => {
    const found = matches(field.value);
    list.replaceChildren();
    rows = [];
    if (!found.length) {
      list.append(empty);
      field.removeAttribute("aria-activedescendant");
      return;
    }
    // Headers only on an empty query. Once you are searching, the ranking has
    // already reordered everything and a group heading would sit above rows
    // that are no longer grouped.
    const grouped = !field.value.trim();
    let seen: CommandGroup | null = null;
    found.forEach((cmd, i) => {
      const { spec } = cmd;
      if (grouped && spec.group !== seen) {
        seen = spec.group;
        list.append(el("div", { class: cls("pop-head"), text: spec.group }));
      }
      const [chord] = keys.chords(spec.id);
      const row = el(
        "div",
        {
          class: `${cls("pop-item")} ${cls("palette-row")}`,
          id: `${cls("palette-row")}-${i}`,
          role: "option",
        },
        [
          spec.icon ? icon(spec.icon, "sm") : el("span"),
          el("span", { class: cls("pop-item-main") }, [
            el("span", { class: cls("palette-title"), text: spec.title }),
            el("span", { class: cls("palette-doc"), text: spec.doc }),
          ]),
          chord
            ? el("span", { class: cls("pop-item-hint"), text: chord })
            : el("span"),
        ]
      );
      const invoke = (): void => {
        closePalette();
        cmd.run();
      };
      // `pointerdown`, not `click`: the host's outside-press listener is also
      // on `pointerdown`, and a row that waited for `click` would be gone by
      // the time it arrived.
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        invoke();
      });
      row.addEventListener("pointerover", () => setActive(i));
      rows.push({ el: row, run: invoke });
      list.append(row);
    });
    setActive(0);
  };

  field.addEventListener("input", render);
  // The one trap in a dialog whose focus never moves: anything that steals
  // focus leaves the four navigation commands scoped to a card nobody is in.
  card.addEventListener("focusout", (e) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (!(to && card.contains(to))) {
      field.focus();
    }
  });

  render();

  const offKeys = keys.bindAll([
    { id: "palette.next", run: () => setActive(active + 1), within: card },
    { id: "palette.prev", run: () => setActive(active - 1), within: card },
    {
      id: "palette.run",
      run: () => rows[active]?.run(),
      within: card,
    },
    {
      id: "palette.close",
      // Clears the query first and closes on the second press — the same
      // two-step `token-field.ts` uses, so a mistyped search does not cost you
      // the palette.
      //
      // The popover host binds its own Escape on this same card, and what tells
      // the two apart is that focus is in a *field*: the host's carries no
      // `allowWhileTyping`, so the registry skips it and this one is the only
      // Escape left standing. If focus ever escapes the field the host's wins
      // and the palette simply closes, which is the right fallback anyway.
      run: () => {
        if (field.value) {
          field.value = "";
          render();
          return;
        }
        closePalette();
      },
      within: card,
    },
  ]);

  open = openPopover({
    className: "pop-palette",
    content: card,
    modal: true,
    onClose: () => {
      offKeys();
      open = null;
    },
    // The card's own commands do the navigating; the host's roving would move
    // real focus out of the search field.
    roving: false,
  });
  field.focus();
}
