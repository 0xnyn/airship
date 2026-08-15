/**
 * The translation half of the model probes.
 *
 * Mostly the pure functions, for the reason `opencode-events.test.ts` gives about
 * its own: the probes themselves start a subprocess and talk to an account, so
 * a test that covered them would be testing the machine it ran on. What is
 * worth pinning is the mapping — which fields become a row, and which shapes
 * are dropped on the way.
 *
 * The exception is the last block, which stubs `getAdapter` to cover the one
 * behaviour the module's header promises and no mapping test can reach: that a
 * backend which cannot be loaded at all comes back as a note rather than a
 * rejection.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "./agent";
import {
  fromClaudeModels,
  fromOpencodeProviders,
  listAllModels,
} from "./models";

vi.mock("./agent", () => ({ getAdapter: vi.fn() }));

describe("fromClaudeModels", () => {
  it("takes the label live and the hint from the seed", () => {
    // The split matters: the backend is the authority on what a model is
    // *called*, and the seed is the only thing that knows its context window,
    // because `supportedModels()` does not report one.
    expect(
      fromClaudeModels([{ displayName: "Opus 5", value: "claude-opus-5" }])
    ).toEqual([{ hint: "1M", id: "claude-opus-5", label: "Opus 5" }]);
  });

  it("falls back to the id when there is no display name", () => {
    expect(fromClaudeModels([{ value: "some-new-model" }])[0]).toEqual({
      hint: undefined,
      id: "some-new-model",
      label: "some-new-model",
    });
  });

  it("drops the SDK's own default row", () => {
    // Every group already leads with a synthetic Default that clears the model
    // from the request. Two rows called Default, deferring to different things,
    // is worse than one.
    const rows = fromClaudeModels([
      { displayName: "Default (recommended)", value: "default" },
      { displayName: "Sonnet", value: "sonnet" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["sonnet"]);
  });

  it("drops a row with no value at all", () => {
    // Through `unknown` on purpose: the point of the test is a payload the
    // declared type says cannot happen, and a direct cast is the one thing
    // `tsc` will not let you write for exactly that reason.
    const malformed = [{ displayName: "ghost" }] as unknown as Parameters<
      typeof fromClaudeModels
    >[0];
    expect(fromClaudeModels(malformed)).toEqual([]);
  });

  it("does not put the prose description in the hint", () => {
    // The hint slot is a dimmed right-aligned mono cell; a sentence in it wraps
    // the row. The context window comes from the seed instead, when known.
    const [row] = fromClaudeModels([
      {
        description: "Strongest model for coding, agents and long tasks",
        displayName: "Opus",
        value: "opus",
      },
    ]);
    expect(row.hint).not.toContain("Strongest");
  });
});

describe("fromOpencodeProviders", () => {
  it("joins the provider onto the model id", () => {
    expect(
      fromOpencodeProviders([
        {
          id: "anthropic",
          models: { "claude-sonnet-5": { name: "Claude Sonnet 5" } },
          name: "Anthropic",
        },
      ])
    ).toEqual([
      {
        hint: "Anthropic",
        id: "anthropic/claude-sonnet-5",
        label: "Claude Sonnet 5",
      },
    ]);
  });

  it("flattens several providers and sorts them", () => {
    const rows = fromOpencodeProviders([
      { id: "openai", models: { "gpt-5.6": {} } },
      {
        id: "anthropic",
        models: { "claude-opus-5": {}, "claude-sonnet-5": {} },
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6",
    ]);
  });

  it("prefers the model's own id over its key", () => {
    const [row] = fromOpencodeProviders([
      { id: "p", models: { alias: { id: "real-id" } } },
    ]);
    expect(row.id).toBe("p/real-id");
  });

  it("falls back to the provider id when it has no display name", () => {
    // The hint is what tells two providers' copies of the same model apart, so
    // it has to say something even when the registry gave no label.
    const [row] = fromOpencodeProviders([{ id: "custom", models: { m: {} } }]);
    expect(row.hint).toBe("custom");
  });

  it("survives a provider with no models and an empty list", () => {
    expect(fromOpencodeProviders([{ id: "empty" }])).toEqual([]);
    expect(fromOpencodeProviders([])).toEqual([]);
  });
});

/*
 * The one thing this module promises: it does not throw.
 *
 * `getAdapter` is a dynamic import, so a backend whose package is missing or
 * broken rejects there rather than returning. That call used to sit *outside*
 * the `try`, and `listAllModels` runs all three through `Promise.all` — so a
 * single unusable backend rejected the whole catalogue and the picker showed an
 * error toast with no rows, instead of two working groups and one explained gap.
 */
describe("listAllModels", () => {
  const mockGetAdapter = vi.mocked(getAdapter);

  beforeEach(() => {
    mockGetAdapter.mockReset();
  });

  it("reports a backend that cannot even be loaded as a note, not a rejection", async () => {
    mockGetAdapter.mockRejectedValue(new Error("Cannot find module 'codex'"));

    const groups = await listAllModels("/tmp");

    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.note).toBe("Cannot find module 'codex'");
      // A degraded menu still has to be a menu.
      expect(group.models.length).toBeGreaterThan(0);
    }
  });

  it("lets the healthy backends through when one is broken", async () => {
    mockGetAdapter.mockImplementation((agent) => {
      if (agent === "codex") {
        return Promise.reject(new Error("broken install"));
      }
      return Promise.resolve({
        checkAuth: () => ({ ok: false, reason: "Not signed in" }),
      } as unknown as Awaited<ReturnType<typeof getAdapter>>);
    });

    const groups = await listAllModels("/tmp");

    const byAgent = new Map(groups.map((g) => [g.agent, g]));
    expect(byAgent.get("codex")?.note).toBe("broken install");
    expect(byAgent.get("claude")?.note).toBe("Not signed in");
    expect(byAgent.get("opencode")?.note).toBe("Not signed in");
  });
});
