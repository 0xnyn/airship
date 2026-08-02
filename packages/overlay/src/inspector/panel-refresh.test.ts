import { beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { DesignPanel } from "./panel";
import {
  harness,
  mount,
  resetDocument,
  selectionOf,
  sizeOf,
  styleSheet,
} from "./test-support";

/*
 * The panel's refresh contract.
 *
 * `refresh` re-seeds when the element's shape is unchanged and rebuilds when it is
 * not, which keeps the caret and the scroll position. Several things it shows are
 * not derivable from a CSS property, and each of those was quietly outside the
 * contract: the CSS pane's row list, the Scope and State selects, the HTML
 * attribute fields, and the Clip content toggle.
 */

interface Internals {
  refreshCss: () => void;
  setScope: (scope: string | undefined) => void;
  tab: string;
}
const inner = (panel: DesignPanel): Internals => panel as unknown as Internals;

/** A selected element with a measurable box. */
function selected(tag = "div", opts: Parameters<typeof mount>[1] = {}) {
  const h = harness();
  const panel = new DesignPanel(h.deps);
  const node = mount(tag, opts);
  sizeOf(node, { height: 40, width: 100 });
  panel.setSelection(selectionOf(node));
  return { ...h, node, panel };
}

/** The CSS pane's `element.style` rows, by their property inputs. */
function overrideRows(panel: DesignPanel): string[] {
  return Array.from(panel.element.querySelectorAll(`.${cls("css-prop")}`))
    .map((input) => (input as HTMLInputElement).value)
    .filter(Boolean);
}

describe("CSS pane rows follow the change set", () => {
  beforeEach(resetDocument);

  it("renders a row for a declaration added through the pane", () => {
    /*
     * The pane renders `element.style` *from the change set*, but a write only went
     * through `reshapeIfNeeded`, and `shapeKey` describes the element rather than the
     * pending declarations. `deleteDecl` and `toggleDecl` always called `refreshCss`;
     * the add and edit paths did not. So typing a declaration turned the element red,
     * cleared the add row, and rendered no row for it — leaving the declaration
     * impossible to disable, edit or delete.
     */
    const { node, panel } = selected();
    inner(panel).tab = "css";
    panel.refresh();
    expect(overrideRows(panel)).toEqual([]);

    // What the pane's add row does on commit.
    panel.recordOn(node, "color", "#f00");
    panel.refresh();

    expect(overrideRows(panel)).toContain("color");
    panel.destroy();
  });

  it("rebuilds the pane on refresh even when the element's shape is unchanged", () => {
    // The CSS tab is always a rebuild: everything it shows is derived from which
    // declarations are pending and which rules override which, and no per-control
    // `setValue` can express either.
    const { changeSet, node, panel } = selected();
    inner(panel).tab = "css";
    panel.recordOn(node, "color", "#f00");
    panel.refresh();
    expect(overrideRows(panel)).toContain("color");

    // An undo, from the panel's point of view.
    changeSet.remove(node, "color");
    panel.refresh();

    expect(overrideRows(panel)).not.toContain("color");
    panel.destroy();
  });

  it("does not rebuild the pane mid-gesture", () => {
    // A scrub calls `write` per pointermove. Rebuilding on every frame would drop
    // the caret out of whichever row is being typed in.
    const { history, node, panel } = selected();
    inner(panel).tab = "css";
    panel.refresh();

    history.batch(() => {
      panel.recordOn(node, "color", "#f00");
      // Inside the batch the pane is left alone.
      expect(overrideRows(panel)).toEqual([]);
    });
    panel.destroy();
  });
});

describe("Scope and State survive a re-seed", () => {
  beforeEach(resetDocument);

  it("keeps the scope label while the target stays set", () => {
    /*
     * `--scope` is a pseudo-property: no CSS carries it, so a re-seed read `""` and
     * `createSelect` relabelled the control to the option with the empty value —
     * "This element" — while `editTarget.scope` was untouched. The next padding edit
     * still wrote to every element carrying the class. `sections/scope.ts` calls that
     * "the single most confusing thing this inspector could do".
     */
    styleSheet(".btn { padding: 4px }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const a = mount("button", { class: "btn" });
    mount("button", { class: "btn" });
    sizeOf(a, { height: 32, width: 80 });
    panel.setSelection(selectionOf(a));

    inner(panel).setScope(".btn");
    expect(panel.activeTarget().scope).toBe(".btn");
    const before = panel.element.textContent ?? "";
    expect(before).toContain(".btn");

    panel.refresh();

    expect(panel.activeTarget().scope).toBe(".btn");
    // Still says `.btn`, rather than having quietly gone back to "This element".
    expect(panel.element.textContent ?? "").toContain(".btn");
    panel.destroy();
  });
});

describe("controls that are not CSS properties", () => {
  beforeEach(resetDocument);

  it("follows an external change to an alt attribute", () => {
    // The field was seeded once and never registered, so an undo — or an agent edit
    // — left it showing text the element no longer had, and blurring re-committed
    // that stale value.
    const { node, panel } = selected("img");
    node.setAttribute("alt", "A cat");
    panel.refresh();
    // By placeholder: the panel is full of `.ctl-input`s, and the first one is a
    // number field.
    const altField = (): HTMLInputElement | null =>
      panel.element.querySelector('input[placeholder="Describe the image"]');
    expect(altField()?.value).toBe("A cat");

    node.setAttribute("alt", "A dog");
    panel.refresh();

    expect(altField()?.value).toBe("A dog");
    panel.destroy();
  });

  it("does not claim Lazy for an image with no loading attribute", () => {
    // The select seeded from `values[0].value` when the attribute was absent, so an
    // <img> with no `loading` displayed **Lazy** — the opposite of the HTML default,
    // and a claim about the markup the markup does not make.
    const { panel } = selected("img");
    panel.refresh();
    expect(panel.element.textContent ?? "").not.toContain("Lazy");
    panel.destroy();
  });

  it("follows an undo of the Clip content toggle", () => {
    /*
     * `overflow` is not in `shapeKey` and the button was a bare `el(...)` that only
     * repainted from its own click handler. So ⌘Z reverted the property while the
     * button stayed lit with `aria-pressed="true"`, and the next click wrote
     * `visible` again — a no-op, which reads as a dead control.
     */
    const { node, panel } = selected("div", {
      children: [document.createElement("span")],
    });
    node.style.setProperty("overflow", "hidden");
    panel.refresh();
    const pressed = (): string | null =>
      panel.element
        .querySelector(`.${cls("ctl-toggle")}`)
        ?.getAttribute("aria-pressed") ?? null;
    expect(pressed()).toBe("true");

    node.style.removeProperty("overflow");
    panel.refresh();

    expect(pressed()).toBe("false");
    panel.destroy();
  });
});
