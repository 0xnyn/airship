/**
 * @airship/source/tokens — the project's design tokens, read from the CSS on
 * disk.
 *
 * This is the half of token discovery that only a daemon can do. An in-page
 * overlay can read `document.styleSheets`, but by then Tailwind has been
 * compiled, `@theme` has become `:root`, and every authored name is gone. Here
 * we read what the author actually wrote — including the file and line it lives
 * on, which is what lets the agent go and edit the scale itself rather than
 * guessing at a value.
 *
 * The runtime scan in the overlay stays worth doing: it catches CSS-in-JS and
 * anything injected after build, which never touches a file we can see. The two
 * are merged client-side, with these entries winning.
 *
 * Deliberately a text scan, not a real CSS parse. Pulling in postcss to find
 * `--foo: 4px` would be a dependency, a build step and a class of version
 * conflicts, in exchange for precision this does not need: a token declaration
 * that a brace-matching scan gets wrong is a token we simply do not offer.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type CssFramework,
  categorizeToken,
  categoryForProperty,
  type DesignToken,
  isInternalToken,
  isTokenizableValue,
  type TokenScanResult,
} from "@airship/protocol/tokens";
import { readCapped, walkFiles } from "./walk";

const CSS_EXT: ReadonlySet<string> = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".pcss",
  ".postcss",
]);

/**
 * Like the shared {@link IGNORE_DIRS}, but **without `dist` and `build`**.
 *
 * This looks wrong and is not. A design-token package's whole job is to emit
 * CSS custom properties, and it emits them to `dist` — that is the artifact its
 * consumers import. Skipping `dist` here means finding `--radius-md:
 * var(--pk-radius-md)` in the app and never finding what `--pk-radius-md` is,
 * which is precisely the case in this repo's own example app.
 *
 * What we do *not* want from `dist` is bundler output: a compiled Tailwind
 * sheet is tens of thousands of post-purge rules with no authored names in it,
 * which is the exact low-quality data the static scan exists to beat. That is
 * filtered by name instead — see {@link isBuildArtifact}.
 */
const TOKEN_IGNORE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
]);

/** `styles-DSZLOMh8.css` — a bundler content hash, so: build output. */
const CONTENT_HASHED = /-[A-Za-z0-9_-]{8,}\.\w+$/;

function isBuildArtifact(name: string): boolean {
  return CONTENT_HASHED.test(name) || name.includes(".min.");
}

/**
 * The editor's own chrome packages, by exact name.
 *
 * These emit the `--ap-*` palette and the icon set the inspector itself is drawn
 * with. The scan starts at the *workspace* root — deliberately, because a
 * design-token package is usually a sibling of the app rather than inside it —
 * which in this repo means walking straight into them: 93 of the 144 colour
 * tokens `apps/web` was offered came from `packages/editor-tokens/dist`, a
 * stylesheet that app does not load, and applying one wrote a `var()` the page
 * could not resolve.
 *
 * Deliberately an exact-name list and **not** "anything scoped `@airship/`".
 * That broader rule was tried first and excluded `@airship/web` — the app being
 * edited — taking every one of its real tokens with it. Nothing about being
 * scope-mates makes a package the editor's chrome; only these three are.
 * `@airship/site-tokens` is absent on purpose: `--pk-*` is the demo site's own
 * design system and exactly what the picker should offer.
 */
const OWN_CHROME_PACKAGES: ReadonlySet<string> = new Set([
  "@airship/editor-icons",
  "@airship/editor-tokens",
  "@airship/overlay",
]);

/**
 * Does this file belong to one of the editor's own chrome packages?
 *
 * `--ap-` is also on {@link INTERNAL_TOKEN_PREFIXES}, which catches those
 * packages' custom properties. This catches everything else they declare —
 * utility classes, and any token one day renamed off the prefix — and it works
 * wherever airship is installed from, because it asks the package who it is
 * rather than matching a path.
 *
 * Memoised per directory: candidate files cluster into a handful of them, and
 * the alternative is a `package.json` read per file.
 */
function ownedByEditor(file: string, owned: Map<string, boolean>): boolean {
  let dir = dirname(file);
  const seen: string[] = [];
  for (;;) {
    const known = owned.get(dir);
    if (known !== undefined) {
      for (const d of seen) {
        owned.set(d, known);
      }
      return known;
    }
    seen.push(dir);
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      let isOurs = false;
      try {
        const name: unknown = JSON.parse(readFileSync(manifest, "utf8")).name;
        isOurs = typeof name === "string" && OWN_CHROME_PACKAGES.has(name);
      } catch {
        // An unreadable or malformed manifest says nothing about ownership.
      }
      for (const d of seen) {
        owned.set(d, isOurs);
      }
      return isOurs;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const d of seen) {
        owned.set(d, false);
      }
      return false;
    }
    dir = parent;
  }
}

/** Tailwind's config, in the forms it actually ships as. */
const TAILWIND_CONFIGS = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

// ---------------------------------------------------------------------------
// Regexes (top-level: building these per file, per rule would be the hot path)
// ---------------------------------------------------------------------------

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** Innermost rule blocks only — the body pattern excludes braces, so a nested
 * `@media { .a { … } }` yields the `.a` rule rather than the wrapper. */
const RULE = /([^{}]*)\{([^{}]*)\}/g;
const DECLARATION = /([\w-]+)\s*:\s*([^;]+)/g;
const CUSTOM_PROPERTY = /^--[\w-]+$/;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;
/** A value that is *only* a var reference — an alias, not a derivation. */
const EXACT_VAR = /^var\(\s*(--[\w-]+)\s*\)$/;
/** A single class selector and nothing else: `.p-4`, not `.a .b` or `.a:hover`. */
const SIMPLE_CLASS = /^\.(-?[_a-zA-Z][\w-]*)$/;
const TAILWIND_MARKER = /@tailwind\b|@import\s+["']tailwindcss/;
const NEWLINE = /\n/g;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Bypass the cache. Used by the overlay's explicit re-scan request. */
  refresh?: boolean;
}

interface CacheEntry {
  result: TokenScanResult;
  scannedAt: number;
}
const cache = new Map<string, CacheEntry>();
/** How long a scan stands before a `refresh`-less request re-walks the tree. */
const CACHE_TTL_MS = 30_000;

/**
 * Every design token declared in the project's CSS.
 *
 * Cached per `cwd`: this walks the whole tree, and it is called on every socket
 * connection and every edit turn. The TTL rather than an mtime watch is
 * deliberate — a watcher over an arbitrary project tree is a resource leak and a
 * portability problem, and a token scale that is 30 seconds stale has never
 * mattered to anyone.
 */
export function scanProjectTokens(
  cwd: string,
  options: ScanOptions = {}
): TokenScanResult {
  const hit = cache.get(cwd);
  if (!options.refresh && hit && Date.now() - hit.scannedAt < CACHE_TTL_MS) {
    return hit.result;
  }
  const result = scanUncached(cwd);
  cache.set(cwd, { result, scannedAt: Date.now() });
  return result;
}

/** Files that mark the top of a project or workspace. */
const ROOT_MARKERS = [
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "lerna.json",
  ".git",
];

/** How far up to look before giving up and scanning from `cwd`. */
const MAX_ROOT_DEPTH = 6;

/**
 * Where to start the token scan.
 *
 * **Not `cwd`.** `--cwd` is the directory the *dev server* treats as its root —
 * `apps/web` in a monorepo — and a design-token package is almost always a
 * sibling of that, under `packages/`. Scanning from `cwd` finds the app's
 * `@theme { --radius-md: var(--pk-radius-md) }` and never finds what
 * `--pk-radius-md` is, which is exactly what happens in this repo's own example.
 *
 * So walk up to the nearest workspace or repository root and scan from there.
 * The walk is capped and stops at the *first* marker found, which keeps a nested
 * workspace (the examples in this repo are each their own) from escalating all
 * the way to the outer repository and scanning something unrelated.
 */
export function tokenScanRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (let depth = 0; depth < MAX_ROOT_DEPTH; depth += 1) {
    if (ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return cwd;
}

/** Drop the cache. Exported for tests and for a daemon-side file watcher. */
export function invalidateTokenCache(cwd?: string): void {
  if (cwd === undefined) {
    cache.clear();
    return;
  }
  cache.delete(cwd);
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

interface RawCustomProperty {
  file: string;
  line: number;
  name: string;
  value: string;
}

function scanUncached(cwd: string): TokenScanResult {
  const files = walkFiles(tokenScanRoot(cwd), {
    extensions: CSS_EXT,
    ignoreDirs: TOKEN_IGNORE_DIRS,
    reject: isBuildArtifact,
  });
  const customProperties = new Map<string, RawCustomProperty>();
  const utilities: DesignToken[] = [];
  /** `--name` → the CSS properties it is used on. The best category signal. */
  const usage = new Map<string, Set<string>>();
  let sawTailwindMarker = false;

  const root = tokenScanRoot(cwd);
  const ownership = new Map<string, boolean>();
  for (const file of files) {
    if (ownedByEditor(file, ownership)) {
      continue;
    }
    const raw = readCapped(file);
    if (raw === null) {
      continue;
    }
    if (TAILWIND_MARKER.test(raw)) {
      sawTailwindMarker = true;
    }
    const text = stripComments(raw);
    const lines = lineIndex(text);
    // Relative to the scan root, which is what the agent's own cwd-relative
    // paths are resolved against.
    const rel = relative(root, file) || file;
    scanFile(text, lines, rel, { customProperties, usage, utilities });
  }

  const tokens: DesignToken[] = [];
  for (const prop of customProperties.values()) {
    if (isInternalToken(prop.name)) {
      sawTailwindMarker = sawTailwindMarker || prop.name.startsWith("--tw-");
      continue;
    }
    const value = resolveValue(prop.value, customProperties);
    const category = categorizeToken({
      name: prop.name,
      usedOn: usage.get(prop.name),
      value,
    });
    if (!category) {
      continue;
    }
    tokens.push({
      aliasOf: aliasTarget(prop.value, customProperties),
      category,
      file: prop.file,
      kind: "css-var",
      line: prop.line,
      name: prop.name,
      origin: "static",
      values: { "": value },
    });
  }
  tokens.push(...utilities);

  return {
    framework: detectFramework(cwd, sawTailwindMarker, utilities.length),
    tokens,
  };
}

interface Sink {
  customProperties: Map<string, RawCustomProperty>;
  usage: Map<string, Set<string>>;
  utilities: DesignToken[];
}

function scanFile(
  text: string,
  lines: number[],
  file: string,
  sink: Sink
): void {
  RULE.lastIndex = 0;
  let rule: RegExpExecArray | null = RULE.exec(text);
  while (rule !== null) {
    const [, rawSelector, body] = rule;
    const selector = rawSelector.trim();
    const bodyOffset = rule.index + rawSelector.length + 1;
    collectDeclarations(body, bodyOffset, lines, file, selector, sink);
    rule = RULE.exec(text);
  }
}

function collectDeclarations(
  body: string,
  bodyOffset: number,
  lines: number[],
  file: string,
  selector: string,
  sink: Sink
): void {
  const simpleClass = SIMPLE_CLASS.exec(selector);
  const declarations: { property: string; value: string }[] = [];

  DECLARATION.lastIndex = 0;
  let decl: RegExpExecArray | null = DECLARATION.exec(body);
  while (decl !== null) {
    const property = decl[1].trim();
    const value = decl[2].trim();
    declarations.push({ property, value });

    if (CUSTOM_PROPERTY.test(property)) {
      // First declaration wins. A token redefined in a dark-theme block is the
      // same token; recording the override would list it twice with two values.
      if (!sink.customProperties.has(property)) {
        sink.customProperties.set(property, {
          file,
          line: lineOf(lines, bodyOffset + decl.index),
          name: property,
          value,
        });
      }
    } else {
      // `color: var(--brand)` is the strongest possible evidence that
      // `--brand` is a colour — stronger than any name or value heuristic.
      recordUsage(sink.usage, property, value);
    }
    decl = DECLARATION.exec(body);
  }

  if (simpleClass && declarations.length === 1) {
    addUtility(
      sink.utilities,
      simpleClass[0],
      declarations[0],
      file,
      lines,
      bodyOffset
    );
  }
}

function recordUsage(
  usage: Map<string, Set<string>>,
  property: string,
  value: string
): void {
  if (!value.includes("var(")) {
    return;
  }
  VAR_REFERENCE.lastIndex = 0;
  let ref: RegExpExecArray | null = VAR_REFERENCE.exec(value);
  while (ref !== null) {
    const [, name] = ref;
    const set = usage.get(name);
    if (set) {
      set.add(property);
    } else {
      usage.set(name, new Set([property]));
    }
    ref = VAR_REFERENCE.exec(value);
  }
}

function addUtility(
  utilities: DesignToken[],
  selector: string,
  declaration: { property: string; value: string },
  file: string,
  lines: number[],
  bodyOffset: number
): void {
  const category = categoryForProperty(declaration.property);
  if (!category) {
    return;
  }
  // `.h-auto { height: auto }` is a Tailwind utility, not a design token — see
  // `isTokenizableValue`.
  if (!isTokenizableValue(declaration.value)) {
    return;
  }
  utilities.push({
    category,
    file,
    kind: "utility-class",
    line: lineOf(lines, bodyOffset),
    name: selector,
    origin: "static",
    values: { [declaration.property]: declaration.value },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Follow `var(--a)` chains to a literal, so `--primary: var(--blue-500)` is
 * offered as the colour it actually resolves to.
 *
 * Depth-capped rather than cycle-tracked: the cap is what makes a mutually
 * recursive pair terminate, and no real token chain is more than a few deep.
 */
function resolveValue(
  value: string,
  properties: Map<string, RawCustomProperty>,
  depth = 0
): string {
  if (depth >= 8 || !value.includes("var(")) {
    return value.trim();
  }
  VAR_REFERENCE.lastIndex = 0;
  const match = VAR_REFERENCE.exec(value);
  if (!match) {
    return value.trim();
  }
  const [, referencedName] = match;
  const referenced = properties.get(referencedName);
  if (!referenced) {
    return value.trim();
  }
  return resolveValue(referenced.value, properties, depth + 1);
}

/**
 * The token this declaration is a pure alias of, if any.
 *
 * Only an *exact* `var(--other)` counts. `calc(var(--x) * 2)` and
 * `var(--x, 4px)` are derivations, not aliases, and collapsing them would lose
 * a real distinction.
 */
function aliasTarget(
  rawValue: string,
  properties: Map<string, RawCustomProperty>
): string | undefined {
  const exact = EXACT_VAR.exec(rawValue.trim());
  if (!exact) {
    return;
  }
  return properties.has(exact[1]) ? exact[1] : undefined;
}

/**
 * Replace comments with same-length whitespace rather than removing them, so
 * every later match index still points at the right line.
 */
function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, (comment) =>
    comment.replace(/[^\n]/g, " ")
  );
}

/** Offsets of every line start, for turning a match index into a line number. */
function lineIndex(text: string): number[] {
  const offsets = [0];
  NEWLINE.lastIndex = 0;
  let m: RegExpExecArray | null = NEWLINE.exec(text);
  while (m !== null) {
    offsets.push(m.index + 1);
    m = NEWLINE.exec(text);
  }
  return offsets;
}

/** 1-based line containing `offset`, by binary search over line starts. */
function lineOf(offsets: number[], offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}

function detectFramework(
  cwd: string,
  sawTailwindMarker: boolean,
  utilityCount: number
): CssFramework {
  if (
    sawTailwindMarker ||
    TAILWIND_CONFIGS.some((name) => existsSync(join(cwd, name)))
  ) {
    return "tailwind";
  }
  return utilityCount > 0 ? "custom" : "unknown";
}
