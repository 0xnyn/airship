/*
 * In-place text editing.
 *
 * Double-click a node whose content is a single text node and type, with the
 * caret where you clicked. `Enter` and `T` do the same to the selection but
 * select the whole string instead, which is what you want when the gesture was
 * a keystroke and there was no click to take a point from.
 *
 * **Escape commits.** It does not revert — `⌘Z` does, through the ordinary
 * history stack (`history.push({kind:"text"})` → `history-ops.applyText`). That
 * is the design-tool ladder: Escape leaves the edit with the layer still selected, and a
 * second Escape falls through to the picker's binding and deselects. There is
 * deliberately no `cancel()`: it had exactly one trigger, Escape, and a state
 * machine with no user-facing entry is dead weight. The one job it did
 * implicitly — never shipping an edit for a node that has gone away — is done
 * properly by the `isConnected` check in `commit`.
 *
 * **Scoped to leaf text nodes on purpose.** No rich text, no partial-range
 * formatting, no editing a node that also has element children. That covers the
 * overwhelming majority of real edits — a heading, a label, a button — and
 * avoids the entire `Selection`/`Range` swamp, where the next question is always
 * "what happens when you bold half a word that lives in a `<span>` a component
 * generated". `textTargetIn` is the one concession: it walks *down* to the sole
 * text-bearing descendant, so double-clicking a button's padding edits the label
 * inside it.
 *
 * One hook, `setTextOwner`, carries the whole of the editor's arrangement with
 * the rest of the overlay, because all of it has to move together and every
 * previous split left a piece behind. Downstream it becomes:
 *
 * 1. `EditGuard.allowTextOn` — presses on the node keep their *default* (the
 *    caret, drag-select, double-click-word) while still being stopped from
 *    reaching the app. The opposite arrangement from the dnd-kit hatch.
 * 2. `SelectionController.setTextOwner` — the picker stays live and declines
 *    exactly the clicks that land inside the text, so a click anywhere else can
 *    commit and move on.
 * 3. `DesignPanel`'s context snapshot — which element the commit is recorded
 *    against, taken now rather than at commit time.
 * 4. On the canvas, `FrameManager.setTextFrame` — the owning frame goes live for
 *    the duration, because a caret cannot be synthesised from the shell.
 *
 * React will clobber `textContent` on its next render, so an edit has to be
 * shipped or reverted before an HMR round-trip — the same constraint the inline
 * style previews already live under.
 */
import type { Point } from "../canvas/space";
import { PREFIX } from "../dom";
import { isHtmlElement, isNode, ownerWindow } from "../realm";
import { TEXT_EDIT_MARK } from "../styles/portable.css";

export interface TextEdit {
  from: string;
  node: Element;
  to: string;
}

/**
 * How far `textTargetIn` will walk before it gives up.
 *
 * Over the cap the answer is "ambiguous", not "keep looking": double-clicking a
 * `<main>` should not walk twenty thousand nodes to arrive at no.
 */
const TEXT_DRILL_CAP = 400;

/**
 * Can this node be edited in place?
 *
 * Requires exactly one child and for it to be a text node: a node with element
 * children has no single "the text", and `contentEditable` on it would let you
 * delete its children with a backspace.
 *
 * Note that a *block container* whose only child is text — `<div>$40</div>`,
 * `<section>Copy</section>` — qualifies, and that is deliberate rather than an
 * oversight: it is a leaf by this definition, and it is one of the most common
 * real edits in a component tree. It used to look wrong, because the UA focus
 * ring and a full-width inactive selection band are far more conspicuous on a
 * block than on a span; `styles/portable.css.ts` styles both, so the container
 * case now reads as intended instead of as a glitch.
 *
 * `inspector/node-kind.ts` carries the same predicate inline, to classify a
 * `"text"` layer for the tree. The duplication is deliberate: `nodeKind` is
 * about naming and iconography and should not take a dependency on the editor.
 */
export function isEditableText(node: Element): boolean {
  if (!isHtmlElement(node)) {
    return false;
  }
  const children = Array.from(node.childNodes);
  const texts = children.filter((c) => c.nodeType === Node.TEXT_NODE);
  return (
    children.length > 0 &&
    texts.length === children.length &&
    Boolean(node.textContent?.trim())
  );
}

/**
 * The node a double-click on `node` means.
 *
 * `node` itself when it is already a leaf text node. Otherwise its *sole*
 * text-bearing descendant, if there is exactly one — which is what makes
 * double-clicking a button, a badge or a card land on the string inside it
 * rather than doing nothing at all. `pick` already returns the deepest element
 * under the pointer, so the case this exists for is narrow and specific: you hit
 * the container's padding, and the text lives in a child that was not under the
 * pointer at all.
 *
 * Two candidates or more and the gesture is ambiguous, so it does nothing.
 * Picking the first would edit whichever the DOM happened to order first, and a
 * wrong guess here writes to the user's source.
 *
 * Deliberately *not* geometry-filtered. Narrowing by `getBoundingClientRect`
 * would buy very little over the one-candidate rule and would make the function
 * untestable under happy-dom, which has no layout.
 */
export function textTargetIn(node: Element): Element | null {
  if (isEditableText(node)) {
    return node;
  }
  // `PREFIX` rather than `edit-guard`'s `isOwn`: importing that module here
  // would pull dnd-kit into the editor and into its tests, for a check this
  // simple.
  const chrome = `#${PREFIX}-root`;
  let found: Element | null = null;
  let seen = 0;
  for (const child of Array.from(node.querySelectorAll("*"))) {
    seen += 1;
    if (seen > TEXT_DRILL_CAP) {
      return null;
    }
    if (child.closest(chrome) || !isEditableText(child)) {
      continue;
    }
    if (found) {
      return null;
    }
    found = child;
  }
  return found;
}

export interface BeginOptions {
  /**
   * Where to put the caret, in the node's **own document's** client
   * coordinates. Absent or null means select-all, which is what `Enter` and `T`
   * want and what a click deliberately does not.
   */
  caret?: Point | null;
}

export interface TextEditorDeps {
  onCommit: (edit: TextEdit) => void;
  /**
   * The node this edit owns, or null on exit. See the header — this one hook
   * stands in for the press hatch, the picker's click routing, the panel's
   * committed-context snapshot and the canvas frame override, because all four
   * have to move together.
   */
  setTextOwner: (node: Element | null) => void;
}

export class TextEditor {
  private editing: HTMLElement | null = null;
  private original = "";
  private prevEditable: string | null = null;
  /** True between `compositionstart` and `compositionend` — an IME is open. */
  private composing = false;
  /** The window `onKeyDown` is bound to — the node's, which may be a frame's. */
  private keyWindow: Window | null = null;

  private readonly deps: TextEditorDeps;

  constructor(deps: TextEditorDeps) {
    this.deps = deps;
  }

  get active(): boolean {
    return this.editing !== null;
  }

  /** The node being edited, for the disconnected-node sweep in `DesignPanel`. */
  get node(): HTMLElement | null {
    return this.editing;
  }

  /** Enter edit mode on a node. Returns false if it is not editable text. */
  begin(node: Element, options: BeginOptions = {}): boolean {
    if (this.editing) {
      this.commit();
    }
    if (!(isEditableText(node) && isHtmlElement(node))) {
      return false;
    }
    this.editing = node;
    this.original = node.textContent ?? "";
    this.prevEditable = node.getAttribute("contenteditable");

    // `plaintext-only` is what keeps a paste from injecting markup into the
    // user's DOM. Firefox does not support it, so fall back and sanitise the
    // paste by hand rather than silently accepting rich text there.
    node.setAttribute(
      "contenteditable",
      supportsPlaintext() ? "plaintext-only" : "true"
    );
    // An attribute, not a class, and the distinction is load-bearing:
    // `edit-guard.ts`'s `isEditorNode` answers true for any page node carrying
    // *any* `__airship-*` class, and `DesignPanel.renderTreeNode` skips nodes it
    // answers true for. A marker class would make the node you are editing
    // vanish from the layers tree for the duration of the edit — taking its
    // siblings' indices with it — and would have `removeSelection` refuse on it.
    // `isEditorNode` only ever scans `classList`, so an attribute sidesteps it.
    // On the canvas the frame agent also keys its in-realm press guard off it.
    node.setAttribute(TEXT_EDIT_MARK, "");
    node.addEventListener("paste", this.onPaste);
    node.addEventListener("blur", this.onBlur);
    node.addEventListener("compositionstart", this.onCompositionStart);
    node.addEventListener("compositionend", this.onCompositionEnd);
    // Keys go on the node's *window*, in capture, rather than on the node.
    //
    // Window capture is the first step of the propagation path, so this beats
    // every `document`-capture handler — the app's own `/`-to-search, and (on
    // the canvas) the frame agent's text guard, which stops propagation at the
    // frame's document to keep those app handlers off the edit. A listener on
    // the node would sit at the *end* of that path and never run: the guard's
    // `stopPropagation` halts descent before the target is reached, so Escape
    // and ⌘Enter would silently stop committing inside a live frame.
    this.keyWindow = ownerWindow(node);
    this.keyWindow?.addEventListener("keydown", this.onKeyDown, true);

    // Before `focus`, not after: the guard and the picker have to be routing for
    // this node by the time focus moves, or the focus change itself is the first
    // thing they mishandle.
    this.deps.setTextOwner(node);

    node.focus({ preventScroll: true });
    if (!(options.caret && placeCaretAt(node, options.caret))) {
      selectAll(node);
    }
    return true;
  }

  /** Record the change (if any) and leave edit mode. */
  commit(): void {
    const node = this.editing;
    if (!node) {
      return;
    }
    const to = node.textContent ?? "";
    // Read before `teardown`, which is what makes the check honest — and note
    // that a node React unmounted, a frame that reloaded over HMR or a subtree
    // the app replaced mid-edit all land here. Recording against one would ship
    // a text edit for a node the agent cannot find, keyed by an `Element`
    // nothing else in the session holds a reference to.
    const live = node.isConnected;
    this.teardown();
    if (live && to !== this.original) {
      this.deps.onCommit({ from: this.original, node, to });
    }
  }

  private teardown(): void {
    const node = this.editing;
    if (!node) {
      return;
    }
    node.removeEventListener("paste", this.onPaste);
    node.removeEventListener("blur", this.onBlur);
    node.removeEventListener("compositionstart", this.onCompositionStart);
    node.removeEventListener("compositionend", this.onCompositionEnd);
    this.keyWindow?.removeEventListener("keydown", this.onKeyDown, true);
    this.keyWindow = null;
    // Dropped here rather than in `commit`, which is what keeps it out of
    // everything downstream: `commit()` calls `teardown()` *before*
    // `deps.onCommit(edit)`, so the node the agent is told about — and the node
    // the structure set records — never carries the editor's marker.
    node.removeAttribute(TEXT_EDIT_MARK);
    if (this.prevEditable === null) {
      node.removeAttribute("contenteditable");
    } else {
      node.setAttribute("contenteditable", this.prevEditable);
    }
    node.blur();
    // On the canvas the node lives in a frame, so blurring it leaves the
    // *frame's* document active and the shell's key registry — which listens on
    // the shell's document — never sees another keystroke. The second Escape
    // would then not deselect. `window` here is the shell's: this bundle runs in
    // the shell realm even when the node it is editing does not.
    if (ownerWindow(node) !== window) {
      window.focus();
    }
    this.editing = null;
    this.prevEditable = null;
    this.composing = false;
    this.deps.setTextOwner(null);
  }

  private readonly onBlur = (): void => {
    this.commit();
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly onCompositionEnd = (): void => {
    this.composing = false;
  };

  private readonly onKeyDown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    // Bound to the window, so it sees every key in the document — including the
    // ones the app's own fields are receiving while nothing is being edited here.
    const node = this.editing;
    const { target } = ke;
    if (!(node && isNode(target) && node.contains(target))) {
      return;
    }
    if (ke.key === "Escape") {
      // An open IME candidate window owns Escape — it means "discard the
      // candidate", and taking it here would end the edit mid-word.
      if (this.composing || ke.isComposing) {
        ke.stopPropagation();
        return;
      }
      ke.preventDefault();
      ke.stopPropagation();
      this.commit();
      return;
    }
    if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
      ke.preventDefault();
      ke.stopPropagation();
      this.commit();
      return;
    }
    // Every other key belongs to the field, not to the editor's shortcuts.
    ke.stopPropagation();
  };

  /** Firefox fallback: force plain text even though the element accepts rich. */
  private readonly onPaste = (e: Event): void => {
    if (supportsPlaintext()) {
      return;
    }
    const ce = e as ClipboardEvent;
    ce.preventDefault();
    const text = ce.clipboardData?.getData("text/plain") ?? "";
    if (ce.target instanceof HTMLElement) {
      ce.target.ownerDocument.execCommand("insertText", false, text);
    }
  };
}

let plaintextSupport: boolean | null = null;

function supportsPlaintext(): boolean {
  if (plaintextSupport === null) {
    const probe = document.createElement("div");
    probe.setAttribute("contenteditable", "plaintext-only");
    plaintextSupport = probe.contentEditable === "plaintext-only";
  }
  return plaintextSupport;
}

/**
 * The two spellings of caret-from-point.
 *
 * Declared as a standalone shape rather than `extends Document`, because the DOM
 * lib types both as *required* — `caretRangeFromPoint` is not in every engine
 * and `caretPositionFromPoint` was not until recently, so the honest type is the
 * optional one and it cannot be reconciled with the built-in.
 */
interface CaretApis {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offset: number; offsetNode: Node } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * Put the caret where the user clicked. False if that could not be worked out,
 * and the caller falls back to selecting everything.
 *
 * The cross-browser split is not the one it is usually written as:
 * `caretPositionFromPoint` is the standard and now ships in Chrome, while
 * `caretRangeFromPoint` is the older WebKit spelling Safari still needs.
 * Standard first, fall back.
 *
 * Resolved against `node.ownerDocument`, never the bare `document`. On the
 * canvas the node lives one realm down, and asking the shell's document about a
 * point in a frame's coordinate space answers about the shell's own DOM —
 * silently, with a caret that lands somewhere plausible and wrong.
 */
function placeCaretAt(node: HTMLElement, at: Point): boolean {
  const doc = node.ownerDocument;
  const apis = doc as unknown as CaretApis;
  const view = doc.defaultView;
  if (!view) {
    return false;
  }
  let range: Range | null = null;
  const pos = apis.caretPositionFromPoint?.(at.x, at.y);
  if (pos) {
    range = doc.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
  } else {
    range = apis.caretRangeFromPoint?.(at.x, at.y) ?? null;
  }
  // A point just outside the box still resolves, to whatever is under it. A
  // caret in the node next door would be a much stranger outcome than the
  // select-all the caller falls back to.
  if (!(range && node.contains(range.startContainer))) {
    return false;
  }
  const selection = view.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function selectAll(node: HTMLElement): void {
  const doc = node.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(node);
  const selection = doc.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
