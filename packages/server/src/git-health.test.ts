/**
 * Which git problems reach the overlay as "these buttons will not work".
 *
 * The distinction that matters is between a git that cannot serve the verbs at
 * all and a repository that simply has no HEAD yet. The second one greys
 * nothing: committing is what gives a fresh repository its first commit, so a
 * Commit button disabled for want of a HEAD disables the cure.
 */
import type { GitStatus } from "@airship/git";
import { describe, expect, it } from "vitest";
import { healthOf } from "./index";

const HEALTHY: GitStatus = {
  hasCommits: true,
  identity: true,
  installed: true,
  version: "2.43.0",
  workTree: true,
};

describe("healthOf", () => {
  it("is happy with a working repository", () => {
    expect(healthOf(HEALTHY)).toEqual({ ok: true });
  });

  it("stays happy in a repository with no commits yet", () => {
    // The regression this exists for. `git commit` works here; it is the diff
    // baseline that does not, and that gates Revert through `noBaseline`.
    expect(
      healthOf({
        ...HEALTHY,
        error: "this repository has no commits yet",
        hasCommits: false,
      })
    ).toEqual({ ok: true });
  });

  it("carries the reason and the fix when git is missing", () => {
    expect(
      healthOf({
        error: "git is not installed or not on PATH",
        hasCommits: false,
        hint: "Install Git and make sure `git` is on PATH.",
        identity: false,
        installed: false,
        workTree: false,
      })
    ).toEqual({
      hint: "Install Git and make sure `git` is on PATH.",
      ok: false,
      reason: "git is not installed or not on PATH",
    });
  });

  it("carries the reason when the directory is not a work tree", () => {
    const health = healthOf({
      ...HEALTHY,
      error: "this is a bare git repository",
      hasCommits: false,
      workTree: false,
    });
    expect(health.ok).toBe(false);
    expect(health.reason).toBe("this is a bare git repository");
  });

  it("keeps the reason inside the tooltip's one-line budget", () => {
    // It is rendered as a `data-tip`, where the house rule is 44 characters
    // and `tooltip.copy.test.ts` in the overlay enforces it for literals.
    for (const status of [
      { ...HEALTHY, error: "not a git repository", workTree: false },
      { ...HEALTHY, error: "this is a bare git repository", workTree: false },
      {
        ...HEALTHY,
        error: "git is not installed or not on PATH",
        installed: false,
      },
    ]) {
      const { reason } = healthOf(status);
      expect((reason ?? "").length).toBeLessThanOrEqual(44);
      expect(reason ?? "").not.toContain("—");
    }
  });
});
