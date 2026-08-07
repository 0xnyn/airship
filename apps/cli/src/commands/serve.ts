/**
 * `airship` — the default command. Launch the editor against a dev server.
 *
 * Everything the old single-file CLI did, plus the settings chain, port
 * detection and dev-server supervision. The order below is deliberate: resolve
 * and validate everything that can fail cheaply *before* starting a child
 * process or binding a port, so a typo never leaves a dev server orphaned.
 */

import {
  type AgentKind,
  type AirshipSurface,
  type CodexSettings,
  checkAuth,
  type Effort,
  type OpencodeSettings,
  startServer,
} from "@airship/server";
import { defineCommand } from "citty";
import {
  argsFor,
  assertKnownFlags,
  GLOBAL_FLAGS,
  requireAmount,
  requireEnum,
  requireInteger,
  requirePort,
} from "../lib/args";
import { parseCodexConfig, readOpencodeConfig } from "../lib/backends";
import { launchBanner, warnBackendLimits } from "../lib/banner";
import { asBoolean, asList, asString, type Settings } from "../lib/config";
import {
  candidatePorts,
  detectTarget,
  firstFreePort,
  isListening,
} from "../lib/detect";
import { CliError, EXIT } from "../lib/errors";
import { type DevServer, openInBrowser, startDevServer } from "../lib/exec";
import { resolveSettings } from "../lib/settings";
import { note, out, setColorEnabled, shouldColor } from "../lib/terminal";

export const SERVE_FLAGS: readonly string[] = [
  "target",
  "port",
  "cwd",
  "mode",
  "exec",
  "open",
  "agent",
  "model",
  "effort",
  "max-turns",
  "max-budget",
  "commit",
  "safe",
  "codex-path",
  "codex-config",
  "opencode-path",
  "opencode-url",
  "opencode-agent",
  "opencode-config",
  ...GLOBAL_FLAGS,
];

export interface ServeOptions {
  agent: AgentKind;
  autoCommit: boolean;
  codex: CodexSettings;
  cwd: string;
  effort?: Effort;
  exec?: string;
  json: boolean;
  maxBudgetUsd?: number;
  maxTurns?: number;
  model?: string;
  open: boolean;
  opencode: OpencodeSettings;
  port?: number;
  quiet: boolean;
  safe: boolean;
  surface: AirshipSurface;
  target?: number;
}

/**
 * Merged settings → validated options.
 *
 * Exported for the tests: this is where every "invalid --x" message is decided,
 * and none of it was reachable when it lived inside `main`.
 */
export function toServeOptions(settings: Settings, cwd: string): ServeOptions {
  const agent = asString(settings, "agent");
  const effort = asString(settings, "effort");
  const mode = asString(settings, "mode");
  const target = asString(settings, "target");
  const port = asString(settings, "port");
  const turns = asString(settings, "max-turns");
  const budget = asString(settings, "max-budget");
  const codexConfig = parseCodexConfig(asList(settings, "codex-config"));

  return {
    agent: (agent ? requireEnum(agent, "agent") : "claude") as AgentKind,
    autoCommit: asBoolean(settings, "commit"),
    codex: {
      codexPath: asString(settings, "codex-path"),
      config: Object.keys(codexConfig).length > 0 ? codexConfig : undefined,
    } satisfies CodexSettings,
    cwd,
    effort: effort ? (requireEnum(effort, "effort") as Effort) : undefined,
    exec: asString(settings, "exec"),
    json: asBoolean(settings, "json"),
    maxBudgetUsd: budget ? requireAmount(budget, "max-budget") : undefined,
    maxTurns: turns ? requireInteger(turns, "max-turns") : undefined,
    model: asString(settings, "model"),
    open: asBoolean(settings, "open"),
    opencode: {
      agent: asString(settings, "opencode-agent"),
      config: readOpencodeConfig(asString(settings, "opencode-config")),
      opencodePath: asString(settings, "opencode-path"),
      url: asString(settings, "opencode-url"),
    } satisfies OpencodeSettings,
    port: port ? requirePort(port, "port") : undefined,
    quiet: asBoolean(settings, "quiet"),
    safe: asBoolean(settings, "safe"),
    surface: (mode ? requireEnum(mode, "mode") : "canvas") as AirshipSurface,
    target: target ? requirePort(target, "target") : undefined,
  };
}

/**
 * Settle on a target port.
 *
 * With `--exec` we are about to start the server ourselves, so a port nothing
 * is listening on yet is exactly right. Without it, the port has to be live —
 * proxying a dead port produces a 502 on the first request and looks like
 * airship is broken rather than like the dev server is not running.
 */
async function resolveTarget(opts: ServeOptions): Promise<number> {
  if (opts.target !== undefined) {
    if (opts.exec) {
      await assertFree(opts.target);
      return opts.target;
    }
    if (!(await isListening(opts.target))) {
      throw new CliError(`Nothing is listening on port ${opts.target}`, {
        hint: 'Start your dev server first, or let airship start it with --exec "pnpm dev".',
      });
    }
    return opts.target;
  }

  if (opts.exec) {
    // Deliberately *not* `detectTarget`: that returns the first candidate
    // already answering, which is the right answer when we are attaching to a
    // running server and the wrong one when we are about to start it. Some
    // other project's dev server on 3000 would outrank the port this project's
    // own dev script declares, and we would proxy the wrong app.
    const [first] = candidatePorts(opts.cwd);
    if (!first) {
      throw new CliError("Could not work out your dev server's port", {
        hint: "Pass it with --target <port>.",
      });
    }
    await assertFree(first.port);
    if (!opts.quiet) {
      note(`  → expecting port ${first.port} — ${first.reason}\n`);
    }
    return first.port;
  }

  const detected = await detectTarget(opts.cwd);
  if (!detected) {
    throw new CliError("Could not work out your dev server's port", {
      hint: "Pass it with --target <port>.",
    });
  }
  if (!detected.listening) {
    throw new CliError(
      `Nothing is listening on port ${detected.port} (${detected.reason})`,
      {
        hint: 'Start your dev server first, pass --target <port>, or let airship start it with --exec "pnpm dev".',
      }
    );
  }
  if (!opts.quiet) {
    note(`  → using port ${detected.port} — ${detected.reason}\n`);
  }
  return detected.port;
}

/**
 * Refuse to `--exec` onto an occupied port.
 *
 * Without this the readiness poll sees whatever is already there, declares the
 * dev server up, and proxies someone else's app while the one we spawned is
 * failing to bind behind it.
 */
async function assertFree(port: number): Promise<void> {
  if (await isListening(port)) {
    throw new CliError(`Something is already listening on port ${port}`, {
      hint: "Stop it, or drop --exec to attach to it instead.",
    });
  }
}

export const serve = defineCommand({
  args: argsFor(SERVE_FLAGS),
  meta: {
    description: "Launch the visual editor against your dev server.",
    name: "airship",
  },
  run: async ({ args, rawArgs }) => {
    assertKnownFlags(rawArgs, SERVE_FLAGS);
    const { cwd, settings } = resolveSettings({
      args,
      names: SERVE_FLAGS,
      rawArgs,
    });
    const opts = toServeOptions(settings, cwd);
    setColorEnabled(shouldColor({ json: opts.json }));

    const targetPort = await resolveTarget(opts);
    // Default to target + 1, but step past anything already bound so a second
    // airship in another project does not fail on EADDRINUSE.
    const port = opts.port ?? (await firstFreePort(targetPort + 1));

    // Attaching to a remote server needs no local binary, so the PATH half of
    // `checkAuth` would be a false alarm there.
    if (!(opts.agent === "opencode" && opts.opencode.url)) {
      const auth = await checkAuth(opts.agent);
      if (!auth.ok) {
        note(`\n  ⚠ ${auth.reason}\n`);
      }
    }

    warnBackendLimits({
      agent: opts.agent,
      cwd: opts.cwd,
      effort: opts.effort,
      maxBudgetUsd: opts.maxBudgetUsd,
      maxTurns: opts.maxTurns,
      model: opts.model,
    });

    let dev: DevServer | undefined;
    if (opts.exec) {
      dev = await startDevServer({
        command: opts.exec,
        cwd: opts.cwd,
        port: targetPort,
        quiet: opts.quiet,
      });
    }

    let server: Awaited<ReturnType<typeof startServer>>;
    try {
      server = await startServer({
        agent: opts.agent,
        autoCommit: opts.autoCommit,
        codex: opts.codex,
        cwd: opts.cwd,
        effort: opts.effort,
        maxBudgetUsd: opts.maxBudgetUsd,
        maxTurns: opts.maxTurns,
        model: opts.model,
        opencode: opts.opencode,
        port,
        safe: opts.safe,
        surface: opts.surface,
        targetPort,
      });
    } catch (err) {
      // We started the dev server; if the proxy cannot come up it is ours to
      // clean up, or the user is left with a stray process holding the port.
      await dev?.stop();
      throw err;
    }

    if (opts.json) {
      out(
        `${JSON.stringify(
          {
            agent: opts.agent,
            cwd: opts.cwd,
            mode: opts.surface,
            port,
            safe: opts.safe,
            targetPort,
            url: server.url,
          },
          null,
          2
        )}\n`
      );
    } else if (!opts.quiet) {
      note(
        launchBanner({
          agent: opts.agent,
          cwd: opts.cwd,
          safe: opts.safe,
          surface: opts.surface,
          targetPort,
          url: server.url,
        })
      );
    }

    if (opts.open) {
      openInBrowser(server.url);
    }

    // A second Ctrl-C is an escape hatch: if a socket somehow outlives
    // `server.close()`, the user should never be stuck holding a dead terminal.
    let stopping = false;
    const shutdown = async (): Promise<void> => {
      if (stopping) {
        process.exit(EXIT.interrupted);
      }
      stopping = true;
      // The dev server goes first: it is the one that holds the port, and
      // closing the proxy under it would strand in-flight requests.
      await dev?.stop();
      await server.close();
      process.exit(0);
    };
    // Signal handlers cannot await. If `shutdown()` itself rejects we still have
    // to leave the terminal in a usable state, so force the exit rather than
    // surfacing an unhandled rejection and hanging on the open server.
    const onSignal = () => {
      shutdown().catch(() => process.exit(EXIT.fail));
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  },
});
