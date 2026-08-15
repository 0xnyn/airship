import type { ElementContext } from "@airship/protocol";
import { describe, expect, it, vi } from "vitest";
import { AttrSet } from "../attr-set";
import { ChangeSet } from "../change-set";
import { CommentSet } from "../comment-set";
import { MoveSet } from "../move-set";
import type { Selection } from "../picker";
import { StructureSet } from "../structure-set";
import {
  buildEditRequest,
  type EditRequestParts,
  hasVisualDeltas,
} from "./build-request";

// `ChangeSet` previews through `style-model` and `StructureSet` reaches for the
// realm's surface; neither is what these tests are about.
vi.mock("../inspector/style-model", () => ({
  applyPreview: vi.fn(),
  clearPreview: vi.fn(),
}));

const button: ElementContext = {
  classes: ["btn"],
  displayName: "Button",
  tagName: "button",
  textPreview: "Go",
};

const tag: ElementContext = {
  classes: ["tag"],
  displayName: "Tag",
  tagName: "span",
  textPreview: "New",
};

/** Everything empty — each test turns on only the state it cares about. */
function parts(overrides: Partial<EditRequestParts> = {}): EditRequestParts {
  return {
    agent: "claude",
    attrSet: new AttrSet(),
    changeSet: new ChangeSet(),
    commentSet: new CommentSet(),
    images: [],
    moveSet: new MoveSet(),
    parentJobId: null,
    prompt: "",
    selected: null,
    structureSet: new StructureSet(),
    ...overrides,
  };
}

function selection(element: ElementContext): Selection {
  return {
    element,
    node: document.createElement(element.tagName),
    rect: { height: 10, left: 0, top: 0, width: 10 },
    source: { file: "src/App.tsx", line: 4 },
    surface: null as unknown as Selection["surface"],
  };
}

/** A move of `node` out of its original parent, so the set keeps it. */
function movedSet(element: ElementContext): MoveSet {
  const set = new MoveSet();
  const origParent = document.createElement("div");
  const newParent = document.createElement("section");
  const node = document.createElement(element.tagName);
  newParent.append(node);
  set.record({
    before: null,
    beforeSource: null,
    element,
    newParent: null,
    newParentSource: null,
    node,
    origNext: null,
    origParent,
    source: { file: "src/Old.tsx", line: 2 },
    toIndex: 0,
  });
  return set;
}

describe("buildEditRequest", () => {
  it("returns null when there is nothing to send", () => {
    // The empty-state contract. Sending this anyway would fail the server's
    // schema refine and come back as an error toast reading "invalid message"
    // — for the crime of not having typed anything yet.
    expect(buildEditRequest(parts())).toBeNull();
  });

  it("returns null for whitespace-only text", () => {
    expect(buildEditRequest(parts({ prompt: "   \n  " }))).toBeNull();
  });

  it("omits empty delta arrays rather than sending []", () => {
    // Not cosmetic: the server's refine and `buildEditPrompt`'s branch tests
    // both key off length, so `[]` would route a plain typed message into the
    // direct-manipulation prompt.
    const request = buildEditRequest(parts({ prompt: "make it blue" }));
    expect(request).not.toBeNull();
    expect(request?.prompt).toBe("make it blue");
    expect(request?.visualChanges).toBeUndefined();
    expect(request?.moveChanges).toBeUndefined();
    expect(request?.structuralChanges).toBeUndefined();
    expect(request?.textChanges).toBeUndefined();
    expect(request?.attrChanges).toBeUndefined();
    expect(request?.comments).toBeUndefined();
    expect(request?.images).toBeUndefined();
    expect(request?.element).toBeUndefined();
    expect(request?.source).toBeNull();
  });

  it("never sets fork — that one-shot belongs to the caller", () => {
    // The regression this guards: the preview calls this on a debounce, so
    // consuming `takeFork` here would let merely looking at the prompt eat the
    // user's pending Branch.
    const request = buildEditRequest(parts({ prompt: "go" }));
    expect(request?.fork).toBeUndefined();
  });

  it("scopes to the selection when there is one", () => {
    const request = buildEditRequest(
      parts({ prompt: "bigger", selected: selection(button) })
    );
    expect(request?.element).toEqual(button);
    expect(request?.source).toEqual({ file: "src/App.tsx", line: 4 });
  });

  it("falls back to the first moved element when nothing is selected", () => {
    const request = buildEditRequest(parts({ moveSet: movedSet(tag) }));
    expect(request?.element).toEqual(tag);
    expect(request?.source).toEqual({ file: "src/Old.tsx", line: 2 });
    expect(request?.moveChanges).toHaveLength(1);
  });

  it("sends on deltas alone, with no typed text", () => {
    const attrSet = new AttrSet();
    attrSet.record({
      attribute: "alt",
      element: button,
      from: null,
      node: document.createElement("button"),
      source: null,
      to: "A cat",
    });
    const request = buildEditRequest(parts({ attrSet }));
    expect(request).not.toBeNull();
    expect(request?.prompt).toBe("");
    expect(request?.attrChanges).toHaveLength(1);
    expect(request?.element).toEqual(button);
  });

  it("excludes disabled style declarations", () => {
    const changeSet = new ChangeSet();
    const node = document.createElement("button");
    changeSet.record({
      element: button,
      from: "12px",
      node,
      property: "padding",
      source: null,
      to: "16px",
    });
    changeSet.record({
      element: button,
      from: "#000",
      node,
      property: "color",
      source: null,
      to: "#111",
    });
    changeSet.setDisabled(node, "color", true);

    const request = buildEditRequest(parts({ changeSet }));
    const properties = request?.visualChanges?.[0].changes.map(
      (c) => c.property
    );
    expect(properties).toEqual(["padding"]);
  });

  it("drops style, text and attribute edits for an element it also deletes", () => {
    /*
     * Two contradictory instructions about one element used to ship together.
     * `removeSelection` deliberately does not touch the change set — a delete is
     * undoable, and the declarations have to come back with it — so styling a card
     * and then pressing ⌫ sent `visualChanges` for it alongside
     * `structuralChanges: [{op: "delete"}]`.
     */
    const node = document.createElement("button");
    const parent = document.createElement("div");
    parent.append(node);

    const changeSet = new ChangeSet();
    changeSet.record({
      element: button,
      from: "12px",
      node,
      property: "padding",
      source: null,
      to: "32px",
    });
    const attrSet = new AttrSet();
    attrSet.record({
      attribute: "alt",
      element: button,
      from: null,
      node,
      source: null,
      to: "A cat",
    });
    const structureSet = new StructureSet();
    structureSet.record({
      element: button,
      node,
      op: "delete",
      origNext: null,
      origParent: parent,
      source: null,
    });

    const request = buildEditRequest(
      parts({ attrSet, changeSet, structureSet })
    );
    expect(request?.structuralChanges).toHaveLength(1);
    // Absent, not `[]` — the server's refine and the prompt's branch tests both
    // key off length.
    expect(request?.visualChanges).toBeUndefined();
    expect(request?.attrChanges).toBeUndefined();
  });

  it("drops edits on a descendant of a deleted element", () => {
    // A delete takes its whole subtree, so a style change on a child is just as
    // contradictory as one on the element itself.
    const card = document.createElement("div");
    const label = document.createElement("span");
    card.append(label);
    const parent = document.createElement("main");
    parent.append(card);

    const changeSet = new ChangeSet();
    changeSet.record({
      element: tag,
      from: "#000",
      node: label,
      property: "color",
      source: null,
      to: "#f00",
    });
    const structureSet = new StructureSet();
    structureSet.record({
      element: button,
      node: card,
      op: "delete",
      origNext: null,
      origParent: parent,
      source: null,
    });

    const request = buildEditRequest(parts({ changeSet, structureSet }));
    expect(request?.visualChanges).toBeUndefined();
  });

  it("keeps edits on elements a delete does not cover", () => {
    const doomed = document.createElement("button");
    const kept = document.createElement("span");
    const parent = document.createElement("div");
    parent.append(doomed, kept);

    const changeSet = new ChangeSet();
    changeSet.record({
      element: tag,
      from: "#000",
      node: kept,
      property: "color",
      source: null,
      to: "#f00",
    });
    const structureSet = new StructureSet();
    structureSet.record({
      element: button,
      node: doomed,
      op: "delete",
      origNext: null,
      origParent: parent,
      source: null,
    });

    const request = buildEditRequest(parts({ changeSet, structureSet }));
    expect(request?.visualChanges).toHaveLength(1);
    expect(request?.structuralChanges).toHaveLength(1);
  });

  it("keeps edits whose node has detached, which is what HMR leaves behind", () => {
    /*
     * The reason the filter above is a structural-delete test and not an
     * `isConnected` test. After an HMR re-render every pending change points at a
     * detached node, and those are exactly the edits that must still ship — the
     * agent works from the captured `ElementContext` and source location, not from
     * the live node.
     */
    const orphan = document.createElement("button");
    const changeSet = new ChangeSet();
    changeSet.record({
      element: button,
      from: "12px",
      node: orphan,
      property: "padding",
      source: { file: "src/App.tsx", line: 4 },
      to: "32px",
    });

    expect(orphan.isConnected).toBe(false);
    const request = buildEditRequest(parts({ changeSet }));
    expect(request?.visualChanges).toHaveLength(1);
  });

  it("carries pasted images only when there are some", () => {
    const images = [{ dataBase64: "abc", mediaType: "image/png" }];
    expect(buildEditRequest(parts({ images, prompt: "x" }))?.images).toEqual(
      images
    );
  });

  it("inherits the comment set's parent job when none is active", () => {
    // A comment on an older turn has to reach the session that wrote the code
    // being critiqued, not a fresh agent with no memory of it.
    const commentSet = new CommentSet();
    commentSet.add({
      body: "tighten this",
      file: "src/App.tsx",
      fromLine: 4,
      jobId: "job-7",
      snippet: "<button>",
      toLine: 4,
    });
    const request = buildEditRequest(parts({ commentSet }));
    expect(request?.comments).toHaveLength(1);
    expect(request?.parentJobId).toBe("job-7");
  });

  it("prefers an active thread over the comment's own job", () => {
    const commentSet = new CommentSet();
    commentSet.add({
      body: "and this",
      file: "src/App.tsx",
      fromLine: 4,
      jobId: "job-7",
      snippet: "<button>",
      toLine: 4,
    });
    const request = buildEditRequest(
      parts({ commentSet, parentJobId: "job-9" })
    );
    expect(request?.parentJobId).toBe("job-9");
  });

  it("is free of side effects across repeated calls", () => {
    // The invariant the debounced preview rests on: it calls this on every
    // settled keystroke, and a build that consumed or mutated state would make
    // looking at the prompt change what gets sent.
    const p = parts({ moveSet: movedSet(tag), prompt: " tidy up " });
    const first = buildEditRequest(p);
    const second = buildEditRequest(p);
    expect(second).toEqual(first);
    expect(buildEditRequest(p)).toEqual(first);
  });
});

describe("the backend and its model", () => {
  it("carries both when the picker has chosen one", () => {
    const request = buildEditRequest(
      parts({ agent: "codex", model: "gpt-5.3-codex", prompt: "hi" })
    );
    expect(request?.agent).toBe("codex");
    expect(request?.model).toBe("gpt-5.3-codex");
  });

  it("omits the model when the picker is on Default", () => {
    // Absent, not empty: the daemon reads a missing model as "use the default
    // resolved for this backend", and `""` would be an id of "".
    const request = buildEditRequest(parts({ model: "", prompt: "hi" }));
    expect(request && "model" in request && request.model).toBeFalsy();
    expect(request?.model).toBeUndefined();
  });

  it("omits the model when the picker never set one", () => {
    expect(buildEditRequest(parts({ prompt: "hi" }))?.model).toBeUndefined();
  });
});

describe("hasVisualDeltas", () => {
  it("is false for a plain typed turn", () => {
    const request = buildEditRequest(parts({ prompt: "hello" }));
    expect(request && hasVisualDeltas(request)).toBe(false);
  });

  it("is true once any delta rides along", () => {
    const request = buildEditRequest(parts({ moveSet: movedSet(tag) }));
    expect(request && hasVisualDeltas(request)).toBe(true);
  });
});
