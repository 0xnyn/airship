/**
 * Which stylesheet rules actually apply to a node, and which of their
 * declarations win.
 *
 * This is the one thing the CSS pane could not answer before: the computed list
 * says `padding-left: 16px` but not that `.px-4` said so, in `app.css`, and
 * that a `button` rule's `padding` lost to it. In a utility-class codebase that
 * provenance *is* the answer to "why does it look like this".
 *
 * Everything here goes through the node's own realm. A frame on the canvas is a
 * separate document with its own sheets and — crucially — its own viewport, so
 * a media query has to be asked of *that* window or a 375px frame inherits the
 * shell's 1440px answers.
 */
import { PREFIX } from "../dom";
import { computedStyle, ownerDocument, ownerWindow } from "../realm";

export interface MatchedDecl {
  important: boolean;
  /** A higher-priority rule declares the same property. */
  overridden: boolean;
  property: string;
  value: string;
}

export interface MatchedRule {
  /** Enclosing `@media` / `@supports` / `@layer` text, outermost first. */
  conditions: string[];
  decls: MatchedDecl[];
  href: string | null;
  /**
   * Cascade layer index, by order of first appearance, or null outside any layer.
   * See `compareLayers` — precedence inverts for `!important`.
   */
  layer: number | null;
  /** The one compound selector in the group that matched this node. */
  matchedSelector: string;
  /** Document order, the cascade's final tie-break. */
  order: number;
  /** Display name for the sheet: a basename, or `<style>`. */
  origin: string;
  selector: string;
  specificity: Specificity;
}

export interface MatchedResult {
  /** Rules examined before stopping. */
  examined: number;
  rules: MatchedRule[];
  scanMs: number;
  /** Scanning stopped early against the time budget. */
  truncated: boolean;
}

type Specificity = readonly [number, number, number];

/** Rules checked between clock reads. Cheap enough to not matter, coarse
 * enough that the check itself is not the cost. */
const BUDGET_STRIDE = 500;
const DEFAULT_BUDGET_MS = 24;

/**
 * One scan per node, shared for the length of a render pass.
 *
 * `matchedRules` is uncached and time-budgeted, and a single `renderBody` asked for it
 * up to four times for the same element: `resolveTokens`' `matchByRuleVar`,
 * `scopeLevels`, `declaredValue` (for every length control), and the CSS pane. Each walk
 * is bounded at 24ms, so the worst case was ~100ms of stylesheet traversal per render —
 * and worse, they could *disagree*: the budget truncates at a different rule each time,
 * so one caller saw a class that another did not.
 *
 * Deliberately a render-scoped memo rather than a persistent cache. `cascade.ts`'s
 * document-keyed cache was removed precisely because nothing can cheaply detect a
 * stylesheet changing under it; this holds a result only between `beginScanPass` and
 * `endScanPass`, which the panel brackets one render with. Outside a pass every call
 * scans, exactly as before.
 */
let scanPass: Map<Element, MatchedResult> | null = null;

/** Begin sharing scans. Idempotent, and nestable via the returned disposer. */
export function beginScanPass(): () => void {
  if (scanPass) {
    return () => undefined;
  }
  scanPass = new Map();
  return () => {
    scanPass = null;
  };
}

/**
 * Every rule in the node's document that matches it, strongest first.
 *
 * Called lazily — the pane's Matched-rules section scans on first expand — so
 * an unpurged Tailwind build's six-figure rule count is only ever paid for by
 * someone who asked to see it, and even then it is bounded by `budgetMs`.
 */
export function matchedRules(
  node: Element,
  opts: { budgetMs?: number } = {}
): MatchedResult {
  // Inside a render pass, one scan per element serves every consumer. A caller that
  // asks for a specific budget wants its own scan and opts out.
  const shared = opts.budgetMs === undefined ? scanPass?.get(node) : undefined;
  if (shared) {
    return shared;
  }
  const started = now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const doc = ownerDocument(node);
  const win = ownerWindow(node);
  const rules: MatchedRule[] = [];
  const state = { examined: 0, order: 0, truncated: false };
  // Shared across every sheet: layer order is a property of the document.
  const layers = new Map<string, number>();

  if (!(doc && win)) {
    return { examined: 0, rules, scanMs: 0, truncated: false };
  }

  /*
   * `adoptedStyleSheets` as well as `styleSheets`.
   *
   * They are a separate collection — `doc.styleSheets` does not include them — and
   * they are how constructable stylesheets arrive: Lit and several CSS-in-JS
   * runtimes put everything there, in which case the pane reported no matching rules
   * for any element on the page.
   */
  const adopted = (doc as { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  const sheets = [...Array.from(doc.styleSheets), ...(adopted ?? [])];
  for (const sheet of sheets) {
    if (state.truncated) {
      break;
    }
    if (isOwnSheet(sheet)) {
      continue;
    }
    let top: CSSRuleList;
    try {
      // A cross-origin sheet throws SecurityError on access — not something to
      // report, just a sheet we are not allowed to read.
      const list = sheet.cssRules;
      if (!list) {
        continue;
      }
      top = list;
    } catch {
      continue;
    }
    walk(
      top,
      { conditions: [], layer: null, layers, parent: "" },
      { budgetMs, node, out: rules, started, state, win }
    );
  }

  markOverridden(rules);
  const result: MatchedResult = {
    examined: state.examined,
    rules,
    scanMs: Math.round(now() - started),
    truncated: state.truncated,
  };
  if (opts.budgetMs === undefined) {
    scanPass?.set(node, result);
  }
  return result;
}

/** Our own injected stylesheet is editor chrome, never page provenance. */
export function isOwnSheet(sheet: CSSStyleSheet): boolean {
  const ownerId = (sheet.ownerNode as Element | null)?.id;
  if (ownerId === `${PREFIX}-styles`) {
    return true;
  }
  return Boolean(sheet.href?.includes("/__airship/"));
}

/**
 * What the walker inherits from the rules enclosing the one it is looking at.
 *
 * `layers` is shared by reference across the whole scan on purpose: layer order is a
 * property of the document, not of one nesting branch, so the index assigned to
 * `utilities` in one sheet has to be the same index everywhere.
 */
interface WalkContext {
  /** `@media`/`@supports`/`@layer` labels, outermost first, for display. */
  conditions: string[];
  /** The enclosing layer's index, or null outside any layer. */
  layer: number | null;
  /** Layer name → order of first appearance. Shared across the scan. */
  layers: Map<string, number>;
  /** The enclosing style rule's resolved selector, for CSS nesting. */
  parent: string;
}

/** Everything the recursive walk carries that is not per-rule. */
interface WalkScope {
  budgetMs: number;
  node: Element;
  out: MatchedRule[];
  started: number;
  state: { examined: number; order: number; truncated: boolean };
  win: Window;
}

function walk(list: CSSRuleList, ctx: WalkContext, scope: WalkScope): void {
  for (const rule of Array.from(list)) {
    if (overBudget(scope)) {
      return;
    }
    // Duck-typed throughout, deliberately. `instanceof CSSStyleRule` is false for
    // every rule in a frame's realm, and `constructor.name` does not survive
    // minification of the host page's own bundled CSSOM shims.
    if (visitGroup(rule, ctx, scope)) {
      continue;
    }
    if (visitImport(rule, ctx, scope)) {
      continue;
    }
    visitStyleRule(rule, ctx, scope);
  }
}

/** Tick the rule counter, and report whether the scan has run out of time. */
function overBudget(scope: WalkScope): boolean {
  const { state } = scope;
  if (state.truncated) {
    return true;
  }
  state.examined += 1;
  if (
    state.examined % BUDGET_STRIDE === 0 &&
    now() - scope.started > scope.budgetMs
  ) {
    state.truncated = true;
    return true;
  }
  return false;
}

/** `@media` / `@supports` / `@layer` / `@container`. True when handled. */
function visitGroup(
  rule: CSSRule,
  ctx: WalkContext,
  scope: WalkScope
): boolean {
  const group = asGroupingRule(rule);
  if (!group) {
    return false;
  }
  if (!conditionHolds(group, scope.win, scope.node)) {
    return true;
  }
  const label = conditionLabel(group);
  walk(
    group.cssRules,
    {
      ...ctx,
      conditions: [...ctx.conditions, label].filter(Boolean),
      layer: layerOf(ctx, label),
    },
    scope
  );
  return true;
}

/**
 * `@import`, whose rules hang off `styleSheet` rather than `cssRules`.
 *
 * Neither a group nor a style rule, so it used to be skipped without a trace — and a
 * project whose `index.css` is one `@import` line reported "no stylesheet rules
 * match" for every element on the page.
 */
function visitImport(
  rule: CSSRule,
  ctx: WalkContext,
  scope: WalkScope
): boolean {
  const imported = asImportRule(rule);
  if (!imported) {
    return false;
  }
  let nested: CSSRuleList | null = null;
  try {
    nested = imported.cssRules;
  } catch {
    // Cross-origin. Not ours to read, and not worth reporting.
  }
  if (nested) {
    walk(nested, ctx, scope);
  }
  return true;
}

function visitStyleRule(
  rule: CSSRule,
  ctx: WalkContext,
  scope: WalkScope
): void {
  const style = asStyleRule(rule);
  if (!style) {
    return;
  }
  // Nesting: `&:hover` inside `.card` is `.card:hover`, and a bare `.title` is
  // `.card .title`. Resolved before matching, and passed down as this rule's own
  // children's parent.
  const selector = resolveNested(style.selectorText, ctx.parent);
  const { order } = scope.state;
  scope.state.order += 1;
  const matched = matchCompound(selector, scope.node);
  const decls = readDecls(style.style);
  if (matched && decls.length > 0) {
    scope.out.push({
      conditions: ctx.conditions,
      decls,
      href: hrefOf(style),
      layer: ctx.layer,
      matchedSelector: matched,
      order,
      origin: originOf(style),
      selector,
      specificity: specificity(matched),
    });
  }
  /*
   * Recurse whether or not this rule matched.
   *
   * A nested rule can match where its parent does not — `.card { & + & { … } }`
   * applies to the second card and not the first — so skipping the children of a
   * non-matching parent would drop real declarations.
   */
  const children = (rule as Partial<CSSGroupingRule>).cssRules;
  if (children?.length) {
    walk(children, { ...ctx, parent: selector }, scope);
  }
}

/**
 * Which cascade layer a group puts its children in.
 *
 * Layers are ordered by where they are *first named*, so the index is assigned on
 * first sight and remembered. An unlayered rule keeps `null`, which
 * `byDeclarationCascade` treats as the strongest for normal declarations and the
 * weakest for important ones — the inversion the spec requires.
 */
function layerOf(ctx: WalkContext, label: string): number | null {
  if (!label.startsWith("@layer ")) {
    return ctx.layer;
  }
  const name = label.slice("@layer ".length);
  const existing = ctx.layers.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const index = ctx.layers.size;
  ctx.layers.set(name, index);
  return index;
}

/**
 * A style rule has both a selector and a declaration block.
 *
 * `@keyframes` steps also carry a `style`, but key off `keyText` rather than
 * `selectorText` — so requiring `selectorText` excludes them without needing to
 * name the type.
 */
export function asStyleRule(rule: CSSRule): CSSStyleRule | null {
  const candidate = rule as Partial<CSSStyleRule>;
  return typeof candidate.selectorText === "string" && candidate.style
    ? (rule as CSSStyleRule)
    : null;
}

/**
 * `@media`, `@supports`, `@layer`, `@container` — a conditional or named group.
 *
 * The `!("selectorText" in rule)` test is what makes this *only* the at-rules, and
 * it is load-bearing in the other direction too: since CSS nesting shipped, a
 * `CSSStyleRule` is itself a `CSSGroupingRule` and carries both `selectorText` and
 * `cssRules`. A nested rule is therefore not one of these — `walk` handles it as a
 * style rule that also has children, which is what it is. Before that, nesting fell
 * down the gap between the two tests and its children were never visited at all.
 */
export function asGroupingRule(rule: CSSRule): CSSGroupingRule | null {
  const candidate = rule as Partial<CSSGroupingRule>;
  return candidate.cssRules && !("selectorText" in rule)
    ? (rule as CSSGroupingRule)
    : null;
}

/** An `@import`, whose rules hang off `styleSheet` rather than `cssRules`. */
export function asImportRule(rule: CSSRule): CSSStyleSheet | null {
  const sheet = (rule as Partial<CSSImportRule>).styleSheet;
  return sheet ?? null;
}

/**
 * A nested selector resolved against the rule that encloses it.
 *
 * CSS nesting's two cases: a part containing `&` substitutes the parent there, and
 * a part without one is a *descendant* of it (`.title` inside `.card` means
 * `.card .title`). The parent goes in as `:is(…)` when it is a list, both because
 * that is what the spec says and because splicing `a, b` into the middle of another
 * selector would produce something that no longer parses.
 */
export function resolveNested(selector: string, parent: string): string {
  if (!parent) {
    return selector;
  }
  const enclosing =
    splitSelectorList(parent).length > 1 ? `:is(${parent})` : parent;
  return splitSelectorList(selector)
    .map((part) =>
      part.includes("&")
        ? part.split("&").join(enclosing)
        : `${enclosing} ${part}`
    )
    .join(", ");
}

/**
 * Whether a conditional group currently applies.
 *
 * Asked of the node's own window, which is the entire point: on the canvas a
 * frame is 375px wide inside a 1440px shell, and evaluating `@media
 * (min-width: 768px)` against the shell would report desktop rules as winning
 * in a phone frame.
 */
export function conditionHolds(
  group: CSSGroupingRule,
  win: Window,
  node?: Element
): boolean {
  const { media } = group as CSSMediaRule;
  if (media?.mediaText) {
    try {
      return win.matchMedia(media.mediaText).matches;
    } catch {
      return true;
    }
  }
  /*
   * A container query, measured against the element's own nearest container.
   *
   * This used to fall through to `return true` with the rest, because a
   * `CSSContainerRule` has neither `mediaText` nor `conditionText` — its query is on
   * `containerQuery`, which nothing consulted. So the pane asserted that
   * `@container (min-width: 600px) { .card { padding: 32px } }` was a matching,
   * winning declaration on a 300px container, with no condition shown beside it
   * (`conditionLabel` returned "" and `.filter(Boolean)` dropped it).
   */
  const container = (group as unknown as { containerQuery?: string })
    .containerQuery;
  if (container) {
    return containerQueryHolds(container, node);
  }
  // `@supports` we can ask the engine directly; `@layer` is structural and always
  // holds — it changes precedence, not whether a rule applies.
  const supports = (group as CSSSupportsRule).conditionText;
  const api = (win as { CSS?: { supports?: (c: string) => boolean } }).CSS;
  if (supports && typeof api?.supports === "function") {
    try {
      return api.supports(supports);
    } catch {
      return true;
    }
  }
  return true;
}

/** `(min-width: 600px)` and friends, against the nearest container ancestor. */
const CONTAINER_SIZE = /\((min|max)-(width|height)\s*:\s*([^)]+)\)/gi;

/**
 * Evaluate the size half of a container query.
 *
 * Deliberately partial, and biased toward `true`: only plain `min-`/`max-` width and
 * height comparisons are understood, and anything else — `style()` queries, scroll
 * state, a query this does not parse — is treated as holding, which keeps a rule
 *visible* rather than silently hiding one that does apply. The failure mode of a
 * wrong `true` is a rule shown with its condition beside it; the failure mode of a
 * wrong `false` is provenance that quietly omits the answer.
 */
function containerQueryHolds(query: string, node?: Element): boolean {
  const container = containerFor(node);
  if (!container) {
    return true;
  }
  const box = container.getBoundingClientRect();
  CONTAINER_SIZE.lastIndex = 0;
  let match = CONTAINER_SIZE.exec(query);
  while (match) {
    const [, bound, axis, raw] = match;
    const limit = Number.parseFloat(raw);
    const actual = axis.toLowerCase() === "width" ? box.width : box.height;
    if (Number.isFinite(limit)) {
      if (bound.toLowerCase() === "min" && actual < limit) {
        return false;
      }
      if (bound.toLowerCase() === "max" && actual > limit) {
        return false;
      }
    }
    match = CONTAINER_SIZE.exec(query);
  }
  return true;
}

/** The nearest ancestor that declares itself a container. */
function containerFor(node?: Element): Element | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const type = computedStyle(current).getPropertyValue("container-type");
    if (type && type !== "normal") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function conditionLabel(group: CSSGroupingRule): string {
  const media = (group as CSSMediaRule).media?.mediaText;
  if (media) {
    return `@media ${media}`;
  }
  const container = (group as unknown as { containerQuery?: string })
    .containerQuery;
  if (container) {
    // Labelled, so a non-matching container block reads as conditional rather than
    // as an unexplained rule that does not apply.
    return `@container ${container}`;
  }
  const condition = (group as CSSSupportsRule).conditionText;
  if (condition) {
    return `@supports ${condition}`;
  }
  const layer = (group as unknown as { name?: string }).name;
  return layer ? `@layer ${layer}` : "";
}

function readDecls(style: CSSStyleDeclaration): MatchedDecl[] {
  const out: MatchedDecl[] = [];
  for (const property of Array.from(style)) {
    out.push({
      important: style.getPropertyPriority(property) === "important",
      overridden: false,
      property,
      value: style.getPropertyValue(property).trim(),
    });
  }
  return out;
}

function hrefOf(rule: CSSStyleRule): string | null {
  return rule.parentStyleSheet?.href ?? null;
}

function originOf(rule: CSSStyleRule): string {
  const href = hrefOf(rule);
  if (!href) {
    return "<style>";
  }
  try {
    const { pathname } = new URL(href);
    return pathname.split("/").pop() || href;
  } catch {
    return href;
  }
}

/**
 * The single compound selector, out of a comma-separated group, that matches.
 *
 * Testing the whole group would give the right yes/no but the wrong
 * specificity — `a, #b .c` matching via `a` must score 0,0,1, not 1,1,1 — and
 * would leave nothing meaningful to show in the header.
 */
function matchCompound(selectorText: string, node: Element): string | null {
  for (const part of splitSelectorList(selectorText)) {
    try {
      if (node.matches(part)) {
        return part;
      }
    } catch {
      // A selector this browser cannot parse (a newer pseudo-class, a CSS-in-JS
      // artefact) is simply not a match we can prove.
    }
  }
  return null;
}

/**
 * Split on top-level commas only.
 *
 * `:is(a, b)` and `[data-x=","]` both contain commas that are not separators,
 * so a plain `.split(",")` produces fragments that throw in `matches()` and
 * silently drop real matches.
 */
/** Where `splitSelectorList` is: inside brackets, inside a string, or neither. */
interface SelectorScan {
  depth: number;
  quote: string | null;
  start: number;
}

/** Inside a string: skip escapes, and close on the matching quote. Returns the
 * index to continue from, which an escape advances past its escapee. */
function scanQuoted(c: string | undefined, i: number, s: SelectorScan): number {
  if (c === "\\") {
    return i + 1;
  }
  if (c === s.quote) {
    s.quote = null;
  }
  return i;
}

/** Track quotes and bracket depth. True when `c` closes a top-level selector. */
function scanUnquoted(c: string | undefined, s: SelectorScan): boolean {
  if (c === '"' || c === "'") {
    s.quote = c;
  } else if (c === "(" || c === "[") {
    s.depth += 1;
  } else if (c === ")" || c === "]") {
    s.depth -= 1;
  } else if (c === "," && s.depth === 0) {
    return true;
  }
  return false;
}

export function splitSelectorList(selectorText: string): string[] {
  const out: string[] = [];
  const s: SelectorScan = { depth: 0, quote: null, start: 0 };
  for (let i = 0; i < selectorText.length; i += 1) {
    const c = selectorText[i];
    if (s.quote) {
      i = scanQuoted(c, i, s);
    } else if (scanUnquoted(c, s)) {
      out.push(selectorText.slice(s.start, i).trim());
      s.start = i + 1;
    }
  }
  const tail = selectorText.slice(s.start).trim();
  if (tail) {
    out.push(tail);
  }
  return out.filter(Boolean);
}

const ID_RE = /#[\w-]+/g;
const CLASS_RE = /\.[\w-]+|\[[^\]]*\]/g;
const PSEUDO_CLASS_RE = /:[\w-]+/g;
const ELEMENT_RE = /(^|[\s>+~(])([a-z][\w-]*)/gi;
const PSEUDO_ELEMENT_RE = /::[\w-]+/g;
const ZERO_SPECIFICITY_FN = /:(?:where)\(/;
/** A quoted or bare attribute value: the `="#x"` of `[href="#x"]`. */
const ATTRIBUTE_VALUE = /([~^|$*]?=)\s*("[^"]*"|'[^']*'|[^\]\s]*)/g;
/**
 * The functional pseudo-classes whose *own* name scores nothing, because their
 * argument is counted instead.
 *
 * `:not(.a)` and `:has(.a)` take their specificity from the argument — one class,
 * not two — and `:is(.a, #b)` takes the *maximum* of its arguments. Counting the
 * function name on top of `CLASS_RE` counting the argument scored every one of them
 * one class too high, which mis-sorted `.btn:not(.disabled)` against a two-class rule.
 */
const ARGUMENT_WEIGHTED_FN = /:(?:not|is|has|matches|any)\(/g;

/**
 * Selector specificity as `[ids, classes, elements]`.
 *
 * Hand-rolled on purpose: a real selector parser is a dependency, and this
 * bundle is injected into the user's own page. The approximation is good for
 * everything a stylesheet in the wild actually contains, and specificity here
 * only ever decides *display order* — a wrong tie-break mis-sorts two rules,
 * it does not change the page.
 */
export function specificity(selector: string): Specificity {
  // `:where()` contributes nothing; strip it (and its argument) before counting.
  // Attribute *values* go too: `a[href="#pricing"]` counted its `#pricing` as an ID
  // and outranked a real `#id` rule. `CLASS_RE` still scores the attribute itself,
  // because `[…]` is one of its alternatives.
  const stripped = stripAttributeValues(stripZeroWeight(selector));
  const pseudoElements = (stripped.match(PSEUDO_ELEMENT_RE) ?? []).length;
  // Pseudo-*elements* are removed before pseudo-*classes* are counted, rather
  // than excluded with a lookbehind: `::` would otherwise match at its second
  // colon and score `p::before` a phantom `:before` class. A lookbehind reads
  // better and is ES2018 — a syntax error on Safari < 16.4, which would take
  // the whole injected bundle down rather than just this function.
  const withoutPseudoElements = stripped.replace(PSEUDO_ELEMENT_RE, " ");
  // `:not(`, `:is(` and `:has(` are scored by their argument, so the function name
  // itself is dropped before pseudo-classes are counted.
  const counted = withoutPseudoElements.replace(ARGUMENT_WEIGHTED_FN, "(");
  const ids = (counted.match(ID_RE) ?? []).length;
  const classes = (counted.match(CLASS_RE) ?? []).length;
  const pseudoClasses = (counted.match(PSEUDO_CLASS_RE) ?? []).length;
  const elements = (counted.match(ELEMENT_RE) ?? []).length;
  return [ids, classes + pseudoClasses, elements + pseudoElements];
}

/**
 * Blank out attribute *values*, keeping the brackets that carry the weight.
 *
 * `a[href="#pricing"]` scored its `#pricing` as an ID and outranked a real `#id`
 * rule; `[data-x=".c"]` scored a phantom class. The brackets stay so `CLASS_RE` still
 * counts the attribute selector itself, which is correct.
 */
function stripAttributeValues(selector: string): string {
  return selector.replace(ATTRIBUTE_VALUE, "$1");
}

/** Remove `:where(...)` groups, which are specificity-transparent. */
function stripZeroWeight(selector: string): string {
  let out = selector;
  let guard = 0;
  while (ZERO_SPECIFICITY_FN.test(out) && guard < 10) {
    guard += 1;
    const at = out.search(ZERO_SPECIFICITY_FN);
    const open = out.indexOf("(", at);
    let depth = 0;
    let end = open;
    for (let i = open; i < out.length; i += 1) {
      if (out[i] === "(") {
        depth += 1;
      } else if (out[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out = out.slice(0, at) + out.slice(end + 1);
  }
  return out;
}

/**
 * Sort strongest-first and strike every declaration a stronger one repeats.
 *
 * Modelled on the cascade rather than on the computed value. Comparing a
 * declaration's text to `getComputedStyle` looks equivalent and is not:
 * shorthands expand, `em` resolves to `px`, and colours normalise to `rgb()`,
 * so a rule that genuinely won would be struck through for "disagreeing" with
 * the value it produced.
 *
 * Overriding is decided **per declaration**, and display order **per rule**. Those
 * are two different questions and conflating them was a real bug: the old
 * `byCascade` promoted a whole rule above every non-important one if *any* of its
 * declarations carried `!important`, so given
 *
 *     #hero  { color: red;              font-size: 32px }
 *     .title { color: blue !important;  font-size: 12px }
 *
 * `.title` sorted first wholesale and `#hero`'s `font-size: 32px` — which actually
 * wins — was struck through. Worse than cosmetic: `winningDeclaration` in
 * `tokens/match.ts` reads "the first non-overridden declaration", so the token badge
 * named a token from the *losing* rule and shipped it to the agent as evidence.
 */
function markOverridden(rules: MatchedRule[]): void {
  const pairs: { decl: MatchedDecl; rule: MatchedRule }[] = [];
  for (const rule of rules) {
    for (const decl of rule.decls) {
      pairs.push({ decl, rule });
    }
  }
  pairs.sort((a, b) => byDeclarationCascade(a, b));
  const seen = new Set<string>();
  for (const { decl } of pairs) {
    if (seen.has(decl.property)) {
      decl.overridden = true;
    } else {
      seen.add(decl.property);
    }
  }
  rules.sort(byCascade);
}

/** Winner first, for one declaration against another. */
function byDeclarationCascade(
  a: { decl: MatchedDecl; rule: MatchedRule },
  b: { decl: MatchedDecl; rule: MatchedRule }
): number {
  if (a.decl.important !== b.decl.important) {
    return a.decl.important ? -1 : 1;
  }
  const byLayer = compareLayers(a.rule.layer, b.rule.layer, a.decl.important);
  if (byLayer !== 0) {
    return byLayer;
  }
  return bySpecificityThenOrder(a.rule, b.rule);
}

/**
 * Layer precedence, which inverts for `!important`.
 *
 * For normal declarations a later layer beats an earlier one, and an *unlayered*
 * declaration beats every layer. For important declarations the whole ordering
 * reverses: an earlier layer wins, and unlayered important is the weakest of the
 * three. Both halves are in the spec and neither was modelled — `@layer` was parsed
 * for the condition label and then ignored by the sort, so
 *
 *     @layer base       { #app h1     { color: red } }
 *     @layer utilities  { .text-black { color: #000 } }
 *
 * struck through `.text-black`, which is the exact inverse of what the browser does,
 * on the one view whose entire purpose is provenance.
 */
function compareLayers(
  a: number | null,
  b: number | null,
  important: boolean
): number {
  if (a === b) {
    return 0;
  }
  const strongerWhenUnlayered = important ? 1 : -1;
  if (a === null) {
    return strongerWhenUnlayered;
  }
  if (b === null) {
    return -strongerWhenUnlayered;
  }
  return important ? a - b : b - a;
}

function bySpecificityThenOrder(a: MatchedRule, b: MatchedRule): number {
  for (let i = 0; i < 3; i += 1) {
    if (a.specificity[i] !== b.specificity[i]) {
      return b.specificity[i] - a.specificity[i];
    }
  }
  // Later in the document wins, so it sorts first.
  return b.order - a.order;
}

/**
 * Display order for the rule list: strongest-looking first.
 *
 * Rule-level, so it necessarily approximates where a rule's declarations disagree
 * about importance — the strike-throughs, which are what the user actually reads off
 * this list, are decided per declaration by `markOverridden`.
 */
function byCascade(a: MatchedRule, b: MatchedRule): number {
  const aBang = a.decls.some((d) => d.important);
  const bBang = b.decls.some((d) => d.important);
  if (aBang !== bBang) {
    return aBang ? -1 : 1;
  }
  const byLayer = compareLayers(a.layer, b.layer, aBang);
  if (byLayer !== 0) {
    return byLayer;
  }
  return bySpecificityThenOrder(a, b);
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
