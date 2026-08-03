import type {
  ElementContext,
  PseudoState,
  SourceLocation,
  StyleChange,
  TokenRef,
  VisualEditTarget,
} from "@airship/protocol";
import { applyPreview, clearPreview } from "./inspector/style-model";

/**
 * Which selector and interaction state a declaration belongs to.
 *
 * Both absent is the common case and means "this element, default state" — the
 * only thing that existed before scope targeting and forced states. They ride on
 * the *declaration* rather than the target because one element can carry both an
 * instance padding tweak and a `:hover` colour tweak in the same session; the
 * split back into per-selector targets happens in {@link ChangeSet.targets}.
 */
export interface ChangeTarget {
  /** A class selector the element matches. Absent ⇒ this instance only. */
  scope?: string;
  /** Absent ⇒ the default (unforced) state. */
  state?: PseudoState;
}

/** A tracked declaration. `disabled` is a client-only DevTools-style toggle: the
 * row stays in the editor but its preview is reverted and it is dropped from the
 * wire payload until re-enabled. */
export interface Change extends StyleChange {
  disabled?: boolean;
  scope?: string;
  state?: PseudoState;
}

export interface Entry {
  changes: Change[];
  element: ElementContext;
  node: Element;
  source: SourceLocation | null;
}

export interface RecordInput {
  /**
   * This record expresses an intent about *how* the value should be written —
   * bind it to a token, or deliberately hardcode it — rather than about what
   * the value is.
   *
   * It exists for one reason: `record` drops a declaration whose `to` equals its
   * `from`, which is right for a value edit and wrong here. Adopting a token for
   * a value you already have is the single most common reason to open the token
   * picker, and it produces exactly that no-op-looking write — so the slot was
   * removed, the `TokenRef` had nothing to attach to, and the pick appeared to
   * do nothing at all.
   *
   * Deliberately an explicit flag rather than inferred from `token`/`hardcode`
   * being set. `replay` (the undo path) also carries the slot's token forward,
   * and undoing back to the original value must still collapse the change to
   * nothing — binding included. Only a direct act by the user sets this.
   */
  binding?: boolean;
  element: ElementContext;
  /** The value before the *first* tweak of this property. */
  from: string;
  node: Element;
  property: string;
  source: SourceLocation | null;
  target?: ChangeTarget;
  to: string;
  token?: TokenRef;
}

/** Do two declarations address the same (property, scope, state) slot? */
function addresses(
  change: Change,
  property: string,
  target?: ChangeTarget
): boolean {
  return (
    change.property === property &&
    change.scope === target?.scope &&
    change.state === target?.state
  );
}

/** Grouping key for splitting one node's declarations back into wire targets. */
function slotOf(change: Change): string {
  return `${change.scope ?? ""}\u0000${change.state ?? ""}`;
}

/** The slot a declaration belongs to, as the targets everywhere else take it. */
export function targetOf(change: Change): ChangeTarget | undefined {
  return change.scope || change.state
    ? { scope: change.scope, state: change.state }
    : undefined;
}

/**
 * Accumulates the direct-manipulation style deltas made in the design inspector,
 * keyed by the live DOM node. On Apply the overlay ships {@link targets} to the
 * agent, which translates the deltas into idiomatic source edits.
 */
export class ChangeSet {
  private readonly map = new Map<Element, Entry>();

  /**
   * Properties the user deliberately detached from their token, per node.
   *
   * Lives here rather than on the panel because it is pending payload state
   * with exactly this set's lifetime and exactly this set's key — and on the
   * panel it had neither. It was a `WeakMap` nothing ever reset, so a detach
   * survived Discard, survived the agent applying the edit, and went on
   * suppressing the token on a property whose pending change was long gone.
   *
   * Deliberately keyed by (node, property) and not by slot: "write this as a
   * literal" is a statement about the property, and nobody detaches a token on
   * `:hover` while keeping it at rest.
   */
  private hardcoded = new WeakMap<Element, Set<string>>();

  /** Mark, or unmark, a property as deliberately written as a literal. */
  setHardcoded(node: Element, property: string, on: boolean): void {
    let set = this.hardcoded.get(node);
    if (!set) {
      if (!on) {
        return;
      }
      set = new Set();
      this.hardcoded.set(node, set);
    }
    if (on) {
      set.add(property);
    } else {
      set.delete(property);
    }
  }

  isHardcoded(node: Element, property: string): boolean {
    return this.hardcoded.get(node)?.has(property) ?? false;
  }

  /**
   * Record a tweak. `from` is stored only the first time a (property, scope,
   * state) slot is seen for a node (so it reflects the original value across
   * repeated tweaks). Tweaking a property back to its original removes it —
   * unless the record is a {@link RecordInput.binding}, which is an intent
   * about how the value is written and survives the value being unchanged.
   *
   * A record is the *only* way a token or a hardcode flag reaches a slot. There
   * used to be `setToken`/`setHardcode` patchers alongside this, and every
   * caller had to record first and patch second — so a record that removed its
   * own slot (see above) left the patch with nothing to write to, and the
   * binding vanished with no indication that it had. Writing the value and the
   * intent in one call is what makes that unrepresentable.
   */
  record(input: RecordInput): void {
    const { node, property, from, to, target } = input;
    // A binding survives an unchanged value; a plain edit does not. See
    // `RecordInput.binding`.
    if (to === from && !input.binding) {
      this.remove(node, property, target);
      return;
    }
    let entry = this.map.get(node);
    if (!entry) {
      entry = {
        changes: [],
        element: input.element,
        node,
        source: input.source,
      };
      this.map.set(node, entry);
    }
    // "Write a literal here" and "write this token here" are contradictory
    // instructions, so a hardcoded slot never carries a token. Both are read
    // from the registry above rather than passed in: a detach is sticky across
    // later edits — otherwise the next scrub of the same field silently
    // re-attaches the token the user just rejected — and making every caller
    // remember to re-assert it is how that gets lost.
    const hardcode = this.isHardcoded(node, property) || undefined;
    const token = hardcode ? undefined : input.token;

    const existing = entry.changes.find((c) => addresses(c, property, target));
    if (existing) {
      existing.to = to;
      existing.token = token;
      existing.hardcode = hardcode;
      // A value edit implies the declaration is active again.
      existing.disabled = false;
      return;
    }
    entry.changes.push({
      from,
      hardcode,
      property,
      scope: target?.scope,
      state: target?.state,
      to,
      token,
    });
  }

  /**
   * Put one declaration back exactly as it was, or take it away — the undo and
   * redo of the CSS pane's delete, disable and per-chip ✕.
   *
   * Verbatim rather than re-recorded. Those operations do not change a value, so
   * routing them back through `record` would recompute `from` against a DOM the
   * preview has already been stripped from and turn `16px → 24px` into
   * `24px → 24px` on the way back. `disabled` has to survive the round trip for
   * the same reason.
   */
  restoreDecl(input: {
    change: Change | null;
    element: ElementContext;
    node: Element;
    property: string;
    source: SourceLocation | null;
    target?: ChangeTarget;
  }): void {
    const { node, property, target } = input;
    if (!input.change) {
      this.remove(node, property, target);
      return;
    }
    const change = { ...input.change };
    let entry = this.map.get(node);
    if (!entry) {
      entry = {
        changes: [],
        element: input.element,
        node,
        source: input.source,
      };
      this.map.set(node, entry);
    }
    entry.changes = [
      ...entry.changes.filter((c) => !addresses(c, property, target)),
      change,
    ];
    // The detach registry is keyed separately, so restoring a declaration that
    // carried one has to put that back too or the badge disagrees with the
    // payload it just resurrected.
    this.setHardcoded(node, property, Boolean(change.hardcode));
  }

  /**
   * A *copy* of one tracked declaration, for a caller that needs to journal it.
   *
   * A copy because `setDisabled` and `record` mutate the stored object in place,
   * so a journal holding the live reference would watch its own "before" state
   * change under it and restore the after-state on undo.
   */
  snapshot(
    node: Element,
    property: string,
    target?: ChangeTarget
  ): Change | undefined {
    const change = this.map
      .get(node)
      ?.changes.find((c) => addresses(c, property, target));
    return change ? { ...change } : undefined;
  }

  /** The original (first-seen) value for a slot, if already tracked. */
  originalValue(
    node: Element,
    property: string,
    target?: ChangeTarget
  ): string | undefined {
    return this.map
      .get(node)
      ?.changes.find((c) => addresses(c, property, target))?.from;
  }

  /** Toggle a declaration on/off (DevTools-style). Does not touch the preview —
   * the caller reverts/re-applies so the live DOM matches the enabled state. */
  setDisabled(
    node: Element,
    property: string,
    disabled: boolean,
    target?: ChangeTarget
  ): void {
    const change = this.map
      .get(node)
      ?.changes.find((c) => addresses(c, property, target));
    if (change) {
      change.disabled = disabled;
    }
  }

  isDisabled(node: Element, property: string, target?: ChangeTarget): boolean {
    return Boolean(
      this.map.get(node)?.changes.find((c) => addresses(c, property, target))
        ?.disabled
    );
  }

  /**
   * Drop a declaration entirely (the CSS list's ✕).
   *
   * Takes the detach instruction with it. A hardcode says how *this pending
   * declaration* should be written, so a slot that no longer exists cannot
   * still be carrying one — and leaving it behind meant the badge went on
   * showing "detached" for a property with nothing pending on it.
   */
  remove(node: Element, property: string, target?: ChangeTarget): void {
    this.setHardcoded(node, property, false);
    const entry = this.map.get(node);
    if (!entry) {
      return;
    }
    entry.changes = entry.changes.filter(
      (c) => !addresses(c, property, target)
    );
    if (entry.changes.length === 0) {
      this.map.delete(node);
    }
  }

  /** Enabled declarations only (for callers that render the effective set). */
  changesFor(node: Element, target?: ChangeTarget): StyleChange[] {
    return (this.map.get(node)?.changes ?? []).filter(
      (c) =>
        !c.disabled && c.scope === target?.scope && c.state === target?.state
    );
  }

  /** Every tracked declaration incl. disabled — for the CSS declaration editor. */
  allChangesFor(node: Element, target?: ChangeTarget): Change[] {
    return (this.map.get(node)?.changes ?? []).filter(
      (c) => c.scope === target?.scope && c.state === target?.state
    );
  }

  /**
   * Every edited node with its declarations — the composer renders one chip per
   * declaration, so it needs the element context alongside them. Mirrors
   * `MoveSet.entries` / `StructureSet.entries` so the sets stay one idea.
   */
  entries(): Entry[] {
    return [...this.map.values()];
  }

  count(): number {
    let n = 0;
    for (const e of this.map.values()) {
      n += e.changes.filter((c) => !c.disabled).length;
    }
    return n;
  }

  targetCount(): number {
    return this.targets().length;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  nodes(): Element[] {
    return [...this.map.keys()];
  }

  /**
   * The wire payload: one target per (node, scope, state), disabled declarations
   * dropped. A node edited both at rest and on `:hover` produces two targets, so
   * the agent is told which selector each group belongs to rather than being
   * handed a pile of declarations with no home.
   *
   * `skip` drops a node's declarations from the payload without forgetting them.
   * Its caller is the turn assembly, which also holds the structural set: styling
   * an element the same turn asks the agent to *delete* is two contradictory
   * instructions, and the agent has no good way to reconcile them. Not a
   * `remove()` because a delete is undoable — take the delete back and the
   * declarations have to come back with it.
   *
   * Deliberately a predicate rather than an `isConnected` test inside this class.
   * Every pending change points at a detached node after an HMR re-render, and
   * those are exactly the edits that *must* still ship: the agent works from the
   * captured `ElementContext` and source location, not the live node.
   */
  targets(skip?: (node: Element) => boolean): VisualEditTarget[] {
    const out: VisualEditTarget[] = [];
    for (const e of this.map.values()) {
      if (skip?.(e.node)) {
        continue;
      }
      const slots = new Map<string, Change[]>();
      for (const c of e.changes) {
        if (c.disabled) {
          continue;
        }
        const key = slotOf(c);
        const bucket = slots.get(key);
        if (bucket) {
          bucket.push(c);
        } else {
          slots.set(key, [c]);
        }
      }
      for (const changes of slots.values()) {
        out.push({
          changes: changes.map((c) => ({
            from: c.from,
            hardcode: c.hardcode,
            property: c.property,
            to: c.to,
            token: c.token,
          })),
          element: e.element,
          scope: changes[0].scope,
          source: e.source,
          state: changes[0].state,
        });
      }
    }
    return out;
  }

  /**
   * Every property this set has previewed on one node, whatever slot it belongs
   * to.
   *
   * `allChangesFor` cannot answer this: it filters to a single (scope, state)
   * slot, and a preview is a fact about the `style` attribute regardless of which
   * slot put it there. The caller is `duplicateSelection`, which clones a node
   * whose inline styles are *ours* and has to strip them from the copy — a clone
   * is not in this set, so `clearPreviews` will never visit it and the preview
   * would be baked into the duplicate for good.
   */
  previewedProperties(node: Element): string[] {
    const entry = this.map.get(node);
    return entry ? [...new Set(entry.changes.map((c) => c.property))] : [];
  }

  /** Remove every inline preview we applied (revert the live DOM). */
  clearPreviews(): void {
    for (const e of this.map.values()) {
      for (const c of e.changes) {
        clearPreview(e.node, c.property);
      }
    }
  }

  /**
   * Re-apply the default-state previews for one node.
   *
   * Leaving a forced pseudo-state strips the inline styles that were injected to
   * preview it — and those share the `style` attribute with the user's ordinary
   * tweaks, so a `:hover` colour preview clobbers a base colour tweak on the way
   * in and takes it with it on the way out. `forced-state.ts` calls this on exit
   * to put the base previews back.
   */
  reapplyPreviews(node: Element): void {
    const entry = this.map.get(node);
    if (!entry) {
      return;
    }
    for (const c of entry.changes) {
      if (!(c.disabled || c.state)) {
        applyPreview(node, c.property, c.to);
      }
    }
  }

  clear(): void {
    this.map.clear();
    // A `WeakMap` has no `clear()`, and the detach registry has to go with the
    // declarations it annotates — Discard and a landed agent edit both end the
    // pending state completely.
    this.hardcoded = new WeakMap();
  }
}
