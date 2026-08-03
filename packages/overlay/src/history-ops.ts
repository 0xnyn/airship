/*
 * Enacting one journalled operation, in either direction.
 *
 * This is the other half of `history.ts`, and it exists because of the rule
 * stated there: undoing an Airship edit means putting the DOM *and* the set that
 * owns it back together. Airship previews by mutating the live page and tells
 * the agent about it separately, so a DOM-only undo is not an undo — it is a
 * silent disagreement between what the user sees and what the agent will be
 * asked to write.
 *
 * `History` used to enact ops itself, and could only reach the DOM. `style` was
 * the exception, wired to `ChangeSet.replay` through a callback, and it was the
 * only kind that worked: undoing a delete put the element back on screen and
 * left the delete queued, undoing a text edit restored the old string and
 * shipped the new one, and a drag was never journalled at all — so ⌘Z after one
 * either reported "Nothing to undo" or reached past it and took back an earlier
 * style tweak instead.
 *
 * Every arm below therefore ends in a set method. Where a set already had the
 * right one it is used as-is (`MoveSet.remove` is exactly "undo a move"); where
 * it did not, the method was added there rather than open-coded here, so the
 * knowledge of what an edit means stays with the edit.
 */
import type { AttrSet } from "./attr-set";
import { type ChangeSet, targetOf } from "./change-set";
import type { Direction, Op } from "./history";
import type { MoveSet } from "./move-set";
import type { StructureSet } from "./structure-set";

export interface OpApplierDeps {
  attrSet: AttrSet;
  changeSet: ChangeSet;
  moveSet: MoveSet;
  /** Re-apply, or strip, the inline preview for a style declaration. */
  preview: (
    node: Element,
    property: string,
    value: string,
    tracked: boolean,
    important: boolean
  ) => void;
  structureSet: StructureSet;
  /** Push a replayed value back into the matching control, if one is mounted. */
  syncControl: (property: string, value: string) => void;
}

/**
 * Build the `HistoryDeps.apply` callback.
 *
 * One function per op kind, and the switch is exhaustive on purpose — adding a
 * kind to `Op` without an arm here is a type error, which is the coupling that
 * was missing when `move` sat in the union fully implemented and pushed by
 * nothing.
 */
export function createOpApplier(
  deps: OpApplierDeps
): (op: Op, direction: Direction) => void {
  return (op, direction) => {
    switch (op.kind) {
      case "move":
        applyMove(deps, op, direction);
        break;
      case "structure":
        applyStructure(deps, op, direction);
        break;
      case "text":
        applyText(deps, op, direction);
        break;
      case "attr":
        applyAttr(deps, op, direction);
        break;
      default:
        applyDecl(deps, op, direction);
        break;
    }
  };
}

type OpOf<K extends Op["kind"]> = Extract<Op, { kind: K }>;

/**
 * A drag-to-reposition.
 *
 * The DOM half and the bookkeeping half are separate calls because they answer
 * different questions: where the node goes is a live-tree fact this file can
 * compute, while what `MoveSet` should now hold was captured at drag time and
 * cannot be re-derived (a move's destination is recorded as resolved element
 * contexts, not as live nodes).
 */
function applyMove(
  deps: OpApplierDeps,
  op: OpOf<"move">,
  direction: Direction
): void {
  const undo = direction === "undo";
  insert(
    op.node,
    undo ? op.fromParent : op.toParent,
    undo ? op.fromNext : op.toNext
  );
  deps.moveSet.restoreEntry(op.node, undo ? op.prev : op.next);
}

/** A delete or a duplicate: `remove` is the undo, `reapply` the redo. */
function applyStructure(
  deps: OpApplierDeps,
  op: OpOf<"structure">,
  direction: Direction
): void {
  if (direction === "undo") {
    deps.structureSet.remove(op.record.node);
    return;
  }
  deps.structureSet.reapply(op.record);
}

/**
 * An in-place text edit.
 *
 * `recordText` rather than a patch of an existing entry: an undo that lands back
 * on the original string drops the entry, so the redo has nothing to patch and
 * would put the text back on the page while telling the agent nothing. Passing
 * the op's own `from` lets the entry be re-created, and `recordText` keeps the
 * earliest `from` when one already exists, so a chain of edits still reverts to
 * the true original.
 */
function applyText(
  deps: OpApplierDeps,
  op: OpOf<"text">,
  direction: Direction
): void {
  const value = direction === "undo" ? op.from : op.to;
  op.node.textContent = value;
  deps.structureSet.recordText({
    element: op.element,
    from: op.from,
    node: op.node,
    source: op.source,
    to: value,
  });
}

/** An HTML attribute edit. `AttrSet.record` writes the DOM itself, and — as
 * with text — can re-create an entry a previous undo dropped. */
function applyAttr(
  deps: OpApplierDeps,
  op: OpOf<"attr">,
  direction: Direction
): void {
  deps.attrSet.record({
    attribute: op.attribute,
    element: op.element,
    from: op.from,
    node: op.node,
    source: op.source,
    to: direction === "undo" ? op.from : op.to,
  });
}

/**
 * One pending style declaration, restored verbatim to the state on the chosen
 * side of the op. Covers value edits, disable toggles, deletes and bindings.
 *
 * The preview follows the declaration's `disabled` state rather than its mere
 * existence: re-enabling a row is the one case where the payload gains a
 * declaration whose value was already in the change set but not on the page.
 */
function applyDecl(
  deps: OpApplierDeps,
  op: OpOf<"decl">,
  direction: Direction
): void {
  const change = direction === "undo" ? op.before : op.after;
  // At least one side is always present — an op with neither describes nothing.
  const reference = op.before ?? op.after;
  if (!reference) {
    return;
  }
  const target = targetOf(reference);
  const { property } = reference;
  deps.changeSet.restoreDecl({
    change,
    element: op.element,
    node: op.node,
    property,
    source: op.source,
    target,
  });
  const live = change && !change.disabled;
  deps.preview(
    op.node,
    property,
    live ? change.to : "",
    Boolean(live),
    Boolean(target?.state)
  );
  // What the control should now show is the restored value, or — when the
  // declaration is gone — whatever it originally had.
  deps.syncControl(property, change?.to ?? reference.from);
}

/** Re-insert a node, tolerating a reference sibling that has since moved. */
function insert(node: Element, parent: Element, next: Node | null): void {
  if (!parent.isConnected) {
    return;
  }
  parent.insertBefore(node, next?.parentNode === parent ? next : null);
}
