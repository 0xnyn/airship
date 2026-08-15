/**
 * Reachability predicates for the editor server: which `Host` headers it will
 * serve, which `Origin`s may complete a WebSocket upgrade, and how a bind
 * address is presented back to the user. Pure functions, no I/O — the proxy
 * applies them, the tests enumerate them.
 *
 * Three checks, each stopping an attack the other two do not: the loopback
 * bind stops the LAN attacker, the Origin gate stops cross-site WebSocket
 * hijacking from another tab, and the Host allowlist stops DNS rebinding —
 * under rebinding the attacker's page sends an Origin and Host that *match*,
 * so only the Host gate catches it. This is a reachability boundary, not
 * authentication: a non-loopback bind is still an unauthenticated agent.
 */
import net from "node:net";

// Everything a legal Host header can contain: hostname characters, a port
// separator, and brackets for an IPv6 literal. Anything else is rejected
// before URL parsing gets a chance to be clever with it.
const HOST_CHARSET = /^[\w.:[\]-]+$/;

/** Lowercase, strip one layer of IPv6 brackets and one trailing dot. */
export function normalizeHostname(hostname: string): string {
  let out = hostname.toLowerCase();
  if (out.startsWith("[") && out.endsWith("]")) {
    out = out.slice(1, -1);
  }
  if (out.endsWith(".")) {
    out = out.slice(0, -1);
  }
  return out;
}

export interface ParsedHost {
  /** `hostname[:port]` exactly as `URL.host` reports it. */
  host: string;
  /** The name alone, normalized: no brackets, no port, lowercase. */
  hostname: string;
}

/**
 * Parse a raw `Host` header defensively. Returns null — meaning deny — for
 * anything a plain `hostname[:port]` would not produce: userinfo smuggling
 * (`evil.com@localhost`), an embedded path, characters outside the charset,
 * or nothing at all.
 */
export function parseHostHeader(raw: string | undefined): ParsedHost | null {
  if (!(raw && HOST_CHARSET.test(raw))) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.pathname !== "/" || !url.hostname) {
    return null;
  }
  return { host: url.host, hostname: normalizeHostname(url.hostname) };
}

/**
 * Does the `Origin` of a WebSocket handshake match the `Host` it was sent to?
 *
 * An *absent* Origin is allowed: no browser omits it on a WebSocket
 * handshake, so this only admits curl/CLI/tests — the same trust level as
 * "can read our HTTP responses". `Origin: null` (sandboxed iframe, `data:`,
 * `file://`) parses as no URL at all and is denied; it must never be folded
 * into the absent case. Node joins duplicate Origin headers with a comma,
 * which also fails to parse — denied by construction.
 *
 * The Host header is parsed *with the Origin's own scheme* so default ports
 * cancel: `http://localhost` matches `localhost:80`, and `https://x.ngrok.io`
 * matches `x.ngrok.io:443`. A naive string compare would refuse both.
 */
export function originMatchesHost(
  origin: string | string[] | undefined,
  hostHeader: string | undefined
): boolean {
  if (origin === undefined) {
    return true;
  }
  if (Array.isArray(origin) || !hostHeader || !HOST_CHARSET.test(hostHeader)) {
    return false;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return false;
  }
  // A real Origin is scheme://host[:port] and nothing else. Userinfo would
  // otherwise smuggle a matching `.host` past the compare below.
  if (originUrl.username || originUrl.password || originUrl.pathname !== "/") {
    return false;
  }
  let hostUrl: URL;
  try {
    hostUrl = new URL(`${originUrl.protocol}//${hostHeader}`);
  } catch {
    return false;
  }
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== "/") {
    return false;
  }
  return originUrl.host === hostUrl.host;
}

/**
 * Is this (already parsed) hostname one airship should answer for?
 *
 * An IP literal is always allowed — a literal cannot be DNS-rebound, which is
 * the entire basis of the check — and so is bare `localhost`. Everything else
 * must match the allowlist exactly: no wildcards and no suffix matching,
 * which is where the CVEs live.
 */
export function isAllowedHost(
  hostname: string,
  allowed: ReadonlySet<string>
): boolean {
  const name = normalizeHostname(hostname);
  if (net.isIP(name) !== 0) {
    return true;
  }
  if (name === "localhost") {
    return true;
  }
  return allowed.has(name);
}

/**
 * The allowlist the gates consult: `--allowed-hosts` entries, normalized,
 * plus the configured bind host when it is a name — a named bind that is not
 * in its own allowlist would 403 the very URL airship prints.
 */
export function buildAllowedHosts(
  entries: readonly string[] | undefined,
  host: string | undefined
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const entry of entries ?? []) {
    const name = normalizeHostname(entry.trim());
    if (name) {
      out.add(name);
    }
  }
  if (host) {
    const name = normalizeHostname(host);
    if (net.isIP(name) === 0) {
      out.add(name);
    }
  }
  return out;
}

/**
 * A complete 403 as raw bytes, for refusing an upgrade before it upgrades —
 * after `wss.handleUpgrade` there is no way to send a status. Written with
 * `socket.end`, never `write` + `destroy`, which can truncate. The offending
 * Host/Origin value is deliberately not echoed into the body.
 */
export function denyResponse(message: string): string {
  const body = `${message}\n`;
  return [
    "HTTP/1.1 403 Forbidden",
    "connection: close",
    `content-length: ${Buffer.byteLength(body)}`,
    "content-type: text/plain; charset=utf-8",
    "x-content-type-options: nosniff",
    "",
    body,
  ].join("\r\n");
}

/**
 * The URL the user should open for a given bind. Loopback and wildcard binds
 * present as `localhost` — `0.0.0.0`/`::` are not connectable in a browser,
 * and the printed URL must stay clickable. `::1` is connectable and prints
 * bracketed, since the user who typed it meant exactly that stack.
 */
export function bindUrl(host: string, port: number): string {
  const name = normalizeHostname(host);
  if (name === "127.0.0.1" || name === "0.0.0.0" || name === "::") {
    return `http://localhost:${port}`;
  }
  if (net.isIP(name) === 6) {
    return `http://[${name}]:${port}`;
  }
  return `http://${name}:${port}`;
}
