import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { CORNER_PROPERTIES, createCorners } from "../controls/corners";
import { APPEARANCE_GROUP } from "../descriptors";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";

/**
 * The Appearance section: opacity and corner radius on one row, blend
 * mode below them, and Clip content for anything that has an inside.
 *
 * It used to be an opacity cell, a full-width labelled blend-mode select, and
 * `createCorners` bolted on inside an `if (group.id === "appearance")` branch
 * of the generic renderer — three unrelated heights in a section that is four
 * controls long. Opacity and corner radius belong on one line because that is
 * where a design tool puts them and because they are the two you reach for together.
 *
 * What is deliberately *not* here, since a design panel is as much about what
 * it refuses as what it offers:
 *
 * - **Corner smoothing.** The squircle has no CSS equivalent short of a
 *   `clip-path` that would fight `overflow`, `border` and every child.
 * - **`visibility`.** The layer tree's eye already owns show/hide. Two
 *   controls for one property in two places is the redundancy this pass
 *   exists to remove, not to add more of.
 * - **`cursor`.** Interaction, not appearance, and a thirty-option select of
 *   pointer shapes is noise at this density.
 * - **`filter` brightness/contrast/saturate.** Blur already lives in Effects,
 *   which is where design tools keep it; splitting one CSS property across two
 *   sections is how a panel stops being a system.
 * - **`isolation: isolate`** as the "Pass through" blend mode. It is an
 *   honest mapping and it is one more concept than the row can carry.
 */
export function renderAppearance(
  ctx: SectionContext,
  node: Element
): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  const opacity = APPEARANCE_GROUP.descriptors.find((d) => d.key === "opacity");
  const blend = APPEARANCE_GROUP.descriptors.find(
    (d) => d.key === "mixBlendMode"
  );

  const top = el("div", { class: cls("grid") });
  if (opacity) {
    // Through `fieldCell`, so opacity gets the token affordance every other
    // descriptor-driven control has — `opacity` is its own token category, and
    // this control was reaching past the one place that grants it.
    const cell = ctx.fieldCell(opacity, node);
    cell.classList.add(cls("cell"));
    // Layer opacity and fill alpha are different things and the panel offers
    // both, two sections apart. Saying which is which here is cheaper than
    // letting someone discover it by fading their text along with the box.
    cell.dataset.tip = "Layer opacity, children included";
    top.append(cell);
  }
  // Corner radius is four longhands behind one field with its own mode
  // switch, so it cannot be a descriptor — but it sits beside opacity because
  // that is one row of two numbers, not two rows of one.
  const corners = createCorners(
    new Map(CORNER_PROPERTIES.map((p) => [p, readValue(node, p) || "0px"])),
    ctx.onChange,
    ctx.gestures,
    (properties) => ctx.tokenSlot(node, properties)
  );
  ctx.register(corners);
  corners.element.classList.add(cls("cell"));
  top.append(corners.element);
  body.append(top);

  if (blend) {
    const control = ctx.buildControl(blend, node);
    body.append(
      el("div", { class: `${cls("row")} ${cls("group")}` }, [
        el("span", { class: cls("row-label"), text: blend.label }),
        control.element,
      ])
    );
  }

  /*
   * Clip content — `overflow: hidden` ⇄ `visible`.
   *
   * Exactly the frame clip, and the most-used frame property the panel
   * could not previously reach except through the Text section's "Truncate to
   * one line". Two truths worth knowing rather than hiding: `overflow: hidden`
   * also makes a scroll container and breaks `position: sticky` inside it, and
   * because truncation writes the same property, this toggle will read as on
   * after you truncate some text. Reflecting the real property beats keeping a
   * private flag that agrees with nothing.
   *
   * Gated on the node having something inside it to clip. A toggle on a leaf
   * `<span>` is a control with no observable effect.
   */
  if (node.childElementCount > 0) {
    const clipped = readValue(node, "overflow") === "hidden";
    const clip = el(
      "button",
      {
        "aria-pressed": String(clipped),
        class: `${cls("ctl-toggle")}${clipped ? ` ${cls("ctl-toggle-on")}` : ""}`,
        "data-tip": "Clip anything outside this element",
        onClick: () => {
          const now = readValue(node, "overflow") === "hidden";
          ctx.onChange("overflow", now ? "visible" : "hidden");
          // Optimistic, because `onChange` re-seeds through `setValue` only when
          // the write lands — and this button is what the user is looking at.
          paintClip(!now);
        },
        type: "button",
      },
      [
        icon(clipped ? "overflow-clip" : "overflow-visible", "sm"),
        el("span", { text: "Clip content" }),
      ]
    );
    /*
     * Registered, so an undo reaches it.
     *
     * It was a bare `el(...)` that only ever repainted itself from its own click
     * handler, and `overflow` is not in `shapeKey` — so ⌘Z reverted the property
     * while the button stayed lit with `aria-pressed="true"`, and the next click
     * wrote `visible` again. A no-op, which reads as a dead control.
     */
    const paintClip = (on: boolean): void => {
      clip.classList.toggle(cls("ctl-toggle-on"), on);
      clip.setAttribute("aria-pressed", String(on));
      clip.replaceChildren(
        icon(on ? "overflow-clip" : "overflow-visible", "sm"),
        el("span", { text: "Clip content" })
      );
    };
    ctx.register({
      element: clip,
      properties: ["overflow"],
      setValue: (_property, value) => paintClip(value === "hidden"),
    });
    body.append(el("div", { class: cls("group") }, [clip]));
  }

  return ctx.section("appearance", "Appearance", body);
}
