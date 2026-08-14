import { cls, el } from "../dom";
import { isOwn } from "../edit-guard";
import { isInsidePopover, isTypingTarget, keys } from "../keys";
import { isFrameChrome } from "./frame-chrome";
import {
  centerAt,
  clampScale,
  fitTo,
  MAX_SCALE,
  MIN_SCALE,
  type Point,
  type Rect,
  screenToWorld,
  unionRects,
  type Viewport,
  zoomAt,
} from "./space";
import { axes, pixelDelta, SCROLLABLE_OVERFLOW, type WheelLike } from "./wheel";

/**
 * Pan and zoom for the canvas.
 *
 * Structure is a clipping viewport containing a world that carries a single
 * `translate(x, y) scale(s)` — one composited transform for the whole canvas,
 * which is why panning past a wall of live app instances stays smooth: the
 * browser moves an existing layer rather than re-laying out anything.
 *
 * Bindings follow the design-tool conventions, because that is the muscle memory this is borrowing:
 * wheel and two-finger scroll pan, ⌘/ctrl-wheel and pinch zoom at the cursor,
 * space-drag and middle-drag pan, ⌘/ctrl +/- step the zoom, and shift-1/2/0 fit,
 * zoom to selection, and reset to 100%.
 */

const ZOOM_STEPS = [
  0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4,
];

/** Trackpad pinch arrives as a wheel event with ctrlKey set and small deltas. */
const WHEEL_ZOOM_SENSITIVITY = 0.01;

/**
 * Per-event zoom is clamped because the two input devices land decades apart
 * once normalised: a trackpad pinch is a stream of ~1–10px events, while a
 * single mouse notch is 120px. Unclamped, that notch would jump the canvas by
 * more than 3× in one tick.
 */
const MAX_ZOOM_DELTA = 25;

/**
 * The narrowest strip of canvas a fit is allowed to aim at.
 *
 * Each dock is already capped at half the window, so two wide ones can cover it
 * completely. Rather than let `fitTo` receive a zero or negative width — which
 * would produce a nonsense scale — the safe area stops shrinking here and the
 * panels are simply allowed to overlap it.
 */
const MIN_SAFE_W = 320;

/** What the floating docks are covering, in CSS pixels. */
export interface SafeInset {
  left: number;
  right: number;
}

const NO_INSET: SafeInset = { left: 0, right: 0 };

export interface CanvasViewportDeps {
  /** World-space rects to fit, for shift-1. */
  getContentRects: () => Rect[];
  /**
   * How much of the canvas the floating panels are covering. The canvas runs
   * edge to edge under them, so this is the only thing that keeps a fit from
   * parking frames behind a dock. Omitted by callers with nothing floating.
   */
  getSafeInset?: () => SafeInset;
  /** World-space rect of the current selection, for shift-2. Null if none. */
  getSelectionRect: () => Rect | null;
  /**
   * Offer a wheel this document received to whichever frame owns it.
   *
   * The canvas is not the only thing a wheel over a frame can land on: a frame's
   * title and its resize grips are chrome in *this* document, and a frame that
   * has not loaded yet has no document of its own to receive anything. Without
   * this those wheels panned, while one pixel away — inside the frame, where the
   * frame's own agent forwards them — the same gesture scrolled the page. Screen
   * coordinates; true means the frame took it, so cancel the default and mark no
   * canvas gesture, because none happened. Omitted by callers with no frames.
   *
   * The target comes along because geometry cannot answer for the title: it is
   * drawn *above* the frame it names, so only the node itself says which frame a
   * wheel there was aimed at.
   */
  offerWheelToFrame?: (
    e: WheelLike,
    point: Point,
    target: EventTarget | null
  ) => boolean;
  /** The transform changed — re-anchor chrome, re-check lazy mounts. */
  onChange: (vp: Viewport) => void;
  /**
   * A pan or zoom settled — the trailing edge, after wheel momentum has run out
   * or the pointer has lifted.
   *
   * Distinct from `onChange` because it answers a different question. `onChange`
   * says *the transform moved*, which is when chrome is re-anchored over the
   * nodes it is already on. This says *the gesture is over*, which is when it is
   * finally safe (and necessary) to work out what is under the cursor again:
   * hit-testing into a moving frame strobes, so it is suppressed throughout, and
   * without a trailing notification nothing restarts it — a wheel pan produces
   * no `mousemove` to do the job.
   */
  onGestureEnd?: () => void;
  /** Persisted per project alongside the frame layout. */
  storageKey: string;
}

/**
 * Is some scrollable overlay under the pointer that should keep this wheel?
 *
 * The docks are handled before this, by `isOwn` — they float over a full-bleed
 * canvas now, so geometry cannot tell them apart from the surface behind them.
 * What is left is everything scrollable that floats over the canvas *outside*
 * the overlay root: a long device menu, a future popover. Walk up from the
 * target and yield to the first ancestor that can actually scroll further in
 * the direction asked.
 */
function scrollableUnder(target: EventTarget | null, dy: number): boolean {
  let node = target as Element | null;
  while (node && node !== document.body) {
    const style = node instanceof HTMLElement ? getComputedStyle(node) : null;
    const scrolls =
      style &&
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 1;
    if (scrolls) {
      const atTop = node.scrollTop <= 0;
      const atBottom =
        node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      // Only claim the event if it still has somewhere to go; otherwise the
      // canvas should take over rather than the gesture dying at the boundary.
      if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export class CanvasViewport {
  /** The clipping element. Chrome is positioned inside this, in screen space. */
  readonly element: HTMLElement;
  /** The transformed element frames live in, in world space. */
  readonly world: HTMLElement;

  private vp: Viewport = { scale: 1, x: 0, y: 0 };
  private spaceDown = false;
  /** The Hand tool's latch. Held here rather than in `AirshipApp` alone because
   * it is read on the hot path — see `onPointerDown`. */
  private handTool = false;
  private panning: { origin: Point; start: Point } | null = null;
  private gestureTimer = 0;
  private frameRequest = 0;
  private readonly unbind: (() => void)[] = [];

  private readonly deps: CanvasViewportDeps;

  constructor(deps: CanvasViewportDeps) {
    this.deps = deps;
    this.world = el("div", { class: cls("canvas-world") });
    this.element = el("div", { class: cls("canvas-viewport") }, [this.world]);
    this.bind();
  }

  get viewport(): Viewport {
    return this.vp;
  }

  get scale(): number {
    return this.vp.scale;
  }

  /** The clipping element's own screen rect — the origin for world↔screen. */
  get rect(): Rect {
    const r = this.element.getBoundingClientRect();
    return { height: r.height, left: r.left, top: r.top, width: r.width };
  }

  /**
   * The part of the canvas no floating panel is covering.
   *
   * The canvas used to inset itself by whichever docks were open, so `rect` was
   * already the visible part and there was nothing else to know. Now it runs
   * edge to edge with the panels floating on top, which means every command
   * that *aims* at the viewport — fit, zoom-to-selection, the centre anchor for
   * keyboard zoom — has to aim here instead, or a fit with the chat dock open
   * parks half the frames underneath it.
   *
   * Only the two side panels are subtracted. The bottom bar and the corner
   * pills are small and sit over the canvas's own margins, so reserving space
   * for them would cost more than it bought.
   */
  private get safeRect(): Rect {
    const r = this.rect;
    const { left, right } = this.deps.getSafeInset?.() ?? NO_INSET;
    const width = Math.max(MIN_SAFE_W, r.width - left - right);
    return { height: r.height, left: r.left + left, top: r.top, width };
  }

  /**
   * The world-space box the *uncovered* canvas is showing.
   *
   * `visibleWorldRect(vp, rect)` answers the same question for the whole canvas
   * and is the wrong one for anything that has to agree with `centerOn`: that
   * command aims at `safeRect`, so its centre is the middle of what you can
   * see, while the full rect's centre is the middle of what the docks are
   * partly covering. The two differ by `(rightInset - leftInset) / 2 / scale`,
   * which is a constant offset rather than a rounding error — with the frames
   * panel open it is ~140px of world at scale 1, and 1400 at 10%.
   *
   * The minimap is the caller that cares: it draws an indicator and then hands
   * the point you pressed to `centerOn`, so drawing from anything other than
   * what `centerOn` targets puts the box somewhere other than where you aimed.
   * Derived here rather than by passing `safeRect` to `visibleWorldRect`,
   * because that helper assumes the rect it is given starts at the canvas's own
   * origin — it would take the safe area's *size* and the full rect's position.
   */
  get visibleSafeRect(): Rect {
    const r = this.rect;
    const safe = this.safeRect;
    const { scale, x, y } = this.vp;
    return {
      height: safe.height / scale,
      left: (safe.left - r.left - x) / scale,
      top: (safe.top - r.top - y) / scale,
      width: safe.width / scale,
    };
  }

  /** Is a pan gesture in flight? The picker suppresses hover while one is. */
  get isPanning(): boolean {
    return this.panning !== null;
  }

  /**
   * Is a *wheel* gesture in flight? Deliberately separate from `isPanning`,
   * which is the pointer drag: trackpad momentum keeps firing wheel events for a
   * second or more after the fingers lift, and the owner of a gesture must not
   * change before it ends (see the note atop `wheel.ts`).
   */
  get isWheeling(): boolean {
    return this.gestureTimer !== 0;
  }

  /**
   * Arm or disarm the Hand tool — the view-mode latch that makes a plain drag
   * pan the surface.
   *
   * It is a *latch* and not a held modifier because the modifier is what stops
   * working in view mode: the frames are live iframes there, and once the
   * pointer has taken focus into one, a space keydown never reaches the shell.
   * Nothing forwards presses either (`frame-agent.ts` forwards only the wheel),
   * which is what gives the tool its boundary for free — a press that lands on a
   * frame is consumed by that iframe and never arrives here, so the Hand moves
   * the canvas without ever reaching *into* the app running on it.
   *
   * What it does *not* claim is a press aimed at one frame's own furniture — see
   * the guard in `onPointerDown`. The Hand moves the surface; a frame's title
   * moves that frame.
   */
  setHandTool(on: boolean): void {
    if (on === this.handTool) {
      return;
    }
    this.handTool = on;
    this.element.classList.toggle(cls("canvas-pannable"), on);
    if (!on) {
      // Disarming mid-drag would otherwise leave `panning` set with no pointerup
      // ever coming to clear it.
      this.endPan();
    }
  }

  set(vp: Viewport): void {
    this.vp = { ...vp, scale: clampScale(vp.scale) };
    this.apply();
  }

  // -- Zoom commands ---------------------------------------------------------

  /**
   * The centre of the visible canvas, in the rect-relative coordinates `zoomAt`
   * expects. Keyboard zoom holds this point still, so with a dock open it holds
   * the middle of what you can see rather than the middle of what is covered.
   */
  private get safeAnchor(): Point {
    const r = this.rect;
    const safe = this.safeRect;
    return {
      x: safe.left - r.left + safe.width / 2,
      y: safe.top - r.top + safe.height / 2,
    };
  }

  /** Zoom about the viewport's centre — the right anchor for keyboard zoom. */
  zoomBy(factor: number): void {
    this.set(zoomAt(this.vp, this.safeAnchor, this.vp.scale * factor));
  }

  /** Step to the next notch, so repeated presses land on round numbers. */
  zoomStep(direction: 1 | -1): void {
    const current = this.vp.scale;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((s) => s > current + 0.001) ?? MAX_SCALE)
        : ([...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ??
          MIN_SCALE);
    this.set(zoomAt(this.vp, this.safeAnchor, next));
  }

  zoomTo100(): void {
    this.set(zoomAt(this.vp, this.safeAnchor, 1));
  }

  zoomToFit(): void {
    const bounds = unionRects(this.deps.getContentRects());
    if (!bounds) {
      return;
    }
    this.set(this.fitInSafe(bounds));
  }

  zoomToSelection(): void {
    const bounds = this.deps.getSelectionRect();
    if (!bounds) {
      this.zoomToFit();
      return;
    }
    // Allow magnifying past 100% here — zooming to a 24px icon is the point.
    this.set(this.fitInSafe(bounds, 96, MAX_SCALE));
  }

  /**
   * Fit an arbitrary world-space box — the public form of `fitInSafe`.
   *
   * `zoomToFit` and `zoomToSelection` both answer a question the viewport can
   * work out for itself, from its own deps. This one is for a caller that
   * already knows the box and wants the camera moved onto it: the frame list
   * flying to a row, the minimap on a double-click. Kept as a command rather
   * than exposing `fitInSafe` directly so the safe-area arithmetic stays the
   * one thing it is, and every caller lands on `set`.
   */
  fitToRect(bounds: Rect, padding?: number, maxScale?: number): void {
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    this.set(this.fitInSafe(bounds, padding, maxScale));
  }

  /**
   * Put a world point at the centre of the visible canvas, at the current zoom.
   *
   * The other half of "take me there", and deliberately not a fit: dragging the
   * minimap has to move the camera *without* changing how close you are
   * standing, or every pan would also be a zoom. Same reason a click in the
   * frame list centres rather than fits — you keep the working scale you chose
   * and only the position changes.
   */
  centerOn(point: Point): void {
    const safe = this.safeRect;
    this.set(
      this.inSafe(
        centerAt(
          point,
          { height: safe.height, width: safe.width },
          this.vp.scale
        )
      )
    );
  }

  /**
   * Fit a world-space box into the *uncovered* part of the canvas.
   *
   * `fitTo` only knows a size, so it centres within a box whose origin is the
   * canvas's own top-left. Shifting the result by the safe area's offset is
   * what moves that centre out from under the left dock.
   */
  private fitInSafe(
    bounds: Rect,
    padding?: number,
    maxScale?: number
  ): Viewport {
    return this.inSafe(fitTo(bounds, this.safeRect, padding, maxScale));
  }

  /**
   * Move a viewport computed against the safe area's *size* onto the safe
   * area's *position*.
   *
   * Both `fitTo` and `centerAt` centre within a box whose origin is `(0, 0)`,
   * which is the canvas's own top-left — so without this every aim lands in the
   * middle of the window rather than the middle of what is not covered by a
   * dock. Shared by the two so a future third command cannot forget the shift.
   */
  private inSafe(vp: Viewport): Viewport {
    const r = this.rect;
    const safe = this.safeRect;
    return {
      ...vp,
      x: vp.x + (safe.left - r.left),
      y: vp.y + (safe.top - r.top),
    };
  }

  panBy(dx: number, dy: number): void {
    this.set({ ...this.vp, x: this.vp.x - dx, y: this.vp.y - dy });
  }

  // -- Persistence -----------------------------------------------------------

  save(): void {
    try {
      localStorage.setItem(this.deps.storageKey, JSON.stringify(this.vp));
    } catch {
      // Quota or private mode — a lost pan position is not worth a crash.
    }
  }

  restore(): boolean {
    try {
      const raw = localStorage.getItem(this.deps.storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (
        parsed &&
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.scale === "number"
      ) {
        this.set(parsed);
        return true;
      }
    } catch {
      // Fall through to the default viewport.
    }
    return false;
  }

  destroy(): void {
    for (const off of this.unbind) {
      off();
    }
    this.unbind.length = 0;
    this.setHandTool(false);
  }

  // -- Input -----------------------------------------------------------------

  private bind(): void {
    const on = <K extends keyof WindowEventMap>(
      target: EventTarget,
      type: K,
      handler: (e: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions
    ): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.unbind.push(() =>
        target.removeEventListener(type, handler as EventListener, options)
      );
    };

    // Bound to the window in capture phase, not to the canvas element.
    //
    // Canvas navigation is a property of the surface, not of one node in the
    // tree. Listening on the element meant everything painted *above* it became
    // a dead zone: the drag proxy over a selection, frame titles, the canvas
    // toolbar — all of them live on the chrome layer, which is a sibling of the
    // viewport, so their events never reached it. The symptom was a canvas that
    // "skipped" precisely when you had something selected. Geometry decides
    // instead: if the pointer is over the canvas rect, the gesture is the
    // canvas's, whatever happens to be drawn there.
    //
    // With one exception, and it is the reason `isOwn` guards both handlers.
    // The canvas is full-bleed now, so its rect runs *under* the floating docks
    // rather than stopping at them — geometry alone would hand the canvas every
    // wheel over the chat transcript and every space-drag begun on a panel. The
    // editor's own chrome is the one thing that outranks the surface.
    //
    // `passive: false` is required: the default action of ⌘-wheel is the
    // browser's own page zoom, and only a non-passive listener may cancel it.
    on(window, "wheel", (e) => this.onWheel(e), {
      capture: true,
      passive: false,
    });
    on(window, "pointerdown", (e) => this.onPointerDown(e), { capture: true });
    on(window, "pointermove", (e) => this.onPointerMove(e));
    on(window, "pointerup", () => this.endPan());
    on(window, "pointercancel", () => this.endPan());
    // Space-to-pan stays on the raw pair: it is a held modifier, not a chord,
    // and the registry has no concept of a binding that is "on" between a
    // keydown and its keyup.
    on(window, "keydown", (e) => this.onSpaceDown(e));
    on(window, "keyup", (e) => this.onKeyUp(e));
    this.unbind.push(this.bindShortcuts());
    // Losing focus mid-gesture would otherwise leave the canvas stuck in
    // space-to-pan with no keyup ever arriving to clear it.
    on(window, "blur", () => {
      this.spaceDown = false;
      this.endPan();
      // The Hand is a latched tool and stays armed across a tab switch, so its
      // cursor survives the blur that clears space-to-pan's.
      this.element.classList.toggle(cls("canvas-pannable"), this.handTool);
    });
    on(window, "resize", () => this.deps.onChange(this.vp));
  }

  private onWheel(e: WheelEvent): void {
    const point = { x: e.clientX, y: e.clientY };
    if (isOwn(e.target) || !this.contains(point)) {
      return;
    }
    if (scrollableUnder(e.target, e.deltaY)) {
      return;
    }
    // The selected frame outranks the canvas, wherever the wheel was delivered.
    // After both guards above, deliberately: a wheel over a dock, or over a
    // popover that has scrolled to its end, must never be handed to a frame.
    if (this.deps.offerWheelToFrame?.(e, point, e.target)) {
      e.preventDefault();
      return;
    }
    if (this.applyWheel(e, point)) {
      e.preventDefault();
    }
  }

  /**
   * Apply a wheel gesture, wherever it came from — the shell's own listener or,
   * for a wheel that landed inside a frame, forwarded up by that frame's agent
   * (an iframe swallows wheel events entirely; they never reach the parent).
   * Returns whether the canvas consumed it, which is what tells the caller to
   * cancel the default action.
   */
  applyWheel(e: WheelLike, point: Point): boolean {
    const r = this.rect;
    const anchor = { x: point.x - r.left, y: point.y - r.top };
    const delta = pixelDelta(e);

    // ctrlKey is set both by a real ⌘/ctrl-wheel and — synthetically, by every
    // browser — by a trackpad pinch, so this one branch covers both.
    if (e.ctrlKey || e.metaKey) {
      const clamped = Math.max(
        -MAX_ZOOM_DELTA,
        Math.min(MAX_ZOOM_DELTA, delta.y)
      );
      const next = this.vp.scale * Math.exp(-clamped * WHEEL_ZOOM_SENSITIVITY);
      this.set(zoomAt(this.vp, anchor, next));
      this.markGesture();
      return true;
    }

    const { dx, dy } = axes(delta, e.shiftKey);

    // In edit mode the canvas always pans, including over a frame. Scrolling
    // the frame instead was tried and dropped — not for feel, but for intent:
    // in edit mode a wheel is aimed at the canvas you are arranging, and having
    // it scroll whichever frame happened to be under the cursor made the
    // surface feel haunted. To scroll a frame's content, switch to View — the
    // scroll position is kept when you switch back.

    this.set({ ...this.vp, x: this.vp.x - dx, y: this.vp.y - dy });
    this.markGesture();
    return true;
  }

  /** Is a screen point over the canvas? */
  contains(point: Point): boolean {
    const r = this.rect;
    return (
      point.x >= r.left &&
      point.x <= r.left + r.width &&
      point.y >= r.top &&
      point.y <= r.top + r.height
    );
  }

  private onPointerDown(e: PointerEvent): void {
    const middle = e.button === 1;
    // The Hand claims the *primary* button only. Space-pan is left as it was —
    // it is a held modifier, so whichever button the hand happens to be on is
    // the one that was meant.
    const hand = this.handTool && e.button === 0;
    if (!(middle || hand || this.spaceDown)) {
      return;
    }
    if (isOwn(e.target) || !this.contains({ x: e.clientX, y: e.clientY })) {
      return;
    }
    // The Hand moves the *surface*, so it steps aside for a press aimed at one
    // frame's title or grips: grabbing "Desktop" should move Desktop, not carry
    // every frame on the canvas along with it.
    //
    // A CSS `pointer-events: none` on the furniture is not enough to hand the
    // press over, which is why this guard is here rather than in the stylesheet.
    // This listener is on `window` in capture and calls `stopPropagation`, while
    // dnd-kit binds `pointerdown` on the draggable element itself — so the
    // capture pass has to decline before the element ever gets a chance.
    //
    // Space-drag and middle-drag keep outranking everything, which is their
    // whole point: they are transient, so there is no mode to be confused about.
    if (hand && !(middle || this.spaceDown) && isFrameChrome(e.target)) {
      return;
    }
    // Space-pan, middle-drag and the Hand outrank everything: they must work even
    // when the press lands on a frame's capture plane or a selection handle.
    e.preventDefault();
    e.stopPropagation();
    this.panning = {
      origin: { x: e.clientX, y: e.clientY },
      start: { x: this.vp.x, y: this.vp.y },
    };
    this.element.classList.add(cls("canvas-panning"));
  }

  private onPointerMove(e: PointerEvent): void {
    const pan = this.panning;
    if (!pan) {
      return;
    }
    this.set({
      ...this.vp,
      x: pan.start.x + (e.clientX - pan.origin.x),
      y: pan.start.y + (e.clientY - pan.origin.y),
    });
  }

  private endPan(): void {
    if (!this.panning) {
      return;
    }
    this.panning = null;
    this.element.classList.remove(cls("canvas-panning"));
    // A drag-pan suppressed hover for its whole duration, and the pointer is
    // now over whatever the canvas slid under it. Same trailing edge the wheel
    // gesture has, reached by a different route.
    this.deps.onGestureEnd?.();
    this.save();
  }

  private onSpaceDown(e: KeyboardEvent): void {
    // `isInsidePopover` as well as `isTypingTarget`: this is a raw listener
    // rather than a binding, so it has to ask both questions the registry asks.
    // Without it, space inside an open menu armed the pan modifier on the canvas
    // behind it — and the `preventDefault` below swallowed the keystroke that
    // should have activated the focused row.
    if (
      isTypingTarget(e.target) ||
      isInsidePopover(e.target) ||
      e.code !== "Space" ||
      this.spaceDown
    ) {
      return;
    }
    this.spaceDown = true;
    this.element.classList.add(cls("canvas-pannable"));
    // Stop the space bar from scrolling the shell or activating a focused
    // button while it is acting as the pan modifier.
    e.preventDefault();
  }

  /** The zoom set, declared once. `physicalKey` handles the ⇧1 → "!" problem. */
  private bindShortcuts(): () => void {
    const zoom = (fn: () => void) => () => {
      fn();
      this.save();
    };
    return keys.bindAll([
      {
        keys: "mod+=",
        label: "Zoom in",
        run: zoom(() => this.zoomStep(1)),
      },
      {
        keys: "mod+-",
        label: "Zoom out",
        run: zoom(() => this.zoomStep(-1)),
      },
      {
        keys: "mod+0, shift+0",
        label: "Zoom to 100%",
        run: zoom(() => this.zoomTo100()),
      },
      {
        keys: "shift+1",
        label: "Zoom to fit",
        run: zoom(() => this.zoomToFit()),
      },
      {
        keys: "shift+2",
        label: "Zoom to selection",
        run: zoom(() => this.zoomToSelection()),
      },
    ]);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code !== "Space") {
      return;
    }
    this.spaceDown = false;
    // Not an unconditional remove: space and the Hand tool both put the canvas
    // in the grab cursor, and releasing the transient one must not clear the
    // latched one.
    this.element.classList.toggle(cls("canvas-pannable"), this.handTool);
    this.endPan();
  }

  // -- Transform -------------------------------------------------------------

  private apply(): void {
    this.world.style.transform = `translate(${this.vp.x}px, ${this.vp.y}px) scale(${this.vp.scale})`;
    // Coalesce to one notification per frame: a wheel can fire many times per
    // frame and every listener downstream re-measures rects.
    if (this.frameRequest) {
      return;
    }
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.deps.onChange(this.vp);
    });
  }

  /**
   * Mark a wheel gesture as in flight and disarm shortly after the last event.
   * While it is set, the world stops hit-testing — without that, every frame of
   * a pan drives an `elementFromPoint` into a moving iframe, which is both
   * wasted work and a source of flickering hover highlights.
   */
  private markGesture(): void {
    this.element.classList.add(cls("canvas-gesture"));
    clearTimeout(this.gestureTimer);
    this.gestureTimer = window.setTimeout(() => {
      // Cleared first: `isWheeling` reads this handle, so leaving it set would
      // latch the canvas as "mid-gesture" forever after the first wheel.
      this.gestureTimer = 0;
      this.element.classList.remove(cls("canvas-gesture"));
      this.deps.onGestureEnd?.();
      this.save();
    }, 120);
  }

  /** Convert a screen point to world space using this viewport's own rect. */
  toWorld(point: Point): Point {
    return screenToWorld(this.vp, this.rect, point);
  }
}
