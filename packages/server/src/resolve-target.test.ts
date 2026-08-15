import { describe, expect, it } from "vitest";
import { modelRefusal, resolveTarget } from "./index";

/*
 * The model precedence chain, which is the whole of the model workstream's
 * server half.
 *
 * Three inputs can name a model — the turn, the per-backend default the CLI
 * resolved from `--claude-model` and friends, and the cross-harness `--model` —
 * and the order they win in is the only thing that decides what a turn runs on.
 * None of it was covered: `serve.test.ts` pins the CLI's half of the same chain
 * (how the flags collapse into `models`), and this pins what the daemon then
 * does with it.
 *
 * The per-backend map is what makes a mid-session harness switch safe. A single
 * shared default would follow the picker and hand Codex an id only Claude
 * answers to, which is the bug the map exists to prevent — the last case here.
 */

/** The CLI's resolved options, as `toServeOptions` produces them. */
const OPTS = {
  agent: "claude" as const,
  model: "cross-harness",
  models: {
    claude: "claude-default",
    codex: "codex-default",
    opencode: "anthropic/opencode-default",
  },
};

describe("resolveTarget — the agent", () => {
  it("takes the turn's agent over the daemon's", () => {
    expect(resolveTarget({ agent: "codex" }, OPTS).agent).toBe("codex");
  });

  it("falls back to the daemon's agent", () => {
    expect(resolveTarget({}, OPTS).agent).toBe("claude");
  });

  it("falls back to claude when nothing names one", () => {
    expect(resolveTarget({}, {}).agent).toBe("claude");
  });
});

describe("resolveTarget — the model", () => {
  it("takes what the turn asked for, over every default", () => {
    expect(resolveTarget({ model: "picked" }, OPTS).model).toBe("picked");
  });

  it("falls back to the default for the backend that is running", () => {
    expect(resolveTarget({ agent: "codex" }, OPTS).model).toBe("codex-default");
  });

  it("falls back to the cross-harness model when that backend has none", () => {
    const opts = { ...OPTS, models: { claude: "claude-default" } };

    expect(resolveTarget({ agent: "codex" }, opts).model).toBe("cross-harness");
  });

  it("leaves the model absent when nothing names one", () => {
    // Not an error and not a guess: every adapter reads an absent model as
    // "use your own default", which is the right answer for a bare launch.
    expect(resolveTarget({}, {}).model).toBeUndefined();
  });

  it("does not carry one backend's model across to another", () => {
    // The reason `models` is a map. With a single shared default, switching the
    // picker to Codex mid-session would send it `claude-default`.
    const onCodex = resolveTarget({ agent: "codex" }, OPTS);

    expect(onCodex.model).not.toBe(OPTS.models.claude);
    expect(onCodex.model).toBe("codex-default");
  });

  it("resolves the same values the edit handler validates", () => {
    // The guard in `handleMessage` and the send in `startEdit` call this once
    // each. If they disagreed, the checked model would stop being the run one.
    const request = { agent: "opencode" as const };

    expect(resolveTarget(request, OPTS)).toEqual(resolveTarget(request, OPTS));
    expect(resolveTarget(request, OPTS).model).toBe(
      "anthropic/opencode-default"
    );
  });
});

/*
 * Which door a bad opencode model came through decides what happens to it.
 *
 * Three inputs can name one, and they are guarded differently on purpose:
 * `--opencode-model` is a hard error at parse time, `--model` warns at launch
 * and lets the turn run on opencode's default, and the picker's custom-model box
 * — the only one with no guard anywhere — is refused here.
 *
 * The distinction is the whole finding. A first cut of this guard read the
 * *resolved* model, which folded the second case into the third: every turn of
 * `airship --agent opencode --model sonnet` would have been refused, a case
 * `args.ts` documents in as many words as warn-and-continue.
 */
describe("modelRefusal", () => {
  const OPENCODE = { agent: "opencode" as const };

  it("refuses a bare id the turn asked for", () => {
    const refusal = modelRefusal({ ...OPENCODE, model: "sonnet" }, {});

    expect(refusal).toContain("sonnet");
    expect(refusal).toContain("provider/model");
    expect(refusal).toContain("anthropic/sonnet");
  });

  it("allows one that names its provider", () => {
    expect(
      modelRefusal({ ...OPENCODE, model: "anthropic/claude-sonnet-5" }, {})
    ).toBeNull();
  });

  it("leaves the launch-flag fallback alone", () => {
    // `--agent opencode --model sonnet`: `toServeOptions` puts the bare id in
    // `models.opencode`, the banner warns about it, and the turn runs on
    // opencode's default. Refusing it here would break a documented path.
    const opts = { agent: "opencode" as const, models: { opencode: "sonnet" } };

    expect(modelRefusal({}, opts)).toBeNull();
  });

  it("leaves the cross-harness fallback alone too", () => {
    expect(
      modelRefusal({}, { agent: "opencode" as const, model: "sonnet" })
    ).toBeNull();
  });

  it("says nothing about the backends that take a bare id", () => {
    for (const agent of ["claude", "codex"] as const) {
      expect(modelRefusal({ agent, model: "sonnet" }, {})).toBeNull();
    }
  });

  it("follows the turn's own backend, not the daemon's", () => {
    // Picking Codex in the picker and typing a bare id must not be refused
    // just because the daemon launched on opencode.
    const opts = { agent: "opencode" as const };

    expect(
      modelRefusal({ agent: "codex", model: "gpt-5.3-codex" }, opts)
    ).toBeNull();
    // And the mirror: launched on claude, picker switched to opencode.
    expect(
      modelRefusal({ agent: "opencode", model: "sonnet" }, { agent: "claude" })
    ).not.toBeNull();
  });
});
