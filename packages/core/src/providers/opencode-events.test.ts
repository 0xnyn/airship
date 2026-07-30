/**
 * Drives the OpenCode reducer over hand-written event streams.
 *
 * This is why `reduceEvent` is synchronous and separate from the adapter: the
 * alternative is standing up a real `opencode serve`, paying for a model, and
 * hoping it happens to produce the part types you want to assert on. Every
 * fixture below is shaped from a real captured stream (opencode 1.18.13).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimelineItem, TimelineToolItem } from "@airship/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunContext } from "../agent";
import { DiffCapture } from "../diff-capture";
import { TimelineRecorder } from "../timeline";
import { splitStructured, toolNameFor } from "./opencode-events";
import {
  finishBlocks,
  newReduceState,
  type ReduceHooks,
  type ReduceState,
  reconcileParts,
  reduceEvent,
} from "./opencode-reduce";
import type { OcEvent, OcPart, OcToolState } from "./opencode-wire";

const SESSION = "ses_ours";
const OTHER = "ses_theirs";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-opencode-test-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

interface Harness {
  ctx: AgentRunContext;
  items: TimelineItem[];
  state: ReduceState;
  steps: string[];
  text: string[];
}

function makeCtx(): Harness {
  const items: TimelineItem[] = [];
  const steps: string[] = [];
  const text: string[] = [];
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
    emitStep: (s: string) => steps.push(s),
    events: { onText: (d: string) => text.push(d) },
    input: { cwd: root, prompt: "" },
    promptText: "",
    recorder,
  } as unknown as AgentRunContext;
  return { ctx, items, state: newReduceState(), steps, text };
}

function drive(h: Harness, events: OcEvent[], hooks: ReduceHooks = {}): void {
  for (const event of events) {
    reduceEvent(event, h.ctx, h.state, hooks);
  }
}

const tools = (items: TimelineItem[]): TimelineToolItem[] =>
  items.filter((i): i is TimelineToolItem => i.kind === "tool");

function toolPart(
  id: string,
  tool: string,
  state: OcToolState,
  sessionID = SESSION
): OcPart {
  return { id, messageID: "msg_1", sessionID, state, tool, type: "tool" };
}

function partUpdated(part: OcPart): OcEvent {
  return {
    properties: { part, sessionID: part.sessionID },
    type: "message.part.updated",
  };
}

function delta(partID: string, d: string, sessionID = SESSION): OcEvent {
  return {
    properties: { delta: d, field: "text", partID, sessionID },
    type: "message.part.delta",
  };
}

// ---------------------------------------------------------------------------

describe("session filtering", () => {
  it("is the caller's job — the reducer trusts what it is handed", () => {
    // `sessionIdOf` does the filtering in the adapter's drain loop; this asserts
    // the property that makes the shared server safe, end to end.
    const h = makeCtx();
    const foreign: OcEvent[] = [
      partUpdated(
        toolPart(
          "p1",
          "bash",
          { input: { command: "rm -rf /" }, status: "running" },
          OTHER
        )
      ),
    ];
    // The adapter drops anything whose session id is not ours; simulate that.
    for (const e of foreign) {
      const { sessionID } = e.properties as { sessionID?: string };
      if (sessionID !== SESSION) {
        continue;
      }
      reduceEvent(e, h.ctx, h.state);
    }
    expect(h.items).toHaveLength(0);
  });
});

describe("tool lifecycle", () => {
  it("opens once and closes once across pending → running → completed", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated(
        toolPart("p1", "read", { input: {}, raw: "", status: "pending" })
      ),
      partUpdated(
        toolPart("p1", "read", {
          input: { filePath: join(root, "app.tsx") },
          status: "running",
        })
      ),
      partUpdated(
        toolPart("p1", "read", {
          input: { filePath: join(root, "app.tsx") },
          output: "1: hello\n",
          status: "completed",
        })
      ),
    ]);
    const rows = tools(h.items);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("ok");
    // The `filePath` → `file_path` rename is what puts the name in the header.
    expect(rows[0].title).toContain("app.tsx");
  });

  it("does not drop a tool that never reports `running`", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated(
        toolPart("p1", "grep", { input: {}, raw: "", status: "pending" })
      ),
      partUpdated(
        toolPart("p1", "grep", {
          input: { pattern: "bg-blue" },
          output: "app.tsx:2",
          status: "completed",
        })
      ),
    ]);
    expect(tools(h.items)).toHaveLength(1);
    expect(tools(h.items)[0].title).toBe("Grep(bg-blue)");
  });

  it("never opens a row from an empty pending input", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated(
        toolPart("p1", "bash", { input: {}, raw: "", status: "pending" })
      ),
    ]);
    // A row opened here would freeze `Bash()` with no command into the
    // transcript, because the recorder snapshots args at open time.
    expect(h.items).toHaveLength(0);
  });
});

describe("bash results", () => {
  it("renders a non-zero exit as `exit N`, not as a broken tool", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated(
        toolPart("p1", "bash", {
          input: { command: "ls /nope" },
          metadata: {
            exit: 1,
            output: "ls: /nope: No such file or directory\n",
          },
          output: "ls: /nope: No such file or directory\n",
          status: "completed",
        })
      ),
    ]);
    const [row] = tools(h.items);
    expect(row.phase).toBe("ok");
    expect(row.result?.text).toContain("exit 1");
  });

  it("offers every dirty path after a shell command", () => {
    const h = makeCtx();
    writeFileSync(join(root, "touched.ts"), "changed");
    const seen: string[] = [];
    drive(
      h,
      [
        partUpdated(
          toolPart("p1", "bash", {
            input: { command: "sed -i s/a/b/ touched.ts" },
            metadata: { exit: 0, output: "" },
            status: "completed",
          })
        ),
      ],
      {
        rescanDirty: () => {
          seen.push("called");
          return new Set([join(root, "touched.ts")]);
        },
      }
    );
    expect(seen).toEqual(["called"]);
    // A `sed -i` write is invisible to both the diff and undo without this.
    expect(h.ctx.diffs.finalize().map((d) => d.file)).toContain("touched.ts");
  });
});

describe("streaming prose", () => {
  it("concatenates deltas into one row and reports each chunk", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: "",
        type: "text",
      }),
      delta("t1", "Hello"),
      delta("t1", " there"),
      delta("t1", "!"),
    ]);
    finishBlocks(h.state, h.ctx);
    expect(h.text.join("")).toBe("Hello there!");
    const textRows = h.items.filter((i) => i.kind === "text");
    expect(textRows).toHaveLength(1);
  });

  it("does not duplicate when snapshots repeat text already streamed", () => {
    const h = makeCtx();
    const snapshot = (text: string): OcEvent =>
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text,
        type: "text",
      });
    drive(h, [
      snapshot(""),
      snapshot("Done"),
      snapshot("Done"),
      snapshot("Done."),
    ]);
    finishBlocks(h.state, h.ctx);
    expect(h.text.join("")).toBe("Done.");
  });
});

describe("structured output", () => {
  const PAYLOAD = JSON.stringify({
    filesChanged: ["app.tsx"],
    followUps: ["Add a hover state"],
    summary: "Changed the button colour",
  });

  it("keeps the payload out of the transcript and recovers it", () => {
    const h = makeCtx();
    const full = `Done.\n<structuredoutput>\n${PAYLOAD}\n</structuredoutput>`;
    drive(h, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: full,
        type: "text",
      }),
    ]);
    finishBlocks(h.state, h.ctx);
    expect(h.text.join("")).toBe("Done.");
    expect(h.text.join("")).not.toContain("structuredoutput");
    expect(JSON.parse(h.state.payload ?? "{}")).toMatchObject({
      summary: "Changed the button colour",
    });
  });

  it("never emits a partially-streamed opening tag", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: "",
        type: "text",
      }),
      delta("t1", "Done."),
      // The opener really does arrive split across deltas.
      delta("t1", "\n<struct"),
      delta("t1", "uredoutput>"),
      delta("t1", PAYLOAD),
      delta("t1", "</structuredoutput>"),
    ]);
    finishBlocks(h.state, h.ctx);
    expect(h.text.join("")).toBe("Done.");
    expect(h.text.join("")).not.toContain("<");
  });

  it("leaves prose that merely mentions a brace alone", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: '{ "not": "a payload" } — just prose',
        type: "text",
      }),
    ]);
    finishBlocks(h.state, h.ctx);
    expect(h.text.join("")).toBe('{ "not": "a payload" } — just prose');
    expect(h.state.payload).toBeNull();
  });

  it("returns prose as a strict prefix, so rendering is always an append", () => {
    expect(
      splitStructured("a<structuredoutput>{}</structuredoutput>b")
    ).toEqual({
      // Not "ab": text after the wrapper is dropped rather than spliced on, so
      // that releasing a non-parsing payload later is a plain append.
      payload: "{}",
      prose: "a",
    });
    expect(splitStructured("no tags here")).toEqual({
      payload: null,
      prose: "no tags here",
    });
  });

  it("recognises a ```json fence, which weaker models use instead of the tags", () => {
    const fenced = 'Done.\n```json\n{"summary":"x"}\n```';
    expect(splitStructured(fenced).payload).toBe('{"summary":"x"}');
    expect(splitStructured(fenced).prose).toBe("Done.\n");
  });

  it("hides a fenced payload that parses and releases one that does not", () => {
    const good = makeCtx();
    drive(good, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: `Done.\n\`\`\`json\n${PAYLOAD}\n\`\`\``,
        type: "text",
      }),
    ]);
    finishBlocks(good.state, good.ctx);
    expect(good.text.join("")).toBe("Done.");
    expect(JSON.parse(good.state.payload ?? "{}")).toMatchObject({
      summary: "Changed the button colour",
    });

    const snippet = makeCtx();
    const prose = 'Here is the change:\n```json\n{"unrelated":true}\n```';
    drive(snippet, [
      partUpdated({
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: prose,
        type: "text",
      }),
    ]);
    finishBlocks(snippet.state, snippet.ctx);
    // A quoted snippet must survive just because ``` is also a payload wrapper.
    expect(snippet.text.join("")).toBe(prose);
    expect(snippet.state.payload).toBeNull();
  });
});

describe("writes", () => {
  it("records an edit and shows a real +N −M", () => {
    const h = makeCtx();
    const file = join(root, "app.tsx");
    writeFileSync(file, "one\ntwo\nthree\n");
    // Baseline as the turn started, then the agent's write.
    h.ctx.diffs.prime([file]);
    writeFileSync(file, "one\nTWO\nthree\n");
    drive(h, [
      partUpdated(
        toolPart("p1", "edit", {
          input: { filePath: file, newString: "TWO", oldString: "two" },
          output: "Edit applied successfully.",
          status: "completed",
        })
      ),
    ]);
    const [row] = tools(h.items);
    expect(row.result?.text).toBe("+1 −1");
    expect(h.ctx.diffs.finalize().map((d) => d.file)).toEqual(["app.tsx"]);
  });

  it("takes patch-part paths as a backstop", () => {
    const h = makeCtx();
    const file = join(root, "other.ts");
    writeFileSync(file, "after");
    drive(h, [
      partUpdated({
        files: [file],
        hash: "abc",
        id: "p9",
        messageID: "msg_1",
        sessionID: SESSION,
        type: "patch",
      }),
    ]);
    expect(h.ctx.diffs.finalize().map((d) => d.file)).toEqual(["other.ts"]);
  });
});

describe("todos", () => {
  it("patches one row rather than appending on every revision", () => {
    const h = makeCtx();
    const update = (status: string): OcEvent => ({
      properties: {
        sessionID: SESSION,
        todos: [{ content: "Change the colour", id: "1", status }],
      },
      type: "todo.updated",
    });
    drive(h, [update("pending"), update("in_progress"), update("completed")]);
    const todoRows = h.items.filter((i) => i.kind === "todos");
    expect(todoRows).toHaveLength(1);
  });
});

describe("permissions", () => {
  it("answers exactly once and leaves a row when it refuses", () => {
    const h = makeCtx();
    const asked: string[] = [];
    const event: OcEvent = {
      properties: {
        id: "per_1",
        metadata: { command: "rm -rf /" },
        permission: "bash",
        sessionID: SESSION,
      },
      type: "permission.asked",
    };
    drive(h, [event, event], {
      onPermission: (p) => {
        asked.push(p.id);
        h.ctx.recorder.openTool(p.id, "Blocked", {}, null);
        h.ctx.recorder.closeTool(p.id, true, "Blocked a destructive command");
      },
    });
    // A request answered twice is as bad as one never answered.
    expect(asked).toEqual(["per_1"]);
    expect(tools(h.items)[0].phase).toBe("error");
  });
});

describe("errors and usage", () => {
  it("does not treat a StructuredOutputError as a turn failure", () => {
    const h = makeCtx();
    drive(h, [
      {
        properties: {
          info: {
            error: {
              data: { message: "Model did not produce structured output" },
              name: "StructuredOutputError",
            },
            id: "msg_2",
            role: "assistant",
            sessionID: SESSION,
          },
        },
        type: "message.updated",
      },
    ]);
    expect(h.state.error).toBeUndefined();
  });

  it("does surface a real API error", () => {
    const h = makeCtx();
    drive(h, [
      {
        properties: {
          info: {
            error: {
              data: { message: "Upstream request failed" },
              name: "APIError",
            },
            id: "msg_2",
            role: "assistant",
            sessionID: SESSION,
          },
        },
        type: "message.updated",
      },
    ]);
    expect(h.state.error).toBe("Upstream request failed");
  });

  it("captures the user message id as the rewind anchor", () => {
    const h = makeCtx();
    drive(h, [
      {
        properties: {
          info: { id: "msg_user", role: "user", sessionID: SESSION },
        },
        type: "message.updated",
      },
    ]);
    expect(h.state.userMessageId).toBe("msg_user");
  });

  it("folds reasoning tokens into output", () => {
    const h = makeCtx();
    drive(h, [
      partUpdated({
        cost: 0.02,
        id: "sf",
        messageID: "msg_1",
        sessionID: SESSION,
        tokens: { input: 100, output: 20, reasoning: 5 },
        type: "step-finish",
      }),
    ]);
    expect(h.state.usage?.inputTokens).toBe(100);
    expect(h.state.usage?.outputTokens).toBe(25);
  });
});

describe("reconciliation", () => {
  it("is idempotent against a stream that already delivered everything", () => {
    const parts: OcPart[] = [
      toolPart("p1", "read", {
        input: { filePath: join(root, "a.ts") },
        output: "x",
        status: "completed",
      }),
      {
        id: "t1",
        messageID: "msg_1",
        sessionID: SESSION,
        text: "Done.",
        type: "text",
      },
    ];

    const streamed = makeCtx();
    drive(streamed, parts.map(partUpdated));
    reconcileParts(parts, streamed.ctx, streamed.state);
    finishBlocks(streamed.state, streamed.ctx);

    const replayed = makeCtx();
    reconcileParts(parts, replayed.ctx, replayed.state);
    finishBlocks(replayed.state, replayed.ctx);

    // Same timeline whether the stream delivered everything or nothing — which
    // is what licenses treating SSE reliability as a performance concern.
    const shape = (items: TimelineItem[]) =>
      items.map((i) => `${i.kind}:${"title" in i ? i.title : ""}`);
    expect(shape(streamed.items)).toEqual(shape(replayed.items));
    expect(streamed.text.join("")).toBe(replayed.text.join(""));
  });
});

describe("toolNameFor", () => {
  it("maps the real opencode tool ids onto the shared vocabulary", () => {
    expect(toolNameFor("bash")).toBe("Bash");
    expect(toolNameFor("edit")).toBe("Edit");
    expect(toolNameFor("apply_patch")).toBe("Edit");
    expect(toolNameFor("write")).toBe("Write");
    expect(toolNameFor("todowrite")).toBe("TodoWrite");
  });

  it("leaves a tool with no honest equivalent unmapped", () => {
    // `task` and `skill` have no Claude counterpart whose summarizer rules
    // would apply; falling through to `summarizeUnknown` is the honest outcome.
    expect(toolNameFor("task")).toBe("task");
    expect(toolNameFor("skill")).toBe("skill");
  });
});
