// Generates apps/cli/README.md from the root README.md.
//
// Why this exists: npm renders a package's README from the PACKAGE directory,
// and apps/cli has never had one — so @airshiplabs/cli's npm page reads "This
// package does not have a README" while a 400-line one sits at the repo root.
// pnpm copies the root LICENSE into a workspace package that lacks one; it does
// not do the same for README, and `files: ["dist"]` does not reach up either.
//
// Copying it verbatim is not enough. npm resolves relative links against
// `repository.directory` (apps/cli), where media/cover.png does not exist — so
// every screenshot would 404 on npmjs.com. This rewrites them to absolute
// GitHub URLs: raw.githubusercontent for images (the blob view serves HTML, not
// an image) and blob for everything else. In-page anchors are left alone; npm's
// renderer generates the same heading slugs.
//
//   node scripts/sync-readme.mjs            # write apps/cli/README.md
//   node scripts/sync-readme.mjs --check    # exit 1 if it is stale
//
// The generated file is committed, like apps/web/src/routeTree.gen.ts, and
// checks.yml runs --check on every PR. Root README.md is the only copy anyone
// edits.

import { readFileSync, writeFileSync } from "node:fs";

// Two passes, because a badge is an image nested inside a link and one regex
// that handles both is ambiguous enough to backtrack badly. BADGE_LINK runs
// first and rewrites the OUTER target; LINK then sweeps everything else,
// including the image still sitting inside it.
/** `[![alt](image)](target)` — a badge. Captures the whole image, then target. */
const BADGE_LINK = /\[(!\[[^\]]*\]\([^)\s]+\))\]\(([^)\s]+)\)/g;
/** Markdown inline link or image — the leading `!` is what tells them apart. */
const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
/** ``` or ~~~ opening or closing a fenced block, which is never rewritten. */
const FENCE = /^\s*(?:```|~~~)/;
/** A scheme, a protocol-relative host, or an anchor — already resolvable. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const LEADING_DOT_SLASH = /^\.\//;
const REPO_URL = /github\.com[/:]([^/]+)\/([^/.]+)/;

// Both generated forms point at a branch rather than the release tag. A tag
// would be immutable, but it would change this file on every release and the
// drift check would then fight the release.
const REF = "main";

const ROOT = new URL("../README.md", import.meta.url);
const OUT = new URL("../apps/cli/README.md", import.meta.url);
const PKG = new URL("../apps/cli/package.json", import.meta.url);

const BANNER =
  "<!-- Generated from the root README.md by scripts/sync-readme.mjs. Do not edit. -->";

function die(message) {
  process.stderr.write(`sync-readme: ${message}\n`);
  process.exit(1);
}

/** owner/repo from apps/cli's `repository.url`, so a fork needs no edit here. */
function repoSlug() {
  const url = JSON.parse(readFileSync(PKG, "utf8")).repository?.url;
  const match = url?.match(REPO_URL);
  if (!match) {
    die(`could not read a github owner/repo out of repository.url ("${url}")`);
  }
  return `${match[1]}/${match[2]}`;
}

function absolutize(target, isImage, slug) {
  const path = target.replace(LEADING_DOT_SLASH, "");
  return isImage
    ? `https://raw.githubusercontent.com/${slug}/${REF}/${path}`
    : `https://github.com/${slug}/blob/${REF}/${path}`;
}

/** Returns the rewritten markdown and how many targets it touched. */
function render(source, slug) {
  const out = [];
  let rewritten = 0;
  let inFence = false;

  const rewriteLine = (line) =>
    line
      .replace(BADGE_LINK, (whole, image, target) => {
        if (ABSOLUTE.test(target)) {
          return whole;
        }
        rewritten += 1;
        return `[${image}](${absolutize(target, false, slug)})`;
      })
      .replace(LINK, (whole, bang, label, target) => {
        if (ABSOLUTE.test(target)) {
          return whole;
        }
        rewritten += 1;
        return `${bang}[${label}](${absolutize(target, bang === "!", slug)})`;
      });

  for (const line of source.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    out.push(inFence ? line : rewriteLine(line));
  }

  return { rewritten, text: `${BANNER}\n\n${out.join("\n")}` };
}

const { rewritten, text } = render(readFileSync(ROOT, "utf8"), repoSlug());

if (process.argv.includes("--check")) {
  let current = null;
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    die("apps/cli/README.md is missing — run `node scripts/sync-readme.mjs`");
  }
  if (current !== text) {
    die(
      "apps/cli/README.md is stale — run `node scripts/sync-readme.mjs` and commit the result"
    );
  }
  process.stdout.write("apps/cli/README.md is up to date\n");
  process.exit(0);
}

writeFileSync(OUT, text);
process.stdout.write(
  `wrote apps/cli/README.md — ${rewritten} links rewritten, ${text.length} bytes\n`
);
