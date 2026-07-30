/**
 * The OpenCode backend.
 *
 * Architecturally unlike the other two. OpenCode is a client/server pair, not
 * an in-process iterator: the SDK shells out to `opencode serve` and speaks
 * HTTP + SSE, so a turn is a blocking `session.prompt` raced against a
 * server-wide event subscription carrying every session on it. The
 * choreography that follows exists for that reason, and `sessionIdOf`
 * filtering is a correctness requirement rather than tidiness.
 *
 * What it does better than Codex, and is used for here:
 * - Token-level streaming, so prose and reasoning render as they arrive.
 * - A real `system` field, so the preamble need not ride on the turn's text.
 * - Native `session.fork`: "try a different approach" keeps the history.
 * - Native `session.revert`, so `rewind()` is real rather than absent.
 * - Real cost on the assistant message, not just token counts.
 *
 * What it cannot do, handled explicitly rather than faked:
 * - No reasoning-effort control anywhere in the session or prompt API, so
 *   `--effort` is ignored; provider-specific equivalents are reachable only
 *   through `--opencode-config`.
 * - No `maxTurns` and no budget cap, as on Codex.
 * - No OS sandbox. `--safe` is approximated by asking for permission on every
 *   edit and command and answering from airship's own guards — a faithful port
 *   of the Claude posture, but raw network access is not cut — only the
 *   network tools are. Stated at launch and in the README.
 * - No in-process MCP: opencode's MCP servers are config-declared subprocesses,
 *   so `get_element_context` is not offered and the prompt inlines the
 *   selection instead.
 * - No bundled binary. The `opencode` CLI is a separate install; `checkAuth`
 *   looks for it on PATH and says so when it is missing.
 *
 * One further quirk shapes the code below: `format: { type: "json_schema" }` is
 * a prompt convention, not a constrained decode. The model emits the JSON
 * inside `<structuredoutput>` tags within ordinary prose, and opencode's own
 * extractor frequently fails to lift it back out — so the payload is recovered
 * here, from the text, and kept out of the transcript on the way past.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirtyFiles } from "@airship/git";
import {
  EDIT_OUTPUT_JSON_SCHEMA,
  EditStructuredOutputSchema,
} from "@airship/protocol";
import {
  type AgentAdapter,
  type AgentRunContext,
  type AgentRunOutcome,
  failureText,
} from "../agent";
import { systemPrompt } from "../prompt";
import { isPathInside, screenBash, screenEdit } from "../sandbox";
import { modelRefFor, sessionIdOf } from "./opencode-events";
import {
  finishBlocks,
  newReduceState,
  parseStructured,
  type ReduceHooks,
  type ReduceState,
  reconcileParts,
  reduceEvent,
} from "./opencode-reduce";
import {
  acquireServer,
  type OpencodeClientLike,
  resolveOpencodeBinary,
} from "./opencode-server";
import type {
  OcEvent,
  OcMessageInfo,
  OcPart,
  OcPermissionAsked,
} from "./opencode-wire";

export type { OpencodeSettings } from "./opencode-server";

/** How long to wait for the subscription to prove itself live before prompting. */
const CONNECT_GRACE_MS = 2000;
/** How long to let the stream flush after the prompt call returns. */
const TRAILING_GRACE_MS = 1500;
/** How long to wait for the drain to notice it has been cancelled. */
const DRAIN_GRACE_MS = 1000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * The per-session permission ruleset.
 *
 * Unsandboxed, everything is allowed outright so nothing ever asks. Under
 * `--safe`, edits and commands are routed back to airship's own guards by
 * asking about each one; the network *tools* are denied flat, and reaching
 * outside the project is denied by opencode itself as a second lock behind
 * `screenEdit`.
 */
/**
 * Every permission opencode gates, enumerated.
 *
 * A single `permission: "*"` rule does not cover them: a run with exactly that
 * rule still stopped to ask about `external_directory`. The reply handler
 * answered it and the turn survived, but each ask is a round-trip the run does
 * not need, so the list is spelled out.
 */
const PERMISSION_KEYS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "webfetch",
  "websearch",
  "lsp",
  "doom_loop",
  "skill",
];

export function permissionRuleset(safe: boolean): Array<{
  action: "allow" | "ask" | "deny";
  pattern: string;
  permission: string;
}> {
  if (!safe) {
    return PERMISSION_KEYS.map((permission) => ({
      action: "allow" as const,
      pattern: "*",
      permission,
    }));
  }
  const asked = new Set(["edit", "bash"]);
  const denied = new Set(["external_directory", "webfetch", "websearch"]);
  const actionFor = (permission: string): "allow" | "ask" | "deny" => {
    if (denied.has(permission)) {
      return "deny";
    }
    return asked.has(permission) ? "ask" : "allow";
  };
  return PERMISSION_KEYS.map((permission) => ({
    action: actionFor(permission),
    pattern: "*",
    permission,
  }));
}

/**
 * Answer a permission request.
 *
 * This is not optional politeness: a request left unanswered blocks the turn
 * indefinitely — verified by watching a real prompt hang until it was replied
 * to. So every request gets an answer, and an unrecognised one is allowed
 * rather than left to stall, because the ruleset above only ever asks about
 * things we have a guard for.
 */
export function decidePermission(
  permission: OcPermissionAsked,
  ctx: AgentRunContext
): { reason?: string; response: "once" | "reject" } {
  const safe = ctx.input.safe ?? false;
  const meta = permission.metadata ?? {};
  const allow = { response: "once" } as const;
  const refuse = (reason: string) => ({ reason, response: "reject" as const });

  switch (permission.permission) {
    case "bash": {
      const verdict = screenBash(
        typeof meta.command === "string" ? meta.command : ""
      );
      return verdict.allowed ? allow : refuse(verdict.reason ?? "denied");
    }
    case "edit":
    case "write": {
      const path = [meta.filePath, meta.file_path].find(
        (v) => typeof v === "string" && v
      );
      if (typeof path !== "string") {
        break;
      }
      const verdict = screenEdit(ctx.input.cwd, path);
      return verdict.allowed ? allow : refuse(verdict.reason ?? "denied");
    }
    case "external_directory": {
      // What `rm -rf /tmp/...` actually trips, rather than the `bash` rule —
      // opencode gates the *directories* a command reaches, separately from the
      // command itself. Every one of them has to be inside the project.
      const dirs = Array.isArray(meta.directories) ? meta.directories : [];
      const outside = dirs.filter(
        (d) => typeof d === "string" && !isPathInside(ctx.input.cwd, d)
      );
      if (outside.length) {
        return refuse(
          `Refusing to reach outside the project: ${outside.join(", ")}`
        );
      }
      return allow;
    }
    default:
      break;
  }

  // The fallback is the important half. Under `--safe` a request we have no
  // guard for is refused, not waved through: opencode gates permissions this
  // adapter has never heard of, and "allow whatever I do not recognise" would
  // turn every one of them into a hole. Unsafe runs allow it, which is what
  // unsandboxed means — and either way it is *answered*, because an
  // unanswered request blocks the turn indefinitely.
  return safe
    ? refuse(`Refusing an unrecognised '${permission.permission}' request`)
    : allow;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/**
 * Assemble the outcome from whatever the turn actually produced.
 *
 * Three sources in order: opencode's own extraction, the payload we lifted out
 * of the text ourselves, and finally the prose. The middle one is not a
 * fallback in practice but the common case — the server reported
 * `StructuredOutputError` on a run where the model had emitted perfectly valid
 * JSON, which is exactly why the reducer keeps its own copy.
 */
export function finishOutcome(
  state: ReduceState,
  info: OcMessageInfo | undefined,
  sessionId: string | null
): AgentRunOutcome {
  const structured =
    (info?.structured
      ? EditStructuredOutputSchema.safeParse(info.structured).data
      : undefined) ??
    parseStructured(state.payload) ??
    null;

  return {
    checkpointId: state.userMessageId,
    error: state.error,
    resultText: structured ? undefined : state.lastProse,
    sessionId,
    structured,
    usage: state.usage,
  };
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

interface TurnResult {
  info?: OcMessageInfo;
  parts?: OcPart[];
}

async function runTurn(
  client: OpencodeClientLike,
  sessionID: string,
  body: Record<string, unknown>,
  ctx: AgentRunContext,
  state: ReduceState,
  hooks: ReduceHooks
): Promise<TurnResult> {
  const { input } = ctx;
  const sse = new AbortController();
  const connected = deferred<void>();
  const idle = deferred<void>();

  // Subscribe *before* prompting. The session exists and is idle, so nothing
  // of ours can have happened yet — but the connection has to be established,
  // not merely requested, or the opening deltas are lost.
  //
  // The `directory` query is load-bearing rather than decorative: without it
  // the stream carries only `server.connected` and heartbeats, and not one
  // session event. Verified the hard way.
  const { stream } = await client.event.subscribe(
    { directory: input.cwd },
    { signal: sse.signal }
  );

  const teardown = { stopped: false };
  const drain = (async () => {
    for await (const raw of stream) {
      // Belt and braces with the abort signal: the server sends a heartbeat
      // every few seconds, so even a transport that ignored the signal cannot
      // strand the loop for longer than one heartbeat.
      if (teardown.stopped) {
        break;
      }
      const event = raw as OcEvent;
      if (event.type === "server.connected") {
        connected.resolve();
        continue;
      }
      // Anything not provably ours is dropped rather than guessed at: one
      // server serves every job, and a stray write attributed to this turn
      // would end up in this turn's undo.
      if (sessionIdOf(event) !== sessionID) {
        continue;
      }
      reduceEvent(event, ctx, state, hooks);
      if (event.type === "session.idle") {
        idle.resolve();
      }
    }
  })().catch((err) => {
    // Aborting the subscription is the normal teardown path, not a failure.
    if (!sse.signal.aborted) {
      state.error ??= failureText(err, input.abortController);
    }
  });

  await Promise.race([connected.promise, delay(CONNECT_GRACE_MS)]);

  // Both halves are needed, and neither is sufficient.
  //
  // `session.abort` is what actually stops the agent: cancelling the HTTP
  // request alone leaves it running server-side and still writing files.
  // But the request has to be cancelled too, because the server does not
  // always answer — a turn parked on a permission it is not going to get
  // never returns, and without this the edit would hang rather than cancel.
  const request = new AbortController();
  const onAbort = (): void => {
    client.session
      .abort({ directory: input.cwd, sessionID })
      .catch(() => undefined);
    request.abort();
  };
  input.abortController?.signal.addEventListener("abort", onAbort, {
    once: true,
  });

  try {
    const res = (await client.session.prompt(
      { ...body, directory: input.cwd, sessionID },
      { signal: request.signal }
    )) as { data?: TurnResult };
    await Promise.race([idle.promise, delay(TRAILING_GRACE_MS)]);
    return res.data ?? {};
  } finally {
    input.abortController?.signal.removeEventListener("abort", onAbort);
    teardown.stopped = true;
    sse.abort();
    // Bounded. The drain is only awaited so a late event cannot land after the
    // outcome has been assembled; it is never worth hanging an edit over.
    await Promise.race([drain, delay(DRAIN_GRACE_MS)]);
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

async function openSession(
  client: OpencodeClientLike,
  ctx: AgentRunContext
): Promise<string> {
  const { input } = ctx;
  const directory = input.cwd;
  const forking = Boolean(input.fork && input.resumeSessionId);

  if (forking && input.resumeSessionId) {
    // A native fork, so unlike Codex there is no apology to the model about a
    // conversation it cannot remember — the child really does inherit it.
    const forked = await client.session.fork({
      directory,
      sessionID: input.resumeSessionId,
    });
    const id = forked.data?.id;
    if (id) {
      return id;
    }
  }
  if (input.resumeSessionId && !forking) {
    return input.resumeSessionId;
  }

  const created = await client.session.create({
    agent: input.opencode?.agent,
    directory,
    permission: permissionRuleset(input.safe ?? false),
    title: "Airship edit",
  });
  const id = created.data?.id;
  if (!id) {
    throw new Error("opencode did not return a session id");
  }
  return id;
}

async function run(ctx: AgentRunContext): Promise<AgentRunOutcome> {
  const { input } = ctx;
  const state = newReduceState();
  let sessionId: string | null = input.resumeSessionId ?? null;

  try {
    const { client } = await acquireServer(input.opencode, input.safe ?? false);
    sessionId = await openSession(client, ctx);
    ctx.events.onSessionId?.(sessionId);

    const hooks: ReduceHooks = {
      onPermission: (permission) => {
        const { reason, response } = decidePermission(permission, ctx);
        if (response === "reject" && reason) {
          // Surfaced as a row so a refusal is visible rather than looking like
          // the model simply chose not to do it.
          ctx.recorder.openTool(permission.id, "Blocked", {}, null);
          ctx.recorder.closeTool(permission.id, true, reason);
        }
        // Fire-and-forget, but it must fire: an unanswered request blocks the
        // turn until the HTTP call gives up.
        client.permission
          .respond({
            directory: input.cwd,
            permissionID: permission.id,
            response,
            sessionID: permission.sessionID,
          })
          .catch(() => undefined);
      },
      rescanDirty: () => dirtyFiles(input.cwd),
    };

    const { info, parts } = await runTurn(
      client,
      sessionId,
      promptBody(ctx),
      ctx,
      state,
      hooks
    );

    // The authoritative parts array, replayed through the same reducer. Every
    // write is id-guarded, so this repairs a dropped frame without duplicating
    // anything the stream already delivered.
    reconcileParts(parts, ctx, state, hooks);
    finishBlocks(state, ctx);

    const outcome = finishOutcome(state, info, sessionId);

    // Only worth a row when the payload is genuinely gone. opencode reports
    // `StructuredOutputError` routinely — its extractor misses JSON the model
    // emitted perfectly well — and a warning shown next to a summary that
    // plainly did arrive is just noise. Never a turn failure either way: the
    // edit is already on disk.
    if (info?.error?.name === "StructuredOutputError" && !outcome.structured) {
      ctx.recorder.openTool(`${sessionId}:schema`, "Warning", {}, null);
      ctx.recorder.closeTool(
        `${sessionId}:schema`,
        true,
        info.error.data?.message ?? "structured output unavailable"
      );
    }

    return outcome;
  } catch (err) {
    finishBlocks(state, ctx);
    return {
      ...finishOutcome(state, undefined, sessionId),
      error: state.error ?? failureText(err, input.abortController),
    };
  }
}

function promptBody(ctx: AgentRunContext): Record<string, unknown> {
  const { input } = ctx;
  const resuming = Boolean(input.resumeSessionId) && !input.fork;
  return {
    agent: input.opencode?.agent,
    format: {
      retryCount: 2,
      schema: EDIT_OUTPUT_JSON_SCHEMA,
      type: "json_schema",
    },
    model: toModelBody(input.model),
    parts: [
      { text: ctx.promptText, type: "text" },
      ...(input.images ?? []).map((image) => ({
        filename: image.name ?? "screenshot.png",
        mime: image.mediaType,
        type: "file" as const,
        // A data URL, so there is no temp-file dance and nothing to clean up
        // on the abort path — unlike Codex, which only accepts paths.
        url: `data:${image.mediaType};base64,${image.dataBase64}`,
      })),
    ],
    // The preamble is skipped on resume: the session history already carries
    // it, and repeating instructions the model already followed is pure noise.
    system: resuming ? undefined : systemPrompt("opencode"),
    // There is no interactive channel back to the user from inside a job, so a
    // model that asks a question would hang the turn until the HTTP request
    // gave up. The permission ruleset denies it too, as a second lock.
    tools: { question: false },
  };
}

/**
 * OpenCode wants a provider *and* a model, where airship's `--model` is one
 * free-form string. A bare id with no provider is dropped rather than sent
 * half-filled, so the server's configured default applies instead of the
 * request being rejected; the CLI warns about the `provider/model` form.
 */
function toModelBody(
  model?: string
): { modelID: string; providerID: string } | undefined {
  const ref = modelRefFor(model);
  return ref?.providerID
    ? { modelID: ref.modelID, providerID: ref.providerID }
    : undefined;
}

/**
 * `session.revert` anchored on the turn's *user* message, which is what rolls
 * back that turn's writes — verified by reverting a real edit and watching the
 * file return to its previous contents.
 *
 * The id is the one observed on the stream rather than one airship minted:
 * opencode constrains it to `^msg`, and a rejected id would fail the whole turn
 * rather than just the undo. When it was never seen, `checkpointId` is null and
 * this is never called — `@airship/git.restoreFiles` remains the primary undo
 * on every backend regardless.
 */
async function rewind(params: {
  checkpointId: string;
  cwd: string;
  sessionId: string;
}): Promise<{ error?: string; ok: boolean }> {
  try {
    const { client } = await acquireServer();
    await client.session.revert({
      directory: params.cwd,
      messageID: params.checkpointId,
      sessionID: params.sessionId,
    });
    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

/** Any one of these is enough — opencode is multi-provider by design. */
const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_ACCESS_KEY_ID",
];

function dataHome(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

function configHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

/**
 * Synchronous, env/fs-only.
 *
 * The binary is checked first because it is the one failure that is both fatal
 * and certain, and by a wide margin the likeliest on this backend — the SDK
 * ships no binary, so a working `npm install` proves nothing about whether
 * `opencode` exists. The credential check that follows is a heuristic: a config
 * may point at a local model that needs no key at all.
 */
function checkAuth(): { ok: boolean; reason?: string } {
  if (!resolveOpencodeBinary()) {
    return {
      ok: false,
      reason:
        "No `opencode` binary found on PATH. Install it (`brew install sst/tap/opencode` or `npm i -g opencode-ai`), or pass --opencode-path / --opencode-url.",
    };
  }
  if (PROVIDER_ENV.some((key) => process.env[key])) {
    return { ok: true };
  }
  if (
    existsSync(join(dataHome(), "opencode", "auth.json")) ||
    existsSync(join(configHome(), "opencode", "opencode.json"))
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "No provider credentials found for opencode. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or run `opencode auth login` once to sign in.",
  };
}

export const opencodeAdapter: AgentAdapter = {
  checkAuth,
  kind: "opencode",
  needsGitBaseline: true,
  rewind,
  run,
};
