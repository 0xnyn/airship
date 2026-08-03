/**
 * The two shapes every section was re-declaring.
 *
 * `labelled` had been written out six times — twice as a private function with
 * identical bodies, three times inline, and once more in `panel.ts` — and the
 * enum-select descriptor factory twice, byte for byte. Neither is interesting
 * enough to own; both are interesting enough that six copies drift.
 */
import { cls, el } from "../../dom";
import type { Descriptor, EnumOption } from "../descriptors";

/**
 * A full-width labelled row: a name on the left rail, then the controls taking
 * the rest of the line.
 *
 * `span2` because the field grid is two columns and a labelled row is a
 * statement about one thing, not two.
 *
 * Variadic because a labelled row is not always one box, and every caller that
 * discovered this worked around it separately: `fieldCell` wrote the whole
 * shape out by hand to get a token badge in after the control, the source rows
 * `append` a kebab onto whichever of the two the menu acts on, and Text's Case
 * row carries the overflow menu. One trailing affordance beside a control is
 * the panel's most ordinary row, and it was the one shape this helper could not
 * express — which is exactly the drift the note above is about. (The source
 * rows keep their `append`: which row gets the kebab is decided at runtime, so
 * there is nothing to pass here.)
 */
export function labelled(
  text: string,
  ...controls: HTMLElement[]
): HTMLElement {
  return el("div", { class: `${cls("row")} ${cls("span2")}` }, [
    el("span", { class: cls("row-label"), text }),
    ...controls,
  ]);
}

/**
 * A descriptor for a word-labelled enum, rendered as a dropdown.
 *
 * Always `span: "full"` and always a select: these are the properties whose
 * values are words rather than glyphs, and five text options in a 320px rail
 * wrap into two rows as a segmented group.
 */
export function enumDescriptor(
  key: string,
  cssProperty: string,
  label: string,
  values: EnumOption[],
  defaultValue: string
): Descriptor {
  return {
    controlType: "select",
    cssProperty,
    defaultValue,
    enumValues: values,
    group: "appearance",
    key,
    label,
    span: "full",
  };
}
