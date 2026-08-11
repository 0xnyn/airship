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
import { resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { isPathInside } from "./paths";

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
  // The Windows half. Every pattern above except the two `git` ones is
  // POSIX-shell shaped, and on Windows the backends run commands through
  // cmd.exe or PowerShell — so without these the command screen was a no-op
  // there while the launch banner still told the user it was on.
  //
  // Each names the flags the real command takes rather than matching the verb
  // loosely. These run against every command on every platform, and `del` and
  // `runas` are short enough to appear inside ordinary POSIX ones — a bare
  // /\bdel\s+\// fires on `sed -i 's/del /x/'`. A false deny is not free: the
  // model cannot see why it was refused, so it burns turns working around a
  // guard that should not have fired.
  /\bdel\s+\/[fsqap]\b/i,
  /\brd\s+\/s\b/i,
  /\brmdir\s+\/s\b/i,
  /\bRemove-Item\b[^\n]*\s-(?:Recurse|Force)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bClear-Disk\b/i,
  /\brunas\s+\/user:/i,
  /\bStart-Process\b[^\n]*\s-Verb\s+RunAs\b/i,
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
