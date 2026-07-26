// Emits CSS custom properties + the size-invariant typography classes from the
// design tokens. Pure string building — no Node APIs, so this is safe to bundle
// into a browser build. One palette, emitted once under `scope` (`:root` by
// default) — the page has a single intended look, so there is no second block
// and no theme attribute to select between them.
//
// Component classes (buttons, cards, inputs) are deliberately NOT emitted here.
// The app composes those with Tailwind, which reads these same variables through
// `@theme inline` — so there is exactly one definition of a button, at its call
// site, rather than a CSS one here competing with a utility one there.
import { design } from "./generated/design";
import type { RoleSpec } from "./tokens";

export interface CssOptions {
  /** Include the typography role classes (`.pk-*`). Default `true`. */
  components?: boolean;
  /** Selector the variables attach to. Default `:root`. */
  scope?: string;
}

/** `cssVar("color-canvas")` → `var(--pk-color-canvas)`. */
export function cssVar(name: string): string {
  return `var(--pk-${name})`;
}

function semanticVars(): string {
  return Object.entries(design.semantic)
    .map(([k, v]) => `  --pk-color-${k}: ${v};`)
    .join("\n");
}

function baseVars(): string {
  const lines: string[] = [];
  lines.push(`  --pk-font-sans: ${design.typography.families.sans};`);
  lines.push(`  --pk-font-mono: ${design.typography.families.mono};`);
  for (const [k, v] of Object.entries(design.spacing)) {
    lines.push(`  --pk-space-${k}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(design.rounded)) {
    lines.push(`  --pk-radius-${k}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(design.elevation)) {
    lines.push(`  --pk-elevation-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(design.motion)) {
    lines.push(`  --pk-motion-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(design.layout)) {
    lines.push(`  --pk-layout-${k}: ${v}px;`);
  }
  return lines.join("\n");
}

function roleDecls(spec: RoleSpec): string {
  const family =
    spec.family === "mono" ? "var(--pk-font-mono)" : "var(--pk-font-sans)";
  const decls = [
    `font-family: ${family}`,
    `font-size: ${spec.size}px`,
    `font-weight: ${spec.weight}`,
    `line-height: ${spec.line}`,
    `letter-spacing: ${spec.tracking}px`,
  ];
  if (spec.transform) {
    decls.push(`text-transform: ${spec.transform}`);
  }
  return decls.join("; ");
}

function typographyClasses(): string {
  return Object.entries(design.typography.roles)
    .map(([role, spec]) => `.pk-${role} { ${roleDecls(spec as RoleSpec)}; }`)
    .join("\n");
}

export function buildCss(opts: CssOptions = {}): string {
  const { scope = ":root", components = true } = opts;
  const parts: string[] = [`${scope} {\n${baseVars()}\n${semanticVars()}\n}`];
  if (components) {
    parts.push(typographyClasses());
  }
  return `${parts.join("\n\n")}\n`;
}

/** The full stylesheet (variables + components) — emitted to dist/tokens.css. */
export const css = buildCss();
