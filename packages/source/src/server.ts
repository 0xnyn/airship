/**
 * @airship/source/server — server-side source resolution. When the browser already
 * resolved a file/line (via element-source), we just attach surrounding code
 * context. Otherwise we fall back to a scored text search across project source
 * files (ported/cleaned from layrr's source-mapper).
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ElementContext, SourceLocation } from "@airship/protocol";
import { readCapped, walkFiles } from "./walk";

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

export function resolveServerSource(
  cwd: string,
  input: ResolveInput
): SourceLocation | null {
  if (input.source?.file && typeof input.source.line === "number") {
    const abs = resolveExistingSource(cwd, input.source.file);
    // Normalize to a project-relative path so the agent gets a path it can
    // open; fall back to the reported path if we can't locate the file.
    const file = abs ? relative(cwd, abs) : input.source.file;
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
 */
function resolveExistingSource(cwd: string, file: string): string | null {
  const direct = resolve(cwd, file);
  if (existsSync(direct)) {
    return direct;
  }
  if (file.startsWith("/")) {
    const stripped = resolve(cwd, file.replace(LEADING_SLASHES, ""));
    if (existsSync(stripped)) {
      return stripped;
    }
  }
  return null;
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
    file: relative(cwd, best.file),
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
