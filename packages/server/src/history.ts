/**
 * Airship's own per-project history store (distinct from the Agent SDK transcript
 * store): persists each edit's prompt, diffs, summary, and the Claude session id
 * so the overlay can render history and resume/fork sessions across restarts.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JobDiffBundle, JobHistorySummary } from "@airship/protocol";

function repoDir(cwd: string): string {
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  return join(homedir(), ".airship", "history", hash);
}

export function writeBundle(cwd: string, bundle: JobDiffBundle): void {
  const dir = repoDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${bundle.jobId}.json`),
    JSON.stringify(bundle),
    "utf8"
  );
}

export function readBundle(cwd: string, jobId: string): JobDiffBundle | null {
  const file = join(repoDir(cwd), `${jobId}.json`);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JobDiffBundle;
  } catch {
    return null;
  }
}

function readAll(cwd: string): JobDiffBundle[] {
  const dir = repoDir(cwd);
  if (!existsSync(dir)) {
    return [];
  }
  const bundles: JobDiffBundle[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      bundles.push(
        JSON.parse(readFileSync(join(dir, name), "utf8")) as JobDiffBundle
      );
    } catch {
      // skip corrupt entry
    }
  }
  return bundles;
}

/**
 * Strip every heavy field so a history *listing* stays small. `readAll()` parses
 * every bundle in the repo directory on each request, so anything left in here
 * is paid for once per job, per listing — `timeline` especially, which is the
 * largest field on a bundle.
 */
function toSummary(b: JobDiffBundle): JobHistorySummary {
  const { prompt, summary, followUps, diffs, timeline, usage, ...rest } = b;
  return rest;
}

export function listHistory(cwd: string): JobHistorySummary[] {
  return readAll(cwd)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toSummary);
}

/** A job and the chain of refinements that descend from it, oldest first. */
export function thread(cwd: string, rootJobId: string): JobDiffBundle[] {
  const all = readAll(cwd);
  const byParent = new Map<string, JobDiffBundle[]>();
  for (const b of all) {
    if (b.parentJobId) {
      const list = byParent.get(b.parentJobId) ?? [];
      list.push(b);
      byParent.set(b.parentJobId, list);
    }
  }
  const root = all.find((b) => b.jobId === rootJobId);
  if (!root) {
    return [];
  }
  const chain: JobDiffBundle[] = [root];
  let frontier = [root.jobId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of byParent.get(id) ?? []) {
        chain.push(child);
        next.push(child.jobId);
      }
    }
    frontier = next;
  }
  return chain.sort((a, b) => a.createdAt - b.createdAt);
}
