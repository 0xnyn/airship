/**
 * Red alignment guides — the line that appears when a drag lands on something.
 *
 * The grammar the canvas keeps: blue is what you are pointing at and what it
 * sits inside, red is *measurement and alignment only*. A guide is red for the
 * same reason a spacing badge is, and sharing the colour is what lets the two
 * appear together without either being mistaken for structure.
 *
 * Three details are worth the words:
 *
 * **The X marks say which edges matched.** A bare line tells you something
 * aligned; a mark on a corner tells you *that* corner did, and a single mark on
 * a centre tells you the centres did. Without them a centre match and an edge
 * match on a symmetric element draw exactly the same picture.
 *
 * **The line is snapped to a whole pixel and then offset by a half.** A
 * zero-width div with a 1px left border paints that border with its visual
 * centre half a pixel to the right of `left`, so marks anchored at the raw
 * coordinate sit beside the line instead of on it. Rounding first matters more
 * for us than for the reference: its coordinates are integers from an
 * unscaled document, ours are `world × scale` and arbitrary.
 *
 * **A guide spans the frame, not the window.** A full-viewport line would run
 * across the canvas and over unrelated frames, claiming an alignment between
 * two different copies of the app.
 *
 * Pooled at construction like `measure-overlay.ts`, and for the same reason:
 * this redraws on every frame of a resize.
 */
import type { Rect } from "./canvas/space";
import { type ChromeLayer, hide, place } from "./chrome-layer";
import { cls, el } from "./dom";
import type { Surface } from "./surface";

/** One alignment to draw, already in screen coordinates. */
export interface Guide {
  /** `"x"` is a vertical line at a given x — the axis it aligns *along*. */
  axis: "x" | "y";
  /** Where the marks go, along the perpendicular axis. */
  marks: readonly number[];
  /** The line's coordinate. */
  pos: number;
}

/** Enough for two axes of a corner drag, several times over. */
const GUIDE_POOL = 4;
const MARK_POOL = 12;
/** The X is drawn 8×8, so the anchor is offset by half of it. */
const MARK_SIZE = 8;

export class GuideOverlay {
  private readonly lines: HTMLElement[] = [];
  private readonly marks: HTMLElement[] = [];

  constructor(layer: ChromeLayer) {
    for (let i = 0; i < GUIDE_POOL; i += 1) {
      const line = el("div", { class: `${cls("layer")} ${cls("guide")}` });
      layer.add(line);
      this.lines.push(line);
    }
    for (let i = 0; i < MARK_POOL; i += 1) {
      const mark = el("div", { class: `${cls("layer")} ${cls("guide-mark")}` });
      layer.add(mark);
      this.marks.push(mark);
    }
    this.hide();
  }

  /** Draw the given guides, clipped to the surface they belong to. */
  show(guides: readonly Guide[], surface: Surface): void {
    this.hide();
    const span = surface.bounds() ?? viewportRect();
    let usedMarks = 0;
    for (const [i, guide] of guides.entries()) {
      const line = this.lines[i];
      if (!line) {
        return;
      }
      // Whole pixel first: the half is the border's own visual offset, and
      // adding it to a fractional coordinate lands between two device pixels.
      const pos = Math.round(guide.pos);
      place(line, lineBox(guide.axis, pos, span));
      line.dataset.axis = guide.axis;
      for (const at of guide.marks) {
        const mark = this.marks[usedMarks];
        if (!mark) {
          break;
        }
        usedMarks += 1;
        place(mark, markBox(guide.axis, pos + 0.5, at));
      }
    }
  }

  hide(): void {
    for (const line of this.lines) {
      hide(line);
    }
    for (const mark of this.marks) {
      hide(mark);
    }
  }

  destroy(): void {
    for (const node of [...this.lines, ...this.marks]) {
      node.remove();
    }
    this.lines.length = 0;
    this.marks.length = 0;
  }
}

/**
 * Where the marks go for one matched pair.
 *
 * A centre match gets one mark, on the centre; an edge match gets two, on the
 * near and far ends of the perpendicular axis. That asymmetry is the whole
 * signal — one X means "centres", two mean "this edge, that edge".
 */
export function marksFor(
  rect: Rect,
  axis: "x" | "y",
  center: boolean
): number[] {
  const near = axis === "x" ? rect.top : rect.left;
  const extent = axis === "x" ? rect.height : rect.width;
  return center ? [near + extent / 2] : [near, near + extent];
}

function lineBox(axis: "x" | "y", pos: number, span: Rect): Rect {
  return axis === "x"
    ? { height: span.height, left: pos, top: span.top, width: 0 }
    : { height: 0, left: span.left, top: pos, width: span.width };
}

function markBox(axis: "x" | "y", pos: number, at: number): Rect {
  const half = MARK_SIZE / 2;
  return axis === "x"
    ? { height: MARK_SIZE, left: pos - half, top: at - half, width: MARK_SIZE }
    : { height: MARK_SIZE, left: at - half, top: pos - half, width: MARK_SIZE };
}

function viewportRect(): Rect {
  return {
    height: window.innerHeight,
    left: 0,
    top: 0,
    width: window.innerWidth,
  };
}
