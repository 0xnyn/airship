/*
 * Inspector property descriptors.
 *
 * Each descriptor maps one editable control to one CSS property; the agent (not
 * a deterministic transform) turns the resulting deltas into code.
 *
 * The shape is deliberately a design tool's, not the CSS spec's. That right rail does
 * not label a field "flex-direction" with a text rail down the left — the field
 * *carries its own glyph* and the glyph is the drag handle. `fieldIcon` and
 * `EnumOption.icon` are what buy that, and typing them as `IconName` rather than
 * `string` is what stopped the old `icon: "→"` text arrows from surviving.
 */
import type { IconName } from "../icons";
import type { ResizeMode } from "./sizing";

export type ControlType =
  | "segmented"
  | "select"
  | "number-scrub"
  | "color-swatch";

export type GroupId =
  | "layout"
  | "spacing"
  | "size"
  | "typography"
  | "appearance"
  | "position";

export interface EnumOption {
  /** Rendered as a real glyph; `label` becomes its tooltip. */
  icon?: IconName;
  label: string;
  value: string;
}

export interface Descriptor {
  /** For box-model: which cross this side belongs to. */
  compoundGroup?: "padding" | "margin";
  controlType: ControlType;
  /** Kebab-case CSS property this control writes. */
  cssProperty: string;
  /** Fallback display value when the computed value is empty/auto. */
  defaultValue: string;
  enumValues?: EnumOption[];
  /**
   * Leading glyph *inside* the field, which doubles as the scrub handle. When
   * set, the field carries its own identity and the row label is dropped.
   */
  fieldIcon?: IconName;
  /** One or two characters in the glyph slot when no icon fits ("W", "H"). */
  fieldLabel?: string;
  group: GroupId;
  /** Unique key within the panel. */
  key: string;
  label: string;
  max?: number;
  min?: number;
  /** Layout hint for the two-column field grid. Defaults to `half`. */
  span?: "half" | "full";
  step?: number;
  /** Rendered inside the field, after the value ("%", "°"). */
  suffix?: string;
  /** Unit appended to a bare number on commit ("px" | "" | "deg"…). */
  unit?: string;
  /** Hide this control unless the node warrants it. */
  visible?: (node: Element) => boolean;
}

export interface Group {
  descriptors: Descriptor[];
  id: GroupId;
  label: string;
  /** Hide the whole section unless the node warrants it. */
  visible?: (node: Element) => boolean;
}

const LAYOUT: Descriptor[] = [
  {
    controlType: "select",
    cssProperty: "display",
    defaultValue: "block",
    enumValues: [
      { label: "Block", value: "block" },
      { label: "Flex", value: "flex" },
      { label: "Grid", value: "grid" },
      { label: "Inline", value: "inline-flex" },
      { label: "None", value: "none" },
    ],
    group: "layout",
    // A select, not a segmented group. Five word-labelled options wrap onto two
    // rows in a 320px dock, and a control that reflows as you resize the dock
    // reads as a bug — the rule `select.ts` already states, applied here too.
    key: "display",
    label: "Display",
    span: "full",
  },
  {
    controlType: "segmented",
    cssProperty: "flex-direction",
    defaultValue: "row",
    enumValues: [
      { icon: "al-horizontal", label: "Horizontal", value: "row" },
      { icon: "al-vertical", label: "Vertical", value: "column" },
      { icon: "flip-h", label: "Horizontal reversed", value: "row-reverse" },
      { icon: "flip-v", label: "Vertical reversed", value: "column-reverse" },
    ],
    group: "layout",
    key: "flexDirection",
    label: "Direction",
    span: "full",
  },
  {
    controlType: "segmented",
    cssProperty: "flex-wrap",
    defaultValue: "nowrap",
    enumValues: [
      { icon: "al-horizontal", label: "No wrap", value: "nowrap" },
      { icon: "al-wrap", label: "Wrap", value: "wrap" },
    ],
    group: "layout",
    key: "flexWrap",
    label: "Wrap",
    span: "full",
  },
  {
    controlType: "number-scrub",
    cssProperty: "gap",
    defaultValue: "0px",
    fieldIcon: "gap-h",
    group: "layout",
    key: "gap",
    label: "Gap",
    min: 0,
    unit: "px",
  },
];

const SPACING: Descriptor[] = [
  padding("paddingTop", "Top", "padding-top", "pad-top"),
  padding("paddingRight", "Right", "padding-right", "pad-right"),
  padding("paddingBottom", "Bottom", "padding-bottom", "pad-bottom"),
  padding("paddingLeft", "Left", "padding-left", "pad-left"),
  margin("marginTop", "Top", "margin-top", "pad-top"),
  margin("marginRight", "Right", "margin-right", "pad-right"),
  margin("marginBottom", "Bottom", "margin-bottom", "pad-bottom"),
  margin("marginLeft", "Left", "margin-left", "pad-left"),
];

function padding(
  key: string,
  label: string,
  cssProperty: string,
  fieldIcon: IconName
): Descriptor {
  return {
    compoundGroup: "padding",
    controlType: "number-scrub",
    cssProperty,
    defaultValue: "0px",
    fieldIcon,
    group: "spacing",
    key,
    label,
    min: 0,
    unit: "px",
  };
}

/**
 * Margin has no design-tool equivalent — those frames space their children with gap
 * and padding, full stop. It is here anyway because this is a DOM editor and
 * margin is half of how web layouts are actually spaced; leaving it reachable
 * only from the CSS tab made the Design tab quietly incomplete.
 *
 * No `min`, unlike padding: negative margins are a legitimate and common
 * technique (pulling a child out of its parent's padding), and clamping them to
 * zero would silently refuse an edit rather than perform it.
 */
function margin(
  key: string,
  label: string,
  cssProperty: string,
  fieldIcon: IconName
): Descriptor {
  return {
    compoundGroup: "margin",
    controlType: "number-scrub",
    cssProperty,
    defaultValue: "0px",
    fieldIcon,
    group: "spacing",
    key,
    label,
    unit: "px",
  };
}

/**
 * W and H are the two spelled out in letters rather than glyphs — there is
 * no icon that reads as "width" faster than a W does. Everything else in the
 * Size group keeps its icon, so those two are the only entries here.
 *
 * Declared above `SIZE`, and it must stay there: `SIZE`'s initializer calls
 * `size()`, which reads this at module-init time. Sorting it below `SIZE`
 * alphabetically puts it in the temporal dead zone and the overlay dies on boot.
 */
const SIZE_FIELD_LABEL: Record<string, string | undefined> = {
  height: "H",
  width: "W",
};

const SIZE: Descriptor[] = [
  size("width", "W", "width", "size-fixed"),
  size("height", "H", "height"),
  size("minWidth", "Min W", "min-width", "size-min-w"),
  size("maxWidth", "Max W", "max-width", "size-max-w"),
  size("minHeight", "Min H", "min-height", "size-min-h"),
  size("maxHeight", "Max H", "max-height", "size-max-h"),
];

function size(
  key: string,
  label: string,
  cssProperty: string,
  fieldIcon?: IconName
): Descriptor {
  return {
    controlType: "number-scrub",
    cssProperty,
    defaultValue: "auto",
    // A field carries a letter or an icon, never both — see `SIZE_FIELD_LABEL`.
    fieldIcon: SIZE_FIELD_LABEL[key] ? undefined : fieldIcon,
    fieldLabel: SIZE_FIELD_LABEL[key],
    group: "size",
    key,
    label,
    min: 0,
    unit: "px",
  };
}

const TYPOGRAPHY: Descriptor[] = [
  {
    controlType: "number-scrub",
    cssProperty: "font-size",
    defaultValue: "16px",
    fieldIcon: "text-size",
    group: "typography",
    key: "fontSize",
    label: "Font size",
    min: 0,
    unit: "px",
  },
  {
    controlType: "number-scrub",
    cssProperty: "line-height",
    defaultValue: "normal",
    fieldIcon: "text-line-height",
    group: "typography",
    key: "lineHeight",
    label: "Line height",
    min: 0,
    // Deliberately unitless-capable: `line-height: 1.5` is the idiomatic form,
    // and forcing px here made it unreachable from this control.
    unit: "",
  },
  {
    controlType: "number-scrub",
    cssProperty: "letter-spacing",
    defaultValue: "normal",
    fieldIcon: "text-letter-spacing",
    group: "typography",
    key: "letterSpacing",
    label: "Letter spacing",
    unit: "px",
  },
  {
    controlType: "number-scrub",
    cssProperty: "margin-block-end",
    defaultValue: "0px",
    fieldIcon: "text-paragraph-spacing",
    group: "typography",
    key: "paragraphSpacing",
    label: "Paragraph spacing",
    min: 0,
    unit: "px",
  },
  /*
   * A select, and the only control that writes `font-weight`.
   *
   * It was five numeric pills — five text labels in a segmented group, which is
   * exactly the case `createSelect` exists for: they do not fit the rail, and
   * `.ctl-seg` wraps by default, so they silently reflowed onto a second row as
   * the dock narrowed. The Text section's style toggles also carried a Bold
   * button writing 700/400 to this same property, so a panel with a 500 showed
   * one control lit at 500 and another that had to say something about it.
   *
   * Named rather than numeric now. `600` is a number you match against the pill
   * you pressed last; "Semibold" is the thing you were looking for, and the
   * whole scale fits where five pills did not.
   */
  {
    controlType: "select",
    cssProperty: "font-weight",
    defaultValue: "400",
    enumValues: [
      { label: "Thin", value: "100" },
      { label: "Extra Light", value: "200" },
      { label: "Light", value: "300" },
      { label: "Regular", value: "400" },
      { label: "Medium", value: "500" },
      { label: "Semibold", value: "600" },
      { label: "Bold", value: "700" },
      { label: "Extra Bold", value: "800" },
      { label: "Black", value: "900" },
    ],
    group: "typography",
    key: "fontWeight",
    label: "Weight",
    span: "full",
  },
  {
    controlType: "segmented",
    cssProperty: "text-align",
    defaultValue: "left",
    enumValues: [
      { icon: "text-align-left", label: "Align left", value: "left" },
      { icon: "text-align-center", label: "Align center", value: "center" },
      { icon: "text-align-right", label: "Align right", value: "right" },
      { icon: "text-align-justify", label: "Justify", value: "justify" },
    ],
    group: "typography",
    key: "textAlign",
    label: "Align",
    span: "full",
  },
  {
    controlType: "color-swatch",
    cssProperty: "color",
    defaultValue: "#000000",
    group: "typography",
    key: "color",
    label: "Color",
    span: "full",
  },
];

const APPEARANCE: Descriptor[] = [
  {
    controlType: "number-scrub",
    cssProperty: "opacity",
    defaultValue: "1",
    fieldIcon: "opacity",
    group: "appearance",
    key: "opacity",
    label: "Opacity",
    max: 1,
    min: 0,
    step: 0.05,
    unit: "",
  },
  {
    controlType: "select",
    cssProperty: "mix-blend-mode",
    defaultValue: "normal",
    enumValues: [
      { label: "Normal", value: "normal" },
      { label: "Multiply", value: "multiply" },
      { label: "Screen", value: "screen" },
      { label: "Overlay", value: "overlay" },
      { label: "Darken", value: "darken" },
      { label: "Lighten", value: "lighten" },
      { label: "Color dodge", value: "color-dodge" },
      { label: "Color burn", value: "color-burn" },
      { label: "Hard light", value: "hard-light" },
      { label: "Soft light", value: "soft-light" },
      { label: "Difference", value: "difference" },
      { label: "Exclusion", value: "exclusion" },
      { label: "Hue", value: "hue" },
      { label: "Saturation", value: "saturation" },
      { label: "Color", value: "color" },
      { label: "Luminosity", value: "luminosity" },
    ],
    group: "appearance",
    // A design tool pairs opacity with blend mode in one Appearance row, and the two
    // really are one decision — how this layer composites with what is under it.
    // A select rather than a segmented group: sixteen word-labelled options
    // would wrap into four rows in a 360px dock.
    key: "mixBlendMode",
    label: "Blend mode",
    span: "full",
  },
];

/**
 * The generic, descriptor-driven sections.
 *
 * Only Text is left. Everything else is rendered bespoke — Auto Layout has the
 * 3×3 pad and the direction switch, Size has Hug/Fill/Fixed, Spacing has the
 * pair-or-four toggle, Appearance pairs opacity with corner radius — because
 * none of those reduce to one-control-per-CSS-property. Their descriptors still
 * live in this file and are read out of `LAYOUT_GROUP` / `SPACING_GROUP` /
 * `SIZE_GROUP` / `APPEARANCE_GROUP`: one place defines a control's units,
 * bounds and glyph, whichever pipeline renders it.
 */
export const GROUPS: Group[] = [
  {
    descriptors: TYPOGRAPHY,
    id: "typography",
    label: "Text",
    // A Text section on a bare layout div is six controls that do nothing.
    visible: hasText,
  },
];

/** Bespoke-rendered groups, exposed so the panel can read their descriptors. */
export const LAYOUT_GROUP: Group = {
  descriptors: LAYOUT,
  id: "layout",
  label: "Auto layout",
};
export const SPACING_GROUP: Group = {
  descriptors: SPACING,
  id: "spacing",
  label: "Spacing",
};
export const SIZE_GROUP: Group = {
  descriptors: SIZE,
  id: "size",
  label: "Size",
};
export const APPEARANCE_GROUP: Group = {
  descriptors: APPEARANCE,
  id: "appearance",
  label: "Appearance",
};

/** Tags that carry text even when they have element children (a button, a link). */
const TEXTY = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "li",
  "button",
  "label",
  "td",
  "th",
  "strong",
  "em",
  "small",
  "figcaption",
  "blockquote",
  "code",
]);

/** Does this node render text of its own? Gates the Text section. */
export function hasText(node: Element): boolean {
  if (TEXTY.has(node.tagName.toLowerCase())) {
    return true;
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Descriptors for the bespoke sections
//
// These do not go through `GROUPS` — their sections render by hand, because a
// 3x3 alignment pad, a Hug/Fill/Fixed switch and a pair-or-four padding toggle
// are not one-control-per-property. They live here anyway, with the rest, so
// that a control's units, bounds, glyph and option list have exactly one home
// whichever pipeline draws it.
// ---------------------------------------------------------------------------

/**
 * CSS `position`. A design tool has no equivalent — every layer is absolute there.
 *
 * A `select`, and the descriptor now says so. It used to declare `segmented`
 * while `renderConstraints` called `createSelect` on it regardless, which is
 * the descriptor lying about its own renderer — the exact class of drift
 * `descriptors.ts` exists to prevent.
 */
export const POSITION_MODE: Descriptor = {
  controlType: "select",
  cssProperty: "position",
  defaultValue: "static",
  enumValues: [
    { label: "Static", value: "static" },
    { label: "Relative", value: "relative" },
    { label: "Absolute", value: "absolute" },
    { label: "Fixed", value: "fixed" },
    { label: "Sticky", value: "sticky" },
  ],
  group: "position",
  key: "position",
  label: "Position",
  span: "full",
};

export const CONSTRAIN_H: Descriptor = {
  controlType: "segmented",
  cssProperty: "--constrain-h",
  defaultValue: "start",
  enumValues: [
    { icon: "align-left", label: "Left", value: "start" },
    { icon: "align-h-center", label: "Centre", value: "center" },
    { icon: "align-right", label: "Right", value: "end" },
    { icon: "distribute-h", label: "Left and right", value: "stretch" },
    { icon: "size-fill", label: "Scale", value: "scale" },
  ],
  group: "position",
  key: "constrainH",
  label: "Horizontal",
};

export const CONSTRAIN_V: Descriptor = {
  controlType: "segmented",
  cssProperty: "--constrain-v",
  defaultValue: "start",
  enumValues: [
    { icon: "align-top", label: "Top", value: "start" },
    { icon: "align-v-center", label: "Centre", value: "center" },
    { icon: "align-bottom", label: "Bottom", value: "end" },
    { icon: "distribute-v", label: "Top and bottom", value: "stretch" },
    { icon: "size-fill", label: "Scale", value: "scale" },
  ],
  group: "position",
  key: "constrainV",
  label: "Vertical",
};

/** Vertical text alignment, which is the *parent's* `align-items`. */
export const VERTICAL_ALIGN: Descriptor = {
  controlType: "segmented",
  cssProperty: "align-items",
  defaultValue: "stretch",
  enumValues: [
    { icon: "text-align-top", label: "Align top", value: "flex-start" },
    { icon: "text-align-middle", label: "Align middle", value: "center" },
    { icon: "text-align-bottom", label: "Align bottom", value: "flex-end" },
  ],
  group: "typography",
  key: "verticalAlign",
  /*
   * "Vertical", not "Align" and not "Vertical align".
   *
   * Not "Align" because `TEXT_ALIGN` above already owns that word and renders
   * three rows higher in the same section — two rows under one name, writing
   * different properties on different elements, is worse than a shorter word.
   * `CONSTRAIN_V` calls the same axis "Vertical" already.
   *
   * Not "Vertical align" because the 68px label rail neither ellipsises nor
   * clips: fourteen characters wrap to two lines and take the row's height with
   * them. "Blend mode" at ten is the longest label the panel ships.
   */
  label: "Vertical",
};

/** Border style. `none` is first because it is the resting state of most nodes. */
/**
 * Border style, as a select rather than a segmented group.
 *
 * `dotted` and `double` are as legal as the other three, and the imported set
 * ships glyphs for neither — `Stroke/Part-2` has solid and dash and then jumps
 * to caps and arrowheads. A five-option group mixing icon cells with text pills
 * is the shape `segmented.ts` was written to avoid, so all five wear words.
 */
export const STROKE_STYLE: Descriptor = {
  controlType: "select",
  cssProperty: "border-style",
  defaultValue: "none",
  enumValues: [
    { label: "None", value: "none" },
    { label: "Solid", value: "solid" },
    { label: "Dashed", value: "dashed" },
    { label: "Dotted", value: "dotted" },
    { label: "Double", value: "double" },
  ],
  group: "appearance",
  key: "borderStyle",
  label: "Style",
  span: "full",
};

/**
 * Letter case. Surfaced as a segmented group rather than four menu entries: it
 * is a state you need to *see*, and a design tool shows it.
 */
/**
 * The typographic axes the Text section had no controls for at all.
 *
 * A variable font's whole point is that weight, width and optical size are continuous —
 * and the section offered a weight select and nothing else, so the axes a designer picked
 * the font *for* were unreachable except through the CSS pane. `font-stretch` and
 * `font-variant` are the static-font equivalents of the same decisions.
 *
 * `font-variation-settings` and `font-feature-settings` stay free text: their grammar is
 * `"wght" 450, "opsz" 32`, the axis tags are per-font, and a closed control would have to
 * either guess the font's axes or refuse the ones it does not know.
 */
export const FONT_STRETCH: Descriptor = {
  controlType: "number-scrub",
  cssProperty: "font-stretch",
  defaultValue: "100%",
  group: "typography",
  key: "fontStretch",
  label: "Width",
  max: 200,
  min: 50,
  unit: "%",
};

export const FONT_OPTICAL_SIZING: Descriptor = {
  controlType: "segmented",
  cssProperty: "font-optical-sizing",
  defaultValue: "auto",
  enumValues: [
    { label: "Auto", value: "auto" },
    { label: "None", value: "none" },
  ],
  group: "typography",
  key: "fontOpticalSizing",
  label: "Optical sizing",
  span: "full",
};

export const FONT_VARIANT: Descriptor = {
  controlType: "select",
  cssProperty: "font-variant",
  defaultValue: "normal",
  enumValues: [
    { label: "Normal", value: "normal" },
    { label: "Small caps", value: "small-caps" },
    { label: "All small caps", value: "all-small-caps" },
    { label: "Oldstyle numerals", value: "oldstyle-nums" },
    { label: "Lining numerals", value: "lining-nums" },
    { label: "Tabular numerals", value: "tabular-nums" },
    { label: "Proportional numerals", value: "proportional-nums" },
  ],
  group: "typography",
  key: "fontVariant",
  label: "Variant",
  span: "full",
};

export const TEXT_CASE: Descriptor = {
  controlType: "segmented",
  cssProperty: "text-transform",
  defaultValue: "none",
  enumValues: [
    { icon: "text-lowercase", label: "Original case", value: "none" },
    { icon: "text-uppercase", label: "Uppercase", value: "uppercase" },
    { icon: "text-titlecase", label: "Title case", value: "capitalize" },
  ],
  group: "typography",
  key: "textTransform",
  label: "Case",
};

/** The four sides, in clockwise-from-top order. */
export const STROKE_SIDES: { icon: IconName; label: string; name: string }[] = [
  { icon: "border-top", label: "Top", name: "top" },
  { icon: "border-right", label: "Right", name: "right" },
  { icon: "border-bottom", label: "Bottom", name: "bottom" },
  { icon: "border-left", label: "Left", name: "left" },
];

/**
 * Where the stroke sits relative to the element's declared size. Two options,
 * not the design-tool three — see the comment at the control.
 *
 * `cssProperty` is the pseudo-property `--stroke-position`, not `box-sizing`.
 * The control emits `inside`/`outside` and the caller translates those into
 * `box-sizing: border-box | content-box`, so a descriptor claiming to write
 * `box-sizing` would be describing a value it never produces — and `setValue`
 * would then match on the wrong property and never fire. `CONSTRAIN_H` and
 * `CONSTRAIN_V` already use this convention for the same reason.
 */
export const STROKE_POSITION: Descriptor = {
  controlType: "segmented",
  cssProperty: "--stroke-position",
  defaultValue: "inside",
  enumValues: [
    { label: "Inside", value: "inside" },
    // Shown and disabled by the caller. A design tool has three positions and someone
    // who knows that will go looking for the third; a greyed cell that says why
    // answers the question, where two cells and a silence does not.
    { label: "Centre", value: "centre" },
    { label: "Outside", value: "outside" },
  ],
  group: "appearance",
  key: "strokePosition",
  label: "Position",
};

export const MODE_TEXT: Record<ResizeMode, string> = {
  fill: "Fill",
  fixed: "Fixed",
  hug: "Hug",
};

export const MODE_NOTE: Record<ResizeMode, string> = {
  fill: "takes the remaining space",
  fixed: "a set length",
  hug: "as small as the content allows",
};

/**
 * Auto layout's direction, with Wrap as a third option.
 *
 * Not one of `LAYOUT_GROUP`'s descriptors because it does not map to one
 * property: Wrap is `flex-direction: row` *and* `flex-wrap: wrap`. The
 * segmented group takes an `onSelect` for that, and a `derive` to fold the two
 * back into one answer.
 */
export const FLEX_DIRECTION: Descriptor = {
  controlType: "segmented",
  cssProperty: "flex-direction",
  defaultValue: "row",
  enumValues: [
    { icon: "al-horizontal", label: "Horizontal", value: "row" },
    { icon: "al-vertical", label: "Vertical", value: "column" },
    { icon: "al-wrap", label: "Wrap", value: "wrap" },
  ],
  group: "layout",
  key: "flexDirection",
  label: "Direction",
  span: "full",
};

/**
 * The gap descriptor, with the glyph that matches the axis the gap runs along.
 * A design tool swaps this icon with the direction, and it is the fastest read in the
 * whole panel for "which way is this laid out".
 */
/**
 * Grid's own alignment and flow, which the Auto layout section skipped entirely.
 *
 * `createAlignPad` is flex-only — the section returned early for a grid — so a grid
 * container had a track editor and nothing else: no way to align its items, no
 * `grid-auto-flow`, and a single `gap` field carrying a horizontal glyph for both axes.
 * These are the grid spellings of the same decisions.
 */
export const JUSTIFY_ITEMS: Descriptor = {
  controlType: "segmented",
  cssProperty: "justify-items",
  defaultValue: "stretch",
  enumValues: [
    { icon: "align-left", label: "Start", value: "start" },
    { icon: "align-h-center", label: "Center", value: "center" },
    { icon: "align-right", label: "End", value: "end" },
    { icon: "distribute-h", label: "Stretch", value: "stretch" },
  ],
  group: "layout",
  key: "justifyItems",
  label: "Align items horizontally",
  span: "full",
};

export const ALIGN_ITEMS_GRID: Descriptor = {
  controlType: "segmented",
  cssProperty: "align-items",
  defaultValue: "stretch",
  enumValues: [
    { icon: "align-top", label: "Start", value: "start" },
    { icon: "align-v-center", label: "Center", value: "center" },
    { icon: "align-bottom", label: "End", value: "end" },
    { icon: "distribute-v", label: "Stretch", value: "stretch" },
  ],
  group: "layout",
  key: "alignItemsGrid",
  label: "Align items vertically",
  span: "full",
};

export const GRID_AUTO_FLOW: Descriptor = {
  controlType: "select",
  cssProperty: "grid-auto-flow",
  defaultValue: "row",
  enumValues: [
    { label: "Row", value: "row" },
    { label: "Column", value: "column" },
    { label: "Row dense", value: "row dense" },
    { label: "Column dense", value: "column dense" },
  ],
  group: "layout",
  key: "gridAutoFlow",
  label: "Auto flow",
  span: "full",
};

/** Row and column gap as separate fields — grid's two axes are independent. */
export function GRID_GAP(axis: "row" | "column"): Descriptor {
  return {
    controlType: "number-scrub",
    cssProperty: `${axis}-gap`,
    defaultValue: "0",
    fieldIcon: axis === "row" ? "gap-v" : "gap-h",
    group: "layout",
    key: `${axis}Gap`,
    label: axis === "row" ? "Row gap" : "Column gap",
    min: 0,
    unit: "px",
  };
}

export function LAYOUT_GAP(column: boolean): Descriptor {
  return {
    controlType: "number-scrub",
    cssProperty: "gap",
    defaultValue: "0px",
    fieldIcon: column ? "gap-v" : "gap-h",
    group: "layout",
    key: "gap",
    label: "Gap between items",
    min: 0,
    unit: "px",
  };
}
