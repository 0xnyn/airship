/**
 * Shared project-tree walking, used by both server-side consumers: the source
 * resolver (`server.ts`, looking for JSX) and the token scanner (`tokens.ts`,
 * looking for CSS).
 *
 * Extracted rather than copied because the two must agree on what "the project"
 * means. A `node_modules` that one skips and the other descends into is not a
 * style difference — it is a scan that walks a hundred thousand files and a
 * daemon that appears to hang on startup.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const IGNORE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
]);

/** Ceiling on how many files one walk will collect. */
export const MAX_FILES = 4000;
/** Files bigger than this are generated or vendored; scanning them is waste. */
export const MAX_FILE_BYTES = 256 * 1024;

export function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

export function isMinified(name: string): boolean {
  return name.includes(".min.") || name.endsWith(".bundle.js");
}

export interface WalkOptions {
  /** Extensions to collect, with the leading dot (`.css`). */
  extensions: ReadonlySet<string>;
  /** Override the directories to skip. Defaults to {@link IGNORE_DIRS}. */
  ignoreDirs?: ReadonlySet<string>;
  maxFiles?: number;
  /** Reject a file by name after it passes the extension filter. */
  reject?: (name: string) => boolean;
}

/**
 * Every matching file under `root`, skipping hidden entries, known build and
 * vendor directories, and minified bundles. Depth-first and bounded.
 */
export function walkFiles(root: string, options: WalkOptions): string[] {
  const acc: string[] = [];
  walkInto(root, acc, {
    extensions: options.extensions,
    ignoreDirs: options.ignoreDirs ?? IGNORE_DIRS,
    maxFiles: options.maxFiles ?? MAX_FILES,
    reject: options.reject ?? isMinified,
  });
  return acc;
}

type ResolvedWalk = Required<Omit<WalkOptions, "maxFiles">> & {
  maxFiles: number;
};

function walkInto(dir: string, acc: string[], opts: ResolvedWalk): void {
  if (acc.length >= opts.maxFiles) {
    return;
  }
  for (const entry of safeReaddir(dir)) {
    if (acc.length >= opts.maxFiles) {
      return;
    }
    if (entry.name.startsWith(".") || opts.ignoreDirs.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkInto(full, acc, opts);
    } else if (
      opts.extensions.has(extOf(entry.name)) &&
      !opts.reject(entry.name)
    ) {
      acc.push(full);
    }
  }
}

/** File contents, or null if unreadable or too big to be worth scanning. */
export function readCapped(
  file: string,
  maxBytes = MAX_FILE_BYTES
): string | null {
  try {
    const buf = readFileSync(file);
    return buf.byteLength > maxBytes ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}
