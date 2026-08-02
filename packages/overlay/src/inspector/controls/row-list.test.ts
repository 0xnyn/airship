import { beforeEach, describe, expect, it } from "vitest";
import { cls, el } from "../../dom";
import { createRowList, type RowListSpec } from "./row-list";

/*
 * The eye is the whole point of this control, and it was the one thing a refresh
 * destroyed.
 *
 * `serialize` drops disabled rows on purpose — a shadow you switched off should
 * not reach the source — so the round trip through CSS is lossy, and
 * `panel.reseed` pushes computed style back at every registered control after any
 * refresh. Hiding a row and then nudging with an arrow key therefore deleted it,
 * with no undo entry for the deletion.
 *
 * The rows here are deliberately trivial (a name and a flag) so the assertions
 * are about the list's own bookkeeping rather than about parsing shadows.
 */

interface Row {
  enabled: boolean;
  name: string;
}

/** `a, b` ⇄ `[{name:"a"}, {name:"b"}]`, with disabled rows dropped on the way out. */
function spec(): RowListSpec<Row> {
  return {
    blank: () => ({ enabled: true, name: "new" }),
    cssProperty: "box-shadow",
    enabled: (row) => row.enabled,
    parse: (css) =>
      css
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((name) => ({ enabled: true, name })),
    render: (row) => el("span", { class: cls("row"), text: row.name }),
    serialize: (rows) =>
      rows
        .filter((row) => row.enabled)
        .map((row) => row.name)
        .join(", "),
    setEnabled: (row, on) => ({ ...row, enabled: on }),
  };
}

/** Every value the list has pushed through `onChange`. */
function harness(initial: string) {
  const emitted: string[] = [];
  const list = createRowList(spec(), initial, (_property, value) => {
    emitted.push(value);
  });
  return { emitted, list };
}

/**
 * Click the eye on one row.
 *
 * By label, not by position: the row also carries Move up / Move down grips, and an
 * index-based lookup silently clicked one of those the moment reordering was added.
 */
function hide(root: HTMLElement, index: number): void {
  const row = root.children[index] as HTMLElement;
  const eye = row.querySelector<HTMLElement>(
    '[aria-label="Hide"], [aria-label="Show"]'
  );
  eye?.click();
}

/** Click one row's Move up / Move down grip. */
function move(root: HTMLElement, index: number, dir: "up" | "down"): void {
  const row = root.children[index] as HTMLElement;
  row
    .querySelector<HTMLElement>(
      `[aria-label="Move ${dir === "up" ? "up" : "down"}"]`
    )
    ?.click();
}

describe("createRowList", () => {
  let bin: HTMLElement;

  beforeEach(() => {
    bin = document.createElement("div");
    document.body.append(bin);
  });

  it("drops a disabled row from the serialised value but keeps it in the list", () => {
    const { emitted, list } = harness("a, b, c");
    bin.append(list.element);

    hide(list.element, 1);

    expect(emitted.at(-1)).toBe("a, c");
    expect(list.rows().map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(list.rows()[1].enabled).toBe(false);
  });

  it("survives a reseed that echoes its own serialised value", () => {
    const { list } = harness("a, b, c");
    bin.append(list.element);
    hide(list.element, 1);

    // What `panel.reseed` does after any refresh: push computed style back in.
    // The DOM no longer mentions `b`, because the list just removed it.
    list.setValue("box-shadow", "a, c");

    expect(list.rows().map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(list.rows()[1].enabled).toBe(false);
  });

  it("ignores a reseed whose value differs only by engine normalisation", () => {
    const { list } = harness("a, b");
    bin.append(list.element);
    hide(list.element, 0);

    // Same declaration, respaced the way a computed value would be.
    list.setValue("box-shadow", "   b   ");

    expect(list.rows().map((r) => r.name)).toEqual(["a", "b"]);
    expect(list.rows()[0].enabled).toBe(false);
  });

  it("takes a genuine external change and carries disabled rows across", () => {
    const { list } = harness("a, b, c");
    bin.append(list.element);
    hide(list.element, 1);

    // An agent edit or an undo past this control's own writes.
    list.setValue("box-shadow", "x, y");

    expect(list.rows().map((r) => r.name)).toEqual(["x", "b", "y"]);
    expect(list.rows()[1].enabled).toBe(false);
  });

  it("keeps a disabled trailing row when an external change shortens the list", () => {
    const { list } = harness("a, b, c");
    bin.append(list.element);
    hide(list.element, 2);

    list.setValue("box-shadow", "a");

    expect(list.rows().map((r) => r.name)).toEqual(["a", "c"]);
    expect(list.rows().at(-1)?.enabled).toBe(false);
  });

  it("re-enables a hidden row back into the serialised value", () => {
    const { emitted, list } = harness("a, b");
    bin.append(list.element);

    hide(list.element, 0);
    expect(emitted.at(-1)).toBe("b");

    hide(list.element, 0);
    expect(emitted.at(-1)).toBe("a, b");
    expect(list.rows()[0].enabled).toBe(true);
  });

  it("does not rebuild the rows on an echoing reseed", () => {
    const { list } = harness("a, b");
    bin.append(list.element);
    const before = list.element.firstElementChild;

    list.setValue("box-shadow", "a, b");

    // Same node, so anything live inside a row — a caret, an open popover, a
    // dnd-kit grip mid-drag — is still there.
    expect(list.element.firstElementChild).toBe(before);
  });
});

describe("createRowList reordering", () => {
  let bin: HTMLElement;

  beforeEach(() => {
    bin = document.createElement("div");
    document.body.append(bin);
  });

  it("moves a row down and re-serialises in the new order", () => {
    /*
     * Order is semantics in every list this renders — shadows paint back-to-front, and
     * `blur()` before `brightness()` is a different image from the reverse. There was no
     * way to reorder at all: you deleted the row and re-added everything below it.
     */
    const { emitted, list } = harness("a, b, c");
    bin.append(list.element);

    move(list.element, 0, "down");

    expect(list.rows().map((r) => r.name)).toEqual(["b", "a", "c"]);
    expect(emitted.at(-1)).toBe("b, a, c");
  });

  it("moves a row up", () => {
    const { list } = harness("a, b, c");
    bin.append(list.element);
    move(list.element, 2, "up");
    expect(list.rows().map((r) => r.name)).toEqual(["a", "c", "b"]);
  });

  it("disables the grip that would move a row off the end", () => {
    const { list } = harness("a, b");
    bin.append(list.element);
    const first = list.element.children[0] as HTMLElement;
    const last = list.element.children[1] as HTMLElement;
    expect(
      first.querySelector('[aria-label="Move up"]')?.hasAttribute("disabled")
    ).toBe(true);
    expect(
      last.querySelector('[aria-label="Move down"]')?.hasAttribute("disabled")
    ).toBe(true);
  });

  it("offers no grips when there is nowhere to move to", () => {
    const { list } = harness("a");
    bin.append(list.element);
    expect(list.element.querySelector('[aria-label="Move up"]')).toBeNull();
  });

  it("carries a hidden row's state with it", () => {
    const { list } = harness("a, b, c");
    bin.append(list.element);
    hide(list.element, 1);
    expect(list.rows()[1].enabled).toBe(false);

    move(list.element, 1, "up");

    expect(list.rows().map((r) => r.name)).toEqual(["b", "a", "c"]);
    expect(list.rows()[0].enabled).toBe(false);
  });
});
