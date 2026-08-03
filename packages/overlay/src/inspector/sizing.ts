/*
 * Hug / Fill / Fixed — the design-tool sizing modes — translated to CSS.
 *
 * This is the one place in the Auto Layout panel where the metaphor needs real
 * logic rather than a property rename, because the *same* mode name means
 * different CSS depending on what the parent is:
 *
 * | Mode  | Flex child                   | Anywhere else        |
 * |-------|------------------------------|----------------------|
 * | Fixed | `flex: 0 0 auto` + `<n>px`   | `<n>px`              |
 * | Hug   | `flex: 0 0 auto` + `max-content` | `max-content`    |
 * | Fill  | `flex: 1 1 0%`  + `auto`     | `100%`               |
 *
 * "Fill" outside a flex parent is the lossy one: `width: 100%` fills the
 * *containing block*, which is only the same thing as "fill the remaining
 * space" when there are no siblings. It is still the answer a developer would
 * write, so it is the answer here — but that is why `writeResize` is a pure
 * function with the table above sitting on top of it rather than logic smeared
 * through the panel.
 */
import { computedStyle } from "../realm";
import { matchedRules } from "./css-rules";

export type ResizeMode = "hug" | "fill" | "fixed";
export type Axis = "w" | "h";

interface Decl {
  property: string;
  value: string;
}

const SIZE_PROP: Record<Axis, string> = { h: "height", w: "width" };

/** A concrete length carries a digit; `max-content` and friends do not. */
const HAS_DIGIT = /\d/;

/** Is this node laid out by a flex parent? Decides which column of the table. */
export function isFlexChild(node: Element): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  const { display } = computedStyle(parent);
  return display === "flex" || display === "inline-flex";
}

/** Does this axis run along the parent's main axis? `flex` only governs that one. */
function isMainAxis(node: Element, axis: Axis): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  const column = computedStyle(parent).flexDirection.startsWith("column");
  return axis === "w" ? !column : column;
}

/**
 * Read the current mode back out of what the element *declares*.
 *
 * Authored, not computed — `getComputedStyle().width` on any laid-out element is a
 * used px value, so it can never distinguish Fixed from Hug from Fill. That is why
 * this reaches for the declaration rather than the resolved value.
 *
 * It used to reach only for the **inline** style, while its own closing comment
 * claimed "either declared inline or coming from a stylesheet". For a class-sized
 * element the inline value is `""`, so `HAS_DIGIT.test("")` was false and every one
 * of them reported **Hug**: a `<div class="w-80">` showed the word `Hug` in the W
 * field with the Hug cell lit, and clicking Hug then wrote `width: max-content` and
 * collapsed it. Since almost nothing is sized inline, that was almost every element.
 *
 * `declaredValue` closes the gap by consulting the cascade, and falls back to the
 * inline value so a node whose stylesheet cannot be read (a cross-origin sheet, or a
 * truncated scan) is no worse off than before.
 */
export function resizeMode(node: Element, axis: Axis): ResizeMode {
  const style = computedStyle(node);
  const declared = declaredValue(node, SIZE_PROP[axis]);

  if (declared === "max-content" || declared === "fit-content") {
    return "hug";
  }
  if (isFlexChild(node) && isMainAxis(node, axis)) {
    const grow = Number.parseFloat(style.flexGrow);
    if (grow > 0) {
      return "fill";
    }
  }
  if (declared === "100%" || declared === "auto") {
    return isFlexChild(node) ? "hug" : "fill";
  }
  // A concrete length — declared inline or coming from a stylesheet.
  return HAS_DIGIT.test(declared) ? "fixed" : "hug";
}

/**
 * The number to put in `width`/`height` to leave the element the size it is.
 *
 * Two corrections over the `getBoundingClientRect()` this replaces, both of which
 * made the element *change size* when you pinned it:
 *
 * - **Box model.** `width` is the *content* box unless `box-sizing: border-box`, and
 *   the rect is the border box. On a `<div style="padding:16px">` whose content is
 *   300px wide the rect reads 332, so clicking Fixed wrote `width: 332px` and the
 *   element became 364px — jumping out from under the cursor. Padding and border are
 *   subtracted when the element is `content-box`. (`css-box-model.ts` documents this
 *   rule for the box diagram; `size.ts` was breaking it.)
 * - **Transforms.** `getBoundingClientRect` returns the *post-transform*
 *   axis-aligned bounding box, so a 30°-rotated element reported the width of its
 *   bounding box rather than its own. `offsetWidth`/`offsetHeight` are the
 *   untransformed border box, so they are preferred wherever they exist — the rect
 *   remains the fallback for SVG children, which have no offset box.
 */
export function layoutSize(node: Element, axis: Axis): number {
  const style = computedStyle(node);
  const html = node as HTMLElement;
  const offset = axis === "w" ? html.offsetWidth : html.offsetHeight;
  const rect = node.getBoundingClientRect();
  const border = offset || (axis === "w" ? rect.width : rect.height);
  if (style.boxSizing === "border-box") {
    return border;
  }
  const sides =
    axis === "w"
      ? [
          "padding-left",
          "padding-right",
          "border-left-width",
          "border-right-width",
        ]
      : [
          "padding-top",
          "padding-bottom",
          "border-top-width",
          "border-bottom-width",
        ];
  const inset = sides.reduce(
    (sum, property) =>
      sum + (Number.parseFloat(style.getPropertyValue(property)) || 0),
    0
  );
  return Math.max(0, border - inset);
}

/**
 * What the element declares for one property, inline style or stylesheet.
 *
 * The inline attribute wins, as it does in the cascade. Otherwise the winning
 * declaration from `matchedRules` — which already sorts strongest-first and marks
 * the losers — so this agrees with what the CSS pane shows as the winner rather
 * than being a second opinion.
 */
export function declaredValue(node: Element, property: string): string {
  const inline = (node as HTMLElement).style?.getPropertyValue(property);
  if (inline) {
    return inline.trim();
  }
  for (const rule of matchedRules(node).rules) {
    for (const decl of rule.decls) {
      if (decl.property === property && !decl.overridden) {
        return decl.value.trim();
      }
    }
  }
  return "";
}

/**
 * The declarations for a mode change. Pure — the caller feeds each one through
 * the normal `onChange` pipeline so every property lands in the change set
 * individually, which is what the agent needs to see.
 *
 * `length` is what to pin to when switching *to* Fixed, as a CSS string rather
 * than a number. It used to be a number and this function re-attached `px`, so
 * a `50%` typed into the W field — one of five units the field advertised —
 * came out the other side as `width: 50px`. Callers that only have a measured
 * size pass `${n}px` and are no worse off.
 */
export function writeResize(
  node: Element,
  axis: Axis,
  mode: ResizeMode,
  length: string
): Decl[] {
  const prop = SIZE_PROP[axis];
  const flexChild = isFlexChild(node);
  const main = flexChild && isMainAxis(node, axis);

  if (mode === "fixed") {
    const decls: Decl[] = [{ property: prop, value: length }];
    if (main) {
      decls.push({ property: "flex", value: "0 0 auto" });
    }
    return decls;
  }
  if (mode === "hug") {
    const decls: Decl[] = [{ property: prop, value: "max-content" }];
    if (main) {
      decls.push({ property: "flex", value: "0 0 auto" });
    }
    return decls;
  }
  // Fill.
  if (main) {
    // `flex-basis: 0%` rather than `auto` so siblings share the row evenly
    // regardless of their content width — which is what Fill does.
    return [
      { property: "flex", value: "1 1 0%" },
      { property: prop, value: "auto" },
    ];
  }
  if (flexChild) {
    // Cross axis of a flex parent: stretching is `align-self`, not a length.
    return [
      { property: "align-self", value: "stretch" },
      { property: prop, value: "auto" },
    ];
  }
  return [{ property: prop, value: "100%" }];
}

/** Which modes are meaningful here — Fill needs something to fill into. */
export function availableModes(node: Element, _axis: Axis): ResizeMode[] {
  const modes: ResizeMode[] = ["fixed", "hug"];
  if (node.parentElement) {
    modes.push("fill");
  }
  return modes;
}
