import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8")
);

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  // Baked in at build time rather than read from package.json at runtime: the
  // bundle is a single file with no package.json beside it, and resolving one
  // relative to import.meta.url would break the moment it is moved or linked.
  define: { __AIRSHIP_VERSION__: JSON.stringify(pkg.version) },
  dts: false,
  entry: { index: "src/index.ts" },
  format: ["esm"],
  // Inline every workspace package so the published tarball declares no
  // @airship/* runtime dependency — none of them is published, so a consumer
  // resolving one would 404. They stay in devDependencies purely to build.
  //
  // Third-party deps stay external on purpose. The three agent SDKs have to:
  // each resolves a per-platform binary package at runtime (the reason
  // pnpm-workspace.yaml pins them all in minimumReleaseAgeExclude), and
  // bundling severs that resolution. The rest are left external because a
  // debuggable node_modules beats a marginally smaller bundle for a CLI.
  //
  // The overlay IIFEs and the editor fonts are NOT covered by this: they are
  // assets, resolved at runtime rather than imported. scripts/vendor-assets.mjs
  // copies them into dist/vendor/. See packages/server/src/proxy.ts.
  noExternal: [/^@airship\//],
  platform: "node",
  sourcemap: true,
  target: "node22",
});
