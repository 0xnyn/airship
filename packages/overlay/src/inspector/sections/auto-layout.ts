import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { computedStyle } from "../../realm";
import { createAlignPad } from "../controls/align-pad";
import { bindField, createTextField } from "../controls/num-field";
import { createNumberScrub } from "../controls/number-scrub";
import { createSegmented } from "../controls/segmented";
import {
  ALIGN_ITEMS_GRID,
  FLEX_DIRECTION,
  GRID_AUTO_FLOW,
  GRID_GAP,
  JUSTIFY_ITEMS,
  LAYOUT_GAP,
  LAYOUT_GROUP,
} from "../descriptors";

/** Singularises the track-kind label: "Columns" -> "column". */
const TRAILING_S = /s$/;

import {
  formatTracks,
  parseTracks,
  type TrackSpec,
  trackProperty,
} from "../grid";
import { declaredValue } from "../sizing";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";

/**
 * Auto Layout, which is very nearly flexbox with better naming.
 *
 * The section changes shape with the element, which is a surprisingly large
 * part of why a design tool feels alive rather than like a property sheet: a node that
 * is not a flex container shows the Layout dropdown and nothing else, rather
 * than six controls that would all write into a `display: block` and do
 * nothing.
 */
export function renderAutoLayout(
  ctx: SectionContext,
  node: Element
): HTMLElement {
  const { display } = computedStyle(node);
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  const body = el("div", { class: cls("sect-body") });

  // A design tool has no `display` — every frame is either an auto-layout or it is
  // not. A DOM editor cannot hide it: block, flex and grid are three genuinely
  // different layout systems, and grid is the one it has no word for. So
  // the switch stays, at the top, and the rest of the section follows it.
  //
  // A dropdown, not five pills. Five word-labelled options in a 320px dock
  // wrapped onto two rows, which is the shape `select.ts` was written to
  // avoid — and it is built through `buildControl` so the descriptor decides
  // the renderer rather than this call site deciding it a second time.
  const displayDesc = LAYOUT_GROUP.descriptors.find((d) => d.key === "display");
  if (displayDesc) {
    const control = ctx.buildControl(displayDesc, node, () => ctx.rerender());
    body.append(
      el("div", { class: cls("row") }, [
        el("span", { class: cls("row-label"), text: "Layout" }),
        control.element,
      ])
    );
  }

  if (isGrid) {
    body.append(renderGridTracks(ctx, node));
    /*
     * Grid's own alignment and flow.
     *
     * The section used to return here with only a track editor, because
     * `createAlignPad` is flex-only — so a grid container had no way to align its items,
     * no `grid-auto-flow`, and one `gap` field carrying a horizontal glyph for both of
     * its independent axes.
     */
    const gaps = el("div", { class: cls("grid") });
    for (const axis of ["row", "column"] as const) {
      gaps.append(ctx.fieldCell(GRID_GAP(axis), node));
    }
    body.append(gaps);
    for (const descriptor of [
      JUSTIFY_ITEMS,
      ALIGN_ITEMS_GRID,
      GRID_AUTO_FLOW,
    ]) {
      body.append(ctx.fieldCell(descriptor, node));
    }
    return ctx.section("auto-layout", "Layout grid", body);
  }

  // No "Add auto layout" button. It wrote `display: flex` — which is exactly
  // what picking Flex from the dropdown two lines up now does, so it was not
  // merely redundant, it was the identical declaration behind a second
  // affordance. Unlike the Position case there is no measurement that could
  // have made the button worth keeping: `display: flex` genuinely re-lays-out
  // the children and nothing can measure that away. It is previewed and
  // undoable, which is the answer.
  if (!isFlex) {
    return ctx.section("auto-layout", "Auto layout", body);
  }

  const style = computedStyle(node);
  const direction = (): "row" | "column" =>
    computedStyle(node).flexDirection.startsWith("column") ? "column" : "row";

  /*
   * Direction. Wrap is a third option here rather than its own control,
   * because that is how design tools present it and how people think about it —
   * which is also why it takes two declarations per click and so cannot use
   * the plain one-property segmented group.
   *
   * It is a real `createSegmented` now rather than a third hand-rolled copy of
   * the same markup. `onSelect` is the escape hatch for multi-declaration
   * choices and `derive` folds `flex-direction` and `flex-wrap` back into one
   * answer, so the group can repaint itself from `setValue` instead of the
   * click handler rebuilding the panel.
   */
  // The 3×3 pad and the gap/padding fields sit side by side, the way a design tool
  // lays them out — the pad is square and tall, the fields stack beside it.
  const pad = createAlignPad(
    direction,
    { align: style.alignItems, justify: style.justifyContent },
    ctx.onChange
  );
  ctx.register(pad);

  const fields = el("div", { class: cls("al-fields") });
  const gap = createNumberScrub(
    LAYOUT_GAP(direction() === "column"),
    readValue(node, "gap") || "0px",
    ctx.onChange,
    ctx.gestures
  );
  ctx.register(gap);
  gap.element.classList.add(cls("cell"));
  /*
   * Flex gap gets the token affordance the grid gutter below already had.
   *
   * Wired here rather than through `ctx.fieldCell` because the glyph swaps with
   * the axis (see `paintGapGlyph`), and that reaches into the field's own
   * chrome — which a cell wrapper would put out of reach.
   */
  const gapSlot = ctx.tokenSlot(node, ["gap"]);
  gap.setToken?.(gapSlot?.label ?? null);
  gap.onActivate?.(() => gapSlot?.open());
  if (gapSlot) {
    fields.append(
      el("div", { class: `${cls("cell")} ${cls("token-cell")}` }, [
        gap.element,
        gapSlot.element,
      ])
    );
  } else {
    fields.append(gap.element);
  }
  /** The gap glyph names the axis it runs along, so it follows the direction. */
  const paintGapGlyph = (): void => {
    gap.element
      .querySelector(`.${cls("ctl-glyph")}`)
      ?.replaceChildren(
        icon(direction() === "column" ? "gap-v" : "gap-h", "sm")
      );
  };

  const padding = ctx.spacingControl(node, "padding");
  ctx.register(padding);
  fields.append(padding.element);

  const dirRow = el("div", { class: cls("al-dir") });
  /*
   * The `-reverse` variants are preserved, not flattened away.
   *
   * This was a static table — `row: ["row", "nowrap"]` — and `readDirection` mapped
   * `row-reverse` to `row` for display. So a `flex-direction: row-reverse` container
   * showed **Row** as the active cell, and clicking that already-active cell wrote
   * `row` and silently flipped the visual order of every child. `wrap-reverse` had it
   * worse: it read as not-wrapped at all, so any pick un-wrapped the container.
   *
   * Reverse-ness is a property of the axis the user did not ask about, so a pick that
   * keeps the axis keeps it, and only an actual axis change drops it.
   */
  const declaredDirection = (): string =>
    declaredValue(node, "flex-direction") ||
    computedStyle(node).flexDirection ||
    "row";
  const declaredWrap = (): string =>
    declaredValue(node, "flex-wrap") ||
    computedStyle(node).flexWrap ||
    "nowrap";

  const writesFor = (value: string): [string, string] => {
    const dir = declaredDirection();
    const wrapped = declaredWrap().startsWith("wrap") ? declaredWrap() : "wrap";
    if (value === "wrap") {
      // Turn wrapping on and leave the axis — including its reverse — alone.
      return [dir, wrapped];
    }
    const sameAxis = dir === value || dir === `${value}-reverse`;
    return [sameAxis ? dir : value, "nowrap"];
  };

  const readDirection = (): string =>
    declaredWrap().startsWith("wrap") ? "wrap" : direction();
  const dirSeg = createSegmented(
    FLEX_DIRECTION,
    readDirection(),
    ctx.onChange,
    {
      derive: readDirection,
      onSelect: (value) => {
        const [dir, wrap] = writesFor(value);
        ctx.onChange("flex-direction", dir);
        ctx.onChange("flex-wrap", wrap);
        // Everything downstream of the axis repaints in place. `createAlignPad`
        // reads the direction through a getter for exactly this reason, and
        // the gap glyph is one `replaceChildren` — neither needs the panel
        // torn down and rebuilt around it.
        paintGapGlyph();
        pad.setValue("flex-direction", dir);
        ctx.reseed();
      },
      properties: ["flex-direction", "flex-wrap"],
    }
  );
  ctx.register(dirSeg);
  dirRow.append(dirSeg.element);

  body.append(
    dirRow,
    el("div", { class: cls("al-main") }, [pad.element, fields])
  );

  // No "Remove auto layout" header action either — same reasoning as the
  // "Add" button it mirrored. It wrote `display: block`, which is one option
  // of the dropdown at the top of this very section.
  return ctx.section("auto-layout", "Auto layout", body);
}

/**
 * CSS Grid tracks, in Layout Grid vocabulary. See `grid.ts` for the
 * mapping and for why a hand-written track list is shown rather than rewritten.
 */
function renderGridTracks(ctx: SectionContext, node: Element): HTMLElement {
  const wrap = el("div", { class: cls("grid-tracks") });
  // A track edit re-renders this block and nothing else. It used to rebuild
  // the whole panel, which meant editing a column count scrolled the Effects
  // section you were also working in back out of view.
  /*
   * Swaps this block for a freshly built one.
   *
   * The outgoing tree's controls go with it: `numControl`, `fieldCell` and
   * `register` all land in the panel's registry, and nothing was taking them
   * out — so after a few track edits `reseed` was writing into detached DOM.
   */
  const repaintTracks = ctx.repaintScope();
  const repaint = (): void =>
    repaintTracks(() => wrap.replaceWith(renderGridTracks(ctx, node)));

  for (const kind of ["columns", "rows"] as const) {
    const property = trackProperty(kind);
    /*
     * The **authored** value, not the computed one.
     *
     * `getComputedStyle().gridTemplateColumns` on a laid-out grid is the resolved track
     * list — `320px 320px 320px` — which `REPEAT` never matches. So `parseTracks`
     * returned null for every real grid, the raw-text branch always won, and the
     * scrubbable count field, the per-track size field and `formatTracks` were dead
     * code that no element could reach. `declaredValue` is what the stylesheet says.
     */
    const raw = declaredValue(node, property) || readValue(node, property);
    const spec = parseTracks(raw, kind);
    const glyph: IconName = kind === "columns" ? "grid-columns" : "grid-rows";

    if (!spec) {
      // An explicit track list. Editable as text, but not pretended to be a
      // count-and-size — that would silently destroy it.
      const custom = createTextField({
        glyph,
        label: `${kind} — custom track list`,
      });
      custom.input.value = raw;
      bindField(
        custom.input,
        () => {
          ctx.onChange(property, custom.input.value.trim());
          // Repaint, as the count/size path below does. Whether this field is a
          // raw text box or a count-and-size pair is decided by whether
          // `parseTracks` can read the value — so typing a `repeat(3, 1fr)`
          // into it leaves the panel showing the wrong control for its own
          // value until something unrelated rebuilds.
          repaint();
        },
        () => {
          custom.input.value = raw;
          custom.input.blur();
        }
      );
      wrap.append(custom.element);
      continue;
    }

    const write = (next: TrackSpec): void => {
      ctx.onChange(property, formatTracks(next));
      repaint();
    };
    // The count is a number and behaves like one — scrubbable, integer-only,
    // no unit. The *size* beside it is not: `1fr`, `minmax(120px, 1fr)` and
    // `auto` are all ordinary values for it, so it stays a text field. A
    // numeric control there would have to reject most of what belongs in it.
    const countIn = ctx.numControl(
      {
        fieldKey: `${property}-count`,
        glyph,
        label: `Number of ${kind.toLowerCase()}`,
        min: 0,
        step: 1,
        unit: "",
      },
      String(spec.count),
      (css) => {
        const n = Number.parseInt(css, 10);
        if (!Number.isNaN(n)) {
          write({ ...spec, count: Math.max(0, n) });
        }
      },
      [property],
      (value) => String(parseTracks(value, kind)?.count ?? spec.count)
    );
    const sizeIn = createTextField({
      glyph: "size-fixed",
      label: `Size of each ${kind.toLowerCase().replace(TRAILING_S, "")}`,
    });
    sizeIn.input.value = spec.size;
    bindField(
      sizeIn.input,
      () => write({ ...spec, size: sizeIn.input.value.trim() || "1fr" }),
      () => {
        sizeIn.input.value = spec.size;
        sizeIn.input.blur();
      }
    );
    const row = el("div", { class: cls("grid") });
    row.append(countIn.element, sizeIn.element);
    wrap.append(row);
  }

  // Gutter and margin, which is what a design tool calls gap and padding.
  const grid = el("div", { class: cls("grid") });
  grid.append(ctx.fieldCell(LAYOUT_GAP(false), node));
  wrap.append(grid);

  const padding = ctx.spacingControl(node, "padding");
  ctx.register(padding);
  wrap.append(padding.element);

  return wrap;
}
