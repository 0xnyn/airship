import { beforeEach, describe, expect, it } from "vitest";
import { DesignPanel } from "./panel";
import {
  contextOf,
  harness,
  mount,
  resetDocument,
  ruleTree,
  selectionOf,
  sizeOf,
  styleSheet,
} from "./test-support";

/*
 * The harness's own tests.
 *
 * A test-support module that cannot actually boot the thing it supports is worse
 * than none, because every suite built on it fails for reasons that look like
 * product bugs. So this file proves the three things Phases 2–7 rest on: a
 * `DesignPanel` constructs and renders, a selection round-trips through it, and
 * the synthetic CSSOM is shaped the way the stylesheet walkers expect.
 */

describe("harness", () => {
  beforeEach(resetDocument);

  it("constructs a DesignPanel and gives it an element", () => {
    const { deps } = harness();
    const panel = new DesignPanel(deps);
    expect(panel.element.tagName).toBe("DIV");
    panel.destroy();
  });

  it("adds every piece of chrome the panel and its reorder controller own", () => {
    const { deps, spy } = harness();
    const panel = new DesignPanel(deps);
    // Six: `DragReorderController` adds its box, line, proxy and sentinel
    // (`reorder.ts`), and the panel adds the two tree drop indicators. Asserted
    // exactly rather than loosely, because a piece of chrome that stops being
    // registered is chrome that can never be drawn.
    expect(spy.added).toHaveLength(6);
    panel.destroy();
  });

  it("renders a body for a selected element", () => {
    const { deps } = harness();
    const panel = new DesignPanel(deps);
    const node = mount("button", { class: "btn", text: "Go" });
    sizeOf(node, { height: 32, width: 80 });

    panel.setSelection(selectionOf(node));

    // Something was built. The specific sections are each phase's business; what
    // matters here is that the render path completes without a live frame.
    expect(panel.element.textContent).not.toBe("");
    panel.destroy();
  });

  it("records a declaration against the real change set", () => {
    const { changeSet, deps } = harness();
    const panel = new DesignPanel(deps);
    const node = mount("button", { class: "btn" });
    sizeOf(node, { height: 32, width: 80 });
    panel.setSelection(selectionOf(node));

    panel.recordOn(node, "padding-top", "32px");

    expect(changeSet.count()).toBe(1);
    expect(node.style.getPropertyValue("padding-top")).toBe("32px");
    panel.destroy();
  });

  it("counts outline redraws, so a test can assert the panel repinned chrome", () => {
    const { deps, spy } = harness();
    const panel = new DesignPanel(deps);
    const node = mount("div");
    sizeOf(node, { height: 10, width: 10 });
    panel.setSelection(selectionOf(node));
    panel.recordOn(node, "padding-top", "8px");
    const before = spy.outlines;

    // `recordOn` is the low-level single write and deliberately does not repin —
    // `write()` does that once per gesture, however many nodes it touched. So the
    // public path that redraws is a discard.
    panel.discardOneStyle(node, "padding-top");

    expect(spy.outlines).toBeGreaterThan(before);
    // And the preview came off with it.
    expect(node.style.getPropertyValue("padding-top")).toBe("");
    panel.destroy();
  });

  it("gives a node a measurable box that happy-dom would report as zero", () => {
    const node = mount("div");
    expect(node.getBoundingClientRect().width).toBe(0);
    sizeOf(node, { height: 40, left: 5, top: 6, width: 120 });
    const rect = node.getBoundingClientRect();
    expect([rect.width, rect.height, rect.left, rect.top]).toEqual([
      120, 40, 5, 6,
    ]);
    // Independent per node, which the multi-selection cases rely on.
    const other = mount("div");
    expect(other.getBoundingClientRect().width).toBe(0);
  });

  it("derives an element context the way extract would", () => {
    const node = mount("button", { class: "btn primary", text: "Save" });
    expect(contextOf(node)).toEqual({
      classes: ["btn", "primary"],
      displayName: "button",
      tagName: "button",
      textPreview: "Save",
    });
  });
});

describe("styleSheet", () => {
  beforeEach(resetDocument);

  it("parses a flat rule, which is what the state path needs", () => {
    styleSheet(".btn:hover { color: blue; }");
    const rules = Array.from(document.styleSheets[0].cssRules);
    expect(rules).toHaveLength(1);
  });

  it("documents happy-dom's two gaps, so nobody tests nesting through it", () => {
    styleSheet(
      ".card { color: #333; &:hover { color: #000 } } @layer a { .l { left: 0 } }"
    );
    const rules = Array.from(
      document.styleSheets[0].cssRules
    ) as CSSStyleRule[];
    // Native nesting: the child is not parsed.
    expect(
      (rules[0] as unknown as { cssRules?: CSSRuleList }).cssRules?.length
    ).toBeFalsy();
    // `@layer` is dropped outright — one rule, not two.
    expect(rules).toHaveLength(1);
  });
});

describe("ruleTree", () => {
  it("shapes a style rule the way the walkers duck-type it", () => {
    const list = ruleTree([{ decls: { color: "red" }, selector: ".a" }]);
    const rule = list[0] as unknown as CSSStyleRule;
    expect(typeof rule.selectorText).toBe("string");
    expect(rule.style.getPropertyValue("color")).toBe("red");
    expect(Array.from(rule.style)).toEqual(["color"]);
  });

  it("carries !important as a priority, not as part of the value", () => {
    const list = ruleTree([
      { decls: { color: "red !", "font-size": "10px" }, selector: ".a" },
    ]);
    const { style } = list[0] as unknown as CSSStyleRule;
    expect(style.getPropertyValue("color")).toBe("red");
    expect(style.getPropertyPriority("color")).toBe("important");
    expect(style.getPropertyPriority("font-size")).toBe("");
  });

  it("expresses native nesting — both selectorText and cssRules on one rule", () => {
    const list = ruleTree([
      {
        children: [{ decls: { color: "#000" }, selector: "&:hover" }],
        decls: { color: "#333" },
        selector: ".card",
      },
    ]);
    const rule = list[0] as unknown as CSSStyleRule & { cssRules: CSSRuleList };
    // The shape the old `!("selectorText" in rule)` group test rejected.
    expect(typeof rule.selectorText).toBe("string");
    expect(rule.cssRules.length).toBe(1);
  });

  it("expresses @media, @layer and @container groups", () => {
    const list = ruleTree([
      {
        children: [{ decls: { top: "1px" }, selector: ".m" }],
        mediaText: "(min-width: 1024px)",
      },
      { children: [{ selector: ".l" }], layerName: "utilities" },
      { children: [{ selector: ".c" }], containerQuery: "(min-width: 600px)" },
    ]);
    expect(list.length).toBe(3);
    const media = list[0] as unknown as { media: { mediaText: string } };
    expect(media.media.mediaText).toBe("(min-width: 1024px)");
    const layer = list[1] as unknown as { name: string };
    expect(layer.name).toBe("utilities");
    const container = list[2] as unknown as { containerQuery: string };
    expect(container.containerQuery).toBe("(min-width: 600px)");
    // A group carries no selector, which is how the walkers tell it apart.
    expect(
      (list[0] as unknown as { selectorText?: string }).selectorText
    ).toBeUndefined();
  });

  it("is iterable and array-like, which is all Array.from needs", () => {
    const list = ruleTree([{ selector: ".a" }, { selector: ".b" }]);
    expect(Array.from(list)).toHaveLength(2);
    expect(list.length).toBe(2);
    expect(list.item(1)).toBeTruthy();
    expect(list.item(9)).toBeNull();
  });
});
