/**
 * Grouping for the CSS pane's computed list, and the probe that decides which
 * of those values the page actually asked for.
 *
 * A resolved `CSSStyleDeclaration` is ~340 properties in alphabetical order,
 * which is a haystack rather than a panel: `align-content` sits between
 * `align-items` and `alignment-baseline`, and `color` is nowhere near
 * `background-color`. DevTools solves this with sections plus a
 * "show all"/"non-default" switch, and this is that split.
 */
import { PREFIX } from "../dom";
import { computedStyle, ownerDocument } from "../realm";
import { propertyNames } from "./style-model";

export type ComputedGroupId =
  | "appearance"
  | "box"
  | "effects"
  | "layout"
  | "motion"
  | "other"
  | "typography";

export const COMPUTED_GROUPS: readonly {
  id: ComputedGroupId;
  label: string;
}[] = [
  { id: "layout", label: "Layout" },
  { id: "box", label: "Box" },
  { id: "typography", label: "Typography" },
  { id: "appearance", label: "Appearance" },
  { id: "effects", label: "Effects" },
  { id: "motion", label: "Motion" },
  { id: "other", label: "Other" },
];

/**
 * Properties whose obvious prefix would file them under the wrong heading.
 * Checked before {@link PREFIXES}, so this is where the exceptions live rather
 * than being encoded as ever-more-specific prefix ordering.
 */
const EXACT = new Map<string, ComputedGroupId>([
  // `text-*` is typography, but a shadow is a paint effect.
  ["text-shadow", "effects"],
  // `column-*` is multi-column text; the gap is flex/grid layout.
  ["column-gap", "layout"],
  ["row-gap", "layout"],
  // `overflow-*` is box, but wrapping is about breaking words.
  ["overflow-wrap", "typography"],
  // `border-*` is box, but the collapse mode is a table-rendering concern.
  ["border-collapse", "other"],
  ["border-spacing", "other"],
]);

/** First match wins, so order within the list is meaningful. */
const PREFIXES: readonly (readonly [ComputedGroupId, readonly string[]])[] = [
  [
    "layout",
    [
      "align-",
      "aspect-ratio",
      "bottom",
      "clear",
      "contain-intrinsic",
      "container",
      "display",
      "flex",
      "float",
      "gap",
      "grid",
      "inset",
      "justify-",
      "left",
      "order",
      "place-",
      "position",
      "right",
      "top",
      "z-index",
    ],
  ],
  [
    "box",
    [
      "block-size",
      "border",
      "box-sizing",
      "height",
      "inline-size",
      "margin",
      "max-",
      "min-",
      "overflow",
      "padding",
      "width",
    ],
  ],
  [
    "typography",
    [
      "column",
      "direction",
      "font",
      "hyphens",
      "letter-spacing",
      "line-",
      "list-style",
      "quotes",
      "tab-size",
      "text",
      "unicode-bidi",
      "vertical-align",
      "white-space",
      "word-",
      "writing-mode",
    ],
  ],
  [
    "appearance",
    [
      "accent-color",
      "appearance",
      "background",
      "caret-color",
      "color",
      "cursor",
      "isolation",
      "mix-blend-mode",
      "object-",
      "opacity",
      "outline",
      "pointer-events",
      "resize",
      "user-select",
      "visibility",
    ],
  ],
  [
    "effects",
    [
      "backdrop-filter",
      "box-shadow",
      "clip",
      "contain",
      "filter",
      "mask",
      "perspective",
      "rotate",
      "scale",
      "transform",
      "translate",
      "will-change",
    ],
  ],
  [
    "motion",
    ["animation", "offset", "overscroll", "scroll", "transition", "view-"],
  ],
];

/** Which section a computed property belongs under. */
export function groupOf(property: string): ComputedGroupId {
  const exact = EXACT.get(property);
  if (exact) {
    return exact;
  }
  for (const [id, prefixes] of PREFIXES) {
    for (const prefix of prefixes) {
      if (property.startsWith(prefix)) {
        return id;
      }
    }
  }
  return "other";
}

/**
 * What this element would compute to if nothing styled it.
 *
 * Measured, not tabulated: a bare element of the same tag is inserted at the
 * node's own position, read, and removed inside a single task. Sitting in the
 * real parent is the whole point — it picks up inherited values as well as UA
 * defaults, so a `color` the page never set reads as default rather than as
 * something the element asked for. Probing at the document root instead would
 * flag every inherited value in the tree as non-default.
 *
 * Deliberately *not* hidden while measured. `display: none` changes how
 * layout-dependent properties resolve, and `visibility`/`position` tricks
 * corrupt the very properties they set — the probe is only in the document for
 * the duration of one synchronous task, and nothing paints in between.
 */
export function defaultsFor(node: Element): Map<string, string> {
  const out = new Map<string, string>();
  const doc = ownerDocument(node);
  const parent = node.parentElement ?? doc?.body;
  if (!(doc && parent)) {
    return out;
  }

  let probe: Element;
  try {
    /*
     * `localName`, not `tagName`.
     *
     * `tagName` is upper-cased for HTML elements, and `createElementNS` is
     * case-sensitive — so this built an element whose local name was literally
     * `"DIV"`, which is an `HTMLUnknownElement` rather than a `div`. Its "defaults"
     * were therefore an unknown element's, not the ones the node being inspected
     * actually starts from, so the pane's default/non-default split was wrong for
     * every element with any UA styling of its own (`<input>`, `<button>`, `<table>`).
     */
    probe = doc.createElementNS(node.namespaceURI, node.localName);
  } catch {
    return out;
  }
  // Tagged so the overlay's own guards and any host-app observer can tell this
  // apart from content — it is in the tree for one task, but that is long
  // enough for a MutationObserver to see it.
  probe.setAttribute("class", `${PREFIX}-probe`);
  probe.setAttribute("data-airship-probe", "");

  try {
    /*
     * Appended at the end of the parent, not spliced in beside the node.
     *
     * As the node's *preceding sibling* the probe was matched by the page's own
     * child and sibling selectors — `.card > * { color: #333 }`, and every
     * `.stack > * + *` lobotomised-owl rule — so its "default" came out equal to the
     * authored value. The pane's non-default filter then hid the property and its
     * badge read `default` for something the page had explicitly set.
     *
     * Appending is not perfectly immune (`:last-child` shifts, and `> *` still
     * matches) but it stops the far more common adjacent-sibling combinators from
     * firing, and it no longer displaces the node being measured.
     */
    parent.append(probe);
    const cs = computedStyle(probe);
    for (const property of propertyNames(cs)) {
      out.set(property, cs.getPropertyValue(property).trim());
    }
  } catch {
    // A parent that rejects children (a replaced element, a foreign realm
    // quirk) just means no default data — the pane degrades to showing all.
  } finally {
    probe.remove();
  }
  return out;
}
