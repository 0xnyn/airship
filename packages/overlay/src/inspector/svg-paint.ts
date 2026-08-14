/**
 * Where an SVG's paint actually lives, and how to edit it from the root.
 *
 * The governing cascade fact: a presentation attribute (`fill="none"`,
 * `stroke="currentColor"`) is a *declaration on the child*, so it beats any
 * value the child would inherit from the root. Setting `fill` or
 * `stroke-width` on an `<svg>` whose shapes carry their own paint repaints
 * nothing — and shapes carrying their own paint is exactly what every icon
 * library emits (lucide: `stroke="currentColor" fill="none"` on the path;
 * heroicons solid: `fill="currentColor"`).
 *
 * `planVector` says where a write must land instead:
 * - `self`  — no descendant declares the property, so the root's inherited
 *   value reaches every shape and the ordinary write works.
 * - `color` — every declaring descendant says `currentColor`, so writing the
 *   CSS `color` on the root repaints instantly *and* is the edit a human
 *   wants in source: it preserves the `currentColor` idiom in a shared icon
 *   component instead of converting it to a literal.
 * - `fan`   — descendants declare literal paints; the write has to land on
 *   each of them. Loud by design (one chip and one flash per shape), and the
 *   fanned targets often live in `node_modules` — which is why `color` is
 *   preferred whenever the idiom allows it.
 */
import { isSvgRoot } from "./element-kind";
import { readValue } from "./style-model";

export type VectorPlan =
  | { kind: "color"; owners: Element[]; truncated: false }
  | { kind: "fan"; owners: Element[]; truncated: boolean }
  | { kind: "self"; truncated: false };

/**
 * How many owners one edit is worth fanning to. An icon has a handful of
 * shapes; an `<svg>` embedding a whole illustration is not something this panel
 * can meaningfully repaint one declaration at a time. Same reasoning as
 * `TEXT_DRILL_CAP`.
 *
 * Note what it no longer bounds. This used to cap the *walk*, which was an
 * attempt to keep `shapeKey`'s per-refresh re-plan cheap — but the walk is a
 * `querySelectorAll("*")` either way, so the cap only ever saved the
 * `declared()` calls, and it bought that by making the answer depend on
 * document order. Correctness first: the scan is complete, the collection is
 * capped, and hitting the cap is reported rather than hidden.
 */
const OWNER_CAP = 200;

/** Only these resolve `currentColor`, so only they can take the `color` route. */
const PAINT_PROPS = new Set(["fill", "stroke"]);

/**
 * SVG `fill`/`stroke` take a *paint*, not just a colour: `url(#brand-grad)`
 * names a gradient or pattern, and `none`/`context-fill` are keywords.
 * `parseColor` reads none of those, so a colour row would show black for a
 * gradient-filled path and write a solid over the paint-server reference.
 *
 * One of four colour predicates — `isParseableColor` in `css-value.ts` lists
 * them and says which question each answers. This one is only about the paint
 * grammar: it says nothing about whether the colour row can render what is
 * left. `none` passes both this and the row, which is deliberate — there is
 * something useful to do with an unstroked shape, namely stroke it — and
 * `sections/vector.ts` is where that case is turned into something showable.
 */
const PAINT_SERVER = /^(url\(|context-(fill|stroke)$|none$)/i;

export function isEditablePaint(value: string): boolean {
  const v = value.trim();
  return Boolean(v) && !PAINT_SERVER.test(v);
}

/**
 * The property's declared text on this element — inline style first (it wins
 * in the cascade), then the presentation attribute. Deliberately *not*
 * computed style, which has already resolved `currentColor` to an rgb and
 * would make the idiom undetectable.
 */
function declared(node: Element, property: string): string | null {
  const inline = (node as SVGElement).style?.getPropertyValue(property);
  if (inline) {
    return inline;
  }
  return node.getAttribute(property);
}

/**
 * Descendants that declare the property themselves and so shadow the root.
 *
 * The cap is on how many owners are *collected*, not on how far the walk gets.
 * It used to be `Math.min(all.length, OWNER_CAP)` over `querySelectorAll("*")`,
 * which is a cap on **document order** — so a `<defs>` block, a `<title>` and a
 * few nested `<g>`s could spend the whole budget before the first shape, and
 * which shapes were found depended on how the file happened to be laid out.
 *
 * `truncated` is the part that matters more than the count. A caller that does
 * not know the scan was partial will happily quantify over it; `planVector`
 * does exactly that, and got a wrong answer rather than an incomplete one.
 */
function ownersOf(
  root: Element,
  property: string
): { owners: Element[]; truncated: boolean } {
  const owners: Element[] = [];
  for (const node of root.querySelectorAll("*")) {
    if (!declared(node, property)) {
      continue;
    }
    if (owners.length === OWNER_CAP) {
      return { owners, truncated: true };
    }
    owners.push(node);
  }
  return { owners, truncated: false };
}

/**
 * Where a write to this property has to land.
 *
 * The `color` route is only available on a **complete** scan. It is a claim
 * about every shape in the tree — that not one of them declares a literal paint
 * — and a partial scan cannot support it: `allCurrent` used to be quantified
 * over the truncated list, so a `fill="#f00"` path past the cap produced a
 * `color` plan, one declaration on the root, and a shape that never repainted.
 * That is a *wrong* route rather than a short one, which is the worse failure of
 * the two, so the doubt resolves to `fan` and the truncation travels with it.
 */
export function planVector(root: Element, property: string): VectorPlan {
  if (!isSvgRoot(root)) {
    return { kind: "self", truncated: false };
  }
  const { owners, truncated } = ownersOf(root, property);
  if (owners.length === 0) {
    return { kind: "self", truncated: false };
  }
  const allCurrent = owners.every(
    (o) => declared(o, property)?.trim().toLowerCase() === "currentcolor"
  );
  if (PAINT_PROPS.has(property) && allCurrent && !truncated) {
    return { kind: "color", owners, truncated: false };
  }
  return { kind: "fan", owners, truncated };
}

/**
 * The value the section's row should show.
 *
 * Reading the *root* was the quiet half of the bug: `fill`'s initial value is
 * black, so the swatch showed black for a `currentColor` icon before anything
 * was touched — the row lied at rest, not only on write. The first owner's
 * computed value is the paint actually on screen, with `currentColor` already
 * resolved to the colour the user sees. When several owners disagree the
 * first stands for all of them; `colorRow` has no `Mixed`.
 */
export function vectorSeed(root: Element, property: string): string {
  const plan = planVector(root, property);
  if (plan.kind === "self") {
    return readValue(root, property);
  }
  return readValue(plan.owners[0], property);
}

/**
 * The bit of `shapeKey` the Vector section owns: whether its Fill and Stroke
 * rows render as colour rows or as read-only paint notes. That choice is
 * derived from `vectorSeed`, which reads the *children* — an agent edit or an
 * HMR swap can flip it while nothing about the root changes, and the panel's
 * rule is that anything gating a control must re-key a refresh.
 *
 * The plan's own `kind` is in the key too, and has to be. The section decides
 * two more things from it at render time: whether the row shows a paint note
 * because the scan was truncated, and which property its token badge is allowed
 * to bind — `color` for a `currentColor` icon, the property itself when nothing
 * shadows it, and none at all for a fan. Both are structure rather than value,
 * so a plan that flips without the seed changing still has to rebuild.
 */
export function vectorShapeKey(node: Element): string {
  return `${rowKey(node, "fill")}${rowKey(node, "stroke")}`;
}

/** One row's structure: is it editable, what plan routes it, was it truncated. */
function rowKey(node: Element, property: string): string {
  const plan = planVector(node, property);
  const paint = vectorSeed(node, property);
  const editable =
    property === "stroke"
      ? !(paint && !isEditablePaint(paint) && paint.trim() !== "none")
      : isEditablePaint(paint) || !paint;
  return `${editable ? "e" : "n"}${plan.kind[0]}${plan.truncated ? "t" : ""}`;
}
