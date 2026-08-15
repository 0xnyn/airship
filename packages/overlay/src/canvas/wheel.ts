import type { Frame } from "./frames";
import {
  MAX_NEST_DEPTH,
  type Point,
  screenPointInFrame,
  screenToFrame,
} from "./space";

/**
 * Who owns a wheel — the selected frame, or the canvas?
 *
 * The rule is one sentence, but it has to be answered from two realms. A wheel
 * over a frame lands in *that frame's* document and is forwarded up by its agent
 * (`frame-agent.ts`); a wheel over the canvas, over a frame's title or grips, or
 * over a frame that has not loaded yet lands in the shell's. Both used to decide
 * for themselves and only one of them knew frames existed, so the answer
 * depended on which document happened to receive the event. It is decided here
 * now, once, and both entry points ask.
 *
 * **Selection decides.** Over the selected frame a plain wheel is that frame's
 * scrolling; anywhere else it pans the canvas. Selection is what makes this
 * legible — you can see which frame is outlined, and change it with a click.
 *
 * Two worse rules were tried first. Always letting the frame scroll meant the
 * canvas went unreachable wherever frames covered it. Deciding from whether the
 * frame could *still* scroll meant the answer flipped mid-gesture: reach the
 * bottom of a page and the whole canvas lurched sideways, which is the browser's
 * scroll-chaining behaviour applied somewhere it does not belong — an infinite
 * canvas is not a bigger version of the page inside it.
 *
 * A selected frame therefore owns the wheel completely, ends included, the same
 * as `overscroll-behavior: contain`. A frame with nothing to scroll hands it
 * over regardless, so a short page is not a dead patch.
 */

/**
 * A wheel event's delta is only meaningful together with its `deltaMode`, and
 * ours is the only code that has to care — a natively-scrolling document gets
 * the conversion from the browser for free.
 *
 * Trackpads report pixels, but most mouse wheels report *lines* (a notch is
 * `deltaY: 3`, not `deltaY: 120`) and some report pages. Reading those as pixels
 * makes one notch scroll three pixels instead of ~120, which is what made
 * scrolling a frame in edit mode feel sluggish next to the same gesture in view
 * mode, where the browser is doing the conversion. It equally flattened zoom and
 * canvas panning on a mouse.
 *
 * The line and page figures match what browsers use for a wheel tick.
 */
const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

/** The `overflow` values that make a box its own scroll container. */
export const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

export interface WheelLike {
  altKey: boolean;
  ctrlKey: boolean;
  deltaMode?: number;
  deltaX: number;
  deltaY: number;
  metaKey: boolean;
  shiftKey: boolean;
}

/** `deltaMode`: 0 is pixels, 1 is lines, 2 is pages. */
function deltaUnit(deltaMode: number | undefined): number {
  if (deltaMode === 1) {
    return LINE_HEIGHT;
  }
  if (deltaMode === 2) {
    return PAGE_HEIGHT;
  }
  return 1;
}

export function pixelDelta(e: WheelLike): Point {
  const unit = deltaUnit(e.deltaMode);
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

/**
 * Shift swaps the axes for mice with only a vertical wheel. Written once, and
 * always applied to *normalised* deltas: doing it to the raw pair, which is what
 * the frame route used to do, meant a mouse's `deltaY: 3` was compared against a
 * trackpad's pixels a line later.
 */
export function axes(
  delta: Point,
  shiftKey: boolean
): { dx: number; dy: number } {
  return shiftKey ? { dx: delta.y, dy: delta.x } : { dx: delta.x, dy: delta.y };
}

/**
 * Something that can be scrolled, duck-typed rather than checked with
 * `instanceof`. These come out of the *frame's* realm, where `Element` and
 * `Window` are different objects than the shell's — see `../realm.ts`. It also
 * means `Element` and `Window` need no branch between them at the call site.
 */
export interface ScrollTarget {
  scrollBy: (options: ScrollToOptions) => void;
}

export interface WheelRouteCtx {
  activeFrame: Frame | null;
  /** Is a canvas wheel gesture already in flight? See `CanvasViewport.isWheeling`. */
  gesturing: boolean;
  /**
   * Did this wheel land on the selected frame's own furniture — its title, size
   * badge or a resize grip? Those are drawn on the chrome layer in screen space
   * and the title sits *above* the frame (`.fc-label` is `bottom: 100%`), so
   * geometry alone would call them "not over the frame" and pan. They belong to
   * the frame as much as its body does.
   */
  onOwnChrome?: boolean;
  scale: number;
}

export interface FrameWheelRoute {
  frame: Frame;
  /** Where the wheel is, in the frame's own viewport coordinates. */
  point: Point;
  target: ScrollTarget;
}

/**
 * Who owns this wheel? `null` means the canvas.
 *
 * `screen` is always the *shell's* screen space; a caller holding frame
 * coordinates maps them first, which is what keeps the two entry points from
 * being able to disagree.
 */
export function routeWheel(
  e: WheelLike,
  screen: Point,
  ctx: WheelRouteCtx
): FrameWheelRoute | null {
  // ⌘/ctrl-wheel and pinch are zoom, and alt is the sentinel a caller sets to
  // say "this one is the canvas's, do not hand it back".
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null;
  }
  const frame = ctx.activeFrame;
  const win = frame?.win;
  if (!(frame && win && frame.mounted)) {
    return null;
  }
  // A gesture does not change hands before it ends. Trackpad momentum keeps
  // firing wheels for a second or more after the fingers lift, so without this
  // a fling the canvas legitimately owns would start scrolling the frame the
  // moment the pointer drifted over it.
  if (ctx.gesturing) {
    return null;
  }
  if (!(ctx.onOwnChrome || screenPointInFrame(frame.el, screen))) {
    return null;
  }
  // Deliberately not clamped into the frame. A point over the title is above the
  // frame's top edge, so `elementFromPoint` finds nothing and the walk-up is
  // skipped — leaving the document fallback to answer, which is the right answer
  // for a gesture aimed at the frame as a whole rather than at a pane inside it.
  const point = screenToFrame(frame.el, screen, ctx.scale);
  const { dx, dy } = axes(pixelDelta(e), e.shiftKey);
  const target = scrollTargetAt(win, point, dx, dy);
  return target ? { frame, point, target } : null;
}

/**
 * The nearest thing under the pointer with anything to scroll, or `null`.
 *
 * Measuring the *document* alone — which is all this used to do — is wrong for
 * one very ordinary shape of app: a `height: 100vh; overflow: hidden` shell with
 * the real scrolling in an inner `overflow: auto` pane. The document then
 * reports nothing to scroll, the frame declines the wheel, and a selected frame
 * pans the canvas instead of scrolling its own content. So walk up from whatever
 * is actually under the cursor first, then fall back to the document.
 *
 * Returning the container rather than a yes/no is what lets the caller scroll
 * it. Both routes need that: a wheel over the frame's chrome never reached the
 * frame's document at all, and one that did cannot be left to the browser —
 * under the canvas's scaled transform, Chrome's wheel hit test intermittently
 * misses the frame's scroller and an uncancelled wheel just does nothing (see
 * `onFrameWheel`). One walk answers both questions.
 *
 * **Extent, not remaining distance** — deliberately unlike the shell's
 * `scrollableUnder`, which also asks whether a container can still scroll any
 * further. That question is right for an overlay floating over the canvas and
 * wrong here: answering it per-event makes the answer flip mid-gesture, so
 * reaching the bottom of a page hands the rest of the fling to the canvas and it
 * lurches sideways. A selected frame owns the wheel to the ends.
 *
 * Everything is read through the frame's own realm (`win.getComputedStyle`, its
 * own `elementFromPoint`), never the shell's — see `../realm.ts`.
 */
/** One document the wheel point passes through on its way down. */
interface WheelLevel {
  /** What the point landed on here — an iframe on every level but the last. */
  hit: Element | null;
  win: Window;
}

/**
 * Follow the point down through same-origin iframes, collecting a level per
 * document — the same step the surface resolver takes. Over a nested document
 * (a Storybook preview) the outer hit is the `<iframe>`, whose ancestors are
 * the outer document's panes; without the descent the wheel scrolled the
 * wrong scroller, or nothing.
 */
function wheelLevels(win: Window, point: Point): WheelLevel[] {
  const levels: WheelLevel[] = [];
  let currentWin = win;
  let currentPoint = point;
  for (let depth = 0; depth <= MAX_NEST_DEPTH; depth += 1) {
    const doc = currentWin.document;
    if (!doc) {
      break;
    }
    const hit = doc.elementFromPoint(currentPoint.x, currentPoint.y);
    levels.push({ hit, win: currentWin });
    if (hit?.tagName !== "IFRAME") {
      break;
    }
    const iframe = hit as HTMLIFrameElement;
    const innerWin = iframe.contentDocument?.defaultView;
    if (!innerWin) {
      break;
    }
    const rect = iframe.getBoundingClientRect();
    currentPoint = {
      x: currentPoint.x - rect.left - iframe.clientLeft,
      y: currentPoint.y - rect.top - iframe.clientTop,
    };
    currentWin = innerWin;
  }
  return levels;
}

/** Does the document itself have anything to scroll in the direction asked? */
function docScrolls(win: Window, dx: number, dy: number): boolean {
  const doc = win.document;
  const root = doc?.documentElement;
  const body = doc?.body;
  const height = Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
  const width = Math.max(root?.scrollWidth ?? 0, body?.scrollWidth ?? 0);
  return (
    (dy !== 0 && height > win.innerHeight + 1) ||
    (dx !== 0 && width > win.innerWidth + 1)
  );
}

export function scrollTargetAt(
  win: Window,
  point: Point,
  dx: number,
  dy: number
): ScrollTarget | null {
  try {
    const levels = wheelLevels(win, point);
    // Walk up from the deepest hit; at each iframe boundary continue from the
    // iframe element in the document above, so a scrollable pane *holding*
    // the nested document still answers.
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      let node = levels[i].hit;
      while (node) {
        if (hasScrollExtent(levels[i].win, node, dx, dy)) {
          return node;
        }
        node = node.parentElement;
      }
    }
    // Then each document itself, deepest first — the answer for a gesture
    // aimed at the page as a whole rather than at a pane inside it.
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      if (docScrolls(levels[i].win, dx, dy)) {
        return levels[i].win;
      }
    }
    return null;
  } catch {
    // Cross-origin, or a frame torn down mid-gesture. Let the canvas have it.
    return null;
  }
}

/** Is this node a scroll container with room in the direction asked? */
function hasScrollExtent(
  win: Window,
  node: Element,
  dx: number,
  dy: number
): boolean {
  const style = win.getComputedStyle(node);
  if (!style) {
    return false;
  }
  return (
    (dy !== 0 &&
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 1) ||
    (dx !== 0 &&
      SCROLLABLE_OVERFLOW.test(style.overflowX) &&
      node.scrollWidth > node.clientWidth + 1)
  );
}
