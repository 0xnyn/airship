import type { Rect } from "./canvas/space";
import { cls, el } from "./dom";

/**
 * The layer every piece of floating chrome is drawn on: hover box, selection
 * outline and its eight handles, drop indicators, frame labels and grips.
 *
 * Two decisions are baked in here.
 *
 * **Chrome is screen space, not world space.** It would have been less code to
 * park the outlines inside the transformed world and let the browser scale them
 * along with the frames — but then a 2px selection border is 0.2px at 10% zoom
 * and a resize handle becomes a speck. Design tools draw chrome at a constant size
 * over a scaling canvas, and so do we: only the *rects* are scaled, by
 * `canvas/space.ts`, and everything drawn here stays at 1×.
 *
 * **The layer is the containing block, so children use screen coordinates.**
 * It is `position: fixed; inset: 0`, which makes it exactly the viewport; its
 * `position: absolute` children therefore take coordinates that are already
 * screen coordinates, with no per-element offset to apply. Setting a `clip-path`
 * to fence chrome inside the canvas does not disturb that, because the clip
 * changes what is *painted* rather than where the containing block is.
 *
 * That fence used to be what kept an outline from painting out over a dock,
 * back when the canvas inset itself and stopped short of them. The canvas is
 * full-bleed now, so the clip is the whole viewport and does nothing on the
 * shell; what keeps chrome out of the panels is paint order. `#…-root` is
 * appended after this layer at the same z-index, so the docks, the corner pills
 * and the bar all draw over it — which is the usual arrangement, an outline
 * running under a panel rather than being clipped at its edge.
 */
export class ChromeLayer {
  readonly element: HTMLElement;

  constructor() {
    this.element = el("div", { class: cls("chrome-layer") });
  }

  mount(host: HTMLElement): void {
    host.append(this.element);
  }

  add(...nodes: HTMLElement[]): void {
    this.element.append(...nodes);
  }

  /**
   * Fence everything on the layer to a screen rect — the canvas viewport. On a
   * full-bleed canvas that is the whole window and the fence is a formality,
   * but it stays honest if the viewport is ever given bounds again. `null`
   * removes it, which is the inline overlay's case: there, the page is the
   * canvas and there is nothing to clip against.
   */
  setClip(bounds: Rect | null): void {
    if (!bounds) {
      this.element.style.clipPath = "";
      return;
    }
    const right = Math.max(0, window.innerWidth - (bounds.left + bounds.width));
    const bottom = Math.max(
      0,
      window.innerHeight - (bounds.top + bounds.height)
    );
    this.element.style.clipPath = `inset(${bounds.top}px ${right}px ${bottom}px ${bounds.left}px)`;
  }

  destroy(): void {
    this.element.remove();
  }
}

/** Position a chrome element on a screen-space box, with an optional clip. */
export function place(node: HTMLElement, box: Rect, clip = "none"): void {
  node.style.display = "block";
  node.style.left = `${box.left}px`;
  node.style.top = `${box.top}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
  node.style.clipPath = clip;
}

export function hide(node: HTMLElement): void {
  node.style.display = "none";
}

/**
 * Room a badge needs above its box before it gives up and flips below.
 *
 * One line of caption text plus its padding, rounded up. It does not have to be
 * exact — being wrong by a pixel flips a badge that would just have fitted,
 * which is invisible; measuring the badge to get it exact would cost a layout
 * read on every pointer move, which is not.
 */
const LABEL_CLEARANCE = 20;

/**
 * Anchor a badge to the top-left of its box, flipping it below when the box sits
 * too close to `ceiling` for the badge to fit above.
 *
 * Deliberately not `place()`d. A badge is sized by its own text, and writing a
 * measured width and height onto it would crop the name it exists to show.
 *
 * `ceiling` is the top edge the badge must clear — the *frame's*, not the
 * window's, so that on the canvas a badge which clears the viewport can still be
 * pinned against the top of its own frame. Callers with a `Surface` pass
 * `surface.bounds()?.top ?? 0`; callers drawing straight onto the viewport pass
 * nothing.
 *
 * Here rather than on `SelectionController`, where it lived, because it is a
 * chrome-placement function and this is the chrome-placement module — and
 * because the story catalogue draws the same badge over its specimens. Two
 * copies of this would be two badges that flip at different heights, which is
 * the kind of difference nobody notices until a screenshot looks subtly wrong.
 */
export function placeLabel(label: HTMLElement, box: Rect, ceiling = 0): void {
  const flip = box.top - LABEL_CLEARANCE < ceiling;
  label.style.display = "block";
  label.style.left = `${box.left}px`;
  label.style.top = `${flip ? box.top + box.height : box.top}px`;
  label.toggleAttribute("data-flip", flip);
}
