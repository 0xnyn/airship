// AUTO-GENERATED from packages/site-tokens/DESIGN.md front-matter by scripts/gen.mjs.
// Do not edit by hand — edit DESIGN.md and run `pnpm --filter @airship/site-tokens gen`.

export const design = {
  "colors": {
    "white": "#ffffff",
    "stone-50": "#fafaf9",
    "stone-100": "#f5f5f4",
    "stone-200": "#e7e5e4",
    "stone-300": "#d6d3d1",
    "stone-400": "#a8a29e",
    "stone-500": "#78716c",
    "stone-600": "#57534e",
    "stone-700": "#44403c",
    "stone-800": "#292524",
    "stone-900": "#1c1917",
    "chrome-light": "#f6f6f6",
    "syntax-prop": "#0e7490",
    "syntax-old": "#b91c1c",
    "syntax-new": "#047857",
    "syntax-keyword": "#6d28d9",
    "editor-blue": "#0d99ff"
  },
  "semantic": {
    "text-primary": "#1c1917",
    "text-secondary": "#78716c",
    "text-tertiary": "#a8a29e",
    "text-muted": "#57534e",
    "text-faint": "#d6d3d1",
    "surface-page": "#fafaf9",
    "surface-panel": "#ffffff",
    "surface-shell": "#ffffff",
    "surface-input": "#f5f5f4",
    "surface-chrome": "#f6f6f6",
    "border-default": "#e7e5e4",
    "border-subtle": "rgba(0,0,0,0.06)",
    "border-faint": "rgba(0,0,0,0.05)",
    "cta-bg": "#1c1917",
    "cta-text": "#ffffff",
    "cta-hover": "#292524",
    "dot-inactive": "#d4d4d4",
    "term-dot-inactive": "rgba(0,0,0,0.12)",
    "selection-bg": "#cce1ec",
    "selection-text": "#1c1917",
    "syntax-prop": "#0e7490",
    "syntax-old": "#b91c1c",
    "syntax-new": "#047857",
    "syntax-keyword": "#6d28d9",
    "focus-ring": "#78716c",
    "scrim": "rgba(0,0,0,0.4)"
  },
  "typography": {
    "families": {
      "sans": "\"Inter\", \"Inter Fallback\", system-ui, -apple-system, \"Segoe UI\", sans-serif",
      "mono": "\"JetBrains Mono\", \"JetBrains Mono Fallback\", ui-monospace, SFMono-Regular, Menlo, monospace"
    },
    "roles": {
      "hero-heading": {
        "size": 32,
        "weight": 500,
        "line": 1.25,
        "tracking": -0.45,
        "family": "sans"
      },
      "section-heading": {
        "size": 18,
        "weight": 500,
        "line": 1.5556,
        "tracking": -0.045,
        "family": "sans"
      },
      "body": {
        "size": 14,
        "weight": 400,
        "line": 1.5714,
        "tracking": -0.045,
        "family": "sans"
      },
      "small": {
        "size": 13,
        "weight": 400,
        "line": 1.6923,
        "tracking": -0.045,
        "family": "sans"
      },
      "toc": {
        "size": 12,
        "weight": 400,
        "line": 1.3333,
        "tracking": -0.045,
        "family": "sans"
      },
      "mono-code": {
        "size": 13,
        "weight": 400,
        "line": 1.8,
        "tracking": 0,
        "family": "mono"
      },
      "mono-output": {
        "size": 12.5,
        "weight": 400,
        "line": 1.8,
        "tracking": 0,
        "family": "mono"
      },
      "mono-install": {
        "size": 11,
        "weight": 400,
        "line": 1.6364,
        "tracking": 0,
        "family": "mono"
      }
    }
  },
  "spacing": {
    "hair": 1,
    "xxs": 4,
    "xs": 8,
    "sm": 12,
    "base": 16,
    "md": 20,
    "lg": 24,
    "xl": 32,
    "xxl": 48,
    "section": 64,
    "section-lg": 72
  },
  "rounded": {
    "none": 0,
    "xs": 4,
    "sm": 5,
    "md": 6,
    "lg": 8,
    "xl": 12,
    "pill": 61,
    "full": 9999
  },
  "elevation": {
    "flat": "none",
    "hairline": "0 0 0 1px var(--pk-color-border-faint)",
    "card": "0 0 0 1px var(--pk-color-border-subtle)",
    "window": "0 0 0 0.5px rgba(0,0,0,0.15), 0 6px 20px 4px rgba(0,0,0,0.15)",
    "floating": "0 8px 32px rgba(0,0,0,0.18)"
  },
  "motion": {
    "duration-instant": "100ms",
    "duration-fast": "150ms",
    "duration-normal": "300ms",
    "duration-slow": "800ms",
    "ease-chrome": "cubic-bezier(0.215, 0.61, 0.355, 1)",
    "ease-panel": "cubic-bezier(0.23, 1, 0.32, 1)",
    "ease-reveal": "cubic-bezier(0.165, 0.84, 0.44, 1)",
    "ease-overshoot": "cubic-bezier(0.34, 1.56, 0.64, 1)"
  },
  "layout": {
    "nav": 1120,
    "column": 640,
    "hero": 800,
    "band-window": 1040,
    "breakpoint-desktop": 848,
    "breakpoint-mobile": 768,
    "breakpoint-tight": 640
  }
} as const;

export type Design = typeof design;
