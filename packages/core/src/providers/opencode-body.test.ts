/**
 * The prompt request body, asserted directly.
 *
 * `format` is the field with history here: opencode implements it as a forced
 * tool call that thinking models reject, so whether it is present — and that
 * its absence is a true omission rather than `format: { type: "text" }` — is
 * load-bearing, not cosmetic. Exported for tests the same way
 * `permissionRuleset` and `finishOutcome` are.
 */
import { describe, expect, it } from "vitest";
import type { AgentRunContext } from "../agent";
import { systemPrompt } from "../prompt";
import { promptBody } from "./opencode";

function ctxFor(input: Record<string, unknown> = {}): AgentRunContext {
  return {
    input: { cwd: "/tmp/project", prompt: "make it blue", ...input },
    promptText: "the rendered instruction",
  } as unknown as AgentRunContext;
}

describe("promptBody", () => {
  it("sends the schema-typed format when enabled, without retryCount", () => {
    const body = promptBody(ctxFor(), true);
    const format = body.format as Record<string, unknown>;
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBeDefined();
    // retryCount asked opencode to re-run structured extraction; against a
    // deterministic provider rejection it only multiplied doomed requests.
    expect(format.retryCount).toBeUndefined();
  });

  it("omits the format key entirely when disabled", () => {
    const body = promptBody(ctxFor(), false);
    expect("format" in body).toBe(false);
  });

  it("sends the full system prompt on fresh and resumed turns alike", () => {
    // The system prompt now carries the structured-output contract, so a
    // resumed turn running without it would silently lose the summary chips.
    const fresh = promptBody(ctxFor(), true);
    const resumed = promptBody(ctxFor({ resumeSessionId: "ses_9" }), true);
    expect(fresh.system).toBe(systemPrompt("opencode"));
    expect(resumed.system).toBe(systemPrompt("opencode"));
  });

  it("keeps the question tool off", () => {
    expect(promptBody(ctxFor(), true).tools).toEqual({ question: false });
  });

  it("attaches images as data urls", () => {
    const body = promptBody(
      ctxFor({
        images: [
          { dataBase64: "QUJD", mediaType: "image/png", name: "shot.png" },
        ],
      }),
      true
    );
    const parts = body.parts as Record<string, unknown>[];
    expect(parts[0]).toEqual({
      text: "the rendered instruction",
      type: "text",
    });
    expect(parts[1]).toMatchObject({
      filename: "shot.png",
      mime: "image/png",
      type: "file",
      url: "data:image/png;base64,QUJD",
    });
  });
});
