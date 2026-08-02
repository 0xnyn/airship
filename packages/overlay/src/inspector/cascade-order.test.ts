import { beforeEach, describe, expect, it } from "vitest";
import {
  availableStates,
  expandShorthands,
  pseudoDecls,
  stripStates,
} from "./cascade";
import { matchedRules } from "./css-rules";
import { installRules, mount, resetDocument, styleSheet } from "./test-support";

/*
 * The cascade, end to end through the real `matchedRules`.
 *
 * `installRules` puts a synthetic rule tree in `adoptedStyleSheets`, which is what lets
 * these exercise the actual scan against rules happy-dom's CSS parser cannot produce:
 * native nesting, `@layer`, `@import`.
 */

/** The winning declaration for a property, as `winningDeclaration` finds it. */
function winner(node: Element, property: string): string | null {
  for (const rule of matchedRules(node).rules) {
    for (const decl of rule.decls) {
      if (decl.property === property && !decl.overridden) {
        return decl.value;
      }
    }
  }
  return null;
}

describe("!important is per declaration, not per rule", () => {
  beforeEach(resetDocument);

  it("does not let one important declaration carry its rule's others", () => {
    /*
     * `byCascade` promoted a whole rule above every non-important one if *any* of its
     * declarations carried `!important`. So `.title`'s `font-size: 12px` beat `#hero`'s
     * `32px`, which is backwards — and because `winningDeclaration` reads "the first
     * non-overridden declaration", the token badge then named a token from the losing
     * rule and shipped it to the agent as `reference`-grade evidence.
     */
    installRules([
      { decls: { color: "red", "font-size": "32px" }, selector: "#hero" },
      {
        decls: { color: "blue !", "font-size": "12px" },
        selector: ".title",
      },
    ]);
    const node = mount("h1", { class: "title" });
    node.id = "hero";

    // The important colour wins, as it must.
    expect(winner(node, "color")).toBe("blue");
    // The font-size is decided on specificity alone: the ID beats the class.
    expect(winner(node, "font-size")).toBe("32px");
  });

  it("prefers important over a more specific normal declaration", () => {
    installRules([
      { decls: { color: "red !" }, selector: ".low" },
      { decls: { color: "blue" }, selector: "#high" },
    ]);
    const node = mount("div", { class: "low" });
    node.id = "high";
    expect(winner(node, "color")).toBe("red");
  });
});

describe("@layer precedence", () => {
  beforeEach(resetDocument);

  it("lets a later layer win for normal declarations", () => {
    /*
     * `@layer` was rendered as a condition label and then ignored by the sort. Real
     * CSS: utilities wins. The pane struck through `.text-black` — the exact inverse,
     * on the one view whose whole purpose is provenance.
     */
    installRules([
      {
        children: [{ decls: { color: "red" }, selector: "#app h1" }],
        layerName: "base",
      },
      {
        children: [{ decls: { color: "#000" }, selector: ".text-black" }],
        layerName: "utilities",
      },
    ]);
    const app = mount("div");
    app.id = "app";
    const node = mount("h1", { class: "text-black", parent: app });
    expect(winner(node, "color")).toBe("#000");
  });

  it("lets an unlayered declaration beat every layer", () => {
    installRules([
      {
        children: [{ decls: { color: "#000" }, selector: "#app .x" }],
        layerName: "utilities",
      },
      { decls: { color: "green" }, selector: ".x" },
    ]);
    const app = mount("div");
    app.id = "app";
    const node = mount("p", { class: "x", parent: app });
    expect(winner(node, "color")).toBe("green");
  });

  it("inverts for important: an earlier layer wins", () => {
    // The spec's own inversion — for important declarations, layer order reverses.
    installRules([
      {
        children: [{ decls: { color: "red !" }, selector: ".x" }],
        layerName: "base",
      },
      {
        children: [{ decls: { color: "blue !" }, selector: ".x" }],
        layerName: "utilities",
      },
    ]);
    const node = mount("p", { class: "x" });
    expect(winner(node, "color")).toBe("red");
  });
});

describe("native nesting and @import", () => {
  beforeEach(resetDocument);

  it("finds a declaration inside a nested rule", () => {
    installRules([
      {
        children: [{ decls: { color: "#000" }, selector: "& .title" }],
        decls: { color: "#333" },
        selector: ".card",
      },
    ]);
    const card = mount("div", { class: "card" });
    const title = mount("span", { class: "title", parent: card });
    expect(winner(title, "color")).toBe("#000");
    expect(winner(card, "color")).toBe("#333");
  });

  it("reports the nested rule's resolved selector", () => {
    installRules([
      {
        children: [{ decls: { color: "#000" }, selector: "& .title" }],
        selector: ".card",
      },
    ]);
    const card = mount("div", { class: "card" });
    const title = mount("span", { class: "title", parent: card });
    expect(matchedRules(title).rules[0].selector).toBe(".card .title");
  });

  it("follows an @import", () => {
    // The rules hang off `styleSheet`, not `cssRules`, so the rule was neither a group
    // nor a style rule and was skipped without a trace — and a project whose
    // `index.css` is one `@import` line reported no matching rules for anything.
    installRules([
      { imports: [{ decls: { color: "teal" }, selector: ".imported" }] },
    ]);
    const node = mount("p", { class: "imported" });
    expect(winner(node, "color")).toBe("teal");
  });
});

describe("state discovery", () => {
  beforeEach(resetDocument);

  it("strips the longest state spelling first", () => {
    /*
     * Alternation is leftmost-first and `PSEUDO_STATES` lists `:focus` before
     * `:focus-visible`, so `.btn:focus-visible` became `.btn-visible` — which nothing
     * matches, so every `:focus-visible` rule was discarded and the state previewed
     * nothing. Tailwind's default button ring is exactly this case.
     */
    expect(stripStates(".btn:focus-visible")).toBe(".btn");
    expect(stripStates(".btn:focus-within")).toBe(".btn");
    expect(stripStates(".btn:hover")).toBe(".btn");
  });

  it("previews a :focus-visible rule", () => {
    styleSheet(".btn:focus-visible { color: blue }");
    const node = mount("button", { class: "btn" });
    expect(pseudoDecls(node, ":focus-visible").get("color")).toBe("blue");
  });

  it("offers only the states that apply to this element", () => {
    /*
     * It asked for *every rule in the document* and tested `includes(state)`, so the
     * element was never consulted: on any Tailwind page every element offered all six
     * states, each previewing nothing — the "five dead toggles" the function's own
     * docstring says it exists to prevent.
     */
    styleSheet(".btn:hover { color: blue } .other:active { color: red }");
    const node = mount("button", { class: "btn" });
    expect(availableStates(node)).toEqual([":hover"]);
  });

  it("does not confuse :focus with :focus-visible", () => {
    styleSheet(".btn:focus-visible { outline: 1px solid red }");
    const node = mount("button", { class: "btn" });
    expect(availableStates(node)).toEqual([":focus-visible"]);
  });

  it("offers nothing for an element with no interaction styling", () => {
    styleSheet(".btn:hover { color: blue }");
    expect(availableStates(mount("div"))).toEqual([]);
  });

  it("ignores a @media block that does not apply to this frame", () => {
    /*
     * The module header claims state handling inherits `matchedRules`' realm-awareness
     * "for free". It did not — this path recursed into every grouping rule blindly, so
     * in a 375px frame entering `:hover` previewed the desktop-only rule and shipped it
     * as the mobile hover style.
     */
    installRules([
      {
        children: [{ decls: { background: "#000" }, selector: ".btn:hover" }],
        mediaText: "(min-width: 99999px)",
      },
    ]);
    const node = mount("button", { class: "btn" });
    expect(pseudoDecls(node, ":hover").has("background")).toBe(false);
    expect(availableStates(node)).toEqual([]);
  });

  it("finds a nested :hover rule", () => {
    installRules([
      {
        children: [{ decls: { color: "#000" }, selector: "&:hover" }],
        selector: ".card",
      },
    ]);
    const node = mount("div", { class: "card" });
    expect(availableStates(node)).toEqual([":hover"]);
    expect(pseudoDecls(node, ":hover").get("color")).toBe("#000");
  });
});

describe("expandShorthands", () => {
  it("splits a box shorthand paren-aware", () => {
    /*
     * `.split(/\s+/)` turned `calc(1rem + 2px) 8px` into four "values", every one of
     * which was written to the live DOM as an `!important` inline preview.
     */
    const out = expandShorthands(
      new Map([["padding", "calc(1rem + 2px) 8px"]])
    );
    expect(out.get("padding-top")).toBe("calc(1rem + 2px)");
    expect(out.get("padding-right")).toBe("8px");
    expect(out.get("padding-bottom")).toBe("calc(1rem + 2px)");
    expect(out.get("padding-left")).toBe("8px");
  });

  it("expands the border shorthand, in any order", () => {
    // The common spelling, and it previewed nothing at all: the panel's controls are
    // longhands and `pseudoDecls` reported the key `border`.
    const out = expandShorthands(new Map([["border", "2px solid #000"]]));
    expect(out.get("border-top-width")).toBe("2px");
    expect(out.get("border-top-style")).toBe("solid");
    expect(out.get("border-top-color")).toBe("#000");
    expect(out.get("border-left-color")).toBe("#000");
    expect(out.has("border")).toBe(false);
  });

  it("expands a one-sided border", () => {
    const out = expandShorthands(
      new Map([["border-bottom", "1px solid #eee"]])
    );
    expect(out.get("border-bottom-width")).toBe("1px");
    expect(out.get("border-top-width")).toBeUndefined();
  });

  it("expands inset and the logical box properties", () => {
    expect(expandShorthands(new Map([["inset", "0 4px"]])).get("right")).toBe(
      "4px"
    );
    const block = expandShorthands(new Map([["padding-block", "8px"]]));
    expect(block.get("padding-top")).toBe("8px");
    expect(block.get("padding-bottom")).toBe("8px");
    expect(block.get("padding-left")).toBeUndefined();
  });

  it("lets an explicit longhand win over the shorthand", () => {
    const out = expandShorthands(
      new Map([
        ["padding", "8px"],
        ["padding-top", "24px"],
      ])
    );
    expect(out.get("padding-top")).toBe("24px");
    expect(out.get("padding-left")).toBe("8px");
  });

  it("keeps border-radius corners clockwise from the top left", () => {
    const out = expandShorthands(
      new Map([["border-radius", "1px 2px 3px 4px"]])
    );
    expect(out.get("border-top-left-radius")).toBe("1px");
    expect(out.get("border-top-right-radius")).toBe("2px");
    expect(out.get("border-bottom-right-radius")).toBe("3px");
    expect(out.get("border-bottom-left-radius")).toBe("4px");
  });
});
