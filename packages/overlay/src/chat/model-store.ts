/**
 * The picker's choice, remembered between sessions.
 *
 * Its own module rather than a pair of methods on `AirshipApp` — which is what
 * the dock's widths and layout are — for one reason: this is the only stored
 * state in the overlay that is written *eagerly*. The canvas's viewport and
 * frame layouts save through a callback that tests simply never trigger, so
 * they have never needed `localStorage` to exist. This saves on every pick, so
 * it does, and a module is something a test can drive without standing up the
 * whole app.
 *
 * Reading is deliberately forgiving. The value is a convenience, and anything
 * unparseable, half-written or left over from an older shape has to degrade to
 * "nothing stored" rather than take the editor down on boot.
 */

import type { AgentKind } from "@airship/protocol";
import { PREFIX } from "../dom";

const KEY = `${PREFIX}-model`;

/** The agents a stored value may name, in the picker's order. */
const KINDS: readonly AgentKind[] = ["claude", "codex", "opencode"];

export interface ModelPickState {
  /** The backend the composer is on. */
  agent?: AgentKind;
  /** The model chosen for each backend. Absent means that backend's default. */
  models: Partial<Record<AgentKind, string>>;
}

function isAgent(value: unknown): value is AgentKind {
  return typeof value === "string" && KINDS.includes(value as AgentKind);
}

/**
 * Keep only the entries that could have come from this picker.
 *
 * A stored blob is untrusted input: it survives upgrades, it is editable by
 * hand, and a stale key from a renamed backend would otherwise be sent to the
 * daemon as a model for an agent that no longer exists.
 */
function cleanModels(raw: unknown): Partial<Record<AgentKind, string>> {
  const models: Partial<Record<AgentKind, string>> = {};
  if (!raw || typeof raw !== "object") {
    return models;
  }
  for (const [agent, model] of Object.entries(raw)) {
    if (isAgent(agent) && typeof model === "string" && model) {
      models[agent] = model;
    }
  }
  return models;
}

export function saveModelPick(state: ModelPickState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode — a forgotten model choice is not worth a crash.
  }
}

/**
 * What was stored, or nothing.
 *
 * `agent` being present is what the caller uses to decide that the daemon's
 * `hello` must not re-seed the picker, so it is only set when a real backend
 * name was found — an empty object here means "the daemon decides", which is
 * the right answer for a first run.
 */
export function restoreModelPick(): ModelPickState {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") {
      return { models: {} };
    }
    const models = cleanModels(parsed.models);
    return isAgent(parsed.agent) ? { agent: parsed.agent, models } : { models };
  } catch {
    // Unparseable, or no storage at all. Fall through to the defaults.
    return { models: {} };
  }
}
