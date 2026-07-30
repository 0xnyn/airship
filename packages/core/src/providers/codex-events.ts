/**
 * Pure translation from Codex `ThreadItem`s into the Claude-shaped tuples the
 * shared summarizer understands. No I/O, no SDK, no recorder — which is what
 * makes the Codex event loop testable without spawning the CLI.
 *
 * The vocabulary itself, and the reason for translating into it, live in
 * `./shared`.
 */
import type { Effort, TodoItem } from "@airship/protocol";
import type {
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  ThreadItem,
  TodoListItem,
  WebSearchItem,
} from "@openai/codex-sdk";
import type { NormalizedTool } from "./shared";

/** Codex has no `max`; `xhigh` is its ceiling. */
export function toCodexEffort(
  effort?: Effort
): "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  if (!effort) {
    return;
  }
  return effort === "max" ? "xhigh" : effort;
}

/** `add` creates, `update` edits, `delete` removes — mapped to shared names. */
function nameForChangeKind(kind: string): string {
  switch (kind) {
    case "add":
      return "Write";
    case "delete":
      return "Delete";
    default:
      return "Edit";
  }
}

function normalizeCommand(item: CommandExecutionItem): NormalizedTool {
  const done = item.status !== "in_progress";
  return {
    id: item.id,
    input: { command: item.command },
    // Deliberately never flagged as an error, even when Codex reports `failed`.
    //
    // `failed` here means a non-zero exit, which is an ordinary outcome for a
    // command an agent runs — a failing build is information, not a broken
    // tool. The summarizer short-circuits on `isError` to a bare "Error: <first
    // line>", losing both the exit code and the tail of the output; letting it
    // reach the Bash branch instead yields `exit 1 — …` plus the last lines of
    // the log, which is what the Claude path shows for the same command.
    isError: false,
    name: "Bash",
    ...(done
      ? {
          content: item.aggregated_output,
          typed: {
            // Codex omits the code on success; the summarizer treats a missing
            // code as "no exit status to report", so normalize it to 0.
            exitCode: item.exit_code ?? (item.status === "failed" ? 1 : 0),
            stdout: item.aggregated_output,
          },
        }
      : {}),
  };
}

function normalizeMcp(item: McpToolCallItem): NormalizedTool {
  const done = item.status !== "in_progress";
  return {
    id: item.id,
    input: item.arguments,
    isError: item.status === "failed",
    name: `mcp__${item.server}__${item.tool}`,
    ...(done ? { content: item.error?.message ?? item.result?.content } : {}),
  };
}

function normalizeWebSearch(item: WebSearchItem): NormalizedTool {
  return {
    // The SDK reports no results payload. "Searched" keeps the row honest;
    // an empty string would make the summarizer claim "No results".
    content: "Searched",
    id: item.id,
    input: { query: item.query },
    name: "WebSearch",
  };
}

/**
 * A `file_change` may name several paths at once, and each deserves its own
 * timeline row — so this returns a list where the other item types return one.
 *
 * Codex emits no `item.started` for these and carries no patch text, so each
 * row is opened and closed in the same breath. The caller supplies `typed` from
 * its own diff capture to recover a real `+N −M`.
 */
export function normalizeFileChange(item: FileChangeItem): NormalizedTool[] {
  return item.changes.map((change, i) => ({
    content: "",
    // The item id is shared by every path in the patch, so it is suffixed to
    // keep the recorder's per-id map from collapsing them into one row.
    id: `${item.id}:${i}`,
    input: { file_path: change.path },
    isError: item.status === "failed",
    name: nameForChangeKind(change.kind),
  }));
}

/**
 * Map a Codex item to the shared vocabulary, or null when it is not a tool row
 * (prose, reasoning, todos and errors are all handled by the caller directly).
 */
export function normalizeItem(item: ThreadItem): NormalizedTool | null {
  switch (item.type) {
    case "command_execution":
      return normalizeCommand(item);
    case "mcp_tool_call":
      return normalizeMcp(item);
    case "web_search":
      return normalizeWebSearch(item);
    default:
      return null;
  }
}

/**
 * Codex plans are a flat done/not-done list — there is no `in_progress`, and
 * inventing one would render a spinner that never resolves.
 */
export function mapTodos(item: TodoListItem): TodoItem[] | null {
  const mapped: TodoItem[] = item.items
    .map((t) => ({
      content: typeof t.text === "string" ? t.text : "",
      status: (t.completed ? "completed" : "pending") as TodoItem["status"],
    }))
    .filter((t) => t.content);
  return mapped.length ? mapped : null;
}
