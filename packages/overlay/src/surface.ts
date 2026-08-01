import type { ElementContext, SourceLocation } from "@airship/protocol";
import type { TokenScanResult } from "@airship/protocol/tokens";
import { extractElementInfo } from "@airship/source/browser";
import type { Frame, FrameManager } from "./canvas/frames";
import {
  clipTo,
  frameScreenRect,
  frameToScreen,
  type Point,
  type Rect,
  screenToFrame,
} from "./canvas/space";
import type { CanvasViewport } from "./canvas/viewport";
import { isEditorNode } from "./edit-guard";
import { scanRuntimeTokens } from "./tokens/scan";

/**
 * What the editor is editing, behind one interface.
 *
 * The picker, the reorder controller and the DOM tree all need the same four
 * things — hit-test a screen point, map a measured rect back to screen space,
 * resolve a node to its source, and know where to stop drawing. In the inline
 * overlay those are trivial (the page *is* the surface, at 1:1). On the canvas
 * they involve a frame's realm and the world transform.
 *
 * Putting them behind a `Surface` means those three controllers are written
 * once. They never learn whether they are looking at a frame or at the whole
 * document, which is what keeps the inline escape hatch honest: it runs the same
 * code paths the canvas does rather than rotting as a second implementation.
 */
export interface Surface {
  /** Clip bounds for chrome drawn over this surface, or null for none. */
  bounds: () => Rect | null;
  /** The surface's document. */
  readonly doc: Document;
  /** Hit-test a point given in **screen** coordinates. */
  elementAtScreen: (point: Point) => Element | null;
  /** Resolve a node to its component context and source location. */
  extract: (
    node: Element
  ) => Promise<{ context: ElementContext; source: SourceLocation | null }>;
  /** Stable identity, for telling two frames apart. */
  readonly id: string;
  /** Is this surface still usable? A frame can unload underneath us. */
  readonly isLive: boolean;
  /** Screen px per surface px. 1 inline; the canvas zoom in a frame. */
  readonly scale: number;
  /** The design tokens this surface's stylesheets declare. */
  scanTokens: () => TokenScanResult;
  /** A screen point → this surface's own coordinates. */
  toLocal: (point: Point) => Point;
  /** A rect measured in this surface → screen coordinates. */
  toScreen: (rect: Rect) => Rect;
  /** The surface's window. */
  readonly win: Window;
}

/** Resolves which surface a point or a node belongs to. */
export interface SurfaceResolver {
  /** Every surface currently available. */
  all: () => Surface[];
  /** The surface under a screen point, or null over empty canvas. */
  at: (point: Point) => Surface | null;
  /** The surface a node lives in, or null if it is not on any of them. */
  of: (node: Node | null) => Surface | null;
}

/** Convenience: a rect from a node, measured in its own surface's space. */
export function localRect(node: Element): Rect {
  const r = node.getBoundingClientRect();
  return { height: r.height, left: r.left, top: r.top, width: r.width };
}

/**
 * Clip a screen-space box to a surface's bounds, as a `clip-path` value.
 * `"none"` when the surface has no bounds or the box already fits.
 */
export function clipToSurface(surface: Surface, box: Rect): string {
  const bounds = surface.bounds();
  return bounds ? clipTo(box, bounds) : "none";
}

// -- Inline (single-document) ------------------------------------------------

/**
 * The whole top-level document, at 1:1. Every conversion is the identity, which
 * is exactly what the overlay assumed everywhere before the canvas existed.
 */
export class InlineSurface implements Surface {
  readonly id = "inline";
  readonly scale = 1;

  get doc(): Document {
    return document;
  }

  get win(): Window {
    return window;
  }

  get isLive(): boolean {
    return true;
  }

  bounds(): Rect | null {
    return null;
  }

  toScreen(rect: Rect): Rect {
    return rect;
  }

  toLocal(point: Point): Point {
    return point;
  }

  /**
   * The app node under a point, looking *through* the editor's own overlay.
   *
   * `elementsFromPoint` rather than `elementFromPoint`, because inline the
   * editor shares a document with the app and some of its chrome is deliberately
   * opaque to the pointer. The reorder drag proxy is the one that matters: it
   * sits over the selection with `pointer-events: auto` so dnd-kit can arm a
   * grab, and it is deliberately *not* tagged as chrome for `event.target`
   * purposes (see `inspector/reorder.ts`) precisely so a click landing on it can
   * still be resolved to whatever is underneath.
   *
   * That resolution only ever worked on the canvas, where the hit-test asks
   * the *frame's* document and the proxy lives in the shell's. Inline it is one
   * document, so the topmost element genuinely was the proxy — and every gesture
   * over the current selection resolved to a chrome div. Hovering it drew a box
   * labelled `div.__airship-drag-proxy`, and double-clicking it could never
   * enter text editing, because the second click of every double-click lands on
   * the proxy the first one armed.
   */
  elementAtScreen(point: Point): Element | null {
    // Falls back to the single-element hit test where the stack API is missing,
    // which is every pre-2017 engine and — the reason it is written down —
    // happy-dom, where the rest of the package's DOM tests run.
    const probe = document.elementsFromPoint?.bind(document);
    if (!probe) {
      return document.elementFromPoint(point.x, point.y);
    }
    for (const node of probe(point.x, point.y)) {
      if (!isEditorNode(node)) {
        return node;
      }
    }
    return null;
  }

  extract(
    node: Element
  ): Promise<{ context: ElementContext; source: SourceLocation | null }> {
    return extractElementInfo(node);
  }

  scanTokens(): TokenScanResult {
    // Inline mode *is* the app's document, so there is no realm to cross.
    return scanRuntimeTokens(document, window);
  }
}

export class InlineResolver implements SurfaceResolver {
  private readonly surface = new InlineSurface();

  all(): Surface[] {
    return [this.surface];
  }

  at(): Surface {
    return this.surface;
  }

  of(): Surface {
    return this.surface;
  }
}

// -- Canvas frames -----------------------------------------------------------

/** One frame, mapped through the canvas transform. */
export class FrameSurface implements Surface {
  readonly frame: Frame;
  private readonly getScale: () => number;

  constructor(frame: Frame, getScale: () => number) {
    this.frame = frame;
    this.getScale = getScale;
  }

  get id(): string {
    return this.frame.id;
  }

  get scale(): number {
    return this.getScale();
  }

  get doc(): Document {
    // Only ever reached behind an `isLive` check; the cast keeps every call site
    // from having to narrow a document that is null for a few hundred ms at boot.
    return this.frame.doc as Document;
  }

  get win(): Window {
    return this.frame.win as Window;
  }

  get isLive(): boolean {
    return Boolean(this.frame.doc?.body);
  }

  bounds(): Rect {
    return frameScreenRect(this.frame.el);
  }

  toScreen(rect: Rect): Rect {
    return frameToScreen(this.frame.el, rect, this.scale);
  }

  toLocal(point: Point): Point {
    return screenToFrame(this.frame.el, point, this.scale);
  }

  elementAtScreen(point: Point): Element | null {
    const { doc } = this.frame;
    if (!doc) {
      return null;
    }
    const local = this.toLocal(point);
    return doc.elementFromPoint(local.x, local.y);
  }

  extract(
    node: Element
  ): Promise<{ context: ElementContext; source: SourceLocation | null }> {
    const { agent } = this.frame;
    if (agent) {
      return agent.extract(node);
    }
    // The agent registers during the frame's parse, so this is only reachable in
    // the sliver before that. Falling back to the shell's own copy keeps picking
    // responsive; it resolves the DOM context correctly and may miss the source
    // location, which the next pick — by which time the agent is up — recovers.
    return extractElementInfo(node);
  }

  scanTokens(): TokenScanResult {
    const { agent } = this.frame;
    if (agent) {
      return agent.scanTokens();
    }
    // Same pre-registration sliver as `extract`. Unlike a pick there is nothing
    // useful the shell can do from here — its document holds the editor's own
    // theme, not the app's — so report nothing and let the caller re-scan once
    // the frame is up rather than poisoning the registry with `--ap-*`.
    return { framework: "unknown", tokens: [] };
  }
}

export class CanvasResolver implements SurfaceResolver {
  private readonly cache = new Map<string, FrameSurface>();

  private readonly frames: FrameManager;
  private readonly viewport: CanvasViewport;

  constructor(frames: FrameManager, viewport: CanvasViewport) {
    this.frames = frames;
    this.viewport = viewport;
  }

  all(): Surface[] {
    return this.frames.all.map((f) => this.surfaceFor(f));
  }

  at(point: Point): Surface | null {
    const frame = this.frames.frameAt(point);
    return frame ? this.surfaceFor(frame) : null;
  }

  of(node: Node | null): Surface | null {
    const frame = this.frames.frameOf(node);
    return frame ? this.surfaceFor(frame) : null;
  }

  /** Surfaces are cached per frame so identity comparisons stay meaningful. */
  private surfaceFor(frame: Frame): FrameSurface {
    let surface = this.cache.get(frame.id);
    if (!surface || surface.frame !== frame) {
      surface = new FrameSurface(frame, () => this.viewport.scale);
      this.cache.set(frame.id, surface);
    }
    return surface;
  }
}
