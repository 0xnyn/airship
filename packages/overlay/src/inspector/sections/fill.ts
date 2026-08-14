import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { createTextField } from "../controls/num-field";
import { createRowList } from "../controls/row-list";
import {
  type Fill,
  formatFillLayers,
  parseFillLayers,
  splitTop,
} from "../css-value";
import { hasFill } from "../gates";
import { fillLayerRow } from "../paint";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";
import { labelled } from "./row";

/**
 * The four properties that are parallel lists to `background-image`.
 *
 * CSS aligns them by index: layer 2's size is the second entry in
 * `background-size`. The panel had none of that — `background-size`,
 * `-position` and `-repeat` lived in the *Media* section as **single-valued**
 * selects, gated on `hasBackgroundImage` (which excluded gradients entirely). So
 * a two-layer background got one shared size, choosing "Cover" flattened both
 * layers to it, gradient layers had no geometry control at all, and
 * `background-blend-mode` — the per-fill blend — had no equivalent anywhere.
 */
const GEOMETRY = [
  { initial: "auto", label: "Size", property: "background-size" },
  { initial: "0% 0%", label: "Position", property: "background-position" },
  { initial: "repeat", label: "Repeat", property: "background-repeat" },
  { initial: "normal", label: "Blend", property: "background-blend-mode" },
] as const;

/**
 * Read one layer's entry out of a parallel list.
 *
 * A list shorter than the layer stack *repeats* in CSS, so a single `cover` applies to
 * every layer — which is why the modulo rather than a bounds check.
 */
function layerEntry(
  node: Element,
  property: string,
  index: number,
  initial: string
): string {
  const parts = splitTop(readValue(node, property));
  if (parts.length === 0) {
    return initial;
  }
  return parts[index % parts.length] ?? initial;
}

/**
 * Write one layer's entry back, leaving the others alone.
 *
 * Padded to the layer count first — with the list's own repeating value, not the initial,
 * so expanding a shared `cover` into four explicit entries does not silently change what
 * three of them mean.
 */
function writeLayerEntry(
  ctx: SectionContext,
  node: Element,
  property: string,
  index: number,
  initial: string,
  value: string,
  layerCount: number
): void {
  const next: string[] = [];
  for (let i = 0; i < Math.max(layerCount, index + 1); i += 1) {
    next.push(layerEntry(node, property, i, initial));
  }
  next[index] = value;
  ctx.onChange(property, next.join(", "));
}

/** The one solid-fill row: swatch, hex, alpha, and a minus that takes it away. */
function solidFillRow(
  ctx: SectionContext,
  node: Element,
  color: string
): HTMLElement {
  const row = el("div", { class: cls("rows-row") }, [
    ctx.colorRow(
      color,
      "Fill colour",
      (next) => ctx.onChange("background-color", next),
      node,
      ["background-color"]
    ),
    el(
      "button",
      {
        "aria-label": "Remove fill",
        class: cls("row-icon"),
        "data-tip": "Remove fill",
        onClick: () => {
          ctx.onChange("background-color", "transparent");
          row.remove();
        },
        type: "button",
      },
      [icon("minus", "xs")]
    ),
  ]);
  return row;
}

export function renderFill(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });
  const color = readValue(node, "background-color") || "transparent";
  // A fully transparent background is *no fill*, not black at 0% — showing
  // `000000 / 0%` for every unstyled div is technically true and reads as a
  // bug. A design tool shows an empty section and a `+`; so does ctx.
  //
  // Asked through `ctx.gate`, so a pending `background-color` counts even when
  // the DOM refused it. Binding a colour token whose `var()` did not resolve
  // blanked the computed value, and this row — the one carrying the badge that
  // had just been used — deleted itself.
  const filled = hasFill(ctx.gate(node), node);

  // Held so "remove" can take just this row out, and the `+` can put one
  // back, without either rebuilding the panel.
  const solidRows = el("div", { class: cls("rows") });
  if (filled) {
    solidRows.append(solidFillRow(ctx, node, color));
  }
  body.append(solidRows);

  // Gradient and image layers ride on `background-image`, stacked above the
  // base colour — which is exactly how CSS paints them and how a design tool stacks
  // fills, so the two orderings agree for free.
  const layers = createRowList<Fill>(
    {
      blank: () => ({
        enabled: true,
        kind: "gradient",
        value: "linear-gradient(#ffffff, #cccccc)",
      }),
      cssProperty: "background-image",
      enabled: (r) => r.enabled,
      parse: parseFillLayers,
      render: (row, onEdit, _onDispose, index) =>
        el("div", { class: cls("fill-layer") }, [
          fillLayerRow(row, onEdit, ctx.gestures, node),
          // Per-layer geometry, for the layers that have any. A solid colour is
          // painted by `background-color` and has no size, position or repeat.
          ...(row.kind === "solid" ? [] : [layerGeometry(ctx, node, index)]),
        ]),
      serialize: formatFillLayers,
      setEnabled: (r, on) => ({ ...r, enabled: on }),
    },
    readValue(node, "background-image"),
    ctx.onChange
  );
  ctx.register(layers);
  body.append(layers.element);

  return ctx.section("fill", "Fill", body, {
    actions: [
      ctx.headerAction("plus", "Add fill", () => {
        // The first `+` gives you a solid fill, the way a design tool's does. Only
        // once there is one does it start stacking gradient layers on top.
        // "Is there one" is asked of the live row rather than of `filled`,
        // which was captured when the section was built and goes stale the
        // moment the remove button above takes the row away.
        if (solidRows.childElementCount) {
          layers.add();
        } else {
          // Appended in place, matching the remove button above it — which
          // has always taken its row out without a rebuild. A fill appearing
          // does not change any other section.
          ctx.onChange("background-color", "#FFFFFF");
          solidRows.append(solidFillRow(ctx, node, "#FFFFFF"));
        }
      }),
    ],
  });
}

/** One layer's size, position, repeat and blend, as a compact sub-row. */
function layerGeometry(
  ctx: SectionContext,
  node: Element,
  index: number
): HTMLElement {
  const wrap = el("div", { class: cls("fill-geom") });
  for (const { initial, label, property } of GEOMETRY) {
    const field = createTextField({ label, placeholder: initial });
    const reflect = (): void => {
      const value = layerEntry(node, property, index, initial);
      field.input.value = value === initial ? "" : value;
    };
    reflect();
    let skipBlur = false;
    const commit = (): void => {
      if (skipBlur) {
        skipBlur = false;
        return;
      }
      const typed = field.input.value.trim() || initial;
      if (typed === layerEntry(node, property, index, initial)) {
        return;
      }
      /*
       * The layer count comes from the DOM, not from the row list.
       *
       * Closing over the list would be circular — `render` is part of the spec the list is
       * built from — and the declaration is the honest source anyway: it is what the
       * parallel lists have to stay aligned with.
       */
      writeLayerEntry(
        ctx,
        node,
        property,
        index,
        initial,
        typed,
        parseFillLayers(readValue(node, "background-image")).length
      );
    };
    field.input.addEventListener("blur", commit);
    field.input.addEventListener("keydown", (e) => {
      const { key } = e as KeyboardEvent;
      if (key === "Enter") {
        field.input.blur();
      } else if (key === "Escape") {
        e.stopPropagation();
        reflect();
        skipBlur = true;
        field.input.blur();
      }
    });
    ctx.register({
      element: field.element,
      resync: reflect,
      setValue: () => undefined,
      virtual: true,
    });
    wrap.append(labelled(label, field.element));
  }
  return wrap;
}
