/**
 * Working out which port the user's dev server is on, so `--target` can be
 * optional.
 *
 * Two sources, in order of how much they actually know: the project's own dev
 * script, which may state a port outright, and the framework it depends on,
 * whose default port is a good guess. Every candidate is then probed, because a
 * guess that nothing is listening on is worse than no guess — it would send the
 * proxy at a dead port and produce a 502 on the first request.
 */

import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export interface Candidate {
  port: number;
  /** Said back to the user, so a wrong guess is obvious rather than magic. */
  reason: string;
}

export interface Detection extends Candidate {
  /** Whether something is accepting connections there right now. */
  listening: boolean;
}

/**
 * Default dev-server ports, by the package that owns them. Ordered most
 * specific first: a project with both `vite` and `storybook` is a Vite app that
 * also has a catalogue, not the other way round.
 */
const FRAMEWORK_PORTS: readonly [string, number, string][] = [
  ["next", 3000, "next"],
  ["nuxt", 3000, "nuxt"],
  ["@remix-run/dev", 3000, "remix"],
  ["react-scripts", 3000, "create-react-app"],
  ["astro", 4321, "astro"],
  ["@sveltejs/kit", 5173, "sveltekit"],
  ["vite", 5173, "vite"],
  ["@angular/cli", 4200, "angular"],
  ["gatsby", 8000, "gatsby"],
  ["@11ty/eleventy", 8080, "eleventy"],
  ["parcel", 1234, "parcel"],
  ["storybook", 6006, "storybook"],
];

/** Ports worth trying when the project says nothing useful. */
const COMMON_PORTS: readonly number[] = [3000, 5173, 8080, 4321, 4200];

const PORT_FLAG = /(?:--port[= ]|-p[= ])(\d{2,5})/;
const PORT_ENV = /\bPORT=(\d{2,5})/;

/**
 * The project's package.json, or nothing.
 *
 * A malformed one is the app's problem, not a reason to refuse to launch — port
 * detection just falls through to the common ports.
 */
function readPackageJson(cwd: string): Record<string, unknown> | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    return;
  }
  const parsed: unknown = tryParse(readFileSafe(path));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Every port worth trying, best guess first, deduplicated. */
export function candidatePorts(cwd: string): Candidate[] {
  const pkg = readPackageJson(cwd);
  const out: Candidate[] = [];
  const seen = new Set<number>();
  const add = (port: number, reason: string): void => {
    if (!seen.has(port)) {
      seen.add(port);
      out.push({ port, reason });
    }
  };

  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const devScript = scripts.dev ?? scripts.start ?? scripts.serve;
  if (devScript) {
    const flag = PORT_FLAG.exec(devScript) ?? PORT_ENV.exec(devScript);
    if (flag?.[1]) {
      add(Number(flag[1]), "the port in your dev script");
    }
  }

  const deps = {
    ...((pkg?.dependencies ?? {}) as Record<string, string>),
    ...((pkg?.devDependencies ?? {}) as Record<string, string>),
  };
  for (const [name, port, label] of FRAMEWORK_PORTS) {
    const matched =
      name in deps ||
      // Storybook publishes a dozen scoped packages and no single stable id.
      (name === "storybook" &&
        Object.keys(deps).some((dep) => dep.startsWith("@storybook/")));
    if (matched) {
      add(port, `${label}'s default port`);
    }
  }

  for (const port of COMMON_PORTS) {
    add(port, "a common dev-server port");
  }
  return out;
}

const PROBE_TIMEOUT_MS = 400;

/** Whether anything is listening. Used for detection and by `doctor`. */
export function isListening(
  port: number,
  host = "localhost",
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host, port });
    const done = (result: boolean): void => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * The best guess at the dev server's port.
 *
 * Returns the first candidate that answers. When nothing answers it still
 * returns the best guess with `listening: false`, because the wizard wants a
 * sensible prefilled value even before the server is up — only `serve` insists
 * on something live.
 */
export async function detectTarget(
  cwd: string,
  host = "localhost"
): Promise<Detection | undefined> {
  const candidates = candidatePorts(cwd);
  for (const candidate of candidates) {
    // Sequential on purpose: the candidates are in priority order and the first
    // hit wins, so probing them together would open connections to ports we have
    // already decided against and could pick the one that merely answered first.
    // biome-ignore lint/performance/noAwaitInLoops: ordered first-match search
    if (await isListening(candidate.port, host)) {
      return { ...candidate, listening: true };
    }
  }
  const [first] = candidates;
  return first ? { ...first, listening: false } : undefined;
}

/**
 * Whether we can actually take this port, by taking it and letting go.
 *
 * `isListening` answers a different question — "is something accepting here" —
 * and the two diverge on Windows, where Hyper-V, WSL2 and Docker Desktop
 * reserve whole ranges of dynamic ports (`netsh interface ipv4 show
 * excludedportrange tcp`). Nothing accepts on a reserved port, so a connect
 * probe calls it free, and the bind then fails with EACCES.
 */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = net.createServer();
    probe.once("error", () => resolvePromise(false));
    probe.listen({ host, port }, () => {
      probe.close(() => resolvePromise(true));
    });
  });
}

/** A port nothing is bound to, so the proxy does not collide on startup. */
export async function firstFreePort(
  start: number,
  host = "localhost",
  attempts = 20
): Promise<number> {
  for (let port = start; port < start + attempts; port += 1) {
    // Also ordered: "the first free port at or after `start`" is the answer, so
    // the probes cannot be collapsed into one parallel batch.
    // biome-ignore lint/performance/noAwaitInLoops: ordered first-match search
    if (await canBind(port, host)) {
      return port;
    }
  }
  return start;
}
