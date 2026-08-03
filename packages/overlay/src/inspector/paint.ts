import { cls, el } from "../dom";
import { type IconName, icon } from "../icons";
import { createMenu } from "../popover-host";
import { createColorRow } from "./controls/color-picker";
import {
  canEditGradient,
  openGradientEditor,
} from "./controls/gradient-editor";
import { createNumField, type NumHandle } from "./controls/num-field";
import { createRowList, type RowListHandle } from "./controls/row-list";
import type { Gestures, OnChange } from "./controls/types";
import {
  blankShadow,
  type Fill,
  formatShadowList,
  parseShadowList,
  type Shadow,
} from "./css-value";

/*
 * The row bodies for Fill, Stroke and Effects.
 *
 * `row-list.ts` owns the list mechanics (eye, minus, add); this owns what sits
 * inside a row. Kept out of `panel.ts` because the panel is already 1,500 lines
 * and none of this needs the panel's state — a row is a pure function of its
 * value and a callback.
 *
 * The `[swatch][hex][alpha]` row that used to live here is now
 * `controls/color-picker.ts`, shared with the Text → Colour descriptor that had
 * grown its own near-copy.
 */

// -- Effects -----------------------------------------------------------------

export type EffectKind = "drop-shadow" | "inner-shadow";

const EFFECT_ICON: Record<EffectKind, IconName> = {
  "drop-shadow": "effect-drop-shadow",
  "inner-shadow": "effect-inner-shadow",
};

const EFFECT_LABEL: Record<EffectKind, string> = {
  "drop-shadow": "Drop shadow",
  "inner-shadow": "Inner shadow",
};

/**
 * One shadow row: a type switch, then X / Y / Blur / Spread and a colour.
 *
 * A design tool puts the four numbers behind a settings popover; here they are inline,
 * because the panel is wider than that and a popover for four numbers you
 * always want to see is a click tax.
 */
export function shadowRow(
  shadow: Shadow,
  onEdit: (next: Shadow) => void,
  gestures?: Gestures,
  onDispose?: (fn: () => void) => void
): HTMLElement {
  let kind: EffectKind = shadow.inset ? "inner-shadow" : "drop-shadow";

  // No `mount` callback any more: the menu's markup goes to the popover host
  // when it opens and is taken away when it closes. Mounting it into the section
  // body meant every re-render of the row list appended another one and removed
  // none, so a few clicks left a stack of dead menus behind the panel.
  const menu = createMenu(
    (["drop-shadow", "inner-shadow"] as const).map((k) => ({
      label: EFFECT_LABEL[k],
      on: k === kind,
      run: () => {
        // The row list commits without re-rendering, so nothing else will
        // repaint this button — picking "Inner shadow" used to change the CSS
        // and leave the drop-shadow glyph sitting there.
        kind = k;
        setKind(k);
        onEdit({ ...shadow, inset: k === "inner-shadow" });
      },
    }))
  );

  /*
   * Named, and wearing a caret.
   *
   * This was a bare 20px glyph — the only dropdown in the panel with no caret at
   * all — sitting alone on a line of its own. A whole row of vertical space
   * spent on an icon you had to hover to identify, above four number fields
   * fighting for 65px each. It costs nothing to say "Drop shadow" on the line
   * that is already there, and the caret is what every other dropdown here uses
   * to admit it opens something.
   */
  const label = el("span", {
    class: cls("effect-kind-label"),
    text: EFFECT_LABEL[kind],
  });
  const type = el(
    "button",
    {
      class: `${cls("row-icon")} ${cls("effect-kind")}`,
      onClick: () => menu.open(type, "below"),
      type: "button",
    },
    [icon(EFFECT_ICON[kind], "sm"), label, icon("caret-down", "xs")]
  );

  function setKind(next: EffectKind): void {
    label.textContent = EFFECT_LABEL[next];
    type.replaceChildren(
      icon(EFFECT_ICON[next], "sm"),
      label,
      icon("caret-down", "xs")
    );
    // No `data-tip`: the button reads "Drop shadow", so the tip said the same
    // words 6px lower, over the offsets.
    type.setAttribute("aria-label", `Effect type: ${EFFECT_LABEL[next]}`);
  }
  setKind(kind);

  /*
   * The four numbers.
   *
   * X, Y and Spread take **no minimum**: a shadow offset up and to the left is
   * the ordinary case, and a negative spread — a shadow smaller than the box it
   * falls from — is a real technique for a tight inner rim. Blur is the only one
   * of the four that cannot be negative.
   *
   * Each of these scrubs, which is the point of routing them through
   * `createNumField`. They sit inside `createRowList`, whose `replace()`
   * deliberately does not re-render, so a drag re-serialises the whole
   * `box-shadow` on every pointermove — the same thing typing already did, only
   * faster — and `gestures` collapses the sweep into one undo step instead of
   * two hundred.
   */
  const nums: NumHandle[] = [];
  const num = (
    glyph: string,
    tip: string,
    key: string,
    value: string,
    signed: boolean,
    set: (v: string) => Shadow
  ): HTMLElement => {
    const handle = createNumField(
      {
        fieldKey: key,
        glyph,
        label: tip,
        min: signed ? undefined : 0,
        unit: "px",
        units: ["em", "rem"],
      },
      value,
      (css) => onEdit(set(css)),
      gestures
    );
    nums.push(handle);
    return handle.element;
  };

  /*
   * Two pairs, not four fields.
   *
   * The offsets belong together and so do blur and spread, but the reason this
   * is DOM rather than a track list is arithmetic: with four equal columns and a
   * minimum width, the count goes 4, 3, 2 as the dock narrows, and the 3-wide
   * band — X, Y and Blur on one line, Spread orphaned beneath them — covers the
   * default dock width exactly. There is no minimum that skips it. Pairing them
   * makes the *pair* the thing that wraps, so the row is four across or a 2x2
   * and never 3+1.
   */
  const pair = (...fields: HTMLElement[]): HTMLElement =>
    el("div", { class: cls("effect-pair") }, fields);

  /*
   * The row's header line, and the reason it is a container rather than just
   * the button.
   *
   * `createRowList` hands this row its eye and its minus, and until now they
   * sat *beside* the whole four-line block, centred — which put them 57px down
   * a 114px column, in the 2px gutter between the offsets and the blur. Here
   * they land on the line that names the layer, which is the line they act on.
   * A container because `.effect-kind` is a button and buttons do not nest.
   */
  const head = el("div", { class: cls("effect-head") }, [type]);

  const row = el("div", { class: cls("effect-row") }, [
    head,
    el("div", { class: cls("effect-nums") }, [
      pair(
        num("X", "Offset X", "shadow-x", shadow.x, true, (v) => ({
          ...shadow,
          x: v,
        })),
        num("Y", "Offset Y", "shadow-y", shadow.y, true, (v) => ({
          ...shadow,
          y: v,
        }))
      ),
      pair(
        num("B", "Blur", "shadow-blur", shadow.blur, false, (v) => ({
          ...shadow,
          blur: v,
        })),
        num("S", "Spread", "shadow-spread", shadow.spread, true, (v) => ({
          ...shadow,
          spread: v,
        }))
      ),
    ]),
    createColorRow({
      gestures,
      onChange: (color) => onEdit({ ...shadow, color }),
      tip: "Shadow colour",
      value: shadow.color,
    }).element,
  ]);
  // The list re-renders its rows on add, remove and eye-toggle, dropping the
  // old markup — and with it four dnd-kit grips that would otherwise stay in
  // the shared registry answering queries from a detached element.
  onDispose?.(() => {
    for (const handle of nums) {
      handle.destroy();
    }
  });
  return row;
}

/** The shadow list, ready to drop into a section body. */
export function createShadowList(
  css: string,
  onChange: OnChange,
  gestures?: Gestures
): RowListHandle<Shadow> {
  return createRowList<Shadow>(
    {
      actionSlot: (content) =>
        content.querySelector<HTMLElement>(`.${cls("effect-head")}`),
      blank: () => blankShadow(),
      cssProperty: "box-shadow",
      enabled: (r) => r.enabled,
      parse: parseShadowList,
      render: (row, onEdit, onDispose) =>
        shadowRow(row, onEdit, gestures, onDispose),
      serialize: formatShadowList,
      setEnabled: (r, on) => ({ ...r, enabled: on }),
    },
    css,
    onChange
  );
}

// -- Fill layers -------------------------------------------------------------

/**
 * A gradient or image fill layer.
 *
 * The raw CSS field is still the authority, and still the reason this row can
 * express things a picker cannot. What changed is that the glyph now *opens* a
 * visual editor when the value is a gradient the parser fully understands —
 * additive, so a gradient it declines to model still round-trips through the
 * text exactly as before.
 */
export function fillLayerRow(
  row: Fill,
  onEdit: (next: Fill) => void,
  gestures?: Gestures
): HTMLElement {
  const input = el("input", {
    "aria-label": "Fill layer",
    class: cls("ctl-input"),
    type: "text",
    value: row.value,
  }) as HTMLInputElement;

  const wrap = el("div", { class: cls("ctl-num") }, [input]);

  // Actually a button when the gradient is editable, rather than a span with a
  // click listener bolted on: it opens the visual editor, and as a span it was
  // unreachable by keyboard and announced as nothing. A span for an image fill,
  // where the glyph is identity rather than an affordance and there is nothing
  // to open.
  let glyph: HTMLElement | null = null;

  const openEditor = (): void => {
    if (!(glyph && canEditGradient(input.value))) {
      return;
    }
    openGradientEditor(glyph, {
      gestures,
      onChange: (css) => {
        // Keep the text field in step: it is the same value, and leaving it
        // stale would make the two disagree about what the fill is.
        input.value = css;
        onEdit({ ...row, kind: "gradient", value: css });
      },
      value: input.value,
    });
  };

  /*
   * The row repaints its own glyph and tooltip.
   *
   * `createRowList.replace` commits without re-rendering, and re-rendering here
   * would be wrong anyway — it would tear the field out from under the caret on
   * every keystroke. So the one thing that can change identity, gradient versus
   * image, updates in place.
   */
  const setKind = (kind: Fill["kind"]): void => {
    const image = kind === "image";
    const editable = !image && canEditGradient(input.value);
    const base = `${cls("ctl-glyph")} ${cls("ctl-glyph-static")}`;
    const next = editable
      ? el("button", {
          "aria-label": "Edit gradient",
          class: `${base} ${cls("ctl-glyph-action")}`,
          onClick: openEditor,
          type: "button",
        })
      : el("span", { class: base });
    next.append(icon(image ? "fill-image" : "fill-gradient", "sm"));
    if (glyph) {
      glyph.replaceWith(next);
    } else {
      wrap.prepend(next);
    }
    glyph = next;
    if (image) {
      wrap.dataset.tip = "Image fill — CSS url()";
    } else {
      wrap.dataset.tip = editable
        ? "Gradient fill — click the swatch to edit, or type CSS"
        : "Gradient fill — CSS";
    }
  };
  setKind(row.kind);

  const commit = (): void => {
    const value = input.value.trim();
    if (value) {
      const kind: Fill["kind"] = value.startsWith("url(")
        ? "image"
        : "gradient";
      onEdit({ ...row, kind, value });
      setKind(kind);
    }
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      commit();
      input.blur();
    }
  });
  return wrap;
}
