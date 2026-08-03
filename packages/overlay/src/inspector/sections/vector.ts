/**
 * Vector — the paint and stroke properties of an SVG shape.
 *
 * Written as CSS properties rather than SVG presentation attributes. Both work
 * and the attribute is what most SVG files carry, but a CSS declaration is what
 * the rest of this inspector produces, what the preview stylesheet can apply,
 * and what wins over an attribute in the cascade — so an edit here is visible
 * immediately even on a shape whose markup sets `fill="red"`.
 */
import { cls, el } from "../../dom";
import { createNumField } from "../controls/num-field";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";
import { enumDescriptor, labelled } from "./row";

/** Dash arrays separate their lengths with commas, whitespace, or both. */
const DASH_SEPARATOR = /[\s,]+/;

const LINECAP = enumDescriptor(
  "strokeLinecap",
  "stroke-linecap",
  "Cap",
  [
    { label: "Butt", value: "butt" },
    { label: "Round", value: "round" },
    { label: "Square", value: "square" },
  ],
  "butt"
);

const LINEJOIN = enumDescriptor(
  "strokeLinejoin",
  "stroke-linejoin",
  "Join",
  [
    { label: "Miter", value: "miter" },
    { label: "Round", value: "round" },
    { label: "Bevel", value: "bevel" },
  ],
  "miter"
);

const FILL_RULE = enumDescriptor(
  "fillRule",
  "fill-rule",
  "Fill rule",
  [
    { label: "Nonzero", value: "nonzero" },
    { label: "Even-odd", value: "evenodd" },
  ],
  "nonzero"
);

const VECTOR_EFFECT = enumDescriptor(
  "vectorEffect",
  "vector-effect",
  "Scaling",
  [
    { label: "Scale stroke", value: "none" },
    { label: "Keep stroke width", value: "non-scaling-stroke" },
  ],
  "none"
);

/**
 * Is this paint something the colour row can represent?
 *
 * SVG's `fill`/`stroke` take a *paint*, not just a colour: `url(#brand-grad)` names a
 * gradient or pattern, and `none` and `context-fill` are keywords. `parseColor` reads
 * none of those, so `opaque()` fell back to `#000000` — the swatch showed black for a
 * gradient-filled path, and touching the alpha slider wrote a solid
 * `fill: rgb(0 0 0 / …)` over it, destroying the paint server reference.
 *
 * Following the pattern `gradient.ts` and `filters.ts` already use: show an unmodelled
 * value as itself and refuse to rewrite it, rather than replacing it with a worse
 * approximation.
 */
const PAINT_SERVER = /^(url\(|context-(fill|stroke)$|none$)/i;

function isEditablePaint(value: string): boolean {
  const v = value.trim();
  return Boolean(v) && !PAINT_SERVER.test(v);
}

/** A read-only row naming a paint this section will not touch. */
function paintNote(value: string, tip: string): HTMLElement {
  const note = el("span", { class: cls("grad-na"), text: value.trim() });
  note.dataset.tip = tip;
  return note;
}

export function renderVector(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  const fill = readValue(node, "fill");
  body.append(
    labelled(
      "Fill",
      isEditablePaint(fill) || !fill
        ? ctx.colorRow(
            fill || "#000000",
            "Fill",
            (next) => ctx.onChange("fill", next),
            node,
            ["fill"]
          )
        : paintNote(
            fill,
            "A paint server or keyword — edit it in the source, or in the CSS tab"
          )
    )
  );

  const stroke = readValue(node, "stroke");
  const strokeRow =
    stroke && !isEditablePaint(stroke) && stroke.trim() !== "none"
      ? paintNote(
          stroke,
          "A paint server or keyword — edit it in the source, or in the CSS tab"
        )
      : ctx.colorRow(
          stroke || "none",
          "Stroke",
          (next) => {
            ctx.onChange("stroke", next);
            // A stroke colour with no width paints nothing, which reads as the
            // control being broken. Same implication `stroke.ts` makes for borders.
            const width = Number.parseFloat(readValue(node, "stroke-width"));
            if (!Number.isFinite(width) || width === 0) {
              ctx.onChange("stroke-width", "1");
            }
          },
          node,
          ["stroke"]
        );
  body.append(labelled("Stroke", strokeRow));

  const width = createNumField(
    {
      glyph: "stroke-width",
      label: "Stroke width",
      min: 0,
      step: 0.5,
      unit: "",
    },
    readValue(node, "stroke-width") || "0",
    (css) => ctx.onChange("stroke-width", css),
    ctx.gestures
  );
  ctx.register({
    destroy: width.destroy,
    element: width.element,
    properties: ["stroke-width"],
    setValue: (_p, value) => width.setValue(value),
  });
  body.append(labelled("Width", width.element));

  /*
   * Two fields, because a dash array is two numbers.
   *
   * Both write the whole declaration through `formatDashArray`, reading the other's
   * current value from the DOM — so editing one cannot silently discard the other, which
   * is what a single field writing `String(n)` did.
   */
  const dashFields: Record<"dash" | "gap", { setValue: (v: string) => void }> =
    {} as Record<"dash" | "gap", { setValue: (v: string) => void }>;
  const writeDash = (which: "dash" | "gap", css: string): void => {
    const current = dashPair(readValue(node, "stroke-dasharray"));
    const next = { ...current, [which]: css };
    ctx.onChange(
      "stroke-dasharray",
      formatDashArray(Number.parseFloat(next.dash), Number.parseFloat(next.gap))
    );
  };
  for (const [key, label] of [
    ["dash", "Dash"],
    ["gap", "Gap"],
  ] as const) {
    const field = createNumField(
      {
        glyph: key === "dash" ? "stroke-dash" : "gap-h",
        label: key === "dash" ? "Dash length" : "Gap between dashes",
        min: 0,
        unit: "",
      },
      dashPair(readValue(node, "stroke-dasharray"))[key],
      (css) => writeDash(key, css),
      ctx.gestures
    );
    dashFields[key] = field;
    ctx.register({
      destroy: field.destroy,
      element: field.element,
      properties: ["stroke-dasharray"],
      setValue: (_p, value) => field.setValue(dashPair(value)[key]),
    });
    body.append(labelled(label, field.element));
  }

  for (const descriptor of [LINECAP, LINEJOIN, FILL_RULE, VECTOR_EFFECT]) {
    body.append(ctx.fieldCell(descriptor, node));
  }

  return ctx.section("vector", "Vector", body);
}

/**
 * A dash array as the two numbers the section edits: dash length and gap.
 *
 * `stroke-dasharray` is a *list*, and this section showed only its head and wrote back a
 * single number — so `stroke-dasharray: 8 4` displayed `8`, and scrubbing it emitted
 * `stroke-dasharray: 9`, which means "9 on, 9 off". The 4px gap the author chose was
 * gone, and there was no gap field at all despite the label reading "Dash length".
 *
 * CSS's own rule for an odd-length list is that it repeats to become even, so a lone
 * `8` genuinely means `8 8` — which is why the gap defaults to the dash rather than to
 * zero.
 */
function dashPair(value: string): { dash: string; gap: string } {
  if (!value || value.trim() === "none") {
    return { dash: "0", gap: "0" };
  }
  const parts = value
    .split(DASH_SEPARATOR)
    .map((p) => Number.parseFloat(p))
    .filter((n) => Number.isFinite(n));
  if (parts.length === 0) {
    return { dash: "0", gap: "0" };
  }
  const [dash] = parts;
  return { dash: String(dash), gap: String(parts[1] ?? dash) };
}

/** The declaration for a dash/gap pair. A zero dash is a solid line, not a dash. */
function formatDashArray(dash: number, gap: number): string {
  if (!(Number.isFinite(dash) && dash > 0)) {
    return "none";
  }
  const g = Number.isFinite(gap) && gap > 0 ? gap : dash;
  // `8 8` and `8` are the same declaration; the shorter one is what a human writes.
  return g === dash ? String(dash) : `${dash} ${g}`;
}
