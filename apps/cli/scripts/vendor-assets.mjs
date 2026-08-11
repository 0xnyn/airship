// Copies the runtime assets the server serves but cannot import into the CLI's
// own dist/, so the published tarball is self-contained.
//
// Why this exists: packages/server/src/proxy.ts serves three things it resolves
// at runtime rather than importing — the overlay IIFE, the bippy hook IIFE, and
// the editor's woff2 fonts. They are assets, so no bundler can inline them.
//
// In this monorepo they resolve fine through node_modules. In a published
// install they do not exist at all: tsup inlines @airship/server into the CLI
// bundle, so proxy.ts's import.meta.url ends up pointing at the installed CLI's
// dist/, where no @airship/* package is on disk. dist/vendor/ is the copy that
// makes that case work. See the fallback in proxy.ts.
//
// Sources are resolved through the packages' own export maps rather than
// hardcoded ../../packages/… paths, so a layout change there fails loudly here
// instead of silently shipping a stale asset.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const vendorDir = join(distDir, "vendor");
const fontsDir = join(vendorDir, "fonts");

const FONTS = [
  "inter-variable.woff2",
  "jetbrains-mono-400.woff2",
  "jetbrains-mono-700.woff2",
];

function fail(what, cause) {
  console.error(`vendor-assets: could not resolve ${what}`);
  console.error(`  ${cause}`);
  console.error("  Build the workspace first: make build");
  process.exit(1);
}

function resolve(specifier, what) {
  try {
    return require.resolve(specifier);
  } catch (error) {
    fail(what, error.message);
  }
}

// Copies a file and, when present, the sourcemap sitting next to it. proxy.ts
// serves `${bundle}.map` derived from whatever path it resolved, so the map has
// to land beside its bundle here too.
function copyWithMap(from, toDir) {
  const name = basename(from);
  copyFileSync(from, join(toDir, name));
  if (existsSync(`${from}.map`)) {
    copyFileSync(`${from}.map`, join(toDir, `${name}.map`));
  }
}

if (!existsSync(distDir)) {
  fail(
    "dist/",
    "the CLI has not been built yet — tsup runs before this script"
  );
}

mkdirSync(fontsDir, { recursive: true });

copyWithMap(
  resolve("@airship/overlay/bundle", "the overlay bundle"),
  vendorDir
);
copyWithMap(resolve("@airship/overlay/hook", "the bippy hook"), vendorDir);

for (const font of FONTS) {
  const from = resolve(`@airship/editor-tokens/fonts/${font}`, `font ${font}`);
  copyFileSync(from, join(fontsDir, font));
}

// Belt and braces: a silently empty vendor/ is the exact failure this script
// exists to prevent, and it would only surface as a 404 in a published install.
const expected = ["overlay.global.js", "hook.global.js"];
for (const name of expected) {
  if (!existsSync(join(vendorDir, name))) {
    fail(name, `it was not written to ${vendorDir}`);
  }
}

console.log(
  `vendor-assets: ${expected.length} bundles + ${FONTS.length} fonts -> ${dirname(vendorDir)}/vendor`
);
