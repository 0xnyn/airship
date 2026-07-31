import { defineConfig } from "vitest/config";

/*
 * A DOM for the tests that need one.
 *
 * The overlay is hand-rolled DOM from top to bottom — `createNumField`,
 * `ChangeSet`'s previews, `History`'s replays — and until now none of it was
 * reachable from a test, because the package ran vitest on its Node default and
 * the first `document` reference threw. That is why the field that silently
 * rewrote `50%` to `50px` on blur shipped: there was nowhere to write the test
 * that would have caught it.
 *
 * `happy-dom` rather than `jsdom` for speed, and because nothing here needs
 * layout — the modules that measure (`getBoundingClientRect`, resolved
 * `getComputedStyle`) go through `realm.ts` and are stubbed per test rather than
 * simulated.
 *
 * The pure modules (`css-length`, `css-value`, `cascade`, `gradient`, the token
 * registry) do not care either way and keep running exactly as before.
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
  },
});
