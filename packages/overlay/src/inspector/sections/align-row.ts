import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { type AlignAction, planAlign } from "../align";
import type { SectionContext } from "./context";

export function renderAlignRow(
  ctx: SectionContext,
  node: Element
): HTMLElement {
  const cell = (
    action: AlignAction,
    iconName: IconName,
    label: string
  ): HTMLElement => {
    const plan = planAlign(node, action);
    const tip = plan?.note ? `${label}. ${plan.note}` : label;
    const btn = el("button", {
      "aria-label": label,
      class: cls("align-btn"),
      "data-tip": tip,
      onClick: () => applyAlign(ctx, node, action),
      type: "button",
    });
    btn.append(icon(iconName, "sm"));
    if (!plan) {
      (btn as HTMLButtonElement).disabled = true;
    } else if (plan.target === "parent") {
      // Marked so the row shows, before you click, which buttons reach past
      // the selection. A vector canvas never has to do this; a DOM editor does.
      btn.dataset.scope = "parent";
    }
    return btn;
  };

  return el("div", { class: cls("align-row") }, [
    el("div", { class: cls("align-grp") }, [
      cell("left", "align-left", "Align left"),
      cell("h-center", "align-h-center", "Align horizontal centre"),
      cell("right", "align-right", "Align right"),
    ]),
    el("div", { class: cls("align-grp") }, [
      cell("top", "align-top", "Align top"),
      cell("v-center", "align-v-center", "Align vertical centre"),
      cell("bottom", "align-bottom", "Align bottom"),
    ]),
    el("div", { class: cls("align-grp") }, [
      cell("distribute-h", "distribute-h", "Distribute horizontally"),
      cell("distribute-v", "distribute-v", "Distribute vertically"),
      cell("tidy", "tidy-up", "Tidy up"),
    ]),
  ]);
}

function applyAlign(
  ctx: SectionContext,
  node: Element,
  action: AlignAction
): void {
  const plan = planAlign(node, action);
  if (!plan) {
    return;
  }
  const target = plan.target === "parent" ? node.parentElement : node;
  if (!target) {
    return;
  }
  /*
   * One click, one undo step.
   *
   * `recordOn` journals each declaration on its own, and an unbatched
   * `history.push` commits immediately — so a plan's declarations became that
   * many separate entries on the undo stack. Most buttons here write one and
   * were fine by accident; Tidy up writes `display`, `flex-direction`, `gap`
   * and `align-items`, so taking it back took four presses, each reverting a
   * quarter of the layout.
   *
   * Deliberately *not* `writeOn`, which is the other way to get a bracket.
   * `writeOn` also passes `standIn`'s question — whose scope and state does this
   * belong to — and the answer here is "not the selection's": a flex parent is a
   * different element being edited on the selection's behalf, not a stand-in for
   * it. `RecordOpts.standIn` spells that distinction out. A bare bracket is what
   * this needs and all it needs.
   */
  ctx.batch(() => {
    for (const { property, value } of plan.decls) {
      ctx.recordOn(target, property, value);
    }
  });
  if (plan.target === "parent") {
    ctx.flash(target);
  }
  ctx.redrawOutline();
  // Alignment can change what every other control reads (a flex parent gains
  // a justify-content, the element gains an align-self), so re-seed them —
  // and rebuild only if it changed the panel's shape, which `refresh` decides.
  ctx.refresh();
}
