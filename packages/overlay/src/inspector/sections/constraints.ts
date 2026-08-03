import { cls, el } from "../../dom";
import { computedStyle } from "../../realm";
import {
  type Anchor,
  type Axis as ConstraintAxis,
  currentInset,
  isPositioned,
  pinInPlace,
  readAnchor,
  releasePin,
  writeAnchor,
} from "../constraints";
import { createSegmented } from "../controls/segmented";
import { createSelect } from "../controls/select";
import { CONSTRAIN_H, CONSTRAIN_V, POSITION_MODE } from "../descriptors";
import type { SectionContext } from "./context";
import { labelled } from "./row";

/**
 * `position` plus, when it means anything, the constraints widget.
 *
 * This is the only section that can *change what the other sections mean*:
 * making an element absolute is what turns the alignment row's main-axis
 * buttons from parent-writing into side-effect-free inset writes.
 */
export function renderConstraints(
  ctx: SectionContext,
  node: Element
): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  const position = createSelect(
    POSITION_MODE,
    computedStyle(node).position,
    (_property, value) => {
      setPositionMode(ctx, node, value);
      ctx.rerender();
    }
  );
  ctx.register(position);
  body.append(labelled("Position", position.element));

  if (isPositioned(node)) {
    // A persistent host, so picking an anchor repaints five bars instead of
    // rebuilding fourteen sections. Nothing outside Constraints changes when
    // you re-pin an element.
    const host = el("div");
    // The widget registers a segmented group on every paint; the scope drops
    // the previous one rather than leaving it in the panel's registry.
    const repaintAnchor = ctx.repaintScope();
    const paint = (): void =>
      repaintAnchor(() =>
        host.replaceChildren(renderAnchorWidget(ctx, node, paint))
      );
    paint();
    body.append(host);
  }
  return ctx.section("constraints", "Constraints", body);
}

/**
 * Change `position`, and carry the element's current place with it.
 *
 * Taking something out of flow is not one declaration. `position: absolute`
 * on its own drops the element onto its offset parent's origin, which is a
 * terrible answer to "put this where I can move it precisely" — so the panel
 * used to offer a separate "Make absolute" button that measured first, sitting
 * directly beneath a dropdown that did the naive thing. Two controls, one
 * decision, and the more discoverable one was the worse one.
 *
 * The measurement belongs to the choice. Picking Absolute or Fixed on an
 * element that is still in flow pins it where it already is; going back to
 * Static or Relative releases the insets so it returns to where the document
 * puts it. Both directions are one undo step, because `onChange` batches and
 * these all land inside one call stack.
 */
function setPositionMode(
  ctx: SectionContext,
  node: Element,
  value: string
): void {
  const pinning = value === "absolute" || value === "fixed";
  if (pinning && !isPositioned(node)) {
    for (const d of pinInPlace(node, value)) {
      ctx.onChange(d.property, d.value);
    }
    return;
  }
  ctx.onChange("position", value);
  if (!pinning) {
    for (const d of releasePin()) {
      ctx.onChange(d.property, d.value);
    }
  }
}

/**
 * The 40×40 anchor box, composed rather than inlined as 25 SVGs — see
 * `constraints.ts`. Four edge bars plus a centre, per axis.
 */
function renderAnchorWidget(
  ctx: SectionContext,
  node: Element,
  repaint: () => void
): HTMLElement {
  const box = el("div", { class: cls("anchor") });
  const current: Record<ConstraintAxis, Anchor> = {
    h: readAnchor(node, "h"),
    v: readAnchor(node, "v"),
  };

  const set = (axis: ConstraintAxis, anchor: Anchor): void => {
    const px = currentInset(node, axis, anchor);
    for (const d of writeAnchor(node, axis, anchor, px)) {
      ctx.onChange(d.property, d.value);
    }
    // The widget's own bars and the Position fields — nothing else. An anchor
    // change moves which inset holds the element, so the coordinates have to
    // re-measure, but no section appears or disappears.
    repaint();
    ctx.reseed();
  };

  const bar = (
    axis: ConstraintAxis,
    anchor: Anchor,
    side: string,
    label: string
  ): HTMLElement => {
    const on = current[axis] === anchor || current[axis] === "stretch";
    const btn = el("button", {
      "aria-label": label,
      class: cls("anchor-bar"),
      "data-tip": label,
      onClick: () => set(axis, current[axis] === anchor ? "center" : anchor),
      type: "button",
    });
    btn.dataset.side = side;
    btn.classList.toggle(cls("anchor-on"), on);
    return btn;
  };

  box.append(
    bar("v", "start", "top", "Pin to top"),
    bar("h", "end", "right", "Pin to right"),
    bar("v", "end", "bottom", "Pin to bottom"),
    bar("h", "start", "left", "Pin to left"),
    el("div", { class: cls("anchor-core") })
  );

  const modes = el("div", { class: cls("anchor-modes") });
  for (const axis of ["h", "v"] as const) {
    const seg = createSegmented(
      axis === "h" ? CONSTRAIN_H : CONSTRAIN_V,
      current[axis],
      (_property, value) => set(axis, value as Anchor)
    );
    ctx.register(seg);
    modes.append(seg.element);
  }

  return el("div", { class: cls("anchor-wrap") }, [box, modes]);
}
