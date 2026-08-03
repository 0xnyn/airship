import type { ElementContext } from "@airship/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { ChangeSet } from "../change-set";
import {
  enterState,
  exitState,
  forcedState,
  trackInjected,
} from "./forced-state";

/*
 * Leaving a forced state used to *delete* the element's own inline styles.
 *
 * `enterState` writes the state's declarations through `applyPreview`
 * (`style.setProperty`), which overwrites whatever the author had inline;
 * `exitState` tore down with `clearPreview` (`style.removeProperty`). Nothing
 * remembered what had been covered, so a `<button style="color:red">` came out of
 * `:hover` with no `color` at all — and every later edit then recorded the
 * stylesheet's colour as its `from`.
 *
 * `ChangeSet` is the real one, not a stub: the ordering between our teardown and
 * `reapplyPreviews` is half of what these tests are about.
 */

const CONTEXT = { tagName: "button" } as ElementContext;

/** A stylesheet in the test document, so `pseudoDecls` has rules to find. */
function styles(css: string): void {
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.append(tag);
}

function button(inline?: string): HTMLElement {
  const node = document.createElement("button");
  node.className = "btn";
  if (inline) {
    node.setAttribute("style", inline);
  }
  document.body.append(node);
  return node;
}

describe("forced state", () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("puts back an inline declaration it covered", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("color: red");
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    expect(node.style.getPropertyValue("color")).toBe("blue");
    expect(forcedState()).toBe(":hover");

    exitState(changeSet);
    expect(node.style.getPropertyValue("color")).toBe("red");
    expect(forcedState()).toBeNull();
  });

  it("preserves the priority of the declaration it covered", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("color: red !important");
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    exitState(changeSet);

    expect(node.style.getPropertyValue("color")).toBe("red");
    expect(node.style.getPropertyPriority("color")).toBe("important");
  });

  it("still removes a property the element never declared inline", () => {
    styles(".btn:hover { color: blue; }");
    const node = button();
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    exitState(changeSet);

    expect(node.style.getPropertyValue("color")).toBe("");
    // Nothing of ours left behind, and no empty style="" either.
    expect(node.hasAttribute("style")).toBe(false);
  });

  it("lets a pending default-state tweak win over the restored value", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("color: red");
    const changeSet = new ChangeSet();
    // A tweak made at rest, before the state was entered.
    changeSet.record({
      element: CONTEXT,
      from: "red",
      node,
      property: "color",
      source: null,
      to: "green",
    });

    enterState([node], ":hover", changeSet);
    exitState(changeSet);

    // The author's `red` is what the preview covered, but the pending `green` is
    // what the panel was showing at rest, so `green` has to come back on top.
    expect(node.style.getPropertyValue("color")).toBe("green");
  });

  it("strips an edit made while the state was forced, restoring what it covered", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("color: red");
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    // What `recordOn` does for a hover edit: track first, then write.
    trackInjected(node, "background-color");
    node.style.setProperty("background-color", "black", "important");

    exitState(changeSet);

    expect(node.style.getPropertyValue("background-color")).toBe("");
    expect(node.style.getPropertyValue("color")).toBe("red");
  });

  it("keeps the first snapshot when a property is tracked twice", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("background-color: white");
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    trackInjected(node, "background-color");
    node.style.setProperty("background-color", "black", "important");
    // A second edit of the same property in the same state must not re-snapshot,
    // or the author's `white` is replaced by our own `black`.
    trackInjected(node, "background-color");
    node.style.setProperty("background-color", "grey", "important");

    exitState(changeSet);

    expect(node.style.getPropertyValue("background-color")).toBe("white");
  });

  it("is idempotent across re-entry, which is what the undo resync relies on", () => {
    styles(".btn:hover { color: blue; }");
    const node = button("color: red");
    const changeSet = new ChangeSet();

    enterState([node], ":hover", changeSet);
    enterState([node], ":hover", changeSet);
    exitState(changeSet);

    expect(node.style.getPropertyValue("color")).toBe("red");
  });
});
