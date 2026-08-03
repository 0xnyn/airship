/**
 * Editing styles that only apply on `:hover`, `:focus`, `:active` and friends.
 *
 * There is no way to make a browser match `:hover` from script — the CDP call
 * DevTools uses is not reachable from page JS. So the state is *simulated*: the
 * declarations its rules would apply are written to the element as inline
 * styles, marked `!important` so they beat the stylesheet rule they are standing
 * in for.
 *
 * The awkward part is that those previews share the `style` attribute with two
 * other things, and teardown has to hand each one back:
 *
 * - **The user's pending tweaks.** A hover preview of `color` lands on top of a
 *   pending base-state `color` tweak on the way in, and would take it with it on
 *   the way out. `ChangeSet.reapplyPreviews` puts those back.
 * - **The element's own authored inline styles.** These are the app's code, and
 *   `reapplyPreviews` knows nothing about them — so `injected` records what each
 *   property held *before* the preview covered it, and teardown restores it.
 *   Without that, leaving `:hover` on a `<button style="color:red">` deleted the
 *   author's declaration outright.
 *
 * Hence `injected` being a map rather than a list: the property names alone say
 * what to strip, but not what to uncover.
 */
import type { PseudoState } from "@airship/protocol";
import type { ChangeSet } from "../change-set";
import { pseudoDecls } from "./cascade";
import { applyPreview, clearPreview } from "./style-model";

/**
 * An inline declaration as it stood before a preview covered it.
 *
 * `null` in `injected` means the property was not declared inline at all, so
 * teardown removes it outright — the original behaviour, and the right one for
 * the overwhelmingly common case.
 */
interface Saved {
  priority: string;
  value: string;
}

interface Forced {
  /**
   * Per node, exactly the properties this module wrote and what each one covered.
   *
   * Two bugs shaped this. Holding only property *names* was data loss: an element
   * with its own `style="color:red"` had that declaration overwritten on the way
   * into a state and `removeProperty`'d on the way out, and
   * `ChangeSet.reapplyPreviews` could not save it — it knows about *pending*
   * changes, and an author's inline style is not one.
   *
   * Holding them for one *node* was the other. An edit made while a state is
   * forced fans across the whole selection, so every co-selected element gets an
   * `!important` preview too — and with a single-node record, teardown stripped
   * the primary's and abandoned the rest, leaving them rendering their hover
   * styling at rest for the remainder of the session.
   */
  injected: Map<Element, Map<string, Saved | null>>;
  /** The element the panel's controls read. The rest are co-selected. */
  node: Element;
  state: PseudoState;
}

/** What a node's own style attribute says about one property right now. */
function savedFor(node: Element, property: string): Saved | null {
  const { style } = node as HTMLElement;
  if (!style) {
    return null;
  }
  const value = style.getPropertyValue(property);
  return value
    ? { priority: style.getPropertyPriority(property), value }
    : null;
}

let forced: Forced | null = null;

/** The state currently being simulated, if any. */
export function forcedState(): PseudoState | null {
  return forced?.state ?? null;
}

export function forcedNode(): Element | null {
  return forced?.node ?? null;
}

/**
 * The properties currently standing in for a simulated state on this node.
 *
 * These are inline styles the editor owns, indistinguishable in the DOM from the
 * app's own. Anything that copies a node's `style` attribute — `duplicateSelection`
 * — has to know which entries are ours so it does not bake a hover preview into a
 * duplicate for good.
 */
export function injectedProperties(node: Element): string[] {
  const per = forced?.injected.get(node);
  return per ? [...per.keys()] : [];
}

/**
 * The values the panel should display for this element in the active state.
 *
 * The stylesheet's own hover declarations, with the user's pending hover edits
 * layered on top — otherwise a control would snap back to the stylesheet value
 * the moment it re-seeded, one keystroke after the user changed it.
 */
export function stateValues(
  node: Element,
  state: PseudoState,
  changeSet: ChangeSet
): Map<string, string> {
  const values = pseudoDecls(node, state);
  for (const change of changeSet.allChangesFor(node, { state })) {
    if (!change.disabled) {
      values.set(change.property, change.to);
    }
  }
  return values;
}

/**
 * Begin simulating a state on a node. Idempotent: re-entering the same state
 * re-reads the stylesheet, which is what makes this usable as the resync path
 * after an undo.
 */
export function enterState(
  nodes: readonly Element[],
  state: PseudoState,
  changeSet: ChangeSet
): void {
  exitState(changeSet);
  const [primary] = nodes;
  if (!primary) {
    return;
  }
  const injected = new Map<Element, Map<string, Saved | null>>();
  for (const node of nodes) {
    const per = new Map<string, Saved | null>();
    // Each node reads its *own* rules: two co-selected elements can carry
    // different classes, so previewing the primary's hover declarations on both
    // would show one of them a state it does not have.
    for (const [property, value] of stateValues(node, state, changeSet)) {
      // Snapshot before the write, or the snapshot is of our own preview.
      per.set(property, savedFor(node, property));
      applyPreview(node, property, value, true);
    }
    injected.set(node, per);
  }
  forced = { injected, node: primary, state };
}

/**
 * Stop simulating, and put back whatever the previews were covering.
 *
 * Three layers come off in order, and the order is the whole correctness of it:
 *
 * 1. Strip our own injection, so nothing of the simulated state survives.
 * 2. Put back the element's *own* inline declaration, if it had one. This is the
 *    author's code, not ours, and it was previously deleted outright.
 * 3. Let the change set re-apply the default-state previews last, so a pending
 *    tweak to the same property wins over the value it was already covering —
 *    which is what it did before the state was entered.
 */
export function exitState(changeSet: ChangeSet): void {
  if (!forced) {
    return;
  }
  const { injected } = forced;
  forced = null;
  for (const [node, per] of injected) {
    for (const [property, saved] of per) {
      clearPreview(node, property);
      if (saved) {
        (node as HTMLElement).style?.setProperty(
          property,
          saved.value,
          saved.priority
        );
      }
    }
    changeSet.reapplyPreviews(node);
  }
}

/**
 * Record that an edit made *while* a state is forced also needs stripping on
 * exit. Without this, a hover colour the user typed would survive as an inline
 * style after leaving hover, and the element would render its hover styling at
 * rest.
 *
 * **Call this before writing the preview, not after.** The snapshot it takes is
 * of what the property covered, so running it after `applyPreview` would record
 * the preview as the thing to restore and the author's own value would be lost
 * exactly as it was before `Saved` existed. An already-tracked property keeps its
 * first snapshot, which is the one that predates every preview.
 */
export function trackInjected(node: Element, property: string): void {
  if (!forced) {
    return;
  }
  // Any node, not just the primary. An edit under a forced state fans across the
  // whole selection, and each of those writes is ours to take back.
  let per = forced.injected.get(node);
  if (!per) {
    per = new Map();
    forced.injected.set(node, per);
  }
  if (!per.has(property)) {
    per.set(property, savedFor(node, property));
  }
}
