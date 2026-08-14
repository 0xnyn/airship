/**
 * Vector — the paint and stroke properties of an SVG shape.
 *
 * Written as CSS properties rather than SVG presentation attributes. Both work
 * and the attribute is what most SVG files carry, but a CSS declaration is what
 * the rest of this inspector produces, what the preview stylesheet can apply,
 * and what wins over an attribute in the cascade — so an edit here is visible
 * immediately even on a shape whose markup sets `fill="red"`.
 *
 * That cascade argument holds on the shape itself and fails one level up: on
 * an `<svg>` *root*, a declaration only reaches the shapes by inheritance,
 * which any presentation attribute on a child beats. Every hand-built row
 * here therefore reads and writes through `svg-paint.ts`'s plan — self, the
 * root's `color` for a `currentColor` icon, or a fan across the declaring
 * shapes.
 *
 * Known deferral: the four enum cells at the bottom (`stroke-linecap`,
 * `stroke-linejoin`, `fill-rule`, `vector-effect`) still go through
 * `ctx.fieldCell`, whose write is bound to the selection — so on a root they
 * remain shadowed by a child's `stroke-linecap="round"`. Routing them through
 * the plan means teaching `fieldCell` to take a write target, a much larger
 * change for four rarely-touched properties.
 */
import { cls, el } from "../../dom";
import { createNumField } from "../controls/num-field";
import { isEditablePaint, planVector, vectorSeed } from "../svg-paint";
import type { SectionContext } from "./context";
import { enumDescriptor, labelled } from "./row";

/**
 * What fill and stroke say when the paint is not a colour.
 *
 * One constant rather than the same sentence twice: the two rows are built
 * apart, and the pair had already drifted once into wording that read as two
 * different limitations.
 */
const PAINT_NOTE = "Paint server or keyword, edit in CSS";

/**
 * Shown instead of a colour row when the owner scan hit its cap.
 *
 * A control here would be a lie of a specific kind: it would edit the shapes
 * that were scanned and silently leave the rest, so the swatch would show a
 * colour the illustration does not have. `planVector` already refuses to route
 * a truncated scan through `color`; this is the same refusal made visible.
 */
const TRUNCATED_NOTE = "Too many shapes to edit here — edit in CSS";

/** The row a truncated plan gets in place of a control. */
function truncatedNote(owners: number): HTMLElement {
  return paintNote(`${owners}+ shapes`, TRUNCATED_NOTE);
}

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

/*
 * `isEditablePaint` moved to `svg-paint.ts` (it is a fact about paints, and
 * `vectorShapeKey` needs it too). The behaviour is unchanged: show an
 * unmodelled value — a paint server, a keyword — as itself and refuse to
 * rewrite it, the same pattern `gradient.ts` and `filters.ts` use.
 */

/** A read-only row naming a paint this section will not touch. */
function paintNote(value: string, tip: string): HTMLElement {
  const note = el("span", { class: cls("grad-na"), text: value.trim() });
  note.dataset.tip = tip;
  return note;
}

export function renderVector(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  // The one read and the one write every row below goes through. The plan is
  // resolved at *write* time, not captured at render — the children it reads
  // can change under HMR or an agent edit while this DOM stands.
  const read = (property: string): string => vectorSeed(node, property);
  const write = (property: string, value: string): void => {
    const plan = planVector(node, property);
    if (plan.kind === "color") {
      // The `currentColor` icon: one declaration on the root repaints every
      // shape, and it is the edit a human wants in source.
      ctx.onChange("color", value);
      return;
    }
    if (plan.kind === "self") {
      ctx.onChange(property, value);
      return;
    }
    /*
     * One undo step however many shapes it touches. Still one chip per shape
     * — honest but loud; the flash is the affordance and chips are
     * individually removable.
     *
     * `writeOn` rather than a hand-rolled `batch` + `recordOn` loop, which is
     * what this was. `recordOn` is only the recording half: the outline never
     * re-pinned, the CSS pane never rebuilt, and — the one that showed — the
     * composer was never told, so a fanned paint edit sat in the change set
     * with no chip until something unrelated fired a notify. `writeOn` is the
     * same sequence `onChange` gets, aimed at nodes outside the selection.
     *
     * `standIn` because these shapes are not a different element in any sense
     * the user recognises: they are where *this* selection's paint had to land.
     * Without it the edit dropped the panel's scope and forced state.
     */
    ctx.writeOn(plan.owners, property, value, { standIn: true });
    for (const owner of plan.owners) {
      ctx.flash(owner);
    }
  };

  /*
   * What the row's token badge is allowed to bind, which is not always the
   * property the row edits.
   *
   * A badge writes through `panel.applyToken` → `writeBinding` → the *selection*,
   * and nothing on that path consults `planVector`. So on a `currentColor` icon
   * the row's own commit correctly wrote `color` on the root while the badge
   * beside it wrote `fill` there — a declaration every shape shadows. The token
   * was recorded, the chip appeared, and nothing repainted.
   *
   * Handing the badge the property the plan actually writes makes the two agree,
   * and fixes the read side for free: `unlinkToken` records
   * `readValue(node, property)`, which for a `currentColor` icon asked the root
   * for its `fill` and got the initial black.
   *
   * `fan` gets no badge at all. There is no property that stands for "this value
   * on each of N shapes", and an affordance that cannot be honoured is worse
   * than its absence — the more so because the shapes a fan writes to often live
   * in `node_modules`, where binding a design token is not something to offer
   * casually.
   *
   * Resolved at render time while `write` resolves at write time, which is
   * consistent rather than sloppy: `vectorShapeKey` puts the plan-relevant state
   * of the children into `shapeKey`, so a plan that flips rebuilds this row.
   */
  const bindable = (property: string): readonly string[] => {
    const plan = planVector(node, property);
    if (plan.kind === "color") {
      return ["color"];
    }
    return plan.kind === "self" ? [property] : [];
  };

  const fill = read("fill");
  const fillPlan = planVector(node, "fill");
  let fillRow: HTMLElement;
  if (fillPlan.truncated) {
    fillRow = truncatedNote(fillPlan.owners.length);
  } else if (isEditablePaint(fill) || !fill) {
    fillRow = ctx.colorRow(
      fill || "#000000",
      "Fill",
      (next) => write("fill", next),
      node,
      bindable("fill"),
      () => read("fill")
    );
  } else {
    fillRow = paintNote(fill, PAINT_NOTE);
  }
  body.append(labelled("Fill", fillRow));

  /*
   * An absent or `none` stroke is shown as `transparent`, not as `none`.
   *
   * `none` is deliberately *not* sent to `paintNote` — unlike a `url(#grad)`
   * paint server there is something useful to do with it, which is add a stroke
   * — so it reaches the colour row, and the colour row could not read it.
   * `isParseableColor("none")` is false, so every unstroked shape rendered the
   * `Mixed` hairline: the state that means "several values, one of which you are
   * about to impose", used here to mean "no value at all".
   *
   * `transparent` is the same absence written as a colour the swatch can paint —
   * an empty checkerboard, which is what `sections/fill.ts` already shows for an
   * unfilled box. The seed and the re-seed `read` have to agree on this or the
   * next refresh pushes `none` back in and the row flips to `Mixed`.
   */
  const asColor = (paint: string): string =>
    !paint || paint.trim() === "none" ? "transparent" : paint;

  const stroke = read("stroke");
  const strokePlan = planVector(node, "stroke");
  let strokeRow: HTMLElement;
  if (strokePlan.truncated) {
    strokeRow = truncatedNote(strokePlan.owners.length);
  } else if (stroke && !isEditablePaint(stroke) && stroke.trim() !== "none") {
    strokeRow = paintNote(stroke, PAINT_NOTE);
  } else {
    strokeRow = ctx.colorRow(
      asColor(stroke),
      "Stroke",
      (next) => {
        /*
         * One batch, because this is one click.
         *
         * The implied width below is a second `write`, and each `write` is
         * its own `history.batch` — so setting a colour on an unstroked
         * shape cost two undo presses to take back. `history.batch` nests
         * on a depth counter and commits only at zero, so bracketing them
         * here collapses both into the step the user thinks they made.
         */
        ctx.batch(() => {
          write("stroke", next);
          // A stroke colour with no width paints nothing, which reads as the
          // control being broken. Same implication `stroke.ts` makes for borders.
          const width = Number.parseFloat(read("stroke-width"));
          if (!Number.isFinite(width) || width === 0) {
            write("stroke-width", "1");
          }
        });
      },
      node,
      bindable("stroke"),
      () => asColor(read("stroke"))
    );
  }
  body.append(labelled("Stroke", strokeRow));

  const width = createNumField(
    {
      glyph: "stroke-width",
      label: "Stroke width",
      min: 0,
      step: 0.5,
      unit: "",
    },
    read("stroke-width") || "0",
    (css) => write("stroke-width", css),
    ctx.gestures
  );
  ctx.register({
    destroy: width.destroy,
    element: width.element,
    properties: ["stroke-width"],
    // Re-derived through the plan, never taken from the push: `reseed` reads
    // the *selection*, and on an `<svg>` root the value lives on the shapes —
    // taking the pushed value snapped the field back after every refresh.
    setValue: () => width.setValue(read("stroke-width") || "0"),
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
    const current = dashPair(read("stroke-dasharray"));
    const next = { ...current, [which]: css };
    write(
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
      dashPair(read("stroke-dasharray"))[key],
      (css) => writeDash(key, css),
      ctx.gestures
    );
    dashFields[key] = field;
    ctx.register({
      destroy: field.destroy,
      element: field.element,
      properties: ["stroke-dasharray"],
      // Same rule as Width: re-read through the plan on every re-seed.
      setValue: () => field.setValue(dashPair(read("stroke-dasharray"))[key]),
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
