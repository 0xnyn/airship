/**
 * What kind of thing is selected, for deciding which sections to render.
 *
 * Deliberately *not* `node-kind.ts`. That module answers a different question —
 * what icon and name a row gets in the layers tree — and its taxonomy is shaped
 * for that: it folds `<video>` and `<canvas>` in with `<img>` under one "image"
 * kind, and treats flex and grid as the same "frame". Both are right for a tree
 * of 30 rows and wrong here, where a `<video>` needs autoplay controls an
 * `<img>` does not.
 *
 * These predicates are cheap and are called from `shapeKey` on every refresh.
 */
import { computedStyle } from "../realm";
import { splitTop } from "./css-value";

/*
 * `object-fit` and `object-position` apply to any replaced element, so all three
 * get the Media section — but only `<img>` carries `alt`, `loading` and
 * `decoding`. `<canvas>` supports none of the three, and on `<picture>` they
 * belong to the inner `<img>` rather than the wrapper, so writing them there
 * produces attributes the browser ignores. `isRasterImage` is the narrower test
 * those three controls gate on.
 */
const IMAGE_TAGS = new Set(["IMG", "PICTURE", "CANVAS"]);

/** Every gradient function, including the repeating and prefixed spellings. */
const GRADIENT =
  /(^|\s|,)(-[a-z]+-)?(repeating-)?(linear|radial|conic)-gradient\(/i;

export function isImage(node: Element): boolean {
  return IMAGE_TAGS.has(node.tagName.toUpperCase());
}

/** An `<img>` specifically — the only one that owns `alt`/`loading`/`decoding`. */
export function isRasterImage(node: Element): boolean {
  return node.tagName.toUpperCase() === "IMG";
}

export function isVideo(node: Element): boolean {
  return node.tagName.toUpperCase() === "VIDEO";
}

export function isMedia(node: Element): boolean {
  return isImage(node) || isVideo(node);
}

/** The `<svg>` element itself, which lays out like a normal box. */
export function isSvgRoot(node: Element): boolean {
  return node.tagName.toLowerCase() === "svg";
}

/**
 * A shape *inside* an SVG — a `<path>`, `<circle>`, `<g>`.
 *
 * These live in a different layout model entirely: no box, no padding, no
 * flex, no text flow. Rendering the Auto layout section for one is offering
 * controls that cannot do anything.
 */
export function isSvgChild(node: Element): boolean {
  return !isSvgRoot(node) && Boolean(node.closest?.("svg"));
}

/**
 * Does the element paint a raster background image?
 *
 * Gradients are excluded because they belong to the Fill section, which already
 * edits them. The `GRADIENT` pattern above covers `conic-` and every
 * `repeating-*` and vendor-prefixed spelling on purpose: a check that only knows
 * `linear-gradient` produces a Background section offering `background-size`
 * for an image that does not exist.
 */
export function hasBackgroundImage(node: Element): boolean {
  const value = computedStyle(node).backgroundImage;
  if (!value || value === "none") {
    return false;
  }
  /*
   * Per *layer*, not across the whole value.
   *
   * `value.includes("url(") && !GRADIENT.test(value)` was false as soon as any layer
   * was a gradient — so the standard darkened hero,
   * `linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.5)), url(hero.jpg)`, reported no
   * background image. The Media section was therefore never rendered, `shapeKey`
   * agreed, and `background-size` / `background-position` / `object-fit` were
   * unreachable for it.
   */
  return splitTop(value).some(
    (layer) => layer.includes("url(") && !GRADIENT.test(layer)
  );
}
