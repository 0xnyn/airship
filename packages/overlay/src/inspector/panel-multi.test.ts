import type { PseudoState } from "@airship/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { DesignPanel } from "./panel";
import {
  harness,
  mount,
  resetDocument,
  selectionOf,
  sizeOf,
  styleSheet,
} from "./test-support";

/*
 * The multi-selection write path.
 *
 * Everything here came out of one line — `const own = node === sel.node`, which
 * decided two unrelated questions at once. It was justified by the alignment row's
 * *parent* write, where the reasoning holds; but `onChange` fans every control edit
 * across the whole selection, so each co-selected node also failed `own` and got a
 * foreign node's treatment: described as the primary, source nulled, and the panel's
 * scope and state silently dropped.
 */

/**
 * Two of the panel's internals, reached deliberately.
 *
 * `setState` is the Scope row's own callback and `reseedValue` is the refresh
 * path's; both are private because nothing outside the panel drives them. Testing
 * them through a cast rather than widening the class keeps the production API
 * honest — the alternative was two methods existing only for tests.
 */
interface Internals {
  reseedValue: (node: Element, property: string) => string;
  setState: (state: PseudoState | undefined) => void;
}
const inner = (panel: DesignPanel): Internals => panel as unknown as Internals;

/** Two buttons in a row, primary first. */
function pair(): { extra: HTMLElement; primary: HTMLElement } {
  const primary = mount("button", { class: "btn", text: "One" });
  const extra = mount("span", { class: "tag", text: "Two" });
  sizeOf(primary, { height: 32, width: 80 });
  sizeOf(extra, { height: 20, width: 40 });
  return { extra, primary };
}

/** A panel with `primary` selected and `extra` co-selected. */
function twoUp() {
  const h = harness();
  const panel = new DesignPanel(h.deps);
  const { extra, primary } = pair();
  panel.setSelection(
    selectionOf(primary, { source: { file: "src/App.tsx", line: 4 } })
  );
  panel.setExtra([extra]);
  return { ...h, extra, panel, primary };
}

describe("multi-selection payload", () => {
  beforeEach(resetDocument);

  it("describes each element as itself, not as the primary", () => {
    const { changeSet, extra, panel, primary } = twoUp();

    // What `onChange` does: fan one control edit over the whole selection.
    for (const node of [primary, extra]) {
      panel.recordOn(node, "color", "#f00");
    }

    const targets = changeSet.targets();
    expect(targets).toHaveLength(2);
    const tags = targets.map((t) => t.element.tagName).sort();
    // Two targets naming two *different* elements. This used to be ["button",
    // "button"], so the agent edited the button twice and never touched the span.
    expect(tags).toEqual(["button", "span"]);
    panel.destroy();
  });

  it("keeps the primary's resolved source and does not lend it to the extra", () => {
    const { changeSet, extra, panel, primary } = twoUp();
    panel.recordOn(primary, "color", "#f00");
    panel.recordOn(extra, "color", "#f00");

    const targets = changeSet.targets();
    const button = targets.find((t) => t.element.tagName === "button");
    const span = targets.find((t) => t.element.tagName === "span");
    expect(button?.source).toEqual({ file: "src/App.tsx", line: 4 });
    // Null rather than the primary's line. The server resolves it from the span's
    // own context; handing it App.tsx:4 pointed it at the wrong JSX node.
    expect(span?.source).toBeNull();
    panel.destroy();
  });

  it("carries the element's own classes, so a scoped edit can be checked", () => {
    const { changeSet, extra, panel } = twoUp();
    panel.recordOn(extra, "color", "#f00");
    expect(changeSet.targets()[0].element.classes).toEqual(["tag"]);
    panel.destroy();
  });
});

describe("multi-selection and the panel's scope and state", () => {
  beforeEach(resetDocument);

  it("gives a foreign node its own context, not the selection's", () => {
    // The alignment row writes `justify-content` to the flex parent. That parent
    // was described to the agent as the selected child.
    const { changeSet, deps } = harness();
    const panel = new DesignPanel(deps);
    const parent = mount("section", { class: "row" });
    const child = mount("button", { class: "btn", parent });
    sizeOf(child, { height: 32, width: 80 });
    panel.setSelection(selectionOf(child));

    panel.recordOn(parent, "justify-content", "center");

    const { element } = changeSet.targets()[0];
    expect(element.tagName).toBe("section");
    expect(element.classes).toEqual(["row"]);
    panel.destroy();
  });

  it("leaves a foreign node instance-level even while a scope is set", () => {
    /*
     * The half of the old `own` flag that was right, and has to stay right: the
     * scope picker lists the *selection's* classes, which say nothing about its
     * parent, so a `.btn`-scoped edit must not be written to `.row`.
     */
    const { changeSet, deps } = harness();
    const panel = new DesignPanel(deps);
    const parent = mount("section", { class: "row" });
    const a = mount("button", { class: "btn", parent });
    const b = mount("button", { class: "btn", parent });
    sizeOf(a, { height: 32, width: 80 });
    sizeOf(b, { height: 32, width: 80 });
    // Two elements carry `.btn`, so the scope row offers it.
    styleSheet(".btn { padding: 4px }");
    panel.setSelection(selectionOf(a));

    panel.recordOn(parent, "justify-content", "center");

    expect(changeSet.targets()[0].scope).toBeUndefined();
    panel.destroy();
  });

  it("resets a forced state when the selection is extended", () => {
    /*
     * `setSelection` already did this; `setExtra` did not. Leaving the simulation
     * running was the precondition for the worst of it: `forced-state` tracks one
     * node, so the extras kept an inline hover style at rest for the session.
     */
    styleSheet(".btn:hover { color: blue }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const { extra, primary } = pair();
    primary.className = "btn";
    panel.setSelection(selectionOf(primary));
    inner(panel).setState(":hover");
    expect(panel.activeTarget().state).toBe(":hover");
    expect(primary.style.getPropertyValue("color")).toBe("blue");

    panel.setExtra([extra]);

    expect(panel.activeTarget().state).toBeUndefined();
    // And the simulation came off the primary rather than being abandoned on it.
    expect(primary.style.getPropertyValue("color")).toBe("");
    panel.destroy();
  });

  it("records every selected node against the forced state", () => {
    /*
     * The payload half of the same bug. With the state forced, an edit fanned over
     * the selection recorded the primary under `:hover` and the others under no
     * state at all — so the prompt asked for a hover rule on one element and a
     * resting-style change on the rest.
     */
    styleSheet(".btn:hover { color: blue }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const { extra, primary } = pair();
    primary.className = "btn";
    extra.className = "btn";
    panel.setSelection(selectionOf(primary));
    panel.setExtra([extra]);
    inner(panel).setState(":hover");

    for (const node of [primary, extra]) {
      panel.recordOn(node, "color", "#f00");
    }

    const states = h.changeSet.targets().map((t) => t.state);
    expect(states).toEqual([":hover", ":hover"]);
    panel.destroy();
  });

  it("strips the hover preview from every selected node on exit", () => {
    styleSheet(".btn:hover { color: blue }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const { extra, primary } = pair();
    primary.className = "btn";
    extra.className = "btn";
    panel.setSelection(selectionOf(primary));
    panel.setExtra([extra]);
    inner(panel).setState(":hover");
    for (const node of [primary, extra]) {
      panel.recordOn(node, "color", "#f00");
    }

    inner(panel).setState(undefined);

    // Neither element renders its hover styling at rest.
    expect(primary.getAttribute("style") ?? "").not.toContain("important");
    expect(extra.getAttribute("style") ?? "").not.toContain("important");
    panel.destroy();
  });
});

describe("reseed", () => {
  beforeEach(resetDocument);

  it("keeps Mixed when the selection disagrees", () => {
    /*
     * `reseed` read the primary's computed value directly, so a `Mixed` field
     * collapsed to the primary's number on the first arrow key or undo — the panel
     * asserting a value the other element does not have.
     */
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const a = mount("div", { style: "padding-top: 8px" });
    const b = mount("div", { style: "padding-top: 24px" });
    sizeOf(a, { height: 10, width: 10 });
    sizeOf(b, { height: 10, width: 10 });
    panel.setSelection(selectionOf(a));
    panel.setExtra([b]);

    const shown = inner(panel).reseedValue(a, "padding-top");

    expect(shown).toBe("Mixed");
    panel.destroy();
  });

  it("agrees with itself when the selection agrees", () => {
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const a = mount("div", { style: "padding-top: 8px" });
    const b = mount("div", { style: "padding-top: 8px" });
    panel.setSelection(selectionOf(a));
    panel.setExtra([b]);

    expect(inner(panel).reseedValue(a, "padding-top")).toBe("8px");
    panel.destroy();
  });

  it("prefers a pending edit over what the DOM computed", () => {
    // `reader` exists because the DOM refuses some values the change set holds.
    // `reseed` read past it, so such an edit stayed in the composer chip while the
    // field snapped back to the old value.
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div", { style: "padding-top: 8px" });
    panel.setSelection(selectionOf(node));
    h.changeSet.record({
      element: {
        classes: [],
        displayName: null,
        tagName: "div",
        textPreview: "",
      },
      from: "8px",
      node,
      property: "padding-top",
      source: null,
      to: "1fr",
    });

    expect(inner(panel).reseedValue(node, "padding-top")).toBe("1fr");
    panel.destroy();
  });
});
