import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFIX } from "../dom";
import { TEXT_EDIT_MARK } from "../styles/portable.css";
import {
  isEditableText,
  type TextEdit,
  TextEditor,
  textTargetIn,
} from "./text-edit";

/*
 * The editor, driven the way a user drives it.
 *
 * Two things here are worth more than the rest, and both are silent failures
 * rather than crashes:
 *
 * 1. **Caret placement is resolved against the node's own document.** On the
 *    canvas the node lives one realm down, and asking the shell's document about
 *    a point in a frame's coordinate space answers about the shell's own DOM —
 *    with a caret that lands somewhere plausible and wrong. `caretOn` builds a
 *    second `Document` to hold that honest.
 * 2. **`commit` refuses a node that has left the DOM.** React unmounts, HMR
 *    reloads and app-side subtree replacements all reach it, and recording one
 *    ships a text edit for a node the agent cannot find.
 *
 * happy-dom has no layout, so both caret APIs are stubbed per test — which is
 * fine, because what is under test is *which document gets asked*, not what the
 * browser answers.
 */

interface Harness {
  commits: TextEdit[];
  editor: TextEditor;
  node: HTMLElement;
  /** Every `setTextOwner` argument, in order. */
  owners: (Element | null)[];
}

function harness(html = "<p>Hello</p>", doc: Document = document): Harness {
  const host = doc.createElement("div");
  host.innerHTML = html;
  doc.body.append(host);
  const commits: TextEdit[] = [];
  const owners: (Element | null)[] = [];
  const editor = new TextEditor({
    onCommit: (edit) => commits.push(edit),
    setTextOwner: (n) => owners.push(n),
  });
  return {
    commits,
    editor,
    node: host.firstElementChild as HTMLElement,
    owners,
  };
}

/**
 * A second document, standing in for a frame's realm.
 *
 * An iframe rather than `createHTMLDocument`, because the latter has no
 * browsing context and therefore no `defaultView` — and a `Selection` is only
 * reachable through a window, so the code under test would bail before it ever
 * reached the branch this exists to check.
 */
function otherDoc(): Document {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  // biome-ignore lint/style/noNonNullAssertion: same-origin iframe, always set.
  return iframe.contentDocument!;
}

/** Stub `caretPositionFromPoint` on one document, and record that it was asked. */
function caretOn(doc: Document, container: Node, offset = 2): () => number {
  let calls = 0;
  Object.defineProperty(doc, "caretPositionFromPoint", {
    configurable: true,
    value: () => {
      calls += 1;
      return { offset, offsetNode: container };
    },
    writable: true,
  });
  return () => calls;
}

/**
 * A keystroke, dispatched so it actually propagates.
 *
 * `bubbles` matters: the editor listens on the node's *window* in capture, which
 * is the first step of the path — so a non-propagating event dispatched at the
 * node would never reach it, and neither would a real one.
 */
function press(node: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  node.dispatchEvent(e);
  return e;
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("isEditableText", () => {
  const check = (html: string): boolean => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return isEditableText(host.firstElementChild as Element);
  };

  it("accepts a node whose only child is text", () => {
    expect(check("<span>Save</span>")).toBe(true);
  });

  it("accepts a block container holding only text", () => {
    expect(check("<div>$40</div>")).toBe(true);
  });

  it("rejects a node with element children", () => {
    expect(check("<button><span>Save</span></button>")).toBe(false);
  });

  it("rejects a node mixing text and elements", () => {
    expect(check("<div>Hi <b>there</b></div>")).toBe(false);
  });

  it("rejects an empty node", () => {
    expect(check("<span></span>")).toBe(false);
  });

  it("rejects whitespace-only text", () => {
    expect(check("<span>   </span>")).toBe(false);
  });
});

describe("textTargetIn", () => {
  const resolve = (html: string): Element | null => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    return textTargetIn(host.firstElementChild as Element);
  };

  it("answers the node itself when it is already leaf text", () => {
    const host = document.createElement("div");
    host.innerHTML = "<span>Save</span>";
    const node = host.firstElementChild as Element;
    expect(textTargetIn(node)).toBe(node);
  });

  it("descends to the sole text child", () => {
    const found = resolve('<button class="p-4"><span>Save</span></button>');
    expect(found?.textContent).toBe("Save");
  });

  it("descends through more than one level", () => {
    const found = resolve("<div><div><em>Deep</em></div></div>");
    expect(found?.textContent).toBe("Deep");
  });

  it("refuses when two text descendants are candidates", () => {
    expect(resolve("<div><span>A</span><span>B</span></div>")).toBeNull();
  });

  it("refuses when there is no text at all", () => {
    expect(resolve('<div><img alt="x" src="x.png"></div>')).toBeNull();
  });

  it("refuses a subtree past the drill cap rather than scanning it", () => {
    // One text-bearing child, but buried behind more nodes than the cap allows.
    // "Ambiguous" is the deliberate answer: a double-click on a `<main>` should
    // not walk the document to arrive at a maybe.
    const filler = '<i class="x"></i>'.repeat(500);
    expect(resolve(`<div>${filler}<span>Late</span></div>`)).toBeNull();
  });

  it("skips the editor's own chrome", () => {
    const root = document.createElement("div");
    root.id = `${PREFIX}-root`;
    root.innerHTML = "<span>Chrome</span>";
    const host = document.createElement("div");
    document.body.append(host);
    host.append(root);
    expect(textTargetIn(host)).toBeNull();
  });
});

describe("TextEditor.begin", () => {
  it("marks the node and hands it to setTextOwner", () => {
    const { editor, node, owners } = harness();
    expect(editor.begin(node)).toBe(true);
    expect(node.hasAttribute("contenteditable")).toBe(true);
    expect(node.hasAttribute(TEXT_EDIT_MARK)).toBe(true);
    expect(owners).toEqual([node]);
    expect(editor.active).toBe(true);
    expect(editor.node).toBe(node);
  });

  it("refuses a node that is not leaf text", () => {
    const { editor, node, owners } = harness(
      "<button><span>Save</span></button>"
    );
    expect(editor.begin(node)).toBe(false);
    expect(owners).toEqual([]);
    expect(node.hasAttribute(TEXT_EDIT_MARK)).toBe(false);
  });

  it("selects the whole string when given no caret", () => {
    const { editor, node } = harness();
    const asked = caretOn(document, node.firstChild as Node);
    editor.begin(node);
    expect(asked()).toBe(0);
    expect(document.getSelection()?.toString()).toBe("Hello");
  });

  it("asks the node's own document for the caret, not the shell's", () => {
    // The frame case, and the one that fails silently in production: a caret
    // resolved against `document` would land in the shell's DOM.
    const frame = otherDoc();
    const { editor, node } = harness("<p>Hello</p>", frame);
    const shell = caretOn(document, document.body);
    const own = caretOn(frame, node.firstChild as Node);
    editor.begin(node, { caret: { x: 4, y: 4 } });
    expect(own()).toBe(1);
    expect(shell()).toBe(0);
  });

  it("falls back to select-all when the point lands outside the node", () => {
    const { editor, node } = harness();
    // Resolves, but to a container the node does not own — the caller must not
    // put a caret in the element next door.
    caretOn(document, document.body, 0);
    editor.begin(node, { caret: { x: 4, y: 4 } });
    expect(document.getSelection()?.toString()).toBe("Hello");
  });

  it("commits the previous edit before beginning the next", () => {
    const { commits, editor, owners } = harness("<p>One</p><p>Two</p>");
    const [first, second] = Array.from(
      document.body.firstElementChild?.children ?? []
    ) as HTMLElement[];
    editor.begin(first);
    first.textContent = "Edited";
    editor.begin(second);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ from: "One", to: "Edited" });
    // The order is the contract: the old node is released before the new one is
    // claimed, so nothing downstream ever sees two owners at once.
    expect(owners).toEqual([first, null, second]);
  });
});

describe("TextEditor.commit", () => {
  it("records the change and clears the owner", () => {
    const { commits, editor, node, owners } = harness();
    editor.begin(node);
    node.textContent = "Goodbye";
    editor.commit();
    expect(commits).toEqual([{ from: "Hello", node, to: "Goodbye" }]);
    expect(owners).toEqual([node, null]);
    expect(editor.active).toBe(false);
  });

  it("tears the marker off before onCommit sees the node", () => {
    // The invariant `teardown`'s own comment defends: nothing downstream — the
    // structure set, the history, the agent — ever gets a node still wearing the
    // editor's marker.
    const { node } = harness();
    let marked = true;
    const spy = new TextEditor({
      onCommit: (edit) => {
        marked = (edit.node as HTMLElement).hasAttribute(TEXT_EDIT_MARK);
      },
      setTextOwner: () => undefined,
    });
    spy.begin(node);
    node.textContent = "Changed";
    spy.commit();
    expect(marked).toBe(false);
    expect(node.hasAttribute("contenteditable")).toBe(false);
  });

  it("records nothing when the text is unchanged, but still exits", () => {
    const { commits, editor, node, owners } = harness();
    editor.begin(node);
    editor.commit();
    expect(commits).toEqual([]);
    expect(owners).toEqual([node, null]);
    expect(editor.active).toBe(false);
  });

  it("records nothing for a node that has left the DOM", () => {
    const { commits, editor, node, owners } = harness();
    editor.begin(node);
    node.textContent = "Changed";
    node.remove();
    editor.commit();
    expect(commits).toEqual([]);
    expect(owners).toEqual([node, null]);
  });

  it("is a no-op when nothing is being edited", () => {
    const { commits, editor, owners } = harness();
    editor.commit();
    expect(commits).toEqual([]);
    expect(owners).toEqual([]);
  });

  it("restores a pre-existing contenteditable rather than removing it", () => {
    const { editor, node } = harness();
    node.setAttribute("contenteditable", "true");
    editor.begin(node);
    editor.commit();
    expect(node.getAttribute("contenteditable")).toBe("true");
  });
});

describe("TextEditor keys", () => {
  it("commits on Escape and does not restore the original", () => {
    // The ladder: Escape leaves the edit with the layer still selected.
    // Reverting is ⌘Z's job, through the ordinary history stack.
    const { commits, editor, node } = harness();
    editor.begin(node);
    node.textContent = "Changed";
    const e = press(node, { key: "Escape" });
    expect(e.defaultPrevented).toBe(true);
    expect(node.textContent).toBe("Changed");
    expect(commits).toHaveLength(1);
  });

  it("leaves Escape to an open IME candidate window", () => {
    const { commits, editor, node } = harness();
    editor.begin(node);
    node.textContent = "Changed";
    press(node, { isComposing: true, key: "Escape" });
    expect(commits).toEqual([]);
    expect(editor.active).toBe(true);
  });

  it("commits on mod+Enter", () => {
    const { commits, editor, node } = harness();
    editor.begin(node);
    node.textContent = "Changed";
    press(node, { key: "Enter", metaKey: true });
    expect(commits).toHaveLength(1);
  });

  it("commits on blur", () => {
    const { commits, editor, node } = harness();
    editor.begin(node);
    node.textContent = "Changed";
    node.dispatchEvent(new FocusEvent("blur"));
    expect(commits).toHaveLength(1);
  });

  it("keeps every other key inside the field", () => {
    const { editor, node } = harness();
    editor.begin(node);
    const seen = vi.fn();
    document.addEventListener("keydown", seen, true);
    press(node, { key: "a" });
    document.removeEventListener("keydown", seen, true);
    expect(seen).not.toHaveBeenCalled();
    expect(editor.active).toBe(true);
  });

  it("beats a document-capture handler registered before the edit began", () => {
    // The ordering the whole listener placement exists for. On the canvas the
    // frame agent's text guard is exactly such a handler, and it stops
    // propagation to keep the app's shortcuts off the edit — so a listener on
    // the *node* would never run, and Escape would silently stop committing.
    const { commits, editor, node } = harness();
    const app = vi.fn((e: Event) => e.stopPropagation());
    document.addEventListener("keydown", app, true);
    editor.begin(node);
    node.textContent = "Changed";
    press(node, { key: "Escape" });
    document.removeEventListener("keydown", app, true);
    expect(commits).toHaveLength(1);
    expect(app).not.toHaveBeenCalled();
  });

  it("ignores keys aimed at anything outside the edited node", () => {
    const { commits, editor, node } = harness();
    const other = document.createElement("input");
    document.body.append(other);
    editor.begin(node);
    node.textContent = "Changed";
    press(other, { key: "Escape" });
    expect(commits).toHaveLength(0);
    expect(editor.active).toBe(true);
  });
});

describe("TextEditor surface", () => {
  it("exposes no cancel", () => {
    // Deliberately absent — Escape was its only trigger and revert is ⌘Z. A
    // regression guard, because "Escape should undo" is the first instinct.
    expect(
      (TextEditor.prototype as unknown as Record<string, unknown>).cancel
    ).toBeUndefined();
  });
});
