/**
 * The Scope and State rows — where an edit is written, and in what interaction
 * state.
 *
 * Above the alignment strip and outside the collapsible sections, because they
 * govern *every* control below them. A padding field that silently writes to
 * `.btn:hover` instead of this element is the single most confusing thing this
 * inspector could do, so the answer is always on screen.
 *
 * Rendered as a bare row rather than a `ctx.section` for the same reason
 * `align-row` is: it is not a group of properties, it is the frame the other
 * groups are read through.
 */
import type { PseudoState } from "@airship/protocol";
import { cls, el } from "../../dom";
import { availableStates, type ScopeLevel, scopeLevels } from "../cascade";
import { createSelect } from "../controls/select";
import type { Descriptor, EnumOption } from "../descriptors";
import type { SectionContext } from "./context";
import { labelled } from "./row";

export interface ScopeRowState {
  scope?: string;
  state?: PseudoState;
}

export interface ScopeRowDeps {
  onScope: (scope: string | undefined) => void;
  onState: (state: PseudoState | undefined) => void;
  value: ScopeRowState;
}

/** The `--scope` / `--state` pseudo-properties keep `setValue` from mis-firing
 * on a real CSS property — see the convention note in `descriptors.ts`. */
const SCOPE_DESCRIPTOR: Descriptor = {
  controlType: "select",
  cssProperty: "--scope",
  defaultValue: "",
  group: "layout",
  key: "scope",
  label: "Scope",
  span: "full",
};

const STATE_DESCRIPTOR: Descriptor = {
  controlType: "select",
  cssProperty: "--state",
  defaultValue: "",
  group: "layout",
  key: "state",
  label: "State",
  span: "full",
};

const THIS_ELEMENT = "";

export function renderScopeRow(
  ctx: SectionContext,
  node: Element,
  deps: ScopeRowDeps
): HTMLElement | null {
  const levels = scopeLevels(node);
  const states = availableStates(node);

  // Nothing to choose on either axis: an element with no shared classes and no
  // interaction styling. Rendering two dead selects would be noise on the great
  // majority of elements.
  const scopeWorthShowing = levels.length > 1;
  if (!(scopeWorthShowing || states.length)) {
    return null;
  }

  const rows: HTMLElement[] = [];
  if (scopeWorthShowing) {
    rows.push(scopeControl(ctx, levels, deps));
  }
  if (states.length) {
    rows.push(stateControl(ctx, states, deps));
  }
  const row = el("div", { class: cls("scope-row") }, rows);
  // Tint the row whenever edits are *not* going where they would by default.
  // Someone who set a scope five minutes ago needs to be reminded, not trusted
  // to remember, before they change a padding for every button in the app.
  if (deps.value.scope || deps.value.state) {
    row.dataset.scoped = "";
  }
  return row;
}

function scopeControl(
  ctx: SectionContext,
  levels: ScopeLevel[],
  deps: ScopeRowDeps
): HTMLElement {
  const options: EnumOption[] = levels.map((level) => ({
    label: level.selector
      ? `${level.label} · ${level.count} elements`
      : level.label,
    value: level.selector ?? THIS_ELEMENT,
  }));
  const control = createSelect(
    { ...SCOPE_DESCRIPTOR, enumValues: options },
    deps.value.scope ?? THIS_ELEMENT,
    (_property, value) =>
      deps.onScope(value === THIS_ELEMENT ? undefined : value)
  );
  // Panel state, not a CSS property — kept out of the re-seed pass, which would
  // otherwise read `""` for `--scope` and relabel this back to "This element"
  // while `editTarget.scope` stayed set. See `ControlHandle.virtual`.
  ctx.register({ ...control, virtual: true });
  return labelled("Scope", control.element);
}

function stateControl(
  ctx: SectionContext,
  states: PseudoState[],
  deps: ScopeRowDeps
): HTMLElement {
  const options: EnumOption[] = [
    { label: "Default", value: THIS_ELEMENT },
    ...states.map((state) => ({ label: state, value: state })),
  ];
  const control = createSelect(
    { ...STATE_DESCRIPTOR, enumValues: options },
    deps.value.state ?? THIS_ELEMENT,
    (_property, value) =>
      deps.onState(value === THIS_ELEMENT ? undefined : (value as PseudoState))
  );
  // See `scopeControl` — `--state` is panel state too, and a re-seed relabelled
  // this to "Default" while the simulation was still running.
  ctx.register({ ...control, virtual: true });
  return labelled("State", control.element);
}
