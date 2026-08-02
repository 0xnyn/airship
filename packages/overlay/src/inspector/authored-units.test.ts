import { beforeEach, describe, expect, it } from "vitest";
import { fromPx, toPx } from "./css-length";
import { seedFilterValue } from "./filters";
import { DesignPanel } from "./panel";
import { declaredValue, layoutSize, resizeMode } from "./sizing";
import {
  harness,
  mount,
  resetDocument,
  selectionOf,
  sizeOf,
  styleSheet,
} from "./test-support";

/*
 * Computed-versus-authored.
 *
 * The panel seeds every length control from `getComputedStyle`, which is always a
 * resolved px value. That is right for *display* and wrong for three other jobs, and
 * each of them was silently corrupting the stylesheet:
 *
 *  - deciding which sizing mode an element is in (`resizeMode`),
 *  - deciding which sides a constraint pins (`inferAnchor`),
 *  - and writing a value back (`keepAuthoredUnit`).
 */

describe("declaredValue", () => {
  beforeEach(resetDocument);

  it("reads a value out of a stylesheet, not just the style attribute", () => {
    styleSheet(".w80 { width: 320px }");
    const node = mount("div", { class: "w80" });
    expect(declaredValue(node, "width")).toBe("320px");
  });

  it("prefers the inline style, as the cascade does", () => {
    styleSheet(".w80 { width: 320px }");
    const node = mount("div", { class: "w80", style: "width: 100px" });
    expect(declaredValue(node, "width")).toBe("100px");
  });

  it("is empty when nothing declares the property", () => {
    expect(declaredValue(mount("div"), "width")).toBe("");
  });
});

describe("resizeMode", () => {
  beforeEach(resetDocument);

  it("reports Fixed for a class-sized element", () => {
    /*
     * It read only the *inline* style, so for a class-sized element the value was ""
     * and `HAS_DIGIT.test("")` was false — every one of them reported Hug. A
     * `<div class="w-80">` showed the word `Hug` in the W field, and clicking Hug then
     * wrote `width: max-content` and collapsed the card. Since almost nothing is sized
     * inline, that was almost every element.
     */
    styleSheet(".w80 { width: 320px }");
    const node = mount("div", { class: "w80" });
    expect(resizeMode(node, "w")).toBe("fixed");
  });

  it("still reports Hug for a keyword size", () => {
    styleSheet(".hug { width: max-content }");
    const node = mount("div", { class: "hug" });
    expect(resizeMode(node, "w")).toBe("hug");
  });

  it("reports Hug when nothing declares a width", () => {
    expect(resizeMode(mount("div"), "w")).toBe("hug");
  });
});

describe("layoutSize", () => {
  beforeEach(resetDocument);

  it("subtracts padding and border on a content-box element", () => {
    /*
     * `width` is the content box unless the element is `border-box`, and the rect is
     * the border box. Clicking Fixed on a padded `content-box` div wrote the border
     * box as `width`, so the element grew by its own padding and jumped out from
     * under the cursor.
     */
    const node = mount("div", {
      style: "box-sizing: content-box; padding: 16px; border: 1px solid red",
    });
    sizeOf(node, { height: 100, width: 332 });
    // 332 - (16 + 16) - (1 + 1)
    expect(layoutSize(node, "w")).toBe(298);
  });

  it("uses the border box as-is when the element is border-box", () => {
    const node = mount("div", {
      style: "box-sizing: border-box; padding: 16px",
    });
    sizeOf(node, { height: 100, width: 332 });
    expect(layoutSize(node, "w")).toBe(332);
  });

  it("never goes negative", () => {
    const node = mount("div", {
      style: "box-sizing: content-box; padding: 100px",
    });
    sizeOf(node, { height: 10, width: 10 });
    expect(layoutSize(node, "w")).toBe(0);
  });
});

describe("fromPx", () => {
  it("inverts toPx for rem", () => {
    // The root font size in happy-dom is the 16px default.
    expect(toPx("2rem")).toBe(32);
    expect(fromPx(32, "rem")).toBe("2rem");
  });

  it("keeps px and unitless values as themselves", () => {
    expect(fromPx(33, "px")).toBe("33px");
    expect(fromPx(1.5, "")).toBe("1.5");
  });

  it("rounds to something a human would have typed", () => {
    expect(fromPx(33, "rem")).toBe("2.0625rem");
  });

  it("refuses a unit it cannot invert without a basis", () => {
    // A percentage's basis depends on the property, so converting blind would trade
    // a visible unit change for an invisible wrong number.
    expect(fromPx(660, "%")).toBeNull();
    expect(fromPx(100, "vw")).toBeNull();
  });

  it("inverts a percentage when the caller supplies the basis", () => {
    expect(fromPx(660, "%", undefined, 1320)).toBe("50%");
  });

  it("refuses a non-finite input", () => {
    expect(fromPx(Number.POSITIVE_INFINITY, "rem")).toBeNull();
    expect(fromPx(Number.NaN, "rem")).toBeNull();
  });
});

describe("writing back in the authored unit", () => {
  beforeEach(resetDocument);

  it("keeps rem when the element was authored in rem", () => {
    styleSheet(".hero { padding-left: 2rem }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div", { class: "hero" });
    sizeOf(node, { height: 10, width: 10 });
    panel.setSelection(selectionOf(node));

    // What a nudge does: the field shows 32, the arrow key commits 33px.
    panel.recordOn(node, "padding-left", "33px");

    const [{ to }] = h.changeSet.targets()[0].changes;
    expect(to).toBe("2.0625rem");
    panel.destroy();
  });

  it("leaves px alone when the element was authored in px", () => {
    styleSheet(".card { padding-left: 32px }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div", { class: "card" });
    sizeOf(node, { height: 10, width: 10 });
    panel.setSelection(selectionOf(node));

    panel.recordOn(node, "padding-left", "33px");

    expect(h.changeSet.targets()[0].changes[0].to).toBe("33px");
    panel.destroy();
  });

  it("passes a unit the user typed through untouched", () => {
    // `50%` in a px field is a deliberate act, and is not ours to reinterpret.
    styleSheet(".hero { padding-left: 2rem }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div", { class: "hero" });
    sizeOf(node, { height: 10, width: 10 });
    panel.setSelection(selectionOf(node));

    panel.recordOn(node, "padding-left", "50%");

    expect(h.changeSet.targets()[0].changes[0].to).toBe("50%");
    panel.destroy();
  });

  it("leaves a percentage-authored value in px rather than guessing a basis", () => {
    styleSheet(".fluid { width: 50% }");
    const h = harness();
    const panel = new DesignPanel(h.deps);
    const node = mount("div", { class: "fluid" });
    sizeOf(node, { height: 10, width: 660 });
    panel.setSelection(selectionOf(node));

    panel.recordOn(node, "width", "661px");

    expect(h.changeSet.targets()[0].changes[0].to).toBe("661px");
    panel.destroy();
  });
});

describe("seedFilterValue", () => {
  it("scales a computed ratio into the field's percent unit", () => {
    /*
     * Every engine computes `brightness(120%)` to `brightness(1.2)`, and the field is
     * configured in `%` — so the bare `1.2` arrived and `commit` re-attached the
     * field's default unit, producing `brightness(1.2%)`: a 98.8% darkening, from
     * focusing the field and tabbing away without typing.
     */
    expect(seedFilterValue("brightness", "1.2")).toBe("120%");
    expect(seedFilterValue("opacity", "0.5")).toBe("50%");
    expect(seedFilterValue("saturate", "0")).toBe("0%");
  });

  it("leaves an authored percentage verbatim", () => {
    expect(seedFilterValue("brightness", "120%")).toBe("120%");
  });

  it("leaves the non-ratio filters alone", () => {
    expect(seedFilterValue("blur", "4px")).toBe("4px");
    expect(seedFilterValue("hue-rotate", "90deg")).toBe("90deg");
  });

  it("does not touch a value it cannot read as a bare number", () => {
    expect(seedFilterValue("brightness", "var(--dim)")).toBe("var(--dim)");
    expect(seedFilterValue("brightness", "calc(1 + 0.2)")).toBe(
      "calc(1 + 0.2)"
    );
  });
});
