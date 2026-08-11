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
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";
import { isPathInside, toPosixPath } from "@airship/core";
import type { Editor } from "@airship/protocol";

const WIN32 = platform() === "win32";

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
const VITE_FS_PREFIX = /^\/@fs\/(.*)$/;
const LEADING_SLASHES = /^\/+/;
/** `C:` — a Windows path that is already rooted at a drive. */
const WIN32_DRIVE = /^[a-zA-Z]:/;

export function openInEditor(cwd: string, req: OpenRequest): OpenResult {
  const root = resolve(cwd);
  const abs = resolve(root, projectPath(req.file));
  // This socket is unauthenticated and local, and this handler spawns
  // processes — without the containment check any page the browser loads could
  // ask the daemon to open arbitrary files on disk.
  //
  // isPathInside rather than a bare startsWith: the two sides reach here by
  // different routes and can disagree on symlinks (macOS `/tmp`, `/var`) or on
  // case (Windows, including the drive letter), and a false "outside the
  // project" on the user's own file is indistinguishable from a real refusal.
  if (!isPathInside(root, abs)) {
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
    if (launch(launcher.bin, launcher.args(target))) {
      return { editor, ok: true };
    }
  }

  const wanted = req.editor ?? PREFERENCE[0];
  if (openUrl(editorUrl(LAUNCHERS[wanted].scheme, abs, line, column))) {
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
    // The remainder is already absolute. On POSIX it needs the slash the
    // capture dropped; on Windows it opens with a drive letter and must NOT
    // get one, because `resolve` reads a leading slash as rooted-but-
    // deviceless and inherits the device from cwd — turning
    // `/@fs/C:/Users/me/x.tsx` into `C:\C:\Users\me\x.tsx`.
    return WIN32_DRIVE.test(fs[1]) ? fs[1] : `/${fs[1]}`;
  }
  // A real absolute path exists on disk; a URL path like `/src/App.tsx` does
  // not, and is meant to be read relative to the project root. On Windows the
  // probe is skipped: a leading slash with no drive letter is never an absolute
  // path there, so `existsSync` would only ever be answering about a different
  // file — `<cwd's drive>:\src\App.tsx`, which routinely exists.
  if (file.startsWith("/") && (WIN32 || !existsSync(file))) {
    return file.replace(LEADING_SLASHES, "");
  }
  return file;
}

/**
 * Start a detached child, or report that it could not start.
 *
 * `shell` on Windows because every one of these editors ships as a `.cmd` shim
 * (`code.cmd`, `cursor.cmd`, …) and libuv's PATH search only ever tries `.com`
 * and `.exe`. `where code` finds the shim, so `onPath` says yes, and the bare
 * spawn then fails with ENOENT — which is how this managed to be 100% broken on
 * Windows while looking fine. Node applies cmd-specific argument escaping when
 * `shell` is set, so a path with a space in it survives.
 *
 * The `error` listener is not optional. spawn reports a failure to start
 * asynchronously, so the `try` here never sees it; an EventEmitter that emits
 * `error` with nobody listening throws, and this runs in the daemon, so one
 * click on a file it cannot open took the whole server down.
 *
 * `pid` is undefined when the spawn failed outright, which is the only
 * synchronous signal available — and it is what lets the caller fall through to
 * the URL scheme instead of reporting a success that never happened.
 */
function launch(bin: string, args: string[]): boolean {
  try {
    const child = spawn(bin, args, {
      detached: true,
      shell: WIN32,
      stdio: "ignore",
      windowsHide: true,
    });
    detach(child);
    return child.pid !== undefined;
  } catch {
    return false;
  }
}

/** Let the child outlive us, and never let its `error` reach the top level. */
function detach(child: ChildProcess): void {
  child.on("error", () => {
    // No editor, no PATH entry, no display. The caller reports it; the daemon
    // must not die of it.
  });
  child.unref();
}

/**
 * `vscode://file/...` for the fallback path.
 *
 * Backslashes are not legal in a URI path, so a Windows path has to be
 * rewritten or the scheme handler simply ignores it. POSIX paths already open
 * with `/`, which is why there is only one after `file` in the template.
 */
function editorUrl(
  scheme: string,
  abs: string,
  line: number,
  column: number
): string {
  return `${scheme}://file/${toPosixPath(abs)}:${line}:${column}`;
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
  const probe = WIN32 ? "where" : "which";
  let found = false;
  try {
    found =
      spawnSync(probe, [bin], { stdio: "ignore", windowsHide: true }).status ===
      0;
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
    // `cmd /c start "" <url>` rather than `shell: true`: `start` takes a window
    // title as its first quoted argument, so the empty string is what stops it
    // swallowing the URL as one. cmd.exe is a real .exe, so no shell needed.
    bin = "cmd";
    args = ["/c", "start", "", url];
  }
  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    detach(child);
    return child.pid !== undefined;
  } catch {
    return false;
  }
}
