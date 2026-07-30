/**
 * Pure translation from OpenCode wire shapes into the Claude-shaped tuples the
 * shared summarizer understands. No I/O, no SDK, no recorder — which is what
 * makes the OpenCode event loop testable without a running server.
 *
 * The vocabulary itself, and the reason for translating into it, live in
 * `./shared`.
 */
import type { Effort, TodoItem } from "@airship/protocol";
import type {
  OcEvent,
  OcPermissionAsked,
  OcToolPart,
  OcToolState,
} from "./opencode-wire";
import type { NormalizedTool } from "./shared";

/**
 * The wrappers a structured payload actually arrives in.
 *
 * OpenCode asks for `<structuredoutput>` tags, but that is a *prompt
 * instruction*, not a constrained decode — so compliance varies by model. The
 * same model observed using the tags on one turn returned a ```json fence on
 * the next. Both are recognised, longest opener first so ```json wins over the
 * bare fence at the same offset.
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

/**
 * A `{` opening its own line — the unwrapped form, which is what the model
 * emits when it ignores the wrapper instruction entirely (observed on a real
 * run). Anchored to a line start so a brace quoted mid-sentence is not mistaken
 * for the start of a payload.
 */
const BARE_OBJECT = /(?:^|\n)[ \t]*\{/;

/**
 * Strip the structured-output block out of assistant prose.
 *
 * OpenCode implements `format: { type: "json_schema" }` as a *prompt
 * convention* rather than a provider-native constrained decode: the model is
 * asked to append the JSON wrapped in `<structuredoutput>` tags, inside an
 * ordinary text part, after whatever prose it wanted to write. The server then
 * tries to extract it into `AssistantMessage.structured` — and on a real run it
 * failed to, reporting `StructuredOutputError` while the well-formed JSON sat
 * in the text part all along.
 *
 * So the payload has to be lifted out here, and the prose it was appended to
 * has to survive: unlike Codex, where the final message is *either* JSON or
 * prose, on OpenCode it is routinely both.
 */
export function splitStructured(text: string): {
  payload: string | null;
  prose: string;
} {
  let best: { from: number; close: string; at: number } | null = null;
  for (const { close, open } of STRUCTURED_WRAPPERS) {
    const at = text.indexOf(open);
    if (at === -1) {
      continue;
    }
    // Earliest wins; at a tie the longer opener wins, which is the order the
    // wrappers are declared in.
    if (!best || at < best.at) {
      best = { at, close, from: at + open.length };
    }
  }
  if (!best) {
    // No wrapper at all. Models routinely just append the bare object, so a
    // run of text starting at a `{` is treated as a candidate payload running
    // to the end. This is only a *deferral*, never a decision: the caller
    // parses it, and releases it as ordinary prose if it does not validate.
    // That is what makes sniffing for a brace safe here where it would not be
    // if the sniff itself decided whether the text was structured output.
    const brace = BARE_OBJECT.exec(text)?.index;
    if (brace === undefined) {
      return { payload: null, prose: text };
    }
    return { payload: text.slice(brace).trim(), prose: text.slice(0, brace) };
  }
  const closeAt = text.indexOf(best.close, best.from);
  // An unterminated wrapper means the block is still streaming. Everything
  // after the opener is payload-so-far and stays hidden, rather than letting a
  // half-written `{"summary":"…` render into the transcript and then vanish.
  const payload =
    closeAt === -1 ? text.slice(best.from) : text.slice(best.from, closeAt);
  // `prose` is deliberately a strict *prefix* of `text`, never reassembled from
  // both sides of the wrapper. That is what lets the reducer treat every
  // render as an append: if the payload turns out not to parse, it can emit
  // the remainder and the two halves still line up.
  return { payload: payload.trim(), prose: text.slice(0, best.at) };
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
