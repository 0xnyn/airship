import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { mountPopoverHost } from "../popover-host";
import { ALL_COMMANDS, ALL_GESTURES, COMMAND_GROUPS } from "./catalog";
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
  it("has a section for every group in the catalog", () => {
    openShortcuts();

    const shown = headings();
    for (const group of COMMAND_GROUPS) {
      if (ALL_COMMANDS.some((c) => c.group === group)) {
        expect(shown).toContain(group);
      }
    }
  });

  it("lists every command, bound or not", () => {
    openShortcuts();

    const rows = sheet().querySelectorAll(`.${cls("sc-row")}`);
    // Every command, every gesture, and the field-local notes.
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
    expect(rowFor("Redo").querySelectorAll(`.${cls("sc-key")}`)).toHaveLength(
      2
    );
  });

  it("renders the pointer gestures too", () => {
    openShortcuts();

    expect(headings()).toContain("Mouse and trackpad");
    expect(rowFor("Pan the canvas")).toBeDefined();
    expect(rowFor("Scroll the pending changes")).toBeDefined();
  });

  it("renders the field conventions that are not commands", () => {
    openShortcuts();

    expect(headings()).toContain("In any field");
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
