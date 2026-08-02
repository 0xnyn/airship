import { describe, expect, it } from "vitest";
import {
  asGroupingRule,
  asImportRule,
  asStyleRule,
  conditionHolds,
  resolveNested,
  specificity,
  splitSelectorList,
} from "./css-rules";
import { ruleTree } from "./test-support";

/*
 * The stylesheet walker's contract, over a synthetic CSSOM.
 *
 * Not through a real stylesheet, because the two features most of this is about are
 * ones happy-dom's parser does not model: native nesting yields a rule with zero
 * children, and `@layer` blocks are dropped outright. The walkers duck-type their
 * input (`typeof rule.selectorText === "string" && rule.style` for a style rule,
 * `rule.cssRules` for a group), so plain objects are a faithful stand-in — and they
 * are the only way to express these cases at all. The nesting, `@layer` and `@import`
 * fixes keep the manual browser walkthrough as their real gate; these pin the logic.
 */

describe("rule classification", () => {
  it("treats a nested style rule as a style rule, not a group", () => {
    /*
     * Since nesting shipped, a `CSSStyleRule` *is* a `CSSGroupingRule` and carries
     * both `selectorText` and `cssRules`. `asGroupingRule` requires the absence of
     * `selectorText` precisely so this lands in the style-rule branch, which knows to
     * both match it and recurse. Before, it fell down the gap between the two tests
     * and its children were never visited.
     */
    const [rule] = Array.from(
      ruleTree([
        {
          children: [{ decls: { color: "#000" }, selector: "&:hover" }],
          decls: { color: "#333" },
          selector: ".card",
        },
      ])
    );
    expect(asGroupingRule(rule)).toBeNull();
    expect(asStyleRule(rule)).not.toBeNull();
    expect((rule as unknown as { cssRules: CSSRuleList }).cssRules.length).toBe(
      1
    );
  });

  it("recognises a real at-rule group", () => {
    const [rule] = Array.from(
      ruleTree([
        { children: [{ selector: ".m" }], mediaText: "(min-width: 1px)" },
      ])
    );
    expect(asGroupingRule(rule)).not.toBeNull();
    expect(asStyleRule(rule)).toBeNull();
  });

  it("finds an @import's sheet, which is neither a group nor a style rule", () => {
    const imported = { cssRules: ruleTree([{ selector: ".from-import" }]) };
    const rule = { styleSheet: imported } as unknown as CSSRule;
    expect(asGroupingRule(rule)).toBeNull();
    expect(asStyleRule(rule)).toBeNull();
    expect(asImportRule(rule)).toBe(imported);
  });
});

describe("resolveNested", () => {
  it("substitutes the parent for &", () => {
    expect(resolveNested("&:hover", ".card")).toBe(".card:hover");
  });

  it("treats a selector without & as a descendant", () => {
    // CSS nesting's own rule: `.title` inside `.card` means `.card .title`.
    expect(resolveNested(".title", ".card")).toBe(".card .title");
  });

  it("handles & more than once", () => {
    expect(resolveNested("& + &", ".card")).toBe(".card + .card");
  });

  it("wraps a parent list in :is() so the result still parses", () => {
    expect(resolveNested("&:hover", ".a, .b")).toBe(":is(.a, .b):hover");
  });

  it("resolves each part of a nested list", () => {
    expect(resolveNested("&:hover, .title", ".card")).toBe(
      ".card:hover, .card .title"
    );
  });

  it("is the identity at the top level", () => {
    expect(resolveNested(".card", "")).toBe(".card");
  });
});

describe("specificity", () => {
  it("scores the three buckets", () => {
    expect(specificity("#id")).toEqual([1, 0, 0]);
    expect(specificity(".cls")).toEqual([0, 1, 0]);
    expect(specificity("div")).toEqual([0, 0, 1]);
    expect(specificity("#app div.card")).toEqual([1, 1, 1]);
  });

  it("does not count a # inside an attribute value as an ID", () => {
    // `a[href="#pricing"]` scored [1,1,1] and outranked a real `#id` rule.
    expect(specificity('a[href="#pricing"]')).toEqual([0, 1, 1]);
  });

  it("does not count a class inside an attribute value", () => {
    expect(specificity('[data-x=".c"]')).toEqual([0, 1, 0]);
  });

  it("counts :not() once, by its argument", () => {
    // The function name was counted *in addition to* its argument, scoring two.
    expect(specificity(".btn:not(.disabled)")).toEqual([0, 2, 0]);
  });

  it("counts :has() by its argument", () => {
    expect(specificity(".card:has(img)")).toEqual([0, 1, 1]);
  });

  it("gives :where() no weight at all", () => {
    expect(specificity(":where(.a, #b) .c")).toEqual([0, 1, 0]);
  });

  it("scores a pseudo-element as an element, not a class", () => {
    expect(specificity("p::before")).toEqual([0, 0, 2]);
  });

  it("counts a pseudo-class as a class", () => {
    expect(specificity("a:hover")).toEqual([0, 1, 1]);
  });
});

describe("conditionHolds", () => {
  const win = window as unknown as Window;

  it("asks matchMedia for a @media rule", () => {
    const [holds] = Array.from(ruleTree([{ mediaText: "(min-width: 1px)" }]));
    const [fails] = Array.from(
      ruleTree([{ mediaText: "(min-width: 99999px)" }])
    );
    expect(conditionHolds(holds as CSSGroupingRule, win)).toBe(true);
    expect(conditionHolds(fails as CSSGroupingRule, win)).toBe(false);
  });

  it("evaluates a @container query against the nearest container", () => {
    /*
     * A `CSSContainerRule` has neither `mediaText` nor `conditionText` — its query is
     * on `containerQuery`, which nothing consulted, so this fell through to
     * `return true`. The pane asserted that a 600px-min block was a matching, winning
     * declaration on a 300px container, with no condition shown beside it.
     */
    const container = document.createElement("div");
    container.style.setProperty("container-type", "inline-size");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ height: 100, width: 300 }),
    });
    const child = document.createElement("span");
    container.append(child);
    document.body.append(container);

    const [wide] = Array.from(
      ruleTree([{ containerQuery: "(min-width: 600px)" }])
    );
    const [narrow] = Array.from(
      ruleTree([{ containerQuery: "(min-width: 200px)" }])
    );
    expect(conditionHolds(wide as CSSGroupingRule, win, child)).toBe(false);
    expect(conditionHolds(narrow as CSSGroupingRule, win, child)).toBe(true);
    container.remove();
  });

  it("holds a @container query when there is no container to measure", () => {
    // Biased toward showing the rule: a wrong `true` is a rule displayed with its
    // condition beside it, a wrong `false` is provenance that omits the answer.
    const orphan = document.createElement("span");
    const [rule] = Array.from(
      ruleTree([{ containerQuery: "(min-width: 600px)" }])
    );
    expect(conditionHolds(rule as CSSGroupingRule, win, orphan)).toBe(true);
  });

  it("holds for @layer, which changes precedence and not applicability", () => {
    const [rule] = Array.from(ruleTree([{ layerName: "utilities" }]));
    expect(conditionHolds(rule as CSSGroupingRule, win)).toBe(true);
  });
});

describe("splitSelectorList", () => {
  it("keeps commas inside :is() and attribute strings together", () => {
    expect(splitSelectorList(":is(a, b), .c")).toEqual([":is(a, b)", ".c"]);
    expect(splitSelectorList('[data-x=","], .c')).toEqual([
      '[data-x=","]',
      ".c",
    ]);
  });
});
