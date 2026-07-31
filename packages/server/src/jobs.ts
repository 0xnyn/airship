import { randomUUID } from "node:crypto";
import type { JobSnapshot, JobStatus } from "@airship/protocol";

export interface JobRecord {
  abort?: AbortController;
  checkpointId?: string;
  createdAt: number;
  error?: string;
  jobId: string;
  prompt: string;
  sessionId?: string;
  status: JobStatus;
  step?: string;
}

/** In-memory registry of in-flight and recent jobs. */
export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(prompt: string): JobRecord {
    const rec: JobRecord = {
      createdAt: Date.now(),
      jobId: randomUUID(),
      prompt,
      status: "running",
    };
    this.jobs.set(rec.jobId, rec);
    return rec;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  finish(jobId: string, status: JobStatus, error?: string): void {
    const rec = this.jobs.get(jobId);
    if (rec) {
      rec.status = status;
      rec.error = error;
      rec.abort = undefined;
    }
  }

  snapshots(): JobSnapshot[] {
    return [...this.jobs.values()].map((r) => ({
      createdAt: r.createdAt,
      error: r.error,
      jobId: r.jobId,
      prompt: r.prompt,
      status: r.status,
      step: r.step,
    }));
  }
}
