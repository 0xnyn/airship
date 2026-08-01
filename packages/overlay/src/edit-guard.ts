import { manager } from "./dnd/manager";
import { cls, PREFIX } from "./dom";
import { isElement, isNode } from "./realm";
import { GHOST_MARK } from "./styles/portable.css";

/**
 * Every selector the overlay owns. The hover/selection boxes and the drop
 * indicators live on the chrome layer, outside `#__airship-root`, so they need
 * naming here explicitly.
 *
 * `cls("layer")` is a *marker class* stamped on those individual nodes — see
 * `picker.ts`, `inspector/reorder.ts`, `inspector/panel.ts` — not the
 * `.chrome-layer` container they sit in. The distinction matters: the container
 * is deliberately absent, and so is the per-frame furniture `frame-chrome.ts`
 * puts on it (the title, the size badge, the eight grips). Those are the only
 * chrome that floats over a *frame* rather than over the app, and a wheel or a
 * space-drag there belongs to the canvas or to the frame beneath — which is what
 * `CanvasViewport.onWheel` goes on to work out. Adding the container here would
 * make that whole band dead to the wheel, and would quietly change the picker,
 * space-drag and `EditGuard.onPress` too, since all four share this predicate.
 *
 * The canvas viewport is deliberately *not* here, and is deliberately not a
 * child of the root either. It is not chrome floating over the app — it is the
 * substrate the app sits in, and a pointer over it is a pointer over the user's
 * content, which is exactly what the picker needs to be told.
 */
const CHROME = [
  `#${PREFIX}-root`,
  `.${cls("layer")}`,
  `.${cls("hover-box")}`,
  `.${cls("sel-box")}`,
  `.${cls("drop-box")}`,
  `.${cls("drop-line")}`,
  // The drag ghost is the one piece of chrome that lives in the *app's* own
  // document rather than on the layer — it has to, or the app's stylesheets
  // could not paint it (see `inspector/drag-ghost.ts`). That makes it a real
  // child of some element the editor also walks: `childrenOf` in `reorder.ts`
  // would otherwise offer it as a drop sibling whenever the target container is
  // the `<body>` it was appended to, and the DOM tree would list it.
  `[${GHOST_MARK}]`,
].join(", ");

/**
 * Is this node part of the editor's own chrome? Previously three near-identical
 * copies of this lived in `picker.ts`, `reorder.ts` and `panel.ts`, each
 * matching a different subset — so the picker would happily hover-highlight the
 * drop indicators that the reorder controller was careful to exclude.
 *
 * The `isElement` duck-type is load-bearing: `node instanceof Element` answers
 * `false` for every node that came out of a frame iframe, because that node's
 * `Element` belongs to the frame's realm, not this one. Written that way the
 * guard fails open on exactly the nodes the canvas spends all its time on.
 */
export function isOwn(node: EventTarget | null): boolean {
  return isElement(node) && Boolean(node.closest(CHROME));
}

/** Does this node carry an airship class (used when walking the page tree)? */
export function isEditorNode(node: Element): boolean {
  if (isOwn(node)) {
    return true;
  }
  for (const c of Array.from(node.classList)) {
    if (c.startsWith(PREFIX)) {
      return true;
    }
  }
  return false;
}

/**
 * Presses that must never reach the host app while editing. `pointerdown` has to
 * be allowed through on the drag source so dnd-kit's PointerSensor — which binds
 * element-level listeners, i.e. after document capture — can still see it.
 *
 * `click` and `dblclick` are both absent because the picker owns them outright:
 * one selects, the other enters in-place text editing, and it swallows each
 * itself in capture before the app can act. Two owners of one event type is an
 * ordering hazard worth avoiding — `onPress` uses `stopPropagation`, not
 * `stopImmediatePropagation`, so a picker listener on the same node *would*
 * still fire, but only by accident of `SelectionController.setEditing` calling
 * `guard.setEditing` before registering its own.
 *
 * Exported for the frame agent, which runs this same list one realm down while a
 * frame is live for a text edit.
 */
export const SWALLOWED = [
  "pointerdown",
  "mousedown",
  "mouseup",
  "pointerup",
  "contextmenu",
  "auxclick",
  "dragstart",
] as const;

/**
 * What should happen to a press, highest precedence first.
 *
 * - `ignore` — the editor's own chrome. Not ours to interfere with.
 * - `text` — inside a live in-place text edit.
 * - `drag` — a registered dnd-kit drag source.
 * - `swallow` — the host app, which is inert while editing.
 */
export type PressVerdict = "drag" | "ignore" | "swallow" | "text";

/**
 * Decide a press without needing an `EditGuard`.
 *
 * Split out because the precedence *is* the design and it was previously
 * implicit in the order of three early returns. Text outranks drag: a node can
 * be both — the reorder proxy sits over the selection, which is exactly the node
 * you are most likely to be editing — and treating that as a drag would kill the
 * default and take the caret away.
 *
 * Pure, so it can be tested without constructing an `EditGuard`, which
 * subscribes to the dnd-kit manager singleton at construction.
 */
export function pressVerdict(
  target: EventTarget | null,
  textNode: Element | null,
  pressThrough: readonly (() => Element | null)[]
): PressVerdict {
  if (isOwn(target)) {
    return "ignore";
  }
  if (textNode && isNode(target) && textNode.contains(target)) {
    return "text";
  }
  for (const provider of pressThrough) {
    const source = provider();
    if (source && isNode(target) && source.contains(target)) {
      return "drag";
    }
  }
  return "swallow";
}

export interface EditGuardOptions {
  /**
   * Intercept presses before the app can act on them.
   *
   * Needed for the inline overlay, where the editor shares a document with the
   * app: without it, pressing a button still gives it `:active`, moves focus and
   * runs any mousedown handler, so the page feels live while its clicks are
   * being stolen.
   *
   * Not needed on the canvas, and switched off there. Frames go
   * `pointer-events: none` in edit mode with a capture plane over them, so no
   * event reaches the app in the first place — a stronger guarantee than a list
   * of eight event types, and one that cannot be outflanked by a ninth.
   */
  swallowPresses: boolean;
}

/**
 * Keeps the host app inert while the overlay is in edit mode, and owns the two
 * pieces of drag bookkeeping that every surface would otherwise get wrong on its
 * own: the cursor, and the stray click a completed drag leaves behind.
 *
 * The cursor is not incidental. `document.body.style.cursor` loses to any
 * element-level `cursor: pointer`, so a link would still show a hand mid-drag;
 * driving it from a root attribute lets CSS win document-wide.
 */
export class EditGuard {
  private editing = false;
  /** Set on drag end so the synthetic click that follows can't re-select. */
  private swallowNextClick = false;
  /** Set on drag end so the Escape that caused it can't also deselect. */
  private recentDragEnd = false;
  /** Elements dnd-kit has sensors bound to, which must still see pointerdown. */
  private readonly pressThrough: (() => Element | null)[] = [];
  /** The node a live in-place text edit owns. See `allowTextOn`. */
  private textNode: Element | null = null;

  private readonly options: EditGuardOptions;

  constructor(options: EditGuardOptions) {
    this.options = options;
    // Every drag ends with a stray `click`, and it is never a selection intent.
    // Worse, it does not even report a sane target: while a drag is live the
    // pointer events retarget to <body>, so the click the browser synthesises
    // from the press and release lands on <body> — which the picker reads as
    // "clicked empty canvas" and answers by dropping the selection. Arm the
    // swallow centrally rather than per-surface so no drag can miss it.
    manager.monitor.addEventListener("dragend", () => {
      this.suppressNextClick();
      this.recentDragEnd = true;
      setTimeout(() => {
        this.recentDragEnd = false;
      });
    });
  }

  /**
   * Register an element that must keep receiving `pointerdown` even while
   * presses are being swallowed — dnd-kit's sensors bind element-level
   * listeners, which run after document capture, so stopping propagation there
   * would mean a drag could never start.
   *
   * **Pushes and never pops**, so it is only safe for a provider that lives as
   * long as the controller does. Its one caller registers the reorder proxy once
   * from the `DesignPanel` constructor. The text editor used to call this too,
   * once per `begin` and once per `teardown`, leaking a closure per edit that
   * every subsequent press then had to consult — hence `allowTextOn` below,
   * which is a slot rather than a list.
   */
  allowPressOn(provider: () => Element | null): void {
    this.pressThrough.push(provider);
  }

  /**
   * Hand the guard the node an in-place text edit owns, or null on exit.
   *
   * The two hatches are mirror images, and that is exactly why they cannot share
   * a branch:
   *
   * - `allowPressOn` kills the **default** and lets the event **propagate**,
   *   because dnd-kit's `PointerSensor` binds element-level listeners that run
   *   after document capture.
   * - This one preserves the **default** and stops **propagation**. Here the
   *   default *is* the feature: native caret placement, drag-to-select,
   *   double-click for a word, triple-click for a line. Routing text through
   *   `allowPressOn` is
   *   what used to make all four impossible, and — because a suppressed
   *   `mousedown` never moves focus — also meant `blur` never fired, so clicking
   *   away from an edit could not commit it. Stopping propagation is what keeps
   *   the app underneath inert: without it, pressing the text of a `<button>`
   *   submits the form you were trying to rename.
   */
  allowTextOn(node: Element | null): void {
    this.textNode = node;
  }

  /**
   * Is a drag in flight, or did one just end? Escape cancels a drag, and the
   * same keypress must not also clear the selection. Checking
   * `dragOperation.status` alone is not enough: dnd-kit's own cancel handler can
   * run first, so by the time the picker sees the keydown the drag is already
   * over. The trailing flag makes the answer independent of listener order.
   */
  get dragActive(): boolean {
    return manager.dragOperation.status.dragging || this.recentDragEnd;
  }

  setEditing(on: boolean): void {
    if (on === this.editing) {
      return;
    }
    this.editing = on;
    const root = document.documentElement;
    if (on) {
      root.setAttribute(`data-${PREFIX}-mode`, "edit");
    } else {
      root.removeAttribute(`data-${PREFIX}-mode`);
    }
    // `pointerdown` is bound in both configurations: even when nothing is being
    // swallowed, it is what tells the click-suppression flag that a fresh
    // gesture has begun.
    const types = this.options.swallowPresses
      ? SWALLOWED
      : (["pointerdown"] as const);
    for (const type of types) {
      if (on) {
        document.addEventListener(type, this.onPress, true);
      } else {
        document.removeEventListener(type, this.onPress, true);
      }
    }
  }

  /** Mark the drag state so CSS can own the cursor for the whole document. */
  setDragging(on: boolean, cursor?: string): void {
    const root = document.documentElement;
    if (on && cursor) {
      root.setAttribute(`data-${PREFIX}-drag`, cursor);
    } else {
      root.removeAttribute(`data-${PREFIX}-drag`);
    }
  }

  /**
   * Swallow the synthetic `click` that a completed drag leaves behind.
   *
   * The flag lives until the click arrives or the user starts a fresh gesture —
   * deliberately not a timer. A drag cancelled with Escape ends while the button
   * is still held, so its click can arrive arbitrarily later, whenever the user
   * gets around to releasing. Clearing on the next `pointerdown` (see `onPress`)
   * still guarantees it can never eat a real click, because a real click is
   * always preceded by its own press.
   */
  suppressNextClick(): void {
    this.swallowNextClick = true;
  }

  /** Called by the picker's click handler; true means "already handled". */
  consumeSuppressedClick(): boolean {
    if (!this.swallowNextClick) {
      return false;
    }
    this.swallowNextClick = false;
    return true;
  }

  /** Non-consuming read, for handlers that run after the picker's. */
  get clickSuppressed(): boolean {
    return this.swallowNextClick;
  }

  private readonly onPress = (e: Event): void => {
    // A fresh press means whatever click follows is the user's, not a drag's
    // leftover. Cleared before the bail-outs so it happens for every press,
    // wherever it lands.
    if (e.type === "pointerdown") {
      this.swallowNextClick = false;
    }
    if (!this.options.swallowPresses) {
      return;
    }
    switch (pressVerdict(e.target, this.textNode, this.pressThrough)) {
      case "ignore":
        break;
      case "text":
        // Default preserved — it is the caret. See `allowTextOn`.
        e.stopPropagation();
        break;
      case "drag":
        // The drag source stays reachable so dnd-kit's sensor can arm. Killing
        // the default still suppresses native image-drag and text selection.
        e.preventDefault();
        break;
      default:
        e.preventDefault();
        e.stopPropagation();
        break;
    }
  };
}
