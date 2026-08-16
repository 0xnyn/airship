/**
 * @airship/server — the daemon. Runs the universal proxy, serves the overlay,
 * speaks the @airship/protocol WebSocket, and drives edits through @airship/core.
 */
import type { AddressInfo, Socket } from "node:net";
import type {
  CodexSettings,
  OpencodeSettings,
  RunEditResult,
} from "@airship/core";
import {
  buildEditPrompt,
  listAllModels,
  namesProvider,
  runEdit,
  shutdownOpencodeServer,
} from "@airship/core";
import {
  commitEdit,
  createBranch,
  createPr,
  currentBranch,
  defaultBranch,
  type GitStatus,
  ghStatus,
  gitStatus,
  hasRemote,
  pushBranch,
  restoreFiles,
} from "@airship/git";
import {
  type AgentKind,
  type AirshipSurface,
  type AttrEditTarget,
  type ClientMessage,
  ClientMessageSchema,
  type CreateJobRequest,
  type Effort,
  type ElementContext,
  type GitHealth,
  type JobDiffBundle,
  type JobStatus,
  type ModelCatalogue,
  type MoveEdit,
  type ReviewComment,
  type ServerEvent,
  type SourceLocation,
  surfaceToMode,
  type VisualEditTarget,
} from "@airship/protocol";
import { scanProjectTokens } from "@airship/source/tokens";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { bindUrl, buildAllowedHosts } from "./access";
import { listHistory, readBundle, thread, writeBundle } from "./history";
import { JobStore } from "./jobs";
import { openInEditor } from "./open-editor";
import { preparePromptInput } from "./prompt-input";
import { createProxyServer } from "./proxy";

export type {
  CodexConfigValue,
  CodexSettings,
  ModelProbeOptions,
  OpencodeSettings,
} from "@airship/core";
/** Re-exported so the CLI depends only on @airship/server. */
export { checkAuth, listModels } from "@airship/core";
export type { GitFailure, GitStatus } from "@airship/git";
export { gitStatus, onGitFailure } from "@airship/git";
export type { AgentKind, AirshipSurface, Effort } from "@airship/protocol";

const WS_PATH = "/__airship/ws";

export interface ServerOptions {
  /** Default backend for turns that do not name one. */
  agent?: AgentKind;
  /**
   * Hostnames the server answers for beyond `localhost` and IP literals —
   * `/etc/hosts` aliases, tunnel names. Exact matches only.
   */
  allowedHosts?: readonly string[];
  /** Auto-commit each accepted edit with a Conventional-Commits message. */
  autoCommit?: boolean;
  /** Codex-only passthrough knobs; opaque here by design. */
  codex?: CodexSettings;
  /** Project root for file edits. */
  cwd: string;
  effort?: Effort;
  /**
   * Interface the proxy *listens* on — not `targetHost`, the upstream dev
   * server it forwards to. Loopback by default: this is an unauthenticated
   * server that drives a coding agent with write access to the project.
   */
  host?: string;
  /**
   * Keep upstream `Content-Security-Policy` headers on served surfaces
   * instead of stripping them. `X-Frame-Options` is dropped regardless.
   */
  keepCsp?: boolean;
  maxBudgetUsd?: number;
  /** Claude-only turn cap. */
  maxTurns?: number;
  /** Cross-harness model default, from `--model`. Superseded per backend by
   * `models`, and by a turn that names its own. Kept because the launch banner
   * reads it, and because it is still the right answer for a single-backend run. */
  model?: string;
  /**
   * Per-backend model defaults, already resolved by the CLI (`--claude-model`
   * and friends, each falling back to `--model`).
   *
   * Per backend rather than one string because the overlay's picker can change
   * harness mid-session: a single default would hand a `claude-opus-5` to Codex
   * the first time someone switched.
   */
  models?: Partial<Record<AgentKind, string>>;
  /** OpenCode-only passthrough knobs; opaque here by design. */
  opencode?: OpencodeSettings;
  /** Port Airship's proxy listens on. */
  port: number;
  /** Sandbox edits to the project and cut network access. A launch-level
   * posture, not per-job — the overlay picker chooses the agent, not this. */
  safe?: boolean;
  /**
   * Which surface a top-level navigation lands on. A default, not a lock: the
   * editor's own switcher sets a cookie that outranks it, and `?__airship=`
   * outranks both.
   */
  surface?: AirshipSurface;
  targetHost?: string;
  /** Port the user's dev server is already running on. */
  targetPort: number;
}

export interface RunningServer {
  close: () => Promise<void>;
  url: string;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  // Default to the hostname (not 127.0.0.1): dev servers like Vite 6 bind IPv6
  // `localhost` (::1) only, so a hardcoded IPv4 target gets ECONNREFUSED. Node's
  // happy-eyeballs (autoSelectFamily) then reaches whichever family it bound.
  const targetHost = opts.targetHost ?? "localhost";
  // Explicit, and never a wildcard by default — the same posture as the
  // opencode server (opencode-server.ts): this is an unauthenticated HTTP
  // server that can drive a coding agent with filesystem write access.
  const host = opts.host ?? "127.0.0.1";
  const { cwd } = opts;
  const jobs = new JobStore();
  const clients = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });

  // Serialize edits: concurrent edits against the same working tree would
  // cross-contaminate diff capture and undo baselines.
  let editChain: Promise<void> = Promise.resolve();

  /**
   * The model catalogue, probed once and kept.
   *
   * Memoized as the in-flight promise rather than its value, so two tabs
   * opening their pickers together share one probe instead of racing to start
   * two `opencode serve` processes. A rejection is not possible to observe
   * here — `listAllModels` reports failures as groups with a `note` — but the
   * memo is cleared on one anyway, so a genuinely broken probe is retried
   * rather than cached forever.
   */
  let catalogue: Promise<ModelCatalogue> | null = null;

  function modelCatalogue(refresh?: boolean): Promise<ModelCatalogue> {
    if (refresh) {
      catalogue = null;
    }
    catalogue ??= listAllModels(cwd, {
      opencode: opts.opencode,
      safe: opts.safe,
    })
      .then((groups) =>
        // The daemon's own resolved default outranks whatever the backend
        // reports: if someone launched with `--codex-model gpt-5.4`, that is
        // what an unpicked turn will run, so it is what the menu must lead with.
        groups.map((group) => ({
          ...group,
          default: opts.models?.[group.agent] ?? group.default,
        }))
      )
      .catch((err) => {
        catalogue = null;
        throw err;
      });
    return catalogue;
  }

  function broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  function send(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Can the overlay offer its git verbs at all?
   *
   * Uncached on purpose. It is a handful of `rev-parse` calls, it runs on
   * connect and after a turn rather than per edit, and a repo can gain its
   * first commit — or have its git uninstalled — while a tab stays open. A
   * stale "yes" here is a click that fails for a reason the user was already
   * told about and can no longer see.
   */
  function gitHealth(): GitHealth {
    return healthOf(gitStatus(cwd));
  }

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    send(ws, {
      defaultAgent: opts.agent ?? "claude",
      jobs: jobs.snapshots(),
      type: "hello",
    });
    // Beside the handshake rather than deferred: the transcript can paint a
    // finished turn's action menu immediately, and a menu that offers Commit
    // for half a second before greying it out is worse than one that never
    // offered it.
    send(ws, { health: gitHealth(), type: "git:health" });
    // Push the token scan without being asked. The inspector needs it to render
    // its very first selection, and a request/response round trip would leave
    // the badges missing for the first element the user clicks. Deferred off the
    // handshake so the first connection is never waiting on a tree walk.
    setImmediate(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        send(ws, { scan: scanProjectTokens(cwd), type: "tokens:result" });
      } catch {
        // A token scan is an enhancement, never a reason to break the session.
      }
    });
    ws.on("message", (data: RawData) => handleMessage(ws, data));
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  function handleMessage(ws: WebSocket, data: RawData): void {
    let parsed: ClientMessage;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(data.toString()));
    } catch (err) {
      send(ws, {
        message: `invalid message: ${err instanceof Error ? err.message : String(err)}`,
        type: "error",
      });
      return;
    }

    switch (parsed.type) {
      case "edit": {
        const { request } = parsed;
        // Refused here rather than inside `startEdit`, so a model opencode
        // cannot run neither creates a job nor takes a place in the edit chain.
        const refusal = modelRefusal(request, opts);
        if (refusal) {
          send(ws, { message: refusal, type: "error" });
          break;
        }
        editChain = editChain
          .then(() => startEdit(request))
          .catch((err) => {
            broadcast({
              message: `edit failed: ${err instanceof Error ? err.message : String(err)}`,
              type: "error",
            });
          });
        break;
      }
      case "cancel":
        jobs.get(parsed.jobId)?.abort?.abort();
        break;
      case "undo":
        undo(ws, parsed.jobId);
        break;
      case "history":
        send(ws, { entries: listHistory(cwd), type: "history" });
        break;
      // Read-only, so deliberately *not* on `editChain`: a token scan touches no
      // files and must not queue behind a running edit, or the inspector would
      // sit tokenless for as long as the agent takes.
      case "tokens":
        send(ws, {
          scan: scanProjectTokens(cwd, { refresh: parsed.refresh }),
          type: "tokens:result",
        });
        break;
      // Off `editChain` like `tokens`, and for a stronger reason: the probe
      // talks to the same backends a running turn is using, and queueing it
      // would leave the picker spinning for the length of an edit. Answered to
      // the asking socket only — the menu that asked is the one waiting.
      case "models":
        modelCatalogue(parsed.refresh)
          .then((result) =>
            send(ws, { catalogue: result, type: "models:result" })
          )
          .catch((err) => {
            send(ws, {
              message: `model list failed: ${err instanceof Error ? err.message : String(err)}`,
              type: "error",
            });
          });
        break;
      // Off `editChain` for the same reason as `tokens`: it only resolves
      // sources and renders a string. Queueing it behind a running edit would
      // freeze the composer's live preview for the length of a turn. It does
      // read files the agent may be mid-write on, which is harmless for a
      // preview and cheaper than the alternative.
      case "prompt":
        sendPromptPreview(ws, parsed.request);
        break;
      case "thread":
        send(ws, {
          entries: thread(cwd, parsed.rootJobId),
          rootJobId: parsed.rootJobId,
          type: "thread",
        });
        break;
      case "commit":
        commit(ws, parsed.jobId, parsed.message, parsed.push);
        break;
      case "open":
        send(ws, {
          file: parsed.file,
          type: "open:result",
          ...openInEditor(cwd, parsed),
        });
        break;
      case "pr":
        createPullRequest(ws, parsed.jobId, parsed.title, parsed.branch);
        break;
      default:
        break;
    }
  }

  async function startEdit(request: CreateJobRequest): Promise<void> {
    const displayPrompt = request.prompt.trim() || synthesizeLabel(request);
    const rec = jobs.create(displayPrompt);
    broadcast({
      job: {
        createdAt: rec.createdAt,
        jobId: rec.jobId,
        prompt: displayPrompt,
        status: "running",
      },
      type: "job:created",
    });

    // The same resolution the `prompt` preview runs, from the same function —
    // the two must render the identical string.
    const promptInput = preparePromptInput(cwd, request);

    const { agent, model } = resolveTarget(request, opts);
    const resumeSessionId = resolveResume(cwd, request.parentJobId, agent);

    const abort = new AbortController();
    rec.abort = abort;

    const result = await runEdit(
      {
        // Spread first, and restate none of its fields below: every
        // prompt-relevant input has to come from `preparePromptInput` or the
        // preview stops matching what the agent is sent.
        ...promptInput,
        abortController: abort,
        agent,
        codex: opts.codex,
        cwd,
        effort: opts.effort,
        fork: request.fork,
        images: request.images,
        maxBudgetUsd: opts.maxBudgetUsd,
        maxTurns: opts.maxTurns,
        model,
        opencode: opts.opencode,
        resumeSessionId,
        safe: opts.safe,
      },
      {
        onSessionId: (id) => {
          rec.sessionId = id;
        },
        onStep: (step) => {
          rec.step = step;
          broadcast({ jobId: rec.jobId, step, type: "job:step" });
        },
        onText: (delta) =>
          broadcast({ delta, jobId: rec.jobId, type: "job:text" }),
        onTimeline: (item) =>
          broadcast({ item, jobId: rec.jobId, type: "job:timeline" }),
        onTimelinePatch: (id, patch) =>
          broadcast({
            id,
            jobId: rec.jobId,
            patch,
            type: "job:timeline:patch",
          }),
        onTodos: (todos) =>
          broadcast({ jobId: rec.jobId, todos, type: "job:todos" }),
      }
    );

    const status = jobStatus(abort.signal.aborted, result.ok);
    const bundle = buildBundle({
      agent,
      createdAt: rec.createdAt,
      displayPrompt,
      jobId: rec.jobId,
      model,
      parentJobId: request.parentJobId,
      primaryElement: promptInput.element,
      result,
      source: promptInput.source ?? null,
      status,
    });

    writeBundle(cwd, bundle);
    jobs.finish(rec.jobId, status, result.error);

    broadcast({
      error: result.error,
      jobId: rec.jobId,
      status,
      type: "job:status",
    });
    // Before `job:done`, not after. That event is what paints the finished
    // turn, and the turn menu captures the health it was rendered with — so
    // sending it afterwards would leave the newest turn a beat behind.
    broadcast({ health: gitHealth(), type: "git:health" });
    broadcast({ bundle, jobId: rec.jobId, type: "job:done" });
    broadcast({ entries: listHistory(cwd), type: "history" });

    if (opts.autoCommit && status === "done" && result.diffs.length) {
      const auto = commitEdit(
        cwd,
        result.diffs.map((d) => d.file),
        bundle.summary || displayPrompt
      );
      broadcast({
        error: auto.ok ? undefined : `auto-commit failed: ${auto.error}`,
        ok: auto.ok,
        sha: auto.sha,
        type: "commit:result",
      });
    }
  }

  /**
   * Render the instruction this request would produce, without running it.
   *
   * Goes through `preparePromptInput` + `buildEditPrompt` — the same two calls
   * `startEdit` makes — so what the user reads is what the agent is handed.
   */
  function sendPromptPreview(ws: WebSocket, request: CreateJobRequest): void {
    try {
      send(ws, {
        text: buildEditPrompt(preparePromptInput(cwd, request)),
        type: "prompt:result",
      });
    } catch (err) {
      send(ws, {
        message: `prompt preview failed: ${err instanceof Error ? err.message : String(err)}`,
        type: "error",
      });
    }
  }

  function undo(ws: WebSocket, jobId: string): void {
    const bundle = readBundle(cwd, jobId);
    if (!bundle?.diffs.length) {
      send(ws, {
        error: "nothing to undo",
        jobId,
        ok: false,
        type: "undo:result",
      });
      return;
    }
    // Content-restore from the before-state captured by the SDK PreToolUse
    // hooks — instant and reliable. (SDK `rewindEdit` is the alternative.)
    const { restored, skipped } = restoreFiles(cwd, bundle.diffs);
    const ok = skipped.length === 0;
    broadcast({
      // The count alone was the whole message, which told the user a number and
      // nothing they could act on. The first reason is the useful half; the
      // rest are almost always the same one.
      error: ok
        ? undefined
        : `restored ${restored.length}/${bundle.diffs.length} files — ${skipped[0].file}: ${skipped[0].reason}`,
      jobId,
      ok,
      type: "undo:result",
    });
    broadcast({ entries: listHistory(cwd), type: "history" });
  }

  async function commit(
    ws: WebSocket,
    jobId: string,
    message?: string,
    push?: boolean
  ): Promise<void> {
    const bundle = readBundle(cwd, jobId);
    if (!bundle?.diffs.length) {
      send(ws, {
        error: "nothing to commit",
        ok: false,
        type: "commit:result",
      });
      return;
    }
    const { error, ok, sha } = commitEdit(
      cwd,
      bundle.diffs.map((d) => d.file),
      message || bundle.summary || bundle.prompt
    );
    if (!(ok && push)) {
      send(ws, { error, ok, sha, type: "commit:result" });
      return;
    }
    const branch = currentBranch(cwd);
    if (!branch) {
      send(ws, {
        error: "committed, but HEAD is detached — nothing to push",
        ok: true,
        pushed: false,
        sha,
        type: "commit:result",
      });
      return;
    }
    // Checked here as well as in `prPreflight`: pushing to a remote that does
    // not exist otherwise spends the network timeout before saying so.
    if (!hasRemote(cwd)) {
      send(ws, {
        error: "committed, but there is no `origin` remote to push to",
        ok: true,
        pushed: false,
        sha,
        type: "commit:result",
      });
      return;
    }
    const pushed = await pushBranch(cwd, branch);
    send(ws, {
      error: pushed.ok
        ? undefined
        : `committed, but push failed: ${pushed.error}`,
      ok: true,
      pushed: pushed.ok,
      sha,
      type: "commit:result",
    });
  }

  /**
   * Commit → push → `gh pr create`.
   *
   * Each step fails differently and a bare "failed" is useless, so `stage` says
   * which one stopped. The preflight is most of the value: being on the default
   * branch or having no `origin` are the two everyday cases, and both are worth
   * naming before anything is committed.
   */
  async function createPullRequest(
    ws: WebSocket,
    jobId: string,
    title?: string,
    branch?: string
  ): Promise<void> {
    const fail = (
      stage: "branch" | "commit" | "create" | "preflight" | "push",
      error: string
    ): void => {
      send(ws, { error, ok: false, stage, type: "pr:result" });
    };

    const bundle = readBundle(cwd, jobId);
    const blocked = prPreflight(cwd, bundle);
    if (blocked || !bundle) {
      fail("preflight", blocked ?? "nothing to open a pull request for");
      return;
    }

    const base = defaultBranch(cwd);
    const branched = ensureFeatureBranch(cwd, jobId, base, branch);
    if (!branched.head) {
      fail(branched.stage ?? "preflight", branched.error ?? "no branch");
      return;
    }
    const { head } = branched;

    const summary = bundle.summary || bundle.prompt;
    const committed = commitEdit(
      cwd,
      bundle.diffs.map((d) => d.file),
      summary
    );
    if (!committed.ok) {
      fail("commit", committed.error ?? "commit failed");
      return;
    }
    const pushed = await pushBranch(cwd, head);
    if (!pushed.ok) {
      fail("push", pushed.error ?? "push failed");
      return;
    }
    const pr = await createPr(cwd, {
      base: base ?? undefined,
      body: summary,
      head,
      title: title || summary.slice(0, 72),
    });
    send(ws, {
      error: pr.error,
      ok: pr.ok,
      stage: pr.ok ? undefined : "create",
      type: "pr:result",
      url: pr.url,
    });
  }

  const server = createProxyServer({
    allowedHosts: buildAllowedHosts(opts.allowedHosts, opts.host),
    defaultMode: surfaceToMode(opts.surface ?? "canvas"),
    keepCsp: opts.keepCsp,
    onAirshipUpgrade: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    },
    targetHost,
    targetPort: opts.targetPort,
    wsPath: WS_PATH,
  });

  // A tunnelled upgrade (Vite HMR) hands the socket off to the proxy, so the
  // http server stops accounting for it and `close()` will never reclaim it.
  // Track them here so shutdown can hang up itself — otherwise Ctrl-C waits on
  // an HMR socket that, by design, stays open forever.
  const tunnelled = new Set<Socket>();
  server.on("upgrade", (_req, socket) => {
    tunnelled.add(socket as Socket);
    socket.on("close", () => tunnelled.delete(socket as Socket));
  });

  // The `error` listener is what makes this rejectable. Without it an
  // EADDRINUSE — or, on Windows, the EACCES you get from a port inside a
  // Hyper-V/WSL2 reserved range — is emitted with nobody listening, becomes an
  // uncaughtException, and escapes the caller's try/catch, so the dev server
  // airship started with `--exec` is never stopped either.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo | null;
  const port = addr?.port ?? opts.port;
  const url = bindUrl(host, port);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        // The OpenCode backend spawns an `opencode serve` child that outlives
        // the run and holds the event loop open. It is a no-op on the other
        // backends and when no opencode edit ever happened.
        shutdownOpencodeServer();
        // `terminate`, not `close`: a graceful ws handshake waits on a peer that
        // may never answer, and this path is already "we are going away".
        for (const c of clients) {
          c.terminate();
        }
        wss.close();
        for (const socket of tunnelled) {
          socket.destroy();
        }
        server.close(() => resolve());
        // After `close()`, so no new connection sneaks in behind it. Idle
        // keep-alive sockets from an open browser tab would otherwise hold the
        // server up until they time out on their own.
        server.closeAllConnections();
      }),
    url,
  };
}

/**
 * Which git problems stop the overlay's git verbs, and which do not.
 *
 * The verbs are commit, push and open a pull request. Deliberately not gated on
 * `hasCommits`: the first commit in a fresh repository is exactly the thing
 * that works there, so greying Commit out for want of a HEAD would block the
 * action that creates one. Having no HEAD costs the diff *baseline*, which is a
 * per-turn fact carried on `FileDiff.noBaseline` and gates Revert instead.
 *
 * Exported for its own test. `gitStatus` short-circuits in the order these are
 * read, so `error` always describes the field that actually failed here.
 */
export function healthOf(status: GitStatus): GitHealth {
  if (status.installed && status.workTree) {
    return { ok: true };
  }
  return {
    hint: status.hint,
    ok: false,
    reason: status.error ?? "git is unavailable",
  };
}

function preview(prompt: string): string {
  return prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt;
}

/** A readable label for a deltas-only visual edit (used when no note is given). */
/** Everything that must hold before a PR is possible. Null means "go ahead". */
function prPreflight(cwd: string, bundle: JobDiffBundle | null): string | null {
  if (!bundle?.diffs.length) {
    return "nothing to open a pull request for";
  }
  // `gitStatus` rather than `isGitRepo`, because this message is the one the
  // user acts on: a git that is not installed, a bare repo and a directory that
  // is not a repository all used to arrive here as "not a git repository".
  const git: GitStatus = gitStatus(cwd);
  if (!(git.workTree && git.hasCommits)) {
    return git.error ?? "git is unavailable";
  }
  if (!hasRemote(cwd)) {
    return "no `origin` remote";
  }
  // Scoped to the repo: `gh auth status` resolves which host to check from the
  // remote, so asking without a cwd can pass while the push still fails.
  const gh = ghStatus(cwd);
  if (!gh.authed) {
    return gh.error ?? "gh is unavailable";
  }
  return null;
}

/**
 * The branch to open the PR from. A PR from the default branch to itself is not
 * a thing, so being on it means branching first.
 */
function ensureFeatureBranch(
  cwd: string,
  jobId: string,
  base: string | null,
  requested?: string
): { error?: string; head?: string; stage?: "branch" | "preflight" } {
  const head = currentBranch(cwd);
  if (!head) {
    return { error: "HEAD is detached", stage: "preflight" };
  }
  if (head !== base) {
    return { head };
  }
  const name = requested || `airship/${jobId.slice(0, 8)}`;
  const branched = createBranch(cwd, name);
  if (!branched.ok) {
    return {
      error: `could not create branch ${name}: ${branched.error}`,
      stage: "branch",
    };
  }
  return { head: name };
}

function jobStatus(aborted: boolean, ok: boolean): JobStatus {
  if (aborted) {
    return "cancelled";
  }
  return ok ? "done" : "failed";
}

/**
 * How far up the parent chain to look for a resumable session. Adapters now
 * withhold `sessionId` from a bundle whose turn a provider rejected outright
 * (the session is poisoned — resuming it replays the rejected exchange), so
 * one bad turn mid-thread should fall through to the last good session, not
 * lose the whole conversation. Bounded because bundles written before
 * `sessionId` existed would otherwise let the walk reach arbitrarily far into
 * unrelated history.
 */
const RESUME_WALK_LIMIT = 3;

/**
 * Which backend this turn runs on, and on which model.
 *
 * Three steps each: what the turn asked for, else the default resolved for the
 * backend that is actually running, else the cross-harness one. Unlike `agent`,
 * a missing model is fine — every adapter reads an absent model as "use your
 * own default".
 *
 * Per backend rather than one string because the overlay's picker can change
 * harness mid-session, so a single default would follow it and hand Codex an id
 * only Claude answers to.
 *
 * One function, and module-level rather than a closure, for two reasons: the
 * `edit` handler validates the model that `startEdit` then sends, and resolving
 * it in both places would let the checked value drift from the run one; and a
 * precedence chain this load-bearing should be reachable from a test without
 * standing a server up.
 */
export function resolveTarget(
  request: Pick<CreateJobRequest, "agent" | "model">,
  opts: Pick<ServerOptions, "agent" | "model" | "models">
): { agent: AgentKind; model?: string } {
  const agent = request.agent ?? opts.agent ?? "claude";
  return {
    agent,
    model: request.model ?? opts.models?.[agent] ?? opts.model,
  };
}

/**
 * Why this turn's model cannot run, or `null` if it can.
 *
 * `toModelBody` drops an opencode ref that does not name a provider, which makes
 * asking for one indistinguishable from asking for nothing: the turn runs on the
 * server's default while the composer goes on showing what was picked.
 *
 * It reads `request.model` and deliberately **not** the resolved model. The
 * three ways a model gets here are guarded differently on purpose, and `args.ts`
 * spells out why:
 *
 * - `--opencode-model` names its backend, so a bare id there can only be a
 *   mistake — a hard error at parse time.
 * - `--model` reaches all three backends, where a bare id is correct for two of
 *   them. It warns at launch and the turn runs on opencode's own default.
 * - The picker's custom-model box had no guard at either end. It is the one door
 *   left, and the one where the user is choosing right now and can act on being
 *   told.
 *
 * Guarding the *resolved* model would fold the second case into the first and
 * turn a documented warn-and-continue into "every edit refused".
 */
export function modelRefusal(
  request: Pick<CreateJobRequest, "agent" | "model">,
  opts: Pick<ServerOptions, "agent" | "model" | "models">
): string | null {
  const { agent } = resolveTarget(request, opts);
  if (agent !== "opencode" || !request.model || namesProvider(request.model)) {
    return null;
  }
  return `opencode cannot run '${request.model}': it resolves a model through its provider, so it needs the provider/model form — try 'anthropic/${request.model}'.`;
}

/**
 * The session to resume, or null to start clean.
 *
 * `sessionId` names a Claude session on one backend and a Codex thread on the
 * other, so resuming across a switch would hand an id to a backend that has
 * never seen it — the agent check runs per hop for the same reason. Dropping
 * it starts a clean session instead: the conversation is lost either way, but
 * the turn still runs. Bundles written before `agent` existed are Claude by
 * construction.
 */
export function resolveResume(
  cwd: string,
  parentJobId: string | undefined,
  agent: AgentKind
): string | null {
  const seen = new Set<string>();
  let jobId = parentJobId;
  for (let hop = 0; jobId && hop < RESUME_WALK_LIMIT; hop += 1) {
    if (seen.has(jobId)) {
      return null;
    }
    seen.add(jobId);
    const parent = readBundle(cwd, jobId);
    if (!parent) {
      return null;
    }
    if ((parent.agent ?? "claude") !== agent) {
      return null;
    }
    if (parent.sessionId) {
      return parent.sessionId;
    }
    jobId = parent.parentJobId;
  }
  return null;
}

function buildBundle(args: {
  agent: AgentKind;
  createdAt: number;
  displayPrompt: string;
  jobId: string;
  model?: string;
  parentJobId?: string;
  primaryElement?: ElementContext;
  result: RunEditResult;
  source: SourceLocation | null;
  status: JobStatus;
}): JobDiffBundle {
  const { displayPrompt, primaryElement, result } = args;
  return {
    additions: result.diffs.reduce((n, d) => n + d.additions, 0),
    agent: args.agent,
    checkpointId: result.checkpointId ?? undefined,
    completedAt: Date.now(),
    createdAt: args.createdAt,
    deletions: result.diffs.reduce((n, d) => n + d.deletions, 0),
    diffs: result.diffs,
    error: result.error,
    filesChanged: result.diffs.length,
    followUps: result.followUps,
    jobId: args.jobId,
    model: args.model,
    parentJobId: args.parentJobId,
    prompt: displayPrompt,
    promptPreview: preview(displayPrompt),
    sessionId: result.sessionId ?? undefined,
    status: args.status,
    summary: result.summary,
    target: {
      displayName: primaryElement?.displayName ?? null,
      source: args.source ?? null,
      tagName: primaryElement?.tagName ?? "",
    },
    timeline: result.timeline,
    usage: result.usage,
  };
}

/**
 * Visual-only edits carry an empty prompt; synthesize a readable label for the
 * job list, history, and (auto-)commit message.
 */
function synthesizeLabel(request: CreateJobRequest): string {
  if (request.comments?.length) {
    return summarizeComments(request.comments);
  }
  if (request.visualChanges?.length) {
    return summarizeVisual(request.visualChanges);
  }
  if (request.attrChanges?.length) {
    return summarizeAttrs(request.attrChanges);
  }
  return summarizeMoves(request.moveChanges);
}

/** A readable label for an attributes-only turn. */
function summarizeAttrs(targets: AttrEditTarget[]): string {
  const count = targets.reduce((n, t) => n + t.changes.length, 0);
  const first = targets[0].element;
  const name = first.displayName ?? `<${first.tagName}>`;
  const scope =
    targets.length > 1 ? `${name} +${targets.length - 1} more` : name;
  return `Attribute edit: ${count} change${count === 1 ? "" : "s"} to ${scope}`;
}

function summarizeVisual(targets?: VisualEditTarget[]): string {
  if (!targets?.length) {
    return "Visual edit";
  }
  const changeCount = targets.reduce((n, t) => n + t.changes.length, 0);
  const first = targets[0].element;
  const name = first.displayName ?? `<${first.tagName}>`;
  const scope =
    targets.length > 1 ? `${name} +${targets.length - 1} more` : name;
  return `Visual edit: ${changeCount} change${changeCount === 1 ? "" : "s"} to ${scope}`;
}

/** A readable label for a comments-only turn (used when no note is given). */
function summarizeComments(comments: ReviewComment[]): string {
  const files = new Set(comments.map((c) => c.file));
  const where =
    files.size === 1
      ? [...files][0]
      : `${files.size} file${files.size === 1 ? "" : "s"}`;
  return `Review: ${comments.length} comment${comments.length === 1 ? "" : "s"} on ${where}`;
}

/** A readable label for a moves-only edit (used when no note is given). */
function summarizeMoves(moves?: MoveEdit[]): string {
  if (!moves?.length) {
    return "Visual edit";
  }
  const [first] = moves;
  const what = first.element.displayName ?? `<${first.element.tagName}>`;
  const where = first.newParent?.displayName ?? `<${first.newParent?.tagName}>`;
  const scope = moves.length > 1 ? ` +${moves.length - 1} more` : "";
  return first.newParent
    ? `Move ${what} into ${where}${scope}`
    : `Reposition ${what}${scope}`;
}
