/**
 * The one test tier that boots the real server. Everything else in this
 * package is a pure-function unit test; the access gates cannot be proven
 * that way, because what matters is what reaches the wire — that a refused
 * upgrade gets a literal 403 before it upgrades, that the `hello` frame is
 * never written to a socket we rejected, and that a blocked Host never costs
 * the upstream a request. Raw sockets, not a WebSocket client, so the
 * assertions are on first bytes.
 *
 * This replays the reproduction from issue #15 (yarikbright).
 */
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { denyResponse } from "./access";
import { type RunningServer, startServer } from "./index";

const WS_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const HOLD_OPEN_MS = 600;

/** The first non-loopback IPv4 on this machine, when it has one. */
const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find(
    (iface) => iface && !iface.internal && iface.family === "IPv4"
  )?.address;

interface Upstream {
  port: number;
  requests: string[];
  server: Server;
  upgrades: string[];
}

async function startUpstream(): Promise<Upstream> {
  const requests: string[] = [];
  const upgrades: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>upstream</body></html>");
  });
  server.on("upgrade", (req, socket) => {
    upgrades.push(String(req.headers["sec-websocket-protocol"] ?? ""));
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n"
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { port, requests, server, upgrades };
}

/**
 * Write one raw request, collect every byte until the peer closes. A
 * completed upgrade never closes on its own, so the socket is destroyed
 * after a beat and whatever arrived — status line, headers, the first
 * WebSocket frames — is what gets asserted on.
 */
function exchange(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(request);
    });
    let data = "";
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString("latin1");
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(data));
    setTimeout(() => socket.destroy(), HOLD_OPEN_MS).unref();
  });
}

function upgradeRequest(
  pathname: string,
  headers: Record<string, string>
): string {
  return [
    `GET ${pathname} HTTP/1.1`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    "connection: Upgrade",
    "upgrade: websocket",
    "sec-websocket-version: 13",
    `sec-websocket-key: ${WS_KEY}`,
    "",
    "",
  ].join("\r\n");
}

function refusedConnect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 1000 }, () => {
      socket.destroy();
      reject(new Error(`connected to ${host}:${port}`));
    });
    socket.on("error", () => resolve());
    socket.on("timeout", () => {
      socket.destroy();
      resolve();
    });
  });
}

describe("the editor server, over raw sockets", () => {
  let upstream: Upstream;
  let server: RunningServer;
  let port: number;
  let cwd: string;

  beforeAll(async () => {
    cwd = mkdtempSync(path.join(os.tmpdir(), "airship-integration-"));
    upstream = await startUpstream();
    server = await startServer({ cwd, port: 0, targetPort: upstream.port });
    port = Number(new URL(server.url).port);
  });

  afterAll(async () => {
    await server.close();
    upstream.server.close();
  });

  describe("the control socket", () => {
    it("refuses a cross-origin upgrade before it upgrades — the #15 repro", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/__airship/ws", {
          host: `localhost:${port}`,
          origin: "http://evil.com",
        })
      );
      expect(reply.startsWith("HTTP/1.1 403 ")).toBe(true);
      // The half-connected failure this guards: a socket that was refused
      // must never have been handed to the WebSocket server first.
      expect(reply).not.toContain("101");
      expect(reply).not.toContain("hello");
    });

    it("refuses Origin: null — a sandboxed iframe is not the absent case", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/__airship/ws", {
          host: `localhost:${port}`,
          origin: "null",
        })
      );
      expect(reply.startsWith("HTTP/1.1 403 ")).toBe(true);
      expect(reply).not.toContain("hello");
    });

    it("admits a client with no Origin at all, and says hello", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/__airship/ws", { host: `localhost:${port}` })
      );
      expect(reply.startsWith("HTTP/1.1 101 ")).toBe(true);
      expect(reply).toContain('"type":"hello"');
    });

    it("admits a same-origin page", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/__airship/ws", {
          host: `localhost:${port}`,
          origin: `http://localhost:${port}`,
        })
      );
      expect(reply.startsWith("HTTP/1.1 101 ")).toBe(true);
      expect(reply).toContain('"type":"hello"');
    });
  });

  describe("the Host gate", () => {
    it("blocks an unlisted Host before the upstream ever hears of it", async () => {
      const before = upstream.requests.length;
      const reply = await exchange(
        port,
        "GET / HTTP/1.1\r\nhost: evil.com\r\n\r\n"
      );
      expect(reply.startsWith("HTTP/1.1 403 ")).toBe(true);
      expect(upstream.requests.length).toBe(before);
    });

    it("refuses an upgrade under an unlisted Host, byte for byte", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/__airship/ws", { host: "evil.com" })
      );
      expect(reply).toBe(denyResponse("Forbidden host"));
    });

    it("serves an IP-literal Host — literals cannot be rebound", async () => {
      const reply = await exchange(
        port,
        `GET / HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n\r\n`
      );
      expect(reply.startsWith("HTTP/1.1 200 ")).toBe(true);
    });
  });

  describe("the HMR tunnel", () => {
    it("still tunnels a same-origin dev-server upgrade, headers intact", async () => {
      const reply = await exchange(
        port,
        upgradeRequest("/", {
          host: `localhost:${port}`,
          "sec-websocket-protocol": "vite-hmr",
        })
      );
      expect(reply.startsWith("HTTP/1.1 101 ")).toBe(true);
      expect(upstream.upgrades).toContain("vite-hmr");
    });

    it("refuses a cross-origin tunnel upgrade — the second door", async () => {
      const before = upstream.upgrades.length;
      const reply = await exchange(
        port,
        upgradeRequest("/", {
          host: `localhost:${port}`,
          origin: "http://evil.com",
          "sec-websocket-protocol": "vite-hmr",
        })
      );
      expect(reply).toBe(denyResponse("Forbidden origin"));
      expect(upstream.upgrades.length).toBe(before);
    });
  });

  describe("the bind", () => {
    it("is unreachable from the LAN by default", async () => {
      if (!lanAddress) {
        // No non-loopback interface on this machine (some CI runners).
        return;
      }
      // `refusedConnect` rejects if the connection succeeds, failing the test.
      await refusedConnect(lanAddress, port);
    });

    it("widens on request, while the printed URL stays clickable", async () => {
      const wide = await startServer({
        cwd,
        host: "0.0.0.0",
        port: 0,
        targetPort: upstream.port,
      });
      try {
        expect(new URL(wide.url).hostname).toBe("localhost");
        const widePort = Number(new URL(wide.url).port);
        const reply = await exchange(
          widePort,
          `GET / HTTP/1.1\r\nhost: localhost:${widePort}\r\n\r\n`
        );
        expect(reply.startsWith("HTTP/1.1 200 ")).toBe(true);
      } finally {
        await wide.close();
      }
    });
  });
});
