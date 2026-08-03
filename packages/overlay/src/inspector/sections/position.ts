import { cls, el } from "../../dom";
import { isPositioned, measureXY, readAnchor } from "../constraints";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";
import { insetOf, parseTranslate, readRotation } from "./measure";

/**
 * X, Y, rotation and stacking order — design-tool coordinates, not CSS's.
 *
 * X and Y used to read the `translate` property directly, which meant an
 * ordinary element in normal flow reported `0, 0` however far down the page
 * it sat. That is not what anyone means by "where is this", and it made the
 * whole section look broken on the first element anyone clicked.
 *
 * They now show the element's measured coordinates inside its offset parent
 * (`measureXY`), and committing applies the **difference** rather than the
 * number. Where that difference lands depends on the element, and this is the
 * part worth understanding:
 *
 * - **Positioned** (`absolute` / `fixed`): it moves the inset. Which inset
 *   follows the constraint — a right-anchored element keeps its `right` and
 *   its pin survives the edit, where blindly writing `left` would silently
 *   unpin it and put the Constraints widget one edit out of date.
 * - **In flow** (`static` / `relative`): it moves `translate`, which offsets
 *   the element visually without taking it out of flow or changing what the
 *   generated CSS says about its layout mode. It is also exactly what
 *   `nudge()` and `writeAnchor`'s centre case write, so all three compose
 *   instead of fighting over the same pixels.
 */
export function renderPosition(
  ctx: SectionContext,
  node: Element
): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  const axes = [
    { glyph: "X", key: "x", label: "X position" },
    { glyph: "Y", key: "y", label: "Y position" },
  ] as const;
  const fields = axes.map((axis) =>
    ctx.numControl(
      {
        fieldKey: `pos-${axis.key}`,
        glyph: axis.glyph,
        label: axis.label,
        unit: "px",
      },
      String(Math.round(measureXY(node)[axis.key])),
      (css) => {
        const n = Number.parseFloat(css);
        if (!Number.isNaN(n)) {
          moveTo(ctx, node, axis.key, n);
        }
      },
      // Everything that can move the element without going through this
      // field. `margin` is in the list because a margin edit relocates an
      // in-flow element, and the coordinate is a measurement, not a mirror.
      [
        "left",
        "top",
        "right",
        "bottom",
        "translate",
        "position",
        "margin-left",
        "margin-top",
      ],
      () => String(Math.round(measureXY(node)[axis.key]))
    )
  );

  const rotField = ctx.numControl(
    {
      fieldKey: "pos-rotate",
      glyph: "rotation",
      label: "Rotation",
      suffix: "°",
      unit: "deg",
    },
    String(readRotation(node)),
    (css) => {
      const n = Number.parseFloat(css);
      if (!Number.isNaN(n)) {
        ctx.onChange("rotate", `${n}deg`);
      }
    },
    ["rotate", "transform"],
    () => String(readRotation(node))
  );

  /*
   * Stacking order.
   *
   * `auto` shows as a placeholder rather than as `0`, because they are not
   * the same thing: `auto` means "paint in tree order, create no stacking
   * context", and `z-index: 0` on a positioned element *does* create one —
   * enough to change what draws over what. Displaying a value the element
   * does not have, in a field whose whole job is to say what it has, is the
   * kind of small lie that costs an afternoon.
   */
  const zField = ctx.numControl(
    {
      fieldKey: "pos-z",
      glyph: "Z",
      keywords: ["auto"],
      label: "Stacking order",
      placeholder: "auto",
      step: 1,
      unit: "",
    },
    readValue(node, "z-index") === "auto" ? "" : readValue(node, "z-index"),
    (css) => ctx.onChange("z-index", css.trim() || "auto"),
    ["z-index"],
    (value) => (value === "auto" ? "" : value)
  );

  const grid = el("div", { class: cls("grid") });
  grid.append(
    fields[0].element,
    fields[1].element,
    rotField.element,
    zField.element
  );
  body.append(grid);
  return ctx.section("position", "Position", body);
}

/**
 * Move the selection so its measured X or Y becomes `target`.
 *
 * A delta, not an assignment: the number on screen is a measurement of where
 * the element ended up, and the properties that put it there — an inset, a
 * translate, a flex parent's distribution — are not the number. Reading the
 * current measurement and shifting by the difference is the only form that
 * behaves the same whichever of them is in play.
 */
export function moveTo(
  ctx: SectionContext,
  node: Element,
  axis: "x" | "y",
  target: number
): void {
  const delta = target - measureXY(node)[axis];
  if (delta === 0) {
    return;
  }
  if (isPositioned(node)) {
    const anchor = readAnchor(node, axis === "x" ? "h" : "v");
    const near = axis === "x" ? "left" : "top";
    const far = axis === "x" ? "right" : "bottom";
    // A stretched element is pinned to both edges; moving it means moving
    // both, or it would resize instead of move.
    if (anchor === "end") {
      ctx.onChange(far, `${Math.round(insetOf(node, far) - delta)}px`);
      return;
    }
    if (anchor === "stretch" || anchor === "scale") {
      ctx.onChange(near, `${Math.round(insetOf(node, near) + delta)}px`);
      ctx.onChange(far, `${Math.round(insetOf(node, far) - delta)}px`);
      return;
    }
    ctx.onChange(near, `${Math.round(insetOf(node, near) + delta)}px`);
    return;
  }
  const { x, y } = parseTranslate(readValue(node, "translate"));
  const next = axis === "x" ? { x: x + delta, y } : { x, y: y + delta };
  ctx.onChange("translate", `${Math.round(next.x)}px ${Math.round(next.y)}px`);
}
