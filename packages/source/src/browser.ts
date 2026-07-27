/**
 * @airship/source/browser — wraps `element-source` to map a picked DOM node back to
 * its source file/line and component name across React, Vue, Svelte, Solid and
 * Preact. Bundled into the overlay IIFE.
 */

import type { ElementContext, SourceLocation } from "@airship/protocol";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { getFiberFromHostInstance } from "bippy";
import {
  formatOwnerStack,
  isSourceFile,
  normalizeFileName,
  parseStack,
} from "bippy/source";
import {
  createSourceResolver,
  type ElementInfo,
  getTagName,
  preactResolver,
  reactResolver,
  solidResolver,
  svelteResolver,
  vueResolver,
} from "element-source";

type Resolver = ReturnType<typeof createSourceResolver>;

let resolver: Resolver | null = null;

export function initSourceResolver(): Resolver {
  if (!resolver) {
    resolver = createSourceResolver({
      resolvers: [
        reactResolver,
        vueResolver,
        svelteResolver,
        solidResolver,
        preactResolver,
      ],
    });
  }
  return resolver;
}

function toSourceLocation(
  info: {
    filePath: string;
    lineNumber: number | null;
    columnNumber: number | null;
  } | null
): SourceLocation | null {
  if (info?.filePath && info.lineNumber !== null) {
    return {
      column: info.columnNumber ?? undefined,
      file: info.filePath,
      line: info.lineNumber,
    };
  }
  return null;
}

export async function extractSource(
  el: Element
): Promise<SourceLocation | null> {
  return (
    (await elementSource(el)) ??
    toSourceLocation(await initSourceResolver().resolveSource(el))
  );
}

export async function extractElementInfo(el: Element): Promise<{
  context: ElementContext;
  source: SourceLocation | null;
}> {
  const info: ElementInfo = await initSourceResolver().resolveElementInfo(el);
  const html = el as HTMLElement;
  const context: ElementContext = {
    classes: Array.from(el.classList ?? []),
    displayName: info.componentName ?? null,
    selector: buildSelector(el),
    tagName: getTagName(el) || el.tagName.toLowerCase(),
    textPreview: (html.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
  };
  return {
    context,
    source: (await elementSource(el)) ?? toSourceLocation(info.source),
  };
}

// -- Per-element source, from React 19's owner stack --------------------------

/**
 * `element-source` resolves the location of the *component*, not of the element
 * you picked. Its `getOwnerStack` builds every frame from bippy's *fallback*
 * stack, which describes a fiber by invoking its type with a nulled dispatcher
 * and reading where it throws — so a function component resolves to its first
 * hook call, and the whole tree App renders reports one line: App's `useState`.
 * That is the "always App.tsx:32" you get on a single-component page.
 *
 * React 19 does record the real per-element JSX call site, in
 * `fiber._debugStack` (which is why `hook.ts` installs bippy's hook before the
 * app renders). `_debugSource` — the old per-element `__source` prop — is gone
 * in 19, so the owner stack is the only per-element signal left. This reads it,
 * and maps the frame back through the module's sourcemap because those
 * coordinates belong to the *served* module: a dev-server transform prepends an
 * HMR preamble and rewrites JSX, so raw frame lines are off by tens of lines
 * and name a URL rather than a file the agent can edit.
 */
async function elementSource(el: Element): Promise<SourceLocation | null> {
  const stack = ownerStackOf(el);
  if (!stack) {
    return null;
  }
  // Pick the frame first, then map it. The loop only ever resolved one frame —
  // it returned on the first match — so the await belongs outside it.
  const frame = parseStack(formatOwnerStack(stack)).find(
    (f) => f.fileName && isSourceFile(f.fileName) && f.lineNumber !== null
  );
  if (!frame?.fileName || frame.lineNumber === null) {
    return null;
  }
  return (
    (await mapThroughSourceMap(frame.fileName, frame)) ?? {
      column: frame.columnNumber ?? undefined,
      file: normalizeFileName(frame.fileName),
      line: frame.lineNumber,
    }
  );
}

/** React attaches its debug stack to the fiber, not to the DOM node. */
interface DebugFiber {
  _debugStack?: { stack?: unknown };
}

/**
 * The picked node's own owner stack, or the nearest ancestor's.
 *
 * Walking up matters for text-ish picks and for nodes a library rendered
 * outside React's knowledge; a location one element up is worth far more than
 * none. It stops at the first fiber it finds — that node is the one React
 * actually rendered.
 */
function ownerStackOf(el: Element): string | null {
  let node: Element | null = el;
  while (node) {
    const fiber = getFiberFromHostInstance(node) as DebugFiber | null;
    if (fiber) {
      const stack = fiber._debugStack?.stack;
      return typeof stack === "string" ? stack : null;
    }
    node = node.parentElement;
  }
  return null;
}

/** Parsed sourcemaps by module URL. Vite gives every edit a fresh `?t=`, so
 * this never serves a stale map across HMR. `null` caches "there isn't one". */
const sourceMaps = new Map<string, Promise<TraceMap | null>>();

async function mapThroughSourceMap(
  url: string,
  frame: { columnNumber?: number | null; lineNumber?: number | null }
): Promise<SourceLocation | null> {
  if (typeof frame.lineNumber !== "number") {
    return null;
  }
  const map = await sourceMapFor(url);
  if (!map) {
    return null;
  }
  // Stack frames are 1-based in both axes; sourcemaps are 1-based in lines and
  // 0-based in columns.
  const pos = originalPositionFor(map, {
    column: Math.max((frame.columnNumber ?? 1) - 1, 0),
    line: frame.lineNumber,
  });
  if (!pos.source || pos.line === null) {
    return null;
  }
  return {
    column: pos.column === null ? undefined : pos.column + 1,
    file: normalizeFileName(pos.source),
    line: pos.line,
  };
}

function sourceMapFor(url: string): Promise<TraceMap | null> {
  const hit = sourceMaps.get(url);
  if (hit) {
    return hit;
  }
  const pending = loadSourceMap(url).catch(() => null);
  sourceMaps.set(url, pending);
  return pending;
}

const SOURCE_MAPPING_URL = /\/\/# sourceMappingURL=(\S+)[\s]*$/;

async function loadSourceMap(url: string): Promise<TraceMap | null> {
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  const ref = SOURCE_MAPPING_URL.exec(await res.text())?.[1];
  if (!ref) {
    return null;
  }
  // Vite inlines the map as a base64 data URL — which is exactly the case
  // bippy's own `symbolicateStack` declines to fetch, and the reason we do this
  // rather than call it.
  const inline = ref.startsWith("data:");
  const mapUrl = inline ? url : new URL(ref, url).href;
  const json = inline ? decodeDataUrl(ref) : await (await fetch(mapUrl)).text();
  // The map URL is what `sources` are relative to, and they usually are: Vite
  // emits `["App.tsx"]` for `/src/App.tsx`. Passing it is what makes
  // `originalPositionFor` hand back a whole path instead of a bare filename.
  return json ? new TraceMap(JSON.parse(json), mapUrl) : null;
}

function decodeDataUrl(url: string): string | null {
  const comma = url.indexOf(",");
  if (comma === -1) {
    return null;
  }
  const body = url.slice(comma + 1);
  return url.slice(0, comma).includes(";base64")
    ? atob(body)
    : decodeURIComponent(body);
}

function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 4 && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const cls = Array.from(node.classList ?? []).slice(0, 2);
    if (cls.length) {
      part += `.${cls.join(".")}`;
    }
    parts.unshift(part);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}
