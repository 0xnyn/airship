// Removes build output for the package that invokes it.
//
// Why this exists: every workspace `clean` script used to be `rm -rf dist
// .turbo`, and `rm` does not exist on Windows. pnpm runs lifecycle scripts
// through the platform shell, so on Windows that is cmd.exe and all eleven of
// them died with "'rm' is not recognized". `turbo run clean` fans out to every
// package, so `pnpm clean` failed eleven times over.
//
// A shared script rather than a `rimraf` dependency: this needs no install to
// work, nothing to keep pinned against the release-age gate in
// pnpm-workspace.yaml, and no argument that has to survive two different
// shells' quoting rules. Node resolves forward slashes on Windows, so
// `node ../../scripts/clean.mjs dist .turbo` is literally the same string
// everywhere.
//
// Usage, from a package directory:  node ../../scripts/clean.mjs <path>...

import { rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const targets = process.argv.slice(2);

if (targets.length === 0) {
  process.stderr.write("clean: nothing to remove (pass one or more paths)\n");
  process.exit(1);
}

const cwd = process.cwd();

for (const target of targets) {
  // This deletes recursively and by force, so it refuses anything that is not
  // strictly inside the calling package. A typo in a package.json should not be
  // able to reach the workspace root.
  const abs = resolve(cwd, target);
  const rel = relative(cwd, abs);
  if (isAbsolute(target) || rel === "" || rel.startsWith(`..${sep}`)) {
    process.stderr.write(
      `clean: refusing to remove "${target}" — it escapes ${cwd}\n`
    );
    process.exit(1);
  }
  rmSync(abs, { force: true, recursive: true });
}
