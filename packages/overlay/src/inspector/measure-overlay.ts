/**
 * Alt-hover spacing measurement — the distances between the selected element
 * and whatever the pointer is over.
 *
 * Two modes, chosen from the relationship rather than from a toolbar:
 *
 * - Hovering an **ancestor** of the selection measures the four gaps from the
 *   child to that ancestor's padding box. This is "how much room is around it".
 * - Hovering **anything else** measures the gap between the two boxes, per
 *   axis. This is "how far apart are these two".
 *
 * Drawn on the shared `ChromeLayer`, which is fixed to the viewport and holds
 * screen coordinates — so lines and labels stay 1× and legible at any canvas
 * zoom, while the rects they describe are scaled through the surface. Lines are
 * zero-height divs with a single border rather than SVG: cheaper, and they land
 * on exact device pixels.
 *
 * Every element is pooled at construction. A measurement runs on pointermove,
 * and allocating eighteen nodes per move would be felt.
 */
import type { Rect } from "../canvas/space";
import { type ChromeLayer, hide, place } from "../chrome-layer";
import { cls, el } from "../dom";
import { computedStyle } from "../realm";
import { clipToSurface, localRect, type Surface } from "../surface";

/** One measured distance: the line, an elbow when it cannot reach, a label. */
interface Measure {
  connector: HTMLElement;
  label: HTMLElement;
  line: HTMLElement;
}

/** Gaps use two (one per axis); the parent mode uses four (one per side). */
const GAP_MEASURES = 2;
const PARENT_MEASURES = 4;

export class MeasureOverlay {
  private readonly gaps: Measure[] = [];
  private readonly sides: Measure[] = [];
  private readonly all: Measure[] = [];

  constructor(layer: ChromeLayer) {
    for (let i = 0; i < GAP_MEASURES; i += 1) {
      this.gaps.push(this.create(layer));
    }
    for (let i = 0; i < PARENT_MEASURES; i += 1) {
      this.sides.push(this.create(layer));
    }
    // The pool is allocated shown. Nothing measures anything until the first
    // Alt-hover, so without this every line and label in it paints from the
    // moment the overlay mounts.
    this.hide();
  }

  private create(layer: ChromeLayer): Measure {
    const measure: Measure = {
      connector: el("div", {
        class: `${cls("layer")} ${cls("measure-line")}`,
      }),
      label: el("div", { class: `${cls("layer")} ${cls("measure-label")}` }),
      line: el("div", { class: `${cls("layer")} ${cls("measure-line")}` }),
    };
    measure.connector.dataset.dashed = "";
    layer.add(measure.line, measure.connector, measure.label);
    this.all.push(measure);
    return measure;
  }

  /**
   * Draw the measurement between a selection and a hovered node.
   *
   * Both rects are taken in screen space so the arithmetic is done in the units
   * the lines are drawn in — measuring in surface space and converting each
   * result would compound rounding at every zoom level.
   */
  show(selected: Element, hovered: Element, surface: Surface): void {
    this.hide();
    if (selected === hovered) {
      return;
    }
    const selRect = surface.toScreen(localRect(selected));
    if (hovered.contains(selected)) {
      this.showParentGaps(selRect, hovered, surface);
      return;
    }
    this.showBetween(selRect, surface.toScreen(localRect(hovered)), surface);
  }

  hide(): void {
    for (const measure of this.all) {
      hide(measure.line);
      hide(measure.connector);
      hide(measure.label);
    }
  }

  destroy(): void {
    for (const measure of this.all) {
      measure.line.remove();
      measure.connector.remove();
      measure.label.remove();
    }
  }

  /**
   * The gap between two sibling-ish boxes, per axis.
   *
   * Only positive gaps are labelled: boxes that overlap on an axis have no
   * distance on it, and drawing a zero would be stating something false.
   */
  private showBetween(sel: Rect, hover: Rect, surface: Surface): void {
    // The two axes are the same problem rotated, so one helper serves both and
    // the horizontal/vertical asymmetry lives entirely in the `axis` argument.
    this.showAxis(this.gaps[0], sel, hover, surface, "h");
    this.showAxis(this.gaps[1], sel, hover, surface, "v");
  }

  /**
   * One axis of the gap between two boxes.
   *
   * Nothing is drawn when the boxes overlap on this axis: there is no distance
   * between them, and rendering a zero would state something false.
   */
  private showAxis(
    measure: Measure,
    sel: Rect,
    hover: Rect,
    surface: Surface,
    axis: "h" | "v"
  ): void {
    const horizontal = axis === "h";
    // Along the measured axis; across the perpendicular one.
    const selNear = horizontal ? sel.left : sel.top;
    const selSize = horizontal ? sel.width : sel.height;
    const hoverNear = horizontal ? hover.left : hover.top;
    const hoverSize = horizontal ? hover.width : hover.height;
    const forward = hoverNear + hoverSize / 2 > selNear + selSize / 2;

    const gap = forward
      ? hoverNear - (selNear + selSize)
      : selNear - (hoverNear + hoverSize);
    if (gap <= 0.5) {
      return;
    }

    // The ray leaves the middle of the selection's near edge.
    const crossCenter = horizontal
      ? sel.top + sel.height / 2
      : sel.left + sel.width / 2;
    const crossNear = horizontal ? hover.top : hover.left;
    const crossFar = crossNear + (horizontal ? hover.height : hover.width);
    const start = forward ? selNear + selSize : hoverNear + hoverSize;

    // When the ray's level falls outside the hovered box it never touches it,
    // so a dashed elbow runs from that level to the box's nearest corner.
    const misses = crossCenter < crossNear || crossCenter > crossFar;
    const connectTo = misses
      ? {
          at: forward ? hoverNear : hoverNear + hoverSize,
          from: crossCenter,
          to: crossCenter < crossNear ? crossNear : crossFar,
        }
      : null;

    this.drawSegment(measure, {
      connectTo,
      horizontal,
      length: gap,
      surface,
      x: horizontal ? start : crossCenter,
      y: horizontal ? crossCenter : start,
    });
  }

  /**
   * The four distances from a child to its ancestor's **padding box**.
   *
   * Border widths are subtracted but padding is not, so the number matches the
   * gap a person actually sees between the two edges — which is what they are
   * asking about. Measuring to the content box instead would report zero for a
   * child sitting flush inside a padded container.
   */
  private showParentGaps(child: Rect, parent: Element, surface: Surface): void {
    const style = computedStyle(parent);
    const box = surface.toScreen(localRect(parent));
    const { scale } = surface;
    const border = (side: string): number =>
      (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0) *
      scale;

    const innerTop = box.top + border("top");
    const innerLeft = box.left + border("left");
    const innerRight = box.left + box.width - border("right");
    const innerBottom = box.top + box.height - border("bottom");

    const childRight = child.left + child.width;
    const childBottom = child.top + child.height;
    const cx = child.left + child.width / 2;
    const cy = child.top + child.height / 2;

    const edges: {
      horizontal: boolean;
      length: number;
      x: number;
      y: number;
    }[] = [
      { horizontal: false, length: child.top - innerTop, x: cx, y: innerTop },
      {
        horizontal: false,
        length: innerBottom - childBottom,
        x: cx,
        y: childBottom,
      },
      { horizontal: true, length: child.left - innerLeft, x: innerLeft, y: cy },
      {
        horizontal: true,
        length: innerRight - childRight,
        x: childRight,
        y: cy,
      },
    ];

    edges.forEach((edge, i) => {
      if (edge.length > 0.5) {
        this.drawSegment(this.sides[i], {
          connectTo: null,
          horizontal: edge.horizontal,
          length: edge.length,
          surface,
          x: edge.x,
          y: edge.y,
        });
      }
    });
  }

  private drawSegment(
    measure: Measure,
    spec: {
      /** A perpendicular elbow, when the ray does not reach the other box. */
      connectTo: { at: number; from: number; to: number } | null;
      horizontal: boolean;
      length: number;
      surface: Surface;
      x: number;
      y: number;
    }
  ): void {
    const { horizontal, length, surface, x, y } = spec;
    const box: Rect = horizontal
      ? { height: 0, left: x, top: y, width: length }
      : { height: length, left: x, top: y, width: 0 };
    place(measure.line, box, clipToSurface(surface, box));
    measure.line.dataset.axis = horizontal ? "h" : "v";

    // The number is in *surface* pixels, not screen: at 50% zoom a 16px gap is
    // 8px on screen, and reporting 8 would be reporting the zoom level.
    const shown = Math.round(length / surface.scale);
    measure.label.textContent = String(shown);
    measure.label.style.display = "block";
    // Anchor point only. Centring on the line and clearing it are the same two
    // transforms every time, so they are a rule keyed off `data-axis` rather
    // than a string reassigned on every pointermove.
    measure.label.dataset.axis = horizontal ? "h" : "v";
    measure.label.style.left = `${horizontal ? x + length / 2 : x}px`;
    measure.label.style.top = `${horizontal ? y : y + length / 2}px`;

    if (!spec.connectTo) {
      hide(measure.connector);
      return;
    }
    const { at, from, to } = spec.connectTo;
    const span = Math.abs(to - from);
    const elbow: Rect = horizontal
      ? { height: span, left: at, top: Math.min(from, to), width: 0 }
      : { height: 0, left: Math.min(from, to), top: at, width: span };
    place(measure.connector, elbow, clipToSurface(surface, elbow));
    measure.connector.dataset.axis = horizontal ? "v" : "h";
  }
}
