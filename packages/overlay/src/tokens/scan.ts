/**
 * The runtime half of token discovery: what the browser actually loaded.
 *
 * The server's static scan is better data — it has authored names, files and
 * line numbers — but it can only see files. This sees the live CSSOM, which is
 * where styled-components, emotion, and anything injected at runtime live.
 * Neither is a superset of the other, so both run and the registry merges them.
 *
 * Runs in the *frame's* realm, reached through `FrameAgent.scanTokens`. Running
 * it from the shell would scan the editor's own stylesheet and find nothing of
 * the user's app at all.
 */
import {
  type CssFramework,
  categorizeToken,
  categoryForProperty,
  type DesignToken,
  isInternalToken,
  isTokenizableValue,
  type TokenScanResult,
} from "@airship/protocol/tokens";
import {
  asGroupingRule,
  asStyleRule,
  conditionHolds,
  isOwnSheet,
} from "../inspector/css-rules";
import { propertyNames } from "../inspector/style-model";

const CUSTOM_PROPERTY = /^--[\w-]+$/;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;
const EXACT_VAR = /^var\(\s*(--[\w-]+)\s*\)$/;
/** A single class selector and nothing else: `.p-4`, not `.a .b` or `.a:hover`. */
const SIMPLE_CLASS = /^\.(-?[_a-zA-Z][\w-]*)$/;

/**
 * A compiled Tailwind build can carry six figures of rules. The static scan has
 * already covered anything on disk, so this pass is only here for what the
 * files could not show — it is not worth an unbounded walk.
 */
const MAX_RULES = 20_000;

interface Collected {
  /** Declared custom property names, in first-seen order. */
  names: Set<string>;
  /** Raw authored value, for alias detection. */
  raw: Map<string, string>;
  sawTailwind: boolean;
  /** `--name` → the CSS properties seen referencing it. */
  usage: Map<string, Set<string>>;
  utilities: Map<string, { property: string; value: string }>;
}

/**
 * Every design token the loaded stylesheets declare.
 *
 * Values come from `getComputedStyle(documentElement)` rather than the rule text
 * — that is what collapses `--primary: var(--blue-500)` to the colour it
 * actually resolves to, and it costs nothing because the browser has already
 * done the work.
 */
export function scanRuntimeTokens(doc: Document, win: Window): TokenScanResult {
  const found: Collected = {
    names: new Set(),
    raw: new Map(),
    sawTailwind: false,
    usage: new Map(),
    utilities: new Map(),
  };

  const budget = { rules: 0 };
  for (const sheet of Array.from(doc.styleSheets)) {
    if (budget.rules >= MAX_RULES) {
      break;
    }
    if (isOwnSheet(sheet)) {
      continue;
    }
    let top: CSSRuleList;
    try {
      // Cross-origin sheets throw on access; not an error, just unreadable.
      const list = sheet.cssRules;
      if (!list) {
        continue;
      }
      top = list;
    } catch {
      continue;
    }
    walk(top, win, found, budget);
  }

  return {
    framework: detectFramework(found),
    tokens: build(found, doc, win),
  };
}

function walk(
  list: CSSRuleList,
  win: Window,
  found: Collected,
  budget: { rules: number }
): void {
  for (const rule of Array.from(list)) {
    if (budget.rules >= MAX_RULES) {
      return;
    }
    budget.rules += 1;

    const group = asGroupingRule(rule);
    if (group) {
      // A token declared only inside an inactive media query is not in effect,
      // and `getComputedStyle` would report the active value anyway — so
      // descending into it would attribute the wrong value to the name.
      if (conditionHolds(group, win)) {
        walk(group.cssRules, win, found, budget);
      }
      continue;
    }

    const style = asStyleRule(rule);
    if (style) {
      collect(style, found);
    }
  }
}

function collect(rule: CSSStyleRule, found: Collected): void {
  const declarations: { property: string; value: string }[] = [];
  // See `propertyNames` — the declaration iterator is not universally available.
  for (const property of propertyNames(rule.style)) {
    const value = rule.style.getPropertyValue(property).trim();
    declarations.push({ property, value });

    if (CUSTOM_PROPERTY.test(property)) {
      if (property.startsWith("--tw-")) {
        found.sawTailwind = true;
      }
      found.names.add(property);
      if (!found.raw.has(property)) {
        found.raw.set(property, value);
      }
    } else {
      recordUsage(found.usage, property, value);
    }
  }

  const simple = SIMPLE_CLASS.exec(rule.selectorText.trim());
  if (simple && declarations.length === 1 && !found.utilities.has(simple[0])) {
    found.utilities.set(simple[0], declarations[0]);
  }
}

function recordUsage(
  usage: Map<string, Set<string>>,
  property: string,
  value: string
): void {
  if (!value.includes("var(")) {
    return;
  }
  VAR_REFERENCE.lastIndex = 0;
  let ref: RegExpExecArray | null = VAR_REFERENCE.exec(value);
  while (ref !== null) {
    const set = usage.get(ref[1]);
    if (set) {
      set.add(property);
    } else {
      usage.set(ref[1], new Set([property]));
    }
    ref = VAR_REFERENCE.exec(value);
  }
}

function build(found: Collected, doc: Document, win: Window): DesignToken[] {
  const tokens: DesignToken[] = [];
  const rootStyle = win.getComputedStyle(doc.documentElement);

  for (const name of found.names) {
    if (isInternalToken(name)) {
      continue;
    }
    // The resolved value, with `var()` chains already followed by the engine.
    const value = rootStyle.getPropertyValue(name).trim();
    if (!value) {
      // Declared somewhere that is not in effect on the root — a component-
      // scoped variable. We cannot resolve it without an element to ask, and a
      // token nobody can evaluate is not one to offer.
      continue;
    }
    const category = categorizeToken({
      name,
      usedOn: found.usage.get(name),
      value,
    });
    if (!category) {
      continue;
    }
    const rawValue = found.raw.get(name) ?? "";
    const alias = EXACT_VAR.exec(rawValue);
    tokens.push({
      aliasOf: alias && found.names.has(alias[1]) ? alias[1] : undefined,
      category,
      kind: "css-var",
      name,
      origin: "runtime",
      values: { "": value },
    });
  }

  for (const [selector, declaration] of found.utilities) {
    const category = categoryForProperty(declaration.property);
    if (!category) {
      continue;
    }
    const value = resolve(declaration.value, rootStyle);
    // `.h-auto { height: auto }` is a Tailwind utility, not a design token —
    // see `isTokenizableValue`.
    if (!isTokenizableValue(value)) {
      continue;
    }
    tokens.push({
      category,
      kind: "utility-class",
      name: selector,
      origin: "runtime",
      values: { [declaration.property]: value },
    });
  }

  return tokens;
}

/** Swap a `var()` for the value the root resolves it to, when it has one. */
function resolve(value: string, rootStyle: CSSStyleDeclaration): string {
  if (!value.includes("var(")) {
    return value;
  }
  VAR_REFERENCE.lastIndex = 0;
  const match = VAR_REFERENCE.exec(value);
  if (!match) {
    return value;
  }
  const resolved = rootStyle.getPropertyValue(match[1]).trim();
  return resolved || value;
}

function detectFramework(found: Collected): CssFramework {
  if (found.sawTailwind) {
    return "tailwind";
  }
  return found.utilities.size > 0 ? "custom" : "unknown";
}
