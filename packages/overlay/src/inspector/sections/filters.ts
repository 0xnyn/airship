/**
 * Filters — `filter` and `backdrop-filter`, as two stacks of functions.
 *
 * Two lists rather than one with a target column, because they are genuinely
 * two CSS properties and the row list serialises one property per instance.
 * Grouping them under one section is a presentation choice: they are the same
 * idea applied to the element and to what is behind it, and a user looking for
 * "blur" should not have to know which.
 *
 * The layer/background blur fields that used to live in Effects are gone —
 * they were a two-field stand-in for exactly this list, and keeping both would
 * mean two controls writing the same `filter` property from different models.
 */
import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { createMenu, type MenuEntry } from "../../popover-host";
import { createColorRow } from "../controls/color-picker";
import { createNumField } from "../controls/num-field";
import { createRowList, type RowListHandle } from "../controls/row-list";
import type { Gestures, OnChange } from "../controls/types";
import {
  blankFilter,
  FILTER_CONFIG,
  FILTER_KINDS,
  type FilterEntry,
  formatDropShadow,
  formatFilters,
  parseDropShadow,
  parseFilters,
  seedFilterValue,
} from "../filters";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";

/**
 * The glyph each function carries in its row.
 *
 * Design tools never list an effect by name alone — the type reads from the icon
 * first and the word second, which is what lets a stack of five be scanned
 * rather than read.
 */
const FILTER_ICON: Record<string, IconName> = {
  blur: "blur",
  brightness: "adjust-exposure",
  contrast: "adjust-contrast",
  "drop-shadow": "effect-drop-shadow",
  grayscale: "adjust-tint",
  "hue-rotate": "rotation",
  invert: "blend-on",
  opacity: "opacity",
  saturate: "adjust-saturation",
  sepia: "adjust-temperature",
};

/**
 * The drop shadow's name, which `FILTER_CONFIG` cannot hold.
 *
 * That table is keyed on the filters that are a single number, and a drop
 * shadow is three lengths and a colour. Shared between the row's heading and
 * the add-menu entry so the two cannot drift apart.
 */
const DROP_SHADOW = {
  icon: FILTER_ICON["drop-shadow"] ?? "effects",
  label: "Drop shadow",
} as const;

export function renderFilters(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });
  const lists: RowListHandle<FilterEntry>[] = [];

  /*
   * A sub-head only where there is something under it.
   *
   * Both stacks used to be rendered unconditionally, each with its heading and
   * each with an empty-list placeholder, so an element with no filters — which
   * is nearly all of them — opened this section onto "Layer / None / Background
   * / None". Four lines saying nothing. The heading earns its place only when it
   * has a list to disambiguate, and when neither stack has rows the body is
   * empty and the header's `+` is the whole affordance.
   */
  const stacks: { label: string; list: RowListHandle<FilterEntry> }[] = [];
  for (const [property, label] of [
    ["filter", "Layer"],
    ["backdrop-filter", "Background"],
  ] as const) {
    const list = createFilterList(
      property,
      readValue(node, property),
      ctx.onChange,
      node,
      ctx.gestures
    );
    ctx.register(list);
    lists.push(list);
    stacks.push({ label, list });
  }

  // Both list elements stay mounted so the header `+` has something to add
  // into; an empty one has no children and so no height. Only the headings are
  // conditional, and only when there are two stacks to tell apart.
  const filled = stacks.filter(({ list }) => list.rows().length > 0);
  for (const { label, list } of stacks) {
    if (filled.length > 1 && list.rows().length > 0) {
      body.append(el("div", { class: cls("sect-sub-head"), text: label }));
    }
    body.append(list.element);
  }

  return ctx.section("filters", "Filters", body, {
    actions: [addButton(ctx, lists)],
    startCollapsed: true,
  });
}

/**
 * The header `+`. Built here rather than via `ctx.headerAction` because the menu
 * has to anchor to the button itself, and that helper hands its callback no
 * anchor to open against.
 */
function addButton(
  ctx: SectionContext,
  lists: RowListHandle<FilterEntry>[]
): HTMLElement {
  const button = ctx.headerAction("plus", "Add filter", () => {
    // Rebuild after an add: going from zero rows to one changes whether this
    // stack gets a heading, which is a change of *shape*, not of value.
    openAddMenu(button, lists, () => ctx.rerender());
  });
  return button;
}

/**
 * The `+` menu: every function not already present, grouped by which property
 * it would go on.
 *
 * Filtering out functions already in the list is what keeps the menu honest —
 * CSS allows `blur(2px) blur(3px)` but nobody means it, and offering a second
 * copy invites a stack that silently multiplies.
 */
function openAddMenu(
  anchor: HTMLElement,
  lists: RowListHandle<FilterEntry>[],
  afterAdd: () => void
): void {
  const entries: MenuEntry[] = [];
  lists.forEach((list, i) => {
    const present = new Set(list.rows().map((r) => r.kind));
    const available = FILTER_KINDS.filter((kind) => !present.has(kind));
    /*
     * `drop-shadow` is counted as offerable too.
     *
     * This used to `return` when `available` was empty — before the `drop-shadow` entry
     * further down was ever pushed. So an element already carrying the nine modelled
     * filters could never have a drop shadow added to that stack: the `+` menu simply
     * offered nothing for it.
     */
    const canAddShadow = !present.has("drop-shadow");
    if (available.length === 0 && !canAddShadow) {
      return;
    }
    entries.push({ header: i === 0 ? "Layer" : "Background" });
    for (const kind of available) {
      entries.push({
        icon: FILTER_ICON[kind],
        label: FILTER_CONFIG[kind].label,
        run: () => {
          list.addRow(blankFilter(kind));
          afterAdd();
        },
      });
    }
    if (canAddShadow) {
      entries.push({
        icon: DROP_SHADOW.icon,
        label: DROP_SHADOW.label,
        run: () => {
          list.addRow({
            enabled: true,
            kind: "drop-shadow",
            value: "0 2px 4px rgb(0 0 0 / 0.25)",
          });
          afterAdd();
        },
      });
    }
  });
  if (entries.length === 0) {
    return;
  }
  createMenu(entries).open(anchor);
}

function createFilterList(
  cssProperty: string,
  initial: string,
  onChange: OnChange,
  node: Element,
  gestures?: Gestures
): RowListHandle<FilterEntry> {
  return createRowList<FilterEntry>(
    {
      // Only a drop shadow has one; for every other filter this is null and the
      // actions stay beside the row, centred on its single line.
      actionSlot: (content) =>
        content.querySelector<HTMLElement>(`.${cls("filter-shadow-head")}`),
      blank: () => blankFilter("blur"),
      cssProperty,
      enabled: (row) => row.enabled,
      parse: parseFilters,
      render: (row, onEdit, onDispose) =>
        filterRow(row, onEdit, onDispose, node, gestures),
      serialize: formatFilters,
      setEnabled: (row, on) => ({ ...row, enabled: on }),
    },
    initial,
    onChange
  );
}

function filterRow(
  row: FilterEntry,
  onEdit: (next: FilterEntry) => void,
  onDispose: (fn: () => void) => void,
  node: Element,
  gestures?: Gestures
): HTMLElement {
  if (row.kind === "drop-shadow") {
    return dropShadowRow(row, onEdit, onDispose, node, gestures);
  }
  if (row.kind === "other") {
    // An unmodelled function. Shown, disable-able and removable, but not
    // editable — inventing a UI for a function we do not understand would be
    // worse than showing the user what is actually there.
    const text = el("span", {
      class: cls("filter-raw"),
      text: row.value,
    });
    text.dataset.tip = "Shown as authored, not editable";
    return text;
  }

  const config = FILTER_CONFIG[row.kind];
  const name = el("span", { class: cls("filter-name") }, [
    icon(FILTER_ICON[row.kind] ?? "effects", "xs"),
    el("span", { class: cls("filter-label"), text: config.label }),
  ]);
  const field = createNumField(
    {
      label: config.label,
      max: config.max,
      min: config.min,
      step: config.step,
      unit: config.defaultUnit,
      units: config.units,
    },
    // Scaled into the field's own unit. A computed `brightness(1.2)` handed to a
    // `%` field came back as `brightness(1.2%)` on the first blur — see
    // `seedFilterValue`.
    seedFilterValue(row.kind, row.value),
    (css) => onEdit({ ...row, value: css }),
    gestures
  );
  onDispose(field.destroy);
  return el("div", { class: cls("filter-row") }, [name, field.element]);
}

function dropShadowRow(
  row: FilterEntry,
  onEdit: (next: FilterEntry) => void,
  onDispose: (fn: () => void) => void,
  node: Element,
  gestures?: Gestures
): HTMLElement {
  const shadow = parseDropShadow(row.value);
  const commit = (): void =>
    onEdit({ ...row, value: formatDropShadow(shadow) });

  const wrap = el("div", { class: cls("filter-shadow") });
  // Unlike `box-shadow`, this one follows the element's alpha channel — it
  // shadows the *shape*, not the box. Worth saying, because it is the reason
  // to reach for it over the Effects section.
  wrap.dataset.tip = "Follows the shape, not the box";

  /*
   * A header line, which this row is the only filter to have lost.
   *
   * Every other filter renders a `.filter-name` — its glyph and its word — and
   * gets the list's eye and minus centred on that one line. This one replaced
   * the whole row with a two-line block of its own, so it had no name and its
   * actions ended up at y25 of a 50px column, in the 2px gutter between the
   * offsets and the colour. It says what it is again, and its actions sit on
   * the line that says it. See `createRowList`'s `actionSlot`.
   */
  const head = el("div", { class: cls("filter-shadow-head") }, [
    el("span", { class: cls("filter-name") }, [
      icon(DROP_SHADOW.icon, "xs"),
      el("span", { class: cls("filter-label"), text: DROP_SHADOW.label }),
    ]),
  ]);
  wrap.append(head);

  const nums = el("div", { class: cls("filter-shadow-nums") });
  for (const [key, glyph, label] of [
    ["x", "X", "Offset X"],
    ["y", "Y", "Offset Y"],
    ["blur", "blur", "Blur"],
  ] as const) {
    const field = createNumField(
      { glyph, label, min: key === "blur" ? 0 : undefined, unit: "px" },
      shadow[key],
      (css) => {
        shadow[key] = css;
        commit();
      },
      gestures
    );
    onDispose(field.destroy);
    nums.append(field.element);
  }
  wrap.append(nums);

  /*
   * An omitted colour is *shown* as the element's own, and stays omitted.
   *
   * CSS paints `drop-shadow(4px 4px 2px)` in the element's `color`, so that is what the
   * swatch has to show — but writing it into the declaration would pin it, which is how
   * a red icon's shadow used to turn black the first time the X offset was scrubbed.
   * Only a colour the user actually picks is recorded.
   */
  const color = createColorRow({
    gestures,
    node,
    onChange: (next) => {
      shadow.color = next;
      commit();
    },
    tip: shadow.color
      ? "Shadow colour"
      : "Shadow colour, taken from the element",
    value: shadow.color || readValue(node, "color"),
  });
  onDispose(color.destroy);
  wrap.append(color.element);
  return wrap;
}
