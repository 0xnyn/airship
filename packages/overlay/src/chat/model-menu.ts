/**
 * "Which backend, on which model?", as menu content.
 *
 * The header used to ask only the first half, because the second was settled at
 * launch by `--model` and could not be changed without restarting the daemon.
 * Splitting them into two controls was the obvious shape and the wrong one: a
 * model id only means anything against a backend — `claude-opus-5` is not a
 * thing Codex can run — so two independent pickers would spend most of their
 * time in states that cannot be sent.
 *
 * So it stays one menu, and the grouping carries the pairing: one collapsible
 * group per harness, and choosing any row inside it chooses both. This is the
 * same construction `canvas/device-menu.ts` uses for the device presets, for
 * the same reason — a flat column of every model across three backends is a
 * scroll, and four lines you open one of is a menu.
 */

import type { AgentKind, ModelCatalogue, ModelOption } from "@airship/protocol";
import { cls, el } from "../dom";
import type { IconName } from "../icons";
import type { MenuGroup, MenuItem } from "../popover-host";

/** The id that means "send no model and let the daemon's default stand". */
export const MODEL_DEFAULT = "";

export interface ModelPick {
  agent: AgentKind;
  /** `MODEL_DEFAULT` for the group's leading row. */
  model: string;
}

export interface ModelMenuDeps {
  /** The harness the composer is on. Its group opens. */
  agent: AgentKind;
  /** Live catalogue if one has arrived, else the seed. */
  catalogue: ModelCatalogue;
  /** The current model per harness, so each group marks its own. */
  models: Partial<Record<AgentKind, string>>;
  pick: (choice: ModelPick) => void;
}

/** Product marks, in the order the picker offers the backends. */
const AGENT_META: { icon: IconName; kind: AgentKind; label: string }[] = [
  { icon: "claude", kind: "claude", label: "Claude" },
  { icon: "codex", kind: "codex", label: "Codex" },
  { icon: "opencode", kind: "opencode", label: "OpenCode" },
];

/** The label a picked model gets in the button's tooltip. */
export function modelLabel(
  catalogue: ModelCatalogue,
  agent: AgentKind,
  model: string | undefined
): string {
  if (!model) {
    return "default";
  }
  const group = catalogue.find((g) => g.agent === agent);
  return group?.models.find((m) => m.id === model)?.label ?? model;
}

/**
 * The rows for one harness.
 *
 * Every group leads with Default, and it is a real choice rather than a
 * placeholder: picking it clears the model from the request so the daemon's
 * own resolved setting applies — which is what `--claude-model` and
 * `airship.config.json` are for, and the only way back to them once a model has
 * been picked by hand.
 */
function rowsFor(
  agent: AgentKind,
  models: ModelOption[],
  current: string | undefined,
  fallback: string | undefined,
  note: string | undefined,
  pick: (choice: ModelPick) => void
): MenuItem[] {
  const rows: MenuItem[] = [
    {
      hint: fallback ?? "the backend decides",
      label: "Default",
      on: !current,
      run: () => pick({ agent, model: MODEL_DEFAULT }),
    },
  ];
  // A backend that could not be reached says so in place of its models. A group
  // that is simply empty reads as a broken picker rather than a missing login,
  // and the two want very different things from the user.
  if (note && !models.length) {
    rows.push({ disabled: true, label: note, run: () => undefined });
  }
  for (const model of models) {
    rows.push({
      hint: model.hint,
      label: model.label,
      on: model.id === current,
      run: () => pick({ agent, model: model.id }),
    });
  }
  return rows;
}

/**
 * The catalogue as collapsible `createMenu` groups.
 *
 * `open` is seeded from the composer's current backend rather than left to fall
 * back to the first, so opening the menu on Codex shows you Codex's models. The
 * three groups are always present even when a probe returned nothing — the
 * picker's job includes letting you *switch to* a backend you have not signed
 * into yet, and a group that vanishes when it fails cannot do that.
 */
export function modelGroups(deps: ModelMenuDeps): MenuGroup[] {
  return AGENT_META.map((meta) => {
    const group = deps.catalogue.find((g) => g.agent === meta.kind);
    return {
      group: meta.kind,
      icon: meta.icon,
      items: rowsFor(
        meta.kind,
        group?.models ?? [],
        deps.models[meta.kind],
        group?.default,
        group?.note,
        deps.pick
      ),
      label: meta.label,
      open: meta.kind === deps.agent,
    };
  });
}

/**
 * The typed-id escape hatch from the list.
 *
 * `close` is a parameter rather than a call to the menu's own closer for the
 * same reason `customSizeRow` takes one: the row has no business knowing which
 * menu it was put in.
 *
 * Enter and Escape are handled on the field, not left to the menu. `Keys` skips
 * every binding without `allowWhileTyping` while a field has focus, so with
 * this one focused the menu's own Escape never runs and the only way out would
 * be the mouse — `keys/registry.ts` prescribes exactly this, and `customSizeRow` and
 * `renameFrame` already do it.
 */
export function customModelRow(
  agent: AgentKind,
  apply: (model: string) => void,
  close: () => void
): HTMLElement {
  const input = el("input", {
    // A placeholder is not a label: it is announced inconsistently and vanishes
    // the moment anyone types. This field is the only unlabelled control in the
    // picker, and it is the one that takes free text.
    "aria-label": `Model id for ${agent}`,
    class: cls("pop-custom-input"),
    // The form each backend takes, shown rather than explained: opencode drops
    // an id it cannot attribute to a provider, and the placeholder is the
    // cheapest place to say so.
    placeholder: agent === "opencode" ? "provider/model" : "model id or alias",
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;

  const commit = (): void => {
    const model = input.value.trim();
    if (!model) {
      return;
    }
    // Deliberately not rejected here when opencode gets a bare id. The daemon
    // is the one that knows — the CLI already refuses `--opencode-model sonnet`
    // outright — and a field that argues with what you typed, in a menu, with
    // nowhere to put the message, is worse than a turn that reports back.
    apply(model);
    close();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  // A press in the field is not a choice, and the row it sits in is inside a
  // menu that closes on one.
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  return el("div", { class: cls("pop-custom") }, [
    input,
    el("button", {
      class: cls("pop-custom-go"),
      onClick: (e: Event) => {
        e.stopPropagation();
        commit();
      },
      text: "Use",
      type: "button",
    }),
  ]);
}
