import type { ElementContext } from "@airship/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeSet } from "./change-set";

// The set only ever touches `style` on a node (through `style-model`), so a
// minimal stand-in keeps these tests free of a DOM implementation.
vi.mock("./inspector/style-model", () => ({
  applyPreview: vi.fn(),
  clearPreview: vi.fn(),
}));

const element: ElementContext = {
  classes: ["btn"],
  displayName: "Button",
  tagName: "button",
  textPreview: "Go",
};

function node(id: string): Element {
  return { id } as unknown as Element;
}

describe("ChangeSet slots", () => {
  let set: ChangeSet;
  let button: Element;

  beforeEach(() => {
    set = new ChangeSet();
    button = node("button");
  });

  const record = (
    property: string,
    from: string,
    to: string,
    target?: { scope?: string; state?: ":hover" }
  ): void => {
    set.record({
      element,
      from,
      node: button,
      property,
      source: null,
      target,
      to,
    });
  };

  it("keeps the same property on different states as separate changes", () => {
    record("color", "#000", "#111");
    record("color", "#000", "#f00", { state: ":hover" });
    expect(set.count()).toBe(2);

    const targets = set.targets();
    expect(targets).toHaveLength(2);
    expect(targets.find((t) => t.state === undefined)?.changes[0].to).toBe(
      "#111"
    );
    expect(targets.find((t) => t.state === ":hover")?.changes[0].to).toBe(
      "#f00"
    );
  });

  it("groups one node's changes into a target per (scope, state)", () => {
    record("color", "#000", "#111");
    record("padding-top", "0px", "8px");
    record("color", "#000", "#f00", { state: ":hover" });
    record("color", "#000", "#0f0", { scope: ".btn" });
    record("color", "#000", "#00f", { scope: ".btn", state: ":hover" });

    const targets = set.targets();
    expect(targets).toHaveLength(4);
    // The two default-state declarations share one target.
    const base = targets.find((t) => !(t.scope || t.state));
    expect(base?.changes).toHaveLength(2);
    // Each of the other three combinations is its own target.
    expect(
      targets.filter((t) => t.scope === ".btn" && t.state === ":hover")
    ).toHaveLength(1);
  });

  it("overwrites within a slot rather than accumulating", () => {
    record("color", "#000", "#111");
    record("color", "#000", "#222");
    expect(set.count()).toBe(1);
    expect(set.targets()[0].changes[0].to).toBe("#222");
  });

  it("drops a change tweaked back to its original, per slot", () => {
    record("color", "#000", "#111");
    record("color", "#000", "#f00", { state: ":hover" });
    record("color", "#000", "#000");
    expect(set.count()).toBe(1);
    // The hover change is untouched by the base one reverting.
    expect(set.targets()[0].state).toBe(":hover");
  });

  it("reads back the original value per slot", () => {
    record("color", "#000", "#111");
    record("color", "#abc", "#f00", { state: ":hover" });
    expect(set.originalValue(button, "color")).toBe("#000");
    expect(set.originalValue(button, "color", { state: ":hover" })).toBe(
      "#abc"
    );
  });

  it("disables one slot without touching the other", () => {
    record("color", "#000", "#111");
    record("color", "#000", "#f00", { state: ":hover" });
    set.setDisabled(button, "color", true, { state: ":hover" });

    expect(set.isDisabled(button, "color", { state: ":hover" })).toBe(true);
    expect(set.isDisabled(button, "color")).toBe(false);
    // A disabled declaration is dropped from the wire payload entirely.
    expect(set.targets()).toHaveLength(1);
    expect(set.count()).toBe(1);
  });

  it("removes one slot without touching the other", () => {
    record("color", "#000", "#111");
    record("color", "#000", "#f00", { state: ":hover" });
    set.remove(button, "color", { state: ":hover" });
    expect(set.count()).toBe(1);
    expect(set.targets()[0].state).toBeUndefined();
  });

  it("restores a declaration into the slot it came from", () => {
    record("color", "#000", "#f00", { state: ":hover" });
    const change = set.snapshot(button, "color", { state: ":hover" });
    set.remove(button, "color", { state: ":hover" });
    expect(set.count()).toBe(0);

    set.restoreDecl({
      change: change ?? null,
      element,
      node: button,
      property: "color",
      source: null,
      target: { state: ":hover" },
    });
    expect(set.count()).toBe(1);
    expect(set.targets()[0].state).toBe(":hover");
    // The base slot must stay untouched by a hover restore.
    expect(set.snapshot(button, "color")).toBeUndefined();
  });

  it("hands back a copy from `snapshot`, not the live declaration", () => {
    // A journal holding the live object would watch its own before-state change
    // under it the moment the next edit landed.
    record("color", "#000", "#111");
    const before = set.snapshot(button, "color");
    record("color", "#000", "#222");
    expect(before?.to).toBe("#111");
  });

  it("carries the resolved token through to the payload", () => {
    set.record({
      element,
      from: "12px",
      node: button,
      property: "padding-top",
      source: null,
      to: "16px",
      token: { exact: true, kind: "css-var", name: "--pk-space-md" },
    });
    expect(set.targets()[0].changes[0].token?.name).toBe("--pk-space-md");
  });

  it("carries an explicit detach through to the payload", () => {
    set.setHardcoded(button, "color", true);
    record("color", "#000", "#111");
    const [change] = set.targets()[0].changes;
    expect(change.hardcode).toBe(true);
    expect(change.token).toBeUndefined();
  });

  it("keeps a detach across later edits to the same property", () => {
    // The whole point of the registry: a scrub after a detach must not silently
    // re-attach the token the user just rejected.
    set.setHardcoded(button, "color", true);
    record("color", "#000", "#111");
    record("color", "#000", "#222");
    expect(set.targets()[0].changes[0].hardcode).toBe(true);
  });

  it("drops an inferred token on a hardcoded slot", () => {
    // Contradictory instructions; the store settles it rather than trusting
    // every call site to.
    set.setHardcoded(button, "color", true);
    set.record({
      element,
      from: "#000",
      node: button,
      property: "color",
      source: null,
      to: "#111",
      token: { exact: true, kind: "css-var", name: "--pk-fg" },
    });
    expect(set.targets()[0].changes[0].token).toBeUndefined();
  });

  it("forgets the detach when the declaration is removed", () => {
    set.setHardcoded(button, "color", true);
    record("color", "#000", "#111");
    set.remove(button, "color");
    expect(set.isHardcoded(button, "color")).toBe(false);
  });

  it("forgets every detach on clear", () => {
    set.setHardcoded(button, "color", true);
    set.clear();
    expect(set.isHardcoded(button, "color")).toBe(false);
  });

  it("keeps a binding whose value is unchanged", () => {
    // Adopting the token that already produces the current value. Without
    // `binding` this collapses to a no-op and the binding is lost — which is
    // what made picking a token look like it did nothing.
    set.record({
      binding: true,
      element,
      from: "16px",
      node: button,
      property: "padding-top",
      source: null,
      to: "16px",
      token: {
        exact: true,
        kind: "utility-class",
        name: ".pt-4",
        via: "reference",
      },
    });
    expect(set.count()).toBe(1);
    expect(set.targets()[0].changes[0].token?.name).toBe(".pt-4");
  });

  it("still drops a plain edit back to the original value", () => {
    record("padding-top", "16px", "24px");
    record("padding-top", "16px", "16px");
    expect(set.count()).toBe(0);
  });

  it("lets undo clear a binding by replaying to the original value", () => {
    set.record({
      binding: true,
      element,
      from: "16px",
      node: button,
      property: "padding-top",
      source: null,
      to: "16px",
      token: {
        exact: true,
        kind: "utility-class",
        name: ".pt-4",
        via: "reference",
      },
    });
    // Undo restores the state that preceded the binding, which was none at all.
    set.restoreDecl({
      change: null,
      element,
      node: button,
      property: "padding-top",
      source: null,
    });
    expect(set.count()).toBe(0);
  });
});

describe("ChangeSet previews and payload filtering", () => {
  let set: ChangeSet;
  let button: Element;

  beforeEach(() => {
    set = new ChangeSet();
    button = node("button");
  });

  const record = (
    property: string,
    to: string,
    target?: { scope?: string; state?: ":hover" }
  ): void => {
    set.record({
      element,
      from: "0px",
      node: button,
      property,
      source: null,
      target,
      to,
    });
  };

  it("reports every previewed property on a node, across slots", () => {
    /*
     * `allChangesFor` cannot answer this — it filters to one (scope, state) slot,
     * and a preview is a fact about the `style` attribute whichever slot wrote it.
     * `duplicateSelection` needs the whole list, because the clone it makes is in
     * no change set and `clearPreviews` will never visit it.
     */
    record("padding-top", "8px");
    record("color", "#f00", { state: ":hover" });
    record("margin-top", "4px", { scope: ".btn" });

    expect(
      set.previewedProperties(button).sort((a, b) => a.localeCompare(b))
    ).toEqual(["color", "margin-top", "padding-top"]);
  });

  it("dedupes a property edited in more than one slot", () => {
    record("color", "#f00");
    record("color", "#00f", { state: ":hover" });
    expect(set.previewedProperties(button)).toEqual(["color"]);
  });

  it("includes a disabled declaration, whose preview still has to be stripped", () => {
    record("padding-top", "8px");
    set.setDisabled(button, "padding-top", true);
    expect(set.previewedProperties(button)).toEqual(["padding-top"]);
  });

  it("is empty for a node it has never seen", () => {
    expect(set.previewedProperties(node("other"))).toEqual([]);
  });

  it("skips a node from the wire payload without forgetting it", () => {
    // The delete case: the declarations stay in the set, because taking the
    // delete back has to bring them back too.
    record("padding-top", "8px");
    expect(set.targets()).toHaveLength(1);
    expect(set.targets((n) => n === button)).toEqual([]);
    expect(set.count()).toBe(1);
    expect(set.targets()).toHaveLength(1);
  });
});

/*
 * The no-op test, which `===` was not.
 *
 * `from` and `to` arrive in different serialisations and always have. `recordOn`
 * takes `from` from computed style, which every engine hands back in the legacy
 * comma form — `rgb(59, 130, 246)` — while `to` comes from the colour picker's
 * `formatColor`, which writes the modern space form, `rgb(59 130 246)`. One
 * colour, two strings.
 *
 * So a colour set back to its original was never recognised as unchanged: the
 * chip stayed in the composer and the agent was sent an instruction to make an
 * edit that changes nothing —
 *
 *     background-color: rgb(59, 130, 246) → rgb(59 130 246)
 */
describe("a colour edited back to where it started", () => {
  let set: ChangeSet;
  let button: Element;

  beforeEach(() => {
    set = new ChangeSet();
    button = node("button");
  });

  const record = (property: string, from: string, to: string): void => {
    set.record({ element, from, node: button, property, source: null, to });
  };

  it("is dropped across the comma/space spellings of one colour", () => {
    record("background-color", "rgb(59, 130, 246)", "rgb(59 130 246)");
    expect(set.count()).toBe(0);
  });

  it("is dropped when the source authored hex and the DOM computed rgb", () => {
    record("color", "rgb(0, 170, 255)", "#0af");
    record("border-top-color", "#0af", "rgb(0 170 255)");
    expect(set.count()).toBe(0);
  });

  it("is dropped for a colour carrying an alpha", () => {
    record("background-color", "rgba(0, 0, 0, 0.5)", "rgb(0 0 0 / 0.5)");
    expect(set.count()).toBe(0);
  });

  it("still records a colour that genuinely changed", () => {
    // The guard must not swallow real edits, including near-misses.
    record("background-color", "rgb(59, 130, 246)", "rgb(59 130 247)");
    expect(set.count()).toBe(1);
  });

  it("leaves non-colour properties on exact string equality", () => {
    /*
     * Deliberately scoped to colours. Lengths already round-trip as the same
     * string because `keepAuthoredUnit` preserves the unit the source wrote, and
     * teaching this to equate `16px` with `1rem` would drop edits that a
     * stylesheet author means to keep.
     */
    record("padding-top", "16px", "1rem");
    expect(set.count()).toBe(1);
  });

  it("does not treat two unreadable values as equal", () => {
    // `sameColor` refuses rather than guessing, so a pair it cannot parse falls
    // back to the string test — and two different strings are a real change.
    record("background-color", "var(--a)", "var(--b)");
    expect(set.count()).toBe(1);
  });
});
