// Generates src/generated/design.ts from the canonical DESIGN.md front-matter.
// DESIGN.md (this package's root) is the single source of truth; this keeps the
// TypeScript token objects in lock-step with it. Run automatically before every
// build.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const designPath = resolve(here, "../DESIGN.md");
const outPath = resolve(here, "../src/generated/design.ts");

if (!existsSync(designPath)) {
  throw new Error(`gen: cannot find canonical spec at ${designPath}`);
}

const raw = readFileSync(designPath, "utf8");
// \r? because a Windows checkout with core.autocrlf=true hands us CRLF, and a
// front-matter block that opens `---\r\n` would otherwise read as absent.
const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!match) {
  throw new Error("gen: DESIGN.md is missing its YAML front-matter block");
}

const front = parse(match[1]);
const tokens = front?.tokens;
if (!tokens) {
  throw new Error("gen: DESIGN.md front-matter has no `tokens:` section");
}

const banner =
  "// AUTO-GENERATED from packages/site-tokens/DESIGN.md front-matter by scripts/gen.mjs.\n" +
  "// Do not edit by hand — edit DESIGN.md and run `pnpm --filter @airship/site-tokens gen`.\n\n";

const body = `${banner}export const design = ${JSON.stringify(
  tokens,
  null,
  2
)} as const;\n\nexport type Design = typeof design;\n`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body);

console.log(`gen: wrote ${outPath}`);
