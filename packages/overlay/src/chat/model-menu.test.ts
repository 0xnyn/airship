/**
 * The picker's content: three harness groups, and the typed-id escape hatch.
 *
 * `modelGroups` returns data rather than DOM, which is what makes most of this
 * testable without a menu to put it in — the same reason `deviceGroups` is
 * split out of the two menus that render it. `customModelRow` does build an
 * element, so its tests drive the real one.
 */

import type { ModelCatalogue } from "@airship/protocol";
import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../popover-host";
import { customModelRow, modelGroups, modelLabel } from "./model-menu";

const CATALOGUE: ModelCatalogue = [
  {
    agent: "claude",
    default: "opus",
    models: [
      { hint: "1M", id: "claude-opus-5", label: "Opus 5" },
      { id: "sonnet", label: "Sonnet" },
    ],
  },
  { agent: "codex", models: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
  { agent: "opencode", models: [], note: "Not signed in" },
];

function groupsFor(
  agent: "claude" | "codex" | "opencode",
  models: Record<string, string> = {},
  pick = vi.fn()
) {
  return {
    groups: modelGroups({ agent, catalogue: CATALOGUE, models, pick }),
    pick,
  };
}

/** A group's rows, which are all `MenuItem`s by construction. */
function labels(items: MenuItem[]): string[] {
  return items.map((i) => i.label);
}

describe("modelGroups", () => {
  it("offers every harness, in picker order", () => {
    const { groups } = groupsFor("claude");
    expect(groups.map((g) => g.group)).toEqual(["claude", "codex", "opencode"]);
  });

  it("opens the group for the backend the composer is on", () => {
    // Seeded from the current agent rather than left to fall back to the first,
    // so opening the menu on Codex shows you Codex.
    expect(groupsFor("codex").groups.find((g) => g.open)?.group).toBe("codex");
    expect(groupsFor("opencode").groups.find((g) => g.open)?.group).toBe(
      "opencode"
    );
  });

  it("opens exactly one group", () => {
    const open = groupsFor("codex").groups.filter((g) => g.open);
    expect(open).toHaveLength(1);
  });

  it("leads every group with Default", () => {
    for (const group of groupsFor("claude").groups) {
      expect(group.items[0].label).toBe("Default");
    }
  });

  it("shows the daemon's resolved default as the Default row's hint", () => {
    const [claude] = groupsFor("claude").groups;
    expect(claude.items[0].hint).toBe("opus");
  });

  it("falls back to a phrase when no default was resolved", () => {
    const [, codex] = groupsFor("codex").groups;
    expect(codex.items[0].hint).toBe("the backend decides");
  });

  it("marks Default as on when no model is picked for that backend", () => {
    const [claude] = groupsFor("claude").groups;
    expect(claude.items[0].on).toBe(true);
  });

  it("marks the picked model instead, once there is one", () => {
    const [claude] = groupsFor("claude", { claude: "sonnet" }).groups;
    expect(claude.items[0].on).toBe(false);
    expect(claude.items.find((i) => i.label === "Sonnet")?.on).toBe(true);
  });

  it("marks each backend's own model, not the active one's", () => {
    // The reason the state is per harness at all: Claude's pick must not light
    // up a row in Codex's group.
    const [claude, codex] = groupsFor("claude", {
      claude: "sonnet",
      codex: "gpt-5.6",
    }).groups;
    expect(claude.items.find((i) => i.label === "Sonnet")?.on).toBe(true);
    expect(codex.items.find((i) => i.label === "GPT-5.6")?.on).toBe(true);
  });

  it("shows a backend's note as a disabled row when it has no models", () => {
    // An empty group reads as a broken picker; a group that says "Not signed
    // in" reads as something the user can go and fix.
    const [, , opencode] = groupsFor("claude").groups;
    expect(labels(opencode.items)).toEqual(["Default", "Not signed in"]);
    expect(opencode.items[1].disabled).toBe(true);
  });

  it("keeps a failing backend in the list", () => {
    // Switching *to* a backend you have not signed into yet is a thing the
    // picker has to allow, so a group never disappears on a failed probe.
    expect(groupsFor("claude").groups).toHaveLength(3);
  });

  it("picks the backend and the model together", () => {
    const { groups, pick } = groupsFor("claude");
    const [, codex] = groups;
    codex.items.find((i) => i.label === "GPT-5.6")?.run();
    expect(pick).toHaveBeenCalledWith({ agent: "codex", model: "gpt-5.6" });
  });

  it("sends an empty model for the Default row", () => {
    const { groups, pick } = groupsFor("claude");
    groups[0].items[0].run();
    expect(pick).toHaveBeenCalledWith({ agent: "claude", model: "" });
  });

  it("carries each backend's mark on its header", () => {
    expect(groupsFor("claude").groups.map((g) => g.icon)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
  });
});

describe("modelLabel", () => {
  it("reads default when nothing is picked", () => {
    expect(modelLabel(CATALOGUE, "claude", undefined)).toBe("default");
  });

  it("resolves a picked id to its label", () => {
    expect(modelLabel(CATALOGUE, "claude", "claude-opus-5")).toBe("Opus 5");
  });

  it("falls back to the raw id for a model it has never heard of", () => {
    // A typed id, or one the seed predates. Showing it verbatim is better than
    // showing nothing, and it is what the user entered.
    expect(modelLabel(CATALOGUE, "claude", "claude-opus-9")).toBe(
      "claude-opus-9"
    );
  });
});

describe("customModelRow", () => {
  function row(agent: "claude" | "opencode" = "claude") {
    const apply = vi.fn();
    const close = vi.fn();
    const node = customModelRow(agent, apply, close);
    const input = node.querySelector("input") as HTMLInputElement;
    const button = node.querySelector("button") as HTMLButtonElement;
    return { apply, button, close, input, node };
  }

  function press(input: HTMLInputElement, key: string): void {
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  }

  it("commits on Enter and closes the menu", () => {
    const { apply, close, input } = row();
    input.value = "claude-opus-9";
    press(input, "Enter");
    expect(apply).toHaveBeenCalledWith("claude-opus-9");
    expect(close).toHaveBeenCalled();
  });

  it("commits on the button too", () => {
    const { apply, button, input } = row();
    input.value = "sonnet";
    button.click();
    expect(apply).toHaveBeenCalledWith("sonnet");
  });

  it("trims what was typed", () => {
    const { apply, input } = row();
    input.value = "  sonnet  ";
    press(input, "Enter");
    expect(apply).toHaveBeenCalledWith("sonnet");
  });

  it("does nothing on Enter in an empty field", () => {
    const { apply, close, input } = row();
    press(input, "Enter");
    expect(apply).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes on Escape without applying", () => {
    // Handled on the field rather than left to the menu: `keys/registry.ts` suppresses
    // bindings without `allowWhileTyping` while a field has focus, so the
    // menu's own Escape never fires here.
    const { apply, close, input } = row();
    input.value = "sonnet";
    press(input, "Escape");
    expect(apply).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("stops a press in the field from picking the row it sits in", () => {
    const { input } = row();
    for (const type of ["click", "pointerdown"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.cancelBubble).toBe(true);
    }
  });

  it("shows opencode the form it needs", () => {
    expect(row("opencode").input.placeholder).toBe("provider/model");
    expect(row("claude").input.placeholder).not.toContain("/");
  });
});
