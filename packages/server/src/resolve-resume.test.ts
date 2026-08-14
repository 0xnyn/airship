/**
 * The resume walk-up. Adapters withhold `sessionId` from a bundle whose turn
 * a provider rejected outright, so a mid-thread failure must fall through to
 * the last good session instead of losing the conversation — bounded, cycle
 * -guarded, and never across an agent switch.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathKey } from "@airship/core";
import type { JobDiffBundle } from "@airship/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBundle } from "./history";
import { resolveResume } from "./index";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-resume-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
  // The history store hashes the project path under ~/.airship — clean up the
  // per-test directory it created there too.
  const hash = createHash("sha1")
    .update(pathKey(root))
    .digest("hex")
    .slice(0, 12);
  rmSync(join(homedir(), ".airship", "history", hash), {
    force: true,
    recursive: true,
  });
});

function bundle(
  over: Partial<JobDiffBundle> & { jobId: string }
): JobDiffBundle {
  return {
    additions: 0,
    agent: "opencode",
    createdAt: 1,
    deletions: 0,
    diffs: [],
    filesChanged: 0,
    prompt: "p",
    promptPreview: "p",
    status: "done",
    target: { displayName: null, source: null, tagName: "div" },
    ...over,
  };
}

describe("resolveResume", () => {
  it("returns the parent's session when it has one", () => {
    writeBundle(root, bundle({ jobId: "j1", sessionId: "ses_good" }));
    expect(resolveResume(root, "j1", "opencode")).toBe("ses_good");
  });

  it("walks past a session-less failure to the last good session", () => {
    writeBundle(root, bundle({ jobId: "j1", sessionId: "ses_good" }));
    writeBundle(
      root,
      bundle({ jobId: "j2", parentJobId: "j1", status: "failed" })
    );
    expect(resolveResume(root, "j2", "opencode")).toBe("ses_good");
  });

  it("never crosses an agent switch, on any hop", () => {
    writeBundle(
      root,
      bundle({ agent: "claude", jobId: "j1", sessionId: "ses_claude" })
    );
    writeBundle(
      root,
      bundle({ jobId: "j2", parentJobId: "j1", status: "failed" })
    );
    // The direct parent matches but is session-less; the grandparent has a
    // session but belongs to another backend, which has never seen the id.
    expect(resolveResume(root, "j2", "opencode")).toBeNull();
  });

  it("gives up beyond the walk limit instead of trawling old history", () => {
    writeBundle(root, bundle({ jobId: "j1", sessionId: "ses_far" }));
    writeBundle(root, bundle({ jobId: "j2", parentJobId: "j1" }));
    writeBundle(root, bundle({ jobId: "j3", parentJobId: "j2" }));
    writeBundle(root, bundle({ jobId: "j4", parentJobId: "j3" }));
    // j4 → j3 → j2 exhausts the three hops before reaching j1.
    expect(resolveResume(root, "j4", "opencode")).toBeNull();
    // One hop closer, the session is within reach.
    expect(resolveResume(root, "j3", "opencode")).toBe("ses_far");
  });

  it("survives a parent cycle", () => {
    writeBundle(root, bundle({ jobId: "a", parentJobId: "b" }));
    writeBundle(root, bundle({ jobId: "b", parentJobId: "a" }));
    expect(resolveResume(root, "a", "opencode")).toBeNull();
  });

  it("starts clean when the chain dead-ends", () => {
    expect(resolveResume(root, "missing", "opencode")).toBeNull();
    expect(resolveResume(root, undefined, "opencode")).toBeNull();
  });
});
