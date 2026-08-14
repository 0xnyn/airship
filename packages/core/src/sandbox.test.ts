/**
 * The command screen, which `--safe` promises in the launch banner.
 *
 * Two directions matter equally. It has to block what would actually destroy
 * the user's machine — and it has to leave ordinary commands alone, because a
 * false deny is not a safe failure: the model cannot see the reason, so it
 * burns turns working around a guard that should never have fired.
 *
 * The Windows half exists because the original list was entirely POSIX-shell
 * shaped, so on Windows — where Codex and OpenCode run commands through cmd.exe
 * or PowerShell — the screen was a no-op while the banner still said it was on.
 * (Path containment lives in ./paths.test.ts.)
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { screenBash, screenTool } from "./sandbox";

const blocked = (command: string) => screenBash(command).allowed === false;

describe("screenBash blocks destructive POSIX commands", () => {
  it.each([
    "rm -rf /",
    "rm -f important.txt",
    "git push origin main",
    "git reset --hard HEAD~5",
    "sudo rm something",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda1",
  ])("blocks %j", (command) => {
    expect(blocked(command)).toBe(true);
  });
});

describe("screenBash blocks destructive Windows commands", () => {
  it.each([
    "del /f /s /q C:\\Users\\me\\project",
    "del /q important.txt",
    "rd /s /q build",
    "rmdir /s /q node_modules",
    "Remove-Item -Recurse -Force .\\dist",
    "Remove-Item .\\dist -Recurse",
    "format c:",
    "diskpart",
    "Clear-Disk -Number 0",
    "runas /user:Administrator cmd.exe",
    "Start-Process powershell -Verb RunAs",
  ])("blocks %j", (command) => {
    expect(blocked(command)).toBe(true);
  });
});

describe("screenBash allows ordinary commands", () => {
  it.each([
    // The reason the Windows patterns name their flags rather than the verb:
    // all of these contain `del`, `rd` or `format` as a substring or a word.
    "sed -i 's/del /x/g' notes.txt",
    "grep -rn 'delete' src/",
    "npm run build && npm test",
    "git status",
    "git log --format=oneline",
    "prettier --write .",
    "node scripts/format.mjs",
    "cargo build --release",
    "echo 'runas is a windows command'",
    "ls -la",
    "pnpm dlx ultracite fix",
  ])("allows %j", (command) => {
    expect(blocked(command)).toBe(false);
  });
});

// `screenTool` is the single dispatch both the PreToolUse hook and Claude's
// `canUseTool` callback run — under `--safe` every permission decision
// funnels through it, so it must be total: a verdict on every input, never a
// throw. An unresolved `canUseTool` parks the tool call forever.
const ROOT = resolve("/project");
const INSIDE = resolve("/project/src/app.ts");
const OUTSIDE = resolve("/somewhere/else.ts");

describe("screenTool confines edit tools to the project", () => {
  it.each(["Write", "Edit", "NotebookEdit"])(
    "%s outside the root is denied, and the reason names the path",
    (tool) => {
      const verdict = screenTool(ROOT, tool, { file_path: OUTSIDE });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain(OUTSIDE);
    }
  );

  it.each(["Write", "Edit", "NotebookEdit"])(
    "%s inside the root is allowed",
    (tool) => {
      expect(screenTool(ROOT, tool, { file_path: INSIDE }).allowed).toBe(true);
    }
  );

  // NotebookEdit names its target `notebook_path`, not `file_path`. Keying on
  // `file_path` alone is exactly the hole that let notebook writes anywhere on
  // disk sail past the screen.
  it("NotebookEdit is screened through notebook_path", () => {
    const inside = screenTool(ROOT, "NotebookEdit", {
      notebook_path: resolve("/project/analysis.ipynb"),
    });
    expect(inside.allowed).toBe(true);
    const outside = screenTool(ROOT, "NotebookEdit", {
      notebook_path: resolve("/somewhere/else.ipynb"),
    });
    expect(outside.allowed).toBe(false);
  });
});

describe("screenTool screens Bash commands", () => {
  it("denies a destructive command", () => {
    expect(screenTool(ROOT, "Bash", { command: "rm -rf /" }).allowed).toBe(
      false
    );
  });

  it("allows an ordinary command", () => {
    expect(screenTool(ROOT, "Bash", { command: "git status" }).allowed).toBe(
      true
    );
  });
});

describe("screenTool fails open for everything it does not screen", () => {
  // Unknown and MCP names must pass: under `--safe` there is no other route
  // to an allow, so a fail-closed default would cut off the tools the flow
  // depends on rather than guard anything.
  it.each([
    "Read",
    "Grep",
    "Glob",
    "TodoWrite",
    "WebFetch",
    "mcp__airship__get_element_context",
    "mcp__airship__get_design_tokens",
    "SomeFutureTool",
  ])("allows %s", (tool) => {
    expect(screenTool(ROOT, tool, {}).allowed).toBe(true);
  });
});

describe("screenTool is total on malformed input", () => {
  it.each([
    ["missing path", "Edit", {}],
    ["non-string file_path", "Write", { file_path: 42 }],
    ["non-string notebook_path", "NotebookEdit", { notebook_path: null }],
    ["missing command", "Bash", {}],
    ["non-string command", "Bash", { command: ["rm", "-rf"] }],
  ] as const)("returns a verdict for %s", (_label, tool, input) => {
    const verdict = screenTool(ROOT, tool, input as Record<string, unknown>);
    expect(typeof verdict.allowed).toBe("boolean");
    // Malformed edits are the SDK's problem to reject, not a deny; a
    // command that is not a string screens as the empty command.
    expect(verdict.allowed).toBe(true);
  });
});
