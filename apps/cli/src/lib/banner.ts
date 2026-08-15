/**
 * Everything the CLI says at launch.
 *
 * Kept apart from the command because it is the part that grows with every
 * backend and every surface, and because a dropped spend cap or an ignored
 * model is the kind of surprise that is only cheap to discover early.
 */

import type { AgentKind, AirshipSurface } from "@airship/server";
import { isGitRepo } from "@airship/server";
import { style } from "./terminal";

/** What `--safe` actually buys on this backend, stated where the user looks. */
export function safetyBanner(agent: AgentKind, safe: boolean): string {
  if (!safe) {
    return (
      `  ${style.yellow("⚠ Unsandboxed:")} the agent can write anywhere and reach the network.\n` +
      `    ${style.dim("Pass --safe to confine it to this project.")}\n`
    );
  }
  if (agent === "codex") {
    return `  ${style.green("Sandboxed:")} edits are confined to the project and the network is off.\n`;
  }
  // claude and opencode share the same guards, and neither cuts the socket.
  return (
    `  ${style.yellow("Screened:")} edits are confined to the project and destructive commands are\n` +
    "    blocked — but there is no OS sandbox here. Raw network access is not\n" +
    "    cut, and the command screen does not parse shell redirection.\n"
  );
}

/** Said whenever the bind reaches beyond loopback — there is no auth here. */
export function exposureBanner(host: string): string {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "127.0.0.1" || name === "::1" || name === "localhost") {
    return "";
  }
  return (
    `  ${style.yellow("⚠ Exposed:")} listening on ${host} with no authentication. Anything that\n` +
    "    can reach this interface can drive a coding agent with write access to\n" +
    "    this project. Use only on networks where you trust every device.\n\n"
  );
}

/** Everything a backend silently will not do, said once at launch. */
export function warnBackendLimits(o: {
  agent: AgentKind;
  cwd: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  /** The *resolved* per-backend models, as `serve.ts` collapses them. Not the
   * raw `--model`: what a turn will actually send is what is worth warning on. */
  models?: Partial<Record<AgentKind, string>>;
}): void {
  const warn = (message: string): void => {
    process.stderr.write(`\n  ${style.yellow(`⚠ ${message}`)}\n`);
  };

  // Codex refuses to run outside a git repo, and both non-Claude backends
  // reconstruct their diff baseline from git — so this is worth saying before
  // the first edit silently produces an empty diff.
  if (o.agent !== "claude" && !isGitRepo(o.cwd)) {
    warn(
      `${o.cwd} is not a git repository. ${o.agent} needs git for its diff baseline, and undo needs git.`
    );
  }
  if (o.agent !== "claude" && o.maxBudgetUsd !== undefined) {
    warn(
      `--max-budget is ignored with --agent ${o.agent}: it has no budget cap.`
    );
  }
  if (o.agent !== "claude" && o.maxTurns !== undefined) {
    warn(
      `--max-turns is ignored with --agent ${o.agent}: it runs each turn to completion.`
    );
  }
  if (o.agent === "opencode" && o.effort) {
    warn(
      "--effort is ignored with --agent opencode: it exposes no reasoning-effort control.\n    Set a provider-specific equivalent through --opencode-config."
    );
  }
  // A bare model id cannot be resolved to a provider, so it would be dropped
  // silently and the run would quietly use opencode's default instead.
  //
  // Read off the *resolved* per-backend value, not `--model`: that is what a
  // turn will actually send. It also makes this unreachable via
  // `--opencode-model`, which `requireModelRef` already rejects outright — a
  // flag that names its backend can be a hard error, and only the catch-all
  // `--model` is left needing a warning.
  const opencodeModel = o.models?.opencode;
  if (o.agent === "opencode" && opencodeModel && !opencodeModel.includes("/")) {
    warn(
      `--model '${opencodeModel}' is ignored with --agent opencode: it wants the provider/model form (e.g. anthropic/${opencodeModel}).\n    Set --opencode-model to give opencode its own.`
    );
  }
}

/** The one line that differs per surface — what the user is about to see. */
function surfaceLines(surface: AirshipSurface): string {
  if (surface === "inline") {
    return (
      "  The editor is injected into your app, in the page itself.\n" +
      `  ${style.dim("Pick an element and describe a change · switch to the canvas in the bar.")}\n`
    );
  }
  return (
    "  Your app opens on a canvas — one live frame per device size.\n" +
    `  ${style.dim("Pick an element and describe a change · ⇧1 fits · space-drag pans.")}\n`
  );
}

export function launchBanner(info: {
  agent: AgentKind;
  cwd: string;
  /** The interface the proxy is listening on, for the exposure warning. */
  host: string;
  /** The resolved model for `agent`, when one was configured. */
  model?: string;
  safe: boolean;
  surface: AirshipSurface;
  targetPort: number;
  url: string;
}): string {
  // Four flags can name a model — `--model`, the three per-backend ones — and
  // they resolve in an order. Without this the only way to learn which one won
  // was to run a turn and read the transcript. Omitted rather than guessed when
  // nothing was configured: the backend picks in that case, and naming a default
  // airship did not choose would be a claim it cannot make.
  const on = info.model ? ` on ${info.model}` : "";
  return (
    `\n  ${style.magenta("◆")} ${style.bold("airship")}  —  editing ${info.cwd} with ${info.agent}${on}\n` +
    `  → open ${style.cyan(info.url)}\n` +
    `    ${style.dim(`(proxying your dev server at http://localhost:${info.targetPort})`)}\n\n` +
    exposureBanner(info.host) +
    // Stated at every launch, not just in --help: a tool that can write
    // anywhere on disk should say so where the user is actually looking.
    `${safetyBanner(info.agent, info.safe)}\n` +
    surfaceLines(info.surface) +
    `  ${style.dim("Ctrl-C to stop.")}\n\n`
  );
}
