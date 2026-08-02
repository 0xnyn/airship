import type {
  Editor,
  ElementContext,
  PseudoState,
  SourceLocation,
  TokenRef,
} from "@airship/protocol";
import {
  type DesignToken,
  propertiesForCategory,
  TOKEN_CATEGORIES,
} from "@airship/protocol/tokens";
import type { Collision } from "@dnd-kit/abstract";
import type { AttrSet } from "../attr-set";
import type { Point } from "../canvas/space";
import type { Change, ChangeSet, ChangeTarget } from "../change-set";
import { type ChromeLayer, hide, place } from "../chrome-layer";
import {
  DND,
  DndScope,
  DragDelta,
  Draggable,
  Droppable,
  FEEDBACK,
  hit,
  manager,
} from "../dnd/manager";
import { clear, cls, el, elementLabel } from "../dom";
import { isEditorNode } from "../edit-guard";
import { emptyState } from "../empty";
import type { History } from "../history";
import { type IconName, icon } from "../icons";
import type { MoveSet } from "../move-set";
import type { Selection, SelectionController } from "../picker";
import { closeOpenPopover, createMenu, type MenuEntry } from "../popover-host";
import {
  computedStyle,
  isHtmlElement,
  ownerDocument,
  ownerWindow,
} from "../realm";
import type { StructureRecord, StructureSet } from "../structure-set";
import { clipToSurface, localRect, type SurfaceResolver } from "../surface";
import { toast } from "../toast";
import { findToken, resolveTokens, toRef } from "../tokens/match";
import { onTokensChange, tokenPreviewValue } from "../tokens/registry";
import { measureXY } from "./constraints";
import { createColorControl, createColorRow } from "./controls/color-picker";
import {
  createNumField,
  type NumHandle,
  type NumSpec,
} from "./controls/num-field";
import { createNumberScrub } from "./controls/number-scrub";
import { createPadding } from "./controls/padding";
import { createSegmented } from "./controls/segmented";
import { createSelect } from "./controls/select";
import { createTokenBadge, shortName } from "./controls/token-field";
import type { ControlHandle, Gestures, OnChange } from "./controls/types";
import { fromPx, LENGTH_UNITS, parseLength } from "./css-length";
import { beginScanPass } from "./css-rules";
import { type Descriptor, GROUPS, hasText, SPACING_GROUP } from "./descriptors";
import {
  hasBackgroundImage,
  isImage,
  isMedia,
  isSvgChild,
  isSvgRoot,
  isVideo,
} from "./element-kind";
import {
  enterState,
  exitState,
  injectedProperties,
  trackInjected,
} from "./forced-state";
import { hasBounds, hasFill, hasStroke, type Reader } from "./gates";
import { KIND_ICON, layerName, nodeKind } from "./node-kind";
import { type CompletedMove, DragReorderController } from "./reorder";
import { renderAlignRow } from "./sections/align-row";
import { renderAppearance } from "./sections/appearance";
import { renderAutoLayout } from "./sections/auto-layout";
import { renderConstraints } from "./sections/constraints";
import type { SectionContext, TokenSlot } from "./sections/context";
import { renderCssPane } from "./sections/css";
import { renderEffects } from "./sections/effects";
import { renderFill } from "./sections/fill";
import { renderFilters } from "./sections/filters";
import { renderMedia } from "./sections/media";
import { moveTo, renderPosition } from "./sections/position";
import { labelled } from "./sections/row";
import { renderScopeRow } from "./sections/scope";
import { renderSize } from "./sections/size";
import { renderSpacing } from "./sections/spacing";
import { renderStroke } from "./sections/stroke";
import { renderText } from "./sections/text";
import { renderVector } from "./sections/vector";
import { declaredValue, isFlexChild } from "./sizing";
import {
  applyPreview,
  clearPreview,
  readValue,
  readValues,
} from "./style-model";
import { TextEditor } from "./text-edit";

export interface DesignPanelDeps {
  /** Accumulates HTML attribute edits (`alt`, `loading`, `autoplay`, …). */
  attrSet: AttrSet;
  changeSet: ChangeSet;
  controller: SelectionController;
  /** Undo/redo journal. Every recorded change is pushed here. */
  history: History;
  /** Where the drop indicators and the reorder drag proxy are drawn. */
  layer: ChromeLayer;
  /** Accumulates structural (drag-to-reposition) moves. */
  moveSet: MoveSet;
  /** Notify the app that the pending change set changed (count, previews, or
   * outline) so it can re-render the composer's pending-tweaks pill. The panel
   * no longer ships edits itself — the left composer is the single outbox. */
  onChanged?: () => void;
  /** Put a source path on the clipboard. Omitted where there is no socket. */
  onCopyPath?: (file: string) => void;
  /** Open a source file in the user's editor. Omitted where there is no socket. */
  onOpenIn?: (editor: Editor, file: string, line?: number) => void;
  /**
   * A node is being edited in place, or null on exit.
   *
   * Carries past the panel to the stage: the canvas answers by making that
   * node's frame live for the duration, because `pointer-events: none` is what
   * makes a caret unplaceable. Inline has nothing to lift and omits it.
   */
  onTextOwner?: (node: Element | null) => void;
  /** Resolves a node to the frame (or document) it lives in. */
  resolver: SurfaceResolver;
  /** Accumulates deletes, duplicates and in-place text edits. */
  structureSet: StructureSet;
}

type Tab = "edit" | "css" | "dom";
type DropPos = "before" | "after" | "inside";

interface TreeDrag {
  node: Element;
  origNext: Node | null;
  origParent: Element | null;
}

/** Fraction of a row's height that reads as "before" / "after" rather than "inside". */
const TREE_EDGE_ZONE = 0.28;

/** Elements that exist in the DOM but render nothing, so are not layers. */
const NON_VISUAL = new Set([
  "script",
  "style",
  "link",
  "meta",
  "title",
  "head",
  "base",
  "noscript",
  "template",
]);

function isNonVisual(node: Element): boolean {
  return NON_VISUAL.has(node.tagName.toLowerCase());
}

/** Last segment of a source path. Handles both separators — the path comes from
 * the framework's own metadata, which on Windows is backslashed. */
function basename(path: string): string {
  return path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1
  );
}

/**
 * The Source heading's summary — `App.tsx:31`, full path on hover.
 *
 * Deliberately inert. It used to be a button that opened the editor menu, which
 * made a heading that toggles a section contain a word that does something else
 * entirely, and cost the chip's own click target to a `stopPropagation` in the
 * actions bar. The menu lives on a visible kebab inside the section now, so the
 * whole header does one thing again: open it.
 */
function sourceChip(source: SourceLocation | null): HTMLElement {
  if (!source) {
    return el("div", {
      class: `${cls("insp-src")} ${cls("insp-src-off")}`,
      text: "no source",
    });
  }
  const suffix = source.line ? `:${source.line}` : "";
  return el("div", {
    class: cls("insp-src"),
    text: `${basename(source.file)}${suffix}`,
    title: `${source.file}${suffix}`,
  });
}

/**
 * An `ElementContext` read straight off the DOM.
 *
 * The synchronous stand-in for `Surface.extract`, which is async because it walks
 * React's fiber tree for a component name and a sourcemap for a line. Everything
 * here is a fact the DOM already holds, so it is never *wrong* — it is only less
 * informative, missing `displayName` and the source location. The server resolves
 * the file from the context either way (`resolveServerSource`).
 *
 * Used for a co-selected node whose resolution has not landed, and for a foreign
 * node the picker never extracted at all — the flex parent the alignment row
 * writes to, which used to be described to the agent as the selected child.
 */
function domContext(node: Element): ElementContext {
  return {
    classes: Array.from(node.classList ?? []),
    displayName: null,
    tagName: node.tagName.toLowerCase(),
    textPreview: (node.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
  };
}

/**
 * A px value written back in the unit the element was authored in.
 *
 * Every length control seeds from `getComputedStyle`, which is always px — so the
 * panel showed `32` for `.hero { padding: 2rem }`, and one arrow key wrote
 * `padding-left: 33px`. The `rem` was gone, and the agent was told to hardcode a
 * pixel value into a scale-based design system. Over a few edits that converts a
 * responsive stylesheet into a fixed one, a property at a time, with nothing on
 * screen to say so.
 *
 * Only px→`rem`/`em`, and only when the element genuinely declares that unit:
 *
 * - A value the user typed *with* a unit is theirs and passes through untouched.
 *   `50%` in a px field is a deliberate act, and `num-field` already preserves it.
 * - `%`, `vw`, `vh` are left as px, because a percentage is not invertible from a
 *   length alone — the basis depends on the property (a percentage `padding-top`
 *   resolves against the containing block's *inline* size, a percentage
 *   `line-height` against the font size). Converting without knowing the basis
 *   would trade a visible unit change for an invisible wrong number, which is worse.
 */
function keepAuthoredUnit(
  node: Element,
  property: string,
  value: string
): string {
  const parsed = parseLength(value, ["px"]);
  if (parsed?.unit !== "px") {
    return value;
  }
  const authored = parseLength(declaredValue(node, property), [
    ...LENGTH_UNITS,
  ]);
  if (!authored || (authored.unit !== "rem" && authored.unit !== "em")) {
    return value;
  }
  return fromPx(parsed.value, authored.unit, node) ?? value;
}

/** What a control shows when a multi-selection disagrees on a value. */
const MIXED = "Mixed";

/**
 * How many elements a class-scoped edit is previewed on.
 *
 * A utility class can match thousands of nodes, and painting all of them on every
 * pointermove of a scrub would stall the frame. The Scope picker's own count stays the
 * truth about how many the edit affects.
 */
const SCOPE_PREVIEW_LIMIT = 200;

/**
 * The properties whose value can arrive from an ancestor.
 *
 * Only these are worth marking: an undeclared `padding` is `0px` because that is its
 * initial value, not because anything inherited it. Scoped to the properties the panel
 * actually shows rather than to the whole inherited set in the spec.
 */
const INHERITED_PROPERTIES = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "list-style",
  "text-align",
  "text-indent",
  "text-transform",
  "visibility",
  "white-space",
  "word-spacing",
]);

/**
 * The nearest ancestor that declares `property`, described for a tooltip.
 *
 * Walks the authored declarations rather than computed style, because computed style is
 * exactly what cannot tell inheritance from a local value.
 */
function inheritedFrom(node: Element, property: string): string | null {
  let current = node.parentElement;
  while (current) {
    if (declaredValue(current, property)) {
      const classes = Array.from(current.classList)
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      return `${current.tagName.toLowerCase()}${classes}`;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Every property a token could ever apply to, resolved in one pass.
 *
 * Derived from the token vocabulary rather than from what the panel happens to
 * render, so a control gaining a token affordance never needs this list
 * updated — and so the single resolution pass per render genuinely covers
 * every badge that render will build.
 */
const TOKENIZABLE_PROPERTIES: readonly string[] = TOKEN_CATEGORIES.flatMap(
  (category) => [...propertiesForCategory(category)]
);

/**
 * Do two snapshots of a pending declaration describe the same state?
 *
 * Compared field by field rather than by reference, because a snapshot is a
 * copy — and only on the fields an undo would put back. `from` is excluded on
 * purpose: it is the slot's original value and by definition does not move.
 */
function sameDecl(a: Change | null, b: Change | null): boolean {
  if (!(a && b)) {
    return a === b;
  }
  return (
    a.to === b.to &&
    Boolean(a.disabled) === Boolean(b.disabled) &&
    Boolean(a.hardcode) === Boolean(b.hardcode) &&
    a.token?.name === b.token?.name &&
    a.token?.via === b.token?.via
  );
}

/**
 * The extra instructions a style write can carry beyond its value.
 *
 * Both fields exist for the token affordance, and neither is set by an ordinary
 * control: a number field says what the value is and nothing about how it
 * should be expressed in source.
 */
interface RecordOpts {
  /** Keep the declaration even when the value is unchanged. See `RecordInput`. */
  binding?: boolean;
  /** The token the user picked, in place of one inferred from the value. */
  token?: TokenRef;
}

/** The right-dock design inspector. */
export class DesignPanel {
  readonly element: HTMLElement;

  private selection: Selection | null = null;
  private tab: Tab = "edit";
  /** Substring filter for the CSS tab's computed-styles list. */
  private cssFilter = "";
  private controls: ControlHandle[] = [];
  private readonly reorder: DragReorderController;

  /**
   * Sections the user has collapsed, by stable id.
   *
   * On the panel rather than in `section()`, because the body is rebuilt from
   * scratch fourteen times over — so a local `let open = true` meant every
   * section sprang back open the moment you touched any control. The DOM tree's
   * `expanded` set below is the same idea and has always worked this way.
   */
  /**
   * Token resolution for this render, by node. Rebuilt in `renderBody`.
   *
   * A `Map` rather than a field per node because the alignment row's parent
   * writes mean a render can build badges for more than one element.
   */
  private tokenCache = new Map<Element, Map<string, TokenRef>>();
  private readonly collapsed = new Set<string>();
  /**
   * Section ids rendered at least once, so `startCollapsed` can apply on first
   * sight only. Without it a default-closed section would slam shut on every
   * rebuild, which is every keystroke in a neighbouring field.
   */
  private readonly seenSections = new Set<string>();
  /** CSS pane: latched filter text and "non-default only", for the same reason
   * `collapsed` is latched — they are decisions about the panel, not the node. */
  private readonly cssView = { terse: false };
  /**
   * Whether the Size section is showing min/max. Sticky across rebuilds for the
   * same reason `collapsed` is: it is a decision the user made about the panel,
   * not a fact about the element.
   */
  private readonly sizeState = { showBounds: false };
  /**
   * Which selector and interaction state edits are currently written to.
   *
   * Empty is "this element, default state" — the only behaviour that existed
   * before the Scope/State rows, and still the overwhelmingly common case. It is
   * panel state rather than per-section state because it governs every write,
   * and it is reset on selection change: a scope is a set of classes on *this*
   * element and means nothing on the next one.
   */
  private editTarget: ChangeTarget = {};
  /** What the last render was of, so a rebuild knows whether to keep the view. */
  private renderedTab: Tab | null = null;
  private renderedNode: Element | null = null;
  /** `shapeKey` of the last render; a mismatch means re-seeding is not enough. */
  private shape = "";

  private readonly headEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

  // DOM-tab tree state.
  private readonly expanded = new Set<Element>();
  private readonly rowNode = new WeakMap<HTMLElement, Element>();
  /** dnd-kit entities for the current tree render; torn down on every rebuild. */
  private readonly treeScope = new DndScope();
  /** Monotonic id source so each rendered row gets a stable, unique entity id. */
  private rowId = 0;
  private treeDrag: TreeDrag | null = null;
  /** What a row detector resolved for the latest pointer position. */
  private treeResolved: { node: Element; pos: DropPos; rect: DOMRect } | null =
    null;
  /** `treeResolved`, but only once that row actually won the collision. */
  private treeArmed: { node: Element; pos: DropPos; rect: DOMRect } | null =
    null;
  /** Tracks the live pointer for the row detectors — see `DragDelta.pointer`. */
  private readonly treeDelta = new DragDelta();
  private readonly unwatch: (() => void)[] = [];
  private readonly treeDropLine: HTMLElement;
  private readonly treeDropInto: HTMLElement;
  /** Layers locked against selection. Editor-local, never written to the page. */
  private readonly locked = new Set<Element>();
  /** The rest of a multi-selection; `selection` is the primary. */
  private extra: Element[] = [];
  /**
   * Each co-selected node's own resolved context, once `extract` returns. Empty
   * until then, and `infoFor` covers the gap. See `resolveExtras`.
   */
  private extraInfo = new Map<
    Element,
    { element: ElementContext; source: SourceLocation | null }
  >();
  /** Drops a resolution a newer `setExtra` has superseded. */
  private extraGen = 0;
  /**
   * Elements a class-scoped edit is being previewed on, and the properties painted.
   *
   * Not in any change set — see `previewScope` — so they need their own teardown.
   */
  private scopePreviewed = new Set<Element>();
  private scopeProperties = new Set<string>();
  private readonly textEditor: TextEditor;
  /**
   * The selection context an in-flight text edit was begun against.
   *
   * Read at commit instead of `this.selection`, and that is not belt-and-braces.
   * Entry is asynchronous — a double-click fires `click`, `click`, `dblclick`,
   * and `SelectionController.select` resolves the component context through an
   * `await`, so at `dblclick` time the panel is routinely still holding the
   * previous selection. Exit is asynchronous too: sticky mode commits the old
   * edit and selects the new node inside a single gesture. So "the selection when the
   * edit ends" and "the selection the edit was for" are regularly different
   * objects, and recording against the wrong one ships a text change for a file
   * the user never touched — invisible until the agent edits it.
   *
   * Keyed by node, so a stale snapshot is inert rather than wrong.
   */
  private textCtx: {
    element: ElementContext;
    node: Element;
    source: SourceLocation | null;
  } | null = null;

  private readonly deps: DesignPanelDeps;

  constructor(deps: DesignPanelDeps) {
    this.deps = deps;
    this.reorder = new DragReorderController({
      getSelectionNode: () => this.selection?.node ?? null,
      getSelectionSurface: () => this.selection?.surface ?? null,
      layer: deps.layer,
      onMove: (move) => {
        this.recordMove(move);
      },
    });
    // dnd-kit binds its sensors to the proxy, and those are element-level
    // listeners — so the guard has to let a press on it survive the capture
    // phase or a move drag could never start.
    deps.controller.guard.allowPressOn(() => this.reorder.proxyElement);
    this.headEl = el("div", { class: cls("insp-head") });
    this.tabsEl = el("div", { class: cls("insp-tabs") });
    this.bodyEl = el("div", { class: cls("insp-body") });

    // Tree drag-to-reparent indicators. These track *tree rows*, which are the
    // panel's own chrome and therefore already in screen space — no surface
    // conversion, unlike the canvas indicators in `reorder.ts`.
    this.treeDropLine = el("div", {
      class: `${cls("layer")} ${cls("tree-drop-line")}`,
    });
    this.treeDropInto = el("div", {
      class: `${cls("layer")} ${cls("tree-drop-into")}`,
    });
    hide(this.treeDropLine);
    hide(this.treeDropInto);
    deps.layer.add(this.treeDropLine, this.treeDropInto);

    this.element = el("div", { class: cls("insp") }, [
      this.headEl,
      this.tabsEl,
      this.bodyEl,
    ]);

    this.textEditor = new TextEditor({
      onCommit: (edit) => {
        const ctx = this.textCtx;
        this.textCtx = null;
        // Deliberately not `this.selection` — see the field's comment. A
        // mismatch means the snapshot is stale, which can only happen if
        // something began an edit without going through `beginTextEdit`, and
        // recording it would be worse than dropping it.
        if (!(ctx && ctx.node === edit.node)) {
          return;
        }
        deps.structureSet.recordText({
          element: ctx.element,
          from: edit.from,
          node: edit.node,
          source: ctx.source,
          to: edit.to,
        });
        deps.history.push({
          element: ctx.element,
          from: edit.from,
          kind: "text",
          // Unconditional now. This used to be
          // `edit.node === sel.node ? sel.source : null`, which existed
          // *because* the node might not be the selection — and quietly shipped
          // a null source whenever it wasn't. The snapshot guarantees they
          // match, so the ternary was only ever hiding the bug it was written
          // to work around.
          node: edit.node,
          source: ctx.source,
          to: edit.to,
        });
        deps.controller.drawOutline();
        this.notifyChanged();
      },
      setTextOwner: (node) => {
        // Grab-to-move and text editing cannot share a node, and the collision
        // is total rather than cosmetic. The reorder proxy is a `pointer-events:
        // auto` box sitting *over* the selection so dnd-kit can arm a grab from
        // anywhere on it — which means, while an edit is live, every press meant
        // for the caret lands on the proxy instead. `EditGuard` reads that as a
        // drag source and kills the default, so there is no caret placement, no
        // drag-select, no double-click for a word: the whole point of editing in
        // place, gone, and silently. Dragging a layer you are typing into is not
        // a gesture anyone means anyway.
        if (node) {
          this.disarmReorder();
        } else if (this.selection) {
          this.armReorder();
        }
        deps.controller.setTextOwner(node);
        deps.onTextOwner?.(node);
      },
    });

    this.buildTabs();
    this.watchTreeDrag();
    /*
     * Rebuild when the token registry arrives or changes.
     *
     * `onTokensChange` was exported and had no subscribers at all, so the
     * registry had no push path to the UI. The scan lands a moment after the
     * first paint, and the app answered it with `panel.refresh()` — which
     * re-seeds unless the element's *shape* changed, and a shape key knows
     * nothing about tokens. So selecting something before the scan returned
     * left it with no badges at all until an unrelated rebuild happened to come
     * along. Badges are decided in `tokenSlot` at render time, so a render is
     * what this needs.
     */
    this.unwatch.push(
      onTokensChange(() => {
        this.tokenCache = new Map();
        this.renderBody();
      })
    );
    this.setSelection(null);
  }

  // -- Public API ------------------------------------------------------------

  setSelection(selection: Selection | null): void {
    // A selection moving out from under a live edit has to commit it first. The
    // picker's click path already does, but the layers tree, an undo, a discard
    // and every programmatic select reach here without going through it. No
    // recursion risk: `commit` → `onCommit` → `notifyChanged`, and nothing on
    // that path comes back to `setSelection`.
    if (this.textEditor.active && this.textEditor.node !== selection?.node) {
      this.textEditor.commit();
    }
    // A scope is a set of classes on the *previous* element and a forced state
    // is a simulation running on it; neither means anything on the next one, and
    // leaving either in place would silently misdirect the first edit.
    exitState(this.deps.changeSet);
    this.clearScopePreviews();
    this.editTarget = {};
    this.selection = selection;
    // Grab-to-move is armed by default whenever something is selected (the
    // editor feel): the drag controller reads the live selection, so enabling it
    // once makes it auto-follow every new selection. Disable when nothing is
    // selected. Set before renderBody so the button reflects the armed state.
    if (selection) {
      this.armReorder();
    } else {
      this.disarmReorder();
    }
    this.renderHead();
    this.renderBody();
    this.notifyChanged();
  }

  /**
   * Re-read the selection and update everything showing it.
   *
   * Called after an external change: an undo, a redo, a resize-handle drag, a
   * discard. It used to only re-report the pending-change count, which meant
   * ⌘Z moved the element on canvas and left every number in the panel showing
   * what it used to be — the single most common way to end up not trusting the
   * panel.
   *
   * Re-seeding beats rebuilding: it keeps focus, scroll, collapse state and any
   * half-typed field. But it cannot cover a change of *shape* — going absolute
   * grows a Constraints widget, going flex grows six controls — so the shape
   * key is checked first and a rebuild is the fallback.
   *
   * The CSS tab is always a rebuild. Everything it shows is derived from state no
   * per-control `setValue` can express — which declarations are pending, and which
   * rules override which — so only the box-model diagram was ever registered and
   * the rest of the pane was unreachable from here: ⌘Z reverted the element while
   * the `element.style` list still showed the reverted declaration, every computed
   * row still showed its pre-undo value, and the origin badges still read `inline`.
   * Nothing on screen changed while the page did.
   */
  refresh(): void {
    const reshaped =
      this.selection && this.shapeKey(this.selection.node) !== this.shape;
    if (reshaped || this.tab === "css") {
      this.renderBody();
    } else {
      this.reseed();
    }
    this.notifyChanged();
  }

  /**
   * Push freshly-computed values into every mounted control.
   *
   * A control opts in by declaring `properties`. One that does not is simply
   * skipped, which is what every control did before this existed — so this is
   * additive, not a behaviour change for anything that has not been taught.
   */
  private reseed(): void {
    const node = this.selection?.node;
    if (!node) {
      return;
    }
    for (const control of this.controls) {
      // A control whose value does not live in a CSS property re-reads it itself.
      // The HTML attribute fields are the case: `setValue` could never be handed
      // an `alt`, so they were unreachable from this pass and went on showing text
      // the element no longer had.
      control.resync?.();
      // Pseudo-property controls hold *panel* state — the Scope and State selects,
      // the attribute dropdowns — and no CSS property carries it. Re-seeding them
      // from the DOM read `""` and relabelled them to their zero option, so the
      // Scope select silently went back to reading "This element" while
      // `editTarget.scope` was untouched and the next edit still wrote to the
      // class. See `virtual` on `ControlHandle`.
      if (control.virtual) {
        continue;
      }
      for (const property of control.properties ?? []) {
        control.setValue(property, this.reseedValue(node, property));
      }
    }
  }

  /**
   * The value a re-seed should push into a control.
   *
   * Deliberately the same two rules `seed` applies at render time, because a
   * re-seed that disagreed with the initial render is the panel changing what it
   * claims for no reason the user can see:
   *
   * - **`MIXED` survives.** `reseed` read the primary's computed value directly,
   *   so a multi-selection showing `Mixed` for two different paddings silently
   *   collapsed to the primary's number on the first arrow key or undo — the panel
   *   asserting a value the other element does not have.
   * - **A pending edit wins over computed style.** `reader` exists because the DOM
   *   refuses some values the change set legitimately holds; `reseed` read past it,
   *   so such an edit stayed in the composer chip while the field snapped back.
   */
  private reseedValue(node: Element, property: string): string {
    const pending = this.deps.changeSet.snapshot(
      node,
      property,
      this.editTarget
    );
    const own =
      pending && !pending.disabled ? pending.to : readValue(node, property);
    if (!this.extra.length) {
      return own;
    }
    const same = this.extra.every((other) => {
      const theirs = this.deps.changeSet.snapshot(
        other,
        property,
        this.editTarget
      );
      const value =
        theirs && !theirs.disabled ? theirs.to : readValue(other, property);
      return value === own;
    });
    return same ? own : MIXED;
  }

  /**
   * The parts of an element's state that change what the panel *contains*, as
   * opposed to what it displays.
   *
   * Cheap enough to take on every refresh, and it is the difference between
   * "re-seed, keeping the user's scroll and caret" and "rebuild". Everything in
   * it gates a whole section or swaps one control for another somewhere above.
   */
  private shapeKey(node: Element): string {
    const s = computedStyle(node);
    return [
      s.position,
      s.display,
      s.flexWrap,
      hasText(node) ? "t" : "",
      isFlexChild(node) ? "f" : "",
      // Scope and state are panel state, not element state, but they belong in
      // the same key: switching either one changes which values every control
      // shows, and a re-seed would leave the panel displaying the old state's
      // values under the new state's label.
      this.editTarget.scope ?? "",
      this.editTarget.state ?? "",
      // Element kind: each of these gates a whole section in `renderBody`.
      // Missing one means a section that fails to appear or disappear when the
      // element changes under a refresh — the quietest possible bug here.
      isImage(node) ? "i" : "",
      isVideo(node) ? "v" : "",
      isSvgRoot(node) ? "s" : "",
      isSvgChild(node) ? "c" : "",
      hasBackgroundImage(node) ? "b" : "",
      /*
       * Gates *inside* a section, not just the ones that decide whether a
       * section renders at all.
       *
       * The comment on `renderSections` has always said anything gating a
       * section must appear here. Every intra-section gate broke that rule, and
       * each one is a control that can disappear under an edit: Fill's row
       * exists only while the background is not transparent, Stroke's only
       * while there is a border style, and Size's min/max grid only while one
       * of them is set — which also decides whether its `+` exists at all, so
       * typing a `min-width` deleted the button you had just used.
       */
      hasFill(this.reader(node)) ? "F" : "",
      hasStroke(this.reader(node)) ? "S" : "",
      hasBounds(this.reader(node)) ? "M" : "",
    ].join("|");
  }

  /**
   * Re-pin screen-space chrome after anything that moves the selection under
   * it: a pan, a zoom, a frame scroll, or an HMR re-render. Paired with
   * `SelectionController.drawOutline` — the outline and the drag proxy have to
   * move together or you end up able to grab thin air next to the selection.
   */
  syncChrome(): void {
    this.reorder.syncProxy();
  }

  /** Gate editing interaction in view mode: disarm grab-to-move so nothing in
   * the overlay is listening for drags on the page. */
  setEditing(on: boolean): void {
    if (on) {
      return;
    }
    this.disarmReorder();
  }

  /**
   * Inspect mode. Switches the panel to the CSS tab, which is the read-out the
   * mode exists for, and disarms grab-to-move so a hover cannot become a drag.
   */
  setInspecting(on: boolean): void {
    if (on) {
      this.tab = "css";
      this.syncTabs();
      this.renderBody();
      this.disarmReorder();
    } else if (this.selection) {
      this.armReorder();
    }
  }

  /**
   * Enter in-place text editing. False if the node has no own text.
   *
   * `node` defaults to the selection's, which is what `Enter` and `T` mean.
   * A caller passing an explicit node must have selected it first — see
   * `AirshipApp.enterTextEdit`, which arms the edit and lets the selection land
   * before beginning it. The identity check below is what makes that an
   * invariant rather than a convention: a mismatch refuses the edit instead of
   * recording it against the wrong element.
   */
  beginTextEdit(node?: Element, caret?: Point | null): boolean {
    const sel = this.selection;
    const target = node ?? sel?.node;
    if (!(sel && target && sel.node === target)) {
      return false;
    }
    this.textCtx = { element: sel.element, node: target, source: sel.source };
    // The caret arrives in screen space, because that is what a pointer event
    // reports. The editor works in the node's own document's coordinates, which
    // on the canvas is a frame's viewport at 1×.
    const began = this.textEditor.begin(target, {
      caret: caret ? sel.surface.toLocal(caret) : null,
    });
    if (!began) {
      this.textCtx = null;
    }
    return began;
  }

  /** Commit any in-flight text edit. Safe to call when there is none. */
  endTextEdit(): void {
    this.textEditor.commit();
  }

  /**
   * End an edit whose node has left the DOM — a frame reload, an HMR round trip,
   * a React unmount. Driven from the layout-change tick, which already fires on
   * every mutation the stage notices. `commit`'s own `isConnected` guard turns
   * this into a clean teardown rather than a recorded change.
   */
  pruneTextEdit(): void {
    if (this.textEditor.active && !this.textEditor.node?.isConnected) {
      this.textEditor.commit();
    }
  }

  /**
   * The additional nodes in a multi-selection.
   *
   * The panel keeps showing the *primary's* values and reports `Mixed` wherever
   * the rest disagree, which is the design-tool model. Editing then writes to all of
   * them — so a mixed field is not read-only, it is "several values, one of
   * which you are about to impose".
   */
  setExtra(nodes: Element[]): void {
    this.extra = nodes;
    /*
     * A scope is a set of classes on the elements that *were* selected and a
     * forced state is a simulation running on the primary alone, so neither
     * survives a change to the selection — the same reasoning `setSelection`
     * applies, and for the same reason: leaving either in place silently
     * misdirects the next edit. Leaving the state was also the precondition for
     * the extras keeping an `!important` hover style at rest, because
     * `forced-state` tracks one node.
     */
    exitState(this.deps.changeSet);
    this.clearScopePreviews();
    this.editTarget = {};
    this.resolveExtras(nodes);
    // The header reports the count, so it has to move with the set too.
    this.renderHead();
    this.renderBody();
  }

  /**
   * Resolve each co-selected node's own component context and source line.
   *
   * The picker only ever extracts one for what you *clicked*, so before this the
   * panel had nothing to describe an extra with and used the primary's — which is
   * how a two-element selection shipped two targets both naming the first element.
   *
   * Asynchronous because `extract` walks the fiber tree and a sourcemap, and the
   * write path cannot await it. `infoFor` falls back to a DOM-derived context
   * until it lands, so a fast edit is still about the right element; the
   * generation counter drops a resolution that a newer `setExtra` has superseded.
   */
  private resolveExtras(nodes: Element[]): void {
    this.extraInfo = new Map();
    this.extraGen += 1;
    const gen = this.extraGen;
    for (const node of nodes) {
      const surface = this.deps.resolver.of(node);
      if (!surface) {
        continue;
      }
      surface
        .extract(node)
        .then(({ context, source }) => {
          if (gen === this.extraGen) {
            this.extraInfo.set(node, { element: context, source });
          }
        })
        .catch(() => {
          // A frame that unloaded mid-resolve. The DOM-derived fallback stands.
        });
    }
  }

  /** Is a node locked against selection? Consulted by the picker. */
  isLocked(node: Element): boolean {
    return this.locked.has(node);
  }

  /**
   * Delete the selection, or duplicate it in place.
   *
   * Applied to the live DOM immediately, like every other direct manipulation —
   * the agent is told afterwards and catches the source up. After a delete the
   * next sibling is selected rather than nothing: dropping to an empty panel
   * reads as a crash, and a design tool keeps you in flow.
   *
   * Both toast, and both toast from *here* rather than from the keybinding that
   * usually triggers them. Two reasons: each opens with a guard the caller
   * cannot evaluate, so a toast at the binding would announce a refusal; and the
   * message names the node, which only this method has. Both are undoable, so
   * the toast is a report and not a warning — it is here because a delete needs
   * to read as "deleted" rather than "crashed", and because a duplicate lands as
   * the next sibling, which with a margin collapse or a flex gap can look like
   * nothing happened at all.
   */
  removeSelection(): void {
    const sel = this.selection;
    const node = sel?.node;
    const parent = node?.parentElement;
    if (!(sel && node && parent) || isEditorNode(node)) {
      return;
    }
    // Read before the node leaves the tree. `elementLabel` works fine on a
    // detached node, but taking it first is what a reader expects.
    const label = elementLabel(node);
    const next = node.nextElementSibling ?? node.previousElementSibling;
    const record: StructureRecord = {
      element: sel.element,
      node,
      op: "delete",
      origNext: node.nextSibling,
      origParent: parent,
      source: sel.source,
    };
    this.deps.structureSet.record(record);
    // The journal carries the record itself, so undo is `StructureSet.remove` —
    // one call that re-inserts the element *and* stops telling the agent to
    // delete it. The op used to carry only the DOM position, so ⌘Z brought the
    // element back on screen and shipped the delete anyway.
    this.deps.history.push({ kind: "structure", record });
    node.remove();
    this.notifyChanged();
    toast(`Deleted ${label}`);
    if (next) {
      this.deps.controller.select(next, sel.surface);
    } else {
      this.deps.controller.deselect();
    }
  }

  duplicateSelection(): void {
    const sel = this.selection;
    const node = sel?.node;
    const parent = node?.parentElement;
    if (!(sel && node && parent) || isEditorNode(node)) {
      return;
    }
    const clone = node.cloneNode(true) as Element;
    this.stripPreviews(node, clone);
    parent.insertBefore(clone, node.nextSibling);
    const record: StructureRecord = {
      element: sel.element,
      node: clone,
      op: "duplicate",
      origNext: clone.nextSibling,
      origParent: parent,
      source: sel.source,
    };
    this.deps.structureSet.record(record);
    this.deps.history.push({ kind: "structure", record });
    this.notifyChanged();
    toast(`Duplicated ${elementLabel(node)}`);
    this.deps.controller.select(clone, sel.surface);
  }

  /**
   * Strip this editor's own inline previews out of a freshly-cloned subtree.
   *
   * `cloneNode` copies the `style` attribute, and at the moment a duplicate is
   * made that attribute may be holding *ours* rather than the app's: scrub padding
   * to 32px, press ⌘D, and the copy carried `style="padding:32px"` permanently.
   * Nothing downstream could undo it either — a clone is in no change set, so
   * `clearPreviews` never visits it, Discard reverted the original and left the
   * copy styled, and the JSX the agent duplicated had no padding at all.
   *
   * Walked in parallel with the source rather than read off the clone, for two
   * reasons: the clone is not keyed in any set, and a deep clone can carry
   * previews from any descendant the user edited, not just the selection.
   * `cloneNode(true)` preserves document order, so index-matching the two
   * `querySelectorAll` results pairs the nodes.
   */
  private stripPreviews(source: Element, clone: Element): void {
    const sources = [source, ...source.querySelectorAll("*")];
    const clones = [clone, ...clone.querySelectorAll("*")];
    sources.forEach((from, i) => {
      const to = clones[i];
      if (!to) {
        return;
      }
      // Pending tweaks, plus whatever is standing in for a forced pseudo-state —
      // both are inline styles this editor owns and the app never wrote.
      const ours = new Set([
        ...this.deps.changeSet.previewedProperties(from),
        ...injectedProperties(from),
      ]);
      for (const property of ours) {
        clearPreview(to, property);
      }
    });
  }

  /**
   * Nudge the selection with the arrow keys.
   *
   * Routed through the same `moveTo` the Position fields use, so the keyboard
   * and the fields cannot disagree about where a nudge lands: an inset on a
   * pinned element, respecting its constraint, and `translate` on one still in
   * flow.
   *
   * `reseed()`, not `renderBody()`. Every arrow keypress used to tear down and
   * rebuild the entire panel — fourteen sections, every control destroyed and
   * re-created — which is most of why holding an arrow key felt like the panel
   * was fighting you.
   */
  nudge(dx: number, dy: number): void {
    const node = this.selection?.node;
    if (!node) {
      return;
    }
    const { x, y } = measureXY(node);
    if (dx) {
      moveTo(this.ctx, node, "x", x + dx);
    }
    if (dy) {
      moveTo(this.ctx, node, "y", y + dy);
    }
    this.reseed();
  }

  /** Release every dnd-kit entity and manager subscription. */
  destroy(): void {
    this.treeScope.clear();
    this.reorder.destroy();
    for (const off of this.unwatch) {
      off();
    }
    this.unwatch.length = 0;
    this.treeDropLine.remove();
    this.treeDropInto.remove();
  }

  /** Reflect an externally-driven value (e.g. a resize-handle drag) into the
   * matching Design-tab control, if it's currently mounted. */
  syncControl(cssProperty: string, value: string): void {
    for (const control of this.controls) {
      control.setValue(cssProperty, value);
    }
  }

  // -- Change plumbing -------------------------------------------------------

  /*
   * Coalesce a continuous gesture into one undo step.
   *
   * `onChange` already wraps each call in `history.batch()`, which is correct
   * for a typed value and wrong for a drag: a scrub or a saturation-square sweep
   * fires it per pointermove and leaves one undo step per event. `History` was
   * built for this — `open()`/`close()` exist and are documented "for drags,
   * which span two events" — but until now nothing called them.
   *
   * It nests cleanly with the per-change `batch()`: `open()` takes the depth to
   * 1, each `batch()` inside takes it to 2 and back to 1 without committing, and
   * `close()` drops it to 0 and commits the single accumulated step.
   *
   * The counter is what makes this safe to leave unbalanced-proof: an `open()`
   * that never closes swallows every later edit into one step forever, so
   * callers must close on cancel as well as on completion.
   */
  beginGesture(): void {
    this.deps.history.open();
  }

  endGesture(): void {
    this.deps.history.close();
    // The shape check `write` skipped on every frame of the drag. A scrub can
    // take a fill's alpha to zero or a border's width off `none`, and the
    // panel's contents follow from that as much as from a typed value.
    this.reshapeIfNeeded();
  }

  /** The gesture hooks, in the shape controls take them. */
  private readonly gestures: Gestures = {
    begin: () => this.beginGesture(),
    end: () => this.endGesture(),
  };

  /**
   * The panel's services, in the shape a section takes them.
   *
   * One field literal rather than passing `this` — a section that can reach the
   * whole panel will, and the next person to add one will not know which of the
   * eighty members are fair game. `SectionContext` is that answer, and it is
   * short on purpose.
   */
  private readonly ctx: SectionContext = {
    buildControl: (descriptor, node, after) =>
      this.buildControl(descriptor, node, after),
    colorRow: (value, tip, onChange, node, properties) =>
      this.colorRow(value, tip, onChange, node, properties),
    fieldCell: (descriptor, node) => this.fieldCell(descriptor, node),
    flash: (node) => this.flash(node),
    gate: (node) => this.reader(node),
    gestures: this.gestures,
    headerAction: (iconName, tip, onClick) =>
      DesignPanel.headerAction(iconName, tip, onClick),
    numControl: (spec, initial, onCommit, properties, read) =>
      this.numControl(spec, initial, onCommit, properties, read),
    onAttr: (node, attribute, value) => this.recordAttr(node, attribute, value),
    onChange: (property, value) => this.onChange(property, value),
    recordOn: (node, property, value) => this.recordOn(node, property, value),
    redrawOutline: () => this.deps.controller.drawOutline(),
    refresh: () => this.refresh(),
    register: (control) => this.controls.push(control),
    repaintScope: () => this.repaintScope(),
    rerender: () => this.renderBody(),
    reseed: () => this.reseed(),
    section: (id, label, body, opts) => this.section(id, label, body, opts),
    seed: (node, property, fallback) => this.seed(node, property, fallback),
    spacingControl: (node, group) => this.spacingControl(node, group),
    tokenSlot: (node, properties) => this.tokenSlot(node, properties),
  };

  /**
   * A repaint that disposes what it replaces. See `SectionContext.repaintScope`.
   *
   * The slice, rather than tracking each registration, because the sections
   * that need this register through three different doors — `register`,
   * `colorRow` and `fieldCell` — and all of them land in `this.controls`.
   * Whatever appears there while the paint runs is what the paint owns.
   */
  private repaintScope(): (paint: () => void) => void {
    let owned: ControlHandle[] = [];
    return (paint) => {
      for (const control of owned) {
        control.destroy?.();
      }
      if (owned.length) {
        const dropped = new Set(owned);
        this.controls = this.controls.filter((c) => !dropped.has(c));
      }
      const before = this.controls.length;
      paint();
      owned = this.controls.slice(before);
    };
  }

  /**
   * A `[swatch][hex][alpha]` row wired to this panel — gestures bracketed, and
   * registered so `syncControl` can push an external change into it.
   *
   * `properties` is what the row writes, and is what buys it a token
   * affordance. Colour is the richest scale most design systems have and the
   * one the panel could not reach at all: fill, stroke and the SVG paints all
   * build their own row, and the token badge only ever existed on the
   * descriptor pipeline.
   */
  private colorRow(
    value: string,
    tip: string,
    onChange: (next: string) => void,
    node?: Element,
    properties: readonly string[] = []
  ): HTMLElement {
    const slot =
      node && properties.length ? this.tokenSlot(node, properties) : null;
    const row = createColorRow({
      gestures: this.gestures,
      onChange,
      tip,
      value,
    });
    // The swatch keeps painting the colour; only the hex reads the token.
    row.setToken(slot?.label ?? null);
    row.onActivate(() => slot?.open());
    /*
     * Registered with the properties it writes, and honouring the one it is
     * handed.
     *
     * It had neither, and both mattered. Without `properties`, `reseed` skips
     * colour rows entirely — so an undo, a resize sync or a discard left every
     * swatch showing the colour from before. And because `setValue` ignored the
     * property name while `syncControl` fans one property out to *every*
     * mounted control, a resize-handle drag pushed `"240px"` into each colour
     * row in the panel: unparseable, so every swatch flipped to `Mixed`.
     */
    this.controls.push({
      destroy: row.destroy,
      element: row.element,
      onActivate: (open) => row.onActivate(open),
      properties,
      setToken: (name) => row.setToken(name),
      setValue: (property, next) => {
        if (properties.includes(property)) {
          row.setValue(next);
        }
      },
    });
    if (!slot) {
      return row.element;
    }
    return el("div", { class: cls("token-cell") }, [row.element, slot.element]);
  }

  private readonly onChange: OnChange = (cssProperty, value) => {
    const sel = this.selection;
    if (sel) {
      this.write([sel.node, ...this.extra], cssProperty, value);
    }
  };

  /**
   * Write one declaration to a set of nodes, as one undo step.
   *
   * The node list is a parameter because the two callers disagree about it and
   * both are right: a control edit covers the whole selection, while a token
   * binding covers whatever `bindingNodes` decides. `opts` is how a binding
   * rides this path at all — picking a token and detaching from one are writes
   * with an extra instruction attached, not separate mechanisms, and giving
   * them their own sequence is what let the value fan out across a
   * multi-selection while the token stayed on the primary.
   */
  private write(
    nodes: readonly Element[],
    cssProperty: string,
    value: string,
    opts?: RecordOpts
  ): void {
    // One undo step per gesture, however many nodes it touched.
    this.deps.history.batch(() => {
      for (const node of nodes) {
        this.recordOn(node, cssProperty, value, opts);
      }
    });
    this.deps.controller.drawOutline();
    this.notifyChanged();
    /*
     * A write is a change of *shape* for the CSS pane however ordinary it is for
     * everything else, because that pane renders its `element.style` block from
     * the change set — and `reshapeIfNeeded` cannot see that, since `shapeKey`
     * describes the element rather than the pending declarations.
     *
     * `deleteDecl` and `toggleDecl` have always called `refreshCss`; the add and
     * edit paths did not, and `onVisualChanged` only re-renders the composer
     * chips. So typing `color: red` into the pane's add row turned the element
     * red, cleared the row, and rendered no row for it — leaving the declaration
     * impossible to disable, edit or delete until an unrelated rebuild.
     *
     * Guarded on `reshapeIfNeeded` having already rebuilt, so a write that
     * changes both does not render the body twice. `refreshCss` shares that
     * method's mid-gesture rule for the same reason: a scrub calls `write` per
     * pointermove, and rebuilding the pane on every frame would both cost a
     * re-render and drop the caret out of whatever row is being typed in.
     */
    if (!this.reshapeIfNeeded()) {
      this.refreshCss();
    }
  }

  /**
   * Show a class-scoped edit on every element the class reaches.
   *
   * The Scope picker offers `.btn · 48 elements` and the prompt duly tells the agent to
   * write the shared class — but the preview only ever landed on the selection, so one
   * button moved and the other forty-seven did not. The first time anyone saw the real
   * blast radius was in the diff, which is the worst possible moment for it.
   *
   * Deliberately *only* a preview: these elements are not recorded in the change set, so
   * the payload still carries the single scoped target it always did, and Discard reverts
   * them because `discard` clears previews across the whole match set the same way.
   *
   * Bounded by `SCOPE_PREVIEW_LIMIT`, because a utility class can match thousands of
   * nodes and painting all of them per pointermove of a scrub would stall the frame. The
   * count in the picker remains the truth about how many are affected.
   */
  private previewScope(cssProperty: string, value: string): void {
    const { scope } = this.editTarget;
    const node = this.selection?.node;
    if (!(scope && node)) {
      return;
    }
    const doc = node.ownerDocument;
    if (!doc) {
      return;
    }
    let matches: Element[] = [];
    try {
      matches = Array.from(doc.querySelectorAll(scope));
    } catch {
      // A selector the engine will not parse. The instance preview stands.
      return;
    }
    for (const other of matches.slice(0, SCOPE_PREVIEW_LIMIT)) {
      if (other !== node && !isEditorNode(other)) {
        applyPreview(other, cssProperty, value);
        this.scopePreviewed.add(other);
        this.scopeProperties.add(cssProperty);
      }
    }
  }

  /**
   * Drop the scope previews from every element that is not in the change set.
   *
   * They are painted by `previewScope` and belong to no `ChangeSet` entry, so
   * `clearPreviews` cannot reach them — this is what keeps a scoped edit from surviving
   * a Discard on the other forty-seven elements.
   */
  private clearScopePreviews(): void {
    for (const node of this.scopePreviewed) {
      for (const property of this.scopeProperties) {
        clearPreview(node, property);
      }
    }
    this.scopePreviewed = new Set();
    this.scopeProperties = new Set();
  }

  /**
   * Rebuild when a write changed what the panel should *contain*, not just what
   * it shows.
   *
   * Sections gate whole controls on computed values — Fill's row exists only
   * when the background is not transparent, Stroke's only when there is a
   * border style, Size's min/max grid only when one of them is set. `shapeKey`
   * is what notices those flipping, and until now the only thing that consulted
   * it was `refresh()`, called from four places. An ordinary `onChange`
   * consulted nothing, so a value edit could invalidate a section's gating and
   * the panel would go on showing the old shape until something unrelated
   * happened to rebuild it — at which point a control vanished with no
   * apparent cause. Setting a fill's alpha to zero and watching the row
   * disappear on the next selection change is that bug.
   *
   * Skipped mid-gesture and run once on release: `shapeKey` reads computed
   * style and a scrub calls `write` per pointermove, so checking on every frame
   * would force a style recalculation per frame for a shape that, by
   * definition, is not settled until the drag ends.
   */
  /** True when it rebuilt, so a caller can skip a second render of its own. */
  private reshapeIfNeeded(): boolean {
    const node = this.selection?.node;
    if (!node || this.deps.history.isBatching) {
      return false;
    }
    if (this.shapeKey(node) !== this.shape) {
      this.renderBody();
      return true;
    }
    return false;
  }

  /**
   * How a gate reads a property: the pending edit if there is one, else what
   * the DOM computes.
   *
   * The pending value has to win. A gate's whole job is to decide whether a
   * control should exist, and the value the user just typed is the one most
   * likely to change that answer — so reading only computed style means the
   * panel can take away the control being used to set the value it is reading.
   * A colour token whose `var()` did not resolve blanked `background-color`,
   * and the fill row deleted itself the instant it was bound.
   */
  private reader(node: Element): Reader {
    return (property) =>
      this.deps.changeSet.snapshot(node, property, this.editTarget)?.to ??
      readValue(node, property);
  }

  /**
   * The value to seed a control with: the primary's, or `MIXED` when the rest of
   * the selection disagrees.
   *
   * `MIXED` is a plain string, which is what lets it flow through the existing
   * controls untouched — a number field renders it as text, a segmented group
   * matches no option and shows nothing active. Both are exactly right, and
   * neither needed a new code path.
   */
  private seed(node: Element, property: string, fallback: string): string {
    // While a state is forced its declarations are live as inline previews, so
    // `readValue` already reports them — with one exception: a property the
    // state's rules do not mention at all falls through to the resting value,
    // which is the right answer and needs no special case.
    const own = readValue(node, property) || fallback;
    if (!this.extra.length) {
      return own;
    }
    const same = this.extra.every(
      (other) => (readValue(other, property) || fallback) === own
    );
    return same ? own : MIXED;
  }

  /**
   * Preview + record one declaration on an arbitrary node.
   *
   * Almost every edit lands on the selection, but the alignment row's main-axis
   * buttons write `justify-content` to the *parent* (see `align.ts`), so the
   * write path has to take a node. The parent has no resolved `ElementContext`
   * of its own — the picker only extracts one for what you selected — so it
   * borrows the selection's, and the change set keys on the live node anyway.
   * The agent gets a delta pointing at a real element either way; the file and
   * line are backfilled server-side from the source location.
   */
  /** Point subsequent edits at a shared class, or back at this instance. */
  private setScope(scope: string | undefined): void {
    // The old scope's previews belong to the old scope.
    this.clearScopePreviews();
    this.editTarget = { ...this.editTarget, scope };
    this.renderBody();
    this.notifyChanged();
  }

  /**
   * Enter or leave a simulated interaction state.
   *
   * The DOM preview and the panel are updated together: entering writes the
   * state's declarations inline so the element *looks* hovered, and rebuilding
   * the body re-seeds every control from those same values.
   */
  private setState(state: PseudoState | undefined): void {
    const node = this.selection?.node;
    if (!node) {
      return;
    }
    if (state) {
      enterState([node, ...this.extra], state, this.deps.changeSet);
    } else {
      exitState(this.deps.changeSet);
    }
    this.editTarget = { ...this.editTarget, state };
    this.renderBody();
    this.deps.controller.drawOutline();
    this.notifyChanged();
  }

  /**
   * Re-apply the forced-state preview after an undo.
   *
   * `History` puts values back through the change set, which does not know the
   * simulation exists — so after a replay the inline styles and the state's
   * declarations have drifted apart. Re-entering reconciles them.
   */
  resyncState(): void {
    const node = this.selection?.node;
    const { state } = this.editTarget;
    if (node && state) {
      enterState([node, ...this.extra], state, this.deps.changeSet);
    }
  }

  /**
   * The scope and state edits currently write to. Read by the app's resize path,
   * which records through the change set directly rather than through a control.
   */
  activeTarget(): ChangeTarget {
    return this.editTarget;
  }

  /**
   * Who a write is *about*, and whether the panel's scope/state apply to it.
   *
   * Three cases, and they used to be two. A single `own = node === sel.node`
   * flag decided both questions at once, justified by the alignment row's parent
   * write — which is a foreign node, and for which the reasoning holds. But
   * `onChange` fans every control edit across the whole selection, so every
   * co-selected node also failed `own` and inherited a foreign node's treatment:
   *
   * - it was described to the agent as `sel.element`, so a multi-selection
   *   shipped N copies of the primary and never mentioned the others;
   * - its `source` was nulled, and the server then backfilled it from that same
   *   primary context;
   * - `editTarget` was dropped, so an edit made under a forced `:hover` was
   *   recorded as a resting-style edit, and a `.btn`-scoped edit shipped one
   *   class-level change and N-1 instance-level ones.
   *
   * A co-selected node is in the selection: the scope and state the user set
   * apply to it, and it is its own element. Only a genuinely foreign node — the
   * flex parent the alignment row writes to — stays instance-level, because the
   * scope picker describes the *selection's* classes and those say nothing about
   * its parent.
   */
  private infoFor(node: Element): {
    element: ElementContext;
    inSelection: boolean;
    source: SourceLocation | null;
  } {
    const sel = this.selection;
    if (sel && node === sel.node) {
      return { element: sel.element, inSelection: true, source: sel.source };
    }
    const resolved = this.extraInfo.get(node);
    if (resolved) {
      return { ...resolved, inSelection: true };
    }
    if (this.extra.includes(node)) {
      // Selected, but `extract` has not come back yet — it walks the fiber tree
      // and a sourcemap, so it cannot be awaited on the write path. A context read
      // off the DOM is right about *which element this is*, which is the part that
      // was wrong before; the server resolves the file from it either way.
      return { element: domContext(node), inSelection: true, source: null };
    }
    // A foreign node. Its own DOM-derived context rather than the selection's,
    // which described the flex parent as though it were the child.
    return { element: domContext(node), inSelection: false, source: null };
  }

  /**
   * Preview + record one declaration on one node — the panel's single style
   * write, and the only place `applyPreview`, `History` and `ChangeSet` are
   * kept in step.
   *
   * Public because the app's resize handles write here too. That path used to
   * be a hand-copied clone of this method, and had drifted: it omitted `token`
   * and `hardcode`, so dragging a handle to a value on the spacing scale never
   * resolved the token that typing the same number did, and ignored a detach
   * the user had explicitly asked for.
   */
  recordOn(
    node: Element,
    cssProperty: string,
    raw: string,
    opts?: RecordOpts
  ): void {
    const sel = this.selection;
    if (!sel) {
      return;
    }
    const value = keepAuthoredUnit(node, cssProperty, raw);
    const info = this.infoFor(node);
    const target = info.inSelection ? this.editTarget : undefined;
    const from =
      this.deps.changeSet.originalValue(node, cssProperty, target) ??
      readValue(node, cssProperty);
    // The declaration as it stands, captured before the write so undo has the
    // whole thing — value, token, detach and disabled state — rather than a
    // value it would have to rebuild the rest around.
    const before = this.deps.changeSet.snapshot(node, cssProperty, target);
    if (target?.state) {
      // Editing in a forced state writes an inline style that is *ours*, so it
      // has to come off with the rest when the state is left — otherwise the
      // element keeps rendering its hover styling at rest.
      //
      // Before `applyPreview`, deliberately: `trackInjected` snapshots what the
      // property currently holds so `exitState` can put it back, and after the
      // write that snapshot would be of our own preview.
      trackInjected(node, cssProperty);
    }
    // A forced-state preview has to beat the stylesheet rule it is standing in
    // for; an ordinary tweak is competing with nothing and stays unprefixed.
    applyPreview(node, cssProperty, value, Boolean(target?.state));
    // A class-scoped edit shows on everything the class reaches. Here rather than in
    // `write`, because the app's resize handles record through this method directly.
    this.previewScope(cssProperty, value);
    this.deps.changeSet.record({
      binding: opts?.binding,
      element: info.element,
      from,
      node,
      property: cssProperty,
      source: info.source,
      target,
      to: value,
      // An explicitly picked token is a fact about what the user chose. Anything
      // else is `findToken` inferring one from the value, which is a guess and
      // is marked as such (`via: "value"`).
      token: opts?.token ?? findToken(cssProperty, value, node),
    });
    this.journalDecl(node, before, cssProperty, target);
  }

  /**
   * Apply and record one HTML attribute edit.
   *
   * The DOM is written immediately, as with every other direct manipulation, so
   * the frame shows the change before the agent has touched the source.
   */
  private recordAttr(
    node: Element,
    attribute: string,
    value: string | null
  ): void {
    const sel = this.selection;
    if (!sel) {
      return;
    }
    const from = node.getAttribute(attribute);
    // Journalled like every other direct manipulation. It was not, and there was
    // no op kind for it either — so editing an `alt` and pressing ⌘Z reached
    // past it and undid whatever style tweak came before.
    this.deps.history.push({
      attribute,
      element: sel.element,
      from,
      kind: "attr",
      node,
      source: node === sel.node ? sel.source : null,
      to: value,
    });
    this.deps.attrSet.record({
      attribute,
      element: sel.element,
      from,
      node,
      source: node === sel.node ? sel.source : null,
      to: value,
    });
    this.notifyChanged();
    this.deps.onChanged?.();
    this.refresh();
  }

  /**
   * Detach a property from its token: the agent must write a literal value.
   *
   * Recorded as a real declaration at the value the element already has, rather
   * than as a flag patched onto whatever edit happened to be pending. There
   * usually *is* no pending edit — detaching is normally the first thing you do
   * to a property — and the old version wrote the flag into a slot that did not
   * exist, so the badge showed unlinked and the agent was told nothing at all.
   */
  unlinkToken(node: Element, properties: readonly string[]): void {
    for (const cssProperty of properties) {
      for (const target of this.bindingNodes(node)) {
        this.deps.changeSet.setHardcoded(target, cssProperty, true);
      }
      // The flag has to be set on every node before the write, because `record`
      // reads it back out of the change set rather than taking it as an
      // argument. `binding` is what keeps the declaration alive when detaching
      // does not change the rendered value — which it never does.
      this.writeBinding(node, cssProperty, readValue(node, cssProperty), {
        binding: true,
      });
    }
    // A full rebuild, not a re-seed: the badge's linked/near state is decided in
    // `tokenSlot` at render time and is not a control value, so `reseed` — which
    // only pushes values into registered controls — left it showing the old one.
    this.renderBody();
  }

  /** Re-attach a property to a token the user picked from the token list. */
  applyToken(
    node: Element,
    properties: readonly string[],
    token: DesignToken
  ): void {
    for (const cssProperty of properties) {
      for (const target of this.bindingNodes(node)) {
        this.deps.changeSet.setHardcoded(target, cssProperty, false);
      }
      this.writeBinding(
        node,
        cssProperty,
        tokenPreviewValue(token, cssProperty),
        {
          binding: true,
          // A token the user picked is a real binding, not a value coincidence
          // — the agent is going to write its name into the source.
          token: toRef(token, cssProperty, true, "reference"),
        }
      );
    }
    // Once, after all of them. This used to end the *per-property* method, so a
    // four-longhand binding rebuilt the panel four times — and it used to be
    // missing entirely, which is why picking a token wrote the change and left
    // the badge and the field showing what was there before.
    this.renderBody();
  }

  /**
   * Which nodes a binding edit covers.
   *
   * A badge on the selection binds the whole selection: leaving the secondaries
   * of a multi-selection on literals while the primary gets the token is not
   * something the affordance offers, and it is what used to happen — the value
   * fanned out and the `TokenRef` did not, so the extras shipped as bare
   * numbers. A badge on some *other* node — `SectionContext` hands sections a
   * factory that takes an arbitrary one, as the alignment row already uses for
   * its parent writes — binds only that node, because the selection's classes
   * say nothing about it.
   */
  private bindingNodes(node: Element): Element[] {
    return node === this.selection?.node ? [node, ...this.extra] : [node];
  }

  /** The write behind `applyToken` and `unlinkToken`, over `bindingNodes`. */
  private writeBinding(
    node: Element,
    cssProperty: string,
    value: string,
    opts: RecordOpts
  ): void {
    this.write(this.bindingNodes(node), cssProperty, value, opts);
  }

  /**
   * Drop one pending style declaration, reverting just its preview.
   *
   * The five `discardOne*` methods below are the per-chip ✕ in the composer.
   * They live here rather than on the app because reverting a tweak means
   * touching a preview and re-seeding the controls that show it — the two
   * things this panel owns and the app deliberately does not reach into.
   *
   * All five are journalled. Taking a chip back is an edit like any other, and
   * an unjournalled one is worse than an unavailable one: ⌘Z after it does not
   * fail, it silently undoes whatever came before instead.
   */
  discardOneStyle(
    node: Element,
    property: string,
    target?: ChangeTarget
  ): void {
    const before = this.deps.changeSet.snapshot(node, property, target);
    clearPreview(node, property);
    this.deps.changeSet.remove(node, property, target);
    // Dropping a forced-state preview uncovers whatever the default state had
    // queued for the same property, which is still pending and must go back.
    this.deps.changeSet.reapplyPreviews(node);
    this.journalDecl(node, before, property, target);
    this.afterDiscardOne(node);
  }

  /** Put one drag-repositioned node back and forget the move. */
  discardOneMove(node: Element): void {
    const prev = this.deps.moveSet.get(node) ?? null;
    const parent = node.parentElement;
    const next = node.nextSibling;
    this.deps.moveSet.remove(node);
    if (prev && parent) {
      // `remove` puts the node back at its *original* position, which is where
      // undoing this discard has to bring it back from.
      this.deps.history.push({
        fromNext: node.nextSibling,
        fromParent: prev.origParent,
        kind: "move",
        next: prev,
        node,
        prev: null,
        toNext: next,
        toParent: parent,
      });
    }
    this.afterDiscardOne(node);
  }

  /** Undo one delete or duplicate. */
  discardOneStructure(node: Element): void {
    const record = this.deps.structureSet
      .entries()
      .find((e) => e.node === node);
    this.deps.structureSet.remove(node);
    if (record) {
      this.deps.history.push({ kind: "structure", record });
    }
    this.afterDiscardOne(node);
  }

  /** Restore one node's original text. */
  discardOneText(node: Element): void {
    const entry = this.deps.structureSet
      .textEntries()
      .find((e) => e.node === node);
    this.deps.structureSet.removeText(node);
    if (entry) {
      this.deps.history.push({
        element: entry.element,
        from: entry.to,
        kind: "text",
        node,
        source: entry.source,
        to: entry.from,
      });
    }
    this.afterDiscardOne(node);
  }

  /** Put one HTML attribute back the way it was. */
  discardOneAttr(node: Element, attribute: string): void {
    const entry = this.deps.attrSet
      .entries()
      .find((e) => e.node === node && e.attribute === attribute);
    this.deps.attrSet.remove(node, attribute);
    if (entry) {
      this.deps.history.push({
        attribute,
        element: entry.element,
        from: entry.to,
        kind: "attr",
        node,
        source: entry.source,
        to: entry.from,
      });
    }
    this.afterDiscardOne(node);
  }

  /**
   * Shared tail of a single discard: re-pin the outline, re-seed the panel if
   * it is showing the node that just changed, and tell the composer to re-count.
   *
   * The rebuild is conditional because dropping a chip for some *other* element
   * must not throw away an in-progress edit on the selected one.
   */
  private afterDiscardOne(node: Element): void {
    this.deps.controller.drawOutline();
    if (node === this.selection?.node) {
      this.renderBody();
    }
    this.notifyChanged();
  }

  /** Revert every pending tweak (previews + structural moves) and clear the
   * shared change/move sets. Invoked by the composer's "Discard all" chip and
   * by starting a new chat. */
  discard(): void {
    exitState(this.deps.changeSet);
    // Scope previews are in no change set, so `clearPreviews` below cannot reach them.
    this.clearScopePreviews();
    this.editTarget = {};
    this.deps.changeSet.clearPreviews();
    this.deps.changeSet.clear();
    // Put any drag-repositioned nodes back where they started, and undo every
    // delete, duplicate and text edit.
    this.deps.moveSet.restore();
    this.deps.moveSet.clear();
    this.deps.structureSet.restore();
    this.deps.structureSet.clear();
    this.deps.attrSet.restore();
    this.deps.attrSet.clear();
    this.deps.history.clear();
    this.deps.controller.drawOutline();
    // Re-seed controls from the reverted computed values.
    this.renderBody();
    this.notifyChanged();
  }

  // -- Header + tree ---------------------------------------------------------

  /**
   * The panel's own header: what is selected, and where it came from.
   *
   * Above the tabs, not inside one, because both facts hold whichever tab you
   * are on — reading the CSS or walking the DOM tree does not stop you wanting
   * to know which file you are about to point the agent at. The layer's own
   * name is deliberately absent: the canvas badge and the tree both carry it.
   */
  private renderHead(): void {
    clear(this.headEl);
    this.headEl.classList.toggle(cls("hidden"), !this.selection);
    if (!this.selection) {
      return;
    }
    const count = 1 + this.extra.length;
    if (count > 1) {
      this.headEl.append(
        el("div", {
          class: cls("insp-multi"),
          text: `${count} layers selected`,
        })
      );
    }
    this.headEl.append(this.renderSourceSection());
  }

  /**
   * Where the selection lives, as a section in the panel header.
   *
   * The compact `App.tsx:31` rides in the section header, so the resting state
   * costs exactly one line — the line the heading was going to take anyway —
   * and expanding gives the two facts in full, which are worth having but never
   * worth three wrapped lines of permanent chrome.
   */
  private renderSourceSection(): HTMLElement {
    const source = this.selection?.source ?? null;
    return this.section("source", "Source", this.sourceBody(source), {
      meta: sourceChip(source),
      startCollapsed: true,
    });
  }

  /**
   * The expanded section: the path and the line as two labelled facts, with the
   * editor actions on a kebab.
   *
   * It used to be one mono string — `src/components/sections/hero.tsx:24` —
   * which is not a readout so much as a thing to parse: two separate facts glued
   * together by a colon, inside a `break-all` blob that will hyphenate anywhere.
   * They are two rows now because they are two facts. The kebab rides the line,
   * where the previous version hid the same menu behind a hover-underline on a
   * chip that otherwise read as a label — an affordance you could only discover
   * by already being on top of it.
   */
  private sourceBody(source: SourceLocation | null): HTMLElement {
    if (!source) {
      return el("div", { class: cls("sect-body") }, [
        el("div", {
          class: cls("insp-src-note"),
          text: "This element could not be traced back to a source file. It may be rendered by a dependency, or the dev server may not be emitting source metadata.",
        }),
      ]);
    }
    const { line } = source;
    const pathRow = labelled(
      "Path",
      el("span", { class: cls("insp-src-val"), text: source.file })
    );
    const lineRow = labelled(
      "Line",
      el("span", {
        class: cls("insp-src-val"),
        text: line ? String(line) : "—",
      })
    );
    const kebab = this.sourceKebab(source);
    if (kebab) {
      // The line is what the menu acts on, so that is where it sits. With no
      // line to act on it falls back to the path, which "Copy path" still needs.
      (line ? lineRow : pathRow).append(kebab);
    }
    return el("div", { class: cls("sect-body") }, [
      el("div", { class: cls("insp-src-kv") }, [pathRow, lineRow]),
    ]);
  }

  /** The `⋯` opening the editor actions, or nothing when there is no socket. */
  private sourceKebab(source: SourceLocation): HTMLElement | null {
    if (!(this.deps.onOpenIn || this.deps.onCopyPath)) {
      return null;
    }
    // Built on click, not now: the menu is one anchor away from being stale the
    // moment the panel rebuilds, and the entries are cheap.
    const kebab: HTMLElement = DesignPanel.headerAction(
      "more",
      "Source actions",
      () => createMenu(this.sourceMenu(source)).open(kebab, "below")
    );
    return kebab;
  }

  private sourceMenu(source: SourceLocation): MenuEntry[] {
    const entries: MenuEntry[] = [];
    const openIn = this.deps.onOpenIn;
    if (openIn) {
      entries.push(
        { header: "Open" },
        {
          icon: "code",
          label: "Open in VS Code",
          run: () => openIn("vscode", source.file, source.line),
        },
        {
          icon: "code",
          label: "Open in Cursor",
          run: () => openIn("cursor", source.file, source.line),
        }
      );
    }
    const copyPath = this.deps.onCopyPath;
    if (copyPath) {
      entries.push({
        icon: "clipboard",
        label: "Copy path",
        run: () => copyPath(source.file),
      });
    }
    return entries;
  }

  // -- DOM tab: expandable tree + drag-to-reparent ---------------------------

  private renderDomTab(): void {
    const sel = this.selection;
    // The tree is rooted in the *selection's* surface, not the shell's document.
    // On the canvas there is one DOM tree per frame, and the one worth showing
    // is the one the selected node lives in.
    const root = sel?.surface.isLive ? sel.surface.doc.body : null;
    if (!(sel && root)) {
      // Reachable with a selection in hand: a frame that has not finished
      // loading has a surface but no live document to walk. This used to append
      // nothing at all, so the tab rendered as a blank panel that read like a
      // bug rather than like a wait.
      this.bodyEl.append(
        emptyState({
          body: "This frame has no live document to walk.",
          title: "No tree to show",
        })
      );
      return;
    }
    const tree = el("div", { class: cls("tree") });
    // Auto-expand the ancestor path to the selection so it's always visible.
    const path = new Set<Element>();
    let cur: Element | null = sel.node;
    while (cur) {
      path.add(cur);
      cur = cur.parentElement;
    }
    this.renderTreeNode(tree, root, 0, path);
    this.bodyEl.append(
      el("div", {
        class: cls("insp-hint"),
        text: "Drag a node to reparent · click to select",
      }),
      tree
    );
  }

  private renderTreeNode(
    container: HTMLElement,
    node: Element,
    depth: number,
    path: Set<Element>
  ): void {
    if (isEditorNode(node)) {
      return;
    }
    // Non-rendered elements are not layers. A <script> in the tree is noise at
    // best — and because a text-only node is named after its content, an
    // inline script showed up as a row reading `window.__PIKA__={"wsPath"…`.
    const kids = Array.from(node.children).filter(
      (c) => !(isEditorNode(c) || isNonVisual(c))
    );
    const hasKids = kids.length > 0;
    const open = hasKids && (this.expanded.has(node) || path.has(node));
    container.append(
      this.treeRow(node, depth, node === this.selection?.node, hasKids, open)
    );
    if (open) {
      for (const kid of kids) {
        this.renderTreeNode(container, kid, depth + 1, path);
      }
    }
  }

  private treeRow(
    node: Element,
    depth: number,
    self: boolean,
    hasKids: boolean,
    open: boolean
  ): HTMLElement {
    // Named from the DOM, including for the selected row. `displayName` is
    // resolved for the selection only, and it names the component *above* the
    // node rather than the node — so feeding it in here meant clicking a row
    // renamed it from `span.ex-brand-dot` to `App`, and re-glyphed it as a
    // component instance. Which component renders the selection is worth
    // knowing; the header says it, once, where it cannot be mistaken for the
    // layer's own name. The full `tag.class.class` string stays as the tooltip.
    const kind = nodeKind(node);
    const label = layerName(node);
    // Left-hand disclosure, unlike the sections: in a tree the arrow belongs to
    // the row's depth, so moving it to the right column detached it from the
    // indent that gives it its meaning. The spacer keeps childless rows lined
    // up with their siblings' labels.
    const chevron = hasKids
      ? el(
          "span",
          {
            class: cls("tree-chev"),
            onClick: (e: Event) => {
              e.stopPropagation();
              this.toggleExpand(node);
            },
          },
          [icon(open ? "chev-down" : "chev-right", "xs")]
        )
      : el("span", { class: cls("tree-chev-spacer") });
    const labelEl = el("span", {
      class: cls("tree-label"),
      // A press that never clears the drag threshold is a plain click: reveal on
      // every one (so re-clicking re-centers), but only re-select on a change.
      onClick: () => {
        // The picker's capture-phase handler bails out on overlay chrome without
        // consuming the flag, so this read still sees it.
        if (this.deps.controller.guard.clickSuppressed) {
          return;
        }
        revealNode(node);
        if (node !== this.selection?.node) {
          this.deps.controller.select(node);
        }
      },
      text: label,
    });
    // Visibility rides the normal change pipeline, so hiding a layer is a real
    // edit the agent will apply. `visibility: hidden` rather than `display:
    // none` on purpose: `none` collapses the layout, which moves everything
    // around it and makes the row you just hid impossible to find again.
    let hidden = readValue(node, "visibility") === "hidden";
    /*
     * Repaints its own row rather than rebuilding the panel.
     *
     * `renderBody()` here was a real bug, not just waste: it rebuilds the tree
     * from scratch, which collapses every branch back to the auto-expanded path
     * — so hiding a layer six levels down scrolled the tree away from the layer
     * you were working on.
     */
    const eye = el(
      "button",
      {
        class: cls("tree-act"),
        onClick: (e: Event) => {
          e.stopPropagation();
          hidden = !hidden;
          this.recordOn(node, "visibility", hidden ? "hidden" : "visible");
          this.deps.controller.drawOutline();
          this.notifyChanged();
          syncEye();
          row.classList.toggle(cls("tree-hidden"), hidden);
        },
        type: "button",
      },
      []
    );
    function syncEye(): void {
      eye.replaceChildren(icon(hidden ? "eye-off" : "eye", "xs"));
      eye.dataset.tip = hidden ? "Show" : "Hide";
      eye.setAttribute("aria-label", hidden ? "Show layer" : "Hide layer");
    }
    syncEye();

    // Lock is editor-local state, not CSS — locking a layer is about what the
    // *picker* may select, and writing `pointer-events: none` into the user's
    // source to get that would be a genuinely bad trade.
    let locked = this.locked.has(node);
    const lock = el(
      "button",
      {
        class: cls("tree-act"),
        onClick: (e: Event) => {
          e.stopPropagation();
          locked = !locked;
          if (locked) {
            this.locked.add(node);
          } else {
            this.locked.delete(node);
          }
          syncLock();
          row.classList.toggle(cls("tree-locked"), locked);
        },
        type: "button",
      },
      []
    );
    function syncLock(): void {
      lock.replaceChildren(icon(locked ? "lock" : "unlock", "xs"));
      lock.dataset.tip = locked ? "Unlock" : "Lock";
      lock.setAttribute("aria-label", locked ? "Unlock layer" : "Lock layer");
    }
    syncLock();

    const row = el(
      "div",
      {
        class: `${cls("tree-node")} ${self ? cls("tree-self") : ""}`,
        "data-tip": elementLabel(node),
      },
      [
        chevron,
        el("span", { class: cls("tree-kind") }, [icon(KIND_ICON[kind], "xs")]),
        labelEl,
        eye,
        lock,
      ]
    );
    row.dataset.kind = kind;
    row.classList.toggle(cls("tree-hidden"), hidden);
    row.classList.toggle(cls("tree-locked"), locked);
    // Depth rides on the panel's own text margin rather than a tighter one of
    // its own: a root row's chevron now starts where every section heading and
    // field row starts, instead of 16px further out against the dock edge.
    row.style.paddingLeft = `calc(var(--ap-space-lg) + ${depth * 12}px)`;
    this.rowNode.set(row, node);
    this.bindTreeRow(row, labelEl, node);
    return row;
  }

  /**
   * Make a tree row both draggable (by its label, so the expander chevron stays
   * clickable) and droppable. Rows are rebuilt wholesale on every render, so the
   * entities go into `treeScope` and are destroyed before the next one.
   */
  private bindTreeRow(
    row: HTMLElement,
    handle: HTMLElement,
    node: Element
  ): void {
    const id = `${DND.treeRow}:${this.rowId}`;
    this.rowId += 1;
    if (node.parentElement && !isEditorNode(node)) {
      this.treeScope.add(
        new Draggable(
          {
            element: row,
            handle,
            id,
            // A clone follows the cursor while the row keeps its place in the
            // list — these are our own elements, so cloning is free of the
            // risks it would carry on a host-app node.
            plugins: FEEDBACK.clone,
            type: DND.treeRow,
          },
          manager
        )
      );
    }
    this.treeScope.add(
      new Droppable(
        {
          accept: DND.treeRow,
          collisionDetector: () => this.detectTreeZone(row, node, `${id}:drop`),
          element: row,
          id: `${id}:drop`,
          type: DND.treeRow,
        },
        manager
      )
    );
  }

  /**
   * Split a row into three drop zones by pointer height: the outer 28% bands
   * reparent as a sibling before/after, the middle drops *into* the node.
   */
  private detectTreeZone(
    row: HTMLElement,
    node: Element,
    id: string
  ): Collision | null {
    const drag = this.treeDrag;
    if (!drag || node === drag.node || drag.node.contains(node)) {
      return null;
    }
    const { x, y } = this.treeDelta.pointer;
    const rect = row.getBoundingClientRect();
    if (
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom ||
      rect.height === 0
    ) {
      return null;
    }
    const rel = (y - rect.top) / rect.height;
    let pos: DropPos;
    if (rel < TREE_EDGE_ZONE) {
      pos = "before";
    } else if (rel > 1 - TREE_EDGE_ZONE) {
      pos = "after";
    } else {
      pos = "inside";
    }
    this.treeResolved = { node, pos, rect };
    return hit(id);
  }

  private toggleExpand(node: Element): void {
    if (this.expanded.has(node)) {
      this.expanded.delete(node);
    } else {
      this.expanded.add(node);
    }
    this.renderBody();
  }

  // -- Tree drag-to-reparent -------------------------------------------------

  /** Subscribe once to the shared manager; the handlers filter by drag type. */
  private watchTreeDrag(): void {
    this.unwatch.push(
      manager.monitor.addEventListener("dragstart", () => this.onTreeStart()),
      manager.monitor.addEventListener("dragmove", (e) => {
        if (this.isTreeDrag()) {
          this.treeDelta.update(e);
        }
      }),
      manager.monitor.addEventListener("collision", (e) =>
        this.onTreeCollision(e.collisions)
      ),
      manager.monitor.addEventListener("dragend", (e) =>
        this.onTreeEnd(e.canceled)
      )
    );
  }

  private isTreeDrag(): boolean {
    return manager.dragOperation.source?.type === DND.treeRow;
  }

  private onTreeStart(): void {
    if (!this.isTreeDrag()) {
      return;
    }
    const row = manager.dragOperation.source?.element;
    const node = isHtmlElement(row) ? this.rowNode.get(row) : undefined;
    if (!node) {
      return;
    }
    this.treeDrag = {
      node,
      origNext: node.nextSibling,
      origParent: node.parentElement,
    };
    // The fade lands on the *page* element, not the tree row — dragging a row
    // should show you which thing in the page you are moving.
    node.classList.add(cls("dragging"));
    this.treeDelta.start();
  }

  private onTreeCollision(collisions: readonly Collision[]): void {
    if (!this.isTreeDrag()) {
      return;
    }
    const [winner] = collisions;
    this.treeArmed =
      winner && this.treeResolved && winner.id.toString().endsWith(":drop")
        ? this.treeResolved
        : null;
    if (this.treeArmed) {
      this.showTreeIndicator(this.treeArmed.rect, this.treeArmed.pos);
    } else {
      this.hideTreeIndicator();
    }
  }

  private onTreeEnd(canceled: boolean): void {
    if (!this.isTreeDrag()) {
      return;
    }
    const drag = this.treeDrag;
    const target = this.treeArmed;
    this.treeDrag = null;
    this.treeArmed = null;
    this.treeResolved = null;
    this.hideTreeIndicator();
    drag?.node.classList.remove(cls("dragging"));
    if (canceled || !drag) {
      return;
    }
    this.dropTreeNode(drag, target);
  }

  private dropTreeNode(
    drag: TreeDrag,
    target: { node: Element; pos: DropPos } | null
  ): void {
    const { origParent } = drag;
    if (!(target && origParent)) {
      return;
    }
    let newParent: Element | null;
    let before: Element | null;
    if (target.pos === "inside") {
      newParent = target.node;
      before = null;
    } else {
      newParent = target.node.parentElement;
      before =
        target.pos === "before" ? target.node : target.node.nextElementSibling;
    }
    if (
      !newParent ||
      isEditorNode(newParent) ||
      newParent === drag.node ||
      drag.node.contains(newParent)
    ) {
      return;
    }
    if (before === drag.node) {
      before = drag.node.nextElementSibling;
    }
    const ref = before && before.parentElement === newParent ? before : null;
    newParent.insertBefore(drag.node, ref);
    const toIndex = Array.from(newParent.children).indexOf(drag.node);
    this.expanded.add(newParent);
    this.recordMove({
      before: ref,
      newParent,
      node: drag.node,
      origNext: drag.origNext,
      origParent,
      toIndex,
    });
    // Keep the moved node selected and in view so the outline follows the drop
    // and the panel reflects its new parent — mirrors a canvas grab-to-move.
    this.deps.controller.select(drag.node);
    revealNode(drag.node);
  }

  private showTreeIndicator(rect: DOMRect, pos: DropPos): void {
    if (pos === "inside") {
      hide(this.treeDropLine);
      place(this.treeDropInto, {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      });
      return;
    }
    hide(this.treeDropInto);
    const top = pos === "before" ? rect.top : rect.bottom;
    place(this.treeDropLine, {
      height: 2,
      left: rect.left,
      top: top - 1,
      width: rect.width,
    });
  }

  private hideTreeIndicator(): void {
    hide(this.treeDropLine);
    hide(this.treeDropInto);
  }

  // -- Tabs ------------------------------------------------------------------

  private buildTabs(): void {
    const mk = (
      id: Tab,
      label: string,
      iconName: IconName,
      tip: string
    ): HTMLElement =>
      el(
        "button",
        {
          class: cls("insp-tab"),
          "data-tab": id,
          // The tab's own word says *what* it is; the tip says what it is for.
          // Repeating "Design" back at the pointer would be furniture.
          "data-tip": tip,
          onClick: () => {
            this.tab = id;
            this.syncTabs();
            this.renderBody();
          },
          type: "button",
        },
        [icon(iconName, "sm"), el("span", { text: label })]
      );
    this.tabsEl.append(
      // "Edit", not "Design" — the dock this lives in is already called Design
      // (see `app.ts`), and a Design tab inside the Design panel names the same
      // thing twice at two different scopes.
      // The icons/design.svg mark, not `settings` (a gear means application
      // preferences) and not `edit-object` (a bezier path with its handles out,
      // which names vector point editing — something a DOM editor cannot do and
      // this tab does not offer). A tab is named by its surface, not by a tool
      // inside it.
      mk("edit", "Edit", "design", "Visual properties"),
      mk("css", "CSS", "code", "Every declaration, as CSS"),
      mk("dom", "DOM", "layer-group", "The element tree")
    );
    this.syncTabs();
  }

  private syncTabs(): void {
    for (const btn of Array.from(this.tabsEl.children)) {
      btn.classList.toggle(
        cls("insp-tab-on"),
        (btn as HTMLElement).dataset.tab === this.tab
      );
    }
  }

  // -- Body ------------------------------------------------------------------

  /**
   * Clear and rebuild the panel body.
   *
   * The rebuild is the reason the panel felt like it jumped. It runs from
   * fourteen different handlers, several of them mid-interaction, and it used
   * to throw away three things the user had established and could not get back:
   * which sections they had collapsed, where they had scrolled to, and which
   * field their caret was in. All three are now carried across — the collapse
   * set lives on the panel (`this.collapsed`), and scroll and focus are latched
   * here and restored below.
   *
   * Scroll and focus are only restored when the rebuild is for the *same* thing:
   * switching tabs or selecting a different element should start at the top,
   * because that genuinely is a different page.
   */
  private renderBody(): void {
    /*
     * One stylesheet scan for the whole render.
     *
     * `matchedRules` is uncached and 24ms-budgeted, and this pass asks for it up to four
     * times for the same element — `resolveTokens`, `scopeLevels`, `declaredValue` for
     * every length control, and the CSS pane. Sharing one result also makes them *agree*:
     * the budget truncates at a different rule each time, so one consumer could see a
     * class another had not.
     */
    const endScan = beginScanPass();
    try {
      this.renderBodyInner();
    } finally {
      endScan();
    }
  }

  private renderBodyInner(): void {
    const sameView =
      this.tab === this.renderedTab &&
      this.selection?.node === this.renderedNode;
    const scrollTop = sameView ? this.bodyEl.scrollTop : 0;
    const focus = sameView ? this.captureFocus() : null;

    // An open popover is anchored to a control that is about to stop existing.
    // It lives on the popover host rather than in here, so the rebuild cannot
    // reach it — which is exactly why it has to be told. Closing rather than
    // re-anchoring is deliberate: the replacement control is seeded from freshly
    // read computed values, so silently pointing a half-finished interaction at
    // it would let the popover and the panel disagree with nothing on screen to
    // say so.
    closeOpenPopover("anchor-gone");
    // Rendering is clear-and-rebuild with no reconciliation, so every dnd-kit
    // entity bound to the outgoing DOM has to go with it — otherwise the
    // registry accumulates detached rows and grips that still answer queries.
    for (const control of this.controls) {
      control.destroy?.();
    }
    this.controls = [];
    this.treeScope.clear();
    clear(this.bodyEl);
    this.renderedTab = this.tab;
    this.renderedNode = this.selection?.node ?? null;
    this.shape = this.selection ? this.shapeKey(this.selection.node) : "";
    // One resolution pass per render, shared by every badge built during it.
    this.tokenCache = new Map();

    if (!this.selection) {
      this.bodyEl.append(
        emptyState({
          body: "Hover the page to see what is selectable.",
          title: "Pick an element to start tweaking",
        })
      );
      return;
    }
    if (this.tab === "css") {
      this.renderCssTab();
      this.restoreView(scrollTop, focus);
      return;
    }
    if (this.tab === "dom") {
      this.renderDomTab();
      this.restoreView(scrollTop, focus);
      return;
    }
    const { node } = this.selection;
    // Scope and State govern every control below them, so they sit above
    // everything — including the alignment strip — and outside the collapsible
    // sections. Null when the element has neither shared classes nor
    // interaction styling, which is most elements.
    const scopeRow = renderScopeRow(this.ctx, node, {
      onScope: (scope) => this.setScope(scope),
      onState: (state) => this.setState(state),
      value: this.editTarget,
    });
    if (scopeRow) {
      this.bodyEl.append(scopeRow);
    }
    // A design tool opens its Design panel with the alignment strip, above and outside
    // the collapsible sections — it is the one control that is always there.
    this.bodyEl.append(renderAlignRow(this.ctx, node));
    this.renderSections(node);
    this.restoreView(scrollTop, focus);
  }

  /** Which field had the caret, and where in it. */
  private captureFocus(): { key: string; start: number; end: number } | null {
    const active = this.bodyEl.ownerDocument.activeElement;
    if (!(active instanceof HTMLInputElement)) {
      return null;
    }
    if (!this.bodyEl.contains(active)) {
      return null;
    }
    const key = active.closest<HTMLElement>("[data-field]")?.dataset.field;
    return key
      ? {
          end: active.selectionEnd ?? 0,
          key,
          start: active.selectionStart ?? 0,
        }
      : null;
  }

  /**
   * Put the scroller and the caret back.
   *
   * Synchronously, not on the next frame: reading `scrollTop` forces layout, so
   * by the time this runs the new body has a height and the assignment sticks.
   * Deferring it to a `requestAnimationFrame` would paint one frame at the top
   * first, which is the flicker this whole mechanism exists to remove.
   */
  private restoreView(
    scrollTop: number,
    focus: { key: string; start: number; end: number } | null
  ): void {
    if (scrollTop) {
      this.bodyEl.scrollTop = scrollTop;
    }
    if (!focus) {
      return;
    }
    const field = this.bodyEl.querySelector<HTMLElement>(
      `[data-field="${CSS.escape(focus.key)}"]`
    );
    const input = field?.querySelector("input");
    if (input) {
      input.focus();
      input.setSelectionRange(focus.start, focus.end);
    }
  }

  /**
   * Briefly outline a node that was edited but is not the selection.
   *
   * Writing `justify-content` to the parent is the one place the panel touches
   * something you did not pick. Doing it invisibly would be the actual problem;
   * a 600ms flash makes the side effect legible without a dialog.
   */
  private flash(node: Element): void {
    const surface = this.selection?.surface;
    if (!surface) {
      return;
    }
    const box = el("div", { class: cls("flash-box") });
    this.deps.layer.add(box);
    place(
      box,
      surface.toScreen(localRect(node)),
      clipToSurface(surface, surface.toScreen(localRect(node)))
    );
    setTimeout(() => box.remove(), 620);
  }

  /** One cell of the field grid: a bare control, or a labelled full-width row. */
  private fieldCell(descriptor: Descriptor, node: Element): HTMLElement {
    const control = this.buildControl(descriptor, node);
    this.markInherited(control, node, descriptor.cssProperty);
    /*
     * No badge on a control that could not show a binding.
     *
     * `font-weight` is a token category whose control is a segmented group, and
     * a segmented group has no `setToken` — so the cell rendered a lit badge
     * over a row of pills still showing `500`, asserting a binding that nothing
     * on screen reflected. A control that cannot honour the affordance should
     * not advertise it; the CSS pane remains the way to write such a value by
     * hand.
     */
    const slot = control.setToken
      ? this.tokenSlot(node, [descriptor.cssProperty])
      : null;
    // The control is always the control. A binding changes what it reads, not
    // what it is — see `TokenSlot`.
    control.setToken?.(slot?.label ?? null);
    control.onActivate?.(() => slot?.open());
    const badge = slot?.element;
    const glyphed = Boolean(descriptor.fieldIcon || descriptor.fieldLabel);
    if (glyphed && descriptor.span !== "full") {
      control.element.classList.add(cls("cell"));
      // A glyphed field is its own cell, so the badge rides alongside it in a
      // wrapper rather than inside the field's own chrome.
      return badge
        ? el("div", { class: `${cls("cell")} ${cls("token-cell")}` }, [
            control.element,
            badge,
          ])
        : control.element;
    }
    return labelled(
      descriptor.label,
      control.element,
      ...(badge ? [badge] : [])
    );
  }

  /**
   * Mark a control whose value the element does not declare.
   *
   * Every control seeds from `readValue`, which is computed style — and computed style
   * folds in inheritance. So a `<p>` inside a `text-transform: uppercase` container
   * showed **Uppercase** as though the paragraph had said so, and committing anything
   * pinned a fresh declaration onto the child. Nothing distinguished "set here" from
   * "inherited from an ancestor", and the only place in the panel that knew the
   * difference was the CSS pane's `origin` badge, which the Design tab never saw.
   *
   * `data-inherited` rather than new chrome: the styles can dim the value or mark it
   * however the design calls for, and a control that is not a field (a segmented group,
   * an align pad) is unaffected by an attribute it does not style. The tooltip is the
   * part that matters for now, because it says *where* the value comes from.
   *
   * Only for properties that actually inherit — a padding that is not declared is `0px`
   * because that is the initial value, not because an ancestor said so.
   */
  private markInherited(
    control: ControlHandle,
    node: Element,
    property: string
  ): void {
    if (!INHERITED_PROPERTIES.has(property)) {
      return;
    }
    if (declaredValue(node, property)) {
      return;
    }
    const source = inheritedFrom(node, property);
    if (!source) {
      return;
    }
    control.element.dataset.inherited = "";
    const existing = control.element.dataset.tip;
    control.element.dataset.tip = existing
      ? `${existing} — inherited from ${source}`
      : `Inherited from ${source}`;
  }

  /**
   * Which token provides a property's current value, resolved once per node per
   * render.
   *
   * `resolveTokens` takes a property *list* and was being called once per badge
   * with a list of one — so every badge paid for its own `getComputedStyle` and
   * its own registry scan, and now for its own stylesheet walk as well. The
   * cache is dropped at the top of `renderBody`, which is the only point at
   * which any of those answers can have changed.
   */
  private resolvedToken(node: Element, property: string): TokenRef | undefined {
    let resolved = this.tokenCache.get(node);
    if (!resolved) {
      resolved = resolveTokens(node, TOKENIZABLE_PROPERTIES);
      this.tokenCache.set(node, resolved);
    }
    return resolved.get(property);
  }

  /**
   * The design-token affordance for one property on one node, or null when the
   * project declares no tokens that could apply.
   *
   * Lives on the panel rather than in each section because it needs two things
   * sections do not have: the change set (which knows both what token the
   * pending value resolved to and whether the user detached it), and the write
   * path.
   */
  /**
   * The token affordance for the properties one field writes: a pill when they
   * are bound, a badge when they are not, `null` when the project declares no
   * tokens that could apply.
   *
   * Takes a *set* of properties because the panel's paired controls write
   * several longhands from one input — the collapsed padding field writes left
   * and right, the collapsed corner field writes all four. A pill on such a
   * field is only honest when every property it covers resolves to the same
   * token; where they disagree the field is showing a value, so it keeps the
   * badge and the number.
   */
  private tokenSlot(
    node: Element,
    properties: readonly string[]
  ): TokenSlot | null {
    const [first] = properties;
    if (!first) {
      return null;
    }
    /*
     * Applied across the whole set, and rendered once.
     *
     * `applyToken` ends in a `renderBody()`, so looping it per property meant
     * binding the stroke colour — four longhands — tore the panel down and
     * rebuilt it four times, each rebuild throwing away the badge the click had
     * come from.
     */
    const options = {
      node,
      onApply: (token: DesignToken) => this.applyToken(node, properties, token),
      onUnlink: () => this.unlinkToken(node, properties),
      property: first,
    };
    if (properties.some((p) => this.deps.changeSet.isHardcoded(node, p))) {
      // Detached on purpose. Offer the badge unlinked so it can be re-attached,
      // but never show it as though a token were in force.
      const element = createTokenBadge(options);
      return element
        ? {
            apply: options.onApply,
            bound: false,
            element,
            label: null,
            open: () => element.click(),
            unlink: options.onUnlink,
          }
        : null;
    }
    const current = this.currentToken(node, properties);
    const element = createTokenBadge({ ...options, current });
    if (!element) {
      return null;
    }
    // Bound only for a real binding. A value that merely equals a token's keeps
    // showing its number — the field is displaying a value, not a reference.
    const bound = current?.via === "reference";
    return {
      // The same two writes the badge's own picker makes, exposed for the one
      // control that draws its own list instead of borrowing this one.
      apply: options.onApply,
      bound,
      element,
      label: bound && current ? shortName(current.name) : null,
      // The badge is the picker's trigger; a bound field borrows it so its own
      // token name opens the same list.
      open: () => element.click(),
      unlink: options.onUnlink,
    };
  }

  /** The one token every property in the set resolves to, or none. */
  private currentToken(
    node: Element,
    properties: readonly string[]
  ): TokenRef | undefined {
    const pending = this.deps.changeSet.allChangesFor(node, this.editTarget);
    let agreed: TokenRef | undefined;
    for (const property of properties) {
      // A pending edit's own token beats what the DOM still shows — the preview
      // is applied, but the *resolution* was done at record time against the
      // value the user chose.
      const found =
        pending.find((c) => c.property === property)?.token ??
        this.resolvedToken(node, property);
      if (!found) {
        return;
      }
      if (agreed && agreed.name !== found.name) {
        return;
      }
      agreed ??= found;
    }
    return agreed;
  }

  /**
   * A bespoke numeric field, registered so the panel can re-seed it.
   *
   * The generic pipeline's `createNumberScrub` needs a `Descriptor`, which
   * carries a `cssProperty` — and the bespoke fields do not have one. X and Y
   * are a *measurement*; a blur radius is one term inside a `filter` chain; W
   * and H may be `max-content` behind a Hug. So they take a spec and a commit
   * of their own, and say separately which properties changing should make them
   * re-read.
   *
   * `read` is what makes that honest for the derived ones: `setValue` hands it
   * the new raw property value, and it returns what the field should *show* —
   * re-measuring or re-parsing rather than mirroring. Identity by default.
   */
  private numControl(
    spec: NumSpec,
    initial: string,
    onCommit: (css: string) => void,
    properties: readonly string[],
    read?: (value: string, property: string) => string
  ): NumHandle {
    const field = createNumField(spec, initial, onCommit, this.gestures);
    this.controls.push({
      destroy: field.destroy,
      element: field.element,
      properties,
      setToken: (name) => field.setToken(name),
      setValue(cssProperty, value) {
        if (properties.includes(cssProperty)) {
          field.setValue(read ? read(value, cssProperty) : value);
        }
      },
    });
    return field;
  }

  /**
   * Padding or margin, as the pair-with-a-switch-to-four.
   *
   * One helper for both because they are one control: the same two-then-four
   * shape, the same mode toggle in the same place. The only thing that differs
   * is whether zero is a floor — it is for padding, and it is not for margin,
   * where pulling a child back out of its parent's padding is a technique.
   */
  private spacingControl(
    node: Element,
    group: "padding" | "margin"
  ): ControlHandle {
    const sides = SPACING_GROUP.descriptors.filter(
      (d) => d.compoundGroup === group
    );
    const padding = group === "padding";
    return createPadding(
      {
        collapsed: padding
          ? { h: "pad-h", v: "pad-v" }
          : { h: "gap-h", v: "gap-v" },
        descriptors: sides,
        noun: group,
        signed: !padding,
        toggle: {
          glyph: "pad-individual",
          label: `Independent ${group}`,
        },
        tokenSlot: (properties) => this.tokenSlot(node, properties),
      },
      readValues(node, sides),
      this.onChange,
      this.gestures
    );
  }

  /**
   * Build the control a descriptor asks for, seeded from the selection.
   *
   * `after` is for the handful of properties that change the *shape* of the
   * panel rather than just a value — `display` and `position` — and need a
   * rebuild once the write has landed. Everything else passes `onChange`
   * straight through.
   */
  private buildControl(
    descriptor: Descriptor,
    node: Element,
    after?: () => void
  ): ControlHandle {
    const value = this.seed(
      node,
      descriptor.cssProperty,
      descriptor.defaultValue
    );
    // Named apart from `this.onChange` it delegates to: sharing the name reads
    // to the linter as a function that only ever calls itself.
    const handleChange: OnChange = after
      ? (property, next) => {
          this.onChange(property, next);
          after();
        }
      : this.onChange;
    let control: ControlHandle;
    if (descriptor.controlType === "segmented") {
      control = createSegmented(descriptor, value, handleChange);
    } else if (descriptor.controlType === "select") {
      control = createSelect(descriptor, value, handleChange);
    } else if (descriptor.controlType === "color-swatch") {
      control = createColorControl(
        descriptor,
        value,
        handleChange,
        this.gestures
      );
    } else {
      control = createNumberScrub(
        descriptor,
        value,
        handleChange,
        this.gestures
      );
    }
    this.controls.push(control);
    return control;
  }

  /**
   * A collapsible section.
   *
   * There is deliberately no leading glyph. `opts` used to carry an `icon` that
   * every caller passed and nothing ever rendered — the header only appends the
   * chevron, the title and the actions — so it was ten arguments' worth of
   * silent no-op. Design-panel headings are text with their actions on
   * the right, which is what this already was.
   */
  private section(
    id: string,
    label: string,
    body: HTMLElement,
    opts: {
      actions?: HTMLElement[];
      /**
       * A read-only adornment for the heading — Source's `App.tsx:31`.
       *
       * Separate from `actions` because that bar swallows the click on its way
       * to the header, which is right for a button and wrong for a label: put
       * text in there and the one part of the heading that names the section's
       * contents becomes the one part that will not open it.
       */
      meta?: HTMLElement;
      /**
       * Called whenever the section settles open or closed, including once on
       * first render. The CSS pane's matched-rules scan hangs off this: it is
       * the expensive thing in the panel and nobody should pay for it until
       * they ask to see it.
       */
      onToggle?: (open: boolean) => void;
      /** Closed the first time this id is ever rendered. The user's own choice
       * wins from then on, via `collapsed`. */
      startCollapsed?: boolean;
    } = {}
  ): HTMLElement {
    if (opts.startCollapsed && !this.seenSections.has(id)) {
      this.collapsed.add(id);
    }
    this.seenSections.add(id);
    // Keyed on `id`, not `label`, for two reasons. Renaming a heading should
    // not silently reset what the user collapsed — and "Auto layout" and
    // "Layout grid" are *one* section under two names, so keying on the label
    // would let collapsing it as a flex container reopen it the moment the
    // element became a grid.
    let open = !this.collapsed.has(id);
    // Down/up rather than right/down: the chevron is pinned to the header's
    // right edge, and a right-pointing arrow there points out of the panel.
    const chevron = el("span", { class: cls("sect-chev") }, [
      icon(open ? "chev-up" : "chev-down", "xs"),
    ]);
    const header = el("div", {
      "aria-expanded": String(open),
      class: cls("sect-head"),
      "data-tip": `${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`,
      onClick: () => {
        open = !open;
        if (open) {
          this.collapsed.delete(id);
        } else {
          this.collapsed.add(id);
        }
        body.classList.toggle(cls("hidden"), !open);
        chevron.replaceChildren(icon(open ? "chev-up" : "chev-down", "xs"));
        header.setAttribute("aria-expanded", String(open));
        header.dataset.tip = `${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`;
        opts.onToggle?.(open);
      },
      role: "button",
      tabindex: "0",
    });
    body.classList.toggle(cls("hidden"), !open);
    opts.onToggle?.(open);
    // Heading first, chevron last. On the left it either sat in the gutter —
    // flush against the dock edge — or pushed the heading inboard of the rows
    // it heads. On the right it lines the arrows up in a single column down the
    // panel and leaves every heading starting on the same margin as its content.
    header.append(el("span", { class: cls("sect-title"), text: label }));
    if (opts.meta) {
      header.append(opts.meta);
    }
    if (opts.actions?.length) {
      // The actions live inside a clickable header, so they must not also
      // collapse the section on their way through.
      const bar = el("div", {
        class: cls("sect-actions"),
        onClick: (e: Event) => e.stopPropagation(),
      });
      bar.append(...opts.actions);
      header.append(bar);
    }
    header.append(chevron);
    return el("div", { class: cls("sect") }, [header, body]);
  }

  /** A small ghost button for a section header (the `+` on repeatable lists). */
  static headerAction(
    iconName: IconName,
    tip: string,
    onClick: () => void
  ): HTMLElement {
    return el(
      "button",
      {
        "aria-label": tip,
        class: cls("sect-act"),
        "data-tip": tip,
        onClick,
        type: "button",
      },
      [icon(iconName, "xs")]
    );
  }

  /**
   * Grab-to-move is armed for whatever is selected, and disarmed when nothing
   * is. It used to be behind a "Drag to move" toggle in the Position section,
   * which was vestigial: selecting anything switched it on, so it was never
   * observed off, and switching it off by hand only broke dragging until the
   * next selection re-armed it. A control with one reachable state is not a
   * control.
   */
  private armReorder(): void {
    this.reorder.enable();
  }

  private disarmReorder(): void {
    this.reorder.disable();
  }

  /**
   * A completed drag from either entry point (the canvas reorder controller or
   * the DOM-tab tree DnD): resolve the moved element + destination sources and
   * record the structural move. The moved node need not be the current selection
   * (tree DnD can relocate any node), so its context is resolved on demand.
   */
  async recordMove(move: CompletedMove): Promise<void> {
    const sel = this.selection;
    // Source resolution has to happen in the realm the node came from — see
    // `frame-agent.ts`. Going through the surface is what routes it there.
    const surface = this.deps.resolver.of(move.node);
    if (!surface) {
      return;
    }
    let element: ElementContext;
    let source: SourceLocation | null;
    if (sel && move.node === sel.node) {
      ({ element, source } = sel);
    } else {
      const info = await surface.extract(move.node);
      element = info.context;
      ({ source } = info);
    }
    const [parentInfo, beforeInfo] = await Promise.all([
      surface.extract(move.newParent),
      move.before ? surface.extract(move.before) : Promise.resolve(null),
    ]);
    // Read before recording: this is the state undo has to return the set to,
    // and a second drag of the same node overwrites it.
    const prev = this.deps.moveSet.get(move.node) ?? null;
    this.deps.moveSet.record({
      before: beforeInfo?.context ?? null,
      beforeSource: beforeInfo?.source ?? null,
      element,
      newParent: parentInfo.context,
      newParentSource: parentInfo.source,
      node: move.node,
      origNext: move.origNext,
      origParent: move.origParent,
      source,
      toIndex: move.toIndex,
    });
    const next = this.deps.moveSet.get(move.node) ?? null;
    /*
     * Journalled at last.
     *
     * `History` has carried a fully implemented `move` op since it was written
     * and nothing ever pushed one, so drag-to-reposition was the one direct
     * manipulation ⌘Z could not touch — and because the app deliberately widens
     * ⌘Z to always match in edit mode (so it cannot fall through to the
     * browser's native undo), pressing it after a drag either said "Nothing to
     * undo" or reached past the drag and took back an earlier style tweak.
     *
     * `next` is read back out of the set rather than assumed, because `record`
     * drops the entry when a node is dragged back to where it started — and an
     * op claiming a state the set does not hold would restore it on redo.
     */
    if (next) {
      this.deps.history.push({
        fromNext: move.origNext,
        fromParent: move.origParent,
        kind: "move",
        next,
        node: move.node,
        prev,
        toNext: move.node.nextSibling,
        toParent: move.newParent,
      });
    }
    this.deps.controller.drawOutline();
    this.renderBody();
    this.notifyChanged();
  }

  // -- CSS tab ---------------------------------------------------------------

  /**
   * The CSS pane lives in `sections/css.ts` alongside the Design sections.
   *
   * It grew a box-model diagram, a matched-rules scanner and a grouped
   * computed list, which is more code than the rest of this file's tab
   * handling put together — and none of it needs anything from the panel that
   * `SectionContext` does not already expose, apart from the override set
   * below.
   */
  /**
   * Append the Design tab's sections, in order.
   *
   * Split out of `renderBody` because that method already owns three
   * separate concerns — latching the view, tearing down controls, and tab
   * dispatch — and the section list is the part that grows.
   */
  private renderSections(node: Element): void {
    /*
     * The Design tab's first and only per-element branching.
     *
     * Everything here was unconditional, and for a page of divs that was right.
     * It stops being right the moment a `<path>` is selected: it has no box, no
     * padding and no text flow, so Position, Spacing and Auto layout would be
     * five sections of controls that cannot do anything.
     *
     * Anything gating a section here **must** also appear in `shapeKey`, or the
     * section fails to appear or disappear when the element changes under a
     * refresh rather than a reselect.
     */
    const vector = isSvgChild(node);

    if (!vector) {
      this.bodyEl.append(renderPosition(this.ctx, node));
      this.bodyEl.append(renderConstraints(this.ctx, node));
    }
    this.bodyEl.append(renderSize(this.ctx, node, this.sizeState));
    if (!vector) {
      this.bodyEl.append(renderAutoLayout(this.ctx, node));
      this.bodyEl.append(renderSpacing(this.ctx, node));
      for (const group of GROUPS) {
        if (group.visible && !group.visible(node)) {
          continue;
        }
        this.bodyEl.append(renderText(this.ctx, node, group));
      }
    }
    this.bodyEl.append(renderAppearance(this.ctx, node));
    if (isMedia(node) || hasBackgroundImage(node)) {
      this.bodyEl.append(renderMedia(this.ctx, node));
    }
    if (vector || isSvgRoot(node)) {
      this.bodyEl.append(renderVector(this.ctx, node));
    }
    if (!vector) {
      // A `<path>` has `fill` and `stroke`, not `background` and `border` — the
      // Vector section covers it, and these two would offer properties that do
      // nothing on it.
      this.bodyEl.append(
        renderFill(this.ctx, node),
        renderStroke(this.ctx, node)
      );
    }
    this.bodyEl.append(
      renderFilters(this.ctx, node),
      renderEffects(this.ctx, node)
    );
  }

  private renderCssTab(): void {
    const node = this.selection?.node;
    if (!node) {
      return;
    }
    this.bodyEl.append(
      renderCssPane(
        this.ctx,
        {
          changesFor: (n) =>
            this.deps.changeSet.allChangesFor(n, this.editTarget),
          deleteDecl: (n, property) => this.deleteDecl(n, property),
          getFilter: () => this.cssFilter,
          getTerse: () => this.cssView.terse,
          setFilter: (value) => {
            this.cssFilter = value;
          },
          setTerse: (value) => {
            this.cssView.terse = value;
          },
          toggleDecl: (n, property, disabled) =>
            this.toggleDecl(n, property, disabled),
        },
        node
      )
    );
  }

  private toggleDecl(node: Element, property: string, disabled: boolean): void {
    const target = this.editTarget;
    const before = this.deps.changeSet.snapshot(node, property, target);
    this.deps.changeSet.setDisabled(node, property, disabled, target);
    if (disabled) {
      clearPreview(node, property);
      // The disabled declaration may have been sitting on top of a pending
      // default-state tweak to the same property; uncover it.
      this.deps.changeSet.reapplyPreviews(node);
    } else {
      const to = this.deps.changeSet
        .allChangesFor(node, target)
        .find((c) => c.property === property)?.to;
      if (to !== undefined) {
        applyPreview(node, property, to, Boolean(target.state));
      }
    }
    this.journalDecl(node, before, property, target);
    this.deps.controller.drawOutline();
    this.deps.onChanged?.();
    this.refreshCss();
    this.notifyChanged();
  }

  private deleteDecl(node: Element, property: string): void {
    const before = this.deps.changeSet.snapshot(
      node,
      property,
      this.editTarget
    );
    clearPreview(node, property);
    this.deps.changeSet.remove(node, property, this.editTarget);
    this.deps.changeSet.reapplyPreviews(node);
    this.journalDecl(node, before, property, this.editTarget);
    this.deps.controller.drawOutline();
    this.deps.onChanged?.();
    this.refreshCss();
    this.notifyChanged();
  }

  /**
   * Journal everything that happens to one pending declaration: a value edit, a
   * disable toggle, a delete, a token binding, a detach.
   *
   * Call it *after* the mutation with the snapshot taken before. `after` is read
   * back out of the set rather than predicted, so a mutation that turned out to
   * be a no-op journals nothing instead of an op that would restore a state the
   * set never held.
   *
   * `property` and `target` are passed rather than read off `before`, because
   * `before` is null for the first edit of a property — the case where there is
   * most obviously something to undo.
   */
  private journalDecl(
    node: Element,
    before: Change | undefined,
    property: string,
    target?: ChangeTarget
  ): void {
    const sel = this.selection;
    if (!sel) {
      return;
    }
    const after = this.deps.changeSet.snapshot(node, property, target) ?? null;
    if (sameDecl(before ?? null, after)) {
      return;
    }
    this.deps.history.push({
      after,
      before: before ?? null,
      element: sel.element,
      kind: "decl",
      node,
      source: node === sel.node ? sel.source : null,
    });
  }

  /** Re-render the CSS tab in place (structural change: add / delete / toggle). */
  private refreshCss(): void {
    // Never mid-gesture. A scrub reaches here per pointermove, and rebuilding the
    // pane on every frame would drop the caret out of the row being typed in —
    // the same reasoning `reshapeIfNeeded` applies, and the declarations are not
    // settled until the drag ends either way.
    if (this.tab === "css" && !this.deps.history.isBatching) {
      this.renderBody();
    }
  }

  // -- Change notification ---------------------------------------------------

  /** Ping the app so it can re-render the composer's pending-tweaks pill from
   * the shared ChangeSet/MoveSet counts. */
  private notifyChanged(): void {
    this.deps.onChanged?.();
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Scroll a node into view (centered) only when it isn't already fully visible,
 * so re-selecting an on-screen node doesn't cause a jarring re-center. Used by
 * the DOM tab (row click + drop) — not the pick path, where the user just
 * clicked a visible element.
 *
 * "Visible" is measured against the node's *own* window. In a frame that is the
 * frame's viewport, which is the whole point: a node can be off-screen inside a
 * 375px frame while the frame itself is fully on the canvas.
 */
function revealNode(node: Element): void {
  const r = node.getBoundingClientRect();
  const win = ownerWindow(node) ?? window;
  const doc = ownerDocument(node) ?? document;
  const vh = win.innerHeight || doc.documentElement.clientHeight;
  const vw = win.innerWidth || doc.documentElement.clientWidth;
  const fullyVisible =
    r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
  if (fullyVisible) {
    return;
  }
  node.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
}
