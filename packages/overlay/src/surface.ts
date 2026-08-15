import type { ElementContext, SourceLocation } from "@airship/protocol";
import type { TokenScanResult } from "@airship/protocol/tokens";
import { extractElementInfo } from "@airship/source/browser";
import type { Frame, FrameManager } from "./canvas/frames";
import {
  clipTo,
  frameChain,
  frameScreenRect,
  frameToScreen,
  intersectRects,
  MAX_NEST_DEPTH,
  nestOffset,
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

/**
 * The app node under a point in one document, looking *through* the editor's
 * own chrome. `elementsFromPoint` rather than `elementFromPoint`, because
 * chrome that is deliberately opaque to the pointer (the reorder drag proxy,
 * see `InlineSurface.elementAtScreen`'s history) must not win the hit; the
 * single-element form is the fallback for engines without the stack API —
 * which includes happy-dom, where this package's DOM tests run.
 */
function hitTestIn(doc: Document, point: Point): Element | null {
  const probe = doc.elementsFromPoint?.bind(doc);
  if (!probe) {
    return doc.elementFromPoint(point.x, point.y);
  }
  for (const node of probe(point.x, point.y)) {
    if (!isEditorNode(node)) {
      return node;
    }
  }
  return null;
}

/**
 * Step from a surface into the same-origin iframe under the point, repeatedly,
 * and return the deepest surface. This is what makes a document nested inside
 * a frame (Storybook's preview) pickable rather than one opaque `<iframe>`
 * box. A cross-origin iframe stays an opaque leaf: `contentDocument` is null
 * or throws, and the descent stops at the surface above it.
 */
function descend(
  surface: Surface,
  point: Point,
  nestedFor: (win: Window, doc: Document) => Surface | null
): Surface {
  let current = surface;
  for (let depth = 0; depth < MAX_NEST_DEPTH; depth += 1) {
    const hit = current.elementAtScreen(point);
    if (hit?.tagName !== "IFRAME") {
      return current;
    }
    let doc: Document | null;
    try {
      doc = (hit as HTMLIFrameElement).contentDocument;
    } catch {
      return current;
    }
    const win = doc?.defaultView;
    if (!(doc && win)) {
      return current;
    }
    const next = nestedFor(win, doc);
    if (!next) {
      return current;
    }
    current = next;
  }
  return current;
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
    return hitTestIn(document, point);
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

let nestedSeq = 0;

/** Debugger-friendly ids; nothing in production reads `Surface.id`. */
function nextNestedId(prefix: string): string {
  nestedSeq += 1;
  return `${prefix}/nested:${nestedSeq}`;
}

/**
 * A same-origin document nested inside the inline surface — the app's own
 * iframe holding the content. Scale is 1 and the composition is a plain
 * translation. No agent is ever injected here: under inline mode the proxy
 * deliberately passes third-party iframes through, so `extract` runs the
 * shell's copy and source resolution may be missing where the fiber carries
 * no owner stack.
 */
class InlineNestedSurface implements Surface {
  readonly id = nextNestedId("inline");
  readonly scale = 1;
  private readonly nestedWin: Window;

  constructor(win: Window) {
    this.nestedWin = win;
  }

  get doc(): Document {
    return this.nestedWin.document;
  }

  get win(): Window {
    return this.nestedWin;
  }

  get isLive(): boolean {
    try {
      return Boolean(this.chain() && this.nestedWin.document?.body);
    } catch {
      return false;
    }
  }

  bounds(): Rect | null {
    const chain = this.chain();
    if (!chain) {
      return null;
    }
    const [inner] = chain;
    const offset = nestOffset(chain);
    return {
      height: inner.clientHeight,
      left: offset.x,
      top: offset.y,
      width: inner.clientWidth,
    };
  }

  toScreen(rect: Rect): Rect {
    const offset = this.offset();
    return {
      height: rect.height,
      left: rect.left + offset.x,
      top: rect.top + offset.y,
      width: rect.width,
    };
  }

  toLocal(point: Point): Point {
    const offset = this.offset();
    return { x: point.x - offset.x, y: point.y - offset.y };
  }

  elementAtScreen(point: Point): Element | null {
    if (!this.isLive) {
      return null;
    }
    return hitTestIn(this.doc, this.toLocal(point));
  }

  extract(
    node: Element
  ): Promise<{ context: ElementContext; source: SourceLocation | null }> {
    return extractElementInfo(node);
  }

  scanTokens(): TokenScanResult {
    // Same origin and same realm access, so a direct scan works inline.
    return scanRuntimeTokens(this.doc, this.win);
  }

  /** Re-derived per call: an HMR reload or a navigation replaces the iframe
   * elements with no event to invalidate on. */
  private chain(): HTMLIFrameElement[] | null {
    const chain = frameChain(this.nestedWin, window);
    return chain && chain.length > 0 ? chain : null;
  }

  private offset(): Point {
    const chain = this.chain();
    return chain ? nestOffset(chain) : { x: 0, y: 0 };
  }
}

export class InlineResolver implements SurfaceResolver {
  private readonly surface = new InlineSurface();
  /** Keyed weakly by document, so surface identity is stable across pointer
   * moves (the picker compares surfaces by identity) and dies with the doc. */
  private readonly nested = new WeakMap<Document, InlineNestedSurface>();

  all(): Surface[] {
    return [this.surface];
  }

  at(point: Point): Surface {
    return descend(this.surface, point, (win, doc) => this.nestedFor(win, doc));
  }

  of(node: Node | null): Surface {
    const doc = node ? (node.ownerDocument ?? (node as Document)) : null;
    if (!doc || doc === document) {
      return this.surface;
    }
    const win = doc.defaultView;
    if (!(win && frameChain(win, window)?.length)) {
      return this.surface;
    }
    return this.nestedFor(win, doc);
  }

  private nestedFor(win: Window, doc: Document): InlineNestedSurface {
    let surface = this.nested.get(doc);
    if (!surface || surface.win !== win) {
      surface = new InlineNestedSurface(win);
      this.nested.set(doc, surface);
    }
    return surface;
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
    return hitTestIn(doc, this.toLocal(point));
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

/**
 * A same-origin document nested inside a frame — Storybook's preview iframe
 * is the canonical case. Its own document stays `doc`, so every
 * within-one-document consumer (the marquee, the drag ghost, the DOM tree)
 * keeps working untouched; only the coordinate methods compose the chain of
 * ancestor iframes, and `extract`/`scanTokens` route to the *nested*
 * document's own agent.
 */
export class NestedSurface implements Surface {
  readonly frame: Frame;
  readonly id: string;
  private readonly nestedWin: Window;
  private readonly getScale: () => number;

  constructor(frame: Frame, nestedWin: Window, getScale: () => number) {
    this.frame = frame;
    this.id = nextNestedId(frame.id);
    this.nestedWin = nestedWin;
    this.getScale = getScale;
  }

  get scale(): number {
    return this.getScale();
  }

  get doc(): Document {
    return this.nestedWin.document;
  }

  get win(): Window {
    return this.nestedWin;
  }

  get isLive(): boolean {
    try {
      return Boolean(
        this.frame.doc?.body && this.chain() && this.nestedWin.document?.body
      );
    } catch {
      return false;
    }
  }

  /** The frame's rect clipped to the nested viewport, so chrome over an
   * element scrolled out of the preview pane clips correctly. */
  bounds(): Rect | null {
    const chain = this.chain();
    if (!chain) {
      return null;
    }
    const [inner] = chain;
    const viewport: Rect = {
      height: inner.clientHeight,
      left: 0,
      top: 0,
      width: inner.clientWidth,
    };
    const nested = frameToScreen(
      this.frame.el,
      viewport,
      this.scale,
      nestOffset(chain)
    );
    return intersectRects(frameScreenRect(this.frame.el), nested);
  }

  toScreen(rect: Rect): Rect {
    const chain = this.chain();
    return frameToScreen(
      this.frame.el,
      rect,
      this.scale,
      chain ? nestOffset(chain) : undefined
    );
  }

  toLocal(point: Point): Point {
    const chain = this.chain();
    return screenToFrame(
      this.frame.el,
      point,
      this.scale,
      chain ? nestOffset(chain) : undefined
    );
  }

  elementAtScreen(point: Point): Element | null {
    if (!this.isLive) {
      return null;
    }
    return hitTestIn(this.doc, this.toLocal(point));
  }

  extract(
    node: Element
  ): Promise<{ context: ElementContext; source: SourceLocation | null }> {
    const agent = this.frame.agents.get(this.nestedWin);
    if (agent) {
      return agent.extract(node);
    }
    // The same pre-registration sliver FrameSurface documents: the shell's
    // copy resolves DOM context and may miss the source location.
    return extractElementInfo(node);
  }

  scanTokens(): TokenScanResult {
    const agent = this.frame.agents.get(this.nestedWin);
    if (agent) {
      return agent.scanTokens();
    }
    return { framework: "unknown", tokens: [] };
  }

  /** Re-derived per call — an HMR reload or a Storybook navigation replaces
   * the iframe elements with no event to invalidate on. The walk is a couple
   * of `getBoundingClientRect` calls, the order of cost `frameScreenRect`
   * already pays per conversion. */
  private chain(): HTMLIFrameElement[] | null {
    const root = this.frame.win;
    if (!root) {
      return null;
    }
    const chain = frameChain(this.nestedWin, root);
    // Length 0 would mean the frame's own document — FrameSurface's job.
    return chain && chain.length > 0 ? chain : null;
  }
}

export class CanvasResolver implements SurfaceResolver {
  private readonly cache = new Map<string, FrameSurface>();
  /** Keyed weakly by document, so nested surface identity is stable across
   * pointer moves (the picker compares surfaces by identity) and dies with
   * the document. */
  private readonly nested = new WeakMap<Document, NestedSurface>();

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
    if (!frame) {
      return null;
    }
    return descend(this.surfaceFor(frame), point, (win, doc) =>
      this.nestedFor(frame, win, doc)
    );
  }

  of(node: Node | null): Surface | null {
    const frame = this.frames.frameOf(node);
    if (!frame) {
      return null;
    }
    const doc = node ? (node.ownerDocument ?? (node as Document)) : null;
    if (!doc || doc === frame.doc) {
      return this.surfaceFor(frame);
    }
    const win = doc.defaultView;
    return win ? this.nestedFor(frame, win, doc) : this.surfaceFor(frame);
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

  private nestedFor(frame: Frame, win: Window, doc: Document): NestedSurface {
    let surface = this.nested.get(doc);
    if (!surface || surface.frame !== frame || surface.win !== win) {
      surface = new NestedSurface(frame, win, () => this.viewport.scale);
      this.nested.set(doc, surface);
    }
    return surface;
  }
}
