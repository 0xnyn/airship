/**
 * Turns a raw agent tool call + its result into the compact shape the chat
 * timeline renders: a mono header (`Read(src/app.ts)`), a whitelisted argument
 * map, and a one-line `⎿` summary with an optional capped detail body.
 *
 * The tool names switched on below started as Claude's and are now the *shared*
 * vocabulary across backends: the Codex adapter normalizes its own item types
 * into these names before calling in (`command_execution` → `Bash`,
 * `file_change` → `Edit`/`Write`/`Delete`, …). That keeps one copy of the
 * summarization and truncation rules, which are about what a build log or a
 * patch looks like rather than about who produced it. Nothing downstream sees
 * these names — the overlay renders `TimelineToolItem.title`, never `.name` —
 * so they are purely an internal dispatch key.
 *
 * This lives in core, not the overlay, for one decisive reason: only core sits
 * upstream of the wire. A `Read` result carries the entire file and a build's
 * `Bash` result carries hundreds of KB of stdout. Summarizing in the browser
 * would mean shipping all of that over the socket *and* persisting it into
 * `~/.airship/history/<jobId>.json` — which `readAll()` re-parses in full on
 * every history and thread request. Truncating at the source is the only place
 * that actually bounds the cost. It also keeps this parsing out of an IIFE
 * injected into someone else's page, and keeps SDK-shaped payloads behind the
 * package that already owns the SDK.
 *
 * The overlay is left with presentation only: glyph, colour, open/closed.
 */
import type { ToolResultSummary } from "@airship/protocol";

/** Hard ceiling for the one-line `⎿` text. */
const MAX_TEXT = 120;
/** Hard ceiling for an expanded detail body. */
const MAX_DETAIL_CHARS = 4000;
/** Tail lines kept from noisy streaming output (Bash). */
const MAX_TAIL_LINES = 40;
/** Head lines kept from listing-style output (Read, Grep, Glob). */
const MAX_HEAD_LINES = 20;
/** Head entries kept from match/path listings. */
const MAX_LIST_LINES = 15;
/** Longest single argument value we echo into the expanded body. */
const MAX_ARG_CHARS = 300;
/** Head lines kept from a fetch or search, which are prose rather than lists. */
const MAX_WEB_LINES = 10;
/** Either path separator — tool payloads come from whatever OS the agent ran on. */
const PATH_SEPARATOR = /[\\/]/;
const TRAILING_WHITESPACE = /\s+$/;
const RUN_OF_WHITESPACE = /\s+/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** `a/b/c/d.tsx` → `.../c/d.tsx`. Shared with `describeTool` in the runner. */
export function shortenPath(p: string): string {
  const parts = p.split(PATH_SEPARATOR).filter(Boolean);
  if (parts.length <= 2) {
    return p;
  }
  return `.../${parts.slice(-2).join("/")}`;
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function firstLine(s: string): string {
  for (const line of s.split("\n")) {
    if (line.trim()) {
      return line.trim();
    }
  }
  return "";
}

function countLines(s: string): number {
  if (!s) {
    return 0;
  }
  const n = s.split("\n").length;
  // A trailing newline shouldn't inflate the count by one phantom line.
  return s.endsWith("\n") ? n - 1 : n;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Flattens a `tool_result` block's `content`, which the SDK hands back either as
 * a plain string or as an Anthropic content-block array.
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = rec(b);
        return str(block.text) ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return str(rec(content).text) ?? "";
  }
  return "";
}

/** Keep the head of a listing, flagging what was dropped. */
function headDetail(
  text: string,
  maxLines: number
): Partial<ToolResultSummary> {
  return sliceDetail(text, maxLines, "head");
}

/** Keep the tail of a stream — the end of a build log is the informative part. */
function tailDetail(
  text: string,
  maxLines: number
): Partial<ToolResultSummary> {
  return sliceDetail(text, maxLines, "tail");
}

function sliceDetail(
  text: string,
  maxLines: number,
  end: "head" | "tail"
): Partial<ToolResultSummary> {
  const body = text.replace(TRAILING_WHITESPACE, "");
  if (!body) {
    return {};
  }
  const lines = body.split("\n");
  let kept = lines;
  let droppedLines = 0;
  if (lines.length > maxLines) {
    kept = end === "head" ? lines.slice(0, maxLines) : lines.slice(-maxLines);
    droppedLines = lines.length - maxLines;
  }
  let detail = kept.join("\n");
  let truncated = droppedLines > 0;
  if (detail.length > MAX_DETAIL_CHARS) {
    detail =
      end === "head"
        ? detail.slice(0, MAX_DETAIL_CHARS)
        : detail.slice(-MAX_DETAIL_CHARS);
    truncated = true;
  }
  return droppedLines
    ? { detail, droppedLines, truncated }
    : { detail, truncated };
}

// ---------------------------------------------------------------------------
// Header + arguments
// ---------------------------------------------------------------------------

/** The primary argument a tool is "about", used in the mono header. */
function primaryArg(name: string, input: unknown): string {
  const ti = rec(input);
  const path = str(ti.file_path) ?? str(ti.path) ?? str(ti.notebook_path);
  switch (name) {
    case "Bash":
      return clamp(str(ti.command) ?? "", 80);
    case "Grep":
      return clamp(str(ti.pattern) ?? "", 60);
    case "Glob":
      return clamp(str(ti.pattern) ?? "", 60);
    case "WebFetch":
      return clamp(str(ti.url) ?? "", 60);
    case "WebSearch":
      return clamp(str(ti.query) ?? "", 60);
    case "TodoWrite":
      return "";
    default:
      return path ? shortenPath(path) : "";
  }
}

/**
 * The coarse, self-overwriting one-liner behind the status pill ("Reading
 * foo.tsx"). Returns null for tools not worth announcing.
 *
 * Lives here rather than in a provider so both backends describe the same tool
 * the same way, and because it shares `shortenPath` with the header logic.
 */
export function describeTool(name: string, input: unknown): string | null {
  const ti = rec(input);
  const path = str(ti.file_path) ?? str(ti.path) ?? "";
  const short = path ? shortenPath(path) : "";
  switch (name) {
    case "Delete":
      return short ? `Deleting ${short}` : "Deleting files";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "Write":
      return short ? `Editing ${short}` : "Editing files";
    case "Read":
      return short ? `Reading ${short}` : "Reading files";
    case "Bash": {
      const cmd = str(ti.command)?.split(RUN_OF_WHITESPACE)[0] ?? "";
      return cmd ? `Running ${cmd}` : "Running a command";
    }
    case "Glob":
    case "Grep":
      return "Searching the codebase";
    case "TodoWrite":
      return "Planning the change";
    case "WebFetch":
    case "WebSearch":
      return "Looking things up";
    default:
      return name.startsWith("mcp__airship__")
        ? "Inspecting the selected element"
        : null;
  }
}

/** Mono header text: `Read(src/app.ts)`, `Bash(pnpm build)`, `TodoWrite`. */
export function toolTitle(name: string, input: unknown): string {
  const label = name.startsWith("mcp__airship__")
    ? name.slice("mcp__airship__".length)
    : name;
  const arg = primaryArg(name, input);
  return arg ? `${label}(${arg})` : label;
}

/**
 * A whitelisted, stringified, capped view of the tool input for the expanded
 * body. Never dumps the raw input — `Write.content` and `MultiEdit.edits` are
 * unbounded and would dominate every persisted bundle.
 */
export function toolArgs(name: string, input: unknown): Record<string, string> {
  const ti = rec(input);
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown): void => {
    const s = str(v);
    if (s?.trim()) {
      out[k] = clamp(s, MAX_ARG_CHARS);
    }
  };

  const path = str(ti.file_path) ?? str(ti.path) ?? str(ti.notebook_path);
  if (path) {
    out.path = path;
  }

  switch (name) {
    case "Bash":
      put("command", ti.command);
      put("description", ti.description);
      break;
    case "Grep":
      put("pattern", ti.pattern);
      put("glob", ti.glob);
      put("output_mode", ti.output_mode);
      break;
    case "Glob":
      put("pattern", ti.pattern);
      break;
    case "Read": {
      const offset = num(ti.offset);
      const limit = num(ti.limit);
      if (offset !== undefined) {
        out.offset = String(offset);
      }
      if (limit !== undefined) {
        out.limit = String(limit);
      }
      break;
    }
    case "MultiEdit": {
      const edits = Array.isArray(ti.edits) ? ti.edits.length : 0;
      if (edits) {
        out.edits = String(edits);
      }
      break;
    }
    case "Write": {
      const content = str(ti.content);
      if (content) {
        out.bytes = String(content.length);
      }
      break;
    }
    case "WebFetch":
      put("url", ti.url);
      put("prompt", ti.prompt);
      break;
    case "WebSearch":
      put("query", ti.query);
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result summarization
// ---------------------------------------------------------------------------

/**
 * Pulls `+N −M` out of the SDK's structured patch when present. The shape is
 * documented only as `unknown` on `SDKUserMessage.tool_use_result`, so every
 * access is probed rather than trusted, with a counted fallback below.
 */
function countsFromStructuredPatch(
  typed: unknown
): { added: number; removed: number } | null {
  const patch = rec(typed).structuredPatch;
  if (!Array.isArray(patch)) {
    return null;
  }
  let added = 0;
  let removed = 0;
  let sawLines = false;
  for (const hunk of patch) {
    const { lines } = rec(hunk);
    if (!Array.isArray(lines)) {
      continue;
    }
    sawLines = true;
    for (const raw of lines) {
      const line = str(raw);
      if (line?.startsWith("+")) {
        added += 1;
      } else if (line?.startsWith("-")) {
        removed += 1;
      }
    }
  }
  return sawLines ? { added, removed } : null;
}

/** Fallback: count +/- lines out of a unified-diff-looking string. */
function countsFromPatchText(
  text: string
): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let sawHunk = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      sawHunk = true;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // file headers, not content
    } else if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  return sawHunk || added || removed ? { added, removed } : null;
}

/**
 * The `⎿` line for a finished tool call, plus its optional expanded detail.
 *
 * `typed` is the SDK's `SDKUserMessage.tool_use_result` — richer than the text
 * content when present (line counts, structured patches), but declared
 * `unknown`, so it is probed defensively and every path has a text fallback.
 */
/**
 * A shell command. A non-zero exit leads with the status and whatever the
 * command said about it; stderr wins over stdout there, because that is where
 * the reason lives.
 */
function summarizeBash(
  text: string,
  t: Record<string, unknown>
): ToolResultSummary {
  const stdout = str(t.stdout) ?? text;
  const stderr = str(t.stderr) ?? "";
  const code = num(t.exitCode) ?? num(t.exit_code);
  const head = firstLine(stdout) || firstLine(stderr);
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  if (code !== undefined && code !== 0) {
    const why = firstLine(stderr) || head;
    return {
      text: clamp(why ? `exit ${code} — ${why}` : `exit ${code}`, MAX_TEXT),
      ...tailDetail(combined, MAX_TAIL_LINES),
    };
  }
  return {
    text: clamp(head || "Done", MAX_TEXT),
    ...tailDetail(combined, MAX_TAIL_LINES),
  };
}

/** A write of any shape: patch counts where we have them, else a confirmation. */
function summarizeEdit(
  name: string,
  text: string,
  ti: Record<string, unknown>,
  typed: unknown
): ToolResultSummary {
  const counts = countsFromStructuredPatch(typed) ?? countsFromPatchText(text);
  if (counts) {
    const base = `+${counts.added} −${counts.removed}`;
    const editCount = Array.isArray(ti.edits) ? ti.edits.length : 0;
    const multi = name === "MultiEdit" && editCount > 1;
    return {
      text: multi ? `${base} across ${editCount} edits` : base,
      ...headDetail(text, MAX_HEAD_LINES),
    };
  }
  if (name === "Write") {
    // A brand-new file returns a confirmation, not a patch. Guarded on
    // `content` actually being present: a Codex `file_change` names a path but
    // carries no body, and "Wrote 0 lines" would be a lie.
    const written = str(ti.content);
    if (written === undefined) {
      return { text: "Created" };
    }
    const n = countLines(written);
    return { text: `Wrote ${n} line${n === 1 ? "" : "s"}` };
  }
  return {
    text: clamp(firstLine(text) || "Applied", MAX_TEXT),
    ...headDetail(text, MAX_HEAD_LINES),
  };
}

function summarizeRead(
  text: string,
  t: Record<string, unknown>
): ToolResultSummary {
  const n = num(rec(t.file).numLines) ?? num(t.numLines) ?? countLines(text);
  return {
    text: `Read ${n} line${n === 1 ? "" : "s"}`,
    ...headDetail(text, MAX_HEAD_LINES),
  };
}

function summarizeGrep(
  text: string,
  t: Record<string, unknown>
): ToolResultSummary {
  const n = num(t.numMatches) ?? num(t.count) ?? countLines(text);
  return {
    text: n ? `${n} match${n === 1 ? "" : "es"}` : "No matches",
    ...headDetail(text, MAX_LIST_LINES),
  };
}

function summarizeGlob(
  text: string,
  t: Record<string, unknown>
): ToolResultSummary {
  const n = num(t.numFiles) ?? countLines(text);
  return {
    text: n ? `${n} file${n === 1 ? "" : "s"}` : "No files",
    ...headDetail(text, MAX_LIST_LINES),
  };
}

function summarizeTodoWrite(ti: Record<string, unknown>): ToolResultSummary {
  const todos = Array.isArray(ti.todos) ? ti.todos : [];
  const done = todos.filter((x) => rec(x).status === "completed").length;
  // No detail: the todos render as their own timeline row.
  return { text: `${todos.length} todos · ${done} done` };
}

function summarizeWebFetch(
  text: string,
  ti: Record<string, unknown>
): ToolResultSummary {
  const url = str(ti.url) ?? "";
  let host = url;
  try {
    ({ host } = new URL(url));
  } catch {
    // not a parseable URL; fall back to the raw string
  }
  return {
    text: clamp(host ? `Fetched ${host}` : "Fetched", MAX_TEXT),
    ...headDetail(text, MAX_WEB_LINES),
  };
}

function summarizeWebSearch(text: string): ToolResultSummary {
  const n = countLines(text);
  return {
    text: n ? `${n} result${n === 1 ? "" : "s"}` : "No results",
    ...headDetail(text, MAX_WEB_LINES),
  };
}

function summarizeUnknown(name: string, text: string): ToolResultSummary {
  if (name.startsWith("mcp__airship__")) {
    return { text: "Element context resolved" };
  }
  return {
    text: clamp(firstLine(text) || "Done", MAX_TEXT),
    ...headDetail(text, MAX_HEAD_LINES),
  };
}

export function summarizeToolResult(
  name: string,
  input: unknown,
  content: unknown,
  isError: boolean,
  typed?: unknown
): ToolResultSummary {
  const text = contentToText(content);

  if (isError) {
    const line = firstLine(text) || "Tool call failed";
    return {
      text: clamp(`Error: ${line}`, MAX_TEXT),
      ...tailDetail(text, MAX_TAIL_LINES),
    };
  }

  const ti = rec(input);
  const t = rec(typed);

  switch (name) {
    case "Read":
      return summarizeRead(text, t);

    case "Bash":
      return summarizeBash(text, t);

    // Codex-only: a `file_change` entry whose kind is "delete". Claude removes
    // files through Bash, so this never fires on that path.
    case "Delete":
      return { text: "Deleted" };

    case "Edit":
    case "Write":
    case "NotebookEdit":
    case "MultiEdit":
      return summarizeEdit(name, text, ti, typed);

    case "Grep":
      return summarizeGrep(text, t);

    case "Glob":
      return summarizeGlob(text, t);

    case "TodoWrite":
      return summarizeTodoWrite(ti);

    case "WebFetch":
      return summarizeWebFetch(text, ti);

    case "WebSearch":
      return summarizeWebSearch(text);

    default:
      return summarizeUnknown(name, text);
  }
}
