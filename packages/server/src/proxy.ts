/**
 * Universal reverse proxy: forwards every request to the user's dev server and
 * injects the Airship overlay into HTML responses. Framework-agnostic — works with
 * any dev server (Vite, Next, etc.) with zero plugin install. Dev-server
 * WebSocket upgrades (e.g. Vite HMR) are tunnelled; the Airship control socket is
 * served at `wsPath`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  brotliCompressSync,
  gzipSync,
  constants as zlibConstants,
} from "node:zlib";
import {
  AIRSHIP_MODE_PARAM,
  type AirshipMode,
  type AirshipWindowConfig,
  readSurfaceCookie,
  surfaceToMode,
} from "@airship/protocol";
import { escapeForScript, shellHtml } from "./shell";

/** The only shape of font filename this server will read off disk. */
const FONT_FILENAME = /^[a-z0-9-]+\.woff2$/;

const require = createRequire(import.meta.url);

// Hop-by-hop headers must not be forwarded, and length/encoding are recomputed
// when we rewrite the HTML body.
const STRIP_ON_INJECT = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
]);

// Policy, not protocol: framing headers exist to stop *other* origins from
// embedding the app, but every surface here is same-origin inside the editor's
// own canvas — forwarding them just blanks the frame with no page-level error.
// The CSP pair also governs the injected editor itself (the inline config
// script, injected styles, the control socket), so it is dropped wholesale
// rather than edited; `keepCsp` opts back in for someone iterating on their
// own policy.
const STRIP_FOR_SURFACE = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
]);

interface HeaderFilter {
  forSurface: boolean;
  injecting: boolean;
  keepCsp: boolean;
}

function keepsHeader(name: string, opts: HeaderFilter): boolean {
  if (opts.injecting && STRIP_ON_INJECT.has(name)) {
    return false;
  }
  if (!(opts.injecting || opts.forSurface)) {
    return true;
  }
  if (!STRIP_FOR_SURFACE.has(name)) {
    return true;
  }
  // `keepCsp` restores only the CSP pair: X-Frame-Options has no debugging
  // value inside the editor — keeping it can only blank the frame.
  return opts.keepCsp && name !== "x-frame-options";
}

/**
 * Copy upstream response headers onto the response we serve, dropping what
 * must not be forwarded: hop-by-hop and length/encoding when we rewrite the
 * body (`injecting`), and framing/CSP policy on any document served as an
 * editor surface (`forSurface`) — including responses we could not inject
 * into, which is what blanks the canvas for dev servers that send
 * `X-Frame-Options` on compressed or non-UTF-8 HTML.
 */
export function filterProxyHeaders(
  headers: http.IncomingHttpHeaders,
  opts: HeaderFilter
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && keepsHeader(key.toLowerCase(), opts)) {
      out[key] = value;
    }
  }
  return out;
}

const TUNNEL_TIMEOUT_MS = 60_000;

/** Not a surface: hand the upstream body back exactly as it came. */
type Passthrough = "passthrough";

/**
 * Which surface a given HTML request should be served as.
 *
 * The canvas replaces the app at the top level, so under it a plain navigation
 * gets the shell and the app itself is only ever reached through a frame. Four
 * cases, and the order matters:
 *
 * 1. An explicit `?__airship=` wins — it is how the shell addresses its frames,
 *    and how either surface can be forced for one request without disturbing
 *    the sticky preference.
 * 2. `Sec-Fetch-Dest: iframe` means the app is being loaded *into* a frame.
 *    Checking this, and not only the query param, is what keeps client-side
 *    routing inside a frame working: an in-frame navigation to `/settings`
 *    drops the param, and without this the frame would be served a nested
 *    shell — a canvas inside a canvas.
 *
 *    Only under the canvas, though. Inline has no shell driving frames, so an
 *    iframe in that document is the app's own — a video embed, a payment form —
 *    and installing a frame agent in it would be injecting into a third party
 *    for no purpose.
 * 3. A document navigation gets the sticky surface if one is set, else the
 *    launch default. A missing `Sec-Fetch-Dest` counts: the header is
 *    near-universal in browsers, and a client old enough to omit it is one
 *    typing a URL in, which is a navigation.
 *
 *    The cookie is read *here* and nowhere else on purpose. It is a preference
 *    about top-level navigation only; consulted any earlier it could hijack a
 *    frame or an HTML partial, neither of which the user is choosing a surface
 *    for.
 * 4. Everything else passes through untouched. An app fetching an HTML partial
 *    reports `Sec-Fetch-Dest: empty`, and its own data loading is none of our
 *    business — handing it a canvas shell would corrupt the response.
 */
export function resolveMode(
  req: http.IncomingMessage,
  defaultMode: AirshipMode
): AirshipMode | Passthrough {
  const url = new URL(req.url ?? "/", "http://localhost");
  const explicit = url.searchParams.get(AIRSHIP_MODE_PARAM);
  if (explicit === "frame" || explicit === "inline" || explicit === "shell") {
    return explicit;
  }
  const dest = req.headers["sec-fetch-dest"];
  if (dest === undefined || dest === "document") {
    const sticky = readSurfaceCookie(req.headers.cookie);
    return sticky ? surfaceToMode(sticky) : defaultMode;
  }
  if (
    defaultMode === "shell" &&
    (dest === "iframe" || dest === "embed" || dest === "object")
  ) {
    return "frame";
  }
  return "passthrough";
}

/** The app path the shell should point its frames at, `__airship` stripped. */
function appPathname(req: http.IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  url.searchParams.delete(AIRSHIP_MODE_PARAM);
  return `${url.pathname}${url.search}`;
}

// The overlay IIFEs and the editor fonts are assets, not modules — they are
// resolved at runtime instead of imported, so no bundler can inline them. Each
// lookup below therefore tries two places, in this order:
//
//   1. require.resolve, which finds the workspace copies when airship runs out
//      of this monorepo. Always tried first because it is always the freshest:
//      `pnpm dev` rebuilds those packages in place, while dist/vendor/ is only
//      refreshed when apps/cli itself rebuilds.
//   2. dist/vendor/, written by apps/cli/scripts/vendor-assets.mjs. This is the
//      only lookup that resolves in a published install: tsup inlines this file
//      into the CLI bundle, so import.meta.url points at the installed CLI's
//      dist/ — where no @airship/* package exists at all.
//
// Both return null when neither hits, which the callers already treat as a 404.
const vendorDir = new URL("./vendor/", import.meta.url);

function vendored(relative: string): string | null {
  const path = fileURLToPath(new URL(relative, vendorDir));
  return existsSync(path) ? path : null;
}

function overlayBundlePath(): string | null {
  try {
    return require.resolve("@airship/overlay/bundle");
  } catch {
    return vendored("overlay.global.js");
  }
}

// The bippy-instrument IIFE. Injected synchronously into <head> (before the
// app's React renders) so React 19 captures owner-stack source metadata.
function hookBundlePath(): string | null {
  try {
    return require.resolve("@airship/overlay/hook");
  } catch {
    return vendored("hook.global.js");
  }
}

// Self-hosted fonts live in @airship/editor-tokens' dist; serving them here
// keeps them same-origin with the injected overlay (no CORS, no base64 bloat in
// the IIFE). The editor's fonts are independent of the marketing token package.
function tokensFontPath(name: string): string | null {
  if (!FONT_FILENAME.test(name)) {
    return null;
  }
  try {
    return require.resolve(`@airship/editor-tokens/fonts/${name}`);
  } catch {
    return vendored(`fonts/${name}`);
  }
}

export interface ProxyDeps {
  /**
   * Surface a top-level navigation gets when nothing overrides it — the launch
   * `--mode`, translated. Overridable per request by `?__airship=` and per
   * browser by the surface cookie; see `resolveMode`.
   */
  defaultMode: AirshipMode;
  /**
   * Keep upstream `Content-Security-Policy` headers on served surfaces
   * instead of stripping them. Framing protections (`X-Frame-Options`) are
   * dropped regardless — see `STRIP_FOR_SURFACE`.
   */
  keepCsp?: boolean;
  onAirshipUpgrade: (
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => void;
  targetHost: string;
  targetPort: number;
  wsPath: string;
}

export function createProxyServer(deps: ProxyDeps): http.Server {
  const server = http.createServer((req, res) => handleHttp(req, res, deps));
  server.on("upgrade", (req, socket, head) => {
    if (req.url === deps.wsPath) {
      deps.onAirshipUpgrade(req, socket, head);
      return;
    }
    tunnelUpgrade(req, socket, head, deps);
  });
  return server;
}

function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ProxyDeps
): void {
  if (req.url?.startsWith("/__airship/")) {
    serveAirshipAsset(req, res);
    return;
  }

  // Resolved before the upstream round trip: the passthrough branch needs to
  // know whether the response is frame-destined even when it cannot inject.
  const resolved = resolveMode(req, deps.defaultMode);

  const headers = {
    ...req.headers,
    // Ask for identity so we can inject into HTML reliably.
    "accept-encoding": "identity",
    host: `${deps.targetHost}:${deps.targetPort}`,
  };

  const proxyReq = http.request(
    {
      headers,
      host: deps.targetHost,
      method: req.method,
      path: req.url,
      port: deps.targetPort,
      // Node >=20 defaults autoSelectFamily on, so a `localhost` target reaches
      // whichever of ::1/127.0.0.1 the dev server bound (Vite 6 binds ::1 only).
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 200;
      const contentType = String(
        proxyRes.headers["content-type"] ?? ""
      ).toLowerCase();
      const hasCharset = contentType.includes("charset");
      const isUtf8 =
        !hasCharset ||
        contentType.includes("utf-8") ||
        contentType.includes("utf8");
      const canInject =
        contentType.includes("text/html") &&
        isUtf8 &&
        !proxyRes.headers["content-encoding"] &&
        req.method !== "HEAD" &&
        status !== 204 &&
        status !== 304;

      const mode = canInject ? resolved : "passthrough";
      if (mode === "passthrough") {
        res.writeHead(
          status,
          filterProxyHeaders(proxyRes.headers, {
            forSurface: resolved === "frame",
            injecting: false,
            keepCsp: deps.keepCsp ?? false,
          })
        );
        proxyRes.pipe(res);
        return;
      }

      // The shell needs no upstream body — but the request still had to be made
      // to learn that this route *is* HTML. A 404 or a redirect must stay a 404
      // or a redirect; only a real HTML page becomes the canvas.
      if (mode === "shell") {
        proxyRes.resume();
        const body = shellHtml({
          mode,
          pathname: appPathname(req),
          wsPath: deps.wsPath,
        });
        res.writeHead(status, {
          "cache-control": "no-store",
          "content-length": String(Buffer.byteLength(body)),
          "content-type": "text/html; charset=utf-8",
        });
        res.end(body);
        return;
      }

      const chunks: Buffer[] = [];
      proxyRes.on("data", (c: Buffer) => chunks.push(c));
      proxyRes.on("end", () => {
        const body = injectOverlay(Buffer.concat(chunks).toString("utf8"), {
          mode,
          pathname: appPathname(req),
          wsPath: deps.wsPath,
        });
        const outHeaders = filterProxyHeaders(proxyRes.headers, {
          forSurface: mode === "frame",
          injecting: true,
          keepCsp: deps.keepCsp ?? false,
        });
        outHeaders["content-length"] = String(Buffer.byteLength(body));
        res.writeHead(status, outHeaders);
        res.end(body);
      });
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(
      `airship: could not reach your dev server at ${deps.targetHost}:${deps.targetPort}\n${err.message}`
    );
  });

  req.pipe(proxyReq);
}

function injectOverlay(body: string, config: AirshipWindowConfig): string {
  // Classic (non-defer) script: runs synchronously during parse, ahead of the
  // app's deferred module entry, so bippy instruments React before it renders —
  // required for owner-stack source resolution in the picker.
  const hookTag = '<script src="/__airship/hook.js"></script>';
  const json = escapeForScript(JSON.stringify(config));
  const snippet =
    `<script>window.__AIRSHIP__=${json};</script>` +
    `<script src="/__airship/overlay.js" defer></script>`;

  const withHook = injectHead(body, hookTag);

  // Inject the overlay before the LAST </body> (or </html>) to avoid matching one
  // inside an inline script/comment.
  const lower = withHook.toLowerCase();
  const bodyIdx = lower.lastIndexOf("</body>");
  if (bodyIdx !== -1) {
    return withHook.slice(0, bodyIdx) + snippet + withHook.slice(bodyIdx);
  }
  const htmlIdx = lower.lastIndexOf("</html>");
  if (htmlIdx !== -1) {
    return withHook.slice(0, htmlIdx) + snippet + withHook.slice(htmlIdx);
  }
  return withHook + snippet;
}

// Insert `tag` as the first child of <head> so it runs before any app script.
// Falls back to before the first <script>, then to the document start.
function injectHead(body: string, tag: string): string {
  const lower = body.toLowerCase();
  const headOpen = lower.indexOf("<head");
  if (headOpen !== -1) {
    const headEnd = body.indexOf(">", headOpen);
    if (headEnd !== -1) {
      return body.slice(0, headEnd + 1) + tag + body.slice(headEnd + 1);
    }
  }
  const scriptIdx = lower.indexOf("<script");
  if (scriptIdx !== -1) {
    return body.slice(0, scriptIdx) + tag + body.slice(scriptIdx);
  }
  return tag + body;
}

/**
 * The overlay bundle is ~600 KB of minified JS and is re-fetched on every page
 * load (`no-store`, because it changes with every rebuild). Serving it raw is
 * most of the editor's cold-start cost, and it compresses to roughly a quarter
 * of that — so the bundle is compressed once per process and the result cached
 * against the file's mtime, which is the only thing that changes between builds.
 */
interface Encoded {
  body: Buffer;
  encoding: string | null;
}
const encodedCache = new Map<string, Encoded>();

function serveCompressible(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  contentType: string,
  cacheControl: string
): void {
  const accept = String(req.headers["accept-encoding"] ?? "");
  let wants: "br" | "gzip" | null = null;
  if (accept.includes("br")) {
    wants = "br";
  } else if (accept.includes("gzip")) {
    wants = "gzip";
  }
  const raw = readFileSync(file);

  let out: Encoded = { body: raw, encoding: null };
  if (wants) {
    // Keyed on mtime so a rebuild invalidates without a watcher.
    const key = `${file}:${wants}:${statSync(file).mtimeMs}`;
    const hit = encodedCache.get(key);
    if (hit) {
      out = hit;
    } else {
      // Quality 5 is the knee of the curve for JS this size: within ~3% of
      // brotli's max ratio at a fraction of the CPU, which matters because the
      // first request pays for it synchronously.
      out = {
        body:
          wants === "br"
            ? brotliCompressSync(raw, {
                params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
              })
            : gzipSync(raw, { level: 6 }),
        encoding: wants,
      };
      encodedCache.set(key, out);
    }
  }

  const headers: Record<string, string> = {
    "cache-control": cacheControl,
    "content-length": String(out.body.length),
    "content-type": contentType,
    vary: "accept-encoding",
  };
  if (out.encoding) {
    headers["content-encoding"] = out.encoding;
  }
  res.writeHead(200, headers);
  res.end(out.body);
}

function serveAirshipAsset(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  if (req.url?.startsWith("/__airship/fonts/")) {
    const fontPath = tokensFontPath(req.url.slice("/__airship/fonts/".length));
    if (fontPath && existsSync(fontPath)) {
      res.writeHead(200, {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": "font/woff2",
      });
      res.end(readFileSync(fontPath));
      return;
    }
  }

  const bundle = overlayBundlePath();
  if (req.url === "/__airship/overlay.js" && bundle && existsSync(bundle)) {
    serveCompressible(
      req,
      res,
      bundle,
      "application/javascript; charset=utf-8",
      "no-store"
    );
    return;
  }
  if (req.url === "/__airship/overlay.global.js.map" && bundle) {
    const map = `${bundle}.map`;
    if (existsSync(map)) {
      serveCompressible(req, res, map, "application/json", "no-store");
      return;
    }
  }

  const hook = hookBundlePath();
  if (req.url === "/__airship/hook.js" && hook && existsSync(hook)) {
    serveCompressible(
      req,
      res,
      hook,
      "application/javascript; charset=utf-8",
      "no-store"
    );
    return;
  }
  if (req.url === "/__airship/hook.global.js.map" && hook) {
    const map = `${hook}.map`;
    if (existsSync(map)) {
      serveCompressible(req, res, map, "application/json", "no-store");
      return;
    }
  }

  res.writeHead(404);
  res.end("not found");
}

function tunnelUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: ProxyDeps
): void {
  const upstream = net.connect(
    // Options form so happy-eyeballs applies (Vite 6 binds ::1 only).
    { autoSelectFamily: true, host: deps.targetHost, port: deps.targetPort },
    () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            lines.push(`${key}: ${v}`);
          }
        } else if (value !== undefined) {
          lines.push(`${key}: ${value}`);
        }
      }
      lines.push("\r\n");
      upstream.write(lines.join("\r\n"));
      if (head?.length) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    }
  );

  upstream.setTimeout(TUNNEL_TIMEOUT_MS);
  const teardown = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", teardown);
  upstream.on("close", teardown);
  upstream.on("timeout", teardown);
  socket.on("error", teardown);
  socket.on("close", teardown);
}
