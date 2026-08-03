import { describe, expect, it } from "vitest";
import { cls, el } from "../../dom";
import { labelled } from "./row";

/*
 * The shape three files now agree on.
 *
 * `labelled` was single-control, and the callers that needed a second box each
 * went around it: `fieldCell` wrote the whole row out by hand to fit a token
 * badge after the control, and Text's Case row wanted its overflow menu beside
 * the case group. Both call the helper now, so the order of the children is a
 * contract rather than an implementation detail — a badge or a menu button that
 * landed *before* the control would put the affordance where the value goes,
 * and nothing else in the panel would catch it.
 */

const control = (): HTMLElement => el("div", { class: cls("ctl-seg") });

describe("labelled", () => {
  it("wraps one control in a full-width labelled row", () => {
    const ctl = control();
    const row = labelled("Weight", ctl);

    expect(row.tagName).toBe("DIV");
    expect(row.className).toBe(`${cls("row")} ${cls("span2")}`);
    expect(row.children).toHaveLength(2);
    expect(row.children[1]).toBe(ctl);
  });

  it("puts the name on the rail, and only the name", () => {
    const [label] = labelled("Blend mode", control()).children;

    expect(label.tagName).toBe("SPAN");
    expect(label.className).toBe(cls("row-label"));
    expect(label.textContent).toBe("Blend mode");
  });

  it("keeps trailing affordances after the control, in order", () => {
    const ctl = control();
    const badge = el("button", { class: cls("row-icon") });
    const row = labelled("Case", ctl, badge);

    expect([...row.children].map((child) => child.className)).toEqual([
      cls("row-label"),
      cls("ctl-seg"),
      cls("row-icon"),
    ]);
    expect(row.children[1]).toBe(ctl);
    expect(row.children[2]).toBe(badge);
  });

  it("is a bare label row when there is nothing to put in it", () => {
    // `fieldCell` spreads `...(badge ? [badge] : [])`, so the no-badge case
    // reaches here as zero extra controls rather than as an `undefined` child.
    const row = labelled("Align");

    expect(row.children).toHaveLength(1);
    expect(row.textContent).toBe("Align");
  });
});
