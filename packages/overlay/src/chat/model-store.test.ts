/**
 * The picker's stored choice.
 *
 * Every test here stubs `localStorage` explicitly, and that is not boilerplate.
 * happy-dom hands the suite a bare object with no `getItem`/`setItem`, so the
 * calls below would throw into the `catch` and every assertion would pass
 * against a store that had silently done nothing — a green suite proving the
 * opposite of what it claims. The rest of the overlay's persisted state gets
 * away without one only because it saves through a callback the tests never
 * fire (see the note in `canvas/frames.test.ts`); this one saves eagerly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreModelPick, saveModelPick } from "./model-store";

const NAMESPACED = /^__airship/;

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    removeItem: (k: string) => {
      delete store[k];
    },
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Whatever the store wrote, under whichever key it chose. */
function written(): string | undefined {
  return Object.values(store)[0];
}

describe("saveModelPick / restoreModelPick", () => {
  it("round-trips a backend and its models", () => {
    const state = {
      agent: "codex" as const,
      models: { claude: "opus", codex: "gpt-5.6" },
    };
    saveModelPick(state);
    expect(restoreModelPick()).toEqual(state);
  });

  it("actually writes something", () => {
    // The assertion the stub exists for: without it this file would pass with
    // an empty store and prove nothing at all.
    saveModelPick({ agent: "claude", models: {} });
    expect(written()).toContain("claude");
  });

  it("namespaces its key", () => {
    saveModelPick({ agent: "claude", models: {} });
    expect(Object.keys(store)[0]).toMatch(NAMESPACED);
  });

  it("returns nothing when there is nothing stored", () => {
    expect(restoreModelPick()).toEqual({ models: {} });
  });
});

describe("restoreModelPick — untrusted input", () => {
  function stored(value: string): void {
    store["__airship-model"] = value;
  }

  it("survives unparseable JSON", () => {
    stored("{ nope");
    expect(restoreModelPick()).toEqual({ models: {} });
  });

  it("survives a value that is not an object", () => {
    stored('"claude"');
    expect(restoreModelPick()).toEqual({ models: {} });
  });

  it("drops an agent it does not recognise", () => {
    // A backend that was removed, or a hand-edited value. Leaving it would put
    // the composer on an agent the daemon has never heard of.
    stored(JSON.stringify({ agent: "gemini", models: {} }));
    expect(restoreModelPick().agent).toBeUndefined();
  });

  it("drops a model keyed to an agent it does not recognise", () => {
    stored(JSON.stringify({ agent: "claude", models: { gemini: "x" } }));
    expect(restoreModelPick().models).toEqual({});
  });

  it("drops a model that is not a non-empty string", () => {
    stored(
      JSON.stringify({ models: { claude: 5, codex: "", opencode: "a/b" } })
    );
    expect(restoreModelPick().models).toEqual({ opencode: "a/b" });
  });

  it("keeps the models when only the agent is unusable", () => {
    // The two halves are independent: a bad agent must not cost the user every
    // model they had picked.
    stored(JSON.stringify({ agent: 7, models: { claude: "opus" } }));
    expect(restoreModelPick()).toEqual({ models: { claude: "opus" } });
  });
});

describe("when storage itself fails", () => {
  it("does not throw on save", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => saveModelPick({ agent: "claude", models: {} })).not.toThrow();
  });

  it("falls back to the defaults on read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    });
    expect(restoreModelPick()).toEqual({ models: {} });
  });
});
