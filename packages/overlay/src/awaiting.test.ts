/**
 * What a reconnect makes of a turn we think is still running.
 *
 * `awaiting` is cleared in exactly one place — a `job:done` whose id matches the
 * one we latched — so anything that eats that single broadcast strands the
 * editor with Send and Apply disabled and no way back. Two ordinary things do:
 *
 * - **The socket was down when Send was pressed.** `AirshipSocket.send` drops
 *   silently on a closed socket, so `beginJob` latched `awaiting` for a job the
 *   daemon was never asked to create. `submit` now refuses up front, but a
 *   session that latched before the refusal existed still has to be able to get
 *   out.
 * - **The socket was down when the job landed.** The daemon broadcasts
 *   `job:done` once; the 1.5s reconnect comes back with no memory of it.
 *
 * `hello` carries `jobs.snapshots()` on every connection and `JobStore` never
 * evicts, so the reconnect is holding the answer. The risk runs both ways,
 * which is why this is tested rather than eyeballed: answering "running" for a
 * job that ended re-latches the editor, and answering "release" for one that is
 * genuinely still going tears down a live turn's transcript while the agent is
 * still writing into it.
 */

import { describe, expect, it } from "vitest";
import { reconcileJob } from "./app";

const job = (
  jobId: string,
  status: "running" | "done" | "failed" | "cancelled"
) => ({ createdAt: 0, jobId, status });

describe("reconcileJob", () => {
  it("keeps waiting when our job is still running", () => {
    const verdict = reconcileJob("a", [job("a", "running")]);
    expect(verdict).toEqual({ jobId: "a", kind: "running" });
  });

  it("releases when our job finished while we were away", () => {
    for (const status of ["done", "failed", "cancelled"] as const) {
      const verdict = reconcileJob("a", [job("a", status)]);
      expect(verdict.kind).toBe("release");
      expect(verdict.kind === "release" && verdict.job?.status).toBe(status);
    }
  });

  it("releases when the daemon has never heard of our job", () => {
    // The Send-into-a-closed-socket case: `beginJob` latched, the edit was
    // dropped, and nothing was ever created.
    const verdict = reconcileJob("a", []);
    expect(verdict).toEqual({ job: undefined, kind: "release" });
  });

  it("adopts the running job when we never learned an id", () => {
    // `job:created` was the message we missed. Edits run on one chain, so the
    // single running job is necessarily ours.
    const verdict = reconcileJob(null, [
      job("old", "done"),
      job("live", "running"),
    ]);
    expect(verdict).toEqual({ jobId: "live", kind: "running" });
  });

  it("releases when there is no id and nothing is running", () => {
    const verdict = reconcileJob(null, [job("old", "done")]);
    expect(verdict.kind).toBe("release");
  });

  it("does not adopt someone else's finished job as ours", () => {
    // Matching by id first is what keeps a stale snapshot from being read as
    // our turn's outcome.
    const verdict = reconcileJob("mine", [job("theirs", "done")]);
    expect(verdict).toEqual({ job: undefined, kind: "release" });
  });

  it("ignores a finished job that shares the store with ours", () => {
    const verdict = reconcileJob("mine", [
      job("older", "done"),
      job("mine", "running"),
      job("oldest", "failed"),
    ]);
    expect(verdict).toEqual({ jobId: "mine", kind: "running" });
  });
});
