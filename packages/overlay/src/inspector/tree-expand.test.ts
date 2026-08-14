/**
 * Who owns a tree row's disclosure.
 *
 * There was no test covering tree expansion at all, and the bug it would have
 * caught shipped: the auto-expand path was seeded at the selection itself and
 * OR-ed over the user's `expanded` set, so the selected row was force-open —
 * `toggleExpand` on it was a no-op forever. The contract now: the selection
 * opens once, on first sight, and from then on its chevron belongs to the
 * user; strict ancestors stay pinned because collapsing one would hide the
 * selected row, and the tree *is* the selection UI here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesignPanel } from "./panel";
import { harness, mount, resetDocument, selectionOf } from "./test-support";

/** The panel with its DOM tab active, selected on `node`. Tab first: a plain
 * `refresh()` only re-seeds unless the shape changed, so the render that
 * paints the tree is the one `setSelection` performs. */
function domTab(node: Element): DesignPanel {
  const h = harness();
  const panel = new DesignPanel(h.deps);
  (panel as unknown as { tab: string }).tab = "dom";
  panel.setSelection(selectionOf(node));
  return panel;
}

const collapse = (panel: DesignPanel, node: Element): void => {
  (panel as unknown as { toggleExpand: (n: Element) => void }).toggleExpand(
    node
  );
};

/** Whether a row for the marker element is currently rendered. */
const shows = (panel: DesignPanel, marker: string): boolean =>
  panel.element.textContent?.includes(marker) ?? false;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  resetDocument();
});

describe("tree disclosure", () => {
  it("opens the selected row on first sight", () => {
    const kid = mount("span", { text: "KIDTEXT" });
    const parent = mount("div", { children: [kid] });
    const panel = domTab(parent);
    expect(shows(panel, "KIDTEXT")).toBe(true);
  });

  it("lets the selection's own chevron close it, and it stays closed", () => {
    const kid = mount("span", { text: "KIDTEXT" });
    const parent = mount("div", { children: [kid] });
    const panel = domTab(parent);

    collapse(panel, parent);
    expect(shows(panel, "KIDTEXT")).toBe(false);
    // A refresh must not spring it back open — the seed happens once per
    // selection change, not per render.
    panel.refresh();
    expect(shows(panel, "KIDTEXT")).toBe(false);
    // Nor a re-click of the same node: the picker re-emits the selection on
    // purpose, and `treeSeeded` is what makes the collapse survive it.
    panel.setSelection(selectionOf(parent));
    expect(shows(panel, "KIDTEXT")).toBe(false);
  });

  it("keeps ancestors of the selection pinned open", () => {
    const kid = mount("span", { text: "KIDTEXT" });
    const parent = mount("div", { children: [kid] });
    const panel = domTab(kid);

    // Collapsing an ancestor would hide the selected row itself; the walk
    // force-opens strict ancestors no matter what `expanded` says.
    collapse(panel, parent);
    expect(shows(panel, "KIDTEXT")).toBe(true);
  });

  it("re-opens on selecting the node afresh after visiting another", () => {
    const kid = mount("span", { text: "KIDTEXT" });
    const parent = mount("div", { children: [kid] });
    const other = mount("div");
    const panel = domTab(parent);

    collapse(panel, parent);
    panel.setSelection(selectionOf(other));
    panel.setSelection(selectionOf(parent));
    // A fresh selection is a fresh first sight.
    expect(shows(panel, "KIDTEXT")).toBe(true);
  });
});
