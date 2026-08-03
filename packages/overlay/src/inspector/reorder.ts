import type { Collision } from "@dnd-kit/abstract";
import { type BoundingRectangle, Rectangle } from "@dnd-kit/geometry";
import type { Point, Rect } from "../canvas/space";
import { type ChromeLayer, hide, place } from "../chrome-layer";
import {
  type Coordinates,
  DND,
  DragDelta,
  Draggable,
  Droppable,
  FEEDBACK,
  hit,
  manager,
} from "../dnd/manager";
import { cls, el } from "../dom";
import { isOwn } from "../edit-guard";
import { computedStyle } from "../realm";
import { DRAGGING_CLASS } from "../styles/portable.css";
import { clipToSurface, localRect, type Surface } from "../surface";
import { SiblingDisplacer } from "./displace";
import { DragGhost } from "./drag-ghost";

/** A finished drag: enough for the panel to resolve source and record a move. */
export interface CompletedMove {
  /** The sibling it now precedes; null ⇒ appended as last child. */
  before: Element | null;
  /** Where it landed. */
  newParent: Element;
  node: Element;
  origNext: Node | null;
  /** Parent + next-sibling before the drag (for Discard/restore). */
  origParent: Element;
  toIndex: number;
}

export interface ReorderDeps {
  /** The element to drag — the current inspector selection. */
  getSelectionNode: () => Element | null;
  /** The surface that selection lives on. */
  getSelectionSurface: () => Surface | null;
  /** Where the drag proxy and the indicators are drawn. */
  layer: ChromeLayer;
  /** Called once per completed drop. */
  onMove: (move: CompletedMove) => void;
}

interface DropTarget {
  container: Element;
  horizontal: boolean;
  ref: Element | null;
}

const DROPPABLE_ID = "airship:canvas";

/**
 * How far outside its own parent the pointer must travel before the drag stops
 * being a reorder, in screen pixels.
 *
 * Applied in one direction only. Leaving takes ten pixels of commitment;
 * returning takes none. Symmetric thresholds put a single boundary under the
 * cursor, and a pointer riding that boundary — which is exactly where it sits
 * while you drag an element along its parent's edge — flips the mode on every
 * frame, so the siblings and the insertion line take turns appearing.
 */
const LEAVE_BUFFER = 10;

/**
 * How far the insertion bar sits inside the container it is drawn in.
 *
 * A proportion of the container's cross-axis, so it stays visually balanced at
 * any size, clamped so it neither vanishes on a small box nor eats a large one.
 * The point of the inset is that the bar never touches the container's own
 * border: two lines meeting at a corner read as a rendering artefact, while a
 * bar floating clear of the edge reads as an instruction.
 *
 * Measured in **screen** pixels. Three percent of a surface-space cross-axis is
 * a third of a pixel at 10% zoom, which is no inset at all.
 */
const BAR_INSET_RATIO = 0.03;
const BAR_INSET_MIN = 3;
const BAR_INSET_MAX = 12;
const BAR_THICKNESS = 2;

/** Where the drag currently thinks it is, relative to the element's own parent. */
type DragMode = "reorder" | "reparent";

/**
 * Tree-aware drag-to-reposition. Unlike a sortable list this hit-tests the live
 * DOM under the pointer — the drop targets are the host app's own elements, an
 * unbounded set that can't be registered up front — shows an insertion indicator
 * between siblings / inside containers, and on drop performs a real
 * `insertBefore`/`appendChild`, reordering *and* reparenting. The move is a live
 * preview; the durable change comes from the agent editing source.
 *
 * dnd-kit drives the gesture (sensors, activation threshold, auto-scroll,
 * Escape-to-cancel, screen-reader announcements) while a custom
 * `collisionDetector` on a single page-wide droppable supplies the hit-testing.
 *
 * **What gets dragged is a proxy, not the element.** An earlier version
 * registered the app's own node as the draggable, which forced two workarounds:
 * dnd-kit's accessibility plugin writes `tabindex`/`role`/`aria-*` onto whatever
 * it is given and never takes them off, so every element ever selected had to be
 * snapshotted and restored or the app's tab order would be quietly rewritten;
 * and on the canvas it does not work at all, because a draggable inside a frame
 * emits its pointer events into the frame's document where the shell's manager
 * cannot hear them. A shell-owned transparent div sitting over the selection
 * solves both: dnd-kit only ever touches chrome, and all input stays in one
 * document. The app's DOM is not modified until the drop.
 */
export class DragReorderController {
  private active = false;
  private draggable: Draggable | null = null;
  private droppable: Droppable | null = null;
  private dragNode: Element | null = null;
  private dragSurface: Surface | null = null;
  private origParent: Element | null = null;
  private origNext: Node | null = null;
  /** What the detector resolved for the latest pointer position. */
  private resolved: DropTarget | null = null;
  /** `resolved`, but only once our droppable actually won the collision. */
  private armed: DropTarget | null = null;
  /** The proxy's rect at drag start, translated each move to drive collisions. */
  private baseRect: BoundingRectangle | null = null;
  private readonly delta = new DragDelta();
  /** Whether the pointer is still over the element's own parent — hysteretic. */
  private mode: DragMode = "reorder";
  /** The clone that follows the pointer while the real element stays hidden. */
  private readonly ghost = new DragGhost();
  /** Same-parent reorder feedback: the siblings themselves, stepping aside. */
  private readonly displacer = new SiblingDisplacer();
  /** The original parent's in-flow children, captured once at drag start. */
  private siblings: Element[] = [];

  private readonly line: HTMLElement;
  private readonly box: HTMLElement;
  private readonly sentinel: HTMLElement;
  /** The screen-space stand-in that is actually dragged. */
  private readonly proxy: HTMLElement;
  private readonly unsubscribe: (() => void)[] = [];

  private readonly deps: ReorderDeps;

  constructor(deps: ReorderDeps) {
    this.deps = deps;
    this.line = el("div", { class: `${cls("layer")} ${cls("drop-line")}` });
    this.box = el("div", { class: `${cls("layer")} ${cls("drop-box")}` });
    hide(this.line);
    hide(this.box);
    // Deliberately *not* tagged as chrome (see `edit-guard.ts`): the picker must
    // still be able to resolve a click that lands on the proxy, which it does by
    // hit-testing inside the frame rather than reading the event target — so a
    // click on a child of the selection selects that child, exactly as it would
    // if the proxy were not there.
    this.proxy = el("div", { class: cls("drag-proxy") });
    hide(this.proxy);
    // A viewport-sized, non-interactive stand-in so the droppable always has a
    // shape. The detector ignores it and hit-tests the pointer directly.
    this.sentinel = el("div", { class: cls("drop-sentinel") });
    deps.layer.add(this.box, this.line, this.proxy, this.sentinel);

    this.unsubscribe.push(
      manager.monitor.addEventListener("dragstart", () => this.onStart()),
      manager.monitor.addEventListener("dragmove", (e) => this.onMove(e)),
      // `collision` rather than `dragover`: it fires on every recompute — including
      // the one where the pointer leaves every target, which is when the indicator
      // has to disappear — and it carries the winning collision directly.
      // `dragOperation.target` is only settled asynchronously, a frame later.
      manager.monitor.addEventListener("collision", (e) =>
        this.onCollision(e.collisions)
      ),
      manager.monitor.addEventListener("dragend", (e) => this.onEnd(e.canceled))
    );
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The element dnd-kit presses on, for the edit guard to let through. */
  get proxyElement(): HTMLElement {
    return this.proxy;
  }

  /**
   * Arm grab-to-move on the current selection. The proxy is registered once and
   * reused; only its position changes as the selection does, which is why this
   * no longer has to tear down and rebuild a dnd-kit entity on every click.
   */
  enable(): void {
    const node = this.deps.getSelectionNode();
    if (!node) {
      this.disable();
      return;
    }
    this.active = true;
    this.draggable ??= new Draggable(
      {
        element: this.proxy,
        id: DND.canvasNode,
        // The proxy must not travel: it is a hit area pinned over the selection,
        // and every other feedback mode would either move it or splice a clone
        // into the layer. We owe dnd-kit the drag shape ourselves —
        // see `publishShape`.
        plugins: FEEDBACK.none,
        type: DND.canvasNode,
      },
      manager
    );
    this.droppable ??= new Droppable(
      {
        accept: DND.canvasNode,
        collisionDetector: () => this.detect(),
        element: this.sentinel,
        id: DROPPABLE_ID,
      },
      manager
    );
    this.syncProxy();
  }

  /**
   * Re-pin the proxy over the selection. Called from the same signal that
   * re-draws the selection outline — a pan, a zoom, a frame scroll, or an HMR
   * re-render — because a hit area that has drifted off its element is worse
   * than no hit area at all.
   */
  syncProxy(): void {
    const node = this.deps.getSelectionNode();
    const surface = this.deps.getSelectionSurface();
    if (!(this.active && node?.isConnected && surface?.isLive)) {
      hide(this.proxy);
      return;
    }
    const box = surface.toScreen(localRect(node));
    place(this.proxy, box, clipToSurface(surface, box));
  }

  disable(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    hide(this.proxy);
    this.hideIndicator();
    this.displacer.end();
    this.ghost.detach();
    this.dragNode?.classList.remove(DRAGGING_CLASS);
    this.dragNode = null;
    this.dragSurface = null;
    this.resolved = null;
    this.armed = null;
    this.siblings = [];
    this.mode = "reorder";
  }

  /** Remove the indicator elements and every manager subscription. */
  destroy(): void {
    this.disable();
    this.draggable?.destroy();
    this.droppable?.destroy();
    this.draggable = null;
    this.droppable = null;
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.box.remove();
    this.line.remove();
    this.proxy.remove();
    this.sentinel.remove();
  }

  // -- Drag lifecycle --------------------------------------------------------

  private isOurs(): boolean {
    return manager.dragOperation.source?.type === DND.canvasNode;
  }

  private onStart(): void {
    if (!this.isOurs()) {
      return;
    }
    const node = this.deps.getSelectionNode();
    const surface = this.deps.getSelectionSurface();
    const parent = node?.parentElement ?? null;
    if (!(node && parent && surface)) {
      return;
    }
    this.dragNode = node;
    this.dragSurface = surface;
    this.origParent = parent;
    /*
     * `nextElementSibling`, not `nextSibling`.
     *
     * Every drop resolves its anchor to an *element* (`targetInContainer` only ever
     * returns element refs), so recording the origin as a text node made a no-op drag
     * look like a move: in `<p>Hello <b>world</b> now</b>`, dragging the `<b>` and
     * releasing it where it already was put it after the `" now"` text node — the
     * visible text reordered — and `MoveSet.record`'s equality check then failed, so a
     * move edit shipped to the agent for a gesture that changed nothing on purpose.
     */
    this.origNext = node.nextElementSibling;
    this.mode = "reorder";
    const r = this.proxy.getBoundingClientRect();
    this.baseRect = {
      bottom: r.bottom,
      height: r.height,
      left: r.left,
      right: r.right,
      top: r.top,
      width: r.width,
    };
    this.delta.start();
    // Built *before* the element is hidden, because the ghost is a clone of it
    // and a clone taken afterwards would be a picture of nothing.
    this.ghost.attach(node, surface, this.delta.pointer);
    // The class hides the element while preserving its box — which is what lets
    // the siblings measure the hole they are about to close. See portable.css.
    node.classList.add(DRAGGING_CLASS);
    this.siblings = this.flowSiblings(parent);
    this.displacer.begin(node, parent, this.siblings);
    this.publishShape({ x: 0, y: 0 });
  }

  /**
   * The parent's children that can actually be displaced.
   *
   * Out-of-flow siblings are excluded rather than left in and skipped: they do
   * not move when the flow around them changes, so including one would put a
   * phantom entry in the index space the drop position is expressed in and
   * offset every shift after it by one place. The dragged element itself stays —
   * it is hidden, not removed, and its slot is the origin of the whole
   * calculation.
   */
  private flowSiblings(parent: Element): Element[] {
    return Array.from(parent.children).filter((child) => {
      if (isOwn(child)) {
        return false;
      }
      const style = computedStyle(child);
      return (
        style.display !== "none" &&
        style.position !== "absolute" &&
        style.position !== "fixed"
      );
    });
  }

  /**
   * Hand dnd-kit a drag shape it would otherwise get from the Feedback plugin.
   *
   * Two things depend on it. The collision observer refuses to run at all while
   * `dragOperation.shape` is null, and — less obviously — it recomputes
   * collisions *because* the shape changes: the shape is the reactive signal the
   * observer is subscribed to. A static shape would resolve one drop target on
   * the first frame and never look again. So this publishes the source's rect
   * translated by the pointer delta, which both satisfies the guard and ticks
   * the observer once per move.
   */
  private publishShape(d: Coordinates): void {
    if (!this.baseRect) {
      return;
    }
    manager.dragOperation.shape = Rectangle.from(this.baseRect).translate(
      d.x,
      d.y
    );
  }

  private onMove(e: { by?: Coordinates; to?: Coordinates }): void {
    if (!this.isOurs()) {
      return;
    }
    this.publishShape(this.delta.update(e));
    this.ghost.moveTo(this.delta.pointer);
  }

  /**
   * Show the drop position — as displaced siblings, or as an insertion bar.
   *
   * Which one depends on where the element would land. Inside its own parent the
   * siblings move, because the result is a rearrangement of things already on
   * screen and showing it directly beats describing it with a line. Anywhere else
   * there is nothing to rearrange yet, so the bar says where the element would go
   * in a container it is not in.
   *
   * The two are mutually exclusive by construction — running both would put a
   * line into a gap the siblings have already opened, which reads as the editor
   * proposing two different drops at once.
   */
  private onCollision(collisions: readonly Collision[]): void {
    if (!this.isOurs()) {
      return;
    }
    const armed = collisions[0]?.id === DROPPABLE_ID ? this.resolved : null;
    this.armed = armed;
    const index =
      armed && armed.container === this.origParent && this.displacer.isActive
        ? this.dropIndex(armed)
        : null;
    // `null` here means the drop point has no place among the siblings — the
    // reference child is out of flow — so there is no displacement to show and
    // this falls through to the bar rather than showing nothing at all.
    if (index !== null) {
      this.displacer.update(index);
      this.hideIndicator();
      return;
    }
    this.displacer.update(null);
    if (armed) {
      this.renderIndicator(armed);
    } else {
      this.hideIndicator();
    }
  }

  /**
   * Where the element would sit among its siblings, as an index into `siblings`.
   *
   * `null` when the reference child is out of flow and so has no place in that
   * index space; the caller falls back to the insertion bar, which does not need
   * one. Read against the list captured at drag start rather than re-derived
   * here — both because the displacement offsets are expressed in that same
   * index space, and because re-deriving it would run a computed-style read per
   * child on every collision, which is several times a frame.
   *
   * Deriving the index from the target the collision already resolved, rather
   * than re-running a midpoint test, is what keeps the feedback and the eventual
   * `insertBefore` from ever disagreeing about where the element is going.
   */
  private dropIndex(target: DropTarget): number | null {
    if (!target.ref) {
      return this.siblings.length;
    }
    const at = this.siblings.indexOf(target.ref);
    return at === -1 ? null : at;
  }

  private onEnd(canceled: boolean): void {
    if (!this.isOurs()) {
      return;
    }
    const node = this.dragNode;
    // Read into differently-named locals: the fields are nulled out below, and
    // destructuring them off `this` reads to the linter as never using them.
    const startParent = this.origParent;
    const startNext = this.origNext;
    const target = this.armed;
    // Every piece of preview goes before the real move, not after. The siblings
    // are sitting on transforms that describe a layout the `insertBefore` below
    // is about to actually produce; leaving them on would double the offset, and
    // taking them off afterwards would animate from the new layout back to
    // itself. `end()` also kills the transition first, so nothing eases.
    this.displacer.end();
    this.ghost.detach();
    this.dragNode?.classList.remove(DRAGGING_CLASS);
    this.hideIndicator();
    this.dragNode = null;
    this.dragSurface = null;
    this.origParent = null;
    this.origNext = null;
    this.resolved = null;
    this.armed = null;
    this.baseRect = null;
    this.siblings = [];
    this.mode = "reorder";
    // The element moved, so the proxy is now over the wrong place.
    this.syncProxy();
    if (canceled || !(node && startParent)) {
      return;
    }
    if (!(target && this.isValidContainer(target.container))) {
      return;
    }
    const ref =
      target.ref && target.ref.parentElement === target.container
        ? target.ref
        : null;
    target.container.insertBefore(node, ref);
    /*
     * Counted over the children the drop logic considers, not over all of them.
     *
     * `container.children` includes the `display: none`, absolutely positioned and
     * editor-owned nodes that `childrenOf` filters out — so the index shipped on the
     * wire was off by the number of those preceding the drop point. The DOM mutation is
     * anchored by `ref` and was always right; `toIndex` is the agent's disambiguator,
     * and it disagreed with it.
     */
    const toIndex = this.childrenOf(target.container).indexOf(node);
    this.deps.onMove({
      before: ref,
      newParent: target.container,
      node,
      origNext: startNext,
      origParent: startParent,
      toIndex,
    });
    this.syncProxy();
  }

  // -- Collision detection ---------------------------------------------------

  private detect(): Collision | null {
    this.resolved = this.resolveTarget(this.delta.pointer);
    return this.resolved ? hit(DROPPABLE_ID) : null;
  }

  /**
   * Resolve a drop target from a **screen** point.
   *
   * Everything past the hit-test happens in the surface's own coordinates: the
   * rects come from `getBoundingClientRect()` inside the frame, so the pointer
   * has to be converted to match before any midpoint comparison. Mixing the two
   * spaces would put every insertion line on the wrong side of every element at
   * any zoom other than 100%.
   */
  private resolveTarget(screen: Point): DropTarget | null {
    const surface = this.dragSurface;
    if (!surface?.isLive) {
      return null;
    }
    // A move that leaves its frame is refused rather than reinterpreted. The two
    // frames are the same app at two sizes, so "drop it in the other one" has no
    // meaning that maps back to a source edit.
    const hovered = surface.elementAtScreen(screen);
    if (!hovered || isOwn(hovered) || hovered === this.dragNode) {
      return null;
    }
    if (this.dragNode?.contains(hovered)) {
      return null;
    }
    this.updateMode(screen, surface);
    const local = surface.toLocal(screen);
    const target = this.resolveIn(hovered, local);
    return this.holdInParent(target, local);
  }

  private resolveIn(hovered: Element, local: Point): DropTarget | null {
    const kids = this.childrenOf(hovered);
    if (kids.length > 0) {
      return this.targetInContainer(hovered, kids, local);
    }
    const parent = hovered.parentElement;
    if (parent && this.isValidContainer(parent)) {
      return this.targetBeside(hovered, parent, local);
    }
    if (this.isValidContainer(hovered)) {
      return { container: hovered, horizontal: false, ref: null };
    }
    return null;
  }

  /**
   * Track whether the pointer still counts as being over the element's own
   * parent, with a buffer on the way out and none on the way back in.
   *
   * The asymmetry is the whole mechanism. A pointer dragging an element along
   * the inside of its parent's edge sits *on* that boundary, and a single
   * threshold there resolves differently on alternate frames — so the siblings
   * spring back and the insertion bar appears, several times a second. Making
   * the exit cost ten pixels and the return cost nothing means the boundary can
   * only be crossed deliberately.
   */
  private updateMode(screen: Point, surface: Surface): void {
    const parent = this.origParent;
    if (!parent?.isConnected) {
      this.mode = "reparent";
      return;
    }
    const box = surface.toScreen(localRect(parent));
    const slop = this.mode === "reorder" ? LEAVE_BUFFER : 0;
    const inside =
      screen.x >= box.left - slop &&
      screen.x <= box.left + box.width + slop &&
      screen.y >= box.top - slop &&
      screen.y <= box.top + box.height + slop;
    this.mode = inside ? "reorder" : "reparent";
  }

  /**
   * While the drag still counts as a reorder, refuse to resolve *outwards*.
   *
   * Without this the buffer would be decorative: the pointer slips a pixel past
   * the parent's edge, the hit-test lands on the grandparent, and the drag
   * becomes a reparent even though the mode says otherwise. Resolving *inwards*
   * is left alone — dropping an element into a sibling that happens to be a
   * container is a real thing to want, and it is unambiguous.
   */
  private holdInParent(
    target: DropTarget | null,
    local: Point
  ): DropTarget | null {
    const parent = this.origParent;
    if (this.mode !== "reorder" || !parent) {
      return target;
    }
    if (target && parent.contains(target.container)) {
      return target;
    }
    const kids = this.childrenOf(parent);
    return kids.length > 0
      ? this.targetInContainer(parent, kids, local)
      : { container: parent, horizontal: false, ref: null };
  }

  private targetInContainer(
    container: Element,
    kids: Element[],
    local: Point
  ): DropTarget {
    const horizontal = this.isHorizontal(container, kids[0]);
    for (const kid of kids) {
      const r = localRect(kid);
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const p = horizontal ? local.x : local.y;
      if (p < mid) {
        return { container, horizontal, ref: kid };
      }
    }
    return { container, horizontal, ref: null };
  }

  private targetBeside(
    hovered: Element,
    parent: Element,
    local: Point
  ): DropTarget {
    const horizontal = this.isHorizontal(parent, hovered);
    const r = localRect(hovered);
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    const after = (horizontal ? local.x : local.y) > mid;
    let ref = after ? hovered.nextElementSibling : hovered;
    if (this.dragNode && ref === this.dragNode) {
      ref = this.dragNode.nextElementSibling;
    }
    return { container: parent, horizontal, ref };
  }

  private isHorizontal(
    container: Element,
    sample: Element | undefined
  ): boolean {
    const cs = computedStyle(container);
    if (cs.display === "flex" || cs.display === "inline-flex") {
      return cs.flexDirection.startsWith("row");
    }
    const sib = sample?.nextElementSibling ?? sample?.previousElementSibling;
    if (sample && sib && sib !== this.dragNode) {
      const a = localRect(sample);
      const b = localRect(sib);
      return Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5;
    }
    return false;
  }

  // -- Indicator rendering ---------------------------------------------------

  /**
   * The container highlight and the insertion bar.
   *
   * Both are computed in **screen** space, which is a change from the surface
   * space the rest of the hit-testing works in and is deliberate: the bar's
   * thickness and its inset from the container's edges are constants of the
   * chrome, not of the content. Three percent of a surface-space cross-axis is a
   * third of a pixel at 10% zoom, and a 2px bar drawn in surface space would be
   * 0.2px there — the same reasoning that puts every other piece of chrome on a
   * 1× layer over scaled rects.
   */
  private renderIndicator(target: DropTarget): void {
    const surface = this.dragSurface;
    if (!surface) {
      return;
    }
    const container = surface.toScreen(localRect(target.container));
    place(this.box, container, clipToSurface(surface, container));
    const bar = this.barBox(target, container, surface);
    place(this.line, bar, clipToSurface(surface, bar));
  }

  /** The insertion bar, running across the container's cross axis. */
  private barBox(target: DropTarget, container: Rect, surface: Surface): Rect {
    const { horizontal } = target;
    const cross = horizontal ? container.height : container.width;
    const inset = Math.min(
      BAR_INSET_MAX,
      Math.max(BAR_INSET_MIN, Math.round(cross * BAR_INSET_RATIO))
    );
    const span = Math.max(BAR_THICKNESS, cross - inset * 2);
    const at = this.barPosition(target, container, surface);
    const half = BAR_THICKNESS / 2;
    return horizontal
      ? {
          height: span,
          left: at - half,
          top: container.top + inset,
          width: BAR_THICKNESS,
        }
      : {
          height: BAR_THICKNESS,
          left: container.left + inset,
          top: at - half,
          width: span,
        };
  }

  /**
   * Where along the layout axis the bar sits, in screen coordinates.
   *
   * Centred in the *gap* between the two children it would come between, rather
   * than flush against the leading edge of the one it precedes. Flush is what
   * the geometry suggests, but it puts the bar hard against a real element's
   * border, so it reads as belonging to that element instead of to the space
   * before it — and in a layout with a large gap it looks off-centre.
   */
  private barPosition(
    target: DropTarget,
    container: Rect,
    surface: Surface
  ): number {
    const { horizontal } = target;
    const near = (r: Rect): number => (horizontal ? r.left : r.top);
    const far = (r: Rect): number =>
      horizontal ? r.left + r.width : r.top + r.height;
    const kids = this.childrenOf(target.container);
    if (kids.length === 0) {
      // Nothing to sit between: just inside the container's leading edge.
      return near(container) + BAR_INSET_MIN + BAR_THICKNESS;
    }
    if (!target.ref) {
      const last = kids.at(-1);
      return last ? far(surface.toScreen(localRect(last))) : near(container);
    }
    const refBox = surface.toScreen(localRect(target.ref));
    const before = kids[kids.indexOf(target.ref) - 1];
    if (!before) {
      return near(refBox);
    }
    return (far(surface.toScreen(localRect(before))) + near(refBox)) / 2;
  }

  private hideIndicator(): void {
    hide(this.line);
    hide(this.box);
  }

  // -- Guards ----------------------------------------------------------------

  private childrenOf(node: Element): Element[] {
    return Array.from(node.children).filter(
      (c) => c !== this.dragNode && !isOwn(c)
    );
  }

  private isValidContainer(node: Element | null): node is Element {
    return Boolean(
      node?.isConnected &&
        node !== this.dragNode &&
        !this.dragNode?.contains(node) &&
        !isOwn(node)
    );
  }
}
