/**
 * The `--safe` guards, and the Claude hook that installs them.
 *
 * The two screens — `screenEdit` and `screenBash` — are the policy, expressed
 * without reference to any backend. `makeSandboxHook` wraps them as a Claude
 * `PreToolUse` hook, where a deny hard-blocks the tool because hooks run
 * ahead of permission rules and `canUseTool`; that is the safety layer which
 * replaces the reference tools' blanket `--dangerously-skip-permissions`.
 *
 * OpenCode has no hook of any kind, but it does emit a permission request and
 * accept a reply, so its adapter answers each request from these same two
 * functions. Keeping the policy separate from the hook is what lets one set of
 * rules — and one set of tests — cover both.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

export const EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

const DESTRUCTIVE = [
  /\brm\s+-[rf]/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/(sd|disk)/,
  /\bsudo\b/,
  /:\(\)\s*\{/,
];

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Resolve symlinks so two spellings of the same path compare equal.
 *
 * Falls back to the containing directory for a file that does not exist yet,
 * which is the create case, and to the raw path when even that is missing.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    try {
      return resolve(realpathSync(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/**
 * True if `target` resolves to a path at or under `root`.
 *
 * Both sides are canonicalized first. Comparing raw strings denies perfectly
 * legitimate in-project edits whenever the project sits under a symlink — on
 * macOS `/tmp` and `/var` both are, so `cwd` arrives as `/var/folders/…` while
 * the agent reports the file as `/private/var/folders/…`. The failure is
 * expensive rather than loud: the edit is refused, the model burns turns
 * probing with `pwd -P` and `realpath` to work out why, and eventually routes
 * around a guard that should never have fired.
 */
export function isPathInside(root: string, target: string): boolean {
  const absRoot = canonical(resolve(root));
  const abs = canonical(resolve(resolve(root), target));
  return abs === absRoot || abs.startsWith(absRoot + sep);
}

/** The verdict shape both screens return. `reason` is user-facing. */
export interface ScreenResult {
  allowed: boolean;
  reason?: string;
}

const ALLOWED: ScreenResult = { allowed: true };

/** Confine a write to the project directory. */
export function screenEdit(root: string, filePath: string): ScreenResult {
  if (isPathInside(root, filePath)) {
    return ALLOWED;
  }
  return {
    allowed: false,
    reason: `Refusing to modify a path outside the project: ${filePath}`,
  };
}

/** Refuse a shell command that matches a destructive pattern. */
export function screenBash(command: string): ScreenResult {
  if (DESTRUCTIVE.some((re) => re.test(command))) {
    return {
      allowed: false,
      reason: `Blocked a potentially destructive command: ${command}`,
    };
  }
  return ALLOWED;
}

export function makeSandboxHook(cwd: string): HookCallback {
  const root = resolve(cwd);
  return (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return Promise.resolve({});
    }
    const name = input.tool_name;
    const ti = (input.tool_input ?? {}) as Record<string, unknown>;

    if (EDIT_TOOLS.has(name) && typeof ti.file_path === "string") {
      const verdict = screenEdit(root, ti.file_path);
      if (!verdict.allowed) {
        return Promise.resolve(deny(verdict.reason ?? "denied"));
      }
    }

    if (name === "Bash") {
      const verdict = screenBash(
        typeof ti.command === "string" ? ti.command : ""
      );
      if (!verdict.allowed) {
        return Promise.resolve(deny(verdict.reason ?? "denied"));
      }
    }

    return Promise.resolve({});
  };
}
