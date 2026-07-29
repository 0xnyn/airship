/**
 * Records the ordered log of what the agent did during a job — tool calls with
 * their results, thinking, prose, and todo lists.
 *
 * The load-bearing design choice: the server never reassembles this from the
 * events it broadcast. One recorder owns the array *and* fires the sink, so
 * every mutation lands in both places through the same code path. The live
 * stream and the persisted `JobDiffBundle.timeline` are therefore identical by
 * construction, which is what makes reopening a past thread replay the real
 * sequence instead of an approximation of it.
 */
import type {
  TimelineItem,
  TimelineItemPatch,
  TimelineTextItem,
  TimelineThinkingItem,
  TimelineToolItem,
  TodoItem,
} from "@airship/protocol";
import { summarizeToolResult, toolArgs, toolTitle } from "./tool-summary";

/** Ceiling on rows per job — a runaway loop shouldn't write an unbounded file. */
const MAX_ITEMS = 400;
/** Ceiling on the total expanded-detail text persisted for one job. Once spent,
 * later tools keep their `⎿` line but drop their body. */
const MAX_TOTAL_DETAIL_CHARS = 120_000;

export interface TimelineSink {
  onItem?: (item: TimelineItem) => void;
  onPatch?: (id: string, patch: TimelineItemPatch) => void;
}

export class TimelineRecorder {
  private readonly items: TimelineItem[] = [];
  private readonly byId = new Map<string, TimelineItem>();
  /** Tool calls awaiting their `tool_result`, keyed by SDK `tool_use.id`. */
  private readonly openTools = new Map<
    string,
    { name: string; input: unknown }
  >();
  /** Streaming content blocks, keyed by the SDK's block index. */
  private readonly blockIds = new Map<number, string>();
  private readonly t0 = Date.now();
  private detailBudget = MAX_TOTAL_DETAIL_CHARS;
  private seq = 0;

  private readonly sink: TimelineSink;

  constructor(sink: TimelineSink = {}) {
    this.sink = sink;
  }

  /** The ordered log, for persisting into the job bundle. */
  snapshot(): TimelineItem[] {
    return this.items;
  }

  // -- tools ---------------------------------------------------------------

  /** From a `tool_use` block on an assistant message. */
  openTool(
    id: string,
    name: string,
    input: unknown,
    parentToolUseId?: string | null
  ): void {
    if (!id || this.byId.has(id)) {
      return;
    }
    this.openTools.set(id, { input, name });
    this.append({
      args: toolArgs(name, input),
      id,
      kind: "tool",
      name,
      parentToolUseId: parentToolUseId ?? null,
      phase: "pending",
      startedAt: this.now(),
      title: toolTitle(name, input),
    });
  }

  /**
   * From a `tool_result` block on the following user message. No-ops on an id
   * we never opened — subagent-nested tools and pre-emptive denials both
   * produce results without a visible call, and inventing a row for them would
   * be worse than omitting it.
   */
  closeTool(
    id: string,
    isError: boolean,
    content: unknown,
    typed?: unknown
  ): void {
    const open = this.openTools.get(id);
    if (!open) {
      return;
    }
    this.openTools.delete(id);

    const result = summarizeToolResult(
      open.name,
      open.input,
      content,
      isError,
      typed
    );
    if (result.detail) {
      if (result.detail.length > this.detailBudget) {
        result.detail = undefined;
        result.truncated = true;
      } else {
        this.detailBudget -= result.detail.length;
      }
    }

    this.patch(id, {
      endedAt: this.now(),
      phase: isError ? "error" : "ok",
      result,
    });
  }

  /** Name + input of a still-open tool call, for callers that need context. */
  lookup(id: string): { name: string; input: unknown } | undefined {
    return this.openTools.get(id);
  }

  // -- streaming prose / thinking -------------------------------------------

  /** From `content_block_start`. */
  openBlock(index: number, kind: "text" | "thinking"): void {
    if (this.blockIds.has(index)) {
      return;
    }
    const id = this.synthId(kind);
    this.blockIds.set(index, id);
    const base = { id, startedAt: this.now(), streaming: true, text: "" };
    this.append(
      kind === "thinking"
        ? ({ kind: "thinking", ...base } as TimelineThinkingItem)
        : ({ kind: "text", ...base } as TimelineTextItem)
    );
  }

  /** From `content_block_delta`. Tolerates a missed `content_block_start`. */
  blockDelta(index: number, kind: "text" | "thinking", delta: string): void {
    if (!delta) {
      return;
    }
    if (!this.blockIds.has(index)) {
      this.openBlock(index, kind);
    }
    const id = this.blockIds.get(index);
    if (id) {
      this.patch(id, { textDelta: delta });
    }
  }

  /** From `content_block_stop`. */
  closeBlock(index: number): void {
    const id = this.blockIds.get(index);
    this.blockIds.delete(index);
    if (id) {
      this.patch(id, { streaming: false });
    }
  }

  /**
   * The final block text off the assistant message. Sends an *absolute* replace
   * rather than an append: the deltas for this same block already streamed, so
   * appending here would render every sentence twice. If the block never
   * streamed (deltas disabled, reconnect) this creates it outright.
   */
  commitBlock(kind: "text" | "thinking", text: string): void {
    if (!text) {
      return;
    }
    const existing = this.findStreaming(kind);
    if (existing) {
      this.patch(existing.id, { streaming: false, text });
      for (const [index, id] of this.blockIds) {
        if (id === existing.id) {
          this.blockIds.delete(index);
        }
      }
      return;
    }
    const base = { id: this.synthId(kind), startedAt: this.now(), text };
    this.append(
      kind === "thinking"
        ? ({ kind: "thinking", ...base } as TimelineThinkingItem)
        : ({ kind: "text", ...base } as TimelineTextItem)
    );
  }

  /**
   * Running token estimate during the redacted-thinking phase, where the API
   * streams no text at all. Gives the UI something honest to show instead of an
   * empty box.
   */
  thinkingTokens(estimated: number): void {
    const open = this.findStreaming("thinking");
    if (open) {
      this.patch(open.id, { estimatedTokens: estimated });
      return;
    }
    this.append({
      estimatedTokens: estimated,
      id: this.synthId("thinking"),
      kind: "thinking",
      startedAt: this.now(),
      streaming: true,
      text: "",
    });
  }

  // -- todos ---------------------------------------------------------------

  /**
   * Keyed by the TodoWrite `tool_use.id`. Claude rewrites the whole list on
   * every update, so a repeat call for the same id patches the existing row
   * rather than appending a second list.
   */
  todos(id: string, todos: TodoItem[]): void {
    if (!(id && todos.length)) {
      return;
    }
    const key = `todos:${id}`;
    if (this.byId.has(key)) {
      this.patch(key, { todos });
      return;
    }
    this.append({ id: key, kind: "todos", startedAt: this.now(), todos });
  }

  // -- internals -----------------------------------------------------------

  private now(): number {
    return Date.now() - this.t0;
  }

  private synthId(kind: string): string {
    this.seq += 1;
    return `${kind}:${this.seq}`;
  }

  private findStreaming(
    kind: "text" | "thinking"
  ): TimelineTextItem | TimelineThinkingItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const item = this.items[i];
      if (item.kind === kind) {
        return item.streaming ? item : undefined;
      }
    }
  }

  private append(item: TimelineItem): void {
    if (this.items.length >= MAX_ITEMS) {
      return;
    }
    this.items.push(item);
    this.byId.set(item.id, item);
    this.sink.onItem?.(item);
  }

  private patch(id: string, patch: TimelineItemPatch): void {
    const item = this.byId.get(id);
    if (!item) {
      return;
    }
    applyPatch(item, patch);
    this.sink.onPatch?.(id, patch);
  }
}

/**
 * Merge a patch into an item. Shared semantics with the overlay's reducer:
 * `textDelta` appends, `text` replaces outright and always wins.
 */
function applyPatch(item: TimelineItem, patch: TimelineItemPatch): void {
  const tool = item as TimelineToolItem;
  const prose = item as TimelineTextItem | TimelineThinkingItem;

  if (patch.phase !== undefined) {
    tool.phase = patch.phase;
  }
  if (patch.result !== undefined) {
    tool.result = patch.result;
  }
  if (patch.endedAt !== undefined) {
    tool.endedAt = patch.endedAt;
  }
  if (patch.textDelta !== undefined) {
    prose.text = (prose.text ?? "") + patch.textDelta;
  }
  if (patch.text !== undefined) {
    prose.text = patch.text;
  }
  if (patch.streaming !== undefined) {
    prose.streaming = patch.streaming;
  }
  if (patch.estimatedTokens !== undefined) {
    (item as TimelineThinkingItem).estimatedTokens = patch.estimatedTokens;
  }
  if (patch.todos !== undefined) {
    (item as { todos?: TodoItem[] }).todos = patch.todos;
  }
}
