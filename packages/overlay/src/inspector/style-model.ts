import { computedStyle } from "../realm";
import type { Descriptor } from "./descriptors";

/**
 * Reads computed styles to seed the inspector controls and applies inline-style
 * previews to the live node for instant feedback. Persisting to source is the
 * agent's job (on Apply) — this module never writes code.
 *
 * Every read goes through `computedStyle` rather than the bare global: a node
 * inside a frame must be measured against that frame's window, or every
 * viewport- and percentage-relative value resolves against the browser window
 * instead of the 375px device the user is actually looking at.
 */

/**
 * The property names a `CSSStyleDeclaration` holds.
 *
 * `for (const p of declaration)` reads better and is what this code used, but the
 * iterator protocol on `CSSStyleDeclaration` is a late addition to the spec that
 * not every implementation has — happy-dom is one that does not, which is why the
 * CSS pane could never be rendered in a test. `length` plus `item(i)` is the
 * original API, is universal, and is what DevTools has always used.
 */
export function propertyNames(declaration: CSSStyleDeclaration): string[] {
  const out: string[] = [];
  for (let i = 0; i < declaration.length; i += 1) {
    const name = declaration.item(i);
    if (name) {
      out.push(name);
    }
  }
  return out;
}

/** Current computed value of a single CSS property. */
export function readValue(node: Element, cssProperty: string): string {
  return computedStyle(node).getPropertyValue(cssProperty).trim();
}

/** Seed a map of descriptor cssProperty → current computed value. */
export function readValues(
  node: Element,
  descriptors: Descriptor[]
): Map<string, string> {
  const values = new Map<string, string>();
  const computed = computedStyle(node);
  for (const d of descriptors) {
    values.set(d.cssProperty, computed.getPropertyValue(d.cssProperty).trim());
  }
  return values;
}

/**
 * Apply an inline-style preview (instant visual feedback).
 *
 * `important` exists for forced pseudo-states. There is no way to make the
 * browser actually match `:hover` from script, so previewing a hover style means
 * writing its declarations inline — and an inline declaration still loses to a
 * stylesheet rule marked `!important`. Ordinary tweaks deliberately do *not* use
 * it: an inline declaration already beats everything they compete with, and
 * `!important` in the `style` attribute is a lie about the cascade that would
 * show up in the CSS pane.
 */
export function applyPreview(
  node: Element,
  cssProperty: string,
  value: string,
  important = false
): void {
  const html = node as HTMLElement;
  if (html.style) {
    html.style.setProperty(cssProperty, value, important ? "important" : "");
  }
}

/** Remove a previously-applied inline preview, whatever its priority. */
export function clearPreview(node: Element, cssProperty: string): void {
  const html = node as HTMLElement;
  if (!html.style) {
    return;
  }
  html.style.removeProperty(cssProperty);
  // A node whose only inline styles were previews should not be left carrying an
  // empty `style=""` — it survives into the DOM the user inspects and into any
  // serialized HTML.
  if (html.getAttribute("style")?.trim() === "") {
    html.removeAttribute("style");
  }
}
