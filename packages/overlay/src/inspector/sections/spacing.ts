import { cls, el } from "../../dom";
import type { SectionContext } from "./context";

/**
 * Padding and margin, as two groups of the same control.
 *
 * A design tool has no equivalent section and would not want one — its frames space
 * their children with gap and padding and nothing else. This is a DOM editor,
 * though, and margin is half of how web layouts are actually spaced: leaving
 * it reachable only by typing `margin-top` into the CSS tab made the Design
 * tab quietly incomplete on the single most common property after padding.
 *
 * Padding also appears inside Auto layout, beside the alignment pad, because
 * that is where it belongs when you are laying out a flex container. This is
 * the same control reading the same longhands — not a second copy — so the
 * two cannot disagree.
 */
export function renderSpacing(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });
  for (const group of ["padding", "margin"] as const) {
    const control = ctx.spacingControl(node, group);
    ctx.register(control);
    const row = el("div", { class: `${cls("row")} ${cls("group")}` }, [
      el("span", {
        class: cls("row-label"),
        text: group === "padding" ? "Padding" : "Margin",
      }),
      control.element,
    ]);
    body.append(row);
  }
  return ctx.section("spacing", "Spacing", body);
}
