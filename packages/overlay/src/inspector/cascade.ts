/**
 * Two questions the inspector needs the cascade to answer, both derived from
 * one `matchedRules()` scan:
 *
 * - **Scope** — which selectors could this edit be written to? A user tweaking
 *   a button's padding usually means *this* button, but sometimes means every
 *   `.btn`, and only they know which.
 * - **State** — what does this element look like on `:hover`, and how do we let
 *   someone edit that?
 *
 * They share a scan because they are the same question wearing two hats: *which
 * rule does this declaration belong in*. Building them on `matchedRules` rather
 * than a second stylesheet walker also means they inherit its realm-awareness
 * for free — a `@media` query in a 393px frame is evaluated against that frame.
 */
import { PSEUDO_STATES, type PseudoState } from "@airship/protocol";
import { ownerWindow } from "../realm";
import {
  asImportRule,
  conditionHolds,
  matchedRules,
  resolveNested,
  specificity,
  splitSelectorList,
} from "./css-rules";
import { splitWords } from "./css-value";
import { propertyNames } from "./style-model";

/** One option in the Scope picker. */
export interface ScopeLevel {
  /** How many elements in the document this selector currently matches. */
  count: number;
  /** Human label: `.btn`, or "This element". */
  label: string;
  /** The selector to write to. `undefined` ⇒ this instance only. */
  selector?: string;
}

/** A single class selector and nothing else — the only thing safe to offer. */
const SIMPLE_CLASS = /^\.(-?[_a-zA-Z][\w-]*)$/;
/** A character that could continue an identifier, so `:focus` != `:focus-visible`. */
const IDENT_CHAR = /[\w-]/;
const WHITESPACE = /\s+/;

/**
 * The selectors this element's styles could be written to, broadest first.
 *
 * Only simple single-class selectors are offered. A descendant selector like
 * `.card .title` is a *relationship*, and "apply to all of those" is not a
 * choice anyone can reason about from a property panel — whereas `.btn` is
 * exactly the thing a design system means by a component.
 */
export function scopeLevels(node: Element): ScopeLevel[] {
  const doc = node.ownerDocument;
  const seen = new Map<string, ScopeLevel>();

  /*
   * `truncated` is surfaced, not swallowed.
   *
   * The scan stops at 24ms, which on an unpurged Tailwind build happens well before the
   * end — so this list silently omitted classes that *do* apply, differently on each
   * render. A partial list that says it is partial is honest; one that does not invites
   * the user to conclude the class does not exist.
   */
  const scan = matchedRules(node);
  for (const rule of scan.rules) {
    for (const part of splitSelectorList(rule.selector)) {
      const bare = stripStates(part).trim();
      if (!(SIMPLE_CLASS.test(bare) && seen.has(bare) === false)) {
        continue;
      }
      let count = 0;
      try {
        count = doc?.querySelectorAll(bare).length ?? 0;
      } catch {
        continue;
      }
      // A class only this element carries *is* "this element", and offering it
      // as a separate scope would be a distinction without a difference.
      if (count > 1) {
        seen.set(bare, { count, label: bare, selector: bare });
      }
    }
  }

  const levels = [...seen.values()].sort((a, b) => b.count - a.count);
  levels.push({ count: 1, label: "This element" });
  if (scan.truncated) {
    levels.push({ count: 0, label: "…more (stylesheet scan stopped early)" });
  }
  return levels;
}

/**
 * The interaction states some rule matching this element actually declares.
 *
 * Offering all six unconditionally would be offering five dead toggles on most
 * elements; a state is only worth entering if there is something to see.
 */
export function availableStates(node: Element): PseudoState[] {
  /*
   * Scoped to rules that would actually apply to *this* node.
   *
   * It asked `allSelectors(node)` — which is every style rule in the document, not
   * the ones matching the node — and then tested `selector.includes(state)`. So the
   * element was never consulted at all, and on any Tailwind page (where some
   * `hover:` utility exists somewhere) every element, including a bare layout
   * `<div>`, offered all six states. Each one previewed nothing, which is precisely
   * the "five dead toggles" this function's own docstring says it exists to prevent.
   *
   * `stateRules` already does the matching work for `pseudoDecls`; reusing it is what
   * makes the picker and the preview agree by construction.
   */
  return PSEUDO_STATES.filter((state) =>
    stateRules(node, state).some(({ selector }) => {
      const base = stripStates(selector).trim();
      if (!base) {
        return false;
      }
      try {
        return node.matches(base);
      } catch {
        return false;
      }
    })
  );
}

/**
 * The declarations that apply to this element in a given state, merged in
 * cascade order so the winner is last-written.
 *
 * `matchedRules` cannot help here: the browser does not match `:hover` unless
 * the pointer is actually over the element, so these rules are invisible to it.
 * Instead the state is *stripped* from each selector and the remainder tested —
 * `.btn:hover` becomes `.btn`, and if the node matches that, the hover block is
 * one that would apply.
 */
export function pseudoDecls(
  node: Element,
  state: PseudoState
): Map<string, string> {
  const out = new Map<string, string>();
  const doc = node.ownerDocument;
  if (!doc) {
    return out;
  }

  const collected: { decls: Map<string, string>; weight: number }[] = [];
  for (const { rule, selector } of stateRules(node, state)) {
    const base = stripStates(selector).trim();
    if (!base) {
      continue;
    }
    let matches = false;
    try {
      matches = node.matches(base);
    } catch {
      continue;
    }
    if (!matches) {
      continue;
    }
    const decls = new Map<string, string>();
    // `propertyNames`, not `Array.from`: the iterator on `CSSStyleDeclaration` is a
    // late spec addition that not every implementation has, and where it is missing
    // this silently read *zero* declarations — so every state previewed nothing.
    for (const property of propertyNames(rule.style)) {
      decls.set(property, rule.style.getPropertyValue(property).trim());
    }
    collected.push({ decls, weight: weigh(selector) });
  }

  // Weakest first, so stronger rules overwrite — the cascade, approximately.
  collected.sort((a, b) => a.weight - b.weight);
  for (const { decls } of collected) {
    for (const [property, value] of decls) {
      out.set(property, value);
    }
  }
  return expandShorthands(out);
}

// ---------------------------------------------------------------------------
// Stylesheet traversal for state rules
// ---------------------------------------------------------------------------

interface StateRule {
  rule: CSSStyleRule;
  selector: string;
}

function stateRules(node: Element, state: PseudoState): StateRule[] {
  const out: StateRule[] = [];
  for (const selector of allSelectors(node)) {
    for (const part of splitSelectorList(selector.rule.selectorText)) {
      if (mentionsState(part, state)) {
        out.push({ rule: selector.rule, selector: part });
      }
    }
  }
  return out;
}

/**
 * Every style rule in the node's document.
 *
 * **Uncached, deliberately.** It was cached per document and invalidated by
 * `styleSheets.length`, which does not detect the two things that actually change
 * a stylesheet in this editor's lifetime:
 *
 * - An in-place `insertRule`/`deleteRule`, which every CSS-in-JS runtime does.
 * - Vite's HMR, which replaces a `<style>` element's `textContent` — or swaps the
 *   element for a new one with the same rule count. Either way the count is
 *   unchanged, so the cache went on serving the pre-edit rules for the lifetime
 *   of the document: a newly added `:hover` rule never appeared in the State
 *   picker, and a deleted one kept being previewed.
 *
 * That is not a stale *preview*, which is how the old comment justified it — it
 * is the panel describing rules the page no longer has, and shipping them to the
 * agent. A signature cheap enough to be worth computing (counts, owner nodes)
 * misses the `textContent` case, so the cache is gone rather than made subtler.
 *
 * The cost is one walk per call, which is the same order as `matchedRules`' own
 * uncached scan. Sharing a single scan across the three consumers that need one
 * per render is a separate change (see the audit's finding on the triple walk).
 */
function allSelectors(node: Element): { rule: CSSStyleRule }[] {
  const doc = node.ownerDocument;
  const win = ownerWindow(node);
  if (!(doc && win)) {
    return [];
  }
  const rules: { rule: CSSStyleRule }[] = [];
  const adopted = (doc as { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  for (const sheet of [...Array.from(doc.styleSheets), ...(adopted ?? [])]) {
    let list: CSSRuleList;
    try {
      const own = sheet.cssRules;
      if (!own) {
        continue;
      }
      list = own;
    } catch {
      continue;
    }
    collectStyleRules(list, rules, node, win, "");
  }
  return rules;
}

function collectStyleRules(
  list: CSSRuleList,
  out: { rule: CSSStyleRule }[],
  node: Element,
  win: Window,
  parent: string
): void {
  for (const rule of Array.from(list)) {
    const asStyle = rule as Partial<CSSStyleRule>;
    if (typeof asStyle.selectorText === "string" && asStyle.style) {
      const selector = resolveNested(asStyle.selectorText, parent);
      /*
       * Pushed with its *resolved* selector, and then recursed into.
       *
       * It used to `continue` here, so a `CSSStyleRule` with nested children — which
       * is what `.card { &:hover { … } }` produces — had its children skipped
       * entirely. `pseudoDecls` therefore returned nothing for a nested `:hover`, and
       * the State picker never saw it. Modern authored CSS, Tailwind 4 and Lightning
       * CSS all emit nesting, so this was most of them.
       */
      out.push({ rule: withSelector(rule as CSSStyleRule, selector) });
      const nested = asStyle.cssRules;
      if (nested?.length) {
        collectStyleRules(nested, out, node, win, selector);
      }
      continue;
    }
    const group = rule as Partial<CSSGroupingRule>;
    if (group.cssRules) {
      /*
       * `@media` and `@container` are now *evaluated*, not walked blindly.
       *
       * The header of this module claims state handling inherits `matchedRules`'
       * realm-awareness "for free" because both are built on one scan. That was not
       * true of this path — it recursed into every grouping rule unconditionally — so
       * in a 375px frame, entering `:hover` previewed the
       * `@media (min-width: 1024px)` hover rule and shipped it as the mobile hover
       * style. `conditionHolds` is the same test `matchedRules` uses, asked of the
       * node's own window, which is what makes the claim true.
       */
      if (!conditionHolds(rule as CSSGroupingRule, win, node)) {
        continue;
      }
      collectStyleRules(group.cssRules, out, node, win, parent);
      continue;
    }
    const imported = asImportRule(rule);
    if (imported) {
      try {
        if (imported.cssRules) {
          collectStyleRules(imported.cssRules, out, node, win, parent);
        }
      } catch {
        // Cross-origin.
      }
    }
  }
}

/**
 * The same rule, reporting a resolved selector.
 *
 * A nested rule's own `selectorText` is relative (`&:hover`), and every consumer here
 * wants the absolute form. The declarations are shared by reference — this is a view,
 * not a copy — because `pseudoDecls` reads them straight off it.
 */
function withSelector(rule: CSSStyleRule, selector: string): CSSStyleRule {
  if (selector === rule.selectorText) {
    return rule;
  }
  return {
    ...rule,
    selectorText: selector,
    style: rule.style,
  } as CSSStyleRule;
}

/**
 * Cascade weight for ordering the state rules against each other.
 *
 * `specificity` from `css-rules`, not a second implementation. This was a local
 * `weigh()` counting `/\.[\w-]+|\[[^\]]*\]|:[\w-]+/` and `#` — no `:where()`
 * stripping, no pseudo-element handling, no attribute-value stripping, all of which
 * its neighbour already got right and documented. Two implementations of one rule
 * drift, and the crude one was deciding which `:hover` declaration wins.
 *
 * Flattened to a single number because these only ever need a total order.
 */
function weigh(selector: string): number {
  const [ids, classes, elements] = specificity(selector);
  return ids * 10_000 + classes * 100 + elements;
}

/**
 * Every state, longest spelling first.
 *
 * Regex alternation is leftmost-first, and `PSEUDO_STATES` is declared
 * `:hover, :focus, :focus-visible, …` — so `:focus` always matched before
 * `:focus-visible` could be tried, and `stripStates(".btn:focus-visible")` returned
 * `".btn-visible"`. Nothing matches that, so every `:focus-visible` and
 * `:focus-within` rule was discarded: the State picker offered the state, entering it
 * injected nothing, and the panel showed resting values under a `:focus-visible`
 * label. Tailwind's default button ring is exactly this case.
 *
 * The same longest-first trick `num-field.ts` already applies to unit prefixes.
 */
const STATE_RE = new RegExp(
  [...PSEUDO_STATES]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g"
);

/**
 * Does this selector name exactly this state?
 *
 * `selector.includes(":focus")` is true of `:focus-visible` too, so one
 * `:focus-visible` rule anywhere made `:focus` "available" on every element. The
 * trailing character has to be something that cannot continue an identifier.
 */
function mentionsState(selector: string, state: PseudoState): boolean {
  let at = selector.indexOf(state);
  while (at !== -1) {
    const after = selector[at + state.length];
    if (!(after && IDENT_CHAR.test(after))) {
      return true;
    }
    at = selector.indexOf(state, at + 1);
  }
  return false;
}

/** `.btn:hover span` → `.btn span`. */
export function stripStates(selector: string): string {
  return selector.replace(STATE_RE, "");
}

// ---------------------------------------------------------------------------
// Shorthand expansion
// ---------------------------------------------------------------------------

const BOX_SHORTHANDS: Record<string, [string, string, string, string]> = {
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ],
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ],
  inset: ["top", "right", "bottom", "left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "margin-block": ["margin-top", "", "margin-bottom", ""],
  "margin-inline": ["", "margin-right", "", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "padding-block": ["padding-top", "", "padding-bottom", ""],
  "padding-inline": ["", "padding-right", "", "padding-left"],
};

/**
 * Shorthands that set one value on all four sides at once.
 *
 * `border: 2px solid #000` is the common spelling and was not expanded at all, so a
 * `.btn:hover { border: … }` rule previewed *nothing*: `pseudoDecls` reported the key
 * `border`, and every control in the panel is a longhand. `border-top` and friends
 * have the same shape one side at a time.
 */
const BORDER_SHORTHANDS: Record<string, string[]> = {
  border: ["top", "right", "bottom", "left"],
  "border-block": ["top", "bottom"],
  "border-bottom": ["bottom"],
  "border-inline": ["left", "right"],
  "border-left": ["left"],
  "border-right": ["right"],
  "border-top": ["top"],
};

/** A `<line-width> || <line-style> || <color>`, in any order. */
const LINE_STYLES = new Set([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

/**
 * Split a `border`-style value into its width, style and colour parts.
 *
 * The three are order-independent and all optional, so each word is classified
 * rather than positioned: a line-style keyword is the style, something that parses as
 * a length (or a width keyword) is the width, and whatever is left is the colour.
 */
function splitBorder(value: string): {
  color?: string;
  style?: string;
  width?: string;
} {
  const out: { color?: string; style?: string; width?: string } = {};
  for (const word of splitWords(value.trim())) {
    const lower = word.toLowerCase();
    if (LINE_STYLES.has(lower)) {
      out.style = lower;
    } else if (WIDTH_KEYWORD.has(lower) || LOOKS_LIKE_LENGTH.test(word)) {
      out.width = word;
    } else {
      out.color = word;
    }
  }
  return out;
}

const WIDTH_KEYWORD = new Set(["thin", "medium", "thick"]);
const LOOKS_LIKE_LENGTH = /^[+-]?(?:\d|\.\d)|^calc\(|^var\(/;

/**
 * Corner order for `border-radius` is **TL, TR, BR, BL** — clockwise from the
 * top left, not the T/R/B/L of the box shorthands. Getting this wrong swaps two
 * corners on any element with asymmetric rounding, which is exactly the kind of
 * bug that looks like a rendering glitch rather than a parser error.
 */
const RADIUS_CORNERS: [string, string, string, string] = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
];

/**
 * Fan a shorthand out to its longhands.
 *
 * The CSSOM only enumerates the shorthand when the author wrote one, so a rule
 * saying `padding: 10px 20px` reports the property `padding` and *not*
 * `padding-top`. The inspector's controls are all longhand, so without this a
 * hover rule written as a shorthand previews nothing at all.
 *
 * Longhands already present win: an author who wrote both meant the specific one.
 */
export function expandShorthands(
  decls: Map<string, string>
): Map<string, string> {
  const out = new Map(decls);

  for (const [shorthand, sides] of Object.entries(BOX_SHORTHANDS)) {
    const value = decls.get(shorthand);
    if (value === undefined) {
      continue;
    }
    assign(out, sides, splitBox(value), decls);
    out.delete(shorthand);
  }

  const radius = decls.get("border-radius");
  if (radius !== undefined) {
    // Only the horizontal radii; `10px / 20px` is an ellipse and the second half
    // has no longhand of its own to land in.
    const [horizontal] = radius.split("/");
    assign(out, RADIUS_CORNERS, splitBox(horizontal), decls);
    out.delete("border-radius");
  }

  for (const [shorthand, sides] of Object.entries(BORDER_SHORTHANDS)) {
    const value = decls.get(shorthand);
    if (value === undefined) {
      continue;
    }
    const parts = splitBorder(value);
    for (const side of sides) {
      for (const [suffix, part] of [
        ["width", parts.width],
        ["style", parts.style],
        ["color", parts.color],
      ] as const) {
        const longhand = `border-${side}-${suffix}`;
        if (part !== undefined && !decls.has(longhand)) {
          out.set(longhand, part);
        }
      }
    }
    out.delete(shorthand);
  }

  const gap = decls.get("gap");
  if (gap !== undefined) {
    const parts = gap.trim().split(WHITESPACE);
    assign(
      out,
      ["row-gap", "column-gap", "", ""],
      [parts[0], parts[1] ?? parts[0], "", ""],
      decls
    );
    out.delete("gap");
  }

  return out;
}

function assign(
  out: Map<string, string>,
  properties: readonly string[],
  values: readonly string[],
  original: Map<string, string>
): void {
  properties.forEach((property, i) => {
    if (property && !original.has(property)) {
      out.set(property, values[i]);
    }
  });
}

/**
 * CSS's 1/2/3/4-value box rule.
 *
 * `splitWords`, not `.split(/\s+/)`: a shorthand can hold functions, and those hold
 * spaces. `padding: calc(1rem + 2px) 8px` split into four "values" —
 * `["calc(1rem", "+", "2px)", "8px"]` — and every one of them was written to the live
 * DOM as an `!important` inline preview and seeded into a number field.
 */
function splitBox(value: string): [string, string, string, string] {
  const p = splitWords(value.trim()).filter(Boolean);
  if (p.length === 0) {
    return ["", "", "", ""];
  }
  if (p.length === 1) {
    return [p[0], p[0], p[0], p[0]];
  }
  if (p.length === 2) {
    return [p[0], p[1], p[0], p[1]];
  }
  if (p.length === 3) {
    return [p[0], p[1], p[2], p[1]];
  }
  return [p[0], p[1], p[2], p[3]];
}
