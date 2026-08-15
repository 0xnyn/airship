/**
 * `toServeOptions` — where merged settings become validated options.
 *
 * The function has carried "Exported for the tests" since it was split out of
 * `main`, and until now there were none: nothing in the repo imported it. That
 * was survivable while it only read strings across; it stopped being so once it
 * grew the per-backend model fallback, which is real logic with three inputs
 * and a precedence order, and which no other layer re-checks.
 */

import { describe, expect, it } from "vitest";
import { mergeSettings, type Settings } from "../lib/config";
import { CliError } from "../lib/errors";
import { toServeOptions } from "./serve";

const CWD = "/tmp/airship-serve-test";

/** Settings as the merge chain would hand them over. */
function settings(values: Record<string, string | boolean>): Settings {
  return mergeSettings(values as Settings);
}

function optionsFor(values: Record<string, string | boolean>) {
  return toServeOptions(settings(values), CWD);
}

/** The message on the CliError a call raises. */
function errorFrom(fn: () => unknown): CliError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) {
      return err;
    }
    throw err;
  }
}

describe("toServeOptions — models", () => {
  it("leaves every backend unset when no model flag is given", () => {
    const { model, models } = optionsFor({});
    expect(model).toBeUndefined();
    // Not `{}`: the keys exist and hold `undefined`, which is what the server
    // reads as "this backend has no configured default".
    expect(models.claude).toBeUndefined();
    expect(models.codex).toBeUndefined();
    expect(models.opencode).toBeUndefined();
  });

  it("spreads a bare --model to all three backends", () => {
    const { models } = optionsFor({ model: "sonnet" });
    expect(models).toEqual({
      claude: "sonnet",
      codex: "sonnet",
      opencode: "sonnet",
    });
  });

  it("lets a per-backend model outrank --model, for that backend only", () => {
    const { models } = optionsFor({ "claude-model": "opus", model: "sonnet" });
    expect(models.claude).toBe("opus");
    // The whole point of the split: switching the picker to Codex must not
    // carry Claude's id across.
    expect(models.codex).toBe("sonnet");
    expect(models.opencode).toBe("sonnet");
  });

  it("takes all three per-backend models independently", () => {
    const { models } = optionsFor({
      "claude-model": "opus",
      "codex-model": "gpt-5.3-codex",
      "opencode-model": "anthropic/claude-sonnet-5",
    });
    expect(models).toEqual({
      claude: "opus",
      codex: "gpt-5.3-codex",
      opencode: "anthropic/claude-sonnet-5",
    });
  });

  it("keeps --model on `model` as well, for the launch banner", () => {
    // `model` is not superseded by `models` — the banner reads it, and dropping
    // it would break a surface that has nothing to do with the picker.
    expect(optionsFor({ model: "sonnet" }).model).toBe("sonnet");
    expect(optionsFor({ "claude-model": "opus" }).model).toBeUndefined();
  });

  it("rejects an --opencode-model with no provider", () => {
    const err = errorFrom(() => optionsFor({ "opencode-model": "sonnet" }));
    expect(err?.message).toContain("opencode-model");
    // The hint has to show the shape, not just name it: the fix is invisible
    // otherwise, since the id itself is perfectly valid for another backend.
    expect(err?.hint).toContain("anthropic/sonnet");
  });

  it("accepts an --opencode-model that names its provider", () => {
    expect(
      optionsFor({ "opencode-model": "anthropic/x" }).models.opencode
    ).toBe("anthropic/x");
  });

  it("does not validate a bare --model, which reaches all three", () => {
    // A bare id is correct for two of the three backends, so this cannot be an
    // error. `banner.ts` warns at launch instead, once the agent is known.
    expect(optionsFor({ model: "sonnet" }).models.opencode).toBe("sonnet");
  });
});

describe("toServeOptions — the surrounding validation still holds", () => {
  it("defaults the agent and rejects an unknown one", () => {
    expect(optionsFor({}).agent).toBe("claude");
    expect(errorFrom(() => optionsFor({ agent: "gemini" }))?.message).toContain(
      "agent"
    );
  });

  it("rejects a port outside the range", () => {
    expect(errorFrom(() => optionsFor({ port: "70000" }))?.message).toContain(
      "port"
    );
  });

  it("rejects a non-numeric budget", () => {
    expect(
      errorFrom(() => optionsFor({ "max-budget": "lots" }))?.message
    ).toContain("max-budget");
  });
});
