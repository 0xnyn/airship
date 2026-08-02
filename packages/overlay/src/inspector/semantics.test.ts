import { beforeEach, describe, expect, it } from "vitest";
import { currentInset, writeAnchor } from "./constraints";
import { hasBackgroundImage } from "./element-kind";
import { parseDropShadow, seedFilterValue } from "./filters";
import { hasBounds, hasStroke } from "./gates";
import { formatGradient, parseGradient } from "./gradient";
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
 * Phase 6: the affordances that were dead, and the writes that moved the wrong thing.
 *
 * A `Reader` here is just a lookup over a literal, which is what the gates take — they
 * are deliberately ignorant of where the value came from so the panel can compose
 * "pending edit, then computed style" once.
 */
const reader = (values: Record<string, string>) => (property: string) =>
  values[property] ?? "";

describe("gates", () => {
  it("sees a border on any edge, not only the top", () => {
    // `.header { border-bottom: 1px solid #eee }` — the canonical divider — reported no
    // stroke, so the section emptied and its `+` wrote a border on all four sides.
    expect(hasStroke(reader({ "border-bottom-style": "solid" }))).toBe(true);
    expect(hasStroke(reader({ "border-top-style": "solid" }))).toBe(true);
    expect(hasStroke(reader({ "border-top-style": "none" }))).toBe(false);
    expect(hasStroke(reader({ "border-left-style": "hidden" }))).toBe(false);
  });

  it("sees a bound that does not start with a digit", () => {
    // `parseFloat("calc(...)")` is NaN, so `> 0` was false and the min/max grid was
    // hidden — and `shapeKey` agreed, so it never appeared.
    expect(hasBounds(reader({ "max-width": "calc(100% - 2rem)" }))).toBe(true);
    expect(hasBounds(reader({ "max-width": "fit-content" }))).toBe(true);
    expect(hasBounds(reader({ "min-width": "12px" }))).toBe(true);
    expect(hasBounds(reader({ "max-width": "none" }))).toBe(false);
    expect(hasBounds(reader({ "min-width": "auto" }))).toBe(false);
    expect(hasBounds(reader({ "min-width": "0px" }))).toBe(false);
    expect(hasBounds(reader({}))).toBe(false);
  });
});

describe("hasBackgroundImage", () => {
  beforeEach(resetDocument);

  it("sees a url() layer under a gradient", () => {
    // The standard darkened hero. Any gradient anywhere in the value used to make this
    // false, so the Media section was never rendered for it.
    const node = mount("div", {
      style:
        "background-image: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.5)), url(hero.jpg)",
    });
    expect(hasBackgroundImage(node)).toBe(true);
  });

  it("is still false for a gradient alone", () => {
    const node = mount("div", {
      style: "background-image: linear-gradient(red, blue)",
    });
    expect(hasBackgroundImage(node)).toBe(false);
  });
});

describe("gradient serialisation", () => {
  it("emits stops in rendered order, so CSS does not clamp them", () => {
    /*
     * `onAdd` appends, and CSS clamps any stop below its predecessor — so a stop added
     * mid-bar came out last and rendered as a hard edge at 100%, while the editor's own
     * preview bar (which already sorted) showed what the user asked for.
     */
    const gradient = parseGradient("linear-gradient(#fff 0%, #ccc 100%)");
    expect(gradient).not.toBeNull();
    const withAdded = {
      ...(gradient as NonNullable<typeof gradient>),
      stops: [
        ...(gradient as NonNullable<typeof gradient>).stops,
        { color: "#888", position: "50%" },
      ],
    };
    expect(formatGradient(withAdded)).toBe(
      "linear-gradient(#fff 0%, #888 50%, #ccc 100%)"
    );
  });

  it("drops a colour hint rather than inventing a stop coloured 30%", () => {
    // The docstring always said hints are dropped; the code returned a stop whose colour
    // was the position, which rendered as a black band once touched.
    const gradient = parseGradient("linear-gradient(red, 30%, blue)");
    expect(gradient?.stops.map((s) => s.color)).toEqual(["red", "blue"]);
  });
});

describe("drop shadow colour", () => {
  it("leaves an omitted colour omitted", () => {
    // CSS paints it in the element's own `color`; inventing black turned a red icon's
    // shadow black on the first scrub of the X offset.
    expect(parseDropShadow("4px 4px 2px").color).toBe("");
  });

  it("keeps an authored colour", () => {
    expect(parseDropShadow("4px 4px 2px #f00").color).toBe("#f00");
  });
});

describe("filter seeding", () => {
  it("scales a computed ratio into the field's percent unit", () => {
    expect(seedFilterValue("brightness", "1.2")).toBe("120%");
  });
});

describe("constraints", () => {
  beforeEach(resetDocument);

  it("composes translate across both axes", () => {
    /*
     * `translate` holds both axes in one property and this wrote the whole thing, so
     * centring horizontally and then vertically clobbered the first correction — the card
     * ended up half its width right of centre.
     */
    const node = mount("div", { style: "translate: -50% 0" });
    const decls = writeAnchor(node, "v", "center", 0);
    const translate = decls.find((d) => d.property === "translate");
    expect(translate?.value).toBe("-50% -50%");
  });

  it("starts from nothing when no translate is declared", () => {
    const node = mount("div");
    const decls = writeAnchor(node, "h", "center", 0);
    expect(decls.find((d) => d.property === "translate")?.value).toBe("-50% 0");
  });

  it("derives Scale from the measured inset instead of hardcoding 5%", () => {
    // The `default:` branch discarded the measured px and returned 5%/5%, so picking
    // Scale teleported the element and resized it to 90% of its parent.
    const parent = mount("div");
    Object.defineProperty(parent, "clientWidth", { value: 1000 });
    const node = mount("div", { parent });
    Object.defineProperty(node, "offsetWidth", { value: 200 });
    Object.defineProperty(node, "offsetParent", { value: parent });

    const decls = writeAnchor(node, "h", "scale", 340);
    expect(decls.find((d) => d.property === "left")?.value).toBe("34%");
    // 1000 - 340 - 200
    expect(decls.find((d) => d.property === "right")?.value).toBe("46%");
  });

  it("returns a right-edge inset, not a viewport x, without an offsetParent", () => {
    // The old fallback handed back `rect.left` as an inset from the *right* edge, so an
    // absolute <svg> at x=340 got `right: 340px` and jumped out of its card.
    const node = mount("div");
    sizeOf(node, { left: 340, top: 20, width: 200 });
    Object.defineProperty(node, "offsetParent", { value: null });
    Object.defineProperty(node, "offsetLeft", { value: undefined });
    const inset = currentInset(node, "h", "end");
    expect(inset).not.toBe(340);
    expect(inset).toBeGreaterThanOrEqual(0);
  });
});

describe("scope preview", () => {
  beforeEach(resetDocument);

  it("paints every element the scope matches, not only the selection", () => {
    /*
     * The picker offers `.btn · N elements` and the prompt tells the agent to write the
     * shared class, but the preview only ever landed on the selection — so one button
     * moved and the rest did not, and the real blast radius first appeared in the diff.
     */
    styleSheet(".btn { padding: 4px }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const a = mount("button", { class: "btn" });
    const b = mount("button", { class: "btn" });
    const other = mount("button", { class: "link" });
    sizeOf(a, { height: 32, width: 80 });
    panel.setSelection(selectionOf(a));
    (panel as unknown as { setScope: (s: string) => void }).setScope(".btn");

    panel.recordOn(a, "padding-top", "32px");

    expect(a.style.getPropertyValue("padding-top")).toBe("32px");
    expect(b.style.getPropertyValue("padding-top")).toBe("32px");
    // Not an element outside the scope.
    expect(other.style.getPropertyValue("padding-top")).toBe("");
    // And only the selection is in the payload — one scoped target, as before.
    expect(h.changeSet.targets()).toHaveLength(1);
    expect(h.changeSet.targets()[0].scope).toBe(".btn");

    panel.discard();
    expect(b.style.getPropertyValue("padding-top")).toBe("");
    panel.destroy();
  });
});

describe("inherited values", () => {
  beforeEach(resetDocument);

  it("marks a value the element does not declare", () => {
    /*
     * Every control seeds from computed style, which folds in inheritance — so a <p>
     * inside an uppercase container showed Uppercase as though the paragraph had said so,
     * and committing anything pinned a fresh declaration onto the child. The only place
     * that knew the difference was the CSS pane's origin badge, which the Design tab
     * never saw.
     */
    styleSheet(".shout { letter-spacing: 2px }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const box = mount("div", { class: "shout" });
    const text = mount("p", { parent: box, text: "hi" });
    sizeOf(text, { height: 20, width: 100 });
    panel.setSelection(selectionOf(text));

    const marked = panel.element.querySelectorAll("[data-inherited]");
    expect(marked.length).toBeGreaterThan(0);
    // And it names where the value came from.
    const tip = (marked[0] as HTMLElement).dataset.tip ?? "";
    expect(tip).toContain("div.shout");
    panel.destroy();
  });

  it("does not mark a value the element declares itself", () => {
    styleSheet(".shout { letter-spacing: 2px }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const box = mount("div", { class: "shout" });
    const text = mount("p", {
      parent: box,
      style: "letter-spacing: 4px",
      text: "hi",
    });
    sizeOf(text, { height: 20, width: 100 });
    panel.setSelection(selectionOf(text));

    const tips = Array.from(
      panel.element.querySelectorAll("[data-inherited]")
    ).map((n) => (n as HTMLElement).dataset.tip ?? "");
    expect(tips.join(" ")).not.toContain("Letter");
    panel.destroy();
  });

  it("does not mark a property that cannot inherit", () => {
    // An undeclared padding is 0px because that is its initial value, not because
    // anything inherited it.
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const box = mount("div", { style: "padding: 16px" });
    const child = mount("div", { parent: box });
    sizeOf(child, { height: 20, width: 100 });
    panel.setSelection(selectionOf(child));

    const tips = Array.from(
      panel.element.querySelectorAll("[data-inherited]")
    ).map((n) => (n as HTMLElement).dataset.tip ?? "");
    expect(tips.join(" ")).not.toContain("padding");
    panel.destroy();
  });
});

describe("border width cells", () => {
  beforeEach(resetDocument);

  /**
   * One box-model cell. Its accessible name is the property itself — the diagram is
   * the label, and a glyph inside a 40px cell would not fit (css-box-model.ts).
   */
  function cell(panel: DesignPanel, property: string): HTMLInputElement | null {
    return panel.element.querySelector(`input[aria-label="${property}"]`);
  }

  function boxPanel() {
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div");
    sizeOf(node, { height: 40, width: 100 });
    panel.setSelection(selectionOf(node));
    (panel as unknown as { tab: string }).tab = "css";
    panel.refresh();
    return { ...h, node, panel };
  }

  it("pairs a keyword width with a border-style", () => {
    /*
     * The paired `border-style: solid` write was gated on `parseFloat(value) > 0`, which is
     * NaN for every keyword — so typing `thin` queued `border-top-width: thin` with the
     * style still `none`, previewed it as though it had worked, and shipped it. Nothing
     * rendered and nothing said why.
     */
    const { changeSet, node, panel } = boxPanel();
    const field = cell(panel, "border-top-width");
    expect(field).not.toBeNull();
    if (field) {
      field.value = "thin";
      field.dispatchEvent(new Event("blur"));
    }

    const properties = changeSet
      .previewedProperties(node)
      .sort((a, b) => a.localeCompare(b));
    expect(properties).toContain("border-top-width");
    expect(properties).toContain("border-top-style");
    panel.destroy();
  });

  it("does not offer a percentage, which is not a line-width", () => {
    // `%` was in the unit list, so `50%` was accepted and sent to the agent for a property
    // where the browser simply drops it.
    const { changeSet, node, panel } = boxPanel();
    const field = cell(panel, "border-top-width");
    if (field) {
      field.value = "50%";
      field.dispatchEvent(new Event("blur"));
    }
    expect(changeSet.previewedProperties(node)).not.toContain(
      "border-top-width"
    );
    panel.destroy();
  });

  it("still pairs a numeric width", () => {
    const { changeSet, node, panel } = boxPanel();
    const field = cell(panel, "border-top-width");
    if (field) {
      field.value = "2";
      field.dispatchEvent(new Event("blur"));
    }
    expect(changeSet.previewedProperties(node)).toContain("border-top-style");
    panel.destroy();
  });
});
