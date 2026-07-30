/**
 * Drives the Codex event reducer over a hand-written event stream.
 *
 * This is the reason `reduceEvents` is separate from `run`: the alternative is
 * spawning the real CLI and hoping it produces the item types you want to
 * assert on. Everything here is the translation layer, which is where the
 * Codex path's actual risk lives.
 */

import type { TimelineItem, TimelineToolItem } from "@airship/protocol";
import type { ThreadEvent } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import type { AgentRunContext } from "../agent";
import { DiffCapture } from "../diff-capture";
import { TimelineRecorder } from "../timeline";
import { reduceEvents } from "./codex";

function makeCtx(): {
  ctx: AgentRunContext;
  items: TimelineItem[];
  steps: string[];
} {
  const items: TimelineItem[] = [];
  const steps: string[] = [];
  const recorder = new TimelineRecorder({
    onItem: (item) => items.push(item),
  });
  const ctx = {
    diffs: new DiffCapture("/tmp/airship-test"),
    emitStep: (s: string) => steps.push(s),
    events: {},
    input: { cwd: "/tmp/airship-test", prompt: "" },
    promptText: "",
    recorder,
  } as unknown as AgentRunContext;
  return { ctx, items, steps };
}

// biome-ignore lint/suspicious/useAwait: an async generator is the shape reduceEvents consumes; a fixture has nothing to await
async function* stream(events: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  for (const e of events) {
    yield e;
  }
}

const tools = (items: TimelineItem[]): TimelineToolItem[] =>
  items.filter((i): i is TimelineToolItem => i.kind === "tool");

describe("reduceEvents", () => {
  it("maps a failing command onto a Bash row carrying its exit code", async () => {
    const { ctx, items } = makeCtx();
    const outcome = await reduceEvents(
      stream([
        { thread_id: "thread-1", type: "thread.started" },
        { type: "turn.started" },
        {
          item: {
            aggregated_output: "",
            command: "pnpm build",
            id: "c1",
            status: "in_progress",
            type: "command_execution",
          },
          type: "item.started",
        },
        {
          item: {
            aggregated_output: "boom: something broke",
            command: "pnpm build",
            exit_code: 1,
            id: "c1",
            status: "failed",
            type: "command_execution",
          },
          type: "item.completed",
        },
        {
          type: "turn.completed",
          usage: {
            cache_write_input_tokens: 0,
            cached_input_tokens: 0,
            input_tokens: 100,
            output_tokens: 20,
            reasoning_output_tokens: 5,
          },
        },
      ] as ThreadEvent[]),
      ctx
    );

    const [row] = tools(items);
    expect(row.title).toBe("Bash(pnpm build)");
    // A non-zero exit is reported as the command's result, not as a broken
    // tool — the exit code and output survive, matching the Claude path.
    expect(row.phase).toBe("ok");
    expect(row.result?.text).toContain("exit 1");
    expect(row.result?.text).toContain("boom");
    expect(row.result?.detail).toContain("boom: something broke");
    expect(outcome.sessionId).toBe("thread-1");
    // Reasoning tokens bill as output, so they fold in; cost is never reported.
    expect(outcome.usage?.outputTokens).toBe(25);
    expect(outcome.usage?.costUsd).toBeUndefined();
  });

  it("collapses repeated plan updates into a single todos row", async () => {
    const { ctx, items } = makeCtx();
    await reduceEvents(
      stream([
        {
          item: {
            id: "p1",
            items: [{ completed: false, text: "one" }],
            type: "todo_list",
          },
          type: "item.started",
        },
        {
          item: {
            id: "p1",
            items: [
              { completed: true, text: "one" },
              { completed: false, text: "two" },
            ],
            type: "todo_list",
          },
          type: "item.updated",
        },
      ] as ThreadEvent[]),
      ctx
    );

    const todoRows = items.filter((i) => i.kind === "todos");
    expect(todoRows).toHaveLength(1);
    expect((todoRows[0] as { todos: unknown[] }).todos).toHaveLength(2);
  });

  it("keeps the structured final message out of the transcript", async () => {
    const { ctx, items } = makeCtx();
    const outcome = await reduceEvents(
      stream([
        {
          item: {
            id: "m1",
            text: "Looking at the header.",
            type: "agent_message",
          },
          type: "item.completed",
        },
        {
          item: {
            id: "m2",
            text: JSON.stringify({
              filesChanged: ["src/App.tsx"],
              followUps: ["Adjust the hover state"],
              summary: "Made the button blue.",
            }),
            type: "agent_message",
          },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx
    );

    expect(outcome.structured?.summary).toBe("Made the button blue.");
    expect(outcome.structured?.followUps).toEqual(["Adjust the hover state"]);
    const texts = items.filter((i) => i.kind === "text");
    // The earlier commentary renders; the JSON payload does not.
    expect(texts).toHaveLength(1);
    expect((texts[0] as { text: string }).text).toBe("Looking at the header.");
  });

  it("falls back to prose when the model ignores the schema", async () => {
    const { ctx, items } = makeCtx();
    const outcome = await reduceEvents(
      stream([
        {
          item: { id: "m1", text: "All done.", type: "agent_message" },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx
    );

    expect(outcome.structured).toBeNull();
    expect(outcome.resultText).toBe("All done.");
    expect(items.filter((i) => i.kind === "text")).toHaveLength(1);
  });

  it("gives each path in a patch its own row, named by change kind", async () => {
    const { ctx, items } = makeCtx();
    await reduceEvents(
      stream([
        {
          item: {
            changes: [
              { kind: "update", path: "src/App.tsx" },
              { kind: "add", path: "src/New.tsx" },
              { kind: "delete", path: "src/Old.tsx" },
            ],
            id: "f1",
            status: "completed",
            type: "file_change",
          },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx
    );

    const rows = tools(items);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(["Edit", "Write", "Delete"]);
    // Ids are suffixed: one Codex item carries every path in the patch, and an
    // unsuffixed id would collapse them into a single row.
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.every((r) => r.phase !== "pending")).toBe(true);
  });

  it("re-offers every dirty path after a shell command, not just new ones", async () => {
    // A `sed -i` against a file the user had *already* modified is dirty both
    // before and after the command, so filtering on "newly dirty" would skip
    // exactly the case this rescan exists to catch.
    const { ctx } = makeCtx();
    const offered: string[] = [];
    ctx.diffs = {
      pairFor: () => null,
      recordAfterTheFact: (p: string) => offered.push(p),
    } as unknown as typeof ctx.diffs;

    await reduceEvents(
      stream([
        {
          item: {
            aggregated_output: "",
            command: "sed -i '' s/a/b/ already-dirty.ts",
            exit_code: 0,
            id: "c1",
            status: "completed",
            type: "command_execution",
          },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx,
      { rescanDirty: () => new Set(["/p/already-dirty.ts", "/p/fresh.ts"]) }
    );

    expect(offered).toEqual(["/p/already-dirty.ts", "/p/fresh.ts"]);
  });

  it("shows a warning item without failing the turn", async () => {
    // Codex emits an error *item* for config warnings, deprecation notices and
    // model reroutes. A reroute happens routinely under load; failing on it
    // would discard a good edit and its summary.
    const { ctx, items } = makeCtx();
    const outcome = await reduceEvents(
      stream([
        {
          item: {
            id: "e1",
            message: "model rerouted: gpt-5 -> gpt-5-mini",
            type: "error",
          },
          type: "item.completed",
        },
        {
          item: {
            id: "m1",
            text: JSON.stringify({
              filesChanged: ["src/App.tsx"],
              followUps: [],
              summary: "Made the button blue.",
            }),
            type: "agent_message",
          },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.structured?.summary).toBe("Made the button blue.");
    // Visible, not swallowed.
    const [row] = tools(items);
    expect(row.title).toBe("Warning");
    expect(row.phase).toBe("error");
    expect(row.result?.text).toContain("rerouted");
  });

  it("surfaces a failed turn as an error rather than throwing", async () => {
    const { ctx } = makeCtx();
    const outcome = await reduceEvents(
      stream([
        { error: { message: "model unavailable" }, type: "turn.failed" },
      ] as ThreadEvent[]),
      ctx
    );
    expect(outcome.error).toBe("model unavailable");
  });

  it("keeps the stream's error when the CLI then exits non-zero", async () => {
    // The SDK drains the events and *then* throws on a non-zero exit, so the
    // useful message ("you've hit your usage limit") is followed by a useless
    // one ("Codex Exec exited with code 1"). The first must win.
    // biome-ignore lint/suspicious/useAwait: an async generator is the shape reduceEvents consumes
    async function* failing(): AsyncGenerator<ThreadEvent> {
      yield {
        message: "You've hit your usage limit.",
        type: "error",
      } as ThreadEvent;
      throw new Error(
        "Codex Exec exited with code 1: Reading prompt from stdin..."
      );
    }
    const { ctx } = makeCtx();
    const outcome = await reduceEvents(failing(), ctx);
    expect(outcome.error).toBe("You've hit your usage limit.");
  });

  it("reports a stream failure that arrives with nothing else to say", async () => {
    // biome-ignore lint/suspicious/useAwait: an async generator is the shape reduceEvents consumes
    async function* failing(): AsyncGenerator<ThreadEvent> {
      yield { type: "turn.started" } as ThreadEvent;
      throw new Error("spawn ENOENT");
    }
    const { ctx } = makeCtx();
    const outcome = await reduceEvents(failing(), ctx);
    expect(outcome.error).toBe("spawn ENOENT");
  });

  it("records reasoning as thinking, never as prose", async () => {
    const { ctx, items } = makeCtx();
    await reduceEvents(
      stream([
        {
          item: {
            id: "r1",
            text: "Considering the layout.",
            type: "reasoning",
          },
          type: "item.completed",
        },
      ] as ThreadEvent[]),
      ctx
    );
    expect(items.filter((i) => i.kind === "thinking")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "text")).toHaveLength(0);
  });
});
