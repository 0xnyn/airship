// Post-build: emit dist/tokens.css from the built token source, copy the
// @font-face stylesheet, and self-host the woff2 assets by copying them out of
// the @fontsource packages. Mirrors the examples' token pipeline but keeps the
// editor's fonts fully independent (same family set) so the editor package is
// self-contained.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const dist = join(pkgRoot, "dist");
const fontsOut = join(dist, "fonts");
const require = createRequire(import.meta.url);

mkdirSync(fontsOut, { recursive: true });

const log = (m) => {
  console.log(`postbuild: ${m}`);
};

// 1. tokens.css — generated from the compiled token module.
const { css } = await import(pathToFileURL(join(dist, "index.js")).href);
writeFileSync(join(dist, "tokens.css"), css);
log("wrote dist/tokens.css");

// 2. fonts.css — authored @font-face rules, copied verbatim.
copyFileSync(join(pkgRoot, "src", "fonts.css"), join(dist, "fonts.css"));
log("wrote dist/fonts.css");

// 3. Self-host the actual font binaries from @fontsource.
function filesDir(pkg) {
  return join(dirname(require.resolve(`${pkg}/package.json`)), "files");
}
function pick(dir, re) {
  return readdirSync(dir).find((f) => re.test(f));
}
function copyFont(pkg, re, dest) {
  try {
    const dir = filesDir(pkg);
    const file = pick(dir, re);
    if (!file) {
      throw new Error(`no file matching ${re} in ${dir}`);
    }
    cpSync(join(dir, file), join(fontsOut, dest));
    log(`bundled ${dest} (from ${pkg})`);
    return true;
  } catch (err) {
    log(`WARN could not self-host ${dest}: ${err.message}`);
    log("      → the font stack will fall back to system fonts at runtime.");
    return false;
  }
}

copyFont(
  "@fontsource-variable/inter",
  /^inter-latin-wght-normal\.woff2$/,
  "inter-variable.woff2"
);
copyFont(
  "@fontsource/jetbrains-mono",
  /^jetbrains-mono-latin-400-normal\.woff2$/,
  "jetbrains-mono-400.woff2"
);
copyFont(
  "@fontsource/jetbrains-mono",
  /^jetbrains-mono-latin-700-normal\.woff2$/,
  "jetbrains-mono-700.woff2"
);

if (!existsSync(join(fontsOut, "inter-variable.woff2"))) {
  log("NOTE no self-hosted fonts present; relying on system fallback stack.");
}
