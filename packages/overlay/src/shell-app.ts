import type { AirshipWindowConfig } from "@airship/protocol";
import { AirshipApp, type Stage } from "./app";
import { FrameChrome } from "./canvas/frame-chrome";
import { type Frame, FrameManager } from "./canvas/frames";
import { frameScreenRect, type Point, type Rect } from "./canvas/space";
import { CanvasViewport, type SafeInset } from "./canvas/viewport";
import {
  axes,
  type FrameWheelRoute,
  pixelDelta,
  routeWheel,
  type WheelLike,
  type WheelRouteCtx,
} from "./canvas/wheel";
import { ChromeLayer } from "./chrome-layer";
import { cls, PREFIX } from "./dom";
import type { FrameHost, FrameWheel } from "./frame-agent";
import type { Mods, Selection } from "./picker";
import { isElement } from "./realm";
import { injectStyles } from "./styles";
import { CanvasResolver, type SurfaceResolver } from "./surface";

/**
 * The canvas stage: a pan/zoom surface holding device frames, each a live copy
 * of the app.
 *
 * This document contains none of the user's code — the proxy serves a bare shell
 * here (see `packages/server/src/shell.ts`) and the app runs one realm down, in
 * the frames. Everything the editor does to those frames goes through `Surface`,
 * so the controllers themselves are the same ones the inline overlay drives.
 */
class CanvasStage implements Stage {
  readonly layer = new ChromeLayer();
  readonly resolver: SurfaceResolver;
  /** Frames are inert in edit mode, so there is nothing to swallow. */
  readonly swallowPresses = false;

  private readonly canvas: CanvasViewport;
  private readonly frames: FrameManager;
  private readonly chrome: FrameChrome;
  private readonly listeners: (() => void)[] = [];
  /** Subscribers to the trailing edge of a pan/zoom — see `isGesturing`. */
  private readonly gestureEndListeners: (() => void)[] = [];
  /** Per-frame unsubscribers for agent layout notifications. */
  private readonly frameUnsubs = new Map<string, () => void>();
  private getSelection: (() => Selection | null) | null = null;
  /** Where a press inside a live frame goes. Set by `bindFramePress`. */
  private reportFramePress:
    | ((at: Point, mods: Mods, dbl: boolean) => void)
    | null = null;
  private editing = true;
  /** What the open docks are covering. Written by the app on every toggle and
   * splitter drag; read by the viewport whenever it has to aim at the canvas. */
  private safeInset: SafeInset = { left: 0, right: 0 };
  /** A wheel gesture latched to the selected frame — see `scrollFrame`. */
  private frameGesture: {
    pending: Point;
    raf: number;
    route: FrameWheelRoute;
    timer: number;
  } | null = null;

  constructor(config: AirshipWindowConfig) {
    const key = `${PREFIX}-canvas:${window.location.pathname}`;
    this.canvas = new CanvasViewport({
      getContentRects: () => this.frames.worldRects(),
      getSafeInset: () => this.safeInset,
      getSelectionRect: () => this.selectionWorldRect(),
      offerWheelToFrame: (e, point, target) =>
        this.offerWheelToFrame(e, point, target),
      onChange: () => this.onViewportChange(),
      onGestureEnd: () => this.emitGestureEnd(),
      storageKey: `${key}:viewport`,
    });
    this.frames = new FrameManager({
      onChanged: () => this.onFramesChanged(),
      onFrameReady: (frame) => this.onFrameReady(frame),
      pathname: config.pathname ?? "/",
      storageKey: `${key}:frames`,
      world: this.canvas.world,
    });
    this.chrome = new FrameChrome({
      frames: this.frames,
      inCanvas: (point) => this.canvas.contains(point),
      layer: this.layer,
      onChanged: () => this.onFramesChanged(),
      viewport: this.canvas,
    });
    this.resolver = new CanvasResolver(this.frames, this.canvas);
  }

  /**
   * A wheel that happened inside a frame, forwarded up by that frame's agent.
   *
   * In view mode the frame is interactive, so the wheel lands in the frame's own
   * document and the shell never sees it — which is why ⌘-wheel over a frame did
   * nothing at all. The agent hands it over here; the only work is mapping the
   * frame's coordinates into screen space, which is both what the zoom anchor
   * needs and what lets `routeWheel` answer in the one coordinate space it
   * accepts. Who owns the wheel is decided there, not here — see `wheel.ts`.
   *
   * The frame's scroll is synthesised, never left to the browser. Declining —
   * returning false so the uncancelled wheel scrolls the frame natively — was
   * tried first, for the OS momentum fling, and is what made a selected frame
   * randomly refuse to scroll: for an iframe under the canvas's scaled,
   * composited transform, Chrome's wheel hit test intermittently fails to find
   * the frame's scroller at all, and an *uncancelled wheel over a scrollable
   * document simply does nothing* until some unrelated style invalidation
   * inside the frame wakes it (which is why resizing or poking the frame
   * "fixed" it). Scrolling the routed target ourselves is deterministic in
   * every compositor state, and the fling survives regardless: macOS keeps
   * delivering the momentum events, exactly as the canvas pan relies on.
   */
  private onFrameWheel(win: Window, e: FrameWheel): boolean {
    const frame = this.frames.all.find((f) => f.win === win);
    if (!frame) {
      return false;
    }
    // The point arrives in the frame's own client coordinates; `routeWheel`
    // takes shell screen space and maps back. Round-tripping it rather than
    // adding a second entry point is what stops the two routes disagreeing.
    const origin = frameScreenRect(frame.el);
    const { scale } = this.canvas;
    const screen = {
      x: origin.left + e.clientX * scale,
      y: origin.top + e.clientY * scale,
    };
    // Frames may overlap, so route only when *this* frame is the selected one.
    // Without it, a wheel in an unselected frame sitting over the selected one
    // would pass the geometry test and scroll the wrong frame.
    const route =
      !this.editing && this.frames.active?.id === frame.id
        ? (this.latchedRoute(frame.id, e) ??
          routeWheel(e, screen, this.wheelCtx()))
        : null;
    if (route) {
      this.scrollFrame(route, e);
      return true;
    }
    return this.canvas.applyWheel(
      // The frame is not taking this one, so the intent is a canvas gesture;
      // suppress the frame branch in `applyWheel`, which would otherwise hand it
      // straight back.
      { ...e, altKey: true },
      screen
    );
  }

  /**
   * A wheel the *shell* received, offered to the selected frame before the
   * canvas takes it.
   *
   * Everything a frame is covered or edged by is chrome in this document — the
   * title, the size badge, the eight resize grips — and a frame that has not
   * loaded yet has no document of its own at all. Those wheels never reached
   * `onFrameWheel`, so they panned, one pixel from a gesture that scrolled.
   */
  private offerWheelToFrame(
    e: WheelLike,
    screen: Point,
    target: EventTarget | null
  ): boolean {
    // Edit mode always pans, including over a frame — see `applyWheel`.
    if (this.editing) {
      return false;
    }
    const { active } = this.frames;
    const route =
      (active && this.latchedRoute(active.id, e)) ??
      routeWheel(e, screen, {
        ...this.wheelCtx(),
        onOwnChrome: this.isOwnFrameChrome(target),
      });
    if (!route) {
      return false;
    }
    this.scrollFrame(route, e);
    // Deliberately no `markGesture`: no canvas gesture happened.
    return true;
  }

  /**
   * Apply an owned wheel to the frame — one routine for both entry points.
   *
   * Divided by the canvas scale for the same reason `FrameChrome.onDragMove`
   * divides its drag deltas: the gesture happens in screen pixels, but the
   * scroll target is laid out in the frame's own units. At 50% zoom a 120px
   * wheel tick has to scroll 240 frame pixels for the content to track the
   * fingers 1:1 on screen — applied raw, the scroll visibly lagged the gesture
   * by exactly the zoom factor.
   *
   * Beyond the arithmetic, this latches and coalesces, and both are why the
   * first version felt laggy. A trackpad delivers wheels faster than frames
   * paint, and answering each one from scratch meant a `getBoundingClientRect`
   * in the shell plus an `elementFromPoint` and a computed-style walk inside a
   * live React app — layout-forcing work, per event, before any pixel moved.
   * So: the first owned wheel routes and *latches* its target for the whole
   * gesture (the same rule native scrolling and the canvas's `isWheeling`
   * already follow — an owner does not change hands mid-fling), and deltas
   * accumulate to be flushed as one `scrollBy` per animation frame, which is
   * also one scroll event per paint for the app's own listeners instead of
   * five.
   */
  private scrollFrame(route: FrameWheelRoute, e: WheelLike): void {
    const { dx, dy } = axes(pixelDelta(e), e.shiftKey);
    let g = this.frameGesture;
    if (g?.route.frame.id !== route.frame.id) {
      this.dropFrameGesture();
      g = {
        pending: { x: 0, y: 0 },
        raf: 0,
        route,
        timer: 0,
      };
      this.frameGesture = g;
    }
    // Fractional deltas accumulate here rather than being rounded away one
    // 2px trackpad event at a time.
    const { scale } = this.canvas;
    g.pending.x += dx / scale;
    g.pending.y += dy / scale;
    if (!g.raf) {
      g.raf = requestAnimationFrame(() => this.flushFrameScroll());
    }
    // Same disarm window as the canvas's `markGesture`: the gesture is over
    // once the events stop, momentum included.
    clearTimeout(g.timer);
    g.timer = window.setTimeout(() => this.dropFrameGesture(), 120);
  }

  /**
   * The gesture's latched route, if this wheel still belongs to it. Mirrors
   * `routeWheel`'s first guard: zoom chords and the canvas's alt sentinel are
   * never part of a scroll gesture, and a latch held for a deselected frame is
   * dead — `frameGesture` outliving a selection change is the 120ms tail.
   */
  private latchedRoute(frameId: string, e: WheelLike): FrameWheelRoute | null {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return null;
    }
    const g = this.frameGesture;
    return g && g.route.frame.id === frameId ? g.route : null;
  }

  private flushFrameScroll(): void {
    const g = this.frameGesture;
    if (!g) {
      return;
    }
    g.raf = 0;
    const { x, y } = g.pending;
    g.pending = { x: 0, y: 0 };
    try {
      // "instant", not "auto". A native wheel scroll ignores the page's CSS
      // `scroll-behavior`; "auto" re-applies it, so an app declaring `smooth`
      // turned every flush into an eased animation — and each next flush
      // aborted the one before it mid-flight, silently discarding whatever
      // distance had not animated yet. A fast gesture lost more than half its
      // travel that way, which read as the scroll being "slow".
      g.route.target.scrollBy({ behavior: "instant", left: x, top: y });
    } catch {
      // The frame reloaded or was removed mid-gesture; its realm is gone.
      this.dropFrameGesture();
    }
  }

  private dropFrameGesture(): void {
    const g = this.frameGesture;
    if (!g) {
      return;
    }
    cancelAnimationFrame(g.raf);
    clearTimeout(g.timer);
    this.frameGesture = null;
  }

  /**
   * Is this node the *selected* frame's own furniture? Read off `data-frame`
   * rather than geometry, because the title is drawn above the frame it names
   * and a grip straddles its edge — see `FrameChrome.render`.
   */
  private isOwnFrameChrome(target: EventTarget | null): boolean {
    const { active } = this.frames;
    if (!(active && isElement(target))) {
      return false;
    }
    const box = target.closest(`.${cls("fc")}`);
    return box?.getAttribute("data-frame") === active.id;
  }

  private wheelCtx(): WheelRouteCtx {
    return {
      activeFrame: this.frames.active,
      gesturing: this.canvas.isWheeling,
      scale: this.canvas.scale,
    };
  }

  /** `F` opens the canvas's own add-frame menu — the `+` button's shortcut. */
  addFrame(): void {
    this.chrome.openAddMenu();
  }

  /** The bar's view-mode slot for the selected frame's verbs. */
  mountFrameTools(host: HTMLElement): void {
    this.chrome.mountFrameTools(host);
  }

  bindFramePress(report: (at: Point, mods: Mods, dbl: boolean) => void): void {
    this.reportFramePress = report;
  }

  /**
   * A node is being edited in place — make its frame live, and arm that frame's
   * own press guard so the app underneath still cannot act.
   *
   * The two halves are inseparable: the first is what makes a caret placeable,
   * the second is what replaces the guarantee the capture plane was giving.
   * Shipping one without the other would either leave the caret unreachable or
   * hand the app back its clicks.
   */
  setTextOwner(node: Element | null): void {
    const frame = node ? this.frames.frameOf(node) : null;
    this.frames.setTextFrame(frame);
    for (const f of this.frames.all) {
      f.agent?.setTextGuard(f === frame);
    }
  }

  mount(tools: HTMLElement): void {
    const host = window as unknown as FrameHost;
    host.__airshipOnFrameWheel = (win, e) => this.onFrameWheel(win, e);
    // A press inside a frame selects it, matching a press on its title. View
    // mode is the only route *and* the only mode this is allowed in: in edit
    // mode the frame is inert behind its capture plane so the event should never
    // arrive, but the guard is written down rather than left to that — frame
    // selection is view-mode-only now, and this is the second door into it.
    host.__airshipOnFramePress = (win) => {
      if (this.editing) {
        return;
      }
      const frame = this.frames.all.find((f) => f.win === win);
      if (frame) {
        this.frames.setActive(frame.id);
      }
    };
    // The click-away route out of a frame that is live for a text edit. Mapped
    // frame → screen with exactly the transform `onFrameWheel` uses, so the
    // point lands back in the space `SelectionController.hitTest` expects and
    // both routes stay one code path.
    host.__airshipOnFrameTextPress = (win, e) => {
      const frame = this.frames.all.find((f) => f.win === win);
      if (!frame) {
        return;
      }
      const origin = frameScreenRect(frame.el);
      const { scale } = this.canvas;
      this.reportFramePress?.(
        {
          x: origin.left + e.clientX * scale,
          y: origin.top + e.clientY * scale,
        },
        { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey },
        e.dbl
      );
    };
    document.body.append(this.canvas.element);
    this.layer.mount(document.body);
    this.chrome.mount(tools);

    // Read the saved viewport *before* touching frames. Adding a frame fires
    // `onChanged`, which persists the layout — and the viewport along with it —
    // so asking afterwards would always find the default `{0,0,1}` this session
    // had just written and would never fit the canvas on a first run.
    const hadViewport = this.canvas.restore();
    if (!this.frames.restore()) {
      // First run: the two breakpoints worth seeing side by side. Anything more
      // opinionated would be guessing at a project we know nothing about.
      this.frames.add({ presetId: "desktop" });
      this.frames.add({ presetId: "iphone-16" });
    }
    if (!hadViewport) {
      this.canvas.zoomToFit();
    }
    this.frames.setEditing(this.editing);
    this.chrome.setEditing(this.editing);
    this.relayout();
  }

  bindSelection(get: () => Selection | null): void {
    this.getSelection = get;
  }

  /**
   * Wheel momentum counts, not just the pointer drag.
   *
   * This used to report `isPanning` alone, so the moment a trackpad flick lifted
   * the fingers hover work resumed — while the canvas was still gliding. Every
   * `mousemove` arriving during the deceleration hit-tested into a frame that
   * was moving under it, which is the strobe this flag exists to prevent.
   */
  isGesturing(): boolean {
    return this.canvas.isPanning || this.canvas.isWheeling;
  }

  onLayoutChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  onGestureEnd(cb: () => void): void {
    this.gestureEndListeners.push(cb);
  }

  setSafeInset(inset: SafeInset): void {
    this.safeInset = inset;
  }

  setHandTool(on: boolean): void {
    this.canvas.setHandTool(on);
  }

  setEditing(on: boolean): void {
    this.editing = on;
    // A latched scroll must not survive into a mode where frames are inert.
    this.dropFrameGesture();
    // Two things change, in opposite directions. The frames themselves go inert
    // behind their capture planes in edit mode and live in view mode; the
    // furniture *around* them goes the other way — interactive in view mode,
    // visible but inert in edit. See the note above `FrameChrome.setEditing`.
    this.frames.setEditing(on);
    this.chrome.setEditing(on);
  }

  relayout(): void {
    // The canvas is full-bleed, so this fence is the whole window; the docks
    // keep chrome out by painting over it, not by clipping it (see
    // `chrome-layer.ts`). Kept so the layer still tracks the viewport's bounds.
    this.layer.setClip(this.canvas.rect);
    this.frames.updateMounts(this.canvas.rect);
    this.chrome.render();
    this.notify();
  }

  /**
   * After an edit lands, every frame reloads itself over HMR — independently,
   * and on its own schedule. Each one re-registers its agent as it comes back
   * (see `onFrameReady`), which is what re-anchors the chrome; there is nothing
   * to do here but persist the layout, since the user has likely been
   * rearranging frames while waiting.
   */
  afterApply(): void {
    this.save();
  }

  // -- Internals -------------------------------------------------------------

  private onViewportChange(): void {
    this.frames.updateMounts(this.canvas.rect);
    this.chrome.render();
    this.notify();
  }

  private onFramesChanged(): void {
    this.frames.updateMounts(this.canvas.rect);
    this.chrome.render();
    this.notify();
    this.save();
  }

  /**
   * A frame published its agent — on first load, and again after every HMR full
   * reload, which rebuilds the frame's realm from scratch.
   *
   * Re-subscribing here rather than once at construction is the point: listeners
   * bound to the old realm died with it, and nothing else would tell us. Without
   * this, outlines would freeze in place the first time the user edited a file.
   */
  private onFrameReady(frame: Frame): void {
    this.frameUnsubs.get(frame.id)?.();
    const off = frame.agent?.onLayoutChange(() => this.notify());
    if (off) {
      this.frameUnsubs.set(frame.id, off);
    }
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }

  private emitGestureEnd(): void {
    for (const cb of this.gestureEndListeners) {
      cb();
    }
  }

  /**
   * The selection's rect in world space, for zoom-to-selection.
   *
   * The selection is measured in its frame's coordinates, so it has to be
   * offset by that frame's world position — the same node at the same CSS
   * position sits somewhere different on the canvas depending on which frame it
   * is in, which is the whole reason frames have coordinates.
   */
  private selectionWorldRect(): Rect | null {
    const sel = this.getSelection?.();
    const frame = this.frames.frameOf(sel?.node ?? null);
    if (!(sel && frame)) {
      return null;
    }
    return {
      height: sel.rect.height,
      left: frame.x + sel.rect.left,
      top: frame.y + sel.rect.top,
      width: sel.rect.width,
    };
  }

  private save(): void {
    this.frames.save();
    this.canvas.save();
  }
}

export function bootShell(config: AirshipWindowConfig): void {
  const w = window as unknown as { __airshipBooted?: boolean };
  if (w.__airshipBooted) {
    return;
  }
  w.__airshipBooted = true;
  document.documentElement.setAttribute(`data-${PREFIX}-shell`, "");
  injectStyles();
  const stage = new CanvasStage(config);
  const app = new AirshipApp(config, stage);
  app.mount();
}
