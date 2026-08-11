/**
 * Running the user's dev server for them.
 *
 * Airship proxies a dev server rather than starting one, which has always meant
 * two terminals and a remembered port. `--exec "pnpm dev"` collapses that: we
 * start it, wait for its port to answer, and take it down again on the way out.
 *
 * The child goes in its own process group so a Ctrl-C in the terminal reaches
 * only us. Otherwise the shell would signal both, the dev server would die
 * first, and our own shutdown would be racing a corpse.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { isListening } from "./detect";
import { CliError } from "./errors";
import { style } from "./terminal";

const WIN32 = process.platform === "win32";

const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;
const STOP_GRACE_MS = 3000;

export interface DevServer {
  /** Resolves once the child is gone, or after the grace period. */
  stop: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    if (WIN32) {
      // `child` here is cmd.exe, not the dev server — we spawn with `shell`,
      // so the real tree is cmd.exe -> pnpm -> node -> Vite. `child.kill()`
      // maps to TerminateProcess on cmd.exe alone and leaves that tree running,
      // still holding the port, outliving airship and blocking the next launch.
      // taskkill /T is the only way to take the descendants with it.
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    // Negative pid = the whole group, which is what actually stops a dev server
    // that has forked workers of its own.
    process.kill(-child.pid, signal);
  } catch {
    // Already gone between the check and the signal. Nothing left to do.
  }
}

/**
 * Start the dev server and resolve once `port` accepts connections.
 *
 * Fails fast if the child exits first: waiting the full timeout on a process
 * that has already printed its own error and quit tells the user nothing.
 */
export async function startDevServer(opts: {
  command: string;
  cwd: string;
  host?: string;
  port: number;
  quiet?: boolean;
  timeoutMs?: number;
}): Promise<DevServer> {
  const host = opts.host ?? "localhost";
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;

  if (!opts.quiet) {
    process.stderr.write(
      `${style.dim(`  → starting your dev server: ${opts.command}`)}\n`
    );
  }

  const child = spawn(opts.command, {
    cwd: opts.cwd,
    detached: process.platform !== "win32",
    shell: true,
    // The child's output is passed through — including the errors that explain
    // a failure to start — but *both* its streams go to our stderr (fd 2), not
    // to fd 1. Our stdout is the data channel: with `--json` the dev server's
    // startup banner would otherwise land in the middle of the launch record
    // and stop it parsing. Nothing is lost — stderr is still the terminal.
    stdio: opts.quiet ? "ignore" : ["ignore", 2, 2],
  });

  let exited:
    | { code: number | null; signal: NodeJS.Signals | null }
    | undefined;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  // A shell that will not start emits `error` and never `exit`. Without this
  // the readiness loop below would wait the full 90s for a process that was
  // never running — and an unheard `error` event throws.
  child.once("error", () => {
    exited ??= { code: null, signal: null };
  });

  const stop = async (): Promise<void> => {
    if (exited) {
      return;
    }
    killTree(child, "SIGTERM");
    // Windows has no graceful signal — killTree already went straight to
    // `taskkill /F`, so there is nothing to escalate to and nothing to wait
    // for. Polling for three seconds before repeating the same forced kill
    // would only delay shutdown.
    if (WIN32) {
      return;
    }
    for (let waited = 0; waited < STOP_GRACE_MS; waited += POLL_INTERVAL_MS) {
      if (exited) {
        return;
      }
      // Polling for a state change that only another process can cause; there
      // is nothing to run alongside it.
      // biome-ignore lint/performance/noAwaitInLoops: sequential poll
      await sleep(POLL_INTERVAL_MS);
    }
    // It ignored SIGTERM. The user asked to stop; leaving an orphaned dev
    // server holding the port is the worse outcome.
    killTree(child, "SIGKILL");
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited) {
      throw new CliError(
        `Your dev server exited before it started listening on port ${opts.port}`,
        {
          hint: `Run \`${opts.command}\` on its own to see why, or pass --target with the port it actually uses.`,
        }
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: sequential poll
    if (await isListening(opts.port, host)) {
      return { stop };
    }
    if (Date.now() > deadline) {
      await stop();
      throw new CliError(
        `Your dev server did not start listening on port ${opts.port} within ${Math.round(timeoutMs / 1000)}s`,
        {
          hint: "Pass --target with the port it actually uses, or raise the wait if it is just slow to boot.",
        }
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Open a URL in the default browser, best-effort. */
export function openInBrowser(url: string): void {
  // `cmd /c start "" <url>` on Windows rather than `shell: true` + `start`.
  // With a shell Node does no argument escaping, so a URL carrying `&` would be
  // split by cmd.exe into two commands; and `start` reads its first quoted
  // argument as a window title, which is what the empty string absorbs. Same
  // form as openUrl in @airship/server's open-editor.
  const [command, args] =
    process.platform === "win32"
      ? (["cmd", ["/c", "start", "", url]] as const)
      : ([process.platform === "darwin" ? "open" : "xdg-open", [url]] as const);
  try {
    // Detached and fully ignored: the browser outliving airship is the point,
    // and its stdio would otherwise pollute the terminal.
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      // No browser, no display, no `open` — the URL is printed either way.
    });
    child.unref();
  } catch {
    // Same: --open is a convenience, never a reason to fail a launch.
  }
}
