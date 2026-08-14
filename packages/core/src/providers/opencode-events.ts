/**
 * Pure translation from OpenCode wire shapes into the Claude-shaped tuples the
 * shared summarizer understands. No I/O, no SDK, no recorder — which is what
 * makes the OpenCode event loop testable without a running server.
 *
 * The vocabulary itself, and the reason for translating into it, live in
 * `./shared`.
 */
import {
  EditStructuredOutputSchema,
  type Effort,
  type TodoItem,
} from "@airship/protocol";
import type {
  OcEvent,
  OcMessageError,
  OcPermissionAsked,
  OcToolPart,
  OcToolState,
} from "./opencode-wire";
import type { NormalizedTool } from "./shared";

/**
 * The wrappers a structured payload actually arrives in.
 *
 * Both opencode's `format` option and airship's own system-prompt instruction
 * ask for `<structuredoutput>` tags — either way the tags are a prompt-level
 * convention in the text, so compliance varies by model. The same model
 * observed using the tags on one turn returned a ```json fence on the next.
 * Both are recognised, longest opener first so ```json wins over the bare
 * fence at the same offset. (On the wire, `format` is additionally a forced
 * tool call; see `isForcedToolChoiceRejection`.)
 */
export const STRUCTURED_WRAPPERS: ReadonlyArray<{
  close: string;
  open: string;
}> = [
  { close: "</structuredoutput>", open: "<structuredoutput>" },
  { close: "```", open: "```json" },
  { close: "```", open: "```" },
];

/** Every opener, for the streaming holdback in the reducer. */
export const STRUCTURED_OPENERS = STRUCTURED_WRAPPERS.map((w) => w.open);

/** See `bareCandidates`. Global so every line-opening `{` is a candidate. */
const BARE_OBJECT_ALL = /(?:^|\n)[ \t]*\{/g;

/** See `isForcedToolChoiceRejection`. Matches `tool_choice` and `toolChoice`. */
const TOOL_CHOICE = /tool[_ ]?choice/i;

/** Where a candidate payload sits inside the text. `close: null` = bare object. */
interface PayloadCandidate {
  /** Where the wrapper (or brace) starts — the prose cut point. */
  at: number;
  close: string | null;
  /** Where the payload text starts. */
  from: number;
}

/**
 * A bound on how many candidate regions one message is worth scanning. Real
 * messages carry one payload and a handful of fences; a pathological wall of
 * fences should not turn every render tick into a JSON-parse storm.
 */
const CANDIDATE_CAP = 32;

/** Every wrapper occurrence, in text order; longer opener wins a tied start. */
function wrapperCandidates(text: string): PayloadCandidate[] {
  const out: PayloadCandidate[] = [];
  for (const { close, open } of STRUCTURED_WRAPPERS) {
    let at = text.indexOf(open);
    while (at !== -1 && out.length < CANDIDATE_CAP) {
      out.push({ at, close, from: at + open.length });
      at = text.indexOf(open, at + open.length);
    }
  }
  return out.sort((a, b) => a.at - b.at || b.from - a.from);
}

/**
 * A `{` opening its own line — the unwrapped form, which is what the model
 * emits when it ignores the wrapper instruction entirely (observed on a real
 * run). Anchored to a line start so a brace quoted mid-sentence is not
 * mistaken for the start of a payload. Each candidate runs to end-of-text.
 */
function bareCandidates(text: string): PayloadCandidate[] {
  const out: PayloadCandidate[] = [];
  BARE_OBJECT_ALL.lastIndex = 0;
  let match = BARE_OBJECT_ALL.exec(text);
  while (match && out.length < CANDIDATE_CAP) {
    out.push({ at: match.index, close: null, from: match.index });
    match = BARE_OBJECT_ALL.exec(text);
  }
  return out;
}

/** The candidate's contents, up to its close marker (or end-of-text). */
function candidatePayload(text: string, c: PayloadCandidate): string {
  if (c.close === null) {
    return text.slice(c.from).trim();
  }
  const closeAt = text.indexOf(c.close, c.from);
  // An unterminated wrapper means the block is still streaming; everything
  // after the opener is payload-so-far.
  const contents =
    closeAt === -1 ? text.slice(c.from) : text.slice(c.from, closeAt);
  return contents.trim();
}

/** Does this region parse *and* validate as the edit schema? */
function validatesAsEdit(payload: string): boolean {
  try {
    return EditStructuredOutputSchema.safeParse(JSON.parse(payload)).success;
  } catch {
    return false;
  }
}

/**
 * Strip the structured-output block out of assistant prose.
 *
 * The model is asked to append the JSON wrapped in `<structuredoutput>` tags,
 * inside an ordinary text part, after whatever prose it wanted to write —
 * opencode's `format` asks for the same convention, and airship's own prompt
 * instruction asks for it when `format` is not sent. Either way the payload
 * has to be lifted out here, and the prose it was appended to has to survive:
 * unlike Codex, where the final message is *either* JSON or prose, on
 * OpenCode it is routinely both.
 *
 * Selection is parse-aware: the winner is the first candidate region whose
 * contents actually validate as the edit schema. "Earliest opener wins" alone
 * was a real bug — prose like "Here's the change: ```css …``` <structuredoutput>
 * {…}</structuredoutput>" split at the CSS fence, the fence contents failed to
 * parse, and the whole message (raw JSON included) was released into the
 * transcript while the payload sat unparsed after the fence.
 *
 * When nothing validates yet — the payload is still streaming, or there is
 * none — the pre-validation semantics hold: split at the earliest wrapper
 * (longer opener winning a tie), else at the first line-opening `{` as a
 * deferral rather than a decision: the caller parses it, and releases it as
 * ordinary prose if it does not validate. `prose` is always a strict *prefix*
 * of `text`, never reassembled from both sides of the wrapper — that is what
 * lets the reducer treat every render as an append, and the validating cut
 * point can only sit at-or-after the fallback one, so the prefix only grows.
 */
export function splitStructured(text: string): {
  payload: string | null;
  prose: string;
} {
  const wrappers = wrapperCandidates(text);
  const bare = bareCandidates(text);
  const all = [...wrappers, ...bare].sort(
    (a, b) => a.at - b.at || b.from - a.from
  );
  for (const c of all) {
    const payload = candidatePayload(text, c);
    if (validatesAsEdit(payload)) {
      return { payload, prose: text.slice(0, c.at) };
    }
  }
  // Nothing validates (yet). Wrappers take precedence over the brace sniff,
  // exactly as before validation-aware selection existed.
  const fallback = wrappers[0] ?? bare[0];
  if (!fallback) {
    return { payload: null, prose: text };
  }
  return {
    payload: candidatePayload(text, fallback),
    prose: text.slice(0, fallback.at),
  };
}

/**
 * A provider rejecting opencode's forced tool choice.
 *
 * OpenCode implements `format: { type: "json_schema" }` by registering an
 * internal StructuredOutput tool and forcing `toolChoice: "required"` for the
 * prompt loop — and providers reject that request shape on thinking/reasoning
 * models with an HTTP 400. Observed payload (DeepSeek, opencode 1.18.13):
 *
 *   {"error":{"message":"Error from provider (DeepSeek): Thinking mode does
 *    not support this tool_choice","type":"invalid_request_error"}}
 *   → name "APIError", statusCode 400, isRetryable false
 *
 * Also reported for Kimi K2.5, Qwen3.5, and Anthropic models with thinking
 * enabled. Upstream declined the fix: anomalyco/opencode#15226 closed
 * not_planned; the relax-to-`auto` PR #29565 was closed unmerged by a
 * stale-bot.
 *
 * Matched on structure first, text second: a 400 when the status is present
 * at all, plus `tool_choice`/`toolChoice` in the message or response body —
 * the one invariant across every reported wording, and a string no
 * airship-originated error contains. Deliberately NOT matched: "thinking"
 * alone (it is also a step label in the reducer) or a bare 400.
 */
export function isForcedToolChoiceRejection(
  err: OcMessageError | undefined
): boolean {
  const data = err?.data;
  if (!data) {
    return false;
  }
  if (data.statusCode !== undefined && data.statusCode !== 400) {
    return false;
  }
  return TOOL_CHOICE.test(`${data.message ?? ""}\n${data.responseBody ?? ""}`);
}

/**
 * Normalize an HTTP-level error payload into the message-error shape.
 *
 * The generated client is created without `throwOnError`, so a non-2xx
 * response arrives as `{ error }` with no data — and the body of a rejected
 * prompt is opencode's own NamedError serialization, which already matches
 * `OcMessageError`. Anything else is folded down to a message so the caller
 * always has something classifiable.
 */
export function toMessageError(err: unknown): OcMessageError {
  if (typeof err === "string") {
    return { data: { message: err } };
  }
  if (err && typeof err === "object") {
    const e = err as {
      data?: OcMessageError["data"];
      message?: unknown;
      name?: unknown;
    };
    if (e.data !== undefined || typeof e.name === "string") {
      return {
        data: e.data,
        name: typeof e.name === "string" ? e.name : undefined,
      };
    }
    if (typeof e.message === "string") {
      return { data: { message: e.message } };
    }
  }
  return { data: { message: "request failed" } };
}

/**
 * OpenCode exposes no reasoning-effort control anywhere in the session or
 * prompt API — verified against the live OpenAPI document. Kept as a named
 * no-op so the omission is visible at the call site rather than looking like
 * something nobody got round to wiring up.
 */
export const toOpencodeEffort = (_effort?: Effort): undefined => undefined;

/**
 * Map an opencode tool id onto the shared vocabulary.
 *
 * The real id list, read from the running server, is: invalid, question, bash,
 * read, glob, grep, edit, write, task, webfetch, todowrite, websearch, skill,
 * apply_patch. Anything unmapped falls through to `summarizeUnknown`, which is
 * the honest outcome — inventing a mapping for `task` or `skill` would make the
 * summarizer apply rules written for a different tool's output shape.
 */
export function toolNameFor(id: string): string {
  switch (id) {
    case "bash":
      return "Bash";
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "apply_patch":
      return "Edit";
    case "write":
      return "Write";
    case "grep":
      return "Grep";
    case "glob":
      return "Glob";
    case "todowrite":
      return "TodoWrite";
    case "webfetch":
      return "WebFetch";
    case "websearch":
      return "WebSearch";
    default:
      return id;
  }
}

/**
 * Rename opencode's input keys to the ones `tool-summary.ts` reads.
 *
 * This is not cosmetic. OpenCode calls the path `filePath` where Claude calls
 * it `file_path`, and every header, status line and argument row in the
 * timeline is keyed off the Claude spelling — without the rename an `Edit` row
 * renders as a bare `Edit` with no path, and the status pill says "Editing
 * files" for the whole run.
 */
const INPUT_KEY_ALIASES: Record<string, string> = {
  filePath: "file_path",
  newString: "new_string",
  oldString: "old_string",
};

function translateInput(input: Record<string, unknown> | undefined): unknown {
  if (!input) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[INPUT_KEY_ALIASES[key] ?? key] = value;
  }
  return out;
}

/** The absolute path a tool call writes to, when it names one. */
export function pathFromToolPart(part: OcToolPart): string | null {
  const fp = part.state.input?.filePath ?? part.state.input?.file_path;
  return typeof fp === "string" && fp ? fp : null;
}

/** True for the tools whose completion means a file on disk moved. */
export function isWriteTool(id: string): boolean {
  return id === "edit" || id === "write" || id === "apply_patch";
}

/**
 * The richer `tool_use_result` analogue, synthesized from opencode's metadata.
 *
 * `summarizeBash` reads `exitCode`/`stdout`, and opencode reports those as
 * `metadata.exit`/`metadata.output` — so a failing command renders as
 * `exit 1 — <reason>` with the tail of its log, exactly as it does on the other
 * two backends, rather than as a bare confirmation.
 */
export function typedForTool(
  name: string,
  state: OcToolState
): unknown | undefined {
  if (name !== "Bash") {
    return;
  }
  const meta = state.metadata ?? {};
  const exit = typeof meta.exit === "number" ? meta.exit : 0;
  const stdout =
    typeof meta.output === "string" ? meta.output : (state.output ?? "");
  return { exitCode: exit, stdout };
}

/**
 * Express a tool part in the shared vocabulary.
 *
 * A non-zero shell exit is deliberately never flagged as an error. OpenCode
 * already agrees — a failing `ls` came back as `status: "completed"` with
 * `metadata.exit: 1` — but the guard is kept explicit because the summarizer
 * short-circuits on `isError` to a bare "Error: <first line>", losing both the
 * exit code and the tail of the output that make a failing build readable.
 */
export function normalizeToolPart(part: OcToolPart): NormalizedTool {
  const { state } = part;
  const name = toolNameFor(part.tool);
  const done = state.status === "completed" || state.status === "error";
  const input = translateInput(state.input);

  if (!done) {
    return { id: part.id, input, isError: false, name };
  }

  // `edit` carries a real unified diff in metadata; handing it to the
  // summarizer as the result text means `countsFromPatchText` recovers a true
  // `+N −M` even when the before/after pair is unavailable.
  const diff = state.metadata?.diff;
  const content =
    state.status === "error"
      ? state.error
      : ((typeof diff === "string" && diff ? diff : state.output) ?? "");

  return {
    content,
    id: part.id,
    input,
    isError: state.status === "error" && name !== "Bash",
    name,
    typed: typedForTool(name, state),
  };
}

/** OpenCode todos carry a real tri-state status, unlike Codex's done/not-done. */
export function mapTodos(
  todos: Array<{ content?: string; status?: string }> | undefined
): TodoItem[] | null {
  if (!todos?.length) {
    return null;
  }
  const mapped: TodoItem[] = todos
    .map((t) => ({
      content: typeof t.content === "string" ? t.content : "",
      status: normalizeTodoStatus(t.status),
    }))
    .filter((t) => t.content);
  return mapped.length ? mapped : null;
}

function normalizeTodoStatus(status: string | undefined): TodoItem["status"] {
  if (status === "completed" || status === "cancelled") {
    return "completed";
  }
  return status === "in_progress" ? "in_progress" : "pending";
}

/**
 * Airship's `--model` is a free-form string; opencode wants a provider/model
 * pair. A bare id with no slash is passed through as the model alone, letting
 * the server resolve it against the configured default provider.
 */
export function modelRefFor(
  model?: string
): { modelID: string; providerID?: string } | undefined {
  const trimmed = model?.trim();
  if (!trimmed) {
    return;
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { modelID: trimmed };
  }
  return {
    modelID: trimmed.slice(slash + 1),
    providerID: trimmed.slice(0, slash),
  };
}

/**
 * Which session an event belongs to, or `undefined` when it belongs to none.
 *
 * This is the single most load-bearing function in the OpenCode adapter. The
 * event stream is per-server, not per-session, so with one shared server every
 * job sees every other job's events. Anything that is not provably ours is
 * dropped rather than guessed at.
 *
 * `file.edited` is the reason this returns `undefined` rather than a best
 * guess: it names a path with no session attached, and airship's undo restores
 * from the captured diff — so attributing another job's write to this job's
 * diff would not merely mis-render a row, it would revert the user's work.
 */
export function sessionIdOf(event: OcEvent): string | undefined {
  const props = event.properties as Record<string, unknown> | undefined;
  if (!props) {
    return;
  }
  const direct = props.sessionID;
  if (typeof direct === "string") {
    return direct;
  }
  const info = props.info as { sessionID?: unknown } | undefined;
  if (info && typeof info.sessionID === "string") {
    return info.sessionID;
  }
  const part = props.part as { sessionID?: unknown } | undefined;
  if (part && typeof part.sessionID === "string") {
    return part.sessionID;
  }
}

/** A human-readable line for a permission we are about to refuse. */
export function describePermission(p: OcPermissionAsked): string {
  const meta = p.metadata ?? {};
  const candidates = [meta.command, meta.filePath];
  const detail = candidates.find((v) => typeof v === "string" && v) ?? "";
  return detail ? `${p.permission}: ${detail}` : p.permission;
}
