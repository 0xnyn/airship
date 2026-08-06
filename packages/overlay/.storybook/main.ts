import type { StorybookConfig } from "@storybook/html-vite";

/*
 * Storybook for the overlay.
 *
 * The HTML renderer, and not as a fallback — it is the exact shape this code
 * already has. Every seam in the overlay hands back an `HTMLElement`
 * (`ControlHandle.element`, `renderFill(ctx, node)`, `DesignPanel.element`,
 * `toolRow(item)`), which is precisely what an HTML story returns. A React
 * renderer would mean a wrapper around each one and React in the dependency
 * graph of a package that has deliberately never had it.
 *
 * What this buys that the test suite cannot: `vitest.config.ts` runs on
 * happy-dom, and its own docstring — plus `inspector/test-support.ts`'s — lists
 * what that costs. No layout, no native CSS nesting, `@layer` dropped entirely,
 * no `CSSStyleDeclaration` iterator. Those are the four things the inspector
 * reads. Here they are real, because this is a real browser.
 */
const config: StorybookConfig = {
  addons: [
    // axe on every story. The overlay hand-wires its ARIA — `role="group"` plus
    // a label on segmented groups, `aria-pressed` per cell, `aria-haspopup`
    // /`aria-expanded` on selects — and `inspector/a11y.test.ts` asserts a
    // sample of it. This checks the rest, on every story, for free.
    "@storybook/addon-a11y",
    /*
     * Opt-in since Storybook 9, and not optional here.
     *
     * The editor is dark-only chrome, and three of its border tokens are
     * `rgba(255,255,255,0.06…0.12)` — on Storybook's default white canvas they
     * are invisible, so a hairline that is missing looks exactly like a hairline
     * that is there. `preview.ts` defines the two grounds this repo has: the
     * editor surface, and the white page the docks float over.
     */
    "storybook/backgrounds",
    /*
     * The browser test tier — see `vitest.browser.config.ts`.
     *
     * Registered here so the runner and the UI agree on what a story is, but
     * deliberately *not* wired into `pnpm test`: that runs from
     * `.husky/pre-commit`, and a commit hook that launches Chromium fails on any
     * machine that has not downloaded it. `make test-browser` opts in.
     */
    "@storybook/addon-vitest",
  ],

  framework: { name: "@storybook/html-vite", options: {} },

  /*
   * The fonts, which the overlay cannot render honestly without.
   *
   * `styles/index.ts` declares `@font-face` against `/__airship/fonts/*.woff2`,
   * and in production only the proxy serves that path
   * (`packages/server/src/proxy.ts`). The files themselves are emitted by
   * `@airship/editor-tokens`' postbuild, so this mapping is why the `storybook`
   * turbo task depends on that package's `build` — Storybook errors at startup
   * on a missing `from`, rather than starting up and rendering everything in
   * fallback fonts. Failing loudly is the right trade: the dock is 11px type in
   * a 360px column, and it is a different piece of design in Helvetica.
   */
  staticDirs: [
    { from: "../../editor-tokens/dist/fonts", to: "/__airship/fonts" },
  ],

  stories: ["../src/**/*.stories.ts"],
};

export default config;
