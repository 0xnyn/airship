/**
 * @airship/source/server — server-side source resolution. When the browser already
 * resolved a file/line (via element-source), we just attach surrounding code
 * context. Otherwise we fall back to a scored text search across project source
 * files (ported/cleaned from layrr's source-mapper).
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ElementContext, SourceLocation } from "@airship/protocol";
import { readCapped, toPosix, walkFiles } from "./walk";

export interface ResolveInput {
  element?: ElementContext;
  source?: SourceLocation | null;
}

const SOURCE_EXT = new Set([
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
]);
const CONTEXT_BEFORE = 5;
const CONTEXT_AFTER = 6;
// Stop early once a candidate is strong enough (exact text + good file kind).
const GOOD_ENOUGH_SCORE = 13;

const LEADING_SLASHES = /^\/+/;
/** Route-ish and component-ish directories, on either path separator. */
const ROUTE_DIR = /[\\/](pages|app|routes)[\\/]/;
const COMPONENT_DIR = /[\\/]components?[\\/]/;
/** Vite serves files outside its root under `/@fs/<abs path>`. */
const VITE_FS_PREFIX = /^\/@fs\/(.*)$/;
/** `C:` — a path already rooted at a Windows drive. */
const WIN32_DRIVE = /^[a-zA-Z]:/;
const WIN32 = process.platform === "win32";

export function resolveServerSource(
  cwd: string,
  input: ResolveInput
): SourceLocation | null {
  if (input.source?.file && typeof input.source.line === "number") {
    const abs = resolveExistingSource(cwd, input.source.file);
    // Normalize to a project-relative path so the agent gets a path it can
    // open; fall back to the reported path if we can't locate the file.
    // Forward slashes on the way out — this string is rendered into the prompt
    // and into the JSON the MCP tool returns, where a Windows separator arrives
    // doubled, and the overlay uses it as a display label.
    const file = abs ? toPosix(relative(cwd, abs)) : input.source.file;
    const context = abs ? readContext(abs, input.source.line) : undefined;
    return { ...input.source, context: context ?? input.source.context, file };
  }
  if (input.element) {
    return searchByElement(cwd, input.element);
  }
  return null;
}

/**
 * Dev servers report root-relative URLs like `/src/App.tsx`; `resolve(cwd, …)`
 * would treat the leading slash as absolute and miss the file. Try the reported
 * path first, then a cwd-relative form. Returns the absolute path that exists,
 * or null.
 *
 * The ordering flips on Windows, and it matters. There `resolve(cwd, "/src/
 * App.tsx")` does not fail — it resolves against cwd's *drive*, yielding
 * `C:\src\App.tsx`. `C:\src` is an ordinary directory that may well exist, and
 * if it does the wrong file is read, handed to the agent as context, and opened
 * in the editor. On Windows a leading slash with no drive letter is never an
 * absolute path, so the project-relative reading is the only correct one.
 */
function resolveExistingSource(cwd: string, file: string): string | null {
  const rooted = viteFsPath(file);
  if (rooted) {
    return existsSync(rooted) ? rooted : null;
  }
  const urlPath = file.startsWith("/");
  if (urlPath) {
    const stripped = resolve(cwd, file.replace(LEADING_SLASHES, ""));
    if (existsSync(stripped)) {
      return stripped;
    }
    if (WIN32) {
      return null;
    }
  }
  const direct = resolve(cwd, file);
  return existsSync(direct) ? direct : null;
}

/**
 * The absolute path behind a `/@fs/` URL, or null if this is not one.
 *
 * Vite serves anything outside its root this way. Without handling it here the
 * whole `/@fs/…` string fell through as an unresolvable path and went to the
 * agent verbatim — and on Windows `/@fs/C:/Users/…` would resolve to
 * `C:\C:\Users\…`, which cannot exist.
 */
function viteFsPath(file: string): string | null {
  const match = file.match(VITE_FS_PREFIX);
  if (!match?.[1]) {
    return null;
  }
  // POSIX needs back the slash the capture dropped; a Windows path already
  // starts with its drive and must not be given one.
  return WIN32_DRIVE.test(match[1]) ? match[1] : `/${match[1]}`;
}

function readContext(absPath: string, line: number): string | undefined {
  if (!existsSync(absPath)) {
    return;
  }
  try {
    const lines = readFileSync(absPath, "utf8").split("\n");
    const start = Math.max(0, line - 1 - CONTEXT_BEFORE);
    const end = Math.min(lines.length, line + CONTEXT_AFTER);
    return lines.slice(start, end).join("\n");
  } catch {
    // Unreadable file — context is a nicety, so drop it rather than fail.
  }
}

/**
 * Heuristic search: prefer files whose content contains the element's text and
 * classes, lightly weighting by file kind (pages/components over generic utils).
 */
/** What a candidate line is worth, before the file-kind bonus. */
interface Needles {
  classes: string[];
  tagOpen: string;
  text: string;
}

function scoreLine(line: string, needles: Needles): number {
  let score = 0;
  if (needles.text && line.includes(needles.text)) {
    score += 10;
  }
  for (const cls of needles.classes) {
    if (line.includes(cls)) {
      score += 3;
    }
  }
  if (line.includes(needles.tagOpen)) {
    score += 1;
  }
  return score;
}

type Candidate = { file: string; line: number; score: number } | null;

/** The best-scoring line in one file, or `best` unchanged if nothing beats it. */
function bestInFile(
  file: string,
  content: string,
  needles: Needles,
  best: Candidate
): Candidate {
  const bonus = kindBonus(file);
  let winner = best;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const score = scoreLine(lines[i] ?? "", needles);
    if (score > 0 && (!winner || score + bonus > winner.score)) {
      winner = { file, line: i + 1, score: score + bonus };
    }
  }
  return winner;
}

function searchByElement(
  cwd: string,
  element: ElementContext
): SourceLocation | null {
  const files = walkFiles(cwd, { extensions: SOURCE_EXT });
  const needles: Needles = {
    classes: element.classes.filter((c) => c.length > 2),
    tagOpen: `<${element.tagName}`,
    text: element.textPreview.trim(),
  };

  let best: Candidate = null;
  for (const file of files) {
    const content = readCapped(file);
    if (content !== null) {
      best = bestInFile(file, content, needles, best);
    }
    if (best && best.score >= GOOD_ENOUGH_SCORE) {
      break;
    }
  }

  if (!best) {
    return null;
  }
  return {
    context: readContext(best.file, best.line),
    file: toPosix(relative(cwd, best.file)),
    line: best.line,
  };
}

function kindBonus(file: string): number {
  if (ROUTE_DIR.test(file)) {
    return 3;
  }
  if (COMPONENT_DIR.test(file)) {
    return 2;
  }
  if (
    file.endsWith(".vue") ||
    file.endsWith(".svelte") ||
    file.endsWith(".astro")
  ) {
    return 2;
  }
  return 0;
}
