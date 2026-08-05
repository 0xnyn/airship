import type { ElementContext } from "@airship/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { AttrSet } from "./attr-set";
import { ChangeSet } from "./change-set";
import { History } from "./history";
import { createOpApplier } from "./history-ops";
import { type MoveRecord, MoveSet } from "./move-set";
import { StructureSet } from "./structure-set";

/*
 * The invariant, tested from the outside.
 *
 * Every assertion here comes in a pair: what the DOM says, and what the agent
 * would be told. Airship previews an edit by mutating the live page and ships
 * the delta separately, so an undo that fixes only the first is not an undo — it
 * is a silent disagreement that surfaces later as the agent re-applying a change
 * the user took back. Four of the six op kinds used to fail exactly that way,
 * and two were never journalled at all.
 */

const element: ElementContext = {
  classes: [],
  displayName: "div",
  tagName: "div",
  textPreview: "",
};

interface Harness {
  attrSet: AttrSet;
  changeSet: ChangeSet;
  history: History;
  moveSet: MoveSet;
  structureSet: StructureSet;
  /** Every property pushed back into a control, in order. */
  synced: [string, string][];
}

function harness(): Harness {
  const attrSet = new AttrSet();
  const changeSet = new ChangeSet();
  const moveSet = new MoveSet();
  const structureSet = new StructureSet();
  const synced: [string, string][] = [];
  const history = new History({
    apply: createOpApplier({
      attrSet,
      changeSet,
      moveSet,
      preview: (node, property, value, tracked) => {
        const html = node as HTMLElement;
        if (tracked) {
          html.style.setProperty(property, value);
        } else {
          html.style.removeProperty(property);
        }
      },
      structureSet,
      syncControl: (property, value) => synced.push([property, value]),
    }),
    refresh: () => {
      // The panel re-seed; nothing to do in a test.
    },
  });
  return { attrSet, changeSet, history, moveSet, structureSet, synced };
}

/** A parent with three children, the shape every structural test wants. */
function tree(): {
  a: HTMLElement;
  b: HTMLElement;
  c: HTMLElement;
  root: HTMLElement;
} {
  const root = document.createElement("div");
  const a = document.createElement("a");
  const b = document.createElement("b");
  const c = document.createElement("i");
  root.append(a, b, c);
  document.body.append(root);
  return { a, b, c, root };
}

beforeEach(() => {
  document.body.replaceChildren();
});

/** Record a declaration and journal it, the way `recordOn` does. */
function edit(
  h: Harness,
  node: HTMLElement,
  property: string,
  from: string,
  to: string
): void {
  const before = h.changeSet.snapshot(node, property);
  node.style.setProperty(property, to);
  h.changeSet.record({ element, from, node, property, source: null, to });
  h.history.push({
    after: h.changeSet.snapshot(node, property) ?? null,
    before: before ?? null,
    element,
    kind: "decl",
    node,
    source: null,
  });
}

describe("style edits", () => {
  it("undoes the DOM and drops the delta together", () => {
    const h = harness();
    const { a } = tree();
    edit(h, a, "color", "black", "red");

    expect(h.history.undo()).toBe(true);
    expect(h.changeSet.count()).toBe(0);
    // Back to the original means no declaration at all, not the original pinned
    // inline — the stylesheet gets to speak again.
    expect(a.style.getPropertyValue("color")).toBe("");
  });

  it("redoes both sides after an undo dropped the declaration", () => {
    // The case the previous design could not express: undoing to the original
    // removes the slot, so a redo built on "re-record into the existing slot"
    // restored the page and silently shipped nothing.
    const h = harness();
    const { a } = tree();
    edit(h, a, "color", "black", "red");
    h.history.undo();

    expect(h.history.redo()).toBe(true);
    expect(h.changeSet.count()).toBe(1);
    expect(a.style.getPropertyValue("color")).toBe("red");
  });

  it("keeps the slot's original `from` across a chain of edits", () => {
    const h = harness();
    const { a } = tree();
    edit(h, a, "padding-top", "8px", "16px");
    edit(h, a, "padding-top", "8px", "24px");

    h.history.undo();
    const [change] = h.changeSet.targets()[0].changes;
    // Rebuilding this through the ordinary write path would read the DOM the
    // undo has already touched and turn `8px → 16px` into `16px → 16px`.
    expect(change.from).toBe("8px");
    expect(change.to).toBe("16px");
  });

  it("restores a token binding, not just its value", () => {
    const h = harness();
    const { a } = tree();
    const before = h.changeSet.snapshot(a, "padding-top");
    h.changeSet.record({
      binding: true,
      element,
      from: "16px",
      node: a,
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
    h.history.push({
      after: h.changeSet.snapshot(a, "padding-top") ?? null,
      before: before ?? null,
      element,
      kind: "decl",
      node: a,
      source: null,
    });

    h.history.undo();
    expect(h.changeSet.count()).toBe(0);
    h.history.redo();
    expect(h.changeSet.targets()[0].changes[0].token?.name).toBe(".pt-4");
  });

  it("pushes the replayed value back into its control", () => {
    const h = harness();
    const { a } = tree();
    edit(h, a, "padding-top", "8px", "16px");
    h.history.undo();
    expect(h.synced).toEqual([["padding-top", "8px"]]);
  });
});

describe("structure ops", () => {
  it("undoing a delete restores the element AND drops the delete", () => {
    // The regression this whole workstream exists for: the element came back on
    // screen and the agent was still told to remove it.
    const h = harness();
    const { a, b, root } = tree();
    const record = {
      element,
      node: b,
      op: "delete" as const,
      origNext: b.nextSibling,
      origParent: root,
      source: null,
    };
    h.structureSet.record(record);
    h.history.push({ kind: "structure", record });
    b.remove();
    expect(h.structureSet.count()).toBe(1);

    h.history.undo();
    expect(root.contains(b)).toBe(true);
    expect(b.previousElementSibling).toBe(a);
    expect(h.structureSet.count()).toBe(0);
  });

  it("redoing a delete removes it again and re-queues it", () => {
    const h = harness();
    const { b, root } = tree();
    const record = {
      element,
      node: b,
      op: "delete" as const,
      origNext: b.nextSibling,
      origParent: root,
      source: null,
    };
    h.structureSet.record(record);
    h.history.push({ kind: "structure", record });
    b.remove();
    h.history.undo();

    h.history.redo();
    expect(root.contains(b)).toBe(false);
    expect(h.structureSet.count()).toBe(1);
    expect(h.structureSet.targets()[0].op).toBe("delete");
  });

  it("undoing a duplicate drops the clone AND the duplicate", () => {
    const h = harness();
    const { b, root } = tree();
    const clone = b.cloneNode(true) as Element;
    root.insertBefore(clone, b.nextSibling);
    const record = {
      element,
      node: clone,
      op: "duplicate" as const,
      origNext: clone.nextSibling,
      origParent: root,
      source: null,
    };
    h.structureSet.record(record);
    h.history.push({ kind: "structure", record });

    h.history.undo();
    expect(root.contains(clone)).toBe(false);
    expect(h.structureSet.count()).toBe(0);
  });
});

describe("text ops", () => {
  it("undoing restores the string AND stops shipping the edit", () => {
    const h = harness();
    const { a } = tree();
    a.textContent = "before";
    h.structureSet.recordText({
      element,
      from: "before",
      node: a,
      source: null,
      to: "after",
    });
    a.textContent = "after";
    h.history.push({
      element,
      from: "before",
      kind: "text",
      node: a,
      source: null,
      to: "after",
    });

    h.history.undo();
    expect(a.textContent).toBe("before");
    expect(h.structureSet.count()).toBe(0);
  });

  it("redoing re-applies the string and re-queues the edit", () => {
    const h = harness();
    const { a } = tree();
    a.textContent = "before";
    h.structureSet.recordText({
      element,
      from: "before",
      node: a,
      source: null,
      to: "after",
    });
    a.textContent = "after";
    h.history.push({
      element,
      from: "before",
      kind: "text",
      node: a,
      source: null,
      to: "after",
    });
    h.history.undo();

    h.history.redo();
    expect(a.textContent).toBe("after");
    expect(h.structureSet.textTargets()[0].to).toBe("after");
  });
});

describe("attribute ops", () => {
  it("undoing restores the attribute AND drops it from the payload", () => {
    const h = harness();
    const { a } = tree();
    a.setAttribute("alt", "old");
    h.attrSet.record({
      attribute: "alt",
      element,
      from: "old",
      node: a,
      source: null,
      to: "new",
    });
    h.history.push({
      attribute: "alt",
      element,
      from: "old",
      kind: "attr",
      node: a,
      source: null,
      to: "new",
    });
    expect(a.getAttribute("alt")).toBe("new");

    h.history.undo();
    expect(a.getAttribute("alt")).toBe("old");
    expect(h.attrSet.count()).toBe(0);
  });

  it("round-trips an attribute that did not exist before", () => {
    const h = harness();
    const { a } = tree();
    h.attrSet.record({
      attribute: "alt",
      element,
      from: null,
      node: a,
      source: null,
      to: "new",
    });
    h.history.push({
      attribute: "alt",
      element,
      from: null,
      kind: "attr",
      node: a,
      source: null,
      to: "new",
    });

    h.history.undo();
    expect(a.hasAttribute("alt")).toBe(false);
    h.history.redo();
    expect(a.getAttribute("alt")).toBe("new");
    expect(h.attrSet.count()).toBe(1);
  });
});

describe("move ops", () => {
  function moveRecord(
    node: Element,
    origParent: Element,
    origNext: Node | null
  ): MoveRecord {
    return {
      before: null,
      beforeSource: null,
      element,
      newParent: element,
      newParentSource: null,
      node,
      origNext,
      origParent,
      source: null,
      toIndex: 0,
    };
  }

  it("undoing puts the node back AND drops the move", () => {
    const h = harness();
    const { a, b, c, root } = tree();
    const fromNext = a.nextSibling;
    // Drag `a` to the end.
    root.append(a);
    const next = moveRecord(a, root, fromNext);
    h.moveSet.record(next);
    h.history.push({
      fromNext,
      fromParent: root,
      kind: "move",
      next,
      node: a,
      prev: null,
      toNext: null,
      toParent: root,
    });
    expect(h.moveSet.count()).toBe(1);

    h.history.undo();
    expect([...root.children]).toEqual([a, b, c]);
    expect(h.moveSet.count()).toBe(0);
  });

  it("redoing re-applies the position and re-queues the move", () => {
    const h = harness();
    const { a, b, c, root } = tree();
    const fromNext = a.nextSibling;
    root.append(a);
    const next = moveRecord(a, root, fromNext);
    h.moveSet.record(next);
    h.history.push({
      fromNext,
      fromParent: root,
      kind: "move",
      next,
      node: a,
      prev: null,
      toNext: null,
      toParent: root,
    });
    h.history.undo();

    h.history.redo();
    expect([...root.children]).toEqual([b, c, a]);
    expect(h.moveSet.count()).toBe(1);
  });

  it("undoing the second of two drags returns to the first drop", () => {
    // Why the op carries both sides verbatim: a move's destination is recorded
    // as resolved element contexts, so the state to return to cannot be
    // re-derived from the DOM.
    const h = harness();
    const { a, b, c, root } = tree();
    const origNext = a.nextSibling;

    root.insertBefore(a, c);
    const first = moveRecord(a, root, origNext);
    h.moveSet.record(first);

    const secondFromNext = a.nextSibling;
    root.append(a);
    const second = moveRecord(a, root, origNext);
    h.moveSet.record(second);
    h.history.push({
      fromNext: secondFromNext,
      fromParent: root,
      kind: "move",
      next: second,
      node: a,
      prev: first,
      toNext: null,
      toParent: root,
    });

    h.history.undo();
    expect([...root.children]).toEqual([b, a, c]);
    // Still moved — just not as far. The delta must survive.
    expect(h.moveSet.count()).toBe(1);
  });
});

describe("declaration ops", () => {
  it("undoing a delete restores the declaration verbatim", () => {
    const h = harness();
    const { a } = tree();
    h.changeSet.record({
      element,
      from: "8px",
      node: a,
      property: "padding-top",
      source: null,
      to: "16px",
      token: { exact: true, kind: "css-var", name: "--pk-space-md" },
    });
    const before = h.changeSet.snapshot(a, "padding-top");
    h.changeSet.remove(a, "padding-top");
    h.history.push({
      after: null,
      before: before ?? null,
      element,
      kind: "decl",
      node: a,
      source: null,
    });
    expect(h.changeSet.count()).toBe(0);

    h.history.undo();
    const [restored] = h.changeSet.targets()[0].changes;
    // `from` in particular: rebuilding this through the ordinary write path
    // would recompute it against a DOM the preview has already been stripped
    // from, turning `8px → 16px` into `16px → 16px`.
    expect(restored.from).toBe("8px");
    expect(restored.to).toBe("16px");
    expect(restored.token?.name).toBe("--pk-space-md");
    expect(a.style.getPropertyValue("padding-top")).toBe("16px");
  });

  it("round-trips a disable toggle, preview included", () => {
    const h = harness();
    const { a } = tree();
    h.changeSet.record({
      element,
      from: "8px",
      node: a,
      property: "padding-top",
      source: null,
      to: "16px",
    });
    const before = h.changeSet.snapshot(a, "padding-top");
    h.changeSet.setDisabled(a, "padding-top", true);
    const after = h.changeSet.snapshot(a, "padding-top");
    h.history.push({
      after: after ?? null,
      before: before ?? null,
      element,
      kind: "decl",
      node: a,
      source: null,
    });

    h.history.undo();
    expect(h.changeSet.isDisabled(a, "padding-top")).toBe(false);
    expect(a.style.getPropertyValue("padding-top")).toBe("16px");

    h.history.redo();
    expect(h.changeSet.isDisabled(a, "padding-top")).toBe(true);
    expect(a.style.getPropertyValue("padding-top")).toBe("");
  });

  it("restores a detach along with the declaration that carried it", () => {
    const h = harness();
    const { a } = tree();
    h.changeSet.setHardcoded(a, "color", true);
    h.changeSet.record({
      element,
      from: "black",
      node: a,
      property: "color",
      source: null,
      to: "red",
    });
    const before = h.changeSet.snapshot(a, "color");
    h.changeSet.remove(a, "color");
    expect(h.changeSet.isHardcoded(a, "color")).toBe(false);

    h.history.push({
      after: null,
      before: before ?? null,
      element,
      kind: "decl",
      node: a,
      source: null,
    });
    h.history.undo();
    expect(h.changeSet.isHardcoded(a, "color")).toBe(true);
    expect(h.changeSet.targets()[0].changes[0].hardcode).toBe(true);
  });
});

describe("the journal itself", () => {
  it("coalesces a batch into one step", () => {
    const h = harness();
    const { a } = tree();
    h.history.batch(() => {
      for (const to of ["1px", "2px", "3px"]) {
        edit(h, a, "padding-top", "0px", to);
      }
    });
    h.history.undo();
    expect(h.history.canUndo).toBe(false);
    expect(h.changeSet.count()).toBe(0);
  });

  it("drops the redo branch when a new edit lands", () => {
    const h = harness();
    const { a } = tree();
    edit(h, a, "padding-top", "0px", "8px");
    h.history.undo();
    expect(h.history.canRedo).toBe(true);
    edit(h, a, "margin-top", "0px", "8px");
    expect(h.history.canRedo).toBe(false);
  });

  it("does not re-record the ops a replay causes", () => {
    const h = harness();
    const { a } = tree();
    edit(h, a, "color", "black", "red");
    h.history.undo();
    h.history.redo();
    h.history.undo();
    expect(h.history.canUndo).toBe(false);
  });

  it("reports an empty stack rather than throwing", () => {
    const h = harness();
    expect(h.history.undo()).toBe(false);
    expect(h.history.redo()).toBe(false);
  });
});
