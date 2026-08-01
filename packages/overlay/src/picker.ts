import type { ElementContext, SourceLocation } from "@airship/protocol";
import { BoxModelOverlay } from "./box-model";
import type { Point, Rect } from "./canvas/space";
import { type ChromeLayer, hide, place, placeLabel } from "./chrome-layer";
import {
  type Coordinates,
  DND,
  DndScope,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
} from "./dnd/manager";
import { cls, el, elementLabel, PREFIX } from "./dom";
import { EditGuard, isOwn } from "./edit-guard";
import { type Guide, GuideOverlay, marksFor } from "./guide-overlay";
import { constrain, shouldConstrain } from "./inspector/aspect";
import { ContextOutlines } from "./inspector/context-outlines";
import { MeasureOverlay } from "./inspector/measure-overlay";
import {
  type EdgeShift,
  type OriginStart,
  originDecls,
  readOrigin,
} from "./inspector/resize-origin";
import {
  availableModes,
  type ResizeMode,
  type Axis as SizeAxis,
  writeResize,
} from "./inspector/sizing";
import {
  type AxisSnapResult,
  contentRect,
  edgeTargets,
  SNAP_SCREEN_PX,
  type SnapTarget,
  sizeTargets,
  snapAxis,
} from "./inspector/snap";
import { isEditableText } from "./inspector/text-edit";
import { keys } from "./keys";
import {
  clipToSurface,
  localRect,
  type Surface,
  type SurfaceResolver,
} from "./surface";

export interface Selection {
  element: ElementContext;
  node: Element;
  /** Measured in the surface's own space — i.e. real CSS pixels, not zoomed. */
  rect: Rect;
  source: SourceLocation | null;
  /** Which frame (or, inline, which document) this node lives in. */
  surface: Surface;
}

/** A resolved hit: a page node and the surface it lives on. */
export interface Hit {
  node: Element;
  surface: Surface;
}

/** Which modifiers a gesture carried. `meta` folds in Ctrl for non-Mac. */
export interface Mods {
  meta: boolean;
  shift: boolean;
}

/** What `Surface.extract` resolves to — the component context and its origin. */
type ExtractedInfo = Awaited<ReturnType<Surface["extract"]>>;

/** The root attribute the cursor rules key off. See `setCursorHint`. */
const CURSOR_ATTR = `data-${PREFIX}-cursor`;

/** Shift extends, ⌘/Ctrl toggles — the pair every editor uses. */
function modeOf(e: MouseEvent): SelectMode {
  if (e.shiftKey) {
    return "add";
  }
  if (e.metaKey || e.ctrlKey) {
    return "toggle";
  }
  return "replace";
}

/** Node budget for one marquee sweep, and the most it will ever select. */
const MARQUEE_CAP = 4000;
const MAX_MARQUEE_SELECTION = 100;

/** The screen rect between two points, in either drag direction. */
function rectBetween(a: Point, b: Point): Rect {
  return {
    height: Math.abs(a.y - b.y),
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
  };
}

/**
 * How long a move onto an *ancestor* waits before it is believed, in ms.
 *
 * Sweeping across a row of siblings passes over the gaps between them, and in
 * those gaps the topmost element is the parent — so an unfiltered hover flashes
 * the container on and off between every pair of items, which reads as the
 * highlight being unable to make up its mind. Descending is never delayed —
 * going *into* something is always deliberate, and making that wait would show.
 */
const HOVER_ASCEND_DELAY = 50;

/** A live resize handle position (the 8 grips). */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandlePos = (typeof HANDLES)[number];

interface Handlers {
  /** Selection cleared via Esc or clicking empty canvas. */
  onDeselect?: () => void;
  /**
   * The additional nodes in a multi-selection changed.
   *
   * Separate from `onSelect` on purpose: the *primary* selection is what the
   * inspector reads its baseline values and source location from, and it keeps
   * its identity while nodes are added and removed around it. A design tool works the
   * same way — the panel shows one object's values with `Mixed` where the rest
   * of the selection disagrees.
   */
  onExtraChange?: (nodes: Element[]) => void;
  /**
   * A live resize drag on a selection handle.
   *
   * A declaration map rather than a width/height pair, because holding the edge
   * you are *not* dragging is not always a size change: an absolutely positioned
   * element needs its inset moved, and one in normal flow needs `translate`. See
   * `inspector/resize-origin.ts`. Every entry goes through the same recorder a
   * panel edit does, so the whole gesture stays one undo step.
   */
  onResize?: (node: Element, decls: Record<string, string>) => void;
  /**
   * Brackets a resize drag, so the whole gesture is one undo step rather than
   * one per pointermove — the same contract the inspector's scrub fields use.
   * `end` fires on cancel too; leaving it unbalanced would fold every later
   * edit into the same step.
   */
  onResizeEnd?: () => void;
  onResizeStart?: () => void;
  onSelect: (selection: Selection) => void;
  /**
   * A click landed away from a live in-place text edit.
   *
   * The app owns what happens next, because only it can commit — and it has to
   * commit *before* anything selects. `hit` is null over empty space. The
   * modifiers ride along so a shift-click still extends the selection rather
   * than starting a second edit.
   */
  onTextClickAway?: (hit: Hit | null, at: Point, mods: Mods) => void;
  /**
   * A double-click resolved to a node. Whether it means *text* is the app's
   * call: it holds the drill-down resolver and the editor, the picker holds only
   * the hit test.
   */
  onTextEnter?: (hit: Hit, at: Point) => void;
}

/** How a click combines with the current selection. */
export type SelectMode = "replace" | "add" | "toggle";

export interface SelectionDeps {
  /**
   * True while the canvas is being panned or zoomed. Hover highlighting is
   * suppressed for the duration — hit-testing into a frame that is sliding under
   * the cursor produces a strobe of highlights and a lot of wasted work.
   */
  isGesturing?: () => boolean;
  /** Where chrome is drawn. */
  layer: ChromeLayer;
  /** Resolves screen points and nodes to the surface they belong to. */
  resolver: SurfaceResolver;
  /** See `EditGuardOptions.swallowPresses` — true inline, false on the canvas. */
  swallowPresses: boolean;
}

/**
 * Everything a resize can snap to, measured once when the drag begins.
 *
 * Once, and deliberately: a resize *is* a layout change, so re-measuring the
 * siblings mid-gesture would have the element snapping to positions it had just
 * caused. The candidates are the layout as it stood before the drag, which is
 * the layout the user is aiming at.
 *
 * All in surface space, like the rects they came from.
 */
interface SnapCache {
  /** The element's own rect at drag start — the anchor edges come from it. */
  start: Rect;
  /** Alignment coordinates for a moving vertical / horizontal edge. */
  xEdges: SnapTarget[];
  /** Candidate widths and heights. */
  xSizes: SnapTarget[];
  yEdges: SnapTarget[];
  ySizes: SnapTarget[];
}

/** A width/height pair in surface px, before it becomes CSS. */
interface SizeBox {
  height: number;
  width: number;
}

/** What a snapped resize settled on, and whether either axis reached the parent. */
interface SnapOutcome {
  box: SizeBox;
  fillX: boolean;
  fillY: boolean;
}

interface ResizeState {
  handle: HandlePos;
  node: Element;
  /**
   * How the element is held in place, read once here.
   *
   * Latched rather than re-read per move for the same reason `startW` is: the
   * insets it describes are the ones this drag is writing to, so reading them
   * again mid-gesture would fold the previous frame's write into the next
   * frame's baseline and send the element accelerating off the screen.
   */
  origin: OriginStart;
  /** Screen px per surface px at drag start. */
  scale: number;
  startH: number;
  startW: number;
}

/**
 * Drives element selection for the visual editor. In edit mode the pointer is
 * live (design-tool auto-select): hovering highlights a candidate, clicking
 * selects it, and Esc or clicking empty space deselects — all without entering
 * a separate pick tool. A persistent selection outline tracks the chosen node
 * with DevTools-style identity labels and 8-handle resizing.
 * In view mode every capture listener is detached so the page is fully
 * interactive. The live `Element` is retained so the inspector can read computed
 * styles and apply inline previews.
 *
 * It never touches `event.target` to decide what is under the pointer. On the
 * canvas the pointer lands on a frame's capture plane, never on the app node
 * beneath it, so every hit-test goes through the surface — which converts the
 * screen point into the frame's own coordinates and asks *that* document. The
 * inline overlay resolves to a surface that does the same thing at 1:1, so both
 * modes run this one code path.
 */
export class SelectionController {
  readonly guard: EditGuard;

  private editing = false;
  private selected: Element | null = null;
  private selectedName: string | null = null;
  private surface: Surface | null = null;
  /**
   * The resolved context for `selected`, so re-selecting the same node can
   * re-emit synchronously instead of going back through `extract()`.
   */
  private selectedInfo: ExtractedInfo | null = null;
  /** Monotonic, so a slow `extract` for a stale click cannot win the race. */
  private selectGen = 0;
  private resize: ResizeState | null = null;
  /**
   * Live Shift state during a resize drag.
   *
   * dnd-kit's `onDragMove` hands over coordinates and nothing else, so the
   * modifier is tracked separately — and on key events rather than pointer ones,
   * so pressing or releasing Shift mid-drag takes effect immediately instead of
   * waiting for the next mouse move.
   */
  private shiftKey = false;
  /** Alt-hover spacing measurement. */
  private readonly measure: MeasureOverlay;
  /** Dotted outlines for the selection's parent and siblings. */
  private readonly context: ContextOutlines;
  /** Hatched padding / margin / gap, on Alt-hover. */
  private readonly boxModel: BoxModelOverlay;
  /** Red alignment guides, drawn while a resize is snapping. */
  private readonly guides: GuideOverlay;
  /** Snap candidates for the live resize, built once at drag start. */
  private snapCache: SnapCache | null = null;
  /** Pending ascent commit — see `HOVER_ASCEND_DELAY`. 0 when idle. */
  private ascendTimer = 0;
  /** Live Alt state, so pressing it re-runs the current hover without moving. */
  private altKey = false;
  /** The node under the pointer, for re-running a hover on a modifier change. */
  private hovered: Element | null = null;
  /**
   * The last screen point the pointer was seen at.
   *
   * Hover chrome is drawn in screen space over a canvas that moves independently
   * of the pointer: a wheel pan slides every frame under a stationary cursor and
   * fires no `mousemove` at all, so the only way to work out what is being
   * hovered afterwards is to re-hit-test the point we last saw. See `syncHover`.
   */
  private lastPointer: Point | null = null;
  /** Last drag delta, so a Shift press mid-drag can re-run the same move. */
  private lastDelta: Coordinates = { x: 0, y: 0 };
  private unbindKeys: (() => void) | null = null;
  private inspecting = false;
  /** The node a live in-place text edit owns, or null. See `setTextOwner`. */
  private textOwner: Element | null = null;
  /** Last value written to the cursor attribute, so a move is not a DOM write. */
  private cursorHint: string | null = null;
  /** The rest of a multi-selection. `selected` is always the primary. */
  private extra: Element[] = [];
  /** One hairline outline per additional node, pooled across renders. */
  private readonly extraBoxes: HTMLElement[] = [];
  /** Screen-space rubber band, live only while marquee-dragging. */
  private readonly marquee: HTMLElement;
  /** The eight resize grips' dnd-kit entities, torn down with the controller. */
  private readonly handleScope = new DndScope();
  private marqueeFrom: Point | null = null;

  private readonly hoverBox: HTMLElement;
  private readonly hoverLabel: HTMLElement;
  private readonly outline: HTMLElement;
  private readonly selLabel: HTMLElement;
  private readonly handles = new Map<string, HandlePos>();
  private readonly delta = new DragDelta();
  private readonly unsubscribe: (() => void)[] = [];

  private readonly handlers: Handlers;
  private readonly deps: SelectionDeps;

  constructor(handlers: Handlers, deps: SelectionDeps) {
    this.handlers = handlers;
    this.deps = deps;
    this.guard = new EditGuard({ swallowPresses: deps.swallowPresses });

    this.hoverBox = el("div", { class: `${cls("layer")} ${cls("hover-box")}` });
    // The labels are siblings of their boxes, not children. `place()` clips a
    // box to its frame and a clip-path applies to descendants, so a badge
    // hanging above its box was being cut in half by the very outline it names.
    this.hoverLabel = el("div", {
      class: `${cls("layer")} ${cls("box-label")}`,
    });
    hide(this.hoverLabel);
    this.hoverBox.style.display = "none";

    this.outline = el("div", { class: `${cls("layer")} ${cls("sel-box")}` });
    this.selLabel = el("div", { class: `${cls("layer")} ${cls("box-label")}` });
    hide(this.selLabel);
    for (const pos of HANDLES) {
      const h = el("div", {
        class: `${cls("handle")} ${cls(`handle-${pos}`)}`,
        "data-h": pos,
      });
      const id = `${DND.resizeHandle}:${pos}`;
      this.handles.set(id, pos);
      this.handleScope.add(
        new Draggable(
          {
            element: h,
            id,
            // Nothing to drop onto and nothing to translate — the handler turns
            // the drag delta into width/height. Feedback would move the grip.
            // (Axis locking is not a modifier: modifiers only shape
            // `dragOperation.transform`, which nothing reads under 'none'
            // feedback. The handler below takes the components it needs, which
            // is the same per-grip constraint by another route.)
            plugins: FEEDBACK.none,
            type: DND.resizeHandle,
          },
          manager
        )
      );
      this.outline.append(h);
    }
    this.outline.style.display = "none";

    this.marquee = el("div", { class: `${cls("layer")} ${cls("marquee")}` });
    hide(this.marquee);

    // Order is paint order at equal z-index: the labels go last so they draw
    // over both outlines rather than under whichever was appended after them.
    deps.layer.add(
      this.hoverBox,
      this.outline,
      this.marquee,
      this.hoverLabel,
      this.selLabel
    );
    this.measure = new MeasureOverlay(deps.layer);
    this.context = new ContextOutlines(deps.layer);
    this.boxModel = new BoxModelOverlay(deps.layer);
    this.guides = new GuideOverlay(deps.layer);
    window.addEventListener("scroll", this.refresh, true);
    window.addEventListener("resize", this.refresh, true);
    // Capture, and on both key events: a resize drag holds pointer capture, so
    // these never reach a bubbling listener, and the user expects Shift pressed
    // *during* the drag to constrain it without having to jiggle the mouse.
    window.addEventListener("keydown", this.onModifier, true);
    window.addEventListener("keyup", this.onModifier, true);

    this.unsubscribe.push(
      manager.monitor.addEventListener("dragstart", () => this.onDragStart()),
      manager.monitor.addEventListener("dragmove", (e) =>
        this.onDragMove(this.delta.update(e))
      ),
      manager.monitor.addEventListener("dragend", () => this.onDragEnd())
    );
  }

  get isEditing(): boolean {
    return this.editing;
  }

  /** The surface the current selection lives on, if any. */
  get activeSurface(): Surface | null {
    return this.surface;
  }

  get selectedNode(): Element | null {
    return this.selected;
  }

  /** Every selected node, primary first. */
  get selectedNodes(): Element[] {
    return this.selected ? [this.selected, ...this.extra] : [];
  }

  /**
   * Inspect mode: keep hovering and highlighting, stop selecting.
   *
   * Deliberately *not* the same switch as `setEditing`. View mode hands the page
   * back to the user entirely; Inspect keeps the page inert and the highlight
   * live, and only takes away the click — which is what lets you read specs off
   * a hover without your selection moving underneath the panel.
   */
  setInspecting(on: boolean): void {
    this.inspecting = on;
  }

  /**
   * Hand the picker the node an in-place text edit owns, or null on exit.
   *
   * Replaces a blanket `setSuspended`, which took the picker offline entirely
   * for the duration of an edit: a click on another layer, on empty space, or
   * anywhere at all did nothing, so the only way out of an edit was the
   * keyboard. The picker now stays live and declines exactly one thing — the
   * clicks that land *inside* the text, which is where the browser needs to be
   * left alone to place a caret. Everything else is a click-away, and the app
   * gets told so it can commit and move on.
   *
   * Drives the press guard from the same call, so the two can never disagree
   * about which node is being edited.
   */
  setTextOwner(node: Element | null): void {
    this.textOwner = node;
    this.guard.allowTextOn(node);
    if (node) {
      this.cancelAscent();
      hide(this.hoverBox);
      hide(this.hoverLabel);
      this.setCursorHint(null);
    }
  }

  /** Is this node the one being edited, or inside it? */
  private ownsPoint(node: Element): boolean {
    const owner = this.textOwner;
    return Boolean(owner && (owner === node || owner.contains(node)));
  }

  /**
   * Hit-test a screen point.
   *
   * Public because not every gesture arrives as a shell DOM event: while a frame
   * is live for a text edit, its own presses are reported up by the frame agent
   * and have to be resolved from a bare point. Same `pick` either way, which is
   * what keeps the two paths from drifting.
   */
  hitTest(point: Point): { node: Element; surface: Surface } | null {
    return this.pick(point);
  }

  /**
   * Ask CSS for a cursor over the whole document.
   *
   * `document.body.style.cursor` loses to any element-level `cursor: pointer`,
   * so a link would keep showing a hand over text you can edit. A root attribute
   * lets a stylesheet win instead — the same trick `EditGuard.setDragging` uses,
   * and for the same reason. Cached, because this is called from `mousemove`.
   */
  private setCursorHint(hint: string | null): void {
    if (hint === this.cursorHint) {
      return;
    }
    this.cursorHint = hint;
    const root = document.documentElement;
    if (hint) {
      root.setAttribute(CURSOR_ATTR, hint);
    } else {
      root.removeAttribute(CURSOR_ATTR);
    }
  }

  /** Enter or leave edit (auto-select) mode. Edit mode keeps the pointer hooks
   * attached so hovering highlights and clicks select; view mode detaches them
   * so the page is fully interactive. */
  setEditing(on: boolean): void {
    if (on === this.editing) {
      return;
    }
    this.editing = on;
    this.guard.setEditing(on);
    if (on) {
      document.addEventListener("mousemove", this.onMove, true);
      document.addEventListener("click", this.onClick, true);
      document.addEventListener("dblclick", this.onDblClick, true);
      window.addEventListener("pointerdown", this.onMarqueeDown, true);
      window.addEventListener("pointermove", this.onMarqueeMove);
      window.addEventListener("pointerup", this.onMarqueeUp);
      this.unbindKeys = keys.bind({
        keys: "escape",
        label: "Deselect",
        run: () => this.deselect(),
        // Escape belongs to the drag while one is in flight — it cancels the
        // operation, and deselecting on the same keypress would tear down the
        // very element the drag was moving. Declared as a guard rather than an
        // early return inside `run` so the registry can fall through to any
        // lower binding on Escape instead of swallowing the key.
        when: () => !this.guard.dragActive && this.selected !== null,
      });
    } else {
      hide(this.hoverBox);
      hide(this.hoverLabel);
      // Leaving edit mode invalidates the point as much as the chrome: coming
      // back should hover whatever is under the pointer *then*, not replay a
      // hit-test from before the page was handed back to the user.
      this.lastPointer = null;
      this.setCursorHint(null);
      document.removeEventListener("mousemove", this.onMove, true);
      document.removeEventListener("click", this.onClick, true);
      document.removeEventListener("dblclick", this.onDblClick, true);
      window.removeEventListener("pointerdown", this.onMarqueeDown, true);
      window.removeEventListener("pointermove", this.onMarqueeMove);
      window.removeEventListener("pointerup", this.onMarqueeUp);
      this.marqueeFrom = null;
      hide(this.marquee);
      this.unbindKeys?.();
      this.unbindKeys = null;
    }
  }

  /** Programmatically select a node (e.g. from the component tree). */
  select(node: Element, surface?: Surface, mode: SelectMode = "replace"): void {
    const target = surface ?? this.deps.resolver.of(node);
    if (!target) {
      return;
    }
    if (mode !== "replace" && this.selected) {
      this.combine(node, mode);
      return;
    }
    this.setExtra([]);

    /*
     * Re-selecting what is already selected takes the synchronous path.
     *
     * Clicking the selected element again used to be a no-op — the click
     * handler compared node identity and returned — so there was no way to make
     * the panel re-read an element whose values had drifted. Now it re-emits,
     * and it does so without going back through `extract()`: the resolved
     * context is cached and the round trip would only make the panel flicker.
     */
    const cached = this.selectedInfo;
    if (node === this.selected && this.surface === target && cached) {
      this.emitSelect(node, target, cached);
      return;
    }

    /*
     * A generation guard, because `extract` is async.
     *
     * Click A then B faster than A resolves and A's `.then` used to land last,
     * leaving `selected`, the outline and the whole panel on the element you
     * had already moved off. `selected` and `surface` are also assigned *before*
     * the await so `onClick`'s identity comparison and `drawOutline` are never
     * a frame behind the pointer.
     */
    this.selectGen += 1;
    const gen = this.selectGen;
    this.selected = node;
    this.surface = target;
    this.selectedName = elementLabel(node);
    this.drawOutline();
    target.extract(node).then((info) => {
      if (gen !== this.selectGen) {
        return;
      }
      this.selectedInfo = info;
      this.selectedName = info.context.displayName || elementLabel(node);
      this.drawOutline();
      this.emitSelect(node, target, info);
    });
  }

  private emitSelect(
    node: Element,
    surface: Surface,
    info: ExtractedInfo
  ): void {
    this.handlers.onSelect({
      element: info.context,
      node,
      // Re-measured on every emit rather than reused from the cache: a
      // re-selection is often *because* something moved.
      rect: localRect(node),
      source: info.source,
      surface,
    });
  }

  clearSelection(): void {
    this.selected = null;
    this.selectedName = null;
    this.surface = null;
    this.selectedInfo = null;
    // Invalidates any `extract` still in flight, so a resolution that lands
    // after a deselect cannot quietly select something again.
    this.selectGen += 1;
    hide(this.outline);
    hide(this.selLabel);
    this.context.hide();
  }

  /**
   * Add or remove a node from the selection, keeping the primary.
   *
   * Removing the primary promotes the first extra rather than clearing — losing
   * the whole selection because you shift-clicked the wrong node twice is the
   * kind of thing that makes people stop using multi-select.
   */
  private combine(node: Element, mode: SelectMode): void {
    if (node === this.selected) {
      if (mode === "toggle" && this.extra.length) {
        const [next, ...rest] = this.extra;
        this.setExtra(rest);
        this.select(next);
      }
      return;
    }
    const at = this.extra.indexOf(node);
    if (at !== -1) {
      if (mode === "toggle") {
        this.setExtra(this.extra.filter((n) => n !== node));
      }
      return;
    }
    this.setExtra([...this.extra, node]);
  }

  private setExtra(nodes: Element[]): void {
    this.extra = nodes;
    this.drawExtras();
    this.handlers.onExtraChange?.(nodes);
  }

  /** Deselect (Esc / click empty canvas) without leaving edit mode. */
  deselect(): void {
    this.setExtra([]);
    this.clearSelection();
    this.handlers.onDeselect?.();
  }

  /**
   * Hairline outlines for the additional nodes.
   *
   * Deliberately lighter than the primary's: the panel is showing *its* values,
   * so which one is primary has to be visible. A design tool draws the same distinction.
   */
  private drawExtras(): void {
    const { surface } = this;
    while (this.extraBoxes.length < this.extra.length) {
      const box = el("div", { class: `${cls("layer")} ${cls("extra-box")}` });
      this.deps.layer.add(box);
      this.extraBoxes.push(box);
    }
    this.extraBoxes.forEach((box, i) => {
      const node = this.extra[i];
      if (!(node?.isConnected && surface?.isLive)) {
        hide(box);
        return;
      }
      const screen = surface.toScreen(localRect(node));
      place(box, screen, clipToSurface(surface, screen));
    });
  }

  /** Reposition the selection outline + handles + label (after layout changes). */
  drawOutline(): void {
    this.drawExtras();
    const { surface } = this;
    if (!(this.selected?.isConnected && surface?.isLive)) {
      hide(this.outline);
      hide(this.selLabel);
      this.context.hide();
      return;
    }
    const local = localRect(this.selected);
    const box = surface.toScreen(local);
    place(this.outline, box, clipToSurface(surface, box));
    const name = this.selectedName ?? elementLabel(this.selected);
    // The label reports the element's own size, not its on-screen size: the CSS
    // width you are about to edit is 200px whether you are at 25% or 300%.
    this.selLabel.textContent = `${name} · ${Math.round(local.width)}×${Math.round(local.height)}`;
    placeLabel(this.selLabel, box, surface.bounds()?.top ?? 0);
    this.drawContext();
  }

  /** Hide the hover highlight (e.g. when a gesture or drag takes over). */
  clearHover(): void {
    this.cancelAscent();
    this.hovered = null;
    this.setCursorHint(null);
    this.measure.hide();
    // The box model is drawn for the *hovered* element, so it goes with it. It
    // is easy to miss because it is only ever visible with Alt held, and letting
    // it survive leaves hatching over an element the pointer has left.
    this.boxModel.hide();
    hide(this.hoverBox);
    hide(this.hoverLabel);
    this.drawContext();
  }

  /**
   * Redraw the dotted structural outlines.
   *
   * Driven from one place rather than from the selection and hover paths
   * separately, because the two rules are coupled: the siblings are drawn only
   * when the hovered node is an ancestor of the *selected* one, so a change to
   * either has to re-evaluate both.
   */
  private drawContext(): void {
    // Nothing structural while a gesture is running. The rects these outlines
    // were measured from are exactly the ones a drag is in the middle of
    // changing — the siblings are sitting on transforms, and the dragged element
    // is hidden — so they would be drawing a layout that is no longer true. The
    // ghost and the displacement are the feedback for that moment anyway.
    if (this.guard.dragActive) {
      this.context.hide();
      return;
    }
    this.context.show(this.selected, this.hovered, this.surface);
  }

  destroy(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    window.removeEventListener("scroll", this.refresh, true);
    window.removeEventListener("resize", this.refresh, true);
    window.removeEventListener("keydown", this.onModifier, true);
    window.removeEventListener("keyup", this.onModifier, true);
    this.cancelAscent();
    this.measure.destroy();
    this.context.destroy();
    this.boxModel.destroy();
    this.guides.destroy();
    this.hoverBox.remove();
    this.hoverLabel.remove();
    this.outline.remove();
    this.selLabel.remove();
    this.marquee.remove();
    for (const box of this.extraBoxes) {
      box.remove();
    }
    this.extraBoxes.length = 0;
    this.handleScope.clear();
  }

  /** Track Shift for the resize constraint, and re-run the drag if it changed. */
  private readonly onModifier = (e: KeyboardEvent): void => {
    // A modifier pressed while typing is a character, not a gesture. Option-E
    // for an accented `e` would otherwise flip `altKey` and paint a spacing
    // measurement across the text you are in the middle of editing.
    if (this.textOwner) {
      return;
    }
    if (e.key === "Alt" && this.altKey !== e.altKey) {
      this.altKey = e.altKey;
      // Re-run against the node already under the pointer: the user pressed
      // Alt to *see* the measurement, and requiring a mouse jiggle to make it
      // appear would read as the feature being broken.
      const surface = this.hovered ? this.deps.resolver.of(this.hovered) : null;
      if (this.hovered && surface) {
        this.drawMeasure(this.hovered, surface);
      }
      return;
    }
    if (e.key !== "Shift" || this.shiftKey === e.shiftKey) {
      return;
    }
    this.shiftKey = e.shiftKey;
    if (this.resize) {
      this.onDragMove(this.lastDelta);
    }
  };

  private readonly refresh = (): void => {
    if (this.selected) {
      this.drawOutline();
    }
    // The highlight has exactly the problem the outline used to: a scroll moves
    // the element out from under a stationary pointer, and nothing else redraws
    // it. Inline, this is the whole of the ghost-outline fix.
    this.syncHover();
  };

  /**
   * Resolve what is under a screen point. Returns null over empty canvas, and
   * also for a surface's own `<body>`/`<html>`, which read as "nothing" rather
   * than as a selectable element — clicking the page background should clear the
   * selection, not select the page.
   */
  private pick(point: Point): { node: Element; surface: Surface } | null {
    const surface = this.deps.resolver.at(point);
    if (!surface?.isLive) {
      return null;
    }
    const node = surface.elementAtScreen(point);
    if (
      !node ||
      isOwn(node) ||
      node === surface.doc.body ||
      node === surface.doc.documentElement
    ) {
      return null;
    }
    return { node, surface };
  }

  /**
   * Marquee (rubber-band) select.
   *
   * Armed by a press that lands on nothing — clicking empty canvas already
   * meant "deselect", so a drag from there is unambiguous and needs no modifier
   * and no tool. Bound at the window in capture phase for the same reason the
   * viewport's gestures are: everything the editor paints is a potential dead
   * zone otherwise.
   */
  private readonly onMarqueeDown = (e: PointerEvent): void => {
    if (
      // Disabled outright during an edit, not merely routed like the click. A
      // rubber band that begins by ending your edit is not a gesture anyone
      // means, and the press that would arm it is far more often a drag-select
      // across the text.
      this.textOwner !== null ||
      this.inspecting ||
      e.button !== 0 ||
      isOwn(e.target) ||
      this.guard.dragActive
    ) {
      return;
    }
    if (this.pick({ x: e.clientX, y: e.clientY })) {
      return;
    }
    this.marqueeFrom = { x: e.clientX, y: e.clientY };
  };

  private readonly onMarqueeMove = (e: PointerEvent): void => {
    const from = this.marqueeFrom;
    if (!from) {
      return;
    }
    const box = rectBetween(from, { x: e.clientX, y: e.clientY });
    // Below the threshold this is still a click; showing a 2px band would make
    // every deselect flicker.
    if (box.width < 4 && box.height < 4) {
      return;
    }
    place(this.marquee, box);
  };

  private readonly onMarqueeUp = (e: PointerEvent): void => {
    const from = this.marqueeFrom;
    this.marqueeFrom = null;
    hide(this.marquee);
    if (!from) {
      return;
    }
    const box = rectBetween(from, { x: e.clientX, y: e.clientY });
    if (box.width < 4 && box.height < 4) {
      return;
    }
    const hits = this.nodesIn(box);
    if (!hits.length) {
      return;
    }
    const [first, ...rest] = hits;
    this.select(first, this.deps.resolver.of(first) ?? undefined);
    // `select` resolves asynchronously (it extracts the component context), so
    // the rest go on after it rather than being wiped by its own reset.
    queueMicrotask(() => this.setExtra(rest));
  };

  /**
   * Elements whose screen rect intersects the band.
   *
   * Only *leaf-ish* nodes are considered — an ancestor always intersects
   * anything its children do, so including them would select the whole tree on
   * every drag. Capped, because a marquee across a large app can otherwise walk
   * tens of thousands of nodes.
   */
  private nodesIn(box: Rect): Element[] {
    const surface =
      this.surface ??
      this.deps.resolver.at({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
    if (!surface?.isLive) {
      return [];
    }
    const out: Element[] = [];
    const all = surface.doc.body?.querySelectorAll("*") ?? [];
    for (const node of Array.from(all).slice(0, MARQUEE_CAP)) {
      if (isOwn(node) || node.children.length > 0) {
        continue;
      }
      const screen = surface.toScreen(localRect(node));
      if (
        screen.left < box.left + box.width &&
        screen.left + screen.width > box.left &&
        screen.top < box.top + box.height &&
        screen.top + screen.height > box.top
      ) {
        out.push(node);
      }
      if (out.length >= MAX_MARQUEE_SELECTION) {
        break;
      }
    }
    return out;
  }

  private readonly onMove = (e: MouseEvent): void => {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.cancelAscent();
    if (isOwn(e.target) || this.deps.isGesturing?.()) {
      this.clearHover();
      return;
    }
    const found = this.pick(this.lastPointer);
    // Moving *out* to an ancestor is usually the pointer crossing the gap
    // between two siblings rather than an intention to hover the container, so
    // it has to hold still for a moment to be believed. `repick` re-hit-tests
    // when the timer fires — it does not replay this result — so a pointer that
    // has moved on in the meantime resolves to wherever it actually is.
    if (found && this.hovered && isAscent(found.node, this.hovered)) {
      this.ascendTimer = window.setTimeout(() => {
        this.ascendTimer = 0;
        this.repick();
      }, HOVER_ASCEND_DELAY);
      return;
    }
    this.applyHover(found);
  };

  private cancelAscent(): void {
    if (this.ascendTimer) {
      clearTimeout(this.ascendTimer);
      this.ascendTimer = 0;
    }
  }

  /**
   * Re-anchor the hover chrome over the node it is already on.
   *
   * The counterpart to `drawOutline` for the highlight, and for a long time it
   * simply did not exist: hover was only ever drawn from a `mousemove`, and a
   * wheel pan slides every frame under a stationary cursor without producing
   * one. The box stayed painted at its pre-pan screen rect — a ghost outline
   * over an element that had left, which is what the user was seeing.
   *
   * Deliberately does **not** hit-test. During a pan the highlight should stay
   * glued to its element and travel with the content, which is both what the eye
   * expects and free; re-resolving what is under the cursor mid-gesture is the
   * strobe `isGesturing` exists to prevent. `repick` is the other half.
   */
  syncHover(): void {
    if (!this.editing || this.resize || this.guard.dragActive) {
      return;
    }
    const node = this.hovered;
    const surface = node ? this.deps.resolver.of(node) : null;
    if (!(node?.isConnected && surface?.isLive) || this.ownsPoint(node)) {
      this.clearHover();
      return;
    }
    const box = surface.toScreen(localRect(node));
    place(this.hoverBox, box, clipToSurface(surface, box));
    placeLabel(this.hoverLabel, box, surface.bounds()?.top ?? 0);
    this.drawMeasure(node, surface);
    this.drawContext();
  }

  /**
   * Re-resolve what is under the pointer without the pointer having moved.
   *
   * Called on the trailing edge of a pan or zoom: the gesture is over, the
   * cursor is where it always was, but the canvas moved beneath it and a
   * different element is now under it. Waiting for a `mousemove` to notice would
   * leave the highlight on whatever happened to be there before.
   */
  repick(): void {
    if (
      !(this.editing && this.lastPointer) ||
      this.resize ||
      this.guard.dragActive
    ) {
      return;
    }
    if (this.deps.isGesturing?.()) {
      this.clearHover();
      return;
    }
    this.applyHover(this.pick(this.lastPointer));
  }

  /** Draw (or clear) the hover box for a resolved hit. */
  private applyHover(found: { node: Element; surface: Surface } | null): void {
    // Inside the text being edited there is nothing to highlight — you are not
    // choosing a layer, you are placing a caret. Filtered here rather than in
    // each caller so `onMove`, `syncHover` and `repick` cannot disagree.
    if (!found || this.ownsPoint(found.node)) {
      this.clearHover();
      return;
    }
    // A text cursor over anything you could edit, so double-click reads as
    // available rather than as something you have to already know about.
    this.setCursorHint(isEditableText(found.node) ? "text" : null);
    // Re-measure on every move even when the node is unchanged: on the canvas
    // the pointer can sit still while the element under it moves — a pan, a
    // zoom, or the app re-rendering — and the highlight has to follow it.
    this.hoverLabel.textContent = elementLabel(found.node);
    const box = found.surface.toScreen(localRect(found.node));
    place(this.hoverBox, box, clipToSurface(found.surface, box));
    placeLabel(this.hoverLabel, box, found.surface.bounds()?.top ?? 0);
    this.hovered = found.node;
    this.drawMeasure(found.node, found.surface);
    this.drawContext();
  }

  /**
   * The Alt-hover spacing view: distances, and the box model behind them.
   *
   * Two halves of one answer. The measurement lines say how far apart two things
   * are; the hatching says which of them is holding the space — a gap that turns
   * out to be the container's padding is a different edit from one that is the
   * element's own margin, and the number alone cannot tell you which.
   *
   * The distances need a selection to measure *from*; the box model does not, so
   * it shows on any Alt-hover. Requiring a selection for it would mean the first
   * thing you try — hold Alt, point at something — does nothing.
   */
  private drawMeasure(hovered: Element, surface: Surface): void {
    if (!this.altKey) {
      this.measure.hide();
      this.boxModel.hide();
      return;
    }
    this.boxModel.show(hovered, surface);
    if (this.selected) {
      this.measure.show(this.selected, hovered, surface);
    } else {
      this.measure.hide();
    }
  }

  private readonly onClick = (e: MouseEvent): void => {
    // Inspect reports rather than selects.
    if (this.inspecting || isOwn(e.target)) {
      return;
    }
    // A drag leaves a synthetic click whose target is the common ancestor of
    // the press and release — letting it through would silently re-select an
    // unrelated node, or hit <body> and tear the whole selection down.
    if (this.guard.consumeSuppressedClick()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const at = { x: e.clientX, y: e.clientY };
    const found = this.pick(at);
    if (this.textOwner) {
      this.routeTextClick(e, found, at);
      return;
    }
    // Clicking blank canvas or a frame's own background deselects.
    if (!found) {
      this.deselect();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // No identity guard. Clicking the selected element again used to do
    // nothing at all, which meant there was no gesture that made the panel
    // re-read an element whose values had drifted — and "click it again" is the
    // first thing anyone tries. `select` has a synchronous fast path for
    // exactly this case, so the re-emit costs a measurement, not a round trip.
    this.select(found.node, found.surface, modeOf(e));
  };

  /**
   * A click that arrived while an in-place text edit was live.
   *
   * Two outcomes, and the split is the whole of sticky text mode. Inside the
   * text the browser owns the gesture: `stopPropagation` without
   * `preventDefault`, because the default action *is* the caret (and the drag,
   * and the double-click word) while the propagation is the app's own handler on
   * the button you are renaming. Anywhere else it is a click-away — swallowed
   * here, and handed to the app, which is the only layer that can commit the
   * edit before deciding what the click meant.
   */
  private routeTextClick(e: MouseEvent, found: Hit | null, at: Point): void {
    if (found && this.ownsPoint(found.node)) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.handlers.onTextClickAway?.(found, at, {
      meta: e.metaKey || e.ctrlKey,
      shift: e.shiftKey,
    });
  }

  /**
   * Double-click to edit text in place — the design-tool gesture, and the only one that
   * reaches a string without going through the toolbar.
   *
   * The picker owns `dblclick` outright (it is out of `EditGuard`'s `SWALLOWED`
   * for exactly that reason), so it swallows **before** deciding anything:
   * declining to act must not hand the gesture back to the app, which would
   * expand-select a word in a page that is supposed to be inert. The `isOwn`
   * check comes first so the docks' own double-click-to-reset still works.
   *
   * What a hit *means* is the app's call, not the picker's — it holds the
   * drill-down resolver and the editor; this holds only the hit test.
   */
  private readonly onDblClick = (e: MouseEvent): void => {
    if (isOwn(e.target)) {
      return;
    }
    const at = { x: e.clientX, y: e.clientY };
    const found = this.pick(at);
    // Inside an edit already, a double-click means "select this word" — the same
    // split `routeTextClick` makes, and for the same reason: the default action
    // *is* the feature. Propagation is stopped, the default is not. Re-entering
    // here would throw the word selection away and leave a bare caret instead.
    if (found && this.ownsPoint(found.node)) {
      e.stopPropagation();
      return;
    }
    // Everything else is swallowed whether or not it leads anywhere, and that is
    // deliberate rather than incidental: `dblclick` used to be one of
    // `EditGuard`'s `SWALLOWED` types, so every edit-mode state kept it off the
    // app. Declining to act — in Inspect, or over a node with no text — must not
    // quietly hand the gesture back, or an inert page starts expand-selecting
    // words under the pointer.
    e.preventDefault();
    e.stopPropagation();
    if (this.inspecting || !found) {
      return;
    }
    this.handlers.onTextEnter?.(found, at);
  };

  // -- Resize handles --------------------------------------------------------

  private onDragStart(): void {
    const { source } = manager.dragOperation;
    const pos = source ? this.handles.get(String(source.id)) : undefined;
    const node = this.selected;
    if (!(pos && node)) {
      return;
    }
    const r = localRect(node);
    this.resize = {
      handle: pos,
      node,
      origin: readOrigin(node),
      // Latched at drag start: a zoom mid-drag would otherwise change how far
      // the element moves per pixel of pointer travel, halfway through.
      scale: this.surface?.scale ?? 1,
      startH: r.height,
      startW: r.width,
    };
    this.measure.hide();
    this.boxModel.hide();
    this.snapCache = this.buildSnapCache(node, r);
    this.delta.start();
    this.handlers.onResizeStart?.();
    this.guard.setDragging(true, cursorFor(pos));
  }

  /**
   * Measure everything the drag can snap to, before it changes anything.
   *
   * The parent's *content* box rather than its border box: padding is not space
   * a child can grow into, so snapping to the outer edge would stop the element
   * short of where it appears to be going, by exactly the padding.
   */
  private buildSnapCache(node: Element, start: Rect): SnapCache | null {
    const parent = node.parentElement;
    if (!parent) {
      return null;
    }
    const content = contentRect(parent);
    const siblings = Array.from(parent.children)
      .filter((child) => child !== node && !isOwn(child))
      .map(localRect);
    return {
      start,
      xEdges: edgeTargets(content, siblings, true),
      xSizes: sizeTargets(content, siblings, true),
      yEdges: edgeTargets(content, siblings, false),
      ySizes: sizeTargets(content, siblings, false),
    };
  }

  private onDragMove(d: Coordinates): void {
    const rz = this.resize;
    if (!rz) {
      return;
    }
    // The pointer moves in screen pixels; the CSS being written is in the
    // surface's own pixels. At 50% zoom a 100px drag is a 200px element.
    this.lastDelta = d;
    const dx = d.x / rz.scale;
    const dy = d.y / rz.scale;
    // The grip name is the axis constraint: an "e" grip only reads x, an "s"
    // grip only reads y, and a corner reads both.
    let width = rz.startW;
    let height = rz.startH;
    if (rz.handle.includes("e")) {
      width = Math.max(1, rz.startW + dx);
    } else if (rz.handle.includes("w")) {
      width = Math.max(1, rz.startW - dx);
    }
    if (rz.handle.includes("s")) {
      height = Math.max(1, rz.startH + dy);
    } else if (rz.handle.includes("n")) {
      height = Math.max(1, rz.startH - dy);
    }

    // Proportional resize is applied to the raw drag, before anything rounds
    // it — rounding first would let the ratio drift measurably over a long drag.
    const holding = shouldConstrain(rz.node, rz.handle, this.shiftKey);
    const raw = holding
      ? constrain(width, height, rz.startW / rz.startH, rz.handle)
      : { height, width };

    // Snapping comes after the aspect lock, not before: the lock is a hard
    // constraint the user asked for and the snap is a suggestion, so a snap that
    // would break the ratio is one we decline to make. It is skipped entirely
    // while the ratio holds, for the same reason — moving one axis onto a
    // sibling's edge would drag the other axis off wherever it was.
    // Snapping is skipped entirely while the ratio holds, so the guides have to
    // be taken down explicitly here — pressing Shift mid-drag re-runs this move
    // (see `onModifier`), and without this the line from the last free frame
    // would stay on screen claiming an alignment the lock has since broken.
    let box = raw;
    let snapped: SnapOutcome | null = null;
    if (holding) {
      this.guides.hide();
    } else {
      snapped = this.applySnap(rz, raw);
      box = snapped?.box ?? raw;
    }

    // What the undragged edges need in order to stay where they are. Measured
    // from the *final* box rather than the raw pointer delta, so a
    // Shift-constrained drag reports the edge travel the aspect lock actually
    // produced instead of the travel the pointer asked for.
    const origin = originDecls(rz.origin, edgeShift(rz, box));

    const decls: Record<string, string> = {};
    // While the ratio holds, an edge drag writes *both* dimensions — that is
    // what proportional means, and writing only the dragged axis would leave the
    // element the wrong shape with the outline claiming otherwise.
    const widthDragged =
      holding || rz.handle.includes("e") || rz.handle.includes("w");
    const heightDragged =
      holding || rz.handle.includes("n") || rz.handle.includes("s");
    if (widthDragged && !origin.skipWidth) {
      Object.assign(
        decls,
        this.sizeDecls(rz.node, "w", box.width, snapped?.fillX)
      );
    }
    if (heightDragged && !origin.skipHeight) {
      Object.assign(
        decls,
        this.sizeDecls(rz.node, "h", box.height, snapped?.fillY)
      );
    }
    Object.assign(decls, origin.decls);
    if (Object.keys(decls).length > 0) {
      this.handlers.onResize?.(rz.node, decls);
      this.drawOutline();
    }
  }

  /**
   * Pull the dragged edges onto nearby alignments, and draw what they landed on.
   *
   * The tolerance is the one place canvas zoom enters this calculation. It is a
   * fact about the *pointer* — how close is close enough to mean it — so it is
   * declared in screen pixels and divided into surface pixels here. Left as a
   * surface constant it would be a fifth of a pixel at 10% zoom, where nothing
   * ever snaps, and twenty at 400%, where nothing ever gets away.
   */
  private applySnap(rz: ResizeState, raw: SizeBox): SnapOutcome | null {
    const cache = this.snapCache;
    if (!cache) {
      this.guides.hide();
      return null;
    }
    const threshold = SNAP_SCREEN_PX / (this.surface?.scale ?? 1);
    // Which edge moves is the grip's own name, and the opposite one is the
    // anchor — which holds still, because `resize-origin.ts` makes it hold
    // still. An axis the grip does not name is not snapped; its size did not
    // change, so there is nothing to pull.
    const x = snapAxis({
      anchor:
        cache.start.left + (rz.handle.includes("w") ? cache.start.width : 0),
      edges: cache.xEdges,
      forward: rz.handle.includes("e"),
      size: raw.width,
      sizes: cache.xSizes,
      threshold:
        rz.handle.includes("e") || rz.handle.includes("w") ? threshold : 0,
    });
    const y = snapAxis({
      anchor:
        cache.start.top + (rz.handle.includes("n") ? cache.start.height : 0),
      edges: cache.yEdges,
      forward: rz.handle.includes("s"),
      size: raw.height,
      sizes: cache.ySizes,
      threshold:
        rz.handle.includes("n") || rz.handle.includes("s") ? threshold : 0,
    });

    const box = { height: y.size, width: x.size };
    // The element's rect *after* the snap, so its own marks land on the edges it
    // is about to have rather than the ones it had a frame ago.
    const self = sizedRect(cache.start, rz.handle, box);
    this.drawGuides(
      [this.guideFor(x, "x", self), this.guideFor(y, "y", self)].filter(
        (g): g is Guide => g !== null
      )
    );
    return { box, fillX: x.fill, fillY: y.fill };
  }

  /**
   * The declarations for one axis of the new size.
   *
   * A snap onto the parent's own content extent is written as **Fill**, not as
   * the pixel number that happens to match it today. Dragging an element out to
   * the edges of its container is how anyone says "this should fill the row",
   * and freezing that intent at 847px means the layout stops responding the
   * moment the container changes — which is exactly the bug the person was
   * dragging to avoid. `writeResize` already knows what Fill means in a flex
   * main axis, a flex cross axis and ordinary flow; this only decides *when*.
   */
  private sizeDecls(
    node: Element,
    axis: SizeAxis,
    length: number,
    fill: boolean | undefined
  ): Record<string, string> {
    const px = `${Math.max(1, Math.round(length))}px`;
    const mode: ResizeMode =
      fill && availableModes(node, axis).includes("fill") ? "fill" : "fixed";
    const out: Record<string, string> = {};
    for (const decl of writeResize(node, axis, mode, px)) {
      out[decl.property] = decl.value;
    }
    return out;
  }

  /**
   * Turn an edge match into a guide line, in screen coordinates.
   *
   * Only edge matches draw one. A size match means "as wide as that" rather than
   * "in line with that", and there is no single coordinate a line could sit at
   * to say so — drawing one at the matched element would claim an alignment that
   * is not being made. The dotted parent outline already answers the fill case.
   */
  private guideFor(
    snap: AxisSnapResult,
    axis: "x" | "y",
    self: Rect
  ): Guide | null {
    const { surface } = this;
    const { match } = snap;
    if (!(match && surface) || match.kind !== "edge") {
      return null;
    }
    const target = surface.toScreen(match.target.rect);
    const own = surface.toScreen(self);
    const at = axis === "x" ? "left" : "top";
    // The line's own coordinate goes through the same conversion as the rects,
    // as a degenerate rect — doing the arithmetic by hand here is how a guide
    // ends up half a frame's scroll away from the edge it claims to be on.
    const pos = surface.toScreen({
      height: 0,
      left: axis === "x" ? match.target.value : 0,
      top: axis === "x" ? 0 : match.target.value,
      width: 0,
    })[at];
    return {
      axis,
      marks: [
        ...marksFor(target, axis, match.target.center),
        ...marksFor(own, axis, false),
      ],
      pos,
    };
  }

  private drawGuides(guides: Guide[]): void {
    if (guides.length === 0 || !this.surface) {
      this.guides.hide();
      return;
    }
    this.guides.show(guides, this.surface);
  }

  private onDragEnd(): void {
    if (!this.resize) {
      return;
    }
    this.resize = null;
    this.snapCache = null;
    this.guides.hide();
    this.handlers.onResizeEnd?.();
    this.guard.setDragging(false);
  }
}

/**
 * How far each edge travelled, given the size the drag settled on.
 *
 * Only the grip's own edges move: an `e` drag moves the right edge and nothing
 * else, and under an aspect lock the growth on the other axis comes out of the
 * bottom — which is the convention every editor uses and what falls out of
 * leaving `top` and `bottom` at zero here.
 */
function edgeShift(
  rz: ResizeState,
  box: { height: number; width: number }
): EdgeShift {
  const dw = box.width - rz.startW;
  const dh = box.height - rz.startH;
  return {
    bottom: rz.handle.includes("s") ? dh : 0,
    // A west drag that grows the element by 20px moved its left edge 20px left.
    left: rz.handle.includes("w") ? -dw : 0,
    right: rz.handle.includes("e") ? dw : 0,
    top: rz.handle.includes("n") ? -dh : 0,
  };
}

/**
 * Where the element ends up, given a grip and a size.
 *
 * The anchored edge is the one opposite the grip — which is true because
 * `resize-origin.ts` makes it true. Keeping the two in agreement matters: this
 * rect is what the guide marks are drawn on, so if it disagreed with where the
 * element actually lands, the marks would sit beside the edges they claim.
 */
function sizedRect(
  start: Rect,
  handle: HandlePos,
  size: { height: number; width: number }
): Rect {
  return {
    height: size.height,
    left: handle.includes("w")
      ? start.left + start.width - size.width
      : start.left,
    top: handle.includes("n")
      ? start.top + start.height - size.height
      : start.top,
    width: size.width,
  };
}

/**
 * Is moving from `from` to `to` a move *outwards*, to an ancestor?
 *
 * Cross-realm safe by construction: `contains` is a same-document operation, and
 * two nodes in different frames simply answer `false` — which is the right
 * answer, since neither can be the other's ancestor.
 */
function isAscent(to: Element, from: Element): boolean {
  return to !== from && to.contains(from);
}

function cursorFor(pos: HandlePos): string {
  if (pos === "n" || pos === "s") {
    return "ns-resize";
  }
  if (pos === "e" || pos === "w") {
    return "ew-resize";
  }
  if (pos === "nw" || pos === "se") {
    return "nwse-resize";
  }
  return "nesw-resize";
}
