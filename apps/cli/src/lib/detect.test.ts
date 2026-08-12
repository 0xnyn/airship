import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { candidatePorts, detectTarget, probeScheme } from "./detect";

const FIXTURES = join(import.meta.dirname, "../../test-fixtures");
const TLS_OPTIONS = {
  cert: readFileSync(join(FIXTURES, "localhost.pem")),
  key: readFileSync(join(FIXTURES, "localhost-key.pem")),
};

const servers: (net.Server | tls.Server)[] = [];

/** Listen on an ephemeral port, and register for teardown. */
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

describe("probeScheme", () => {
  it("reports https for a TLS listener", async () => {
    const port = await listen(tls.createServer(TLS_OPTIONS));
    expect(await probeScheme(port)).toBe("https");
  });

  it("reports http for a plaintext listener", async () => {
    // A bare net.Server never reads the ClientHello bytes (nothing resumes
    // the stream), so it neither answers nor notices the client giving up —
    // it just hangs. An http.Server has the real behavior probeScheme relies
    // on: Node's HTTP parser recognizes the TLS record header and tears the
    // connection down immediately, which is what a real plaintext dev server
    // does too.
    const port = await listen(http.createServer());
    expect(await probeScheme(port)).toBe("http");
  });

  it("falls back to a TCP probe when the handshake times out twice", async () => {
    // A server that accepts the connection and then never responds: the
    // ClientHello is never answered, so the handshake neither completes nor
    // errors — it only times out. `resume()` puts the accepted socket in
    // flowing mode so it notices the probe's connections closing (otherwise
    // the socket never notices the peer is gone and `server.close()` in
    // `afterEach` hangs) without changing what's under test: the socket still
    // never writes anything back, so the handshake still stalls. The explicit
    // retry window keeps this test fast rather than waiting out
    // TIMEOUT_RETRY_MS's real-world default.
    const port = await listen(
      net.createServer((socket) => {
        socket.resume();
      })
    );
    expect(await probeScheme(port, "localhost", 150, 100)).toBe("http");
  });

  it("retries a timed-out handshake and reports https once it completes", async () => {
    // The bug this guards: a next dev --experimental-https process whose
    // event loop is blocked mid-compile can miss a short probe window without
    // being plaintext. This models "accepted the connection but was slow to
    // actually answer it" — as opposed to the never-responds case above — by
    // relaying to a real TLS listener only after a delay that blows the first
    // probe's window but comfortably fits inside the retry's.
    const backendPort = await listen(tls.createServer(TLS_OPTIONS));
    const relayDelayMs = 150;
    const port = await listen(
      net.createServer((clientSocket) => {
        let upstream: net.Socket | undefined;
        const timer = setTimeout(() => {
          upstream = net.connect(backendPort, "localhost", () => {
            clientSocket.pipe(upstream as net.Socket);
            (upstream as net.Socket).pipe(clientSocket);
          });
        }, relayDelayMs);
        // However the connection ends, tear down the half we opened
        // ourselves so `server.close()` in `afterEach` does not hang waiting
        // on a socket nothing will ever close.
        clientSocket.once("close", () => {
          clearTimeout(timer);
          upstream?.destroy();
        });
      })
    );

    // A first window shorter than the relay's delay, so it times out and
    // forces the retry path; a retry window comfortably longer than it, so
    // the second attempt lands on a real TLS listener.
    expect(await probeScheme(port, "localhost", 40, 1000)).toBe("https");
  });

  it("reports null when nothing is listening", async () => {
    // Bind and immediately release, so the port is known-free rather than guessed.
    const server = net.createServer();
    const port = await new Promise<number>((resolvePort) => {
      server.listen(0, "localhost", () => {
        resolvePort((server.address() as net.AddressInfo).port);
      });
    });
    await new Promise<void>((done) => {
      server.close(() => done());
    });
    expect(await probeScheme(port)).toBeNull();
  });
});

function project(pkg: Record<string, unknown> | null): string {
  const root = mkdtempSync(join(tmpdir(), "airship-detect-"));
  if (pkg) {
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  }
  return root;
}

const portsOf = (cwd: string): number[] =>
  candidatePorts(cwd).map((candidate) => candidate.port);

describe("candidatePorts", () => {
  it("takes an explicit --port from the dev script first", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev --port 4000" },
    });
    const [first] = candidatePorts(cwd);
    expect(first).toEqual({
      port: 4000,
      reason: "the port in your dev script",
    });
  });

  it("reads the --port=N form", () => {
    const cwd = project({ scripts: { dev: "next dev --port=4100" } });
    expect(portsOf(cwd)[0]).toBe(4100);
  });

  it("reads the -p form", () => {
    const cwd = project({ scripts: { dev: "astro dev -p 4200" } });
    expect(portsOf(cwd)[0]).toBe(4200);
  });

  it("reads a PORT= prefix", () => {
    const cwd = project({ scripts: { dev: "PORT=4300 remix dev" } });
    expect(portsOf(cwd)[0]).toBe(4300);
  });

  it("falls back to start, then serve", () => {
    expect(portsOf(project({ scripts: { start: "x --port 4400" } }))[0]).toBe(
      4400
    );
    expect(portsOf(project({ scripts: { serve: "x --port 4500" } }))[0]).toBe(
      4500
    );
  });

  it("uses the framework's default port when the script says nothing", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev" },
    });
    expect(candidatePorts(cwd)[0]).toEqual({
      port: 5173,
      reason: "vite's default port",
    });
  });

  it("prefers the more specific framework when both are present", () => {
    const cwd = project({ devDependencies: { next: "^15", vite: "^7" } });
    expect(portsOf(cwd)[0]).toBe(3000);
  });

  it("recognises storybook by its scoped packages", () => {
    const cwd = project({ devDependencies: { "@storybook/react": "^9" } });
    expect(portsOf(cwd)).toContain(6006);
  });

  it("finds frameworks in dependencies as well as devDependencies", () => {
    const cwd = project({ dependencies: { nuxt: "^3" } });
    expect(portsOf(cwd)[0]).toBe(3000);
  });

  it("always offers the common ports as a fallback", () => {
    expect(portsOf(project({}))).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("survives a project with no package.json", () => {
    expect(portsOf(project(null))).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("survives a malformed package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "airship-detect-"));
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(portsOf(root)).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("never repeats a port", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev --port 5173" },
    });
    const ports = portsOf(cwd);
    expect(new Set(ports).size).toBe(ports.length);
    // The reason for the first sighting is kept — it is the more specific one.
    expect(candidatePorts(cwd)[0]?.reason).toBe("the port in your dev script");
  });
});

describe("detectTarget", () => {
  it("reports the scheme of the candidate it settles on", async () => {
    const port = await listen(tls.createServer(TLS_OPTIONS));
    const cwd = project({ scripts: { dev: `next dev --port ${port}` } });
    const detected = await detectTarget(cwd);
    expect(detected).toMatchObject({ listening: true, port, scheme: "https" });
  });
});
