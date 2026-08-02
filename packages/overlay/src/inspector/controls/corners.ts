import type { IconName } from "../../icons";
import type { TokenSlotFor } from "../sections/context";
import { createQuadField } from "./quad-field";
import type { ControlHandle, Gestures, OnChange } from "./types";

/*
 * Corner radius: one field, with a switch to four.
 *
 * The mechanics live in `quad-field.ts`, shared with the stroke's per-side
 * widths — the same mode-switch vocabulary in the same position. Two features
 * sharing a shape is what makes a panel read as a system rather than a pile of
 * controls.
 */

const CORNERS: { glyph: IconName; label: string; property: string }[] = [
  {
    glyph: "corner-tl",
    label: "Top left",
    property: "border-top-left-radius",
  },
  {
    glyph: "corner-tr",
    label: "Top right",
    property: "border-top-right-radius",
  },
  {
    glyph: "corner-bl",
    label: "Bottom left",
    property: "border-bottom-left-radius",
  },
  {
    glyph: "corner-br",
    label: "Bottom right",
    property: "border-bottom-right-radius",
  },
];

export function createCorners(
  initial: Map<string, string>,
  onChange: OnChange,
  gestures?: Gestures,
  tokenSlot?: TokenSlotFor
): ControlHandle {
  return createQuadField(
    {
      collapsed: { glyph: "corner-tl", label: "Corner radius" },
      sides: CORNERS,
      suffix: "radius",
      toggle: { glyph: "corners-independent", label: "Independent corners" },
      tokenSlot,
    },
    initial,
    onChange,
    gestures
  );
}

export const CORNER_PROPERTIES = CORNERS.map((c) => c.property);
