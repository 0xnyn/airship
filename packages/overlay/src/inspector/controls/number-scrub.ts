import { keywordsFor, LENGTH_UNITS } from "../css-length";
import type { Descriptor } from "../descriptors";
import { createNumField, type NumSpec } from "./num-field";
import type { ControlHandle, Gestures, OnChange } from "./types";

/*
 * The descriptor pipeline's numeric control.
 *
 * All the behaviour lives in `num-field.ts`; this is the ~30 lines that turn a
 * `Descriptor` into a `NumSpec` and a `NumHandle` into a `ControlHandle`. It
 * used to *be* the implementation, which is why five other places grew their
 * own copy of it — a control that can only be built from a full `Descriptor` is
 * unreachable from anything that edits four longhands at once, or one channel
 * of a colour, or an entry in a serialised shadow list.
 */

/** Translate a descriptor into the field spec it describes. */
export function specOf(descriptor: Descriptor): NumSpec {
  const unitless = descriptor.unit === "";
  return {
    fieldKey: descriptor.key,
    glyph: descriptor.fieldIcon ?? descriptor.fieldLabel,
    /*
     * Asked of the property, not handed out uniformly.
     *
     * This was one shared list — `auto, none, normal, inherit, initial, unset`
     * — given to every length field in the panel. Three of those are invalid on
     * most of the properties that got them, and `font-size: auto` was the
     * result: typed, accepted, repainted as though it had worked, and queued
     * for the agent. `keywordsFor` knows which words each property actually
     * takes, and always includes the globals, which really are legal anywhere.
     */
    keywords: keywordsFor(descriptor.cssProperty),
    label: descriptor.label,
    max: descriptor.max,
    min: descriptor.min,
    step: descriptor.step,
    suffix: descriptor.suffix,
    unit: descriptor.unit ?? "px",
    // A unitless field (opacity, line-height, z-index) takes a bare ratio, and
    // offering it `20rem` would be offering a value the property cannot use.
    // `line-height` is the one that also wants px, so it opts in by declaring
    // its own unit rather than by being special-cased here.
    units: unitless ? [] : [...LENGTH_UNITS],
  };
}

/** Number field with a drag-to-scrub grip. Emits live changes while dragging. */
export function createNumberScrub(
  descriptor: Descriptor,
  initial: string,
  onChange: OnChange,
  gestures?: Gestures
): ControlHandle {
  const field = createNumField(
    specOf(descriptor),
    initial || descriptor.defaultValue,
    (css) => onChange(descriptor.cssProperty, css),
    gestures
  );

  return {
    destroy: field.destroy,
    element: field.element,
    onActivate: (open) => field.onActivate(open),
    properties: [descriptor.cssProperty],
    setToken: (name) => field.setToken(name),
    setValue(cssProperty, value) {
      if (cssProperty === descriptor.cssProperty) {
        field.setValue(value);
      }
    },
  };
}
