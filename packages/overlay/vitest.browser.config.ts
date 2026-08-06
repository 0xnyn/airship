import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/*
 * The browser tier: every story, run as a test, in real Chromium.
 *
 * ## Why this is a second file rather than a `projects` array
 *
 * The obvious shape is one `vitest.config.ts` with two projects — happy-dom for
 * the unit tests, a browser project for the stories. It is the wrong shape here
 * for a reason outside vitest entirely: `.husky/pre-commit` runs `pnpm test`,
 * which reaches `vitest run` with no project filter, which would run *both*.
 * Every commit would launch Chromium, and on a machine that has not downloaded
 * it the hook would fail and block the commit. This repo has no CI — `make
 * check` is documented in the Makefile as "what CI should run" — so that hook is
 * the only gate there is, and making it depend on a browser download is a bad
 * trade for a catalogue.
 *
 * Separate file, separate script, separate turbo task, not wired into `test`.
 * `make test-browser` opts in; `make browsers` fetches the browser.
 *
 * ## What it adds that the unit suite cannot
 *
 * `vitest.config.ts`'s own docstring, and `inspector/test-support.ts`'s, both
 * list what happy-dom cannot do: no layout, no native CSS nesting, `@layer`
 * dropped entirely, no `CSSStyleDeclaration` iterator. Those are the four things
 * the inspector reads. Here they are real — which makes this the complement to
 * the unit suite rather than a second copy of it.
 *
 * Every story becomes a smoke test that it renders without throwing, every
 * `play` function becomes an interaction test, and the `a11y` parameter in
 * `preview.ts` makes an axe violation fail the run rather than merely appear in
 * a panel.
 *
 * ## What is deliberately absent
 *
 * No `test.include`: `main.ts`'s `stories` glob is the single index, and passing
 * one here is ignored with a warning. No `setupFiles` either — since Storybook
 * 10.3 the plugin applies `preview.ts`'s annotations itself, and a hand-rolled
 * `setProjectAnnotations` now conflicts with that rather than enabling it. The
 * risk that setup file was guarding against — stories running *without* the
 * decorator, rendering unstyled, and passing anyway — is covered instead by the
 * `play` assertions on `Foundations/Tokens`, which check the token scope and the
 * fonts from inside the run.
 */
export default defineConfig({
  plugins: [storybookTest({ configDir: ".storybook" })],
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
  },
});
