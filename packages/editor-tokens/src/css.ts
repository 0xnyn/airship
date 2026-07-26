// Emits CSS custom properties from the editor design tokens. Pure string
// building — safe to bundle into the browser overlay IIFE (no Node APIs).
// Everything lives on `--ap-*` so the editor namespace can never collide with
// the marketing `--pk-*` system.
import { design } from "./generated/editor";

export interface BuildCssOptions {
  /** Selector the variables attach to. Default `:root`. */
  scope?: string;
}

/** `cssVar("surface", "panel")` → `var(--ap-surface-panel)`. */
export function cssVar(group: string, name: string): string {
  return `var(--ap-${group}-${name})`;
}

const GROUPS = [
  { group: "surface", prefix: "surface" },
  { group: "border", prefix: "border" },
  { group: "text", prefix: "text" },
  { group: "icon", prefix: "icon" },
  { group: "blue", prefix: "blue" },
  { group: "primary", prefix: "primary" },
  { group: "semantic", prefix: "semantic" },
  { group: "selection", prefix: "selection" },
  { group: "timeline", prefix: "timeline" },
  { group: "scrollbar", prefix: "scrollbar" },
  { group: "divider", prefix: "divider" },
  { group: "shadow", prefix: "shadow" },
  { group: "opacity", prefix: "opacity" },
  { group: "gray", prefix: "gray" },
  { group: "input", prefix: "input" },
  { group: "button", prefix: "button" },
  { group: "fontSize", prefix: "font-size" },
  { group: "iconSize", prefix: "icon-size" },
  { group: "control", prefix: "control" },
  { group: "spacing", prefix: "space" },
  { group: "rounded", prefix: "radius" },
  { group: "elevation", prefix: "elevation" },
  { group: "boxModel", prefix: "box" },
  { group: "motion", prefix: "motion" },
] as const;

/** Emitted prefixes whose values are pixel lengths and need a `px` suffix. */
const PX_PREFIXES: ReadonlySet<string> = new Set([
  "space",
  "radius",
  "font-size",
  "icon-size",
  "control",
]);

export function buildCss(opts: BuildCssOptions = {}): string {
  const { scope = ":root" } = opts;
  const lines: string[] = [];

  for (const [k, v] of Object.entries(design.typography.families)) {
    lines.push(`  --ap-font-${k}: ${v};`);
  }

  for (const { group, prefix } of GROUPS) {
    if (group === "primary") {
      // The base accent is the `primary` key itself — emit it as `--ap-primary`
      // (no doubled prefix), with state keys as `--ap-primary-*`.
      const g = design.primary;
      lines.push(`  --ap-primary: ${g.primary};`);
      for (const [k, v] of Object.entries(g)) {
        if (k === "primary") {
          continue;
        }
        lines.push(`  --ap-primary-${k}: ${v};`);
      }
      continue;
    }
    const entries = Object.entries(
      design[group] as Record<string, string | number>
    );
    const isPx = PX_PREFIXES.has(prefix);
    for (const [k, v] of entries) {
      lines.push(`  --ap-${prefix}-${k}: ${isPx ? `${v}px` : v};`);
    }
  }

  return `${scope} {\n${lines.join("\n")}\n}\n`;
}

/** The full editor stylesheet — emitted to dist/tokens.css. */
export const css = buildCss();
