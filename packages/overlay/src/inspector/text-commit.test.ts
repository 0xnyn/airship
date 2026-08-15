import type { ElementContext, SourceLocation } from "@airship/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttrSet } from "../attr-set";
import { ChangeSet } from "../change-set";
import { ChromeLayer } from "../chrome-layer";
import { History } from "../history";
import { MoveSet } from "../move-set";
import type { Selection } from "../picker";
import { SelectionController } from "../picker";
import { StructureSet } from "../structure-set";
import { InlineResolver } from "../surface";
import { DesignPanel } from "./panel";

/*
 * Which element a text edit is recorded against.
 *
 * The highest-risk part of in-place editing, and the least visible when it goes
 * wrong. Both ends of an edit are asynchronous: entry, because a double-click
 * fires `click`, `click`, `dblclick` and `SelectionController.select` resolves
 * the component context through an `await`; and exit, because sticky mode
 * commits the old edit and selects the new node inside one gesture. So "the
 * selection when the edit ends" and "the selection the edit was for" are
 * routinely different objects.
 *
 * Reading `this.selection` at commit time — which is what the panel used to do —
 * therefore attributes the change to whatever happens to be selected then. The
 * DOM still looks right, the chip still appears, and the agent edits a file the
 * user never touched. Two defences: `beginTextEdit` refuses a node that is not
 * the selection, and the context is snapshotted at `begin`. Both are here.
 */

const layer = new ChromeLayer();

function context(name: string): ElementContext {
  return {
    classes: [],
    displayName: name,
    tagName: "div",
    textPreview: "",
  };
}

function source(file: string): SourceLocation {
  return { column: 1, file, line: 1 };
}

interface Harness {
  nodes: { a: HTMLElement; b: HTMLElement };
  panel: DesignPanel;
  /** Two independent text layers, `a` and `b`, each with its own context. */
  select: (node: Element) => void;
  structureSet: StructureSet;
}

function harness(): Harness {
  const resolver = new InlineResolver();
  const controller = new SelectionController(
    { onSelect: () => undefined },
    { layer, resolver, swallowPresses: true }
  );
  const structureSet = new StructureSet();
  const panel = new DesignPanel({
    attrSet: new AttrSet(),
    changeSet: new ChangeSet(),
    controller,
    history: new History({
      apply: () => undefined,
      refresh: () => undefined,
    }),
    layer,
    moveSet: new MoveSet(),
    resolver,
    structureSet,
  });

  const host = document.createElement("div");
  host.innerHTML = "<p>Alpha</p><p>Beta</p>";
  document.body.append(host);
  const [a, b] = Array.from(host.children) as HTMLElement[];

  const surface = resolver.of(null);
  const meta = new Map<Element, Selection>([
    [
      a,
      {
        element: context("Alpha"),
        node: a,
        rect: { height: 0, left: 0, top: 0, width: 0 },
        source: source("Alpha.tsx"),
        surface,
      },
    ],
    [
      b,
      {
        element: context("Beta"),
        node: b,
        rect: { height: 0, left: 0, top: 0, width: 0 },
        source: source("Beta.tsx"),
        surface,
      },
    ],
  ]);

  return {
    nodes: { a, b },
    panel,
    select: (node) => panel.setSelection(meta.get(node) ?? null),
    structureSet,
  };
}

beforeEach(() => {
  layer.mount(document.body);
});

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("beginTextEdit", () => {
  it("edits the selection when given no node", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    expect(panel.beginTextEdit()).toBe(true);
    nodes.a.textContent = "Edited";
    panel.endTextEdit();
    expect(structureSet.textTargets()).toHaveLength(1);
  });

  it("refuses a node that is not the selection", () => {
    // Defence one, in isolation. `AirshipApp.enterTextEdit` selects first and
    // begins from `onSelected`; if that ever regresses, this is what turns a
    // silent mis-attribution into a no-op.
    const { nodes, panel, select } = harness();
    select(nodes.a);
    expect(panel.beginTextEdit(nodes.b)).toBe(false);
  });

  it("refuses a node with no editable text and leaves no snapshot behind", () => {
    const { nodes, panel, select, structureSet } = harness();
    nodes.a.innerHTML = "<span>Nested</span>";
    select(nodes.a);
    expect(panel.beginTextEdit(nodes.a)).toBe(false);
    // A stale snapshot would attribute the *next* edit to this refusal's node.
    select(nodes.b);
    expect(panel.beginTextEdit(nodes.b)).toBe(true);
    nodes.b.textContent = "Edited";
    panel.endTextEdit();
    const [target] = structureSet.textTargets();
    expect(target.source?.file).toBe("Beta.tsx");
  });
});

describe("commit attribution", () => {
  it("records against the node the edit began on, not the one selected now", () => {
    // The bug, written down. Begin on A, let the selection move to B — which is
    // exactly what sticky mode and a racing `extract` both do — and commit.
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    nodes.a.textContent = "Edited";
    select(nodes.b);

    const targets = structureSet.textTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].element.displayName).toBe("Alpha");
    expect(targets[0].source?.file).toBe("Alpha.tsx");
    expect(targets[0].to).toBe("Edited");
  });

  it("commits an in-flight edit before the selection swaps", () => {
    // The layers tree, an undo and every programmatic select reach
    // `setSelection` without going through the picker's click path.
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    nodes.a.textContent = "Edited";
    expect(structureSet.textTargets()).toHaveLength(0);
    select(nodes.b);
    expect(structureSet.textTargets()).toHaveLength(1);
    expect(nodes.a.hasAttribute("contenteditable")).toBe(false);
  });

  it("leaves the edit alone when the selection lands on the same node", () => {
    const { nodes, panel, select } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    select(nodes.a);
    expect(nodes.a.hasAttribute("contenteditable")).toBe(true);
  });

  it("carries the source through unconditionally", () => {
    // This used to be `edit.node === sel.node ? sel.source : null`, which
    // existed *because* the node might not be the selection — and quietly
    // shipped a null source whenever it wasn't. The snapshot makes them match,
    // so the ternary was only ever hiding the bug it worked around.
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    nodes.a.textContent = "Edited";
    select(nodes.b);
    expect(structureSet.textTargets()[0].source).toEqual(source("Alpha.tsx"));
  });

  it("records nothing when the text never changed", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    panel.endTextEdit();
    expect(structureSet.textTargets()).toHaveLength(0);
  });
});

describe("grab-to-move while editing", () => {
  // The *last* one: every harness builds its own panel, and they all add their
  // proxy to the one shared chrome layer.
  const proxy = (): HTMLElement | undefined =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".__airship-drag-proxy")
    ).at(-1);

  it("disarms the reorder proxy for the duration of an edit", () => {
    // Not cosmetic. The proxy is a `pointer-events: auto` box pinned over the
    // selection so dnd-kit can arm a grab anywhere on it — so while an edit is
    // live it swallows every press meant for the caret, and `EditGuard` reads
    // those as a drag and kills the default. Caret placement, drag-select and
    // double-click-for-a-word all stop working, silently. Found by running the
    // app, not by any of the unit tests above.
    const { nodes, panel, select } = harness();
    select(nodes.a);
    expect(proxy()?.style.display).not.toBe("none");
    panel.beginTextEdit(nodes.a);
    expect(proxy()?.style.display).toBe("none");
  });

  it("re-arms it once the edit ends", () => {
    const { nodes, panel, select } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    panel.endTextEdit();
    expect(proxy()?.style.display).not.toBe("none");
  });

  it("leaves it disarmed when the edit ends with nothing selected", () => {
    const { nodes, panel, select } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    // `setSelection(null)` commits the edit on its way past, so the re-arm has
    // to consult the *new* selection rather than assume there is one.
    select(nodes.a.ownerDocument.body);
    expect(proxy()?.style.display).toBe("none");
  });
});

describe("Content field", () => {
  /*
   * The panel-side text editor. Its one non-negotiable difference from the
   * in-frame path: it must write the DOM itself. The contenteditable has
   * already written the page by commit time; this field has not, and a
   * version that recorded without writing produced an edit the chip claimed
   * and the page never showed — with redo applying an edit undo never
   * reverted, because `applyText` writes `textContent` in both directions.
   */
  const fieldOf = (panel: DesignPanel): HTMLInputElement | null =>
    panel.element.querySelector('input[aria-label="Content"]');

  it("commits on blur: records the edit and writes the page", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    const field = fieldOf(panel);
    expect(field).not.toBeNull();
    if (!field) {
      return;
    }
    field.value = "Retitled";
    field.dispatchEvent(new Event("blur"));
    const targets = structureSet.textTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].from).toBe("Alpha");
    expect(targets[0].to).toBe("Retitled");
    expect(targets[0].source?.file).toBe("Alpha.tsx");
    // The DOM write — the half the record layer cannot do for it.
    expect(nodes.a.textContent).toBe("Retitled");
  });

  it("commits on Enter, exactly once", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    const field = fieldOf(panel);
    if (!field) {
      throw new Error("Content field missing");
    }
    field.value = "Retitled";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // Enter commits through blur; a second blur must not re-commit.
    field.dispatchEvent(new Event("blur"));
    expect(structureSet.textTargets()).toHaveLength(1);
    expect(nodes.a.textContent).toBe("Retitled");
  });

  it("reverts on Escape and records nothing", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    const field = fieldOf(panel);
    if (!field) {
      throw new Error("Content field missing");
    }
    field.value = "Discarded";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    field.dispatchEvent(new Event("blur"));
    expect(structureSet.textTargets()).toHaveLength(0);
    expect(field.value).toBe("Alpha");
    expect(nodes.a.textContent).toBe("Alpha");
  });

  it("records nothing for a blur with the text unchanged", () => {
    // Blur fires on every tab-through; a chip for that is noise.
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    fieldOf(panel)?.dispatchEvent(new Event("blur"));
    expect(structureSet.textTargets()).toHaveLength(0);
    expect(nodes.a.textContent).toBe("Alpha");
  });

  it("does not render for a node with element children", () => {
    // `<p><span>Nested</span></p>` passes `hasText`, but a `textContent`
    // write would delete the <span> — the field is gated on the same
    // predicate the in-place editor uses, and offers no disabled stub.
    const { nodes, panel, select } = harness();
    nodes.a.innerHTML = "<span>Nested</span>";
    select(nodes.a);
    expect(fieldOf(panel)).toBeNull();
  });

  it("commits a live in-frame edit before writing its own", () => {
    // Two writers on one node: a panel commit landing while the in-frame
    // editor holds a caret would blow away the text node under it. The
    // in-frame edit is committed first, then the field's lands on top.
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    nodes.a.textContent = "Typed in frame";
    const field = fieldOf(panel);
    if (!field) {
      throw new Error("Content field missing");
    }
    field.value = "Panel wins";
    field.dispatchEvent(new Event("blur"));
    expect(nodes.a.hasAttribute("contenteditable")).toBe(false);
    expect(nodes.a.textContent).toBe("Panel wins");
    const [target] = structureSet.textTargets();
    // One coalesced target per node: Alpha → Panel wins, in-frame step folded.
    expect(target.from).toBe("Alpha");
    expect(target.to).toBe("Panel wins");
  });
});

describe("pruneTextEdit", () => {
  it("tears down an edit whose node has left the DOM, recording nothing", () => {
    const { nodes, panel, select, structureSet } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    nodes.a.textContent = "Edited";
    nodes.a.remove();
    panel.pruneTextEdit();
    expect(structureSet.textTargets()).toHaveLength(0);
    // And the next edit still works — the teardown was clean, not abandoned.
    select(nodes.b);
    expect(panel.beginTextEdit(nodes.b)).toBe(true);
  });

  it("leaves a live edit alone", () => {
    const { nodes, panel, select } = harness();
    select(nodes.a);
    panel.beginTextEdit(nodes.a);
    panel.pruneTextEdit();
    expect(nodes.a.hasAttribute("contenteditable")).toBe(true);
  });

  it("is a no-op when nothing is being edited", () => {
    const { panel } = harness();
    expect(() => panel.pruneTextEdit()).not.toThrow();
  });
});
