/**
 * The OpenCode event reducer: one event in, recorder calls out.
 *
 * Split out of the adapter and made *synchronous* so it can be driven by a
 * plain array of event literals in tests — no server, no SDK, no async
 * generator. That matters more here than it did for Codex, because OpenCode's
 * stream is both larger (a single real turn produced 313 events) and
 * multiplexed across every session on the server.
 *
 * `reconcileParts` replays the authoritative `parts` array that the blocking
 * prompt call returns, through this same reducer. Every write is guarded by an
 * id set, so the replay is a no-op for anything the stream already delivered
 * and a repair for anything it dropped. That is what makes SSE reliability a
 * performance concern rather than a correctness one.
 */
import {
  type EditStructuredOutput,
  EditStructuredOutputSchema,
  type TodoItem,
  type Usage,
} from "@airship/protocol";
import type { AgentRunContext } from "../agent";
import { describeTool } from "../tool-summary";
import {
  describePermission,
  isWriteTool,
  mapTodos,
  normalizeToolPart,
  pathFromToolPart,
  STRUCTURED_OPENERS,
  splitStructured,
} from "./opencode-events";
import type {
  OcEvent,
  OcMessageError,
  OcMessageInfo,
  OcPart,
  OcPermissionAsked,
  OcToolPart,
} from "./opencode-wire";
import { synthesizePatch } from "./shared";

type BlockKind = "text" | "thinking";

/** A streamed prose or reasoning block, keyed by the part id that carries it. */
interface BlockState {
  /** How much of the part's *visible* text has been handed to the recorder. */
  emitted: number;
  index: number;
  kind: BlockKind;
}

export interface ReduceState {
  blocks: Map<string, BlockState>;
  closedTools: Set<string>;
  cost?: number;
  error?: string;
  idle: boolean;
  /** Prose from the latest assistant text part, used when there is no JSON. */
  lastProse: string;
  nextBlockIndex: number;
  openedTools: Set<string>;
  /** Whether a part streams as prose or as reasoning; set when it is announced. */
  partKind: Map<string, BlockKind>;
  /** The `<structuredoutput>` payload, lifted out of the text it rode in on. */
  payload: string | null;
  /** Accumulated text per part, so deltas can render before the next snapshot. */
  raw: Map<string, string>;
  repliedPermissions: Set<string>;
  usage?: Usage;
  /** The turn's anchor for `session.revert`, observed rather than minted. */
  userMessageId: string | null;
}

export function newReduceState(): ReduceState {
  return {
    blocks: new Map(),
    closedTools: new Set(),
    idle: false,
    lastProse: "",
    nextBlockIndex: 0,
    openedTools: new Set(),
    partKind: new Map(),
    payload: null,
    raw: new Map(),
    repliedPermissions: new Set(),
    userMessageId: null,
  };
}

export interface ReduceHooks {
  /** Answer a live permission request. Leaving one unanswered hangs the turn. */
  onPermission?: (permission: OcPermissionAsked) => void;
  /** Re-scan for writes made by shell commands rather than edit tools. */
  rescanDirty?: () => Set<string>;
}

function messageText(err: OcMessageError | undefined): string | undefined {
  if (!err) {
    return;
  }
  return err.data?.message ?? err.name ?? "request failed";
}

/**
 * Does this wrapped region parse as the edit schema?
 *
 * The parse — not the wrapper — is what decides whether text is hidden, so it
 * has to happen here in the reducer rather than only at the end of the turn.
 */
export function parseStructured(
  text: string | null
): EditStructuredOutput | null {
  if (!text) {
    return null;
  }
  try {
    return EditStructuredOutputSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prose and reasoning
// ---------------------------------------------------------------------------

/**
 * How much of a trailing partial `<structuredoutput>` opener to hold back.
 *
 * The opener arrives split across deltas — `"<struct"`, then `"uredoutput>"` —
 * so a renderer that emitted everything it had would print the fragment before
 * it could recognise what it was, and nothing can unsend a token the client has
 * already drawn. Holding back the longest suffix that could still become the
 * opener costs at most a few characters of latency and makes the leak
 * impossible rather than unlikely.
 */
function withheldTail(text: string): number {
  let end = text.length;
  const longest = Math.max(...STRUCTURED_OPENERS.map((o) => o.length));
  const max = Math.min(longest - 1, end);
  outer: for (let n = max; n > 0; n -= 1) {
    const suffix = text.slice(end - n);
    for (const opener of STRUCTURED_OPENERS) {
      if (opener.startsWith(suffix)) {
        end -= n;
        break outer;
      }
    }
  }
  // Trailing whitespace goes with it. The model writes a newline between its
  // prose and the tag, so emitting that newline the moment it arrives would
  // strand it at the end of the transcript once the tag it introduced is
  // hidden. Deferring costs nothing: it is emitted with the next visible
  // character, or on the final flush.
  while (end > 0 && WHITESPACE.test(text[end - 1])) {
    end -= 1;
  }
  return text.length - end;
}

const WHITESPACE = /\s/;

function blockFor(
  state: ReduceState,
  partId: string,
  kind: BlockKind,
  ctx: AgentRunContext
): BlockState {
  const existing = state.blocks.get(partId);
  if (existing) {
    return existing;
  }
  const block: BlockState = { emitted: 0, index: state.nextBlockIndex, kind };
  state.nextBlockIndex += 1;
  state.blocks.set(partId, block);
  ctx.recorder.openBlock(block.index, kind);
  return block;
}

/**
 * What of a text part should be on screen right now.
 *
 * Three cases, and the ordering between them is the whole point:
 *
 * - **No wrapper yet.** Show everything except a trailing fragment that could
 *   still turn into one, because a token already drawn cannot be recalled.
 * - **A wrapper whose contents parse.** That is the structured payload; keep it
 *   hidden permanently, along with the whitespace that introduced it.
 * - **A wrapper whose contents do not parse.** Keep hiding it while the block
 *   is still arriving — it may yet complete — but once the turn is over,
 *   release it as ordinary prose. A summary that quotes a fenced snippet must
 *   not lose the snippet just because ``` is also how one model chose to wrap
 *   its JSON.
 *
 * `prose` is always a strict prefix of the raw text, so every one of these can
 * be emitted as an append against what has already been shown.
 */
function visibleProse(
  state: ReduceState,
  text: string,
  final: boolean
): string {
  const { payload, prose } = splitStructured(text);
  if (payload === null) {
    return final ? text : text.slice(0, text.length - withheldTail(text));
  }
  if (parseStructured(payload)) {
    state.payload = payload;
    return prose.trimEnd();
  }
  return final ? text : prose.trimEnd();
}

/**
 * Render everything newly visible in a part.
 *
 * The full accumulated text is re-split on every call rather than appending the
 * raw delta, because the structured payload arrives *inside* the same text part
 * as the prose that precedes it. Appending blind would stream
 * `<structuredoutput>{"summary":…` straight into the transcript.
 */
function render(
  state: ReduceState,
  partId: string,
  kind: BlockKind,
  final: boolean,
  ctx: AgentRunContext
): void {
  const text = state.raw.get(partId) ?? "";
  let visible: string;
  if (kind === "thinking") {
    visible = text;
  } else {
    visible = visibleProse(state, text, final);
    state.lastProse = visible;
  }
  if (!visible) {
    return;
  }

  const block = blockFor(state, partId, kind, ctx);
  if (visible.length <= block.emitted) {
    return;
  }
  const chunk = visible.slice(block.emitted);
  block.emitted = visible.length;
  ctx.recorder.blockDelta(block.index, kind, chunk);
  if (kind === "text") {
    ctx.events.onText?.(chunk);
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Open a tool row, once.
 *
 * A `pending` part is skipped while its input is still empty — verified against
 * the real server, which sends `{"status":"pending","input":{},"raw":""}`
 * before the arguments finish streaming. The recorder snapshots the input at
 * open time, so opening then would freeze a permanent `Bash()` with no command
 * into the transcript. A part that jumps straight to `completed` still opens
 * here first, so nothing is ever dropped.
 */
function ensureToolOpen(
  part: OcToolPart,
  state: ReduceState,
  ctx: AgentRunContext
): boolean {
  if (state.openedTools.has(part.id)) {
    return true;
  }
  const hasInput = Object.keys(part.state.input ?? {}).length > 0;
  if (part.state.status === "pending" && !hasInput) {
    return false;
  }
  const tool = normalizeToolPart(part);
  ctx.recorder.openTool(part.id, tool.name, tool.input, null);
  state.openedTools.add(part.id);
  const step = describeTool(tool.name, tool.input);
  if (step) {
    ctx.emitStep(step);
  }
  return true;
}

function closeToolPart(
  part: OcToolPart,
  state: ReduceState,
  ctx: AgentRunContext,
  hooks: ReduceHooks
): void {
  if (state.closedTools.has(part.id) || !ensureToolOpen(part, state, ctx)) {
    return;
  }
  state.closedTools.add(part.id);

  const tool = normalizeToolPart(part);
  const path = pathFromToolPart(part);

  // Record the write before summarizing, so `pairFor` can supply the real
  // before/after and the row shows a true `+N −M` rather than a bare
  // confirmation.
  let { typed } = tool;
  if (path && isWriteTool(part.tool)) {
    ctx.diffs.recordAfterTheFact(path);
    const pair = ctx.diffs.pairFor(path);
    if (pair) {
      typed = synthesizePatch(pair.before, pair.after);
    }
  }

  ctx.recorder.closeTool(part.id, Boolean(tool.isError), tool.content, typed);

  // A shell command can write files without ever producing an edit tool call;
  // `sed -i` and codemods both do. Without this rescan those edits are
  // invisible to the diff *and* to undo. Every dirty path is offered, not just
  // newly-dirty ones: a file the user had already modified is dirty before and
  // after, so filtering on "newly dirty" would skip the very case this exists
  // for. Re-offering costs nothing — the baseline is recorded once, and
  // `finalize` drops any file whose content did not actually move.
  if (part.tool === "bash" && hooks.rescanDirty) {
    for (const dirty of hooks.rescanDirty()) {
      ctx.diffs.recordAfterTheFact(dirty);
    }
  }
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function reducePart(
  part: OcPart,
  state: ReduceState,
  ctx: AgentRunContext,
  hooks: ReduceHooks
): void {
  switch (part.type) {
    case "text": {
      // The prompt airship just sent comes back as a text part on the *user*
      // message, and it is not marked synthetic. Rendering it would replay the
      // whole rendered instruction into the transcript as though the model had
      // written it. The user message is announced before its parts, so the id
      // is always known by the time this runs.
      if (part.synthetic || part.messageID === state.userMessageId) {
        return;
      }
      state.partKind.set(part.id, "text");
      // The part's own text is authoritative; deltas only ran ahead of it.
      state.raw.set(part.id, part.text ?? state.raw.get(part.id) ?? "");
      render(state, part.id, "text", false, ctx);
      return;
    }
    case "reasoning": {
      state.partKind.set(part.id, "thinking");
      state.raw.set(part.id, part.text ?? state.raw.get(part.id) ?? "");
      render(state, part.id, "thinking", false, ctx);
      return;
    }
    case "tool": {
      const done =
        part.state.status === "completed" || part.state.status === "error";
      if (done) {
        closeToolPart(part, state, ctx, hooks);
      } else {
        ensureToolOpen(part, state, ctx);
      }
      return;
    }
    case "patch": {
      // Absolute paths for everything the step wrote — the backstop for a write
      // whose own tool call under-reported its paths.
      for (const file of part.files ?? []) {
        ctx.diffs.recordAfterTheFact(file);
      }
      return;
    }
    case "step-finish": {
      const { tokens } = part;
      if (tokens) {
        state.usage = {
          costUsd: state.cost,
          inputTokens: tokens.input,
          // Reasoning tokens bill as output, so folding them in is the honest
          // number — the same call the Codex adapter makes at `turn.completed`.
          outputTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
        };
      }
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function reduceTodos(todos: TodoItem[] | null, ctx: AgentRunContext): void {
  if (!todos) {
    return;
  }
  // A constant id, so an evolving plan patches one row instead of appending a
  // fresh list every time the model revises it.
  ctx.recorder.todos("opencode-todos", todos);
  ctx.events.onTodos?.(todos);
  ctx.emitStep("Planning the change");
}

/** File names only, never the patch body — a session-scoped backstop. */
function recordDiffFiles(
  diff: Array<{ file?: string }> | undefined,
  ctx: AgentRunContext
): void {
  for (const entry of diff ?? []) {
    if (entry.file) {
      ctx.diffs.recordAfterTheFact(entry.file);
    }
  }
}

/** Message-level bookkeeping: the rewind anchor, the cost, and real errors. */
function reduceMessage(info: OcMessageInfo, state: ReduceState): void {
  if (info.role === "user") {
    state.userMessageId ??= info.id;
    return;
  }
  if (typeof info.cost === "number") {
    state.cost = info.cost;
  }
  // A `StructuredOutputError` is not a turn failure: the edit has already been
  // made, and throwing away a good diff plus its summary because opencode's own
  // extractor could not find the JSON — which it routinely cannot, even when
  // the model emitted it correctly — is the wrong trade. The payload is
  // recovered from the text part instead.
  if (info.error && info.error.name !== "StructuredOutputError") {
    state.error ??= messageText(info.error);
  }
}

/** A live permission request, answered exactly once. */
function reducePermission(
  permission: OcPermissionAsked,
  ctx: AgentRunContext,
  state: ReduceState,
  hooks: ReduceHooks
): void {
  if (state.repliedPermissions.has(permission.id)) {
    return;
  }
  state.repliedPermissions.add(permission.id);
  ctx.emitStep(`Checking ${describePermission(permission)}`);
  hooks.onPermission?.(permission);
}

/** One event, applied. Synchronous by design — this is the unit under test. */
export function reduceEvent(
  event: OcEvent,
  ctx: AgentRunContext,
  state: ReduceState,
  hooks: ReduceHooks = {}
): void {
  switch (event.type) {
    case "message.part.delta": {
      // The streaming channel, and the only one there is: a real turn produced
      // 237 deltas against 32 part snapshots, so rendering from snapshots alone
      // would arrive in visible lurches rather than token by token.
      const { delta, partID } = event.properties;
      if (!(delta && partID)) {
        return;
      }
      state.raw.set(partID, (state.raw.get(partID) ?? "") + delta);
      // A part announces itself with an empty snapshot before its deltas start,
      // so the kind is known by now. If it somehow is not, the text is still
      // accumulated and renders on the next snapshot — never dropped.
      const kind = state.partKind.get(partID);
      if (kind) {
        render(state, partID, kind, false, ctx);
      }
      return;
    }

    case "message.part.updated": {
      reducePart(event.properties.part, state, ctx, hooks);
      return;
    }

    case "message.updated": {
      reduceMessage(event.properties.info, state);
      return;
    }

    case "session.status": {
      const kind = event.properties.status?.type;
      if (kind === "busy") {
        ctx.emitStep("Thinking");
      } else if (kind === "retry") {
        ctx.emitStep("Retrying");
      }
      return;
    }

    case "session.idle": {
      state.idle = true;
      return;
    }

    case "session.error": {
      state.error ??= messageText(event.properties.error) ?? "session error";
      return;
    }

    case "session.diff": {
      recordDiffFiles(event.properties.diff, ctx);
      return;
    }

    case "todo.updated": {
      reduceTodos(mapTodos(event.properties.todos), ctx);
      return;
    }

    case "permission.asked": {
      reducePermission(event.properties, ctx, state, hooks);
      return;
    }

    // `file.edited` is deliberately ignored. It names a path and carries no
    // session id, so under the shared server it would attribute another job's
    // write to this job's diff — and undo restores from that diff. Every
    // session-scoped source above already covers the honest cases.
    default:
      return;
  }
}

/**
 * Replay the authoritative parts array. Idempotent: every reducer write is
 * guarded by an id set, so this repairs drops without duplicating anything the
 * stream already delivered.
 */
export function reconcileParts(
  parts: OcPart[] | undefined,
  ctx: AgentRunContext,
  state: ReduceState,
  hooks: ReduceHooks = {}
): void {
  for (const part of parts ?? []) {
    reducePart(part, state, ctx, hooks);
  }
}

/**
 * Flush the held-back delimiter tail and close every open prose block. Called
 * once, after the turn's last event and last reconciled part.
 */
export function finishBlocks(state: ReduceState, ctx: AgentRunContext): void {
  // Every part that accumulated text, not just those that already opened a
  // block. A message deferred in full — one that looked like a payload the
  // whole way through and then failed to parse — has no block yet, and is
  // exactly the case that must still be released here.
  for (const [partId, kind] of state.partKind) {
    render(state, partId, kind, true, ctx);
  }
  for (const block of state.blocks.values()) {
    ctx.recorder.closeBlock(block.index);
  }
  state.blocks.clear();
}
