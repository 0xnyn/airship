import type { DesignToken } from "@airship/protocol/tokens";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMenuItem } from "../../popover-host";
import { setRuntimeTokens } from "../../tokens/registry";
import type { TokenSlot } from "./context";
import { fontMenuEntries } from "./text";

/*
 * The font field's one list.
 *
 * It used to be two: a caret inside the field listing the families the page can
 * render, and a token badge beside it listing the design system's. Two carets
 * on one row, for one property, with nothing to say which held the answer. They
 * are one menu now, and the thing worth pinning down is the interaction rule it
 * inherits — clicking the token already bound *detaches* rather than
 * re-applying a binding that is already in force.
 */

const SANS: DesignToken = {
  category: "font-family",
  kind: "css-var",
  name: "--pk-font-sans",
  origin: "runtime",
  values: { "": "Inter, system-ui, sans-serif" },
};

const MONO: DesignToken = {
  category: "font-family",
  kind: "css-var",
  name: "--pk-font-mono",
  origin: "runtime",
  values: { "": '"JetBrains Mono", ui-monospace, monospace' },
};

/*
 * A shadow filed under fonts, which is what the classifier used to do to every
 * comma-bearing value. That bug is fixed at the source, but this list is the one
 * place in the panel where being wrong becomes a *write* — picking a row puts
 * the string into `font-family` — so it declines to offer anything that could
 * not be a font, whatever the registry says.
 */
const MISFILED: DesignToken = {
  category: "font-family",
  kind: "css-var",
  name: "--pk-elevation-floating",
  origin: "runtime",
  values: { "": "0 8px 32px rgba(0,0,0,0.18)" },
};

function slot(bound: string | null) {
  const apply = vi.fn();
  const unlink = vi.fn();
  const value: TokenSlot = {
    apply,
    bound: bound !== null,
    element: document.createElement("button"),
    label: bound,
    open: vi.fn(),
    unlink,
  };
  return { apply, slot: value, unlink };
}

function menu(bound: string | null, onPick = vi.fn()) {
  const { apply, slot: value, unlink } = slot(bound);
  const entries = fontMenuEntries({
    bound,
    node: document.createElement("p"),
    onPick,
    slot: value,
    stack: "Georgia, serif",
  });
  return { apply, entries, onPick, unlink };
}

/**
 * Only the clickable rows.
 *
 * Through the shared guard rather than `"label" in e`, which stopped being a
 * complete test the day menus grew collapsible groups: a group carries a label
 * too, so the hand-rolled predicate quietly widened to include one.
 */
const items = (entries: ReturnType<typeof menu>["entries"]) =>
  entries.filter(isMenuItem);

/** The menu flattened to strings, so order and grouping read at a glance. */
const labels = (entries: ReturnType<typeof menu>["entries"]) =>
  entries.map((e) => {
    if ("label" in e) {
      return e.label;
    }
    if ("header" in e) {
      return `# ${e.header}`;
    }
    return "---";
  });

/*
 * By name, never by index. The registry sorts its categories itself, so the
 * order the tokens are declared in is not the order they come back in — an
 * index here would be asserting the registry's business rather than the menu's.
 */
const row = (entries: ReturnType<typeof menu>["entries"], label: string) => {
  const found = items(entries).find((e) => e.label === label);
  if (!found) {
    throw new Error(`no "${label}" in [${items(entries).map((e) => e.label)}]`);
  }
  return found;
};

beforeEach(() => {
  setRuntimeTokens({ framework: "custom", tokens: [SANS, MONO] });
});

afterEach(() => {
  setRuntimeTokens({ framework: "unknown", tokens: [] });
});

describe("the font menu", () => {
  it("puts the design system first, under its own heading", () => {
    const shown = labels(menu(null).entries);
    expect(shown[0]).toBe("# Design system");
    expect(shown).toContain("---");
    // Every token above the separator, every family below it. The two lists
    // are never interleaved, which is the whole reason for the headings.
    const split = shown.indexOf("---");
    expect(shown.slice(0, split)).toEqual(
      expect.arrayContaining(["pk-font-sans", "pk-font-mono"])
    );
    expect(shown[split + 1]).toBe("# Fonts");
    expect(shown.slice(split)).toContain("Georgia");
  });

  it("shows each token's leading family as its hint", () => {
    const { entries } = menu(null);
    expect(row(entries, "pk-font-sans").hint).toContain("Inter");
    expect(row(entries, "pk-font-mono").hint).toContain("JetBrains Mono");
  });

  it("offers the families as well as the tokens, and they are different writes", () => {
    const { entries, onPick, apply } = menu(null);
    row(entries, "Georgia").run();
    expect(onPick).toHaveBeenCalledWith("Georgia");
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies a token that is not the bound one", () => {
    const { entries, apply, unlink } = menu(null);
    row(entries, "pk-font-mono").run();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].name).toBe("--pk-font-mono");
    expect(unlink).not.toHaveBeenCalled();
  });

  it("marks the current family when nothing is bound", () => {
    expect(row(menu(null).entries, "Georgia").on).toBe(true);
  });

  describe("when a token is bound", () => {
    it("lights that row and no family", () => {
      const { entries } = menu("pk-font-sans");
      expect(row(entries, "pk-font-sans").on).toBe(true);
      expect(items(entries).filter((e) => e.on)).toHaveLength(1);
    });

    it("detaches instead of re-applying the binding it already has", () => {
      const { entries, apply, unlink } = menu("pk-font-sans");
      row(entries, "pk-font-sans").run();
      expect(unlink).toHaveBeenCalledTimes(1);
      expect(apply).not.toHaveBeenCalled();
    });

    it("says so, rather than relying on the convention being known", () => {
      expect(row(menu("pk-font-sans").entries, "pk-font-sans").hint).toBe(
        "Detach"
      );
    });

    it("leaves the other tokens applying", () => {
      const { entries, apply, unlink } = menu("pk-font-sans");
      row(entries, "pk-font-mono").run();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(unlink).not.toHaveBeenCalled();
    });
  });

  it("declines a token that could not be a font, however it was filed", () => {
    setRuntimeTokens({
      framework: "custom",
      tokens: [SANS, MISFILED],
    });
    const shown = labels(menu(null).entries);
    expect(shown).toContain("pk-font-sans");
    expect(shown).not.toContain("pk-elevation-floating");
    // And its leading family never reaches the plain list either, where picking
    // it would have written `font-family: 0 8px 32px rgba(0`.
    expect(shown.some((label) => label.includes("rgba"))).toBe(false);
  });

  it("is just the families when the project has no font tokens", () => {
    setRuntimeTokens({ framework: "unknown", tokens: [] });
    const shown = labels(
      fontMenuEntries({
        bound: null,
        node: document.createElement("p"),
        onPick: vi.fn(),
        slot: null,
        stack: "Georgia, serif",
      })
    );
    // No headings at all: one ungrouped list needs no heading to explain it.
    expect(shown).not.toContain("# Design system");
    expect(shown).not.toContain("---");
    expect(shown).toContain("Georgia");
  });
});
