/**
 * The generated seed catalogue, checked for shape rather than for contents.
 *
 * Every assertion here has to survive `make models:refresh` picking up a model
 * that shipped this morning. Pinning ids would invert that — the suite would go
 * red on a refresh that did exactly what it was asked to, and the fix each time
 * would be to edit the test to match the output, which is a gate that only ever
 * agrees with itself.
 *
 * So this asserts the contract the rest of the code leans on: every row is
 * sendable, every harness has something to show, and opencode's ids carry the
 * provider its adapter needs.
 */

import { describe, expect, it } from "vitest";
import { AGENT_KINDS } from "./index";
import { SEED_MODELS } from "./models";

const entries = Object.entries(SEED_MODELS);

describe("SEED_MODELS", () => {
  it("covers exactly the harnesses the protocol declares", () => {
    // The generated module spells its keys as string literals rather than
    // importing `AgentKind`, to stay free of the zod-importing barrel. This is
    // what makes that safe: a fourth backend, or a rename, fails here.
    expect(Object.keys(SEED_MODELS).sort()).toEqual([...AGENT_KINDS].sort());
  });

  it.each(entries)("gives %s something to offer", (_agent, models) => {
    // Codex especially: it can enumerate nothing at runtime, so an empty seed
    // would leave its group permanently blank rather than merely stale.
    expect(models.length).toBeGreaterThan(0);
  });

  it.each(entries)("gives every %s row an id and a label", (_agent, models) => {
    for (const model of models) {
      expect(model.id.trim()).not.toBe("");
      expect(model.label.trim()).not.toBe("");
    }
  });

  it.each(entries)("does not repeat an id within %s", (_agent, models) => {
    const ids = models.map((m) => m.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("keeps every opencode id in the provider/model form", () => {
    // `modelRefFor` splits on the first slash and drops an id it cannot
    // attribute, so a bare one here would be silently ignored at run time.
    for (const model of SEED_MODELS.opencode) {
      const [provider, ...rest] = model.id.split("/");
      expect(provider).not.toBe("");
      expect(rest.join("/")).not.toBe("");
    }
  });

  it("keeps claude and codex ids bare", () => {
    // The mirror of the rule above: those two take an id or an alias, and a
    // `provider/` prefix is not something either would recognise.
    for (const model of [...SEED_MODELS.claude, ...SEED_MODELS.codex]) {
      expect(model.id).not.toContain("/");
    }
  });

  it("never uses the empty id, which the menu reserves for Default", () => {
    for (const [, models] of entries) {
      expect(models.some((m) => m.id === "")).toBe(false);
    }
  });
});
