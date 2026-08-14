import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { counterpart, isLocked, toggleLock } from "../aspect";
import { keywordsFor, parseLength } from "../css-length";
import { MODE_NOTE, MODE_TEXT, SIZE_GROUP } from "../descriptors";
import { hasBounds } from "../gates";
import {
  type Axis,
  availableModes,
  layoutSize,
  type ResizeMode,
  resizeMode,
  writeResize,
} from "../sizing";
import type { SectionContext } from "./context";

/**
 * W and H with the design-tool resizing modes.
 *
 * Split out of the generic `GROUPS` pipeline because the mode buttons are not
 * a CSS property — "Fill" is `flex: 1 1 0%` on a flex child and `width: 100%`
 * everywhere else, so the control has to know about the parent. See
 * `sizing.ts` for the table.
 */
const MODE_ICON: Record<ResizeMode, IconName> = {
  fill: "size-fill",
  fixed: "size-fixed",
  hug: "size-hug",
};

/**
 * The words that are a *mode*, not a length.
 *
 * Typing one of these into the field is the same act as clicking the matching
 * button, and is routed there rather than written as a declaration — otherwise
 * `width: max-content` lands but the Hug cell beside it stays unlit, which is
 * the panel disagreeing with itself about what the element is doing.
 */
const MODE_FOR_KEYWORD: Record<string, ResizeMode | undefined> = {
  // `auto` means "let the layout decide", which is Fill inside a flex parent
  // and the closest thing to it elsewhere. `writeResize` owns that distinction.
  auto: "fill",
  "fit-content": "hug",
  "max-content": "hug",
  "min-content": "hug",
};

/** What a W or H field takes. `%` of the containing block is the common one. */
const SIZE_UNITS = ["px", "%", "em", "rem", "vw", "vh"];

/**
 * One axis: the number field, and the Fixed / Hug / Fill switch beside it.
 *
 * Both axes render identically bar the property they write, so this exists
 * once and `renderSize` calls it twice.
 */
function renderAxisRow(
  ctx: SectionContext,
  node: Element,
  axis: Axis
): HTMLElement {
  const property = axis === "w" ? "width" : "height";
  /** What the field shows: a measured number, or the mode's own word. */
  const shown = (): string =>
    resizeMode(node, axis) === "fixed"
      ? String(Math.round(layoutSize(node, axis)))
      : MODE_TEXT[resizeMode(node, axis)];

  // W and H are the two spelled out in letters rather than glyphs —
  // no icon reads as "width" faster than a W does. They scrub, and typing
  // a number switches the axis to Fixed, which is what a number means.
  const field = ctx.numControl(
    {
      fieldKey: property,
      glyph: axis === "w" ? "W" : "H",
      keywords: keywordsFor(property),
      label: axis === "w" ? "Width" : "Height",
      min: 0,
      unit: "px",
      units: SIZE_UNITS,
    },
    shown(),
    (css) => {
      /*
       * A word switches the mode; a length pins the axis to Fixed.
       *
       * The field advertises four keywords and five units in its spec, and this
       * callback used to `parseFloat` the value and bail on `NaN` — so typing
       * `auto` or `max-content` was accepted by the field, repainted as though
       * it had landed, and then dropped on the floor, while `50%` was parsed to
       * `50` and re-emitted by `writeResize` as `width: 50px`. Both are now
       * carried through to the thing that means them.
       */
      const mode = MODE_FOR_KEYWORD[css.trim().toLowerCase()];
      if (mode) {
        applyMode(mode);
        return;
      }
      if (!parseLength(css, SIZE_UNITS)) {
        // A global keyword (`inherit`) or anything else the field let through
        // but this control has no resizing meaning for.
        ctx.onChange(property, css);
        return;
      }
      for (const d of writeResize(node, axis, "fixed", css)) {
        ctx.onChange(d.property, d.value);
      }
      // With the lock engaged, the other axis follows. Written through the same
      // `writeResize` path so it lands as a real Fixed value rather than a bare
      // `height`, and inside the same gesture so ⌘Z takes both back together.
      const other = counterpart(node, axis, css);
      if (other !== null) {
        const otherAxis = axis === "w" ? "h" : "w";
        for (const d of writeResize(node, otherAxis, "fixed", other)) {
          ctx.onChange(d.property, d.value);
        }
      }
    },
    // A resize handle writes `width`; a Fill on a flex child writes `flex`;
    // the Hug/Fill switch can write either. Re-derive rather than mirror,
    // because what this field shows for a non-fixed axis is a *word*.
    [property, "flex", "align-self"],
    shown
  );

  const modes = el("div", { class: cls("ctl-seg") });
  modes.dataset.variant = "icon";
  // All three cells, always. `availableModes` drops Fill for a node with no
  // parent element, and a group that is three cells wide on one element and
  // two on the next makes the whole row jump as you click around — the
  // unavailable one is disabled instead, which says the same thing without
  // moving anything.
  const available = new Set(availableModes(node, axis));
  const cells: { btn: HTMLElement; mode: ResizeMode }[] = [];
  const paintModes = (): void => {
    const now = resizeMode(node, axis);
    for (const cell of cells) {
      cell.btn.classList.toggle(cls("ctl-seg-on"), cell.mode === now);
      cell.btn.setAttribute("aria-pressed", String(cell.mode === now));
    }
  };
  for (const m of ["fixed", "hug", "fill"] as const) {
    const enabled = available.has(m);
    const btn = el(
      "button",
      {
        "aria-label": MODE_TEXT[m],
        class: cls("ctl-seg-btn"),
        "data-tip": enabled
          ? `${MODE_TEXT[m]}. ${MODE_NOTE[m]}`
          : `${MODE_TEXT[m]}. Needs a parent to fill`,
        disabled: enabled ? undefined : "",
        onClick: enabled ? () => applyMode(m) : undefined,
        type: "button",
      },
      [icon(MODE_ICON[m], "sm")]
    );
    cells.push({ btn, mode: m });
    modes.append(btn);
  }
  paintModes();

  /*
   * Switch this axis to a mode, from either entry point.
   *
   * Hoisted so the field's commit can reach it — typing `max-content` and
   * clicking Hug are the same act, and having only the buttons do it is why
   * typing a keyword looked like it worked and then did nothing.
   */
  function applyMode(mode: ResizeMode): void {
    /*
     * Re-measured, not the `rect` this row was built from.
     *
     * `renderSize` used to measure once and pass the rect down, so this pinned
     * Fixed to that number — typing `400` into W and then clicking **Fixed**
     * wrote whatever the element had been when the panel last rebuilt.
     * `shown()` above has always re-measured for display; the write has to
     * agree with it.
     */
    // `layoutSize`, not the rect: `width` is the content box unless the element is
    // `border-box`, so writing a measured border box grew it by its own padding.
    const measured = layoutSize(node, axis);
    for (const d of writeResize(
      node,
      axis,
      mode,
      `${Math.round(measured)}px`
    )) {
      ctx.onChange(d.property, d.value);
    }
    // In place. `availableModes` varies only with the *parent*, which a mode
    // switch cannot change, so the row's shape is fixed — only which cell is
    // lit and what the field says.
    paintModes();
    field.setValue(shown());
  }

  /*
   * W and H are `sizing` tokens, and had no picker: the affordance lived only
   * on the descriptor pipeline, which this row deliberately does not use.
   * Asked for `property` alone rather than the field's full re-seed list —
   * `flex` and `align-self` are how a mode is expressed, not values a token
   * could ever provide.
   */
  const slot = ctx.tokenSlot(node, [property]);
  field.setToken(slot?.label ?? null);
  field.onActivate(() => slot?.open());
  return el("div", { class: cls("size-row") }, [
    field.element,
    ...(slot ? [slot.element] : []),
    modes,
  ]);
}

/**
 * The proportional-resize lock, spanning both axis rows.
 *
 * Rebuilds the section on toggle rather than repainting in place: the lock
 * changes what typing in either field *does*, and the fields are seeded at
 * build time.
 */
function lockButton(ctx: SectionContext, node: Element): HTMLElement {
  const on = isLocked(node);
  const tip = on ? "Unlock aspect ratio" : "Lock aspect ratio";
  const button = el("button", {
    "aria-label": tip,
    "aria-pressed": String(on),
    // Shape from `row-icon`, the panel's one ghost icon button; `aspect-lock`
    // adds only the engaged colour.
    class: `${cls("row-icon")} ${cls("aspect-lock")}`,
    "data-tip": tip,
    type: "button",
  });
  if (on) {
    button.dataset.on = "";
  }
  button.append(icon(on ? "aspect-lock" : "aspect-unlock", "xs"));
  button.addEventListener("click", () => {
    toggleLock(node);
    ctx.rerender();
  });
  return button;
}

export function renderSize(
  ctx: SectionContext,
  node: Element,
  state: { showBounds: boolean }
): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  /*
   * The two axis rows and the lock are one group, laid out as a flex line.
   *
   * They used to be three children of the two-column `.grid`, which does not
   * work: a `.size-row` spans both of that grid's columns, so the lock had no
   * column left to sit in and auto-placed onto a row of its own beneath them —
   * a stray padlock over an empty cell, adding a dead row to every element's
   * Size section. It also carries `.group` so the min/max grid below it keeps
   * its group gap, which it inherited from being a `.grid` before.
   */
  const rows = el("div", { class: cls("size-rows") });
  for (const axis of ["w", "h"] as const) {
    rows.append(renderAxisRow(ctx, node, axis));
  }
  body.append(
    el("div", { class: `${cls("size-wrap")} ${cls("group")}` }, [
      rows,
      lockButton(ctx, node),
    ])
  );

  /*
   * Min and max, as a second group behind a `+`.
   *
   * The descriptor file has claimed since it was written that a design tool
   * tucks them behind a + too — and the code never did, so four fields nobody had
   * set were permanently on screen for every element, doubling the height of
   * a section whose actual job is two numbers. They appear when they are set,
   * and otherwise when you ask for them.
   */
  const bounds = SIZE_GROUP.descriptors.filter((d) => d.key.startsWith("m"));
  // Through `ctx.gate`, so a min-width the user has just typed counts before
  // the DOM has been asked about it.
  const constrained = hasBounds(ctx.gate(node));
  const boundsGrid = el("div", {
    class: `${cls("grid")} ${cls("group")}`,
  });
  // Owns the four cells it builds; without this every toggle left another copy
  // of each registered, writing into a grid that had been replaced.
  const repaintBounds = ctx.repaintScope();
  const paintBounds = (): void => {
    repaintBounds(() => {
      boundsGrid.replaceChildren(...bounds.map((d) => ctx.fieldCell(d, node)));
    });
  };
  if (constrained || state.showBounds) {
    paintBounds();
    body.append(boundsGrid);
  }

  /*
   * The toggle is always in the header, and disabled once a bound is set.
   *
   * It used to be *omitted* in that case — the section returned with no
   * `actions` at all — on the reasoning that there is nothing for it to reveal.
   * True, and it meant typing a `min-width` deleted the button you had just
   * pressed to get the field, out from under the cursor. Disabling with a
   * reason is the idiom the Stroke section already uses for exactly this, and
   * it keeps the header from reflowing as you type.
   */
  const toggle = ctx.headerAction("plus", "Add min and max", () => {
    if (constrained) {
      return;
    }
    state.showBounds = !state.showBounds;
    if (state.showBounds) {
      paintBounds();
      body.append(boundsGrid);
    } else {
      boundsGrid.remove();
    }
    paintToggle();
  });
  const paintToggle = (): void => {
    const open = constrained || state.showBounds;
    let tip = open ? "Hide min and max" : "Add min and max";
    if (constrained) {
      tip = "Clear min and max to hide these";
    }
    toggle.replaceChildren(icon(open ? "minus" : "plus", "xs"));
    toggle.toggleAttribute("disabled", constrained);
    toggle.dataset.tip = tip;
    toggle.setAttribute("aria-label", tip);
  };
  paintToggle();
  return ctx.section("size", "Size", body, { actions: [toggle] });
}
