/**
 * Standing a `DesignPanel` up in a test.
 *
 * `panel.ts` is 3,000 lines and had no test file, and the reason was mechanical:
 * its constructor wants nine collaborators, two of which are classes with
 * substantial constructors of their own, and there was nowhere to get them from.
 * Everything the audit found in the panel — the multi-selection payload, the
 * re-seed contract, the CSS pane's rows — is a pure function of those
 * collaborators, so this module supplies them once.
 *
 * Three deliberate choices:
 *
 * - **The sets are real.** `ChangeSet`, `MoveSet`, `StructureSet`, `AttrSet` and
 *   `History` are cheap and are half of what these tests are about — a stub would
 *   assert that the panel calls a method, not that the payload comes out right.
 * - **The environment collaborators are stubs**, because they reach for layout,
 *   `dnd-kit` sensors and a live frame. Each records its calls so a test can
 *   assert on them. Only the members `panel.ts` actually touches are implemented
 *   (`controller`: `select`/`deselect`/`drawOutline`/`setTextOwner`/`guard`;
 *   `layer`: `add`; `resolver`: `of`) — a cast documents the rest as unreachable.
 * - **Measurement is stubbed, not simulated.** happy-dom does no layout, so
 *   `getBoundingClientRect` is patched per node via `sizeOf`. This mirrors what
 *   `vitest.config.ts`'s docstring already says about routing measurement through
 *   `realm.ts`.
 *
 * `styleSheet` exists because happy-dom's CSS parser has two gaps that matter
 * here: it does **not** parse native nesting (`.card { &:hover { … } }` yields a
 * rule with zero children) and it **drops `@layer` blocks entirely**. Anything
 * testing the stylesheet walkers must use `ruleTree` instead, which builds a
 * synthetic CSSOM the walkers accept because they duck-type their input.
 */
import type { ElementContext, SourceLocation } from "@airship/protocol";
import { AttrSet } from "../attr-set";
import { ChangeSet } from "../change-set";
import { History } from "../history";
import { MoveSet } from "../move-set";
import type { Selection } from "../picker";
import { StructureSet } from "../structure-set";
import type { Surface } from "../surface";
import type { DesignPanelDeps } from "./panel";

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

/** A rect for a node happy-dom would otherwise report as all zeros. */
export interface Size {
  height?: number;
  left?: number;
  top?: number;
  width?: number;
}

/**
 * Give one node a measurable box.
 *
 * Patched on the instance rather than the prototype so two nodes in one test can
 * disagree, which is what the multi-selection and sizing cases need.
 */
export function sizeOf(node: Element, size: Size): void {
  const rect = {
    bottom: (size.top ?? 0) + (size.height ?? 0),
    height: size.height ?? 0,
    left: size.left ?? 0,
    right: (size.left ?? 0) + (size.width ?? 0),
    top: size.top ?? 0,
    width: size.width ?? 0,
    x: size.left ?? 0,
    y: size.top ?? 0,
  };
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => rect }),
  });
}

/** Install a stylesheet in the test document. See the note on nesting above. */
export function styleSheet(css: string): HTMLStyleElement {
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.append(tag);
  return tag;
}

/** Empty the test document between cases. Call from `beforeEach`. */
export function resetDocument(): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  // Synthetic sheets from `installRules` go too, or they leak across cases.
  const doc = document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] };
  if (doc.adoptedStyleSheets) {
    doc.adoptedStyleSheets = [];
  }
}

/**
 * An element in the document, with optional classes, inline style and children.
 *
 * Appended to `document.body` unless a parent is given, because `getComputedStyle`
 * returns nothing useful for a detached node and every seed path goes through it.
 */
export function mount(
  tag: string,
  opts: {
    children?: Element[];
    class?: string;
    parent?: Element;
    style?: string;
    text?: string;
  } = {}
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.class) {
    node.className = opts.class;
  }
  if (opts.style) {
    node.setAttribute("style", opts.style);
  }
  if (opts.text) {
    node.textContent = opts.text;
  }
  if (opts.children) {
    node.append(...opts.children);
  }
  (opts.parent ?? document.body).append(node);
  return node;
}

// ---------------------------------------------------------------------------
// Synthetic CSSOM, for the stylesheet walkers
// ---------------------------------------------------------------------------

/** One node in a synthetic rule tree. */
export interface FakeRule {
  /** `@media`/`@supports`/`@layer`/`@container` children, or nested rules. */
  children?: FakeRule[];
  /** `@supports` / `@container` condition text. */
  conditionText?: string;
  /** `@container` query text. */
  containerQuery?: string;
  /** Declarations, as authored. `!` suffix on a value marks `!important`. */
  decls?: Record<string, string>;
  /**
   * An `@import`: these rules hang off `styleSheet`, not `cssRules`, which is the
   * whole reason the walker used to skip them.
   */
  imports?: FakeRule[];
  /** `@layer` name. */
  layerName?: string;
  /** `@media` query text. */
  mediaText?: string;
  /** A style rule's selector. Omit for a grouping rule. */
  selector?: string;
}

/**
 * Build something shaped enough like a `CSSRuleList` for `css-rules.ts` and
 * `cascade.ts` to walk.
 *
 * Both duck-type — `typeof rule.selectorText === "string" && rule.style` for a
 * style rule, `rule.cssRules` for a group — so a plain object is a faithful
 * input. This is the only way to express native nesting and `@layer` in a test,
 * since happy-dom's parser models neither.
 */
export function ruleTree(rules: FakeRule[]): CSSRuleList {
  return asRuleList(rules.map(toRule));
}

function toRule(rule: FakeRule): unknown {
  const children = rule.children?.map(toRule) ?? [];
  const out: Record<string, unknown> = {};
  if (rule.selector !== undefined) {
    out.selectorText = rule.selector;
    out.style = declaration(rule.decls ?? {});
  }
  if (rule.mediaText !== undefined) {
    out.media = { mediaText: rule.mediaText };
    out.mediaText = rule.mediaText;
  }
  if (rule.conditionText !== undefined) {
    out.conditionText = rule.conditionText;
  }
  if (rule.containerQuery !== undefined) {
    out.containerQuery = rule.containerQuery;
  }
  if (rule.layerName !== undefined) {
    out.name = rule.layerName;
  }
  if (rule.imports !== undefined) {
    out.styleSheet = { cssRules: asRuleList(rule.imports.map(toRule)) };
    return out;
  }
  // A style rule with children is native nesting, and carries both — which is
  // exactly the shape the old `!("selectorText" in rule)` group test rejected.
  if (children.length || rule.selector === undefined) {
    out.cssRules = asRuleList(children);
  }
  return out;
}

/** Trailing `!` on a fixture value is how a test spells `!important`. */
const BANG = /!\s*$/;
const TRAILING_BANG = /\s*!\s*$/;

/** A minimal `CSSStyleDeclaration`: iterable, with values and priorities. */
function declaration(decls: Record<string, string>): unknown {
  const names = Object.keys(decls);
  const value = (property: string): string =>
    (decls[property] ?? "").replace(TRAILING_BANG, "").trim();
  const priority = (property: string): string =>
    BANG.test(decls[property] ?? "") ? "important" : "";
  const style: Record<string | number | symbol, unknown> = {
    getPropertyPriority: priority,
    getPropertyValue: value,
    // `item(i)` as well as the iterator: production reads declarations through
    // `propertyNames`, which uses `length` + `item` because the iterator protocol on
    // `CSSStyleDeclaration` is a late spec addition happy-dom does not implement.
    item: (i: number) => names[i] ?? "",
    length: names.length,
    [Symbol.iterator]: () => names[Symbol.iterator](),
  };
  names.forEach((name, i) => {
    style[i] = name;
  });
  return style;
}

/** Array-like plus iterable, which is all `Array.from` and `for..of` need. */
function asRuleList(rules: unknown[]): CSSRuleList {
  const list: Record<string | number | symbol, unknown> = {
    item: (i: number) => rules[i] ?? null,
    length: rules.length,
    [Symbol.iterator]: () => rules[Symbol.iterator](),
  };
  rules.forEach((rule, i) => {
    list[i] = rule;
  });
  return list as unknown as CSSRuleList;
}

/**
 * Install a synthetic rule tree as a stylesheet the walkers will find.
 *
 * Through `adoptedStyleSheets`, which is both the only injection point that takes a
 * pre-built `cssRules` list and — usefully — the collection the scan had to be taught
 * about anyway. So this exercises the *real* `matchedRules` against rules happy-dom's
 * parser could never have produced: native nesting, `@layer`, `@import`.
 *
 * Returns a disposer; `resetDocument` clears them too.
 */
export function installRules(rules: FakeRule[]): () => void {
  const sheet = { cssRules: ruleTree(rules) } as unknown as CSSStyleSheet;
  const doc = document as unknown as { adoptedStyleSheets: CSSStyleSheet[] };
  const before = doc.adoptedStyleSheets ?? [];
  doc.adoptedStyleSheets = [...before, sheet];
  return () => {
    doc.adoptedStyleSheets = before;
  };
}

// ---------------------------------------------------------------------------
// Panel dependencies
// ---------------------------------------------------------------------------

/** What the stubs recorded, so a test can assert on the panel's side effects. */
export interface PanelSpy {
  added: Element[];
  deselected: number;
  outlines: number;
  refreshed: number;
  selected: { node: Element; surface: Surface | null }[];
  textOwners: (Element | null)[];
}

export interface Harness {
  attrSet: AttrSet;
  changeSet: ChangeSet;
  deps: DesignPanelDeps;
  history: History;
  moveSet: MoveSet;
  spy: PanelSpy;
  structureSet: StructureSet;
  /** The stub surface every `Selection` from `select()` carries. */
  surface: Surface;
}

/**
 * Real sets, stubbed environment.
 *
 * `apply` on the history is wired to `history-ops`' own runner by the app, not
 * here: a test that needs undo to actually re-enact an op passes its own via
 * `overrides`, and one that only needs the journal counted does not care.
 */
export function harness(overrides: Partial<DesignPanelDeps> = {}): Harness {
  const attrSet = new AttrSet();
  const changeSet = new ChangeSet();
  const moveSet = new MoveSet();
  const structureSet = new StructureSet();
  const spy: PanelSpy = {
    added: [],
    deselected: 0,
    outlines: 0,
    refreshed: 0,
    selected: [],
    textOwners: [],
  };
  const history = new History({
    apply: () => {
      // Replay is the app's job (`history-ops.ts`); tests that need it supply
      // their own history through `overrides`.
    },
    refresh: () => {
      spy.refreshed += 1;
    },
  });
  const surface = stubSurface();

  const deps: DesignPanelDeps = {
    attrSet,
    changeSet,
    controller: {
      deselect: () => {
        spy.deselected += 1;
      },
      drawOutline: () => {
        spy.outlines += 1;
      },
      // `allowPressOn` is the only member of the guard the panel reaches for,
      // and it registers a provider the panel never asks about again.
      guard: { allowPressOn: () => undefined },
      select: (node: Element, s: Surface | null) => {
        spy.selected.push({ node, surface: s });
      },
      setTextOwner: (node: Element | null) => {
        spy.textOwners.push(node);
      },
    } as unknown as DesignPanelDeps["controller"],
    history,
    layer: {
      add: (...nodes: Element[]) => {
        spy.added.push(...nodes);
      },
    } as unknown as DesignPanelDeps["layer"],
    moveSet,
    resolver: {
      all: () => [surface],
      at: () => surface,
      of: (node: Node | null) => (node ? surface : null),
    },
    structureSet,
    ...overrides,
  };

  return {
    attrSet,
    changeSet,
    deps,
    history,
    moveSet,
    spy,
    structureSet,
    surface,
  };
}

/** A surface over the test document, at 1:1 — the inline case. */
export function stubSurface(): Surface {
  return {
    bounds: () => null,
    doc: document,
    elementAtScreen: () => null,
    extract: (node: Element) =>
      Promise.resolve({ context: contextOf(node), source: null }),
    id: "test",
    isLive: true,
    scale: 1,
    scanTokens: () => ({ framework: "unknown", tokens: [] }),
    toLocal: (point) => point,
    toScreen: (rect) => rect,
    win: window as unknown as Window,
  };
}

/** The `ElementContext` a real `extract` would produce for a node. */
export function contextOf(node: Element): ElementContext {
  return {
    classes: [...node.classList],
    displayName: node.tagName.toLowerCase(),
    tagName: node.tagName.toLowerCase(),
    textPreview: (node.textContent ?? "").slice(0, 40),
  };
}

/**
 * A `Selection` for a node, as the picker would hand one over.
 *
 * The panel keys its change set on the live node and reads `element`/`source` for
 * the payload, so those three are what a selection has to get right — the rect is
 * only chrome.
 */
export function selectionOf(
  node: Element,
  opts: { source?: SourceLocation | null; surface?: Surface } = {}
): Selection {
  const rect = node.getBoundingClientRect();
  return {
    element: contextOf(node),
    node,
    rect: {
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    },
    source: opts.source ?? null,
    surface: opts.surface ?? stubSurface(),
  };
}
