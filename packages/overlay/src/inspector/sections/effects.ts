import { cls, el } from "../../dom";
import { createShadowList } from "../paint";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";

/**
 * Effects — `box-shadow`, and only `box-shadow`.
 *
 * Layer blur and background blur used to live here as two bespoke fields,
 * because there was no filter list to put them in. There is one now, and they
 * have moved: they were always `filter: blur()` wearing a shadow section's
 * clothes, and having two controls write the same `filter` property from
 * different models is how they end up disagreeing about what is in it.
 *
 * A drop shadow that follows the alpha channel rather than the box is also a
 * filter, and is in that section too.
 */
export function renderEffects(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  // `ctx.gestures` is what makes a shadow edit coalesce — without it a scrub of
  // one of the four offsets is an undo step per pointermove.
  const shadows = createShadowList(
    readValue(node, "box-shadow"),
    ctx.onChange,
    ctx.gestures
  );
  /*
   * A shadow scale is a real token category and had no picker at all.
   *
   * Bound, the token names the *whole stack* — `box-shadow` is one property
   * holding a comma-separated list, and a token stands for all of it. So the
   * layers are replaced by the token's name rather than left editable
   * underneath a lit badge, which is what shipped: the slot was computed and
   * never applied, so the badge asserted a binding the list immediately
   * contradicted, and adding a layer silently forked the value from it.
   */
  const slot = ctx.tokenSlot(node, ["box-shadow"]);
  const bound = Boolean(slot?.bound && slot.label);
  /*
   * Registered only when it is actually mounted.
   *
   * `ctx.register(shadows)` ran unconditionally, above, while the element is appended
   * only in the unbound branch — so a `box-shadow`-bound element left the panel holding
   * a registered row list against detached DOM for the life of the render, and every
   * re-seed wrote into it. Registering beside the append is what keeps the two in step.
   */
  if (bound) {
    shadows.destroy?.();
    body.append(
      el("div", { class: `${cls("ctl-num")} ${cls("bound-value")}` }, [
        el("span", { class: cls("ctl-glyph") }),
        el("span", { class: cls("ctl-input"), text: slot?.label ?? "" }),
      ])
    );
  } else {
    ctx.register(shadows);
    body.append(shadows.element);
  }

  /*
   * The badge goes in the section header, not beside the list.
   *
   * It was in a `token-cell` wrapping the whole list — and a `token-cell`
   * centres its 20px badge against its first child, which here is every shadow
   * in the stack. With one shadow that put it 57px down, level with the
   * offsets; with two it landed in the 6px of whitespace *between* the rows,
   * annotating neither. The scope was never one row anyway: `box-shadow` is a
   * single property holding a comma-separated list, so a token stands for the
   * whole of it — which is the section, and the section already has a bar for
   * exactly this (`.sect-act`'s `flex: 0 0 auto` exists because the computed
   * sub-head needed one there first).
   */
  return ctx.section("effects", "Effects", body, {
    actions: [
      ...(slot ? [slot.element] : []),
      // Adding a layer to a bound stack would fork it from the token without
      // saying so. Detach first, through the badge.
      ...(bound
        ? []
        : [ctx.headerAction("plus", "Add shadow", () => shadows.add())]),
    ],
  });
}
