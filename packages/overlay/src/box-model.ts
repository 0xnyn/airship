/**
 * The space an element is spending: its padding, its margin, and the gaps
 * between its children.
 *
 * Shown on Alt-hover, alongside the distance measurements — Alt is the "tell me
 * about space" modifier, and these are the half of that answer the measurement
 * lines cannot give. A line between two boxes says how far apart they are; this
 * says *why*, by showing which of them is holding the room.
 *
 * Hatched rather than tinted. These regions overlap each other — a margin sits
 * against the next element's margin, a gap sits between two padded children —
 * and flat fills stack into an opaque block where they meet. Stripes stay
 * readable through themselves, which is why every element inspector ever built
 * draws them this way.
 *
 * Drawn at 1× on the chrome layer like everything else, so the 4px stripe period
 * stays 4px at any canvas zoom. A hatch that scaled with the content would turn
 * into a smear at 25% and into stripes wider than the padding at 400%.
 */
import type { Rect } from "./canvas/space";
import { type ChromeLayer, hide, place } from "./chrome-layer";
import { cls, el } from "./dom";
import { isOwn } from "./edit-guard";
import { isRowLayout } from "./layout-axis";
import { computedStyle } from "./realm";
import { clipToSurface, localRect, type Surface } from "./surface";

/** Four sides each for padding and margin; gaps are capped rather than counted. */
const SIDES = 4;
const GAP_POOL = 8;

/** Below this a band is a rounding artefact, not a decision anyone made. */
const MIN_BAND = 0.5;

type Kind = "padding" | "margin" | "gap";

export class BoxModelOverlay {
  private readonly padding: HTMLElement[] = [];
  private readonly margin: HTMLElement[] = [];
  private readonly gaps: HTMLElement[] = [];

  constructor(layer: ChromeLayer) {
    fill(this.padding, SIDES, layer, "padding");
    fill(this.margin, SIDES, layer, "margin");
    fill(this.gaps, GAP_POOL, layer, "gap");
    this.hide();
  }

  /** Draw the box model of one element. */
  show(node: Element, surface: Surface): void {
    this.hide();
    if (!(node.isConnected && surface.isLive)) {
      return;
    }
    const style = computedStyle(node);
    const border = localRect(node);
    const edge = (property: string): number =>
      Number.parseFloat(style.getPropertyValue(property)) || 0;

    // Inside the border, then inside the padding: two nested insets, and the
    // bands between them are what gets hatched.
    const paddingBox = inset(border, {
      bottom: edge("border-bottom-width"),
      left: edge("border-left-width"),
      right: edge("border-right-width"),
      top: edge("border-top-width"),
    });
    const contentBox = inset(paddingBox, {
      bottom: edge("padding-bottom"),
      left: edge("padding-left"),
      right: edge("padding-right"),
      top: edge("padding-top"),
    });
    // A negative margin is real and worth seeing, but it is an *overlap* rather
    // than a band, and drawing it as one would put a stripe over the neighbour
    // it is pulling toward. Clamped to zero; the panel reports the number.
    const marginBox = outset(border, {
      bottom: Math.max(0, edge("margin-bottom")),
      left: Math.max(0, edge("margin-left")),
      right: Math.max(0, edge("margin-right")),
      top: Math.max(0, edge("margin-top")),
    });

    this.bands(this.padding, paddingBox, contentBox, surface);
    this.bands(this.margin, marginBox, border, surface);
    this.drawGaps(node, contentBox, surface);
  }

  hide(): void {
    for (const node of [...this.padding, ...this.margin, ...this.gaps]) {
      hide(node);
    }
  }

  destroy(): void {
    for (const node of [...this.padding, ...this.margin, ...this.gaps]) {
      node.remove();
    }
    this.padding.length = 0;
    this.margin.length = 0;
    this.gaps.length = 0;
  }

  /** The four bands between an outer rect and an inner one. */
  private bands(
    pool: HTMLElement[],
    outer: Rect,
    inner: Rect,
    surface: Surface
  ): void {
    const outerRight = outer.left + outer.width;
    const outerBottom = outer.top + outer.height;
    const innerRight = inner.left + inner.width;
    const innerBottom = inner.top + inner.height;
    // Top and bottom run the full width; the sides fill only what is left, so
    // the four never overlap at the corners and double their own opacity there.
    const rects: Rect[] = [
      {
        height: inner.top - outer.top,
        left: outer.left,
        top: outer.top,
        width: outer.width,
      },
      {
        height: outerBottom - innerBottom,
        left: outer.left,
        top: innerBottom,
        width: outer.width,
      },
      {
        height: inner.height,
        left: outer.left,
        top: inner.top,
        width: inner.left - outer.left,
      },
      {
        height: inner.height,
        left: innerRight,
        top: inner.top,
        width: outerRight - innerRight,
      },
    ];
    for (const [i, rect] of rects.entries()) {
      this.paint(pool[i], rect, surface);
    }
  }

  /**
   * The space between adjacent children.
   *
   * Measured between the rects rather than read off `gap`, so it is right for a
   * grid's row and column gaps, for margins between block children, and for
   * `space-between` — all of which produce a gap nobody wrote a `gap` property
   * for. Only pairs that are actually separated are drawn.
   */
  private drawGaps(node: Element, content: Rect, surface: Surface): void {
    const kids = Array.from(node.children).filter((c) => !isOwn(c));
    if (kids.length < 2) {
      return;
    }
    const rects = kids.map(localRect);
    const horizontal = isRowLayout(rects);
    let used = 0;
    for (let i = 1; i < rects.length && used < this.gaps.length; i += 1) {
      const band = gapBetween(rects[i - 1], rects[i], content, horizontal);
      if (!band) {
        continue;
      }
      this.paint(this.gaps[used], band, surface);
      used += 1;
    }
  }

  private paint(
    node: HTMLElement | undefined,
    local: Rect,
    surface: Surface
  ): void {
    if (!node || local.width < MIN_BAND || local.height < MIN_BAND) {
      return;
    }
    const box = surface.toScreen(local);
    place(node, box, clipToSurface(surface, box));
  }
}

function fill(
  pool: HTMLElement[],
  count: number,
  layer: ChromeLayer,
  kind: Kind
): void {
  for (let i = 0; i < count; i += 1) {
    const node = el("div", {
      class: `${cls("layer")} ${cls("hatch")}`,
      "data-kind": kind,
    });
    layer.add(node);
    pool.push(node);
  }
}

interface Edges {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function inset(rect: Rect, by: Edges): Rect {
  return {
    height: Math.max(0, rect.height - by.top - by.bottom),
    left: rect.left + by.left,
    top: rect.top + by.top,
    width: Math.max(0, rect.width - by.left - by.right),
  };
}

function outset(rect: Rect, by: Edges): Rect {
  return {
    height: rect.height + by.top + by.bottom,
    left: rect.left - by.left,
    top: rect.top - by.top,
    width: rect.width + by.left + by.right,
  };
}

/** The band between two adjacent children, or null when they touch. */
function gapBetween(
  a: Rect,
  b: Rect,
  content: Rect,
  horizontal: boolean
): Rect | null {
  if (horizontal) {
    const left = a.left + a.width;
    const width = b.left - left;
    return width < MIN_BAND
      ? null
      : { height: content.height, left, top: content.top, width };
  }
  const top = a.top + a.height;
  const height = b.top - top;
  return height < MIN_BAND
    ? null
    : { height, left: content.left, top, width: content.width };
}
