import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls } from "../dom";
import { mountPopoverHost } from "../popover-host";
import { closePalette, openPalette, paletteIsOpen } from "./palette";
import { keys } from "./registry";

/*
 * The command palette.
 *
 * Two properties are the whole design and both are easy to lose:
 *
 * - **It lists only what is runnable.** An action surface offering "Zoom to
 *   fit" on the inline overlay, where there is no canvas, has lied before you
 *   press Enter. The shortcuts panel is the one that shows everything.
 * - **Focus never leaves the search field.** The active row moves by
 *   `aria-activedescendant`. Reusing the popover host's roving helpers would
 *   take the caret out of the field on the first ↓, which is the failure mode
 *   this file exists to catch.
 */

const disposers: (() => void)[] = [];

function bind(
  id: Parameters<typeof keys.bind>[0]["id"],
  run = () => undefined
) {
  disposers.push(keys.bind({ id, run }));
}

function card(): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.${cls("palette")}`);
  if (!found) {
    throw new Error("The palette is not open.");
  }
  return found;
}

const field = (): HTMLInputElement =>
  card().querySelector(`.${cls("palette-field")}`) as HTMLInputElement;

const rows = (): HTMLElement[] => [
  ...card().querySelectorAll<HTMLElement>(`.${cls("palette-row")}`),
];

const titles = (): string[] =>
  rows().map(
    (r) => r.querySelector(`.${cls("palette-title")}`)?.textContent ?? ""
  );

function type(text: string): void {
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * From the search field, which is where focus actually is.
 *
 * Not a detail: the popover host binds its own `popover.close` on Escape,
 * scoped to the same card. Focus being in a *field* is what tells the two
 * apart — the host's binding carries no `allowWhileTyping`, so the registry
 * skips it, and only the palette's own two-step Escape survives. Pressing from
 * the card instead makes the host's binding eligible and closes the palette on
 * the first press.
 */
function press(key: string): void {
  field().dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  mountPopoverHost(document.body);
});

afterEach(() => {
  closePalette();
  for (const off of disposers.splice(0)) {
    off();
  }
  keys.destroy();
  document.body.replaceChildren();
});

describe("what the palette lists", () => {
  it("shows a bound command and not an unbound one", () => {
    bind("history.undo");

    openPalette();

    expect(titles()).toContain("Undo");
    // Bound nowhere in this test, which is what the inline surface looks like
    // for the zoom set.
    expect(titles()).not.toContain("Zoom to fit");
  });

  it("drops a command whose guard says no", () => {
    let allowed = true;
    disposers.push(
      keys.bind({
        id: "history.undo",
        run: () => undefined,
        when: () => allowed,
      })
    );
    openPalette();
    expect(titles()).toContain("Undo");

    closePalette();
    allowed = false;
    openPalette();

    expect(titles()).not.toContain("Undo");
  });

  it("reaches the real binding for every row it lists", () => {
    // The plumbing behind the rule above: a listed row must invoke the binding
    // it names, not merely appear.
    const ran: string[] = [];
    for (const id of ["history.undo", "element.duplicate"] as const) {
      disposers.push(keys.bind({ id, run: () => ran.push(id) }));
    }
    openPalette();

    for (const row of rows()) {
      row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      openPalette();
    }

    expect(ran.sort((a, b) => a.localeCompare(b))).toEqual([
      "element.duplicate",
      "history.undo",
    ]);
  });

  it("keeps a popover's own keys out of it", () => {
    const shell = document.createElement("div");
    document.body.append(shell);
    disposers.push(
      keys.bind({ id: "popover.next", run: () => undefined, within: shell })
    );

    openPalette();

    expect(titles()).not.toContain("Next option");
  });
});

describe("searching", () => {
  beforeEach(() => {
    bind("history.undo");
    bind("history.redo");
    bind("element.duplicate");
    openPalette();
  });

  it("puts a title that starts with the query first", () => {
    type("du");

    expect(titles()[0]).toBe("Duplicate");
  });

  it("matches a subsequence, which is how people actually type", () => {
    type("dpl");

    expect(titles()).toContain("Duplicate");
  });

  it("says so when nothing matches", () => {
    type("zzzz");

    expect(rows()).toHaveLength(0);
    expect(card().querySelector(`.${cls("palette-empty")}`)).not.toBeNull();
  });

  it("groups only while the query is empty", () => {
    expect(card().querySelector(`.${cls("pop-head")}`)).not.toBeNull();

    type("u");

    expect(card().querySelector(`.${cls("pop-head")}`)).toBeNull();
  });

  it("does not compose the menu row", () => {
    /*
     * `.pop-item` brought three faults with it, none of them visible under
     * happy-dom, which is why this asserts the *cause* rather than the layout.
     * `justify-content: space-between` made a title's x-position a function of
     * the icon and chord widths beside it, so every row started somewhere
     * different; `.pop-item-main` is an `inline-flex` row, so the sentence
     * printed beside the title rather than as its own column; and
     * `.pop-item:hover` at (0,2,0) out-ranked `.palette-row-on` at (0,1,0), so
     * the pointer beat the arrow keys in a surface navigated by arrow keys.
     */
    expect(rows()[0].classList.contains(cls("pop-item"))).toBe(false);
    expect(rows()[0].querySelector(`.${cls("ic")}`)).toBeNull();
  });

  it("gives every row the same three cells, chord or no chord", () => {
    // The cells are placed into the list's subgrid by source order, so a row
    // that omitted its empty chord would put its sentence in the chord column.
    for (const row of rows()) {
      expect(row.children).toHaveLength(3);
      expect(row.children[0].className).toBe(cls("palette-title"));
      expect(row.children[1].className).toBe(cls("palette-doc"));
      expect(row.children[2].className).toBe(cls("keys"));
    }
  });
});

describe("navigating", () => {
  it("moves the active row without moving focus", () => {
    bind("history.undo");
    bind("history.redo");
    openPalette();
    const before = document.activeElement;

    press("ArrowDown");

    expect(document.activeElement).toBe(before);
    expect(rows()[1].classList.contains(cls("palette-row-on"))).toBe(true);
    expect(field().getAttribute("aria-activedescendant")).toBe(rows()[1].id);
  });

  it("stops at the ends rather than wrapping", () => {
    bind("history.undo");
    bind("history.redo");
    openPalette();

    press("ArrowUp");

    expect(rows()[0].classList.contains(cls("palette-row-on"))).toBe(true);
  });

  it("runs the active row on Enter and closes", () => {
    const run = vi.fn();
    disposers.push(keys.bind({ id: "history.undo", run }));
    openPalette();

    press("Enter");

    expect(run).toHaveBeenCalledTimes(1);
    expect(paletteIsOpen()).toBe(false);
  });

  it("clears the query on the first Escape and closes on the second", () => {
    bind("history.undo");
    openPalette();
    type("undo");

    press("Escape");
    expect(paletteIsOpen()).toBe(true);
    expect(field().value).toBe("");

    press("Escape");
    expect(paletteIsOpen()).toBe(false);
  });
});

describe("the palette itself", () => {
  it("toggles on a second open", () => {
    bind("history.undo");

    openPalette();
    expect(paletteIsOpen()).toBe(true);

    openPalette();
    expect(paletteIsOpen()).toBe(false);
  });

  it("describes itself as a modal combobox over a listbox", () => {
    bind("history.undo");
    openPalette();

    expect(card().getAttribute("role")).toBe("dialog");
    expect(card().getAttribute("aria-modal")).toBe("true");
    expect(field().getAttribute("role")).toBe("combobox");
    expect(
      card()
        .querySelector(`.${cls("palette-list")}`)
        ?.getAttribute("role")
    ).toBe("listbox");
    expect(rows()[0].getAttribute("role")).toBe("option");
  });

  it("puts a scrim behind itself", () => {
    bind("history.undo");
    openPalette();

    expect(document.querySelector(`.${cls("pop-scrim")}`)).not.toBeNull();

    closePalette();

    expect(document.querySelector(`.${cls("pop-scrim")}`)).toBeNull();
  });

  it("releases its own navigation when it closes", () => {
    bind("history.undo");
    openPalette();
    closePalette();

    // `palette.next` is scoped to a card that no longer exists; nothing should
    // be left answering ↓.
    expect(keys.isBound("palette.next")).toBe(false);
  });
});
