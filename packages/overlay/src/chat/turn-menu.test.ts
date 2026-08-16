/**
 * The turn kebab's git verbs, and when they are offered.
 *
 * Greyed with the reason rather than hidden. A Commit that is simply missing
 * reads as a bug in the editor; a Commit that is offered and then fails has
 * already cost the user the click and told them nothing they can act on.
 *
 * Two gates, because the two failures are unrelated. Revert rewrites files from
 * the before-state the turn captured and needs no git at all, so it is greyed
 * only when *this* turn has files whose baseline was never captured. Commit and
 * Create pull request need git for every turn equally.
 */

import type { JobDiffBundle } from "@airship/protocol";
import { describe, expect, it, vi } from "vitest";
import { el } from "../dom";
import { isMenuItem, type MenuItem } from "../popover-host";
import { type AssistantActions, turnMenu } from "./transcript";

function bundleWith(noBaseline: boolean): JobDiffBundle {
  return {
    agent: "codex",
    createdAt: 0,
    diffs: [
      {
        additions: 1,
        deletions: 0,
        file: "src/app.ts",
        isDeleted: false,
        isNew: false,
        ...(noBaseline ? { noBaseline: true } : {}),
        patch: "",
      },
    ],
    filesChanged: 1,
    jobId: "job-1",
    prompt: "make it blue",
    promptPreview: "make it blue",
    status: "done",
    target: {},
  } as JobDiffBundle;
}

const ALL_ACTIONS: AssistantActions = {
  onBranch: vi.fn(),
  onCommit: vi.fn(),
  onCreatePr: vi.fn(),
  onUndo: vi.fn(),
};

function rowsFor(
  actions: Partial<AssistantActions>,
  noBaseline = false
): MenuItem[] {
  return turnMenu(
    bundleWith(noBaseline),
    { ...ALL_ACTIONS, ...actions },
    el("button")
  ).filter(isMenuItem);
}

const row = (rows: MenuItem[], label: string): MenuItem =>
  rows.find((r) => r.label === label) as MenuItem;

const GIT_ROWS = ["Commit to git", "Commit & push", "Create pull request…"];

describe("turnMenu git verbs", () => {
  it("offers every git row when git is healthy", () => {
    const rows = rowsFor({ git: { ok: true } });
    for (const label of GIT_ROWS) {
      expect(row(rows, label).disabled).toBeFalsy();
      expect(row(rows, label).tip).toBeUndefined();
    }
  });

  it("greys every git row with the reason when git is broken", () => {
    const rows = rowsFor({
      git: {
        hint: "Run `git init` there.",
        ok: false,
        reason: "not a git repository",
      },
    });
    for (const label of GIT_ROWS) {
      expect(row(rows, label).disabled).toBe(true);
      expect(row(rows, label).tip).toBe("not a git repository");
    }
  });

  it("keeps the hint out of the tooltip", () => {
    // `GitStatus.hint` is a command to run, sized for a terminal. The tooltip
    // clamps at three lines, so the banner and `airship doctor` carry the fix.
    const rows = rowsFor({
      git: {
        hint: "Run `git init` there.",
        ok: false,
        reason: "not a git repository",
      },
    });
    expect(row(rows, "Commit to git").tip).not.toContain("git init");
  });

  it("treats an absent health report as healthy", () => {
    // An older daemon never sends `git:health`. Hiding a working Commit is
    // worse than offering one that might fail.
    expect(row(rowsFor({}), "Commit to git").disabled).toBeFalsy();
  });

  it("leaves Revert alone when only git is broken", () => {
    // Revert is pure filesystem. On the Claude path it works with no git at all.
    const rows = rowsFor({
      git: { ok: false, reason: "not a git repository" },
    });
    expect(row(rows, "Revert this change").disabled).toBeFalsy();
  });

  it("greys Revert when the turn captured no baseline", () => {
    const rows = rowsFor({ git: { ok: true } }, true);
    const revert = row(rows, "Revert this change");
    expect(revert.disabled).toBe(true);
    expect(revert.tip).toBe("No previous content to restore from");
    // The git rows are unaffected: git works, so committing still does.
    expect(row(rows, "Commit to git").disabled).toBeFalsy();
  });
});
