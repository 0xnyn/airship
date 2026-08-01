/**
 * Cross-realm DOM helpers.
 *
 * Every node the editor touches can come from a different JS realm than the one
 * this bundle runs in: in canvas mode the app lives inside frame iframes while
 * the overlay runs in the shell. Same-origin property access still works, but
 * two things stop working *silently*, which is the dangerous part:
 *
 * - `instanceof` against the shell's constructors. An iframe's `<div>` is not
 *   `instanceof` the shell realm's `Element` — each realm has its own. A guard
 *   written that way doesn't throw, it just answers `false` for every frame
 *   node, so the editor stops recognising nodes it owns.
 * - Bare global lookups like `getComputedStyle`. These resolve the *shell's*
 *   window, which measures the node against the wrong viewport — so a frame at
 *   375px would report percentage and viewport-relative values resolved against
 *   the browser window instead.
 *
 * Both fixes are correct in the single-document inline mode too, so this module
 * is safe to route everything through unconditionally.
 */

/** The window a node actually lives in, or null if it is detached. */
export function ownerWindow(node: Node): (Window & typeof globalThis) | null {
  const doc =
    node.nodeType === Node.DOCUMENT_NODE
      ? (node as Document)
      : node.ownerDocument;
  return (doc?.defaultView as (Window & typeof globalThis) | null) ?? null;
}

/** The document a node lives in (itself, if it *is* a document). */
export function ownerDocument(node: Node): Document | null {
  return node.nodeType === Node.DOCUMENT_NODE
    ? (node as Document)
    : node.ownerDocument;
}

/**
 * Realm-safe `value instanceof Element`. `nodeType` is an own-property of every
 * node in every realm, so duck-typing on it crosses the boundary that
 * `instanceof` cannot.
 */
export function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Node).nodeType === 1
  );
}

/** Realm-safe `value instanceof Node`. */
export function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Node).nodeType === "number"
  );
}

/** Realm-safe `value instanceof HTMLElement`. */
export function isHtmlElement(value: unknown): value is HTMLElement {
  return isElement(value) && "style" in value;
}

/**
 * Realm-safe `getComputedStyle`, resolved against the node's own window so
 * viewport- and percentage-relative values are measured in the right viewport.
 */
export function computedStyle(node: Element): CSSStyleDeclaration {
  const win = ownerWindow(node);
  return (win ?? window).getComputedStyle(node);
}
