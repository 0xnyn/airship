/**
 * Which models each backend will accept, asked of the backend itself.
 *
 * The three harnesses answer this question very differently, and the asymmetry
 * is the whole reason this module exists:
 *
 * | Backend  | How it enumerates                                        |
 * |----------|----------------------------------------------------------|
 * | claude   | `query.supportedModels()` — live, and account-aware       |
 * | opencode | `client.config.providers()` — live, only what is authed   |
 * | codex    | nothing. No subcommand, no RPC, no config to read        |
 *
 * So Claude and OpenCode are asked, and Codex is served from the generated seed
 * in `@airship/protocol/models`. The seed also backs the other two whenever a
 * probe fails, which is the common case on a machine that has only signed into
 * one of them.
 *
 * Nothing here throws. A picker that cannot list models is a degraded menu; a
 * picker that takes the session down with it is a bug. Every failure comes back
 * as a group with a `note` explaining itself.
 */

import type {
  AgentKind,
  ModelCatalogue,
  ModelGroup,
  ModelOption,
} from "@airship/protocol";
import { AGENT_KINDS } from "@airship/protocol";
import { SEED_MODELS } from "@airship/protocol/models";
import { getAdapter } from "./agent";
import type { OpencodeSettings } from "./providers/opencode-server";

/**
 * How long a single backend gets to answer.
 *
 * Generous, because two of the three probes start a subprocess and a cold
 * `opencode serve` on a slow disk is not a failure. Bounded, because the menu
 * is already on screen showing the seed — this only decides how long the user
 * waits before the live list replaces it.
 */
const PROBE_TIMEOUT_MS = 15_000;

export interface ModelProbeOptions {
  opencode?: OpencodeSettings;
  safe?: boolean;
}

/** The seed rows for one harness, already in wire shape. */
function seedFor(agent: AgentKind): ModelOption[] {
  return SEED_MODELS[agent].map((m) => ({ ...m }));
}

/**
 * Lose a race against the clock rather than hang the request.
 *
 * The losing promise is deliberately not cancelled: `supportedModels()` has no
 * abort signal, and a probe that finishes late is harmless — its result is
 * dropped and the SDK's own teardown still runs. Leaving it to settle is
 * cheaper than inventing a cancellation path the SDKs do not offer.
 */
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} did not answer in time`)),
        PROBE_TIMEOUT_MS
      ).unref?.()
    ),
  ]);
}

// -- Mapping ------------------------------------------------------------------
// Pure, and separated from every probe above it so the translation can be
// tested without an SDK — the same split `opencode-events.ts` uses.

/** The shape `query.supportedModels()` returns, as much of it as a row needs. */
export interface ClaudeModelInfo {
  description?: string;
  displayName?: string;
  value: string;
}

/**
 * Claude's answer → rows.
 *
 * Two things get dropped on the way through.
 *
 * `description` is prose ("Strongest model for coding, agents…") and the hint
 * slot is a dimmed right-aligned mono cell, so it is dropped rather than
 * truncated into it. The seed carries context windows for the ids it knows;
 * anything newer simply has no hint, which reads fine.
 *
 * The SDK's own `default` row goes too. Every group already leads with a
 * synthetic Default that means "send no model and let the daemon's resolved
 * setting stand" — keeping both would put two rows labelled Default in one
 * menu, disagreeing about which setting they defer to.
 */
export function fromClaudeModels(infos: ClaudeModelInfo[]): ModelOption[] {
  const hints = new Map(SEED_MODELS.claude.map((m) => [m.id, m.hint]));
  return infos
    .filter((info) => info?.value && info.value !== "default")
    .map((info) => ({
      hint: hints.get(info.value),
      id: info.value,
      label: info.displayName || info.value,
    }));
}

/** One provider block from `config.providers()`, as much as a row needs. */
export interface OpencodeProvider {
  id: string;
  models?: Record<string, { id?: string; name?: string }>;
  name?: string;
}

/**
 * OpenCode's answer → rows.
 *
 * Ids are joined back into the `provider/model` form, which is the only form
 * that survives: the adapter's `modelRefFor` splits on the first slash and
 * drops an id it cannot attribute to a provider. The provider's display name
 * becomes the hint, because with several providers configured the same model
 * appears more than once and the provider is what tells them apart.
 */
export function fromOpencodeProviders(
  providers: OpencodeProvider[]
): ModelOption[] {
  const rows: ModelOption[] = [];
  for (const provider of providers ?? []) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const id = model?.id ?? modelId;
      rows.push({
        hint: provider.name ?? provider.id,
        id: `${provider.id}/${id}`,
        label: model?.name ?? id,
      });
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// -- Probes -------------------------------------------------------------------

/**
 * Ask Claude, through a session that is never prompted.
 *
 * The same idiom `rewind()` uses: open a `query` with an empty prompt, wait for
 * the one `system/init` message that means the control channel is live, ask the
 * question, and break out of the iterator. `settingSources: []` keeps a
 * project's own config off a call that is only reading a list.
 */
async function probeClaude(cwd: string): Promise<ModelOption[]> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const q = query({
    options: { cwd, permissionMode: "default", settingSources: [] },
    prompt: "",
  });
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      // Returning from inside `for await` runs the iterator's `return()`, which
      // is what tears the subprocess down. Deliberately not `interrupt()`: that
      // needs streaming-input mode and this session has a plain string prompt.
      return fromClaudeModels((await q.supportedModels()) as ClaudeModelInfo[]);
    }
  }
  throw new Error("session did not initialize");
}

async function probeOpencode(
  cwd: string,
  opts: ModelProbeOptions
): Promise<{ default?: string; models: ModelOption[] }> {
  const { acquireServer } = await import("./providers/opencode-server");
  const { client } = await acquireServer(opts.opencode, opts.safe ?? false);
  const res = await client.config.providers({ directory: cwd });
  const providers = res.data?.providers ?? [];
  const models = fromOpencodeProviders(providers);
  // `default` is keyed by provider; the first provider's entry is the one the
  // server would actually pick, so it is the only one worth surfacing.
  const [first] = providers;
  const fallback = first ? res.data?.default?.[first.id] : undefined;
  return {
    default: fallback && first ? `${first.id}/${fallback}` : undefined,
    models,
  };
}

/**
 * One harness's group.
 *
 * Auth is checked before the probe rather than after it fails: an unsigned-in
 * backend would otherwise spend the full timeout on a request that could never
 * have worked, and report "did not answer in time" for what is really a missing
 * credential. The distinction matters — one of those the user can fix.
 */
export async function listModels(
  agent: AgentKind,
  cwd: string,
  opts: ModelProbeOptions = {}
): Promise<ModelGroup> {
  const seed = seedFor(agent);

  // `getAdapter` and `checkAuth` are inside the `try` too, which they were not.
  // `getAdapter` is a dynamic import, so a backend whose package is missing or
  // broken rejects *here* — and this function is called through `Promise.all`,
  // so one unusable backend took the other two down with it and the picker got
  // an error toast with no rows instead of two working groups and one note.
  try {
    const adapter = await getAdapter(agent);
    const auth = adapter.checkAuth();
    if (!auth.ok) {
      return { agent, models: seed, note: auth.reason ?? "Not signed in" };
    }

    // Codex is not probed because there is nothing to probe. Said here rather
    // than left as a silent fallthrough — the absence is the point.
    if (agent === "codex") {
      return { agent, models: seed };
    }

    if (agent === "claude") {
      const models = await withTimeout(probeClaude(cwd), "claude");
      return { agent, models: models.length ? models : seed };
    }
    const { default: fallback, models } = await withTimeout(
      probeOpencode(cwd, opts),
      "opencode"
    );
    return models.length
      ? { agent, default: fallback, models }
      : { agent, models: seed, note: "No providers configured" };
  } catch (err) {
    return {
      agent,
      models: seed,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Every harness, probed at once.
 *
 * Concurrent because the slow one is whichever backend has to start a
 * subprocess, and running them in series would add those cold starts together
 * behind a menu the user is already looking at.
 */
export function listAllModels(
  cwd: string,
  opts: ModelProbeOptions = {}
): Promise<ModelCatalogue> {
  return Promise.all(AGENT_KINDS.map((agent) => listModels(agent, cwd, opts)));
}
