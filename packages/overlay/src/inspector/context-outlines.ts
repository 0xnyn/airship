/**
 * Dotted outlines for the structure around the selection.
 *
 * The canvas draws four kinds of line and they mean different things. **Solid**
 * is the thing you are pointing at — the hover highlight and the selection.
 * **Dashed** is a drop target. **Red** is measurement. This module owns the
 * fourth: **dotted**, for structure you did not ask about but need in order to
 * read the one you did.
 *
 * Two rules, both borrowed from the reference and both earning their keep:
 *
 * - The selection's **parent** is always outlined. An element on its own tells
 *   you nothing about why it is the width it is; its parent usually does, and
 *   "why is this not filling the row" is the most common question the panel gets
 *   asked in the first ten seconds.
 * - Its **siblings** are outlined while you hover their shared ancestor. That is
 *   the moment you are asking about the group rather than the item, and drawing
 *   the group is a more direct answer than a tree in a panel.
 *
 * Lighter than the solid chrome, deliberately. Several of these can be on screen
 * at once with a hover box and a selection box, and if context reads as loud as
 * the subject then the canvas is just busy.
 *
 * Pooled at construction and hidden immediately, the same shape as
 * `measure-overlay.ts` — this redraws on every pointer move, and allocating a
 * row of nodes per move is exactly the sort of thing that shows up as jitter
 * rather than as a number in a profile.
 */
import { type ChromeLayer, hide, place } from "../chrome-layer";
import { cls, el } from "../dom";
import { isOwn } from "../edit-guard";
import { clipToSurface, localRect, type Surface } from "../surface";

/**
 * How many siblings are ever outlined at once.
 *
 * A container with more children than this is a list, and outlining ninety rows
 * communicates nothing that outlining twenty does not. The cap is on the *pool*,
 * so it costs nothing when it is not reached.
 */
const SIBLING_POOL = 20;

export class ContextOutlines {
  private readonly parentBox: HTMLElement;
  private readonly siblingBoxes: HTMLElement[] = [];

  constructor(layer: ChromeLayer) {
    this.parentBox = el("div", {
      class: `${cls("layer")} ${cls("ctx-parent")}`,
    });
    layer.add(this.parentBox);
    for (let i = 0; i < SIBLING_POOL; i += 1) {
      const box = el("div", { class: `${cls("layer")} ${cls("ctx-sibling")}` });
      layer.add(box);
      this.siblingBoxes.push(box);
    }
    this.hide();
  }

  /**
   * Redraw for the current selection and hover.
   *
   * Takes both rather than being called from two places, because the two rules
   * are not independent: the siblings are only drawn when the hovered node is an
   * ancestor of the *selected* one, so a change to either has to re-evaluate
   * both. Splitting it produced a state where hovering away left the siblings
   * outlined and hovering back drew them twice.
   */
  show(
    selected: Element | null,
    hovered: Element | null,
    surface: Surface | null
  ): void {
    this.hide();
    if (!(selected?.isConnected && surface?.isLive)) {
      return;
    }
    const parent = selected.parentElement;
    if (!parent || isRoot(parent, surface)) {
      return;
    }
    this.draw(this.parentBox, parent, surface);
    // Only when the pointer is on an ancestor. Hovering the selection itself, or
    // a sibling, is a question about that one element.
    if (!hovered || hovered === selected || !hovered.contains(selected)) {
      return;
    }
    this.drawSiblings(hovered, selected, surface);
  }

  hide(): void {
    hide(this.parentBox);
    for (const box of this.siblingBoxes) {
      hide(box);
    }
  }

  destroy(): void {
    this.parentBox.remove();
    for (const box of this.siblingBoxes) {
      box.remove();
    }
    this.siblingBoxes.length = 0;
  }

  /**
   * Outline the hovered ancestor's children, minus the branch holding the
   * selection — that branch already has a solid outline, and a dotted one over
   * the top of it reads as a rendering fault rather than as extra information.
   */
  private drawSiblings(
    ancestor: Element,
    selected: Element,
    surface: Surface
  ): void {
    let used = 0;
    for (const child of Array.from(ancestor.children)) {
      if (used >= this.siblingBoxes.length) {
        return;
      }
      if (isOwn(child) || child === selected || child.contains(selected)) {
        continue;
      }
      this.draw(this.siblingBoxes[used], child, surface);
      used += 1;
    }
  }

  private draw(node: HTMLElement, target: Element, surface: Surface): void {
    const box = surface.toScreen(localRect(target));
    place(node, box, clipToSurface(surface, box));
  }
}

/**
 * Is this the surface's own root?
 *
 * `<body>` and `<html>` are not structure the user put there, and outlining the
 * whole viewport to say "your section is inside the page" is noise with a
 * one-pixel border around it.
 */
function isRoot(node: Element, surface: Surface): boolean {
  return node === surface.doc.body || node === surface.doc.documentElement;
}
