import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { openPopover } from "../../popover-host";
import { createTextField } from "../controls/num-field";
import { createQuadField } from "../controls/quad-field";
import { createSegmented } from "../controls/segmented";
import { createSelect } from "../controls/select";
import { STROKE_POSITION, STROKE_SIDES, STROKE_STYLE } from "../descriptors";
import { hasStroke } from "../gates";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";

/**
 * The Stroke section: a stroke row, a weight field, and everything else
 * behind an advanced-settings popover.
 *
 * It used to be four flat things stacked — colour, widths, a full-width Style
 * segmented group, a full-width Position segmented group — so a section whose
 * everyday use is "make this border 1px grey" was four rows tall and the two
 * rows you set once and forget occupied half of it.
 *
 * The row deliberately reuses Fill's `.rows` chrome without `createRowList`:
 * that primitive's value model is "an array serialised into one CSS property"
 * and a border is four longhands, so routing it through would need a fake
 * `cssProperty`. Sharing the classes is the honest half of the reuse.
 */
/**
 * The four longhands for one border property, so this section never writes a shorthand.
 *
 * Everything else here writes `border-<side>-<prop>` — deliberately, because
 * "the shorthand was the one declaration in this section that could not describe what
 * the section was showing". Add and Remove did not, and the change set is keyed per
 * property, so *both* survived: set `border-top-width: 8px`, click Remove stroke, and
 * the payload carried `border-top-width: 8px` **and** `border-width: 0px`. Which one
 * landed in the source depended on emission order.
 *
 * A shorthand also cannot be taken back cleanly — `border-width: 0px` leaves the four
 * longhands in place and merely loses to them — which is why Remove looked like it had
 * worked while the quad field still read `8`.
 */
const EDGES = ["top", "right", "bottom", "left"] as const;

function writeAllEdges(
  onChange: (property: string, value: string) => void,
  suffix: "width" | "style" | "color",
  value: string
): void {
  for (const edge of EDGES) {
    onChange(`border-${edge}-${suffix}`, value);
  }
}

export function renderStroke(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  // Colour writes the four longhands, not the `border-color` shorthand.
  // The widths beside it have always been longhands, so the shorthand was the
  // one declaration in this section that could not describe what the section
  // was showing — set three sides to 0 and the colour still claimed all four.
  const rows = el("div", { class: cls("rows") });
  // Owns the colour row it builds, so repainting drops the previous one rather
  // than leaving it registered against detached DOM.
  const repaintRows = ctx.repaintScope();
  const paintRows = (): void => repaintRows(() => paintRowsInto());
  const paintRowsInto = (): void => {
    if (!hasStroke(ctx.gate(node))) {
      // Empty, not a "None" row — see the note in `row-list.ts`'s render().
      rows.replaceChildren();
      return;
    }
    rows.replaceChildren(
      el("div", { class: cls("rows-row") }, [
        ctx.colorRow(
          readValue(node, "border-top-color") || "#000000",
          "Stroke colour",
          (next) => {
            for (const side of STROKE_SIDES) {
              ctx.onChange(`border-${side.name}-color`, next);
            }
          },
          node,
          STROKE_SIDES.map((side) => `border-${side.name}-color`)
        ),
        // The eye keeps the widths and drops the stroke out of what gets
        // painted — the same contract `row-list`'s disabled rows have. It
        // restores to `solid` rather than remembering the previous style,
        // because a width above zero already implies one.
        el(
          "button",
          {
            "aria-label": "Hide stroke",
            class: cls("row-icon"),
            "data-tip": "Hide stroke",
            onClick: () => {
              ctx.onChange("border-style", "none");
              paintRows();
              paintAdd();
            },
            type: "button",
          },
          [icon("eye", "xs")]
        ),
        el(
          "button",
          {
            "aria-label": "Remove stroke",
            class: cls("row-icon"),
            "data-tip": "Remove stroke",
            onClick: () => {
              // Longhands, so this actually clears what the section's own fields wrote.
              writeAllEdges(ctx.onChange, "style", "none");
              writeAllEdges(ctx.onChange, "width", "0px");
              paintRows();
              paintAdd();
              // The quad field is keyed on the longhands, so it only follows once they
              // are what changed — `border-width` left it reading the old value.
              ctx.reseed();
            },
            type: "button",
          },
          [icon("minus", "xs")]
        ),
      ])
    );
  };
  paintRows();
  body.append(rows);

  // Per-side widths, collapsed to one field until they disagree — the same
  // control as corner radius, which is the other four-longhands-behind-one-
  // number in this panel. The settings button sits on the same line, the way
  // A design tool puts its advanced-stroke affordance beside the weight.
  const widths = createQuadField(
    {
      collapsed: { glyph: "stroke-width", label: "Stroke width" },
      // A border with no style is invisible however wide it is; setting one
      // implies the other, and leaving that to the user is a trap.
      onWrote: (_property, css) => {
        if (
          Number.parseFloat(css) > 0 &&
          readValue(node, "border-top-style") === "none"
        ) {
          ctx.onChange("border-style", "solid");
          paintRows();
          paintAdd();
        }
      },
      sides: STROKE_SIDES.map((s) => ({
        glyph: s.icon,
        label: s.label,
        property: `border-${s.name}-width`,
      })),
      toggle: { glyph: "corners-independent", label: "Independent sides" },
      tokenSlot: (properties) => ctx.tokenSlot(node, properties),
    },
    new Map(
      STROKE_SIDES.map((s) => [
        `border-${s.name}-width`,
        readValue(node, `border-${s.name}-width`) || "0px",
      ])
    ),
    ctx.onChange,
    ctx.gestures
  );
  ctx.register(widths);

  const settings = el(
    "button",
    {
      "aria-label": "Advanced stroke settings",
      // `align-self` because the row centres, and the control beside this one
      // is two lines tall once the four widths disagree — which put a 24px
      // button at y13 of a 50px block, in the gutter between the two field
      // rows. Top-aligned it stays level with the first line, which is where
      // the quad's own mode toggle already sits.
      class: `${cls("pad-mode")} ${cls("row-top")}`,
      "data-tip": "Advanced stroke settings",
      onClick: () => openStrokeSettings(ctx, node, settings),
      type: "button",
    },
    [icon("stroke-custom", "sm")]
  );
  body.append(
    el("div", { class: `${cls("row")} ${cls("group")}` }, [
      widths.element,
      settings,
    ])
  );

  /*
   * The `+` caps at one, and says why.
   *
   * CSS gives an element exactly one border. A design tool stacks strokes the way it
   * stacks fills, and there is no honest way to offer a second row here: an
   * `outline` is a real second ring but takes no per-side widths and no
   * per-corner radius, so row two would quietly be a different control from
   * row one. A disabled button that names the limit — and names the two real
   * workarounds — beats either a dead `+` or a fake row.
   */
  const add = ctx.headerAction("plus", "Add stroke", () => {
    writeAllEdges(ctx.onChange, "style", "solid");
    writeAllEdges(ctx.onChange, "width", "1px");
    writeAllEdges(ctx.onChange, "color", readValue(node, "color") || "#000000");
    paintRows();
    paintAdd();
    ctx.reseed();
  });
  const paintAdd = (): void => {
    const on = hasStroke(ctx.gate(node));
    add.toggleAttribute("disabled", on);
    add.dataset.tip = on
      ? "An element has one CSS border. For a second ring, use an outline or a spread-only shadow"
      : "Add stroke";
  };
  paintAdd();

  return ctx.section("stroke", "Stroke", body, { actions: [add] });
}

/**
 * The advanced stroke settings, as far as CSS goes.
 *
 * Two kinds of absence, drawn differently on purpose:
 *
 * **Disabled with an explanation** is for what someone will actively look for
 * because a design tool has it right there — a centre stroke position, a dash length.
 * Hiding those makes the panel look like it forgot; greying them out with a
 * reason makes it look like it knows.
 *
 * **Omitted entirely** is for concepts with no CSS analogue at all. A border
 * has no cap and no join. `Stroke/Part-2` ships those glyphs and they stay
 * unmapped: a row of permanently dead controls is its own kind of dishonesty.
 */
function openStrokeSettings(
  ctx: SectionContext,
  node: Element,
  anchor: HTMLElement
): void {
  const body = el("div", { class: cls("pop-form") });

  /*
   * Position. A design tool offers inside / centre / outside; CSS has exactly two of
   * those and they come from `box-sizing`. With `border-box` the declared size
   * already includes the border, so it is painted inward and the element's
   * footprint does not change — the inside stroke. With `content-box` the
   * border is added outside the declared size and the element grows — the
   * outside stroke, give or take the reflow a vector canvas never has to do.
   *
   * Centre is shown and disabled. Faking it would mean an `outline` at half
   * offset, which cannot do per-side widths and would silently stop matching
   * the four fields it sits under.
   */
  const position = createSegmented(
    STROKE_POSITION,
    readValue(node, "box-sizing") === "content-box" ? "outside" : "inside",
    ctx.onChange,
    {
      derive: () =>
        readValue(node, "box-sizing") === "content-box" ? "outside" : "inside",
      onSelect: (value) =>
        ctx.onChange(
          "box-sizing",
          value === "outside" ? "content-box" : "border-box"
        ),
      properties: ["box-sizing"],
    }
  );
  const centre = position.element.querySelector<HTMLElement>(
    `[aria-label="Centre"]`
  );
  if (centre) {
    centre.toggleAttribute("disabled", true);
    centre.dataset.tip =
      "CSS borders sit inside or outside the box — there is no centre";
  }
  body.append(popRow("Position", position.element));

  /*
   * Style. A select rather than a segmented group: `dotted` and `double` are
   * as legal as the other three and neither has a glyph — the set ships
   * only solid and dash — so a segmented group would mix icon cells and text
   * pills, which is exactly the shape `segmented.ts` warns against.
   */
  const style = createSelect(
    STROKE_STYLE,
    readValue(node, "border-top-style") || "none",
    ctx.onChange
  );
  body.append(popRow("Style", style.element));

  /*
   * Dash and gap. CSS gives no control over the metrics of
   * `border-style: dashed` — the user agent picks them, and they differ
   * between engines. Shown disabled rather than omitted because design tools have
   * them right beside the style, so their absence is a question someone will
   * ask.
   *
   * The `repeating-linear-gradient` border trick would fake it, and it writes
   * `background-image` — which is where the Fill section's gradient layers
   * live. Two sections silently competing for one property is a worse bug
   * than the missing feature.
   */
  const dashes = el("div", { class: cls("grid") });
  for (const label of ["Dash", "Gap"]) {
    const field = createTextField({ glyph: label[0], label });
    field.input.disabled = true;
    field.input.placeholder = "—";
    field.element.dataset.tip = `${label} length is chosen by the browser; CSS cannot set it`;
    dashes.append(field.element);
  }
  body.append(popRow("Dashes", dashes));
  body.append(
    el("div", {
      class: cls("pop-note"),
      text: "Dash metrics are the browser's to choose. Cap and join have no CSS equivalent.",
    })
  );

  openPopover({
    anchor,
    content: body,
    onClose: () => {
      position.destroy?.();
      style.destroy?.();
    },
    prefer: "below",
  });
}

/** One labelled row inside a popover form. */
function popRow(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: cls("row") }, [
    el("span", { class: cls("row-label"), text: label }),
    control,
  ]);
}
