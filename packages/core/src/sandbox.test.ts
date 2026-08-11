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
import { describe, expect, it } from "vitest";
import { screenBash } from "./sandbox";

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
