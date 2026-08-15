# Security

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/0xnyn/airship/security/advisories/new)
rather than a public issue. If that form is unavailable to you, open an issue that says only
that you have a security report and how to reach you — hold the details for a private channel.

Reports are welcome and credited. Issue #15 is what this policy grew out of.

## The security model

Airship is a local development tool: an HTTP proxy in front of your dev server, a WebSocket
that drives a coding agent, and an overlay injected into your own app. The agent can write to
your project and, unless you pass `--safe`, do whatever your agent could do from a terminal.

What the server enforces, in `packages/server/src/access.ts`:

- **Loopback bind by default.** The proxy listens on `127.0.0.1` unless `--host` says
  otherwise, so other machines cannot reach it at all.
- **A Host allowlist.** Requests are served only for `localhost`, IP literals, the configured
  `--host`, and exact `--allowed-hosts` entries. This is what stops DNS rebinding, where an
  attacker's page turns its own hostname into your loopback address; an IP literal cannot be
  rebound, which is why literals are always accepted.
- **An Origin gate on every WebSocket upgrade** — the control socket and the HMR tunnel
  alike. A handshake whose `Origin` does not match its `Host` is refused before the upgrade
  completes, which stops cross-site WebSocket hijacking from another browser tab.
  `Origin: null` (sandboxed iframes, `file://`) is refused; an *absent* Origin — curl, CLI
  tools — is allowed, since it carries the same trust as any local HTTP client.

## What is deliberately not defended

This is a reachability boundary, not authentication. Know what you are opting into:

- **`--host 0.0.0.0` exposes an unauthenticated agent.** Anyone who can reach the interface
  can drive an agent with write access to your project — IP-literal Hosts are accepted by
  design, since refusing them would break exactly the LAN access you asked for. Airship warns
  at launch; use it only on networks where you trust every device.
- **Non-browser clients are not authenticated.** Anything that can open a TCP connection to
  the (loopback-only, by default) port can speak the protocol.
- **`X-Forwarded-Host` and `Forwarded` are never read.** Behind a reverse proxy, add the
  public name to `--allowed-hosts`.
- **Host-less HTTP/1.0 requests are refused** rather than guessed at.
- **Upstream `Content-Security-Policy` and `X-Frame-Options` headers are stripped** from the
  surfaces airship serves (opt back in with `--keep-csp`); your deployed app's headers are
  untouched by anything airship does.
