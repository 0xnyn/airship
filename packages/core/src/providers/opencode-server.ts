/**
 * The `opencode serve` process, and the client that talks to it.
 *
 * Kept apart from the adapter so that nothing about spawning, ports or
 * teardown leaks into the reducer's module graph — which is what lets the
 * reducer tests run without ever loading the SDK's `child_process` path.
 *
 * The server is a lazily-created singleton. Airship's interaction model is
 * "point at an element, type a sentence, watch it happen", and a cold
 * `opencode serve` handshake on the front of every edit is the wrong tax to
 * pay when one process can serve them all. Nothing is lost by sharing it: the
 * knobs that genuinely vary per turn — model, agent, permissions — are all
 * settable per *session*, not per server.
 *
 * The cost of sharing is that the event stream carries every session on the
 * server, which is why `sessionIdOf` filtering in the reducer is not optional.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";

/** Per-run knobs the CLI hands through untouched. */
export interface OpencodeSettings {
  /** Run as a named opencode agent (`build`, `plan`, or a custom one). */
  agent?: string;
  /** Merged into `OPENCODE_CONFIG_CONTENT`; the escape hatch for anything unmodelled. */
  config?: Record<string, unknown>;
  /** Override the binary resolved from PATH (Homebrew, a checkout, …). */
  opencodePath?: string;
  /** Attach to an already-running server instead of spawning one. */
  url?: string;
}

/**
 * Minimal structural view of the bits of the SDK client the adapter uses.
 *
 * The v2 client takes a single flat parameters object per call — `directory`
 * sits alongside the body fields rather than in a `query` bag — and returns
 * `{ data }`. Restating that here keeps the adapter honest about the shape and
 * means a generated-client change surfaces as a type error rather than as a
 * request that silently omits `directory` (which would leave the event stream
 * carrying nothing but heartbeats).
 */
export interface OpencodeClientLike {
  event: {
    /**
     * The second argument is the transport options bag — `ServerSentEventsOptions`
     * extends `RequestInit`, so this is the only place an `AbortSignal` can be
     * attached. Without one the stream never ends and any code that waits for
     * the drain to finish waits forever.
     */
    subscribe: (
      params?: { directory?: string },
      options?: { signal?: AbortSignal }
    ) => Promise<{ stream: AsyncIterable<unknown> }>;
  };
  permission: {
    respond: (params: {
      directory?: string;
      permissionID: string;
      response: "always" | "once" | "reject";
      sessionID: string;
    }) => Promise<unknown>;
  };
  session: {
    abort: (params: {
      directory?: string;
      sessionID: string;
    }) => Promise<unknown>;
    create: (params: {
      agent?: string;
      directory?: string;
      permission?: unknown;
      title?: string;
    }) => Promise<{ data?: { id?: string } }>;
    fork: (params: {
      directory?: string;
      sessionID: string;
    }) => Promise<{ data?: { id?: string } }>;
    prompt: (
      params: Record<string, unknown> & { sessionID: string },
      options?: { signal?: AbortSignal }
    ) => Promise<{ data?: unknown }>;
    revert: (params: {
      directory?: string;
      messageID: string;
      sessionID: string;
    }) => Promise<unknown>;
  };
}

export interface OpencodeHandle {
  client: OpencodeClientLike;
  /** Null when attached to a server we did not start. */
  close: (() => void) | null;
  url: string;
}

const BINARY = process.platform === "win32" ? "opencode.exe" : "opencode";
/** A cold first launch on a slow machine must not read as a broken install. */
const START_TIMEOUT_MS = 30_000;

/**
 * Find the `opencode` binary without spawning anything.
 *
 * A PATH scan is `existsSync`-only, so it is safe to call from the synchronous
 * `checkAuth`, which is the whole reason this lives here rather than being
 * discovered when the first edit fails.
 */
export function resolveOpencodeBinary(override?: string): string | null {
  if (override) {
    return existsSync(override) ? override : null;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, BINARY);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Reserve a free port by binding one and letting go.
 *
 * `--port 0` does not work: opencode ignores it and binds its default 4096,
 * then prints that number — so the SDK, which parses the URL out of
 * "opencode server listening on <url>", hands back a URL for a port we never
 * asked for and may not own. Verified against opencode 1.18.13.
 *
 * The gap between closing this socket and opencode binding it is a race, but a
 * far smaller one than colliding with the fixed default every time a user
 * already has an opencode running.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

/**
 * The config injected at server start.
 *
 * `OPENCODE_CONFIG_CONTENT` *merges* with the user's own
 * `~/.config/opencode/opencode.json` rather than replacing it — verified by
 * injecting these keys and watching an unrelated `mcp` entry survive — so this
 * only has to state what airship needs and can leave the rest alone.
 */
function configFor(
  settings: OpencodeSettings | undefined,
  safe: boolean
): Record<string, unknown> {
  return {
    // The config-level gate, in addition to the per-session ruleset the adapter
    // sets. Both, because neither has proved sufficient on its own: a run
    // carrying only the session ruleset still executed a shell command that
    // wrote outside the project without ever raising a request. This is the
    // documented path, and it is applied here because `--safe` is a
    // launch-level posture in airship, fixed for the life of the process — the
    // same reason one shared server is viable at all.
    ...(safe
      ? {
          permission: {
            bash: "ask",
            edit: "ask",
            external_directory: "deny",
            webfetch: "deny",
            websearch: "deny",
          },
        }
      : {}),
    // `session.revert` — airship's `rewind` — is snapshot-backed, so this is
    // set explicitly rather than left to whatever the default happens to be.
    snapshot: true,
    ...(settings?.config ?? {}),
  };
}

let handle: Promise<OpencodeHandle> | null = null;

async function start(
  settings: OpencodeSettings | undefined,
  safe: boolean
): Promise<OpencodeHandle> {
  const { createOpencodeClient, createOpencodeServer } = (await import(
    "@opencode-ai/sdk/v2"
  )) as unknown as {
    createOpencodeClient: (cfg: unknown) => OpencodeClientLike;
    createOpencodeServer: (
      opts: unknown
    ) => Promise<{ close: () => void; url: string }>;
  };

  if (settings?.url) {
    return {
      client: createOpencodeClient({ baseUrl: settings.url }),
      close: null,
      url: settings.url,
    };
  }

  const binary = resolveOpencodeBinary(settings?.opencodePath);
  if (!binary) {
    throw new Error(
      "No `opencode` binary found on PATH. Install it (`brew install sst/tap/opencode` or `npm i -g opencode-ai`), or pass --opencode-path / --opencode-url."
    );
  }

  // The SDK spawns bare `opencode`, so an explicit path is honoured by putting
  // its directory first rather than by an option the SDK does not expose.
  const previousPath = process.env.PATH;
  if (settings?.opencodePath) {
    process.env.PATH = `${join(binary, "..")}${delimiter}${previousPath ?? ""}`;
  }
  try {
    const server = await createOpencodeServer({
      // Must go through this option, not through the environment. The SDK's
      // spawn sets `OPENCODE_CONFIG_CONTENT` itself, from exactly this field,
      // defaulting to `{}` — so anything airship exported beforehand is
      // overwritten before opencode ever reads it. Setting the variable
      // directly looks like it works and silently configures nothing, which is
      // how a `--safe` run reached outside its project during testing.
      config: configFor(settings, safe),
      // Explicit, and never `0.0.0.0`: this is an unauthenticated HTTP server
      // that runs arbitrary shell commands. If someone needs it reachable,
      // that is what `--opencode-url` plus OPENCODE_SERVER_PASSWORD are for.
      hostname: "127.0.0.1",
      port: await freePort(),
      timeout: START_TIMEOUT_MS,
    });
    registerExitHooks();
    return {
      client: createOpencodeClient({ baseUrl: server.url }),
      close: server.close,
      url: server.url,
    };
  } finally {
    process.env.PATH = previousPath;
  }
}

let hooksRegistered = false;

function registerExitHooks(): void {
  if (hooksRegistered) {
    return;
  }
  hooksRegistered = true;
  for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => shutdownServer());
  }
}

/**
 * The shared server, started on first use.
 *
 * A failed start clears the memo so the next edit retries rather than
 * inheriting a rejected promise forever — the common cause is a missing binary
 * or a busy port, both of which a user can fix without restarting airship.
 */
export function acquireServer(
  settings?: OpencodeSettings,
  safe = false
): Promise<OpencodeHandle> {
  handle ??= start(settings, safe).catch((err) => {
    handle = null;
    throw err;
  });
  return handle;
}

/**
 * Stop the shared server, if we started it.
 *
 * Deliberately not called when a single job aborts: the server is shared, and
 * cancelling one edit must not take down the others. Aborting a turn goes
 * through `session.abort` instead.
 */
export function shutdownServer(): void {
  const pending = handle;
  handle = null;
  if (!pending) {
    return;
  }
  pending.then((h) => h.close?.()).catch(() => undefined);
}
