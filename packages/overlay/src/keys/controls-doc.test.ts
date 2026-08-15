import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The generator's own renderers, imported rather than reimplemented. One
// renderer means the gate and the writer cannot disagree — and it means this
// test still fails on drift on a Node that cannot strip types to *run* the
// script, because vitest resolves the `.mjs` itself.
import {
  renderControls,
  renderEssentials,
} from "../../../../scripts/gen-controls.mjs";
import {
  ALL_COMMANDS,
  ALL_GESTURES,
  COMMAND_GROUPS,
  displayChord,
  NOTES,
} from "./catalog";

/*
 * CONTROLS.md and the README block are generated, and committed.
 *
 * Committed because that is this repo's pattern for generated files — the CLI
 * README, the token modules, the route tree — and because a reference nobody
 * can read without a build step is not a reference. Which means it can drift,
 * which is what this catches.
 *
 * It is a byte comparison on purpose. A looser check ("does it mention every
 * command?") would pass a file whose *chords* were stale, and stale chords are
 * the exact failure this whole change exists to end.
 */

function repoRoot(): string {
  for (const base of [join("..", ".."), "."]) {
    if (existsSync(join(base, "CONTROLS.md"))) {
      return base;
    }
  }
  throw new Error("Cannot find CONTROLS.md from this cwd.");
}

const ROOT = repoRoot();

const shared = {
  commands: ALL_COMMANDS,
  displayChord,
  gestures: ALL_GESTURES,
  groups: COMMAND_GROUPS,
  notes: NOTES,
};

/** The repo is checked out with native line endings on Windows. */
const normalise = (text: string): string => text.replace(/\r\n/g, "\n");

describe("the generated controls reference", () => {
  it("matches the catalog", () => {
    const committed = normalise(
      readFileSync(join(ROOT, "CONTROLS.md"), "utf8")
    );

    expect(committed).toBe(normalise(renderControls(shared)));
  });

  it("matches the short table in README.md", () => {
    const readme = normalise(readFileSync(join(ROOT, "README.md"), "utf8"));
    const from = readme.indexOf("<!-- controls:start -->");
    const to = readme.indexOf("<!-- controls:end -->");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    const block = readme
      .slice(from + "<!-- controls:start -->".length, to)
      .trim();

    expect(block).toBe(normalise(renderEssentials(shared)).trim());
  });

  it("says it is generated, so nobody edits it by hand", () => {
    const committed = readFileSync(join(ROOT, "CONTROLS.md"), "utf8");

    expect(committed).toContain("Do not edit");
    expect(committed).toContain("scripts/gen-controls.mjs");
  });
});
