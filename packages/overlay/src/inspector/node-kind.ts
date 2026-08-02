import type { IconName } from "../icons";
import { computedStyle } from "../realm";

/*
 * What kind of thing is this node, for the layers tree?
 *
 * A design tool's tree is legible at a glance because every row carries a glyph saying
 * what it is — a frame, a text layer, a component instance. Airship's tree
 * rendered `div.flex.items-center` in monospace for all of them, which is the
 * least design-tool-like thing in the panel and also the least *useful*: the class
 * list is the one part of a row you can already see on the canvas.
 */

export type NodeKind =
  | "component"
  | "section"
  | "text"
  | "image"
  | "vector"
  | "input"
  | "frame"
  | "group";

export const KIND_ICON: Record<NodeKind, IconName> = {
  component: "layer-component",
  frame: "layer-frame",
  group: "layer-group",
  image: "image",
  input: "insert",
  section: "layer-section",
  text: "layer-text",
  vector: "layer-vector",
};

/** Framework components are PascalCase; host elements are not. */
const CAPITALIZED = /^[A-Z]/;

const IMAGE = new Set(["img", "picture", "video", "canvas"]);
const SECTION = new Set([
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "article",
]);
const INPUT = new Set(["input", "select", "textarea", "button"]);

/**
 * Is this a real component name?
 *
 * React resolves `displayName` for components; lowercase means it came back as
 * a host element and tells us nothing the tag name does not.
 */
export function isComponentName(name?: string | null): boolean {
  return Boolean(name && CAPITALIZED.test(name));
}

/**
 * Classify a node. Order matters: a `<button>` with a React `displayName` is a
 * component first — that is what you selected and what you will edit — and only
 * an input if it is a plain DOM one.
 */
export function nodeKind(node: Element, displayName?: string | null): NodeKind {
  if (isComponentName(displayName)) {
    return "component";
  }
  const tag = node.tagName.toLowerCase();
  if (IMAGE.has(tag)) {
    return "image";
  }
  if (tag === "svg") {
    return "vector";
  }
  if (SECTION.has(tag)) {
    return "section";
  }
  if (INPUT.has(tag)) {
    return "input";
  }

  const children = Array.from(node.childNodes);
  const onlyText =
    children.length > 0 &&
    children.every((c) => c.nodeType === Node.TEXT_NODE) &&
    Boolean(node.textContent?.trim());
  if (onlyText) {
    return "text";
  }

  const { display } = computedStyle(node);
  if (
    display === "flex" ||
    display === "inline-flex" ||
    display === "grid" ||
    display === "inline-grid"
  ) {
    return "frame";
  }
  return "group";
}

/**
 * The name to show in the tree.
 *
 * Prefers the component name — a row reading `Button` is worth far more than
 * `div.inline-flex.items-center.rounded-md`. Falls back to the tag plus at most
 * two classes, which is enough to tell siblings apart without turning the row
 * into a class dump.
 */
export function layerName(node: Element, displayName?: string | null): string {
  if (isComponentName(displayName)) {
    return displayName as string;
  }
  const tag = node.tagName.toLowerCase();
  const text = node.textContent?.trim();
  const children = Array.from(node.childNodes);
  const onlyText =
    children.length > 0 && children.every((c) => c.nodeType === Node.TEXT_NODE);
  if (onlyText && text) {
    // A design tool names a text layer after its content, which is by far the fastest
    // way to find the one you mean.
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
  }
  const classes = Array.from(node.classList).slice(0, 2);
  return classes.length ? `${tag}.${classes.join(".")}` : tag;
}
