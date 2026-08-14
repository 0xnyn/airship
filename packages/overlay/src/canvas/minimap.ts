/**
 * A small map of the whole canvas, and a way to move around it.
 *
 * The canvas is infinite and until now nothing on screen said where on it you
 * were. Pan away from your frames and there was no affordance pointing back —
 * only ⇧1, which answers the question by throwing away the zoom level you were
 * working at. This is the cheap continuous answer: everything you have, at a
 * glance, with a box showing the part you are looking at, draggable.
 *
 * **Rectangles, not thumbnails.** Every frame is a live same-origin `iframe`
 * running a full instance of the user's app. There is no paint capture anywhere
 * in the overlay and no way to add one cheaply — `FrameAgent` exposes DOM, not
 * pixels — an `iframe` cannot be duplicated, and cloning one would boot a ninth
 * app against a cap of eight. So a frame is drawn the way `ChromeLayer` draws
 * everything else: a positioned `div` with the numbers written into it.
 *
 * **The bounds include where you are looking**, not just where the frames are,
 * and that is the difference between a map and a decoration. Projecting the
 * frames alone means the indicator slides off the card the moment you pan past
 * them — exactly when a map is the only thing that could help. The cost is that
 * the projection rescales while you are outside your content; inside it, which
 * is the common case, the frames' union dominates and the map holds still.
 *
 * **The card cannot be dismissed.** It used to carry a close button, with the
 * only way back a checkbox under the zoom readout — no shortcut, no palette,
 * and a README that documented the hiding and not the restoring. A control
 * whose off state is discoverable and whose on state is not is a trap, and the
 * map is small enough that nothing was bought by allowing it. It is furniture
 * now: always on the canvas stage, still stood down under 900px where it would
 * collide with the bar, and still skipped in edit mode by its host.
 *
 * **Accessibility.** The projection is `aria-hidden` and nothing in it takes
 * focus. It is a pointer-only enhancement, and everything it does is reachable
 * without it: ⇧1 fits, ⇧2 zooms to the selection, and the frame list beside it
 * is a real keyboard-navigable list of the same frames. A draggable
 * `role="application"` region here would be a worse answer pretending to be a
 * better one.
 */

import { cls, el } from "../dom";
import { clamp } from "../num";
import { MINIMAP_H, MINIMAP_PAD, MINIMAP_W } from "../styles/const";
import type { FrameManager } from "./frames";
import {
  type Point,
  projectInto,
  type Rect,
  screenToWorld,
  unionRects,
  type Viewport,
  worldRectToScreen,
} from "./space";
import type { CanvasViewport } from "./viewport";

/** The projection box, as a rect — the origin every placement is measured from. */
const BOX: Rect = { height: MINIMAP_H, left: 0, top: 0, width: MINIMAP_W };

/**
 * How the world maps into the card.
 *
 * Split out as a pure function because it is the whole of the geometry and none
 * of the DOM: everything that can be wrong about a minimap is wrong in here,
 * and this way it can be asserted directly rather than through a rendered card
 * under a DOM implementation that does no layout.
 *
 * Total, with no failure case. `seen` is always in the union, so the bounds can
 * never be empty the way `unionRects` alone can be — an empty canvas projects
 * the viewport by itself, and a viewport that has not been laid out yet is a
 * zero box, which `projectInto` answers with the identity rather than a
 * division by nothing.
 */
export function minimapProjection(
  frameRects: Rect[],
  seen: Rect
): { bounds: Rect; map: Viewport } {
  // biome-ignore lint/style/noNonNullAssertion: the list always has `seen` in it.
  const bounds = unionRects([...frameRects, seen])!;
  return { bounds, map: projectInto(bounds, BOX, MINIMAP_PAD) };
}

export interface MinimapDeps {
  frames: FrameManager;
  viewport: CanvasViewport;
}

/**
 * A drag in flight.
 *
 * Both fields exist to stop the gesture changing shape underneath itself.
 *
 * `map` is a *snapshot*. The live projection is recomputed on every rendered
 * frame from bounds that include where you are looking, so panning changes the
 * scale, which changes how far the next pointer move travels — a stationary
 * pointer on a rescaling map is the rubber-banding this fixes. Frozen for the
 * length of the gesture, one pixel of pointer means the same distance from
 * press to release.
 *
 * `grab` is where inside the indicator you took hold of it, in card pixels.
 * Without it every move re-centres the box on the cursor, so grabbing an edge
 * snaps the view by half a box before you have moved at all. Holding the offset
 * is what makes the indicator track the pointer instead of jumping to it — the
 * behaviour Photoshop's Navigator has always had, and the one VS Code's minimap
 * grew in microsoft/vscode#64459. A press *outside* the indicator has no offset
 * to keep: it means "go there", so it centres and then tracks from zero.
 */
interface MinimapDrag {
  grab: Point;
  map: Viewport;
}

export class Minimap {
  readonly element: HTMLElement;

  private readonly body: HTMLElement;
  private readonly view: HTMLElement;
  /** One chip per frame, keyed by id — see `render`. */
  private readonly chips = new Map<string, HTMLElement>();
  private readonly deps: MinimapDeps;

  /** The live projection, kept so a pointer can be mapped back through it. */
  private map: Viewport | null = null;
  /** Where the indicator was last drawn, in card px — what `onPress` hit-tests. */
  private viewRect: Rect | null = null;
  private drag: MinimapDrag | null = null;

  constructor(deps: MinimapDeps) {
    this.deps = deps;
    this.view = el("div", { class: cls("minimap-view") });
    this.body = el(
      "div",
      { "aria-hidden": "true", class: cls("minimap-body") },
      [this.view]
    );
    this.element = el(
      "div",
      {
        "aria-label": "Canvas minimap",
        class: cls("minimap"),
        role: "group",
      },
      [this.body]
    );
    this.bind();
  }

  mount(host: HTMLElement): void {
    host.append(this.element);
  }

  /**
   * Redraw. Called from the stage's `notify`, which the viewport already
   * coalesces to one call per animation frame — so this is the per-frame budget
   * and does no scheduling of its own. The stage skips it entirely in edit
   * mode, where the host is hidden.
   *
   * Structure is rebuilt only when the *set* of frames changes; a pan or a zoom,
   * many times a second, takes the placement path alone. Same bargain
   * `FrameChrome.render` makes, and for the same reason.
   */
  render(): void {
    const { frames, viewport } = this.deps;
    /*
     * The *uncovered* canvas, not the whole of it.
     *
     * This is what `centerOn` aims at, and the indicator has to be drawn from
     * the same rect or pressing the map moves the camera somewhere other than
     * where the box says you asked for — a constant drift the width of whichever
     * docks are open. See `CanvasViewport.visibleSafeRect`.
     */
    const seen = viewport.visibleSafeRect;
    // Frozen mid-drag. `minimapProjection` folds `seen` into its bounds, so
    // recomputing here would rescale the map as the gesture moved it.
    const map =
      this.drag?.map ?? minimapProjection(frames.worldRects(), seen).map;
    this.map = map;
    this.syncChips();
    const activeId = frames.active?.id ?? null;
    for (const frame of frames.all) {
      const chip = this.chips.get(frame.id);
      if (!chip) {
        continue;
      }
      place(
        chip,
        worldRectToScreen(map, BOX, {
          height: frame.height,
          left: frame.x,
          top: frame.y,
          width: frame.width,
        })
      );
      chip.classList.toggle(cls("minimap-frame-on"), frame.id === activeId);
    }
    this.viewRect = worldRectToScreen(map, BOX, seen);
    place(this.view, this.viewRect);
  }

  destroy(): void {
    this.element.remove();
    this.chips.clear();
  }

  // -- Internals ---------------------------------------------------------------

  /** Add and remove chips so the map's set matches the canvas's. */
  private syncChips(): void {
    const wanted = new Set(this.deps.frames.all.map((f) => f.id));
    for (const [id, chip] of this.chips) {
      if (!wanted.has(id)) {
        chip.remove();
        this.chips.delete(id);
      }
    }
    for (const frame of this.deps.frames.all) {
      if (this.chips.has(frame.id)) {
        continue;
      }
      const chip = el("div", {
        class: cls("minimap-frame"),
        "data-frame": frame.id,
      });
      this.chips.set(frame.id, chip);
      // Before the indicator, so the box showing where you are always paints
      // over the frames it is standing on rather than under whichever one was
      // added last.
      this.view.before(chip);
    }
  }

  private bind(): void {
    this.body.addEventListener("pointerdown", (e) => this.onPress(e));
    this.body.addEventListener("pointermove", (e) => this.onMove(e));
    this.body.addEventListener("pointerup", (e) => this.onRelease(e));
    this.body.addEventListener("pointercancel", (e) => this.onRelease(e));
    this.body.addEventListener("dblclick", (e) => this.onDoublePress(e));
  }

  /**
   * Take hold of the map.
   *
   * Two gestures share one press, decided here and then not revisited:
   *
   * - **Inside the indicator** — a grab. The offset from the box's centre to
   *   the cursor is kept, so the box travels with the pointer rather than
   *   snapping its middle to it. Re-centring on every move is what made this
   *   feel over-sensitive: it turned a grab near the edge into an instant jump
   *   of half a box before the pointer had travelled at all.
   * - **Anywhere else** — "go there". No offset to keep, so the press centres
   *   the view on that point and the drag continues from zero. This is what
   *   keeps the map usable at a wide zoom-out, where the indicator is a few
   *   pixels across and demanding a hit on it would be hostile.
   *
   * Pressing on a frame also selects it, which is the same rule a press inside
   * a live frame already follows (see `__airshipOnFramePress` in
   * `shell-app.ts`) — but a press on open canvas leaves the selection alone,
   * because it is not a deselect gesture, it is a pan.
   */
  private onPress(e: PointerEvent): void {
    if (e.button !== 0 || !this.map) {
      return;
    }
    // Otherwise the press begins a text selection that survives the drag.
    e.preventDefault();
    const id = frameIdOf(e.target);
    if (id) {
      this.deps.frames.setActive(id);
    }
    const at = this.cardPoint(e);
    const box = this.viewRect;
    const inside =
      box !== null &&
      at.x >= box.left &&
      at.x <= box.left + box.width &&
      at.y >= box.top &&
      at.y <= box.top + box.height;
    this.drag = {
      grab:
        inside && box
          ? {
              x: at.x - (box.left + box.width / 2),
              y: at.y - (box.top + box.height / 2),
            }
          : { x: 0, y: 0 },
      map: this.map,
    };
    this.body.setPointerCapture(e.pointerId);
    this.goTo(e);
  }

  private onMove(e: PointerEvent): void {
    if (this.drag) {
      this.goTo(e);
    }
  }

  private onRelease(e: PointerEvent): void {
    if (!this.drag) {
      return;
    }
    this.drag = null;
    if (this.body.hasPointerCapture(e.pointerId)) {
      this.body.releasePointerCapture(e.pointerId);
    }
    // Every other pan persists on settle; this one is no different.
    this.deps.viewport.save();
  }

  /** Double-click a frame to zoom to it — the map's one magnifying gesture. */
  private onDoublePress(e: PointerEvent | MouseEvent): void {
    const id = frameIdOf(e.target);
    const frame = id ? this.deps.frames.byId(id) : null;
    if (!frame) {
      return;
    }
    this.deps.viewport.fitToRect({
      height: frame.height,
      left: frame.x,
      top: frame.y,
      width: frame.width,
    });
    this.deps.viewport.save();
  }

  /**
   * Put the indicator where the pointer has carried it.
   *
   * The target is the cursor less the grab offset — the point the box's *centre*
   * should land on — clamped to the card. Clamping is what bounds the gesture:
   * pointer capture means a drag continues past the card's edge, and without it
   * a flick off the side would pan into empty space with nothing left on the map
   * to steer back by. Inside the card the clamp never fires, so it costs the
   * common case nothing.
   */
  private goTo(e: PointerEvent): void {
    const { drag } = this;
    if (!drag) {
      return;
    }
    const r = this.body.getBoundingClientRect();
    const at = this.cardPoint(e);
    const target = {
      x: clamp(at.x - drag.grab.x, 0, r.width),
      y: clamp(at.y - drag.grab.y, 0, r.height),
    };
    this.deps.viewport.centerOn(
      screenToWorld(
        drag.map,
        { height: r.height, left: 0, top: 0, width: r.width },
        target
      )
    );
  }

  /**
   * A pointer event in the card's own pixels.
   *
   * The card's rect is read from the browser rather than derived, for the reason
   * `frameScreenRect` gives: it already carries wherever the element happens to
   * sit, including any future ancestor transform, and cannot drift out of step
   * with the CSS the way a re-derived offset would.
   */
  private cardPoint(e: PointerEvent): Point {
    const r = this.body.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}

/** Which frame a node in the map belongs to, if any. */
function frameIdOf(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest(`.${cls("minimap-frame")}`)?.getAttribute("data-frame") ??
        null)
    : null;
}

function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${Math.max(1, rect.width)}px`;
  node.style.height = `${Math.max(1, rect.height)}px`;
}
