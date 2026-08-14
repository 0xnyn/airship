/**
 * The canvas coordinate system — and the only place in the overlay allowed to do
 * coordinate math.
 *
 * There are three spaces:
 *
 * - **frame** — inside a frame's own viewport. This is what
 *   `getBoundingClientRect()` returns when called on a node *within* a frame,
 *   and it is the space every CSS value the inspector reads or writes lives in.
 *   A 200px-wide box is 200 here at every zoom level.
 * - **world** — the infinite canvas. A frame occupies `(x, y, width, height)`.
 *   One world unit is one frame pixel, so frame-space `(0,0)` for a frame is
 *   world `(frame.x, frame.y)`.
 * - **screen** — the shell's viewport, what `getBoundingClientRect()` returns in
 *   the shell document. Chrome (outlines, handles, drop lines) is positioned
 *   here, at 1× and untransformed, so a 1px border stays 1px at 10% zoom the way
 *   it does in a design tool.
 *
 * The world→screen transform is `translate(x, y) scale(scale)` with
 * `transform-origin: 0 0` and never a rotation, which is what keeps every
 * conversion an axis-independent multiply-add and lets an axis-aligned rect stay
 * an axis-aligned rect.
 *
 * Frame→screen deliberately does *not* recompose that transform by hand. The
 * shell asks the browser for `iframe.getBoundingClientRect()`, which already has
 * the world transform composited into it, so the conversion picks up the
 * viewport's position and any future ancestor transform for free — and cannot
 * drift out of sync with the CSS the way a re-derived matrix would.
 */

/** Pan offset and zoom of the canvas. */
export interface Viewport {
  scale: number;
  /** World-space x of the origin, in screen px relative to the canvas viewport. */
  x: number;
  y: number;
}

/** A plain axis-aligned box. `DOMRect` is awkward to construct and we only ever
 * need these four numbers. */
export interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Zoom bounds. 10% fits a wall of desktop frames; 400% is past pixel-peeping. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export const IDENTITY: Viewport = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Round to whole device pixels — avoids the shimmer of subpixel chrome. */
function snap(n: number): number {
  return Math.round(n * 100) / 100;
}

// -- world ⇄ screen ----------------------------------------------------------
// Used for canvas-level work: placing and dragging frames, and zoom-at-cursor.
// `viewportRect` is the canvas viewport element's own screen rect, which is what
// makes these independent of wherever the canvas element happens to sit.

export function worldToScreen(
  vp: Viewport,
  viewportRect: Rect,
  point: Point
): Point {
  return {
    x: viewportRect.left + vp.x + point.x * vp.scale,
    y: viewportRect.top + vp.y + point.y * vp.scale,
  };
}

export function screenToWorld(
  vp: Viewport,
  viewportRect: Rect,
  point: Point
): Point {
  return {
    x: (point.x - viewportRect.left - vp.x) / vp.scale,
    y: (point.y - viewportRect.top - vp.y) / vp.scale,
  };
}

export function worldRectToScreen(
  vp: Viewport,
  viewportRect: Rect,
  rect: Rect
): Rect {
  const origin = worldToScreen(vp, viewportRect, {
    x: rect.left,
    y: rect.top,
  });
  return {
    height: snap(rect.height * vp.scale),
    left: snap(origin.x),
    top: snap(origin.y),
    width: snap(rect.width * vp.scale),
  };
}

// -- frame ⇄ screen ----------------------------------------------------------
// The hot path: every hover box, selection outline, resize handle and drop
// indicator goes through here on every pointer move.

/**
 * A frame's on-screen rect. Read straight from the browser, so the world
 * transform and the canvas viewport's position are both already accounted for.
 */
export function frameScreenRect(frameEl: Element): Rect {
  const r = frameEl.getBoundingClientRect();
  return { height: r.height, left: r.left, top: r.top, width: r.width };
}

/** A rect measured inside a frame → the shell's screen space. */
export function frameToScreen(
  frameEl: Element,
  rect: Rect,
  scale: number
): Rect {
  const o = frameScreenRect(frameEl);
  return {
    height: snap(rect.height * scale),
    left: snap(o.left + rect.left * scale),
    top: snap(o.top + rect.top * scale),
    width: snap(rect.width * scale),
  };
}

/** A point in the shell's screen space → that frame's viewport coordinates. */
export function screenToFrame(
  frameEl: Element,
  point: Point,
  scale: number
): Point {
  const o = frameScreenRect(frameEl);
  return {
    x: (point.x - o.left) / scale,
    y: (point.y - o.top) / scale,
  };
}

/** Is a screen point over this frame at all? */
export function screenPointInFrame(frameEl: Element, point: Point): boolean {
  const o = frameScreenRect(frameEl);
  return (
    point.x >= o.left &&
    point.x <= o.left + o.width &&
    point.y >= o.top &&
    point.y <= o.top + o.height
  );
}

// -- clipping ----------------------------------------------------------------

/**
 * A `clip-path` that trims screen-space chrome down to a frame's bounds.
 *
 * Without it, selecting a node and then scrolling the frame draws that node's
 * outline out across the open canvas — the outline is positioned in screen
 * space, so nothing else stops it at the frame's edge the way the frame's own
 * `overflow: hidden` stops its content.
 *
 * Returns `"none"` when the box is fully inside, so the common case sets no clip
 * at all.
 */
export function clipTo(box: Rect, bounds: Rect): string {
  const top = Math.max(0, bounds.top - box.top);
  const left = Math.max(0, bounds.left - box.left);
  const right = Math.max(
    0,
    box.left + box.width - (bounds.left + bounds.width)
  );
  const bottom = Math.max(
    0,
    box.top + box.height - (bounds.top + bounds.height)
  );
  if (!(top || left || right || bottom)) {
    return "none";
  }
  return `inset(${snap(top)}px ${snap(right)}px ${snap(bottom)}px ${snap(left)}px)`;
}

/**
 * The world-space box `viewportRect` is currently showing.
 *
 * The inverse of the world→screen transform applied to the viewport's own
 * corners, which is why it is four divisions and not a matrix: screen `left`
 * maps to world `-x/scale`, and a viewport `width` screen px wide spans
 * `width/scale` world units at any zoom.
 *
 * Needed by anything that has to reason about *where you are looking* rather
 * than where one node is — the minimap's indicator, and the bounds it has to
 * cover so that indicator cannot leave the map.
 */
export function visibleWorldRect(vp: Viewport, viewportRect: Rect): Rect {
  return {
    height: viewportRect.height / vp.scale,
    left: -vp.x / vp.scale,
    top: -vp.y / vp.scale,
    width: viewportRect.width / vp.scale,
  };
}

// -- zoom --------------------------------------------------------------------

/**
 * Zoom so the world point currently under `anchor` stays under it.
 *
 * Solving `anchor = x + w·s` for both scales and eliminating the world point `w`
 * gives `x' = anchor − (anchor − x)·(s'/s)` — no need to know which world point
 * it was, which is what makes this work identically for a wheel at the cursor
 * and a pinch at its midpoint. `anchor` is relative to the canvas viewport, not
 * the browser window.
 */
export function zoomAt(
  vp: Viewport,
  anchor: Point,
  nextScale: number
): Viewport {
  const scale = clampScale(nextScale);
  const ratio = scale / vp.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - vp.x) * ratio,
    y: anchor.y - (anchor.y - vp.y) * ratio,
  };
}

/**
 * The viewport that fits `bounds` (world space) into `size` (screen px) with
 * `padding` px of margin, centred. Used by zoom-to-fit and zoom-to-selection.
 */
export function fitTo(
  bounds: Rect,
  size: { height: number; width: number },
  padding = 64,
  maxScale = 1
): Viewport {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { ...IDENTITY };
  }
  const scale = clampScale(
    Math.min(
      maxScale,
      (size.width - padding * 2) / bounds.width,
      (size.height - padding * 2) / bounds.height
    )
  );
  return {
    scale,
    x: (size.width - bounds.width * scale) / 2 - bounds.left * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.top * scale,
  };
}

/**
 * The viewport that puts world `point` at the centre of `size`, at the scale
 * given.
 *
 * Same contract as `fitTo` — it centres within a box whose origin is `(0, 0)`,
 * so a caller aiming at anything other than the whole viewport shifts the
 * result by that box's offset. Deliberately does *not* touch the scale: this is
 * "take me there", not "take me there and decide how close I stand", which is
 * what keeps a jump from the minimap or the frame list from throwing away the
 * zoom level you were working at.
 */
export function centerAt(
  point: Point,
  size: { height: number; width: number },
  scale: number
): Viewport {
  return {
    scale,
    x: size.width / 2 - point.x * scale,
    y: size.height / 2 - point.y * scale,
  };
}

/**
 * Project a world box into a box of screen px, with no scale clamp.
 *
 * The unclamped twin of `fitTo`, and the clamp is the whole reason it exists.
 * `fitTo` produces a *zoom level*, so it is bounded by `MIN_SCALE`/`MAX_SCALE`
 * — the range a person can usefully work at. This produces a *projection
 * ratio* for a second, non-interactive view of the same world, where those
 * bounds are meaningless: fitting a 6000px-wide canvas into a 200px minimap
 * needs about 0.03, and running that through `clampScale` would floor it at 0.1
 * and draw the frames three times wider than the card holding them.
 *
 * Returns `IDENTITY` for a degenerate box or a box smaller than its own
 * padding, so a caller never has to defend against a zero or negative scale.
 */
export function projectInto(
  bounds: Rect,
  size: { height: number; width: number },
  padding = 0
): Viewport {
  const width = size.width - padding * 2;
  const height = size.height - padding * 2;
  if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) {
    return { ...IDENTITY };
  }
  const scale = Math.min(width / bounds.width, height / bounds.height);
  return {
    scale,
    x: (size.width - bounds.width * scale) / 2 - bounds.left * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.top * scale,
  };
}

/** The world-space box containing every rect given, or null if there are none. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return { height: bottom - top, left, top, width: right - left };
}
