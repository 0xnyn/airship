/**
 * The Claude Agent SDK backend.
 *
 * Uses the SDK to the fullest: streaming input (native image attachments +
 * cancel), streaming output, PreToolUse hooks (diff capture + sandbox),
 * canUseTool, an in-process MCP tool, structured output, file checkpointing,
 * session resume/fork, settingSources (project CLAUDE.md), and effort/turn/
 * budget caps.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EDIT_OUTPUT_JSON_SCHEMA,
  type EditStructuredOutput,
  type Effort,
  type TodoItem,
  type Usage,
} from "@airship/protocol";
import type {
  EffortLevel,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentAdapter,
  type AgentRunContext,
  type AgentRunOutcome,
  failureText,
} from "../agent";
import { isPathInside } from "../paths";
import { systemPrompt } from "../prompt";
import { EDIT_TOOLS, makeSandboxHook } from "../sandbox";
import type { TimelineRecorder } from "../timeline";
import { describeTool } from "../tool-summary";
import { buildAirshipMcpServer } from "../tools";

const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "TodoWrite",
  "Bash",
  "WebFetch",
  "WebSearch",
  "mcp__airship__get_element_context",
];

const EDIT_TOOL_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

/** Claude has no `minimal`; it is the closest thing to Codex's floor. */
function toClaudeEffort(effort?: Effort): EffortLevel | undefined {
  if (!effort) {
    return;
  }
  return (effort === "minimal" ? "low" : effort) as EffortLevel;
}

/** What one `run` accumulates while draining the query. Shaped as the outcome. */
interface RunState {
  checkpointId: string | null;
  error?: string;
  resultText: string;
  sessionId: string | null;
  structured: EditStructuredOutput | null;
  usage?: Usage;
}

/** The terminal `result` message: usage always, then the payload or the error. */
function reduceResult(
  msg: Extract<SDKMessage, { type: "result" }>,
  state: RunState
): void {
  state.usage = {
    costUsd: msg.total_cost_usd,
    inputTokens: msg.usage?.input_tokens,
    outputTokens: msg.usage?.output_tokens,
  };
  state.sessionId = msg.session_id ?? state.sessionId;
  if (msg.subtype !== "success") {
    state.error =
      ("errors" in msg && msg.errors?.length
        ? msg.errors.join("; ")
        : undefined) ?? msg.subtype;
    return;
  }
  state.resultText = msg.result ?? "";
  if (msg.structured_output) {
    state.structured = msg.structured_output as EditStructuredOutput;
  }
}

/** Fold one SDK message into `state`, driving the recorder as it goes. */
function reduceMessage(
  msg: SDKMessage,
  ctx: AgentRunContext,
  state: RunState
): void {
  const { events, recorder } = ctx;
  switch (msg.type) {
    case "system": {
      if (msg.subtype === "init" && msg.session_id) {
        state.sessionId = msg.session_id;
        events.onSessionId?.(state.sessionId);
      } else if (msg.subtype === "thinking_tokens") {
        recorder.thinkingTokens(msg.estimated_tokens);
      }
      break;
    }
    case "user": {
      // The first user message's uuid is the file checkpoint to rewind to.
      const { uuid } = msg as { uuid?: string };
      if (!state.checkpointId && uuid) {
        state.checkpointId = uuid;
      }
      handleUser(msg, recorder);
      break;
    }
    case "assistant": {
      handleAssistant(msg, recorder, ctx.emitStep, events.onTodos);
      if (msg.session_id) {
        state.sessionId = msg.session_id;
      }
      break;
    }
    case "stream_event": {
      handleStream(msg, recorder, events.onText);
      break;
    }
    case "result": {
      reduceResult(msg, state);
      break;
    }
    default:
      break;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunOutcome> {
  const { diffs: diffCapture, input } = ctx;
  const safe = input.safe ?? false;

  const airshipServer = buildAirshipMcpServer({
    attrChanges: input.attrChanges,
    element: input.element,
    moveChanges: input.moveChanges,
    source: input.source,
    structuralChanges: input.structuralChanges,
    textChanges: input.textChanges,
    tokens: input.tokens,
    visualChanges: input.visualChanges,
  });

  // Two independent PreToolUse concerns, deliberately built separately.
  //
  // The first captures each file's content before it is overwritten and is what
  // makes both the rendered diff and the undo work — it is NOT a safety
  // measure and must register in every mode. The second is the sandbox guard,
  // which is what `--safe` actually toggles. Collapsing them into one array
  // literal is how someone accidentally disables diffs while meaning to
  // disable the sandbox.
  const captureHook = {
    hooks: [
      (i: { hook_event_name?: string; tool_input?: unknown }) => {
        if (i.hook_event_name === "PreToolUse") {
          const fp = (i.tool_input as Record<string, unknown> | undefined)
            ?.file_path;
          if (typeof fp === "string") {
            diffCapture.recordBefore(fp);
          }
        }
        return Promise.resolve({});
      },
    ],
    matcher: EDIT_TOOL_MATCHER,
  } as NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number];

  const preToolUse = [captureHook];
  if (safe) {
    preToolUse.push({
      hooks: [makeSandboxHook(input.cwd)],
    } as (typeof preToolUse)[number]);
  }

  const options: Options = {
    abortController: input.abortController,
    allowedTools: ALLOWED_TOOLS,
    cwd: input.cwd,
    effort: toClaudeEffort(input.effort),
    enableFileCheckpointing: true,
    // Replay user messages so we can capture the first user-message uuid as the
    // file-checkpoint anchor for rewindFiles (see `checkpointId` capture below).
    extraArgs: { "replay-user-messages": null },
    hooks: { PreToolUse: preToolUse },
    includePartialMessages: true,
    maxBudgetUsd: input.maxBudgetUsd,
    maxTurns: input.maxTurns ?? 24,
    mcpServers: { airship: airshipServer },
    model: input.model,
    outputFormat: {
      schema: EDIT_OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>,
      type: "json_schema",
    },
    // Under `--safe`, edits are auto-accepted but the sandbox hook and
    // canUseTool still screen them. Otherwise nothing screens anything.
    permissionMode: safe ? "acceptEdits" : "bypassPermissions",
    persistSession: true,
    settingSources: ["project"],
    stderr: (data) => {
      if (process.env.PIKA_DEBUG) {
        process.stderr.write(data);
      }
    },
    systemPrompt: {
      append: systemPrompt("claude"),
      preset: "claude_code",
      type: "preset",
    },
  };

  // Programmatic permission catch-all. The sandbox hook is the primary guard
  // (hooks run first); this is defense-in-depth in case ordering ever changes.
  // Both belong to the same posture, so both are gated together.
  if (safe) {
    options.canUseTool = (toolName, toolInput) => {
      if (EDIT_TOOLS.has(toolName)) {
        const fp = (toolInput as Record<string, unknown>).file_path;
        if (typeof fp === "string" && !isPathInside(input.cwd, fp)) {
          return Promise.resolve({
            behavior: "deny",
            message: `Refusing to modify a path outside the project: ${fp}`,
          });
        }
      }
      return Promise.resolve({ behavior: "allow", updatedInput: toolInput });
    };
  }

  if (input.resumeSessionId) {
    options.resume = input.resumeSessionId;
    if (input.fork) {
      options.forkSession = true;
    }
  }

  const state: RunState = {
    checkpointId: null,
    resultText: "",
    sessionId: input.resumeSessionId ?? null,
    structured: null,
  };

  try {
    const q = query({ options, prompt: makeInputStream(ctx) });
    for await (const msg of q) {
      reduceMessage(msg, ctx, state);
    }
  } catch (err) {
    state.error = failureText(err, input.abortController);
  }

  return { ...state };
}

/**
 * Rewind files to the checkpoint captured during an edit, via the Agent SDK's
 * native file checkpointing. Resumes the session, waits for it to initialize,
 * then calls `rewindFiles`. (`@airship/git.restoreFiles` is the instant, primary
 * undo; this is the SDK-native alternative.)
 */
async function rewind(params: {
  checkpointId: string;
  cwd: string;
  sessionId: string;
}): Promise<{ error?: string; ok: boolean }> {
  try {
    const q = query({
      options: {
        cwd: params.cwd,
        enableFileCheckpointing: true,
        permissionMode: "acceptEdits",
        resume: params.sessionId,
        settingSources: [],
      },
      prompt: "",
    });
    let done = false;
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        await q.rewindFiles(params.checkpointId);
        done = true;
        break;
      }
    }
    return done
      ? { ok: true }
      : { error: "session did not initialize", ok: false };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

function checkAuth(): { ok: boolean; reason?: string } {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { ok: true };
  }
  if (existsSync(join(homedir(), ".claude"))) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "No ANTHROPIC_API_KEY found and no ~/.claude config detected. Set ANTHROPIC_API_KEY or run `claude` once to sign in.",
  };
}

export const claudeAdapter: AgentAdapter = {
  checkAuth,
  kind: "claude",
  rewind,
  run,
};

// ---------------------------------------------------------------------------
// Streaming input
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/useAwait: async generator is the SDK's streaming-input contract
async function* makeInputStream(
  ctx: AgentRunContext
): AsyncGenerator<SDKUserMessage> {
  const content: unknown[] = [{ text: ctx.promptText, type: "text" }];
  for (const img of ctx.input.images ?? []) {
    content.push({
      source: {
        data: img.dataBase64,
        media_type: img.mediaType,
        type: "base64",
      },
      type: "image",
    });
  }
  yield {
    message: { content, role: "user" } as unknown as SDKUserMessage["message"],
    parent_tool_use_id: null,
    type: "user",
  };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/** One block of an assistant message, probed defensively — it is `unknown`. */
interface ContentBlock {
  id?: string;
  input?: unknown;
  name?: string;
  text?: string;
  thinking?: string;
  type?: string;
}

function handleToolUse(
  b: ContentBlock,
  parentToolUseId: string | null,
  recorder: TimelineRecorder,
  emitStep: (step: string) => void,
  onTodos?: (todos: TodoItem[]) => void
): void {
  if (!b.name) {
    return;
  }
  // Opened from the complete assistant message rather than from the streamed
  // `input_json_delta`s: the row appears a beat later, but it never renders
  // half-parsed JSON as a tool argument.
  if (b.id) {
    recorder.openTool(b.id, b.name, b.input, parentToolUseId);
  }
  const step = describeTool(b.name, b.input);
  if (step) {
    emitStep(step);
  }
  const todos = b.name === "TodoWrite" ? mapTodos(b.input) : null;
  if (!todos) {
    return;
  }
  onTodos?.(todos);
  if (b.id) {
    recorder.todos(b.id, todos);
  }
}

function handleAssistant(
  msg: { message?: unknown; parent_tool_use_id?: string | null },
  recorder: TimelineRecorder,
  emitStep: (step: string) => void,
  onTodos?: (todos: TodoItem[]) => void
): void {
  const content = (msg.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    const b = block as ContentBlock;
    if (b.type === "tool_use") {
      handleToolUse(
        b,
        msg.parent_tool_use_id ?? null,
        recorder,
        emitStep,
        onTodos
      );
    } else if (b.type === "text" && b.text) {
      recorder.commitBlock("text", b.text);
    } else if (b.type === "thinking" && b.thinking) {
      recorder.commitBlock("thinking", b.thinking);
    }
  }
}

function handleStream(
  msg: { event?: unknown },
  recorder: TimelineRecorder,
  onText?: (delta: string) => void
): void {
  const ev = msg.event as
    | {
        type?: string;
        index?: number;
        content_block?: { type?: string };
        delta?: { type?: string; text?: string; thinking?: string };
      }
    | undefined;
  if (!ev) {
    return;
  }
  const index = ev.index ?? 0;

  switch (ev.type) {
    case "content_block_start": {
      const kind = ev.content_block?.type;
      if (kind === "text" || kind === "thinking") {
        recorder.openBlock(index, kind);
      }
      break;
    }
    case "content_block_delta": {
      if (ev.delta?.type === "text_delta" && ev.delta.text) {
        recorder.blockDelta(index, "text", ev.delta.text);
        onText?.(ev.delta.text);
      } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
        recorder.blockDelta(index, "thinking", ev.delta.thinking);
      }
      break;
    }
    case "content_block_stop": {
      recorder.closeBlock(index);
      break;
    }
    default:
      break;
  }
}

/** Tool results ride on the *following* user message, joined by `tool_use_id`. */
function handleUser(
  msg: { message?: unknown; tool_use_result?: unknown },
  recorder: TimelineRecorder
): void {
  const content = (msg.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    const b = block as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type === "tool_result" && b.tool_use_id) {
      recorder.closeTool(
        b.tool_use_id,
        Boolean(b.is_error),
        b.content,
        msg.tool_use_result
      );
    }
  }
}

/** Normalize a TodoWrite input into protocol todos. Returns null when there is
 * nothing usable, so the legacy callback and the timeline share one mapping. */
function mapTodos(toolInput: unknown): TodoItem[] | null {
  const todos = (toolInput as { todos?: unknown })?.todos;
  if (!Array.isArray(todos)) {
    return null;
  }
  const mapped: TodoItem[] = todos
    .map((t) => {
      const todo = t as { content?: unknown; status?: unknown };
      const status =
        todo.status === "in_progress" || todo.status === "completed"
          ? todo.status
          : "pending";
      return {
        content: typeof todo.content === "string" ? todo.content : "",
        status,
      } as TodoItem;
    })
    .filter((t) => t.content);
  return mapped.length ? mapped : null;
}
