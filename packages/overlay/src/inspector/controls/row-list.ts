import { cls, el } from "../../dom";
import { icon } from "../../icons";
import type { ControlHandle, OnChange } from "./types";

/*
 * The repeatable-row pattern design tools use.
 *
 * Fill, Stroke and Effects are the same control three times: a list of layers,
 * each with an eye to disable it and a minus to remove it, and a `+` in the
 * section header to add one. Writing that three times is how three sections end
 * up subtly disagreeing about what the eye does, so it is written once.
 *
 * The eye is a *row-local* flag, not a CSS property. A disabled row keeps its
 * values but is dropped from the serialised output — which is exactly what the
 * agent should see, since a shadow you switched off should not appear in the
 * source.
 */

export interface RowListSpec<T> {
  /**
   * Where this row's eye and minus belong, when "beside the row" is wrong.
   *
   * A one-line row centres them on its own single line and there is nothing to
   * decide. A row that stacks — a shadow is a type, four offsets and a colour —
   * has no such line, and `align-items: center` put them at the geometric
   * midpoint of the block: for a shadow, 57px down a 114px column, in the 2px
   * gutter between the offsets and the blur. Not merely unanchored either: the
   * block gets shorter when the offsets fit four across, so where they landed
   * moved with the dock width.
   *
   * So a stacking row names the line its actions act on, and gets them there.
   * Return `null` — or omit this — to keep them beside the row.
   */
  actionSlot?: (content: HTMLElement) => HTMLElement | null;
  /** A fresh row for the `+` button. */
  blank: () => T;
  cssProperty: string;
  enabled: (row: T) => boolean;
  parse: (css: string) => T[];
  /**
   * The row's own controls, between the drag area and the eye/minus.
   *
   * `onDispose` registers teardown for anything the row binds outside its own
   * markup — a dnd-kit grip, an open popover. The list drops and rebuilds its
   * rows on add, remove and eye-toggle, so a row that registers nothing leaks a
   * detached entity into the shared drag registry on every one of those.
   */
  render: (
    row: T,
    onEdit: (next: T) => void,
    onDispose: (fn: () => void) => void,
    /**
     * This row's position in the list.
     *
     * For the properties that are *parallel lists* to the one this control serialises:
     * `background-size`, `-position`, `-repeat` and `-blend-mode` are each a
     * comma-separated list index-aligned with `background-image`, so a row can only edit
     * its own entry if it knows which entry that is.
     */
    index: number
  ) => HTMLElement;
  serialize: (rows: T[]) => string;
  setEnabled: (row: T, on: boolean) => T;
}

export interface RowListHandle<T> extends ControlHandle {
  /** Append a blank row — wired to the section header's `+`. */
  add: () => void;
  /**
   * Append a specific row. Filters need this: their `+` is a menu of nine
   * functions, so the caller — not the spec — decides what a new row is.
   */
  addRow: (row: T) => void;
  rows: () => T[];
}

export function createRowList<T>(
  spec: RowListSpec<T>,
  initial: string,
  onChange: OnChange
): RowListHandle<T> {
  let rows = spec.parse(initial);
  const list = el("div", { class: cls("rows") });
  /** Teardown for the currently-mounted rows, replaced on every render. */
  let disposers: (() => void)[] = [];
  /**
   * What this control last serialised, so `setValue` can recognise its own echo.
   *
   * The round trip through CSS is *lossy by design*: `serialize` drops disabled
   * rows, because a shadow you switched off should not appear in the source. So
   * re-parsing our own output deletes exactly the rows the eye is meant to keep,
   * and `panel.reseed` pushes computed style back at every registered control
   * after any refresh — a nudge, an undo, a discard. See `setValue`.
   */
  let committed = spec.serialize(rows);

  function commit(): void {
    committed = spec.serialize(rows);
    onChange(spec.cssProperty, committed);
  }

  /**
   * Fold an externally-changed value back in without losing switched-off rows.
   *
   * A disabled row is not in the CSS at all, so a re-parse cannot see one. Its
   * position is the only thing about it that survives, so the recorded index is
   * what puts it back — ascending, so each splice lands in an already-lengthened
   * list.
   */
  function merge(incoming: T[]): T[] {
    const hidden: { index: number; row: T }[] = [];
    rows.forEach((row, index) => {
      if (!spec.enabled(row)) {
        hidden.push({ index, row });
      }
    });
    if (hidden.length === 0) {
      return incoming;
    }
    const out = [...incoming];
    for (const { index, row } of hidden) {
      out.splice(Math.min(index, out.length), 0, row);
    }
    return out;
  }

  function disposeRows(): void {
    for (const off of disposers) {
      off();
    }
    disposers = [];
  }

  /**
   * Edit one row in place.
   *
   * Deliberately does *not* re-render: a row's body owns live inputs, and
   * rebuilding the list on every keystroke would drop the caret. The cost is
   * that a row whose display depends on its own value has to repaint itself —
   * see `shadowRow`'s type glyph and `fillLayerRow`'s kind glyph, both of which
   * used to go stale here.
   */
  function replace(index: number, next: T): void {
    rows = rows.map((r, i) => (i === index ? next : r));
    commit();
  }

  function render(): void {
    disposeRows();
    list.replaceChildren();
    if (!rows.length) {
      /*
       * Nothing. Not a "None" row.
       *
       * This used to render one, reasoning that a placeholder sized to the
       * control height stopped the section jumping when the first fill was
       * added. It buys that at the cost of stating a value the element does
       * not have, and it does not survive contact with a section that stacks
       * two lists: Filters showed "Layer / None / Background / None" for the
       * overwhelmingly common case of an element with no filters at all.
       * A design tool leaves the body empty and lets the header's `+` be the
       * affordance, which is what every one of these sections already has.
       */
      return;
    }
    rows.forEach((row, index) => {
      const on = spec.enabled(row);
      const content = spec.render(
        row,
        (next) => replace(index, next),
        (fn) => disposers.push(fn),
        index
      );

      const eye = el(
        "button",
        {
          "aria-label": on ? "Hide" : "Show",
          class: cls("row-icon"),
          "data-tip": on ? "Hide" : "Show",
          onClick: () => {
            rows = rows.map((r, i) =>
              i === index ? spec.setEnabled(r, !on) : r
            );
            commit();
            render();
          },
          type: "button",
        },
        [icon(on ? "eye" : "eye-off", "xs")]
      );

      const remove = el(
        "button",
        {
          "aria-label": "Remove",
          class: cls("row-icon"),
          "data-tip": "Remove",
          onClick: () => {
            rows = rows.filter((_, i) => i !== index);
            commit();
            render();
          },
          type: "button",
        },
        [icon("minus", "xs")]
      );

      /*
       * Reordering, which this control offered no way to do at all.
       *
       * Order is *semantics* in every list this renders: shadows paint back-to-front, and
       * `blur()` before `brightness()` is a different image from the reverse. The only way
       * to move a row was to delete it and re-add everything below it — and the docstring
       * on `onDispose` has always described dnd-kit grips that were never built.
       *
       * Buttons rather than a drag: two icons are keyboard-operable, announceable and need
       * no hit-testing, pointer capture or autoscroll — all of which the audit found
       * broken elsewhere in this file's neighbours. A list of two to five rows does not
       * need a drag to be quick.
       */
      const moveTo = (to: number): void => {
        if (to < 0 || to >= rows.length) {
          return;
        }
        const next = [...rows];
        const [moved] = next.splice(index, 1);
        next.splice(to, 0, moved);
        rows = next;
        commit();
        render();
      };
      const arrows = [
        { delta: -1, glyph: "chev-up", label: "Move up" },
        { delta: 1, glyph: "chev-down", label: "Move down" },
      ] as const;
      const grips = arrows.map(({ delta, glyph, label }) => {
        const at = index + delta;
        const button = el(
          "button",
          {
            "aria-label": label,
            class: cls("row-icon"),
            "data-tip": label,
            onClick: () => moveTo(at),
            type: "button",
          },
          [icon(glyph, "xs")]
        );
        // Disabled at the ends rather than hidden, so the row's controls do not
        // reflow as it moves through the list.
        button.toggleAttribute("disabled", at < 0 || at >= rows.length);
        return button;
      });

      // Into the line the row nominated, or beside the row when it named none.
      const slot = spec.actionSlot?.(content) ?? null;
      // Only worth showing when there is somewhere to move to.
      const actions = rows.length > 1 ? [...grips, eye, remove] : [eye, remove];
      const rowEl = el(
        "div",
        { class: cls("rows-row") },
        slot ? [content] : [content, ...actions]
      );
      slot?.append(...actions);
      if (!on) {
        rowEl.classList.add(cls("rows-off"));
      }
      list.append(rowEl);
    });
  }

  render();

  return {
    add() {
      rows = [...rows, spec.blank()];
      commit();
      render();
    },
    addRow(row) {
      rows = [...rows, row];
      commit();
      render();
    },
    destroy: disposeRows,
    element: list,
    properties: [spec.cssProperty],
    rows: () => rows,
    setValue(cssProperty, value) {
      if (cssProperty !== spec.cssProperty) {
        return;
      }
      /*
       * Nothing to do when the incoming value is what this list already says.
       *
       * Compared through `parse` → `serialize` rather than as text, because the
       * value arriving from a reseed is *computed* style: the engine has
       * normalised spacing, colour notation and shorthand order, so a textual
       * comparison against `committed` would report a difference on every
       * refresh and rebuild the list for no reason.
       *
       * Two bugs live behind this guard. Rebuilding drops disabled rows, since
       * they are absent from the CSS by design — so hiding a shadow and then
       * pressing an arrow key used to delete it outright, with no undo entry for
       * the deletion. And rebuilding calls `disposeRows`, which destroys the
       * live inputs inside every row: an undo replaced the Effects field you
       * were typing in, contradicting `panel.refresh`'s promise to keep "focus,
       * scroll, collapse state and any half-typed field".
       */
      const incoming = spec.parse(value);
      if (spec.serialize(incoming) === committed) {
        return;
      }
      // A real external change — an agent edit, or an undo past this control's
      // own writes. Take it, but carry the switched-off rows across.
      rows = merge(incoming);
      committed = spec.serialize(rows);
      render();
    },
  };
}
