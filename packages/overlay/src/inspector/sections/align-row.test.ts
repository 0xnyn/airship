/**
 * One align click is one undo step.
 *
 * `applyAlign` fans a plan's declarations with a bare `ctx.recordOn` per
 * declaration and no bracket around them. `recordOn` ends at `journalDecl`,
 * which calls `history.push`, and an unbatched `push` goes straight to
 * `commit([op])` — its own entry on the undo stack. So the buttons whose plans
 * carry more than one declaration cost one ⌘Z *per declaration* to take back:
 * Tidy up on a flex parent writes `display`, `flex-direction`, `gap` and
 * `align-items`, and needed four.
 *
 * The section already had no tests. This is the outcome-level one — it counts
 * real steps on a real `History` rather than asserting that a batch was opened,
 * because the batch is the fix and the step count is the bug.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DesignPanel } from "../panel";
import {
  harness,
  mount,
  resetDocument,
  selectionOf,
  sizeOf,
} from "../test-support";
import { renderAlignRow } from "./align-row";
import type { SectionContext } from "./context";

/** A child in a two-child parent, which is what the tidy plans require. */
function inRow() {
  const parent = mount("div", { class: "row" });
  const first = document.createElement("div");
  const second = document.createElement("div");
  parent.append(first, second);
  for (const node of [parent, first, second]) {
    sizeOf(node, { height: 20, width: 40 });
  }
  return { first, parent };
}

/**
 * The align row over a real panel, so `recordOn` reaches a real `History`.
 *
 * Only the five members `applyAlign` touches are wired; the rest of the seam is
 * not exercised by this file and a stub for it would be noise.
 */
function alignRow() {
  const h = harness();
  const panel = new DesignPanel(h.deps);
  const { first, parent } = inRow();
  panel.setSelection(selectionOf(first));

  const ctx = {
    batch: (run: () => void) => h.history.batch(run),
    flash: () => undefined,
    recordOn: (node: Element, property: string, value: string) =>
      panel.recordOn(node, property, value),
    redrawOutline: () => undefined,
    refresh: () => undefined,
  } as unknown as SectionContext;

  return { ...h, element: renderAlignRow(ctx, first), first, parent };
}

/** How many undo steps are on the stack, by exhausting it. */
function undoSteps(history: { undo: () => boolean }): number {
  let steps = 0;
  while (history.undo()) {
    steps += 1;
  }
  return steps;
}

function press(root: HTMLElement, label: string): void {
  const button = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) {
    throw new Error(`no "${label}" button`);
  }
  button.click();
}

describe("one click, one undo step", () => {
  beforeEach(resetDocument);

  it("takes back a four-declaration Tidy up in one press", () => {
    // `display`, `flex-direction`, `gap`, `align-items` — four declarations,
    // and this used to be four separate entries on the undo stack.
    const { changeSet, element, history } = alignRow();
    press(element, "Tidy up");
    expect(changeSet.count()).toBeGreaterThan(1);
    expect(undoSteps(history)).toBe(1);
  });

  it("takes back a three-declaration Distribute in one press", () => {
    const { changeSet, element, history } = alignRow();
    press(element, "Distribute horizontally");
    expect(changeSet.count()).toBeGreaterThan(1);
    expect(undoSteps(history)).toBe(1);
  });

  it("journals one step whatever the plan's size", () => {
    // Block-flow "Align left" writes its own pair of declarations. The count is
    // not the assertion — the bracket has to hold for every button, including
    // the ones whose plans are small enough that they used to look correct.
    const { changeSet, element, history } = alignRow();
    press(element, "Align left");
    expect(changeSet.count()).toBeGreaterThan(0);
    expect(undoSteps(history)).toBe(1);
  });
});

/*
 * What this file deliberately does not assert: that undo *reverts* the
 * declarations. `harness()` wires `History`'s `apply` to a no-op on purpose —
 * "replay is the app's job (`history-ops.ts`); tests that need it supply their
 * own history through `overrides`" — so an undo here pops the step and changes
 * nothing. Reversion is covered by `history.test.ts` against `restoreDecl`.
 * What is under test here is the shape of the stack, which is where the bug was.
 */
