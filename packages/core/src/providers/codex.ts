/**
 * The OpenAI Codex backend.
 *
 * The Codex SDK is a thin wrapper that spawns `codex exec --experimental-json`
 * and reads JSONL events. It offers materially less than the Claude SDK, and
 * each gap is handled explicitly rather than faked:
 *
 * - No token-level streaming. Prose and reasoning arrive whole, so they are
 *   committed as complete timeline blocks (see `reduceEvents`).
 * - No pre-tool hook, so `before` content is reconstructed from git instead of
 *   snapshotted (see `DiffCapture.prime` / `recordAfterTheFact`).
 * - No hooks or `canUseTool` at all; safety is the CLI's own OS sandbox.
 * - No in-process MCP, so `get_element_context` is not offered — every field it
 *   would return is already rendered into the prompt text.
 * - No system-prompt option, so the preamble rides on the first turn's text.
 * - No `maxTurns`, `maxBudgetUsd`, cost reporting, or session forking.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirtyFiles } from "@airship/git";
import {
  EDIT_OUTPUT_JSON_SCHEMA,
  type EditStructuredOutput,
  EditStructuredOutputSchema,
  type Usage,
} from "@airship/protocol";
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import {
  type AgentAdapter,
  type AgentRunContext,
  type AgentRunOutcome,
  failureText,
} from "../agent";
import { systemPrompt } from "../prompt";
import { describeTool } from "../tool-summary";
import {
  mapTodos,
  normalizeFileChange,
  normalizeItem,
  toCodexEffort,
} from "./codex-events";
import { writeImages } from "./codex-images";
import { synthesizePatch } from "./shared";

/**
 * A TOML scalar a `--config` override can carry. Not `string` alone: the SDK
 * quotes a JS string, so `network_access` must arrive as a real boolean to land
 * as one on the CLI.
 */
export type CodexConfigValue = string | number | boolean;

/** Per-turn knobs the CLI hands through untouched. */
export interface CodexSettings {
  /** Override the bundled binary (Homebrew, `cargo install`, …). */
  codexPath?: string;
  /** Repeatable `--config k=v` pairs, the escape hatch for anything unmodelled. */
  config?: Record<string, CodexConfigValue>;
}

/**
 * `--safe` confines writes to the project and cuts the network; the default
 * turns the sandbox off entirely, matching `codex --yolo`, which resolves to
 * exactly `danger-full-access` (codex-rs/exec/src/lib.rs).
 */
function threadOptions(ctx: AgentRunContext): ThreadOptions {
  const { input } = ctx;
  const safe = input.safe ?? false;
  return {
    // Nothing to approve either way: there is no interactive channel back to
    // the user from inside a job.
    approvalPolicy: "never",
    model: input.model,
    modelReasoningEffort: toCodexEffort(input.effort),
    networkAccessEnabled: !safe,
    sandboxMode: safe ? "workspace-write" : "danger-full-access",
    // Codex refuses to run outside a git repo. Airship's undo is git-based, so
    // that is a constraint worth keeping rather than working around.
    skipGitRepoCheck: false,
    // With the network off, leaving search enabled hands the model a tool that
    // can only ever error.
    webSearchMode: safe ? "disabled" : "live",
    workingDirectory: input.cwd,
  };
}

/** Model-authored JSON, so it is validated rather than cast. */
function parseStructured(text: string): EditStructuredOutput | null {
  try {
    return EditStructuredOutputSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Translate the event stream into recorder calls.
 *
 * Split out from `run` and exported so it can be driven by a hand-written event
 * array in tests — the alternative is spawning the real CLI to assert on a
 * timeline.
 */
/** The `item` carried by `item.started` / `item.updated` / `item.completed`. */
type ThreadItem = Extract<ThreadEvent, { type: "item.completed" }>["item"];

interface ReduceHooks {
  /** Re-scan for writes made by shell commands rather than patch items. */
  rescanDirty?: () => Set<string>;
}

/**
 * The one buffered agent message, and the act of flushing it.
 *
 * With an output schema set, the *last* agent message is the structured JSON
 * rather than prose. Buffering one message means earlier commentary still
 * renders while the final payload never leaks into the transcript as a blob.
 */
interface PendingMessage {
  commit: () => void;
  message: string | null;
}

function pendingMessageFor(ctx: AgentRunContext): PendingMessage {
  const { events: sink, recorder } = ctx;
  return {
    commit() {
      if (this.message) {
        recorder.commitBlock("text", this.message);
        sink.onText?.(this.message);
        this.message = null;
      }
    },
    message: null,
  };
}

/**
 * A completed `file_change`. Codex emits no `item.started` for a patch, so each
 * write is opened and closed in one breath — there is no pending phase to
 * render.
 */
function recordFileChange(
  item: Extract<ThreadItem, { type: "file_change" }>,
  ctx: AgentRunContext
): void {
  const { diffs, emitStep, recorder } = ctx;
  for (const change of item.changes) {
    diffs.recordAfterTheFact(change.path);
  }
  for (const tool of normalizeFileChange(item)) {
    const path = (tool.input as { file_path: string }).file_path;
    recorder.openTool(tool.id, tool.name, tool.input, null);
    const step = describeTool(tool.name, tool.input);
    if (step) {
      emitStep(step);
    }
    const pair = diffs.pairFor(path);
    recorder.closeTool(
      tool.id,
      Boolean(tool.isError),
      tool.content,
      pair ? synthesizePatch(pair.before, pair.after) : undefined
    );
  }
}

/** Anything that is neither a message, a plan, nor a patch: a tool call. */
function recordToolItem(
  item: ThreadItem,
  done: boolean,
  ctx: AgentRunContext,
  hooks: ReduceHooks
): void {
  const { diffs, emitStep, recorder } = ctx;
  const tool = normalizeItem(item);
  if (!tool) {
    return;
  }
  if (!done) {
    recorder.openTool(tool.id, tool.name, tool.input, null);
    const step = describeTool(tool.name, tool.input);
    if (step) {
      emitStep(step);
    }
    return;
  }
  recorder.closeTool(tool.id, Boolean(tool.isError), tool.content, tool.typed);
  // A shell command can write files without ever producing a `file_change`;
  // `sed -i` and codemods both do. Without this rescan those edits are
  // invisible to the diff *and* to undo.
  //
  // Every dirty path is offered, not just ones that became dirty during the
  // turn: a file the user had already modified is dirty before *and* after, so
  // filtering on "newly dirty" would skip the very case this exists for.
  // Re-offering costs nothing — the baseline is only recorded once, and
  // `finalize` drops any file whose content did not actually move.
  if (item.type === "command_execution" && hooks.rescanDirty) {
    for (const path of hooks.rescanDirty()) {
      diffs.recordAfterTheFact(path);
    }
  }
}

/** The `item.*` branch of `reduceEvents`, which is most of the stream. */
function reduceItem(
  item: ThreadItem,
  done: boolean,
  ctx: AgentRunContext,
  hooks: ReduceHooks,
  pending: PendingMessage
): void {
  const { emitStep, events: sink, recorder } = ctx;

  if (item.type === "agent_message") {
    if (done) {
      pending.commit();
      pending.message = item.text;
    }
    return;
  }

  if (item.type === "reasoning") {
    if (done && item.text) {
      recorder.commitBlock("thinking", item.text);
    }
    return;
  }

  if (item.type === "todo_list") {
    const todos = mapTodos(item);
    if (todos) {
      // The recorder patches a repeat id rather than appending, which is
      // exactly `item.updated`'s semantics for a rewritten plan.
      recorder.todos(item.id, todos);
      sink.onTodos?.(todos);
      emitStep("Planning the change");
    }
    return;
  }

  if (item.type === "error") {
    // Deliberately does NOT fail the turn. Codex emits an error *item* for
    // config warnings, deprecation notices and model reroutes
    // (codex-rs/exec/.../event_processor_with_jsonl_output.rs) — a reroute
    // happens routinely under load, and failing on it would throw away a
    // perfectly good edit and its summary. Real failures arrive as
    // `turn.failed` or a top-level `error` event, both handled by the caller.
    // Surfaced as a row so it is visible, not swallowed.
    if (done) {
      recorder.openTool(item.id, "Warning", {}, null);
      recorder.closeTool(item.id, true, item.message);
    }
    return;
  }

  if (item.type === "file_change") {
    if (done) {
      recordFileChange(item, ctx);
    }
    return;
  }

  recordToolItem(item, done, ctx, hooks);
}

export async function reduceEvents(
  events: AsyncIterable<ThreadEvent>,
  ctx: AgentRunContext,
  hooks: ReduceHooks = {}
): Promise<AgentRunOutcome> {
  const { emitStep, events: sink } = ctx;
  let sessionId: string | null = ctx.input.resumeSessionId ?? null;
  let usage: Usage | undefined;
  let error: string | undefined;
  const pending = pendingMessageFor(ctx);

  try {
    for await (const event of events) {
      switch (event.type) {
        case "thread.started": {
          sessionId = event.thread_id;
          sink.onSessionId?.(sessionId);
          break;
        }

        case "turn.started": {
          // Codex streams no reasoning deltas, so a long thinking phase with no
          // tool calls would otherwise show nothing at all.
          emitStep("Thinking");
          break;
        }

        case "item.started":
        case "item.updated":
        case "item.completed": {
          reduceItem(
            event.item,
            event.type === "item.completed",
            ctx,
            hooks,
            pending
          );
          break;
        }

        case "turn.completed": {
          const u = event.usage;
          usage = {
            inputTokens: u?.input_tokens,
            // Reasoning tokens bill as output, so folding them in is the honest
            // number. No `costUsd`: Codex reports tokens only.
            outputTokens:
              (u?.output_tokens ?? 0) + (u?.reasoning_output_tokens ?? 0),
          };
          break;
        }

        case "turn.failed": {
          error = event.error?.message ?? "turn failed";
          break;
        }

        case "error": {
          error = event.message;
          break;
        }

        default:
          break;
      }
    }
  } catch (err) {
    // The SDK drains the event stream *then* throws if the CLI exited non-zero,
    // so a run that already told us exactly what went wrong ("You've hit your
    // usage limit") arrives here a second time as a generic "Codex Exec exited
    // with code 1". Whatever the stream said is strictly more useful, so an
    // error already in hand wins over the exit status that followed it.
    error ??= failureText(err, ctx.input.abortController);
  }

  // Resolve the buffered final message: structured payload, or prose if the
  // model ignored the schema. Sniffing for braces would misfire on prose that
  // happens to start with one.
  let structured: EditStructuredOutput | null = null;
  let resultText = "";
  if (pending.message !== null) {
    structured = parseStructured(pending.message);
    if (structured) {
      pending.message = null;
    } else {
      resultText = pending.message;
      pending.commit();
    }
  }

  return { error, resultText, sessionId, structured, usage };
}

async function run(ctx: AgentRunContext): Promise<AgentRunOutcome> {
  const { input } = ctx;
  const { Codex } = await import("@openai/codex-sdk");

  const codex = new Codex({
    codexPathOverride: input.codex?.codexPath,
    // Thread options are emitted after these, so a passthrough key that
    // collides with the safety settings loses — which is the intent.
    config: input.codex?.config,
  });

  // The diff baseline is already seeded — `runEdit` primes it for any adapter
  // that declares `needsGitBaseline`.

  // Codex cannot fork a thread. Starting a fresh one is the closest honest
  // reading of "try a different approach", and is far better than turning a UI
  // button into an error — but the model is told, so it does not act as though
  // it remembers a conversation it never had.
  const forking = Boolean(input.fork && input.resumeSessionId);
  const resuming = Boolean(input.resumeSessionId) && !forking;
  const thread =
    resuming && input.resumeSessionId
      ? codex.resumeThread(input.resumeSessionId, threadOptions(ctx))
      : codex.startThread(threadOptions(ctx));

  // The preamble is skipped on resume: the thread history already carries it,
  // and repeating instructions the model already followed is pure noise.
  const parts: string[] = [];
  if (!resuming) {
    parts.push(systemPrompt("codex"));
  }
  if (forking) {
    parts.push(
      "This is a fresh attempt at the following; the prior conversation is not available."
    );
  }
  parts.push(ctx.promptText);
  const text = parts.join("\n\n---\n\n");

  const scratch = writeImages(input.images);
  try {
    const { events } = await thread.runStreamed(
      [
        { text, type: "text" },
        ...scratch.paths.map((path) => ({
          path,
          type: "local_image" as const,
        })),
      ],
      {
        outputSchema: EDIT_OUTPUT_JSON_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        signal: input.abortController?.signal,
      }
    );
    const outcome = await reduceEvents(events, ctx, {
      rescanDirty: () => dirtyFiles(input.cwd),
    });
    return {
      ...outcome,
      // A fork runs on a brand-new thread, so its id is whatever this run
      // produced — never the parent's. `reduceEvents` seeds from
      // `resumeSessionId`, which on a fork names the thread we deliberately
      // did not continue; carrying it forward would file this job's history
      // under a conversation it has nothing to do with.
      sessionId: forking ? thread.id : (outcome.sessionId ?? thread.id),
    };
  } catch (err) {
    return {
      error: failureText(err, input.abortController),
      sessionId: forking
        ? thread.id
        : (thread.id ?? input.resumeSessionId ?? null),
    };
  } finally {
    // The abort path throws, so this cannot live on the success branch —
    // otherwise every cancelled edit leaks a directory of screenshots.
    scratch.dispose();
  }
}

function checkAuth(): { ok: boolean; reason?: string } {
  if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) {
    return { ok: true };
  }
  if (existsSync(join(homedir(), ".codex", "auth.json"))) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "No CODEX_API_KEY found and no ~/.codex/auth.json detected. Set CODEX_API_KEY or run `codex login` once to sign in.",
  };
}

export const codexAdapter: AgentAdapter = {
  checkAuth,
  kind: "codex",
  needsGitBaseline: true,
  run,
};
