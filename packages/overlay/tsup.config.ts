import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: { hook: "src/hook.ts", overlay: "src/index.ts" },
  format: ["iife"],
  globalName: "AirshipOverlay",
  /*
   * Stories are never *bundled* — nothing reachable from the two entries above
   * imports one, exactly as with the colocated `.test.ts` files. But `dev` runs
   * `tsup --watch`, which watches the project directory rather than the module
   * graph, so without this every keystroke in a story rebuilt both IIFEs for
   * nothing. `make dev` runs that watcher alongside the site.
   */
  ignoreWatch: ["**/*.stories.ts", "**/src/stories/**"],
  minify: true,
  outExtension() {
    return { js: ".global.js" };
  },
  platform: "browser",
  sourcemap: true,
  target: "es2020",
});
