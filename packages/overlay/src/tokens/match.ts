/**
 * Matching values to tokens — the two questions the inspector asks.
 *
 * 1. *Which token currently provides this value?* → `resolveTokens`, driving the
 *    linked state of the badge on each control.
 * 2. *Which token should this new value become?* → `findToken`, which is what
 *    turns "padding-top: 16px" into "padding-top: --pk-space-md" on the way to
 *    the agent.
 */
import type { TokenRef } from "@airship/protocol";
import {
  categoryForProperty,
  type DesignToken,
  normalizeTokenValue,
} from "@airship/protocol/tokens";
import { toPx } from "../inspector/css-length";
import { type MatchedResult, matchedRules } from "../inspector/css-rules";
import { computedStyle } from "../realm";
import { tokens, tokenValue } from "./registry";

/*
 * `toPx` used to live here, and was the only correct length parser in the
 * codebase — unit-aware, realm-aware — reachable from nothing but this file
 * while three weaker ones served the inspector. It lives in
 * `inspector/css-length.ts` now, with the rest of the grammar.
 */

/** Absolute tolerance for a near miss, and the relative one past ~20px. */
/** Does the authored value carry a unit at all? */
const LENGTH_UNIT = /[a-z%]$/i;

const NEAR_ABSOLUTE_PX = 2;
const NEAR_RELATIVE = 0.1;

/** Are two CSS values the same, allowing for units and formatting? */
function sameValue(a: string, b: string, node?: Element): boolean {
  if (normalizeTokenValue(a) === normalizeTokenValue(b)) {
    return true;
  }
  const pa = toPx(a, node);
  const pb = toPx(b, node);
  return pa !== null && pb !== null && Math.abs(pa - pb) < 0.5;
}

/** Is any token available for this property at all? Gates the badge. */
export function hasTokensFor(property: string): boolean {
  const category = categoryForProperty(property);
  return category ? tokens().byCategory[category].length > 0 : false;
}

/** Every token that could apply to this property, for the picker. */
export function tokensFor(property: string): DesignToken[] {
  const category = categoryForProperty(property);
  return category ? tokens().byCategory[category] : [];
}

/**
 * Is this token's custom property in scope on this element?
 *
 * Custom properties inherit, so a non-empty computed value is exactly the
 * condition under which `var(--x)` will resolve *here*. A utility class has no
 * custom property to look up and is always reported in scope.
 *
 * Used to **order and annotate** the picker, never to filter it. A token can be
 * genuinely part of the design system and still be out of scope on the selected
 * element — declared under `.dark`, inside a media query that is not matching,
 * or on a component root the selection is not inside — and hiding those would
 * quietly remove real tokens. Applying one still works: `tokenPreviewValue`
 * carries the token's own value as the `var()` fallback, so the preview paints
 * and the agent still receives the name.
 */
export function tokenInScope(token: DesignToken, node?: Element): boolean {
  if (token.kind !== "css-var" || !node) {
    return true;
  }
  return computedStyle(node).getPropertyValue(token.name).trim() !== "";
}

/**
 * The picker's list: every applicable token, those that resolve here first.
 *
 * A stable partition rather than a sort, so the registry's own ordering — a
 * numeric scale sorted by value, everything else by name — survives inside each
 * group.
 */
export function tokensForPicker(
  property: string,
  node?: Element
): { inScope: boolean; token: DesignToken }[] {
  const all = tokensFor(property).map((token) => ({
    inScope: tokenInScope(token, node),
    token,
  }));
  return [...all.filter((t) => t.inScope), ...all.filter((t) => !t.inScope)];
}

/**
 * The token whose value equals `value` exactly, or the nearest one within
 * tolerance.
 *
 * The tolerance exists because a designer dragging a slider lands on 13px, and
 * the honest answer is "your scale has 12px — did you mean that?" rather than
 * either silently snapping or silently emitting a magic number. `exact` on the
 * result is what lets the prompt phrase it as a suggestion instead of a fact.
 */
export function findToken(
  property: string,
  value: string,
  node?: Element
): TokenRef | undefined {
  const registry = tokens();
  const exact = registry.byValue[`${property}:${normalizeTokenValue(value)}`];
  if (exact?.length) {
    return toRef(exact[0], property, true);
  }

  const category = categoryForProperty(property);
  if (!category) {
    return;
  }
  // Colours and shadows have no meaningful "near" — a slightly different hex is
  // a different colour, not an approximation of one.
  if (category === "colors" || category === "box-shadow") {
    return findByUnitAwareEquality(property, value, node);
  }

  const target = toPx(value, node);
  if (target === null) {
    return findByUnitAwareEquality(property, value, node);
  }

  let best: DesignToken | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of registry.byCategory[category]) {
    const candidate = toPx(tokenValue(token, property), node);
    if (candidate === null) {
      continue;
    }
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = token;
      bestDistance = distance;
    }
  }
  if (!best) {
    return;
  }
  if (bestDistance < 0.5) {
    return toRef(best, property, true);
  }
  /*
   * The absolute floor is in *pixels*, so it only applies to a pixel scale.
   *
   * `opacity` and `line-height` are token categories whose values are unitless, and
   * `toPx` returns them as bare numbers — so a 2 "pixel" floor swallowed the entire
   * 0–1 range. `opacity: 0.85` was within tolerance of an `--opacity-0` token, and the
   * prompt then read "[nearest token: --opacity-0 = 0 — prefer it unless the exact value
   * was deliberate]", inviting the agent to make the element invisible.
   *
   * A unitless scale gets the relative tolerance alone, which is scale-free and is the
   * part of this that was always meaningful.
   */
  const unitless = !LENGTH_UNIT.test(value.trim());
  const tolerance = unitless
    ? Math.abs(target) * NEAR_RELATIVE
    : Math.max(NEAR_ABSOLUTE_PX, Math.abs(target) * NEAR_RELATIVE);
  return bestDistance <= tolerance ? toRef(best, property, false) : undefined;
}

/** An exact match that only differs by unit (`1rem` vs `16px`). */
function findByUnitAwareEquality(
  property: string,
  value: string,
  node?: Element
): TokenRef | undefined {
  for (const token of tokensFor(property)) {
    if (sameValue(tokenValue(token, property), value, node)) {
      return toRef(token, property, true);
    }
  }
}

export function toRef(
  token: DesignToken,
  property: string,
  exact: boolean,
  via: TokenRef["via"] = "value"
): TokenRef {
  return {
    actual: exact ? undefined : tokenValue(token, property),
    exact,
    file: token.file,
    kind: token.kind,
    name: token.name,
    via,
  };
}

/**
 * Which token provides each of an element's current values.
 *
 * Four passes, weakest first so the stronger overwrites:
 *
 * 1. **By value** — the computed value equals a token's. Cheap and catches most
 *    of it, but it is circumstantial: a hardcoded `16px` looks identical to
 *    `var(--pk-space-md)` once the browser has resolved it.
 * 2. **By class** — the element carries a utility class that *is* a token.
 * 3. **By stylesheet `var()`** — the rule that wins for this property names a
 *    token. Direct evidence, and the normal case in a real design system: the
 *    `var()` is in the stylesheet, not on the element. Without this pass such a
 *    value was reported as a coincidence, so its badge read "Matches" rather
 *    than "Using" and offered no way to detach.
 * 4. **By inline `var()`** — written into the element's own style attribute,
 *    which is what the panel does when a token is applied. Strongest, because
 *    nothing else can have put it there.
 *
 * Call it **once per render with every property at a time**, not once per
 * control: pass 3 walks the document's stylesheets, which is the expensive
 * thing in the panel.
 */
export function resolveTokens(
  node: Element,
  properties: readonly string[]
): Map<string, TokenRef> {
  const out = new Map<string, TokenRef>();
  matchByValue(node, properties, out);
  matchByClass(node, properties, out);
  matchByRuleVar(node, properties, out);
  matchByInlineVar(node, properties, out);
  return out;
}

/** Pass 1 — the computed value equals a token's. Circumstantial but common. */
function matchByValue(
  node: Element,
  properties: readonly string[],
  out: Map<string, TokenRef>
): void {
  const computed = computedStyle(node);
  const registry = tokens();
  for (const property of properties) {
    const value = computed.getPropertyValue(property).trim();
    if (!value) {
      continue;
    }
    const byValue =
      registry.byValue[`${property}:${normalizeTokenValue(value)}`];
    if (byValue?.length) {
      out.set(property, toRef(byValue[0], property, true));
      continue;
    }
    const near = findByUnitAwareEquality(property, value, node);
    if (near) {
      out.set(property, near);
    }
  }
}

/** Pass 2 — a utility class the element actually carries. Proof, not inference. */
function matchByClass(
  node: Element,
  properties: readonly string[],
  out: Map<string, TokenRef>
): void {
  const registry = tokens();
  for (const className of Array.from(node.classList)) {
    const token = registry.byName[`.${className}`];
    if (!token) {
      continue;
    }
    for (const property of Object.keys(token.values)) {
      if (properties.includes(property)) {
        out.set(property, toRef(token, property, true, "reference"));
      }
    }
  }
}

/**
 * Pass 3 — a `var()` in the stylesheet rule that wins for this property.
 *
 * `getComputedStyle` has already resolved it, so the only way to see it is to
 * read the *declared* values back out of the cascade. `matchedRules` does that
 * and marks the losers `overridden`, so the winner is the first non-overridden
 * declaration for the property in its strongest-first list.
 *
 * The scan is time-budgeted and can stop early on an unpurged Tailwind build.
 * A truncated result is treated as "no evidence" and never as proof of absence:
 * the worst case is the badge falling back to pass 1's weaker answer, which is
 * exactly where it was before this pass existed.
 */
function matchByRuleVar(
  node: Element,
  properties: readonly string[],
  out: Map<string, TokenRef>
): void {
  if (properties.length === 0) {
    return;
  }
  const matched = matchedRules(node);
  if (matched.truncated) {
    /*
     * A truncated scan is not evidence of absence.
     *
     * This pass upgrades a badge from "Matches" (a value coincidence) to "Using" (a real
     * reference), and only a real reference offers Detach. Reading a partial scan as "no
     * `var()` names this token" made that upgrade flicker between renders on a large
     * stylesheet — the same element gaining and losing its Detach affordance for no
     * reason the user could see. Pass 1's weaker answer stands instead, which is exactly
     * where this was before the pass existed.
     */
    return;
  }
  const registry = tokens();
  for (const property of properties) {
    const declared = winningDeclaration(matched, property);
    const named = declared ? VAR_NAME.exec(declared) : null;
    const token = named ? registry.byName[named[1]] : null;
    if (token) {
      out.set(property, toRef(token, property, true, "reference"));
    }
  }
}

/** The declared value the cascade settles on for one property, if any. */
function winningDeclaration(
  matched: MatchedResult,
  property: string
): string | null {
  for (const rule of matched.rules) {
    for (const decl of rule.decls) {
      if (decl.property === property && !decl.overridden) {
        return decl.value;
      }
    }
  }
  return null;
}

/** Pass 4 — a `var()` written in the element's own style attribute. */
function matchByInlineVar(
  node: Element,
  properties: readonly string[],
  out: Map<string, TokenRef>
): void {
  const inline = (node as HTMLElement).style;
  if (!inline) {
    return;
  }
  const registry = tokens();
  for (const property of properties) {
    const raw = inline.getPropertyValue(property);
    const named = raw ? VAR_NAME.exec(raw) : null;
    const token = named ? registry.byName[named[1]] : null;
    if (token) {
      out.set(property, toRef(token, property, true, "reference"));
    }
  }
}

const VAR_NAME = /var\(\s*(--[\w-]+)/;
