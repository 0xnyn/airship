import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { mountPopoverHost } from "../popover-host";
import { ALL_COMMANDS, ALL_GESTURES, COMMAND_GROUPS, NOTES } from "./catalog";
import { keys } from "./registry";
import { closeShortcuts, openShortcuts } from "./shortcuts-panel";

/*
 * The shortcuts sheet.
 *
 * The property worth defending is the one it does *not* share with the
 * palette: this is a reference, so a command you cannot use right now is still
 * on it — dimmed, and labelled with why. Filtering it down to what is bound
 * would answer "what can I do this second", which the palette already answers,
 * and would make the sheet useless for the reason people open one.
 */

const disposers: (() => void)[] = [];

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.${cls("sc")}`);
  if (!found) {
    throw new Error("The shortcuts sheet is not open.");
  }
  return found;
}

const headings = (): string[] =>
  [...sheet().querySelectorAll(`.${cls("sc-head")}`)].map(
    (h) => h.textContent ?? ""
  );

function rowFor(title: string): HTMLElement {
  const found = [
    ...sheet().querySelectorAll<HTMLElement>(`.${cls("sc-row")}`),
  ].find((r) =>
    r.querySelector(`.${cls("sc-name")}`)?.textContent?.startsWith(title)
  );
  if (!found) {
    throw new Error(`No row titled ${title}`);
  }
  return found;
}

beforeEach(() => {
  document.body.replaceChildren();
  mountPopoverHost(document.body);
});

afterEach(() => {
  closeShortcuts();
  for (const off of disposers.splice(0)) {
    off();
  }
  keys.destroy();
  document.body.replaceChildren();
});

describe("what the sheet shows", () => {
  it("gives a group a section when it has rows of its own, and not otherwise", () => {
    openShortcuts();

    const shown = headings();
    for (const group of COMMAND_GROUPS) {
      const hasUnscoped = ALL_COMMANDS.some(
        (c) => c.group === group && !c.where
      );
      // Both directions, and the second half is what this case is about.
      // "Menus" is the case it exists for: all eleven of its commands are
      // scoped, so the group contributes three scope sections and none of its
      // own, and a heading over nothing would advertise the wrong list.
      expect(shown.includes(group)).toBe(hasUnscoped);
    }
  });

  it("promotes every scope in the catalog to a section of its own", () => {
    openShortcuts();

    const shown = headings();
    for (const where of new Set(
      ALL_COMMANDS.map((c) => c.where).filter((w): w is string => Boolean(w))
    )) {
      expect(shown).toContain(`${where[0].toUpperCase()}${where.slice(1)}`);
    }
  });

  it("keeps a scope beside the group it came out of", () => {
    // Read on its own, "On the change strip" is a place with no subject. The
    // scopes are derived per group rather than swept up globally so that they
    // land next to the section that gives them one.
    openShortcuts();

    const shown = headings();
    expect(shown.indexOf("On the change strip")).toBeGreaterThan(
      shown.indexOf("Agent")
    );
    expect(shown.indexOf("On the change strip")).toBeLessThan(
      shown.indexOf("Help")
    );
  });

  it("does not dim a scoped row, or repeat its scope on it", () => {
    // The regression the whole restructure is about. Every `popover.*` binding
    // exists only while a popover is up, and the sheet builds its sections
    // before it opens one — so the Menus section was grey every time anybody
    // looked at it, as a matter of arithmetic rather than of their editor.
    openShortcuts();

    const row = rowFor("Next option");

    expect(row.classList.contains(cls("sc-row-off"))).toBe(false);
    expect(row.querySelector(`.${cls("sc-why")}`)).toBeNull();
  });

  it("lists every command, bound or not", () => {
    openShortcuts();

    const rows = sheet().querySelectorAll(`.${cls("sc-row")}`);
    // Every command and every gesture. The field-local notes are no longer
    // among them — they are prose, and `.sc-note` is asserted below.
    expect(rows.length).toBeGreaterThanOrEqual(
      ALL_COMMANDS.length + ALL_GESTURES.length
    );
  });

  it("dims an unbound row and says why", () => {
    openShortcuts();

    const row = rowFor("Zoom to fit");

    expect(row.classList.contains(cls("sc-row-off"))).toBe(true);
    expect(row.querySelector(`.${cls("sc-why")}`)?.textContent).toBe(
      "canvas only"
    );
  });

  it("leaves a bound row alone", () => {
    disposers.push(keys.bind({ id: "history.undo", run: () => undefined }));

    openShortcuts();

    const row = rowFor("Undo");
    expect(row.classList.contains(cls("sc-row-off"))).toBe(false);
    expect(row.querySelector(`.${cls("sc-why")}`)?.textContent).toBeFalsy();
  });

  it("shows every chord a command answers to", () => {
    disposers.push(keys.bind({ id: "history.redo", run: () => undefined }));

    openShortcuts();

    // Redo answers to two, and a tooltip only ever showed the first. This is
    // the surface where ⌘Y and ⇧0 finally appear.
    //
    // Counted as *chords*, not chips: a chord is a group of one chip per key
    // now, so ⌘⇧Z alone is three of them. The grouping is the thing that has to
    // survive — five chips in an undifferentiated row would not say where the
    // first chord stops and the second starts.
    expect(rowFor("Redo").querySelectorAll(`.${cls("chord")}`)).toHaveLength(2);
    expect(
      rowFor("Redo").querySelectorAll(`.${cls("key")}`).length
    ).toBeGreaterThan(2);
  });

  it("renders the pointer gestures too", () => {
    openShortcuts();

    expect(headings()).toContain("Mouse and trackpad");
    expect(rowFor("Pan the canvas")).toBeDefined();
    expect(rowFor("Scroll the pending changes")).toBeDefined();
  });

  it("renders the field conventions as prose rather than as rows", () => {
    // As `sc-row`s they came out as three shortcuts with an empty chord column,
    // which reads as a rendering fault rather than as a note.
    openShortcuts();

    expect(headings()).toContain("In any field");
    expect(sheet().querySelectorAll(`.${cls("sc-note")}`)).toHaveLength(
      NOTES.length
    );
  });

  it("stays quiet when nothing conflicts", () => {
    disposers.push(keys.bind({ id: "history.undo", run: () => undefined }));

    openShortcuts();

    expect(headings()).not.toContain("Conflicts");
  });

  it("reports a real conflict rather than logging it", () => {
    // Two live, unscoped bindings on Escape. The overlay ships inside somebody
    // else's page, so this is shown, never written to their console.
    disposers.push(
      keys.bind({ id: "selection.deselect", run: () => undefined }),
      keys.bind({ id: "tool.handDrop", run: () => undefined })
    );

    openShortcuts();

    expect(headings()).toContain("Conflicts");
  });
});

describe("the sheet itself", () => {
  it("toggles on a second open", () => {
    openShortcuts();
    expect(document.querySelector(`.${cls("sc")}`)).not.toBeNull();

    openShortcuts();
    expect(document.querySelector(`.${cls("sc")}`)).toBeNull();
  });

  it("describes itself as a modal dialog", () => {
    openShortcuts();

    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().getAttribute("aria-modal")).toBe("true");
    expect(sheet().getAttribute("aria-label")).toBe("Keyboard shortcuts");
  });

  it("puts focus on the scroller, so it can be read without a mouse", () => {
    openShortcuts();

    expect(document.activeElement).toBe(
      sheet().querySelector(`.${cls("sc-body")}`)
    );
  });
});
