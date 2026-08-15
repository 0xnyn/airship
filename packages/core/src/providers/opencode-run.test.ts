/**
 * The retry-without-`format` dance, driven through `runWithClient` against a
 * scripted `OpencodeClientLike` — the interface is structural and declared to
 * be stubbable, which is much cheaper than a fake HTTP+SSE server and tests
 * the same seam.
 *
 * Each test uses its own `--model` on purpose: the no-format memo is
 * module-level (the real server is a process-wide singleton), so a shared
 * model would leak one test's memo into the next.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimelineItem } from "@airship/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunContext } from "../agent";
import { DiffCapture } from "../diff-capture";
import { TimelineRecorder } from "../timeline";
import { runWithClient } from "./opencode";
import type { OpencodeClientLike } from "./opencode-server";
import type {
  OcEvent,
  OcMessageError,
  OcMessageInfo,
  OcPart,
} from "./opencode-wire";

const SESSION = "ses_test";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-oc-run-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const REJECTION: OcMessageError = {
  data: {
    isRetryable: false,
    message:
      "Error from provider (DeepSeek): Thinking mode does not support this tool_choice",
    statusCode: 400,
  },
  name: "APIError",
};

function assistant(id: string, error?: OcMessageError): OcMessageInfo {
  return {
    error,
    id,
    modelID: "test-model",
    providerID: "prov",
    role: "assistant",
    sessionID: SESSION,
  };
}

function messageUpdated(info: OcMessageInfo): OcEvent {
  return { properties: { info }, type: "message.updated" };
}

/** A read tool running then completing — enough to mark the turn as working. */
function readToolEvents(): OcEvent[] {
  const part = (status: "running" | "completed"): OcPart => ({
    callID: "call_1",
    id: "prt_tool1",
    messageID: "msg_a",
    sessionID: SESSION,
    state: { input: { filePath: "src/app.tsx" }, status, title: "read" },
    tool: "read",
    type: "tool",
  });
  return [
    { properties: { part: part("running") }, type: "message.part.updated" },
    { properties: { part: part("completed") }, type: "message.part.updated" },
  ];
}

interface AttemptScript {
  info?: OcMessageInfo;
  sse?: OcEvent[];
}

/** One scripted response per attempt; records every prompt body it was sent. */
function scriptedClient(attempts: AttemptScript[]): {
  bodies: Record<string, unknown>[];
  client: OpencodeClientLike;
} {
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  const script = () => attempts[Math.min(call, attempts.length - 1)];
  const client: OpencodeClientLike = {
    // Never called on a run — the model catalogue is a separate request. Present
    // because the interface describes the real client, not one turn's slice.
    config: { providers: () => Promise.resolve({ data: { providers: [] } }) },
    event: {
      subscribe: () => {
        const { sse } = script();
        async function* stream(): AsyncGenerator<unknown> {
          // The adapter's drain loop is async; one real microtask keeps this
          // honest as an AsyncIterable rather than a relabelled sync one.
          await Promise.resolve();
          yield { properties: {}, type: "server.connected" };
          for (const event of sse ?? []) {
            yield event;
          }
          yield { properties: { sessionID: SESSION }, type: "session.idle" };
        }
        return Promise.resolve({ stream: stream() });
      },
    },
    permission: { respond: () => Promise.resolve({}) },
    session: {
      abort: () => Promise.resolve({}),
      create: () => Promise.resolve({ data: { id: SESSION } }),
      fork: () => Promise.resolve({ data: { id: SESSION } }),
      prompt: (params) => {
        const { info } = script();
        call += 1;
        bodies.push(params);
        return Promise.resolve({ data: { info, parts: [] } });
      },
      revert: () => Promise.resolve({}),
    },
  };
  return { bodies, client };
}

function runCtx(model: string): {
  ctx: AgentRunContext;
  items: TimelineItem[];
} {
  const items: TimelineItem[] = [];
  const recorder = new TimelineRecorder({
    onItem: (item) => items.push(item),
    onPatch: (id, patch) => {
      const existing = items.find((i) => i.id === id);
      if (existing) {
        Object.assign(existing, patch);
      }
    },
  });
  const ctx = {
    diffs: new DiffCapture(root),
    emitStep: () => undefined,
    events: {},
    input: { cwd: root, model, prompt: "make it blue", safe: false },
    promptText: "instruction",
    recorder,
  } as unknown as AgentRunContext;
  return { ctx, items };
}

const warnings = (items: TimelineItem[]) =>
  items.filter((i) => i.kind === "tool" && i.name === "Warning");

describe("format rejection retry", () => {
  it("retries once without format, memoizes, and succeeds quietly", async () => {
    const model = "prov/retry-model";
    const first = scriptedClient([
      {
        info: assistant("msg_a", REJECTION),
        sse: [messageUpdated(assistant("msg_a", REJECTION))],
      },
      { info: assistant("msg_b"), sse: [messageUpdated(assistant("msg_b"))] },
    ]);
    const run1 = runCtx(model);
    const outcome = await runWithClient(first.client, run1.ctx);

    // Two attempts: the first with `format`, the retry with a true omission.
    expect(first.bodies).toHaveLength(2);
    expect("format" in first.bodies[0]).toBe(true);
    expect("format" in first.bodies[1]).toBe(false);
    // The system prompt (with the structured-output contract) rides both.
    expect(first.bodies[1].system).toContain("<structuredoutput>");
    // The retry succeeded, so the turn did: no error, session kept.
    expect(outcome.error).toBeUndefined();
    expect(outcome.sessionId).toBe(SESSION);
    // One explanatory row — attempt 1's provider string must not survive.
    expect(warnings(run1.items)).toHaveLength(1);
    expect(JSON.stringify(warnings(run1.items)[0])).toContain(
      "structured output is disabled"
    );

    // A later run for the same model skips the doomed first attempt entirely
    // and does not repeat the warning.
    const second = scriptedClient([
      { info: assistant("msg_c"), sse: [messageUpdated(assistant("msg_c"))] },
    ]);
    const run2 = runCtx(model);
    const memoized = await runWithClient(second.client, run2.ctx);
    expect(second.bodies).toHaveLength(1);
    expect("format" in second.bodies[0]).toBe(false);
    expect(memoized.error).toBeUndefined();
    expect(warnings(run2.items)).toHaveLength(0);
  });

  it("does not retry a turn that already did work, and keeps its session", async () => {
    const model = "prov/worked-model";
    const { bodies, client } = scriptedClient([
      {
        info: assistant("msg_a", REJECTION),
        sse: [
          ...readToolEvents(),
          messageUpdated(assistant("msg_a", REJECTION)),
        ],
      },
    ]);
    const { ctx } = runCtx(model);
    const outcome = await runWithClient(client, ctx);

    expect(bodies).toHaveLength(1);
    expect(outcome.error).toContain("could not retry");
    expect(outcome.error).toContain("--opencode-config");
    // Work is on disk; continuity is worth more than cleanliness.
    expect(outcome.sessionId).toBe(SESSION);
  });

  it("explains a rejected retry and withholds the poisoned session", async () => {
    const model = "prov/doomed-model";
    const { bodies, client } = scriptedClient([
      {
        info: assistant("msg_a", REJECTION),
        sse: [messageUpdated(assistant("msg_a", REJECTION))],
      },
      {
        info: assistant("msg_b", REJECTION),
        sse: [messageUpdated(assistant("msg_b", REJECTION))],
      },
    ]);
    const { ctx, items } = runCtx(model);
    const outcome = await runWithClient(client, ctx);

    expect(bodies).toHaveLength(2);
    expect(outcome.error).toContain("rejected it again");
    // The provider's raw words survive in parentheses, not as the whole story.
    expect(outcome.error).toContain("tool_choice");
    // A turn that did no work hands nothing forward: resuming the session
    // would replay the rejected exchange into every later message.
    expect(outcome.sessionId).toBeNull();
    expect(outcome.checkpointId).toBeNull();
    // No success row for a retry that failed.
    expect(warnings(items)).toHaveLength(0);
  });
});
