/**
 * `toServeOptions` — where merged settings become validated options.
 *
 * The function has carried "Exported for the tests" since it was split out of
 * `main`, and until now there were none: nothing in the repo imported it. That
 * was survivable while it only read strings across; it stopped being so once it
 * grew the per-backend model fallback, which is real logic with three inputs
 * and a precedence order, and which no other layer re-checks.
 */

import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { FLAGS } from "../lib/args";
import { mergeSettings, type Settings } from "../lib/config";
import { CliError } from "../lib/errors";
import {
  resolveTarget,
  SERVE_FLAGS,
  settleScheme,
  toServeOptions,
} from "./serve";

const CWD = "/tmp/airship-serve-test";

/** Settings as the merge chain would hand them over. */
function settings(values: Record<string, string | boolean>): Settings {
  return mergeSettings(values as Settings);
}

function optionsFor(values: Record<string, string | boolean>) {
  return toServeOptions(settings(values), CWD);
}

/** The message on the CliError a call raises. */
function errorFrom(fn: () => unknown): CliError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) {
      return err;
    }
    throw err;
  }
}

describe("toServeOptions — models", () => {
  it("leaves every backend unset when no model flag is given", () => {
    const { model, models } = optionsFor({});
    expect(model).toBeUndefined();
    // Not `{}`: the keys exist and hold `undefined`, which is what the server
    // reads as "this backend has no configured default".
    expect(models.claude).toBeUndefined();
    expect(models.codex).toBeUndefined();
    expect(models.opencode).toBeUndefined();
  });

  it("spreads a bare --model to all three backends", () => {
    const { models } = optionsFor({ model: "sonnet" });
    expect(models).toEqual({
      claude: "sonnet",
      codex: "sonnet",
      opencode: "sonnet",
    });
  });

  it("lets a per-backend model outrank --model, for that backend only", () => {
    const { models } = optionsFor({ "claude-model": "opus", model: "sonnet" });
    expect(models.claude).toBe("opus");
    // The whole point of the split: switching the picker to Codex must not
    // carry Claude's id across.
    expect(models.codex).toBe("sonnet");
    expect(models.opencode).toBe("sonnet");
  });

  it("takes all three per-backend models independently", () => {
    const { models } = optionsFor({
      "claude-model": "opus",
      "codex-model": "gpt-5.3-codex",
      "opencode-model": "anthropic/claude-sonnet-5",
    });
    expect(models).toEqual({
      claude: "opus",
      codex: "gpt-5.3-codex",
      opencode: "anthropic/claude-sonnet-5",
    });
  });

  it("keeps --model on `model` as well, for the launch banner", () => {
    // `model` is not superseded by `models` — the banner reads it, and dropping
    // it would break a surface that has nothing to do with the picker.
    expect(optionsFor({ model: "sonnet" }).model).toBe("sonnet");
    expect(optionsFor({ "claude-model": "opus" }).model).toBeUndefined();
  });

  it("rejects an --opencode-model with no provider", () => {
    const err = errorFrom(() => optionsFor({ "opencode-model": "sonnet" }));
    expect(err?.message).toContain("opencode-model");
    // The hint has to show the shape, not just name it: the fix is invisible
    // otherwise, since the id itself is perfectly valid for another backend.
    expect(err?.hint).toContain("anthropic/sonnet");
  });

  it("accepts an --opencode-model that names its provider", () => {
    expect(
      optionsFor({ "opencode-model": "anthropic/x" }).models.opencode
    ).toBe("anthropic/x");
  });

  it("does not validate a bare --model, which reaches all three", () => {
    // A bare id is correct for two of the three backends, so this cannot be an
    // error. `banner.ts` warns at launch instead, once the agent is known.
    expect(optionsFor({ model: "sonnet" }).models.opencode).toBe("sonnet");
  });
});

describe("toServeOptions — the surrounding validation still holds", () => {
  it("defaults the agent and rejects an unknown one", () => {
    expect(optionsFor({}).agent).toBe("claude");
    expect(errorFrom(() => optionsFor({ agent: "gemini" }))?.message).toContain(
      "agent"
    );
  });

  it("rejects a port outside the range", () => {
    expect(errorFrom(() => optionsFor({ port: "70000" }))?.message).toContain(
      "port"
    );
  });

  it("rejects a non-numeric budget", () => {
    expect(
      errorFrom(() => optionsFor({ "max-budget": "lots" }))?.message
    ).toContain("max-budget");
  });
});

describe("toServeOptions — host and allowed hosts", () => {
  it("leaves both unset by default", () => {
    const opts = optionsFor({});
    expect(opts.host).toBeUndefined();
    expect(opts.allowedHosts).toEqual([]);
  });

  it("passes a valid host through, lowercased", () => {
    expect(optionsFor({ host: "0.0.0.0" }).host).toBe("0.0.0.0");
    expect(optionsFor({ host: "Dev.Local" }).host).toBe("dev.local");
  });

  it("accepts IPv6 literals, bare or bracketed", () => {
    expect(optionsFor({ host: "::1" }).host).toBe("::1");
    expect(optionsFor({ host: "[::1]" }).host).toBe("::1");
  });

  it("rejects a host carrying a scheme, port or path", () => {
    for (const bad of ["http://x", "localhost:3000", "a/b"]) {
      expect(errorFrom(() => optionsFor({ host: bad }))?.message).toBe(
        `Invalid --host '${bad}'`
      );
    }
  });

  it("splits allowed hosts on commas — the env form cannot repeat", () => {
    expect(
      optionsFor({ "allowed-hosts": "a.test, B.Test," }).allowedHosts
    ).toEqual(["a.test", "b.test"]);
  });

  it("keeps repeated --allowed-hosts entries and still splits each", () => {
    const merged = mergeSettings({
      "allowed-hosts": ["a.test", "b.test,c.test"],
    } as unknown as Settings);
    expect(toServeOptions(merged, CWD).allowedHosts).toEqual([
      "a.test",
      "b.test",
      "c.test",
    ]);
  });

  it("validates each allowed host like a host", () => {
    expect(
      errorFrom(() => optionsFor({ "allowed-hosts": "https://evil.test" }))
        ?.message
    ).toContain("Invalid --allowed-hosts");
  });
});

// The half-wired-flag trap: a flag in the registry but missing here works via
// env and config while `assertKnownFlags` rejects it on the command line — a
// state no other test can see.
describe("SERVE_FLAGS", () => {
  it("carries every non-global flag", () => {
    for (const spec of FLAGS.filter((flag) => flag.group !== "GLOBAL")) {
      expect(SERVE_FLAGS).toContain(spec.name);
    }
  });
});

const FIXTURES = join(import.meta.dirname, "../../test-fixtures");
const TLS_OPTIONS = {
  cert: readFileSync(join(FIXTURES, "localhost.pem")),
  key: readFileSync(join(FIXTURES, "localhost-key.pem")),
};
const NOTHING_LISTENING = /Nothing is listening/;

const servers: (net.Server | tls.Server)[] = [];

function listen(server: net.Server | tls.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolvePort) => {
    server.listen(0, "localhost", () => {
      resolvePort((server.address() as net.AddressInfo).port);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => done());
        })
    )
  );
});

/** Only the fields `resolveTarget` reads; the rest of ServeOptions is irrelevant here. */
const opts = (over: Record<string, unknown>) =>
  ({ cwd: process.cwd(), quiet: true, ...over }) as Parameters<
    typeof resolveTarget
  >[0];

describe("resolveTarget", () => {
  it("reports the scheme of an explicit --target that speaks TLS", async () => {
    const port = await listen(tls.createServer(TLS_OPTIONS));
    expect(await resolveTarget(opts({ target: port }))).toEqual({
      port,
      scheme: "https",
    });
  });

  it("reports no scheme under --exec, because nothing is listening yet", async () => {
    // A port we know is free: bind it, learn the number, release it.
    const probe = net.createServer();
    const port = await new Promise<number>((resolvePort) => {
      probe.listen(0, "localhost", () => {
        resolvePort((probe.address() as net.AddressInfo).port);
      });
    });
    await new Promise<void>((done) => {
      probe.close(() => done());
    });

    const resolved = await resolveTarget(
      opts({ exec: "pnpm dev", target: port })
    );
    expect(resolved).toEqual({ port });
    // The absent scheme is the whole point: the launch path must probe again
    // after the dev server is up, or the proxy dials a TLS upstream in
    // plaintext and 502s on every request. `settleScheme` is what does that,
    // and its own tests cover it.
    expect(resolved.scheme).toBeUndefined();
  });

  it("fails an explicit --target with nothing behind it", async () => {
    const probe = net.createServer();
    const port = await new Promise<number>((resolvePort) => {
      probe.listen(0, "localhost", () => {
        resolvePort((probe.address() as net.AddressInfo).port);
      });
    });
    await new Promise<void>((done) => {
      probe.close(() => done());
    });

    await expect(resolveTarget(opts({ target: port }))).rejects.toThrow(
      NOTHING_LISTENING
    );
  });
});

describe("settleScheme", () => {
  // This is the guard the previous `--exec` `resolveTarget` test could not
  // provide: it exercises the exact post-spawn probe the launch path runs,
  // against a listener that only ever answers TLS. A version that skips the
  // probe (`known ?? "http"`) reports "http" here and this goes red.
  it("probes when the scheme is not already known, and finds TLS", async () => {
    const port = await listen(tls.createServer(TLS_OPTIONS));
    expect(await settleScheme(undefined, port)).toBe("https");
  });

  it("trusts an already-known scheme without probing", async () => {
    // Nothing is listening on this port at all; a probe would report
    // "http" (via the plain-TCP fallback) or, if truly free, would time
    // out. Getting "https" back proves the known value short-circuited.
    const probe = net.createServer();
    const port = await new Promise<number>((resolvePort) => {
      probe.listen(0, "localhost", () => {
        resolvePort((probe.address() as net.AddressInfo).port);
      });
    });
    await new Promise<void>((done) => {
      probe.close(() => done());
    });

    expect(await settleScheme("https", port)).toBe("https");
  });
});
