/**
 * Open a project file in the user's editor.
 *
 * Two paths, because neither works alone. The CLI launchers (`code -g`) are the
 * reliable ones *when they exist* — but `code` is only on `PATH` if the user
 * ever ran VS Code's "Install 'code' command in PATH", which a fresh machine
 * has not. The URL schemes always work if the app is installed but cannot carry
 * a column and are awkward to detect. So: try the binary, fall back to the
 * scheme.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { resolve, sep } from "node:path";
import type { Editor } from "@airship/protocol";

export interface OpenRequest {
  column?: number;
  editor?: Editor;
  /** Repo-relative. Resolved against `cwd` and required to stay inside it. */
  file: string;
  line?: number;
}

export interface OpenResult {
  editor?: string;
  error?: string;
  ok: boolean;
}

interface Launcher {
  /** Argv for the CLI form, given an absolute `file:line:col` target. */
  args: (target: string) => string[];
  bin: string;
  /** URL scheme host, e.g. `vscode` in `vscode://file/...`. */
  scheme: string;
}

const LAUNCHERS: Record<Editor, Launcher> = {
  cursor: { args: (t) => ["-g", t], bin: "cursor", scheme: "cursor" },
  vscode: { args: (t) => ["-g", t], bin: "code", scheme: "vscode" },
  windsurf: { args: (t) => ["-g", t], bin: "windsurf", scheme: "windsurf" },
  // Zed takes the position inline with no flag.
  zed: { args: (t) => [t], bin: "zed", scheme: "zed" },
};

/** Probe order when nothing is configured. */
const PREFERENCE: Editor[] = ["vscode", "cursor", "windsurf", "zed"];

/** Vite serves out-of-root files under `/@fs/<abs path>`. */
const VITE_FS_PREFIX = /^\/@fs(\/.*)$/;
const LEADING_SLASHES = /^\/+/;

export function openInEditor(cwd: string, req: OpenRequest): OpenResult {
  const root = resolve(cwd);
  const abs = resolve(root, projectPath(req.file));
  // This socket is unauthenticated and local, and this handler spawns
  // processes — without the containment check any page the browser loads could
  // ask the daemon to open arbitrary files on disk.
  if (abs !== root && !abs.startsWith(root + sep)) {
    return { error: "path is outside the project", ok: false };
  }
  if (!existsSync(abs)) {
    return { error: `no such file: ${req.file}`, ok: false };
  }

  const line = req.line ?? 1;
  const column = req.column ?? 1;
  const target = `${abs}:${line}:${column}`;

  for (const editor of candidates(req.editor)) {
    const launcher = LAUNCHERS[editor];
    if (!onPath(launcher.bin)) {
      continue;
    }
    try {
      // Detached and unref'd: the editor outlives the daemon, and inheriting
      // stdio would wire its output into ours. Never `shell: true` — argv
      // arrays mean a path with a space or a quote is just a path.
      spawn(launcher.bin, launcher.args(target), {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { editor, ok: true };
    } catch {
      // Fall through to the next candidate, then to the URL scheme.
    }
  }

  const wanted = req.editor ?? PREFERENCE[0];
  if (openUrl(`${LAUNCHERS[wanted].scheme}://file/${abs}:${line}:${column}`)) {
    return { editor: wanted, ok: true };
  }
  return {
    error: `could not launch ${wanted} — is it installed?`,
    ok: false,
  };
}

/**
 * Normalize a path that may have come from the *browser* rather than from a
 * diff. Source locations are resolved from framework metadata, and what React
 * and Vite hand back is a dev-server URL path — `/src/App.tsx`, or `/@fs/` +
 * an absolute path for files outside the Vite root. Both are absolute as far
 * as `resolve` is concerned, so without this the first one silently escapes
 * `cwd` and gets rejected as "outside the project".
 *
 * Paths that are genuinely absolute and genuinely inside the project still
 * work: they survive this untouched and the containment check below passes.
 */
function projectPath(file: string): string {
  const fs = file.match(VITE_FS_PREFIX);
  if (fs?.[1]) {
    return fs[1];
  }
  // A real absolute path exists on disk; a URL path like `/src/App.tsx` does
  // not, and is meant to be read relative to the project root.
  if (file.startsWith("/") && !existsSync(file)) {
    return file.replace(LEADING_SLASHES, "");
  }
  return file;
}

function candidates(explicit?: Editor): Editor[] {
  if (explicit) {
    return [explicit];
  }
  const configured = process.env.AIRSHIP_EDITOR as Editor | undefined;
  if (configured && configured in LAUNCHERS) {
    return [configured, ...PREFERENCE.filter((e) => e !== configured)];
  }
  return PREFERENCE;
}

/** Cached: a `which` per menu click is pointless, and PATH does not move. */
const pathCache = new Map<string, boolean>();

function onPath(bin: string): boolean {
  const hit = pathCache.get(bin);
  if (hit !== undefined) {
    return hit;
  }
  const probe = platform() === "win32" ? "where" : "which";
  let found = false;
  try {
    found = spawnSync(probe, [bin], { stdio: "ignore" }).status === 0;
  } catch {
    found = false;
  }
  pathCache.set(bin, found);
  return found;
}

function openUrl(url: string): boolean {
  const os = platform();
  let bin = "xdg-open";
  let args = [url];
  if (os === "darwin") {
    bin = "open";
  } else if (os === "win32") {
    bin = "cmd";
    args = ["/c", "start", "", url];
  }
  try {
    spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
