/**
 * The alignment row, mapped onto CSS.
 *
 * A design panel opens with align-left / centre / right / top / middle /
 * bottom, then distribute and Tidy up. In a vector editor every one of those is
 * a pure translation of the selected object and nothing else moves. In a DOM
 * editor that is only true some of the time, and pretending otherwise would
 * produce buttons that silently do the wrong thing.
 *
 * So the mapping is explicit about which node it writes to, and the caller
 * flashes the parent when the answer is `parent` — see `planAlign`. The four
 * cases, best to worst:
 *
 * 1. **Absolutely positioned** — inset writes on the element itself. Genuinely
 *    1:1 with the design-tool behaviour: no sibling moves.
 * 2. **Grid child** — `justify-self` / `align-self`. Also per-item and also
 *    side-effect-free; CSS Grid is the one layout mode that gives the design-tool
 *    semantics for free.
 * 3. **Flex child** — the cross axis is `align-self` on the element (clean); the
 *    main axis has to be `justify-content` on the *parent*, which moves every
 *    sibling. This is the real divergence, and the UI says so.
 * 4. **Block flow** — horizontal centring is `margin-inline: auto`. There is no
 *    honest vertical equivalent, so those buttons are disabled rather than
 *    faked.
 */
import { computedStyle } from "../realm";
import { splitWords } from "./css-value";
import { declaredValue } from "./sizing";

export type AlignAction =
  | "left"
  | "h-center"
  | "right"
  | "top"
  | "v-center"
  | "bottom"
  | "distribute-h"
  | "distribute-v"
  | "tidy";

export interface Decl {
  property: string;
  value: string;
}

export interface AlignPlan {
  decls: Decl[];
  /** Shown in the tooltip so the side effect is never a surprise. */
  note?: string;
  /** Written to the element itself, or to its parent (which moves siblings). */
  target: "self" | "parent";
}

type Mode = "absolute" | "grid" | "flex-row" | "flex-column" | "flow";

function layoutMode(node: Element): Mode {
  const own = computedStyle(node);
  if (own.position === "absolute" || own.position === "fixed") {
    return "absolute";
  }
  const parent = node.parentElement;
  if (!parent) {
    return "flow";
  }
  const { display } = computedStyle(parent);
  if (display === "grid" || display === "inline-grid") {
    return "grid";
  }
  if (display === "flex" || display === "inline-flex") {
    return computedStyle(parent).flexDirection.startsWith("column")
      ? "flex-column"
      : "flex-row";
  }
  return "flow";
}

/** Is this action on the parent's main axis, given the flex direction? */
function isMainAxis(action: AlignAction, mode: Mode): boolean {
  const horizontal =
    action === "left" || action === "h-center" || action === "right";
  return mode === "flex-column" ? !horizontal : horizontal;
}

const JUSTIFY: Record<string, string> = {
  bottom: "flex-end",
  "h-center": "center",
  left: "flex-start",
  right: "flex-end",
  top: "flex-start",
  "v-center": "center",
};

/**
 * Centring writes `translate`, which holds *both* axes in one property.
 *
 * `INSET` used to hardcode `-50% 0` and `0 -50%`, so centring an absolute element
 * horizontally and then vertically clobbered the first correction with the second — and
 * wiped the `translate` that `position.ts`'s `moveTo` and the panel's nudge use for
 * in-flow offsets. `centeredTranslate` reads the current value and replaces one axis.
 */
/**
 * Even out a parent's spacing.
 *
 * A grid parent stays a grid: `display: flex` was emitted unconditionally even though
 * `layoutMode` had already identified the parent, so Tidy up on a card inside a
 * `display: grid` gallery turned the parent into a flex row — its
 * `grid-template-columns` still declared but inert, and the gallery collapsed onto one
 * line. Grid expresses both of these natively.
 */
function tidyPlan(parent: Element): AlignPlan {
  const { direction, gap } = measureFlow(parent);
  if (layoutMode(parent) === "grid") {
    return {
      decls: [
        { property: "gap", value: `${gap}px` },
        { property: "align-items", value: "center" },
      ],
      note: "Evens the grid's spacing",
      target: "parent",
    };
  }
  return {
    decls: [
      { property: "display", value: "flex" },
      { property: "flex-direction", value: direction },
      { property: "gap", value: `${gap}px` },
      { property: "align-items", value: "center" },
    ],
    note: "Makes the parent an auto-layout",
    target: "parent",
  };
}

/** Space a parent's children evenly along one axis. See `tidyPlan` on grid. */
function distributePlan(parent: Element, wantColumn: boolean): AlignPlan {
  if (layoutMode(parent) === "grid") {
    return {
      decls: [
        {
          property: wantColumn ? "align-content" : "justify-content",
          value: "space-between",
        },
      ],
      note: "Spaces every child evenly",
      target: "parent",
    };
  }
  return {
    decls: [
      { property: "display", value: "flex" },
      { property: "flex-direction", value: wantColumn ? "column" : "row" },
      { property: "justify-content", value: "space-between" },
    ],
    note: "Spaces every child evenly",
    target: "parent",
  };
}

function centeredTranslate(node: Element, axis: "x" | "y"): string {
  const [x = "0", y = "0"] = splitWords(
    declaredValue(node, "translate") || "0 0"
  );
  return axis === "x" ? `-50% ${y}` : `${x} -50%`;
}

const INSET: Record<string, Decl[]> = {
  bottom: [
    { property: "bottom", value: "0px" },
    { property: "top", value: "auto" },
  ],
  "h-center": [
    { property: "left", value: "50%" },
    { property: "right", value: "auto" },
  ],
  left: [
    { property: "left", value: "0px" },
    { property: "right", value: "auto" },
  ],
  right: [
    { property: "right", value: "0px" },
    { property: "left", value: "auto" },
  ],
  top: [
    { property: "top", value: "0px" },
    { property: "bottom", value: "auto" },
  ],
  "v-center": [
    { property: "top", value: "50%" },
    { property: "bottom", value: "auto" },
  ],
};

const FLOW: Record<string, Decl[]> = {
  "h-center": [
    { property: "margin-left", value: "auto" },
    { property: "margin-right", value: "auto" },
  ],
  left: [
    { property: "margin-left", value: "0px" },
    { property: "margin-right", value: "auto" },
  ],
  right: [
    { property: "margin-left", value: "auto" },
    { property: "margin-right", value: "0px" },
  ],
};

/** Element children of a node — what distribute and Tidy up operate on. */
export function elementChildren(node: Element | null): Element[] {
  return node ? Array.from(node.children) : [];
}

/**
 * The inset declarations for an absolutely positioned element.
 *
 * Split out of `planAlign` so the centring correction has somewhere to live: `translate`
 * holds both axes in one property, so it has to be composed with what the other axis
 * already has rather than written whole. See `centeredTranslate`.
 */
function insetPlan(node: Element, action: AlignAction): Decl[] {
  const decls = [...(INSET[action] ?? [])];
  if (action === "h-center" || action === "v-center") {
    decls.push({
      property: "translate",
      value: centeredTranslate(node, action === "h-center" ? "x" : "y"),
    });
  }
  return decls;
}

/**
 * What this button should write, or `null` if it has no honest meaning here.
 *
 * Returning `null` is load-bearing: it is what disables the vertical buttons in
 * block flow instead of writing a `vertical-align` that does nothing to a
 * block-level child.
 */
export function planAlign(
  node: Element,
  action: AlignAction
): AlignPlan | null {
  const mode = layoutMode(node);

  if (
    action === "tidy" ||
    action === "distribute-h" ||
    action === "distribute-v"
  ) {
    const parent = node.parentElement;
    if (!parent || elementChildren(parent).length < 2) {
      return null;
    }
    /*
     * A grid parent stays a grid.
     *
     * `display: flex` was emitted unconditionally, even though `layoutMode` above has
     * already identified the parent. Clicking Tidy up on a card inside a
     * `display: grid` gallery turned the parent into a flex row: its
     * `grid-template-columns` was still declared but inert, and the whole gallery
     * collapsed onto one line. Grid expresses both of these natively.
     */
    return action === "tidy"
      ? tidyPlan(parent)
      : distributePlan(parent, action === "distribute-v");
  }

  if (mode === "absolute") {
    return { decls: insetPlan(node, action), target: "self" };
  }

  if (mode === "grid") {
    const horizontal =
      action === "left" || action === "h-center" || action === "right";
    return {
      decls: [
        {
          property: horizontal ? "justify-self" : "align-self",
          value: JUSTIFY[action],
        },
      ],
      target: "self",
    };
  }

  if (mode === "flex-row" || mode === "flex-column") {
    if (isMainAxis(action, mode)) {
      return {
        decls: [{ property: "justify-content", value: JUSTIFY[action] }],
        note: "Moves the siblings too",
        target: "parent",
      };
    }
    return {
      decls: [{ property: "align-self", value: JUSTIFY[action] }],
      target: "self",
    };
  }

  // Block flow: horizontal only.
  const decls = FLOW[action];
  return decls ? { decls, target: "self" } : null;
}

/**
 * Read the parent's current arrangement so Tidy up preserves it.
 *
 * Direction comes from which axis the children actually spread along, and the
 * gap from the median of the visual gaps between them — the median rather than
 * the mean because one outlier child (a spacer, an absolutely-positioned badge)
 * would otherwise drag the whole spacing off.
 */
function measureFlow(parent: Element): { direction: string; gap: number } {
  const kids = elementChildren(parent).map((c) => c.getBoundingClientRect());
  if (kids.length < 2) {
    return { direction: "row", gap: 0 };
  }
  const xSpread =
    Math.max(...kids.map((r) => r.right)) -
    Math.min(...kids.map((r) => r.left));
  const ySpread =
    Math.max(...kids.map((r) => r.bottom)) -
    Math.min(...kids.map((r) => r.top));
  const horizontal = xSpread >= ySpread;

  const sorted = [...kids].sort((a, b) =>
    horizontal ? a.left - b.left : a.top - b.top
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    gaps.push(horizontal ? cur.left - prev.right : cur.top - prev.bottom);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
  return {
    direction: horizontal ? "row" : "column",
    gap: Math.max(0, Math.round(median)),
  };
}
