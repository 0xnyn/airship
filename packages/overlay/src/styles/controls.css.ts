import { PREFIX } from "../dom";
import { ROOT } from "./const";

/** Inspector control widgets: fields, segmented groups, box model, swatches. */
export const css = `
/*
 * A value the element does not declare — it comes from an ancestor.
 *
 * Dimmed rather than badged: the panel is dense, and an extra glyph per inherited
 * field would be most of a typography section. The tooltip on the control names the
 * ancestor; this is the at-a-glance half, and it reads as "not set here" without
 * claiming the value is wrong. See DesignPanel.markInherited.
 */
.${PREFIX}-ctl-num[data-inherited] .${PREFIX}-ctl-input,
.${PREFIX}-select[data-inherited],
.${PREFIX}-ctl-seg[data-inherited] {
  opacity: 0.62;
}

/* The widths below which a control stops being readable.

   The panel is resizable from 280px to 720px and nothing in it ever wrapped:
   every box is min-width: 0, so a field just shrank until its value was gone.
   These are the floors that make it reflow instead — stated once here and read
   by the grid track lists and flex bases further down, rather than restated as a
   breakpoint in each of the four contexts that would need a different one. A
   container query would have worked and was the first design; it was dropped
   because every threshold would have had to hard-code its neighbours' constants
   (the section's 48px of padding, a row list's 44px of icons, the 68px label
   rail), and because it cannot reach the stroke popover, which reuses .row and
   .grid outside the panel's subtree.

   Deliberately overlay-local vars and not --ap-*. That namespace belongs to
   @airship/editor-tokens, and EDITOR.md's control block is a *rhythm* scale —
   one height and four gaps. A measurement of one control's contents is not a
   rhythm value, and filing it beside {control.group-gap} would tell the next
   reader they are the same kind of quantity. Same reasoning as the pad's
   hairlines below, which stay literals for being drawing units. */
${ROOT} {
  /* A number field at its floor: 20px glyph + 2x2px input padding + 2x1px
     border + six glyphs of JetBrains Mono at {font-size.label} (0.6em advance,
     so 43px) = 69px. .paint-pct, .grad-angle and .grad-stop-row all land on 72
     too, by a different derivation — they agree by coincidence, not by
     construction, so they keep their own literals. */
  --${PREFIX}-field-min: 72px;
  /* And the width at which it stops being *tight*. Nine or ten glyphs, so a
     signed length with a unit — "-12.5px" — has room around it.

     Two numbers rather than one because they answer different questions, and
     conflating them is a bug with a shape: a reflow whose trigger is the floor
     lands exactly on the floor, so the control halves the moment it "fits" and
     the panel getting wider makes its fields smaller. Both crossovers below —
     the label rail, and the shadow row going four across — are keyed to this
     one, and every hard minimum to the one above. */
  --${PREFIX}-field-roomy: 96px;
  /* A labelled row's control, before the 68px label rail gives up its line.
     Set by the widest thing that is not a pad row: three word pills reading
     "Inside / Centre / Outside", which want 192 between them. Under that the
     rail stacks, which is cheaper than ellipsing a word. */
  --${PREFIX}-row-ctl-min: 192px;
  /* "#AABBCC" — seven mono glyphs (50px) plus the 12px empty glyph slot and
     4px of padding. */
  --${PREFIX}-hex-min: 66px;
}

/* Keyboard focus, in one place.
   Every control below is a real <button> and every one of them was invisible to
   the keyboard: exactly one :focus-visible rule existed in this file, on the
   row-icon. Tabbing through the panel moved a focus ring nobody could see.
   Inset on the pad and segment cells because they sit flush inside a filled
   track, where an outset ring would be clipped by the parent's overflow. */
${[
  "ctl-seg-btn",
  "pad-cell",
  "pad-mode",
  "pad-spread",
  "sect-act",
  "anchor-bar",
  "select",
  "row-icon",
  "tree-act",
  "iconbtn",
  "fbar-btn",
  "ctl-toggle",
]
  .map((c) => `.${PREFIX}-${c}:focus-visible`)
  .join(",\n")} {
  outline: 1px solid var(--ap-border-focus);
  outline-offset: -1px;
  opacity: 1;
}
.${PREFIX}-align-btn:focus-visible,
.${PREFIX}-insp-tab:focus-visible {
  outline: 1px solid var(--ap-border-focus); outline-offset: -2px; opacity: 1;
}
.${PREFIX}-sect-head:focus-visible {
  outline: 1px solid var(--ap-border-focus); outline-offset: -2px; opacity: .9;
}

/* Number field.
   A design tool's fields are borderless until you touch them — the always-on 1px boxes
   are what made this panel read as a web form. The leading glyph is the field's
   own label AND its scrub handle, which is why it takes the ew-resize cursor
   rather than the input doing so. */
.${PREFIX}-ctl-num {
  display: flex; align-items: center; gap: var(--ap-control-field-gap); min-width: 0;
  height: var(--ap-control-height); padding-left: var(--ap-control-field-gap);
  border: 1px solid transparent; border-radius: var(--ap-radius-sm);
  background: transparent; transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease), border-color var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-ctl-num:hover { background: var(--ap-surface-hover); }
.${PREFIX}-ctl-num:focus-within {
  background: var(--ap-surface-active); border-color: var(--ap-primary);
}
/* Either a span (the scrub handle) or a real button (the gradient opener), so
   it resets the button chrome rather than assuming it is never one. */
.${PREFIX}-ctl-glyph {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex: 0 0 auto;
  padding: 0; border: 0; background: transparent; color: var(--ap-icon-muted);
  cursor: ew-resize; user-select: none; touch-action: none;
}
/* A field with no glyph still gets the slot, because the slot is the scrub
   handle. At the full 20px it was pure dead space: the alpha field is 62px
   wide, and 20 of those going to an empty box left ~22px for the value, which
   is where "100%" was being clipped. Narrow enough to still be a drag target,
   not so wide that it costs the number its digits. */
.${PREFIX}-ctl-glyph:empty { width: 12px; }
.${PREFIX}-ctl-num:hover .${PREFIX}-ctl-glyph { color: var(--ap-icon-secondary); }
.${PREFIX}-ctl-glyph .${PREFIX}-ic { color: inherit; }
.${PREFIX}-ctl-glyph-static { cursor: default; }
.${PREFIX}-ctl-glyph-txt {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  line-height: 1; opacity: .85;
}
.${PREFIX}-ctl-input {
  flex: 1 1 auto; width: 100%; min-width: 0;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label);
  color: var(--ap-text-primary);
  background: transparent; border: 0; padding: 0 var(--ap-control-field-gap);
}
.${PREFIX}-ctl-input:focus { outline: none; }
.${PREFIX}-ctl-suffix {
  flex: 0 0 auto; padding-right: var(--ap-control-field-gap);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  color: var(--ap-text-tertiary);
}
/* A unit belongs to the number it follows, so the suffix goes to meet it.

   The goal has not changed. The input is \`flex: 1 1 auto\`, so it absorbed every
   pixel between the digits and the rigid suffix: the fill row's alpha field
   rendered "25" and its "%" about 29px apart, at two different sizes and two
   different tones, which read as two controls rather than one value.

   What changed is which half moves. Sending the *number* right closed that gap
   but bought a second one: Rotation right-aligned while X, Y and Z beside it —
   same row, same field, no suffix — stayed left, so four numbers that belong to
   one element sat on two different margins. Nothing about a degree sign should
   move the digits it qualifies.

   So the input sizes to its content and the suffix follows it. Both stay on the
   left margin, the unit still touches its number, and alignment stops depending
   on whether a field happens to carry a unit.

   \`field-sizing\` is the only way to content-size a replaced element in CSS, and
   it is Chromium-and-Safari for now. The old rule is the fallback rather than
   nothing: without it Firefox would render the 29px gap this rule exists to
   close, which is worse than an alignment that varies by unit. */
.${PREFIX}-ctl-num:has(> .${PREFIX}-ctl-suffix) > .${PREFIX}-ctl-input {
  field-sizing: content;
  flex: 0 1 auto; width: auto; min-width: 2ch; max-width: 100%;
}
@supports not (field-sizing: content) {
  .${PREFIX}-ctl-num:has(> .${PREFIX}-ctl-suffix) > .${PREFIX}-ctl-input {
    flex: 1 1 auto; width: 100%; min-width: 0; max-width: none;
    text-align: right;
  }
}

/* Segmented group. Text options stay pills; an all-icon group becomes square
   cells one control tall, which is the shape a design tool uses. */
.${PREFIX}-ctl-seg {
  display: flex; gap: var(--ap-control-field-gap); background: var(--ap-surface-active);
  border-radius: var(--ap-radius-sm); padding: var(--ap-control-field-gap); flex-wrap: wrap;
}
.${PREFIX}-ctl-seg-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px var(--ap-space-xs); border: none; background: transparent;
  color: var(--ap-text-primary);
  opacity: .6; border-radius: var(--ap-radius-xs); cursor: pointer; font-size: var(--ap-font-size-body);
  font-family: var(--ap-font-sans); transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease), opacity var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-ctl-seg-btn:hover { opacity: .9; background: var(--ap-surface-hover); }
/* A word pill's safety net. In a labelled row the cells take \`min-width: 0\`
   (see inspector.css.ts), which makes their hypothetical main size zero — so
   the group never wraps and a long label simply painted over its neighbour
   instead. Stroke position ("Inside/Centre/Outside") is the one group narrow
   enough to reach it. With the label rail now stacking before that happens the
   words fit anyway; this is what stops it being silent if they ever do not. */
.${PREFIX}-ctl-seg-btn > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.${PREFIX}-ctl-seg[data-variant="icon"] { flex-wrap: nowrap; }
.${PREFIX}-ctl-seg[data-variant="icon"] .${PREFIX}-ctl-seg-btn {
  flex: 1 1 0; padding: 0; height: var(--ap-control-height); min-width: var(--ap-control-height);
}
.${PREFIX}-ctl-seg-on { background: var(--ap-primary); color: var(--ap-text-primary); opacity: 1; }
.${PREFIX}-ctl-seg-on:hover { background: var(--ap-primary-hover); }
${ROOT} .${PREFIX}-ctl-seg-on .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-text-primary); }
/* ---- Auto layout ------------------------------------------------------- */

/* Direction row, then the 3x3 pad beside a stack of fields — the design-tool layout. */
/* No margin under the direction row: \`.al-main\` carries \`group\`, so the
   section body puts a group-gap between them the same way it does everywhere
   else. A margin here would be added to that gap, not instead of it. */
.${PREFIX}-al-main { display: flex; align-items: flex-start; gap: var(--ap-control-gutter); }
.${PREFIX}-al-fields { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--ap-control-row-gap); }

/* The 3x3 alignment pad. Each cell previews its result with three bars drawn
   as pseudo-elements — nine more SVGs would cost ~8KB to say the same thing
   less clearly, and these can respond to the direction with CSS alone.

   The literal 1px and 1.5px below are the only gaps in this file that are not
   on the control rhythm, and deliberately so: they are hairlines *inside a
   drawing*, sized against the 72px pad and the 11px ink bars. Snapping them to
   a 2px spacing token would visibly thicken the widget while telling the reader
   they are the same kind of quantity as the space between two fields. */
/* Room for the spread button, which hangs 20px below the pad on \`bottom: -20px\`
   and is out of flow — so the wrap measured 72px, the fields column beside it
   measured 80 in sides mode, and the button painted straight through the
   padding row's second line. Reserving its height is what makes "below the pad"
   a place rather than an overlap. */
.${PREFIX}-pad-wrap {
  position: relative; flex: 0 0 auto; padding-bottom: var(--ap-space-md);
}
.${PREFIX}-pad {
  display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr);
  width: 72px; height: 72px; gap: 1px;
  background: var(--ap-surface-active); border-radius: var(--ap-radius-sm);
  overflow: hidden;
}
.${PREFIX}-pad-cell {
  display: grid; place-items: center; border: 0; padding: 0; cursor: pointer;
  background: transparent; transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-pad-cell:hover { background: var(--ap-surface-hover); }
.${PREFIX}-pad-on { background: var(--ap-primary-bg); }

/* The ink: three bars whose stacking axis follows the container's direction,
   so the preview reads correctly in both row and column mode. Differing
   lengths are what make the alignment legible at this size. */
.${PREFIX}-pad-ink {
  display: flex; gap: 1.5px; pointer-events: none;
  --${PREFIX}-ink: var(--ap-icon-muted);
}
.${PREFIX}-pad-ink i { background: var(--${PREFIX}-ink); border-radius: 1px; }
.${PREFIX}-pad-cell:hover .${PREFIX}-pad-ink { --${PREFIX}-ink: var(--ap-icon-secondary); }
.${PREFIX}-pad-on .${PREFIX}-pad-ink { --${PREFIX}-ink: var(--ap-primary); }

/* Row: three vertical bars, aligned to the cell's row band. */
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-ink { flex-direction: row; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-ink i { width: 2px; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-ink i:nth-child(1) { height: 11px; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-ink i:nth-child(2) { height: 7px; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-ink i:nth-child(3) { height: 9px; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-cell[data-row="0"] .${PREFIX}-pad-ink { align-items: flex-start; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-cell[data-row="1"] .${PREFIX}-pad-ink { align-items: center; }
.${PREFIX}-pad[data-dir="row"] .${PREFIX}-pad-cell[data-row="2"] .${PREFIX}-pad-ink { align-items: flex-end; }

/* Column: three horizontal bars. */
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-ink { flex-direction: column; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-ink i { height: 2px; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-ink i:nth-child(1) { width: 11px; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-ink i:nth-child(2) { width: 7px; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-ink i:nth-child(3) { width: 9px; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-cell[data-col="0"] .${PREFIX}-pad-ink { align-items: flex-start; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-cell[data-col="1"] .${PREFIX}-pad-ink { align-items: center; }
.${PREFIX}-pad[data-dir="column"] .${PREFIX}-pad-cell[data-col="2"] .${PREFIX}-pad-ink { align-items: flex-end; }

/* space-between owns the main axis, so the pad's main axis stops meaning
   anything and says so rather than silently disagreeing with the canvas. */
.${PREFIX}-pad[data-spread="true"] .${PREFIX}-pad-cell { opacity: .4; }

.${PREFIX}-pad-spread {
  position: absolute; left: 0; right: 0; bottom: -20px;
  justify-content: center;
  display: inline-flex; align-items: center; gap: var(--ap-control-field-gap);
  height: 18px; padding: 0 5px; border: 0; cursor: pointer;
  background: transparent; border-radius: var(--ap-radius-xs);
}
.${PREFIX}-pad-spread span { width: 2px; height: 9px; background: var(--ap-icon-muted); border-radius: 1px; }
.${PREFIX}-pad-spread:hover { background: var(--ap-surface-active); }
.${PREFIX}-pad-spread:hover span { background: var(--ap-icon-secondary); }

/* Padding: two fields with a switch to four. */
.${PREFIX}-pad-row { display: flex; align-items: flex-start; gap: var(--ap-control-field-gap); }
/* auto-fit, and that is the whole point rather than a flourish.

   This grid holds two fields, or four in a 2x2 — but \`createQuadField\`
   collapsed renders exactly *one*, and a lone child in a fixed \`1fr 1fr\` took
   half the box and left the other half empty. In Appearance that box is already
   a half-width grid cell, so the everyday state of the corner radius field —
   four corners agreeing — was 58px wide at the default dock width, of which 20
   was the glyph. It was the narrowest field in the panel and it was narrow in
   the common case, not the edge case.

   auto-fit collapses the empty track and the gutter beside it, so one field
   takes the row. The max() caps the count at two when there is room and drops
   it to one when a field would go under its floor. auto-fit rather than
   auto-fill precisely because collapsing is the fix here; the .grid below wants
   the opposite and says so. */
.${PREFIX}-pad-fields {
  flex: 1 1 auto; min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit,
    minmax(max(var(--${PREFIX}-field-min), (100% - var(--ap-control-gutter)) / 2), 1fr));
  gap: var(--ap-control-field-gap) var(--ap-control-gutter);
}
/* Four fields cannot be a 2x2 inside a half-width cell: (S-8)/2 - 26 has to
   reach 2x72 + 8, i.e. a section 372px wide, which is a 424px dock. So a quad
   that has split takes the whole row instead. \`data-mode\` is published by
   \`createQuadField\` for this, the way \`createPadding\` already published it. */
.${PREFIX}-grid > .${PREFIX}-pad-row[data-mode="sides"] { grid-column: 1 / -1; }
.${PREFIX}-pad-mode {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: var(--ap-control-height); height: var(--ap-control-height);
  padding: 0; border: 0; cursor: pointer; background: transparent;
  border-radius: var(--ap-radius-xs); transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-pad-mode:hover { background: var(--ap-surface-active); }
.${PREFIX}-pad-mode-on { background: var(--ap-primary-bg); }
${ROOT} .${PREFIX}-pad-mode-on .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-primary); }

/* Size: a W/H field with its Hug/Fill/Fixed switch on the same line.

   The two rows and the aspect lock share one flex line rather than living in
   the two-column .grid: a .size-row already spans both of that grid's columns,
   so a lock appended as a third child auto-placed onto a row of its own
   underneath them — which is what it did. Here the rows stack in a column and
   the lock is their sibling, so "beside the two fields" is structural. */
.${PREFIX}-size-wrap {
  display: flex; align-items: center; gap: var(--ap-control-gutter);
}
.${PREFIX}-size-rows {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; gap: var(--ap-control-row-gap);
}
/* Two children, or three when the axis has a sizing token — so the columns are
   counted rather than declared. \`1fr auto\` with a badge between the field and
   the Fixed/Hug/Fill switch auto-placed the switch onto an implicit second row
   underneath, which is what it did in any project declaring width/height
   tokens. \`grid-auto-flow: column\` gives the extra child a track of its own,
   and no trailing gap when there is no badge. The minmax floor makes the row
   overflow rather than crush the W/H field, which cannot happen in range
   (72 + 8 + 37 + 8 + 80 = 205, against 230 at the narrowest dock). */
.${PREFIX}-size-row {
  display: grid;
  grid-template-columns: minmax(var(--${PREFIX}-field-min), 1fr);
  grid-auto-flow: column; grid-auto-columns: auto;
  gap: var(--ap-control-gutter);
  align-items: center;
}

.${PREFIX}-grid-tracks { display: flex; flex-direction: column; gap: var(--ap-control-row-gap); }

/* A labelled on/off toggle — Clip content, and anything else that is one
   boolean with a name. A segmented group of two would be the alternative and
   it is the wrong shape: "on" and "off" are not two peer choices you pick
   between, they are one state you flip. */
.${PREFIX}-ctl-toggle {
  display: inline-flex; align-items: center; gap: var(--ap-control-gutter);
  height: var(--ap-control-height); padding: 0 var(--ap-space-xs) 0 4px;
  cursor: pointer; background: transparent; color: var(--ap-text-secondary);
  border: 1px solid transparent; border-radius: var(--ap-radius-sm);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease), color var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-ctl-toggle { --${PREFIX}-ic-tone: var(--ap-icon-muted); }
.${PREFIX}-ctl-toggle:hover {
  background: var(--ap-surface-hover); color: var(--ap-text-primary);
}
${ROOT} .${PREFIX}-ctl-toggle:hover .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-secondary); }
.${PREFIX}-ctl-toggle-on {
  background: var(--ap-primary-bg); color: var(--ap-text-primary);
}
${ROOT} .${PREFIX}-ctl-toggle-on .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-primary); }

/* ---- Repeatable rows (Fill / Stroke / Effects) -------------------------- */
.${PREFIX}-rows { display: flex; flex-direction: column; gap: var(--ap-control-row-gap); }
.${PREFIX}-rows-row { display: flex; align-items: center; gap: var(--ap-control-field-gap); }
/* A real basis rather than \`auto\`. The eye and the minus are 44px of tax this
   row cannot shed — they belong to it — so nothing reflows here today; the
   number is for correctness, so that a list nested in a wrapping parent breaks
   at a width that means something instead of at the intrinsic width of an
   <input> with its default size="20". */
.${PREFIX}-rows-row > *:first-child {
  flex: 1 1 var(--${PREFIX}-field-min); min-width: 0;
}
.${PREFIX}-rows-off > *:first-child { opacity: .4; }
/* Row affordances stay quiet until the row is hovered — a design tool's rows are quiet
   until you reach for them, which is what keeps a stack of six fills from
   reading as twelve buttons.

   Quiet, not invisible. These used to rest at opacity 0, and the minus is the
   only way to remove a fill or a shadow: a destructive action with no resting
   trace is not "restrained", it is hidden. .55 is below the text tone and above
   nothing, which is the line — contrast .tree-act and .css-del, which stay at 0
   because a layer list and a declaration list have dozens of rows each and
   their actions are all reachable another way.

   A .row is the third host, and it was missing from the reveal below. The
   panel's labelled rows carry ghost icons too — the token badge fieldCell
   appends after a control, Text's overflow menu — and neither .rows-row nor
   .token-cell reaches them, so both sat pinned at .55 with no hover state at
   all: a resting tone that was chosen to mean "quiet until you reach for it"
   on rows where reaching for it did nothing. */
.${PREFIX}-row-icon {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: 0; cursor: pointer;
  background: transparent; border-radius: var(--ap-radius-xs); opacity: .55;
  transition: opacity var(--ap-motion-dur-micro) var(--ap-motion-ease), background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-rows-row:hover .${PREFIX}-row-icon,
.${PREFIX}-rows-off .${PREFIX}-row-icon,
.${PREFIX}-row:hover .${PREFIX}-row-icon,
.${PREFIX}-row-icon:focus-visible { opacity: .8; }
.${PREFIX}-row-icon:hover { opacity: 1; background: var(--ap-surface-active); }

/* A paint row: swatch, hex, alpha. The hex field takes the slack. */
.${PREFIX}-paint-row { display: flex; align-items: center; gap: var(--ap-control-field-gap); min-width: 0; }
.${PREFIX}-paint-hex { flex: 1 1 var(--${PREFIX}-hex-min); min-width: 0; }
.${PREFIX}-paint-hex .${PREFIX}-ctl-input { text-transform: uppercase; }
/* Wide enough for "100" plus its % without clipping. It was 62px, which fit
   the digits only while the empty glyph slot beside them was 20px wide.

   Shrinkable now, with a floor of its own. Rigid at 72 it was fine on a plain
   fill row and wrong on a bound one, where a token badge has already taken its
   share: at the narrowest dock that left the hex 49px, under the 66px seven hex
   digits need. 56 still holds "100%" beside the 12px glyph slot, and the hex
   gets the difference. */
.${PREFIX}-paint-pct { flex: 0 1 72px; min-width: 56px; }

/* An effect row stacks: type + four offsets, then its colour. */
.${PREFIX}-effect-row {
  display: flex; flex-direction: column; gap: var(--ap-control-field-gap); min-width: 0;
  padding: var(--ap-control-row-gap) 0; border-top: 1px solid var(--ap-border-default);
}
.${PREFIX}-rows-row:first-child .${PREFIX}-effect-row { border-top: 0; }
/* The four offsets, as two pairs that wrap — not four tracks that reflow.

   Four across gave each field 65px at the default dock width, of which 20 was
   the glyph: 39px, about five characters of mono, for a value like "-12.5px".
   The obvious fix is a track list with a floor, and it does not work here. For
   any minimum M, the count floor((W+g)/(M+g)) passes through 3 on its way from
   4 to 2, and that 3-wide band lands squarely on the default width — X, Y and
   Blur on one line with Spread alone under them. Pairing X/Y and Blur/Spread in
   the DOM makes the pair the thing that wraps, so the step is 4 across or 2x2
   and never 3+1. */
.${PREFIX}-effect-nums {
  display: flex; flex-wrap: wrap; gap: var(--ap-control-field-gap);
}
/* The basis is two roomy fields, not two minimum ones — so the row only goes
   four across once four across is comfortable, rather than the instant it is
   possible. Keyed to the floor it stepped from 145px to exactly 72px on
   widening past a 388px dock; keyed here the step is 193px to 96px at 484. */
.${PREFIX}-effect-pair {
  flex: 1 1 calc(var(--${PREFIX}-field-roomy) * 2 + var(--ap-control-field-gap));
  min-width: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--ap-control-field-gap);
}
/* The layer's type, which is a dropdown and was drawn as a bare 20px glyph with
   no caret — the only one in the panel — sitting alone on a line that therefore
   said nothing. Named now, with the caret every other dropdown here wears.

   Shape from row-icon, the panel's one ghost icon button, overridden the way
   .token-badge and .aspect-lock override it: the reset, the radius and the
   hover fill are all worth keeping, the 20px square is not. Full width because
   .effect-row is a stretching column, so the caret lands on the right edge over
   the fields it heads — the same shape as .select, which is the same control.

   Opacity 1 and a secondary text colour rather than row-icon's .55: that tone
   is for a glyph nobody is meant to read, and this line is words. */
/* The header line: the type dropdown, and the row's own eye and minus.
   \`createRowList\` puts them here rather than beside the block — see its
   \`actionSlot\`. The button takes the slack so the actions stay hard right,
   where they are in every single-line row in the panel. */
.${PREFIX}-effect-head {
  display: flex; align-items: center; gap: var(--ap-control-field-gap);
}
.${PREFIX}-effect-head > .${PREFIX}-effect-kind { flex: 1 1 auto; min-width: 0; }
.${PREFIX}-effect-kind {
  display: flex; align-items: center; gap: var(--ap-control-field-gap);
  width: auto; height: var(--ap-control-height);
  padding: 0 var(--ap-control-field-gap); opacity: 1;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  color: var(--ap-text-secondary);
}
.${PREFIX}-effect-kind { --${PREFIX}-ic-tone: var(--ap-icon-secondary); }
/* The row's quiet-until-hovered rule reaches every .row-icon inside it and
   outranks the opacity above, so hovering the row would have *dimmed* this one
   from 1 to .8. It is a label, not an affordance waiting to be found. */
.${PREFIX}-rows-row:hover .${PREFIX}-effect-kind { opacity: 1; }
.${PREFIX}-effect-kind:hover { color: var(--ap-text-primary); }
${ROOT} .${PREFIX}-effect-kind:hover .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-primary); }
.${PREFIX}-effect-kind-label { flex: 1 1 auto; min-width: 0; text-align: left; }
/* Dropdown. For enums whose labels are words rather than glyphs — five text
   options in a 320px panel wrap into two rows as a segmented group, which
   reads as a bug. Design tools use a select here for exactly that reason.

   Unlike the number fields above, this one is *not* borderless at rest. A field
   you type into announces itself the moment you put a caret in it; a dropdown
   announces nothing at all, so a transparent one was only discoverable by
   hovering the right 200×24 rectangle. The --ap-input-* family exists for
   exactly this — it is what the chat composer uses — and a hairline plus one
   3-5% surface step is EDITOR.md's own prescription, not a form outline. */
.${PREFIX}-select {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--ap-control-gutter);
  width: 100%; height: var(--ap-control-height); padding: 0 var(--ap-space-xs);
  cursor: pointer; text-align: left;
  background: var(--ap-input-bg); color: var(--ap-text-primary);
  border: 1px solid var(--ap-input-border); border-radius: var(--ap-radius-sm);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease), border-color var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
/* The caret is the other half of the affordance and it was drawn at the icon
   set's muted tone, which is the resting colour for a glyph nobody is meant to
   look at. It carries the whole "this opens" signal, so it sits at
   {icon.secondary} — one step below text, per EDITOR.md — and lifts on hover. */
.${PREFIX}-select { --${PREFIX}-ic-tone: var(--ap-icon-secondary); }
.${PREFIX}-select:hover {
  background: var(--ap-input-hover); border-color: var(--ap-border-strong);
}
${ROOT} .${PREFIX}-select:hover .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-primary); }
.${PREFIX}-select[aria-expanded="true"] {
  background: var(--ap-input-focus); border-color: var(--ap-input-focus-border);
}
${ROOT} .${PREFIX}-select[aria-expanded="true"] .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-primary); }
/* No position: relative — the menu is not a child any more. It went to the
   popover host precisely because being positioned against this box put it
   inside .insp-body's scroller and .dock's overflow:hidden, which clipped it. */
.${PREFIX}-select-wrap { flex: 1 1 auto; min-width: 0; }

/* ---- Text extras -------------------------------------------------------- */
/* The font-family field, then Style / Vertical / Case as labelled rows.

   The three icon groups used to sit in a bespoke .text-row that packed them
   left at their content width — three 24px cells, 80px all in — on the
   argument that a stretched icon cell is the shape of a toolbar rather than of
   a control, and that two groups sharing a line met edge to edge as one
   undifferentiated strip. Neither observation was wrong; both were about a
   *shared* row, and neither survives a group having a name of its own. What
   the rule actually bought was 230px of nothing to the right of each group in
   the default rail, three rows running, directly beneath an Align row whose
   four icon cells do span the width — text-align is span: "full", so the
   section was already contradicting itself. The panel has one shape for a
   named choice: a 68px rail and a control taking the rest of the line. These
   three are named choices. They are labelled() rows now, and .text-row is gone.

   A block, not a flex column, and with no gap of its own. A .row spaces itself
   with \`margin: 6px 0\` (see inspector.css.ts) and margins do not collapse
   between flex items, so a 6px column gap put 18px between two rows and 12px
   above the first — one pitch reading as three. Block flow is the model those
   margins were written for, and the one where :first-child and :last-child mean
   what they say. That still holds *inside* this wrapper, which is why it stays
   a block: \`.sect-body\` is a flex column now, but it zeroes the margin on its
   own direct children only, so rows nested one level down keep collapsing.

   The gap above comes from \`group\` on the element rather than a margin here —
   a margin would be added to the body's gap, not instead of it. The
   font-family field is still full width under it: a \`display: flex\` box in
   block flow is block-level and fills the line exactly as a stretching column
   made it. */
/* An icon group is not three word pills, and {row-ctl-min} is a measurement of
   words — "Inside / Centre / Outside", per the note where it is defined. Three
   icon cells are legible from 24px, so 3x40 plus the group's 8px of chrome is
   what these rows ask for before the rail gives up its line. Under the shared
   192 all three wrapped at the narrowest dock, spending 54px of height to say
   nothing while the cells they freed were already twice as wide as they needed
   to be. At 124 the widest of them — Case, which also carries the 20px overflow
   button — fits the 230px rail a 280px dock leaves: 68 + 8 + 124 + 8 + 20. The
   grow factor is untouched, so they still fill at every width above that. */
.${PREFIX}-text-extras > .${PREFIX}-row > .${PREFIX}-ctl-seg {
  --${PREFIX}-row-ctl-min: 124px;
}

/* ---- Constraints -------------------------------------------------------- */
/* Composed from a frame and four edge bars rather than 25 inlined SVGs — see
   inspector/constraints.ts. The frame takes the icon set's own 0.3 tone and an
   engaged anchor its 0.9, so the widget reads as part of the same family. */
.${PREFIX}-anchor-wrap { display: flex; align-items: center; gap: var(--ap-control-gutter); }
.${PREFIX}-anchor {
  position: relative; flex: 0 0 auto; width: 52px; height: 52px;
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-xs);
}
.${PREFIX}-anchor-core {
  position: absolute; left: 50%; top: 50%; width: 14px; height: 14px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--ap-icon-muted); border-radius: 2px;
  pointer-events: none;
}
.${PREFIX}-anchor-bar {
  position: absolute; border: 0; padding: 0; cursor: pointer;
  background: var(--ap-icon-muted); opacity: .3; border-radius: 1px;
  transition: opacity var(--ap-motion-dur-micro) var(--ap-motion-ease), background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-anchor-bar:hover { opacity: .65; }
.${PREFIX}-anchor-on { background: var(--ap-primary); opacity: .9; }
.${PREFIX}-anchor-bar[data-side="top"],
.${PREFIX}-anchor-bar[data-side="bottom"] { left: 50%; width: 2px; height: 11px; margin-left: -1px; }
.${PREFIX}-anchor-bar[data-side="left"],
.${PREFIX}-anchor-bar[data-side="right"] { top: 50%; height: 2px; width: 11px; margin-top: -1px; }
.${PREFIX}-anchor-bar[data-side="top"] { top: 5px; }
.${PREFIX}-anchor-bar[data-side="bottom"] { bottom: 5px; }
.${PREFIX}-anchor-bar[data-side="left"] { left: 5px; }
.${PREFIX}-anchor-bar[data-side="right"] { right: 5px; }
.${PREFIX}-anchor-modes {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column;
  gap: var(--ap-control-field-gap);
}

/* The alpha checkerboard, declared once and composited under any translucent
   swatch. Two layers on one element — colour over checker — rather than a
   wrapper per swatch. Without it a 40% fill and a dark opaque one are the same
   square, which is the kind of thing that makes a colour control untrustworthy. */
/* Image only — no position/size. It is interpolated into background-image,
   where a "0 0 / 6px 6px" shorthand tail is a parse error that takes the whole
   declaration with it, swatch colour included. Size is set per element below. */
.${PREFIX}-pop-host, .${PREFIX}-ctl-swatch, .${PREFIX}-pop-recent {
  --${PREFIX}-checker: conic-gradient(
    from 90deg,
    var(--ap-surface-hover) 0 25%,
    var(--ap-surface-base) 0 50%
  );
}
.${PREFIX}-ctl-swatch {
  width: 22px; height: 22px; flex: 0 0 auto; padding: 0;
  border-radius: var(--ap-radius-sm); border: 1px solid var(--ap-border-default);
  cursor: pointer; background-color: transparent; background-size: 6px 6px;
  transition: border-color var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-ctl-swatch:hover { border-color: var(--ap-border-strong); }
.${PREFIX}-ctl-swatch:focus-visible {
  outline: 1px solid var(--ap-border-focus); outline-offset: 1px;
}
/* Several values at once. A diagonal hairline rather than an arbitrary colour —
   picking one of the selection's colours to show would be a lie about the rest. */
.${PREFIX}-ctl-swatch[data-mixed] {
  background-image: linear-gradient(
    135deg,
    transparent 46%, var(--ap-border-strong) 46% 54%, transparent 54%
  );
}

/* -- Design tokens ---------------------------------------------------------
   The badge is a quiet trailing affordance, not a control: it must not compete
   with the value it annotates. It only renders where the project actually has
   tokens for that property, so an app without a design system sees the panel
   it always had rather than a column of dead icons.

   It carries .row-icon for its shape and adds only the two state colours. The
   panel had grown four hand-authored 20/22px ghost buttons that were all this
   control with different metrics; there is one now. */
.${PREFIX}-token-cell {
  display: flex; align-items: center; gap: var(--ap-control-field-gap); min-width: 0;
}
.${PREFIX}-token-cell > :first-child { flex: 1 1 auto; min-width: 0; }
/* Linked: the value comes from the design system. */
/* One glyph, and the 20px square its base class gives it.

   It was the \`libraries\` mark plus a caret, on a box widened to \`width: auto\`
   to hold both — 37px of trailing furniture on every field the project has
   tokens for, which in Appearance is most of them. Two glyphs abutting at 16px
   read as one unfamiliar mark rather than as an icon and its caret, and
   \`libraries\` is the set's sidebar glyph: two book spines, which is a noun about
   a panel and says nothing about this control. \`var-apply\` is the icon set's
   own answer — it is filed under "Design tokens / variables. The token badge
   and picker are the client" — and being a verb it needs no caret to say it
   does something, any more than the eye, the minus or the aspect lock do. */
.${PREFIX}-token-badge[data-on] { color: var(--ap-primary); opacity: 1; }
/* The badge rests quiet and lifts when you reach for it — but the only rule
   that lifted it keyed off .rows-row, and in the field grid a badge sits in a
   .token-cell instead, so it was pinned at .55 forever. */
.${PREFIX}-token-cell:hover > .${PREFIX}-token-badge { opacity: .8; }
.${PREFIX}-token-cell:hover > .${PREFIX}-token-badge[data-on] { opacity: 1; }
/* A badge can also sit in a section header, where the property it annotates is
   the whole section rather than one field — Effects' \`box-shadow\` is one
   property holding a list, so a token stands for all of it. There it takes the
   header's own 18px metrics and lifts with the heading. */
.${PREFIX}-sect-actions > .${PREFIX}-token-badge { width: 18px; height: 18px; }
.${PREFIX}-sect-head:hover .${PREFIX}-token-badge { opacity: .8; }
.${PREFIX}-sect-head:hover .${PREFIX}-token-badge[data-on] { opacity: 1; }
/* Near, not exact — a suggestion. Dimmer than linked, so the two never read
   as the same state at a glance. */
.${PREFIX}-token-badge[data-near] {
  color: var(--ap-semantic-warning); opacity: var(--ap-opacity-64);
}

/* The bound state — a tint on the field, not a different control.

   A bound field reads the token's name instead of its number, and that is the
   only thing that changes: same chrome, same height, same glyph, same place in
   the grid. An earlier version replaced the whole control with a pill, which
   meant binding a property visibly restructured its row — so a panel with three
   bound properties had three controls that no longer looked like the ones
   around them, and picking a token felt like the panel breaking rather than
   like a value being chosen.

   Applied on the field wrapper so it covers every shape that carries a value:
   .ctl-num for a number or the hex, .paint-row for a whole colour row. */
.${PREFIX}-ctl-num[data-token],
.${PREFIX}-paint-row[data-token] .${PREFIX}-paint-hex {
  background: var(--ap-selection-fill);
}
.${PREFIX}-ctl-num[data-token] .${PREFIX}-ctl-input,
.${PREFIX}-paint-row[data-token] .${PREFIX}-paint-hex .${PREFIX}-ctl-input {
  color: var(--ap-primary);
  /* Sans, not the mono a number wears: this is a name now, and reading it as
     one is the point. And not uppercased — .paint-hex shouts its six hex
     characters, which is right for AABBCC and wrong for a token name. */
  font-family: var(--ap-font-sans);
  text-transform: none;
  text-overflow: ellipsis;
}
/* A field whose value is not its own to edit: bound to a token, or locked
   because something it belongs to is. The scrub grip goes quiet and the caret
   goes away, because both would be a lie about what the field will accept. */
.${PREFIX}-ctl-num[data-locked] .${PREFIX}-ctl-input { cursor: default; }
.${PREFIX}-ctl-num[data-locked] .${PREFIX}-ctl-glyph {
  cursor: default; opacity: var(--ap-opacity-64);
}
/* A read-only stand-in for a control that has no bound state of its own — the
   shadow list, whose token names the whole stack rather than one layer. Wears
   the field chrome so it sits in the row the list used to. */
.${PREFIX}-bound-value { cursor: default; }
/* A bound field is read-only — its value is the design system's — so the text
   caret would be a lie about what clicking does. The badge beside it is how the
   binding is changed or removed. */
.${PREFIX}-ctl-num[data-token] .${PREFIX}-ctl-input,
.${PREFIX}-paint-row[data-token] .${PREFIX}-paint-hex .${PREFIX}-ctl-input { cursor: default; }
/* The scrub grip goes quiet for the same reason: there is no number to drag. */
.${PREFIX}-ctl-num[data-token] .${PREFIX}-ctl-glyph {
  cursor: default; opacity: var(--ap-opacity-64);
}

/* The picker is a menu with a search field on top, so it is built from
   .pop-menu / .pop-item rather than a private set of rows that agreed with
   them on nothing — not the padding, not the radius, not the hover tone, and
   not the font size, which an inherited shorthand had resolved to the initial
   16px because the overlay root sets a family and no size. */
.${PREFIX}-token-head {
  flex: 0 0 auto;
  padding: var(--ap-control-row-gap);
  border-bottom: 1px solid var(--ap-border-subtle);
}
.${PREFIX}-token-search {
  width: 100%; box-sizing: border-box;
  height: var(--ap-control-height); padding: 0 var(--ap-space-xs);
  border: 1px solid var(--ap-input-border); border-radius: var(--ap-radius-sm);
  background: var(--ap-input-bg); color: var(--ap-text-primary);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  outline: none;
}
.${PREFIX}-token-search:focus { border-color: var(--ap-input-focus-border); }
/* Scrolls inside the shell rather than growing it. min-height: 0 is what lets a
   flex child actually shrink to its scroll container. */
.${PREFIX}-token-list { flex: 1 1 auto; min-height: 0; max-height: 260px; }
.${PREFIX}-token-swatch {
  width: 12px; height: 12px; flex: 0 0 auto;
  border-radius: var(--ap-radius-xs); border: 1px solid var(--ap-border-default);
}
.${PREFIX}-token-name {
  min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
/* A token the element's cascade does not define. Dimmed rather than dropped:
   it may live under a theme class or a media query that is not matching, and it
   still applies correctly — the preview carries the token's own value as the
   var() fallback. Hiding it would quietly remove a real token. */
.${PREFIX}-pop-item[data-out-of-scope] { opacity: var(--ap-opacity-64); }
.${PREFIX}-pop-item[data-out-of-scope]:hover { opacity: 1; }
.${PREFIX}-token-empty {
  padding: var(--ap-space-xs) var(--ap-control-row-gap);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  color: var(--ap-text-tertiary);
}

/* -- Scope + State ---------------------------------------------------------
   Above the alignment strip and outside the sections, because these two govern
   every control below them. The tinted left edge is the standing reminder that
   edits are not landing on the resting style of this one element.

   Padded to the panel's own gutter: this sits directly on top of .align-row,
   and an inset of its own put a visible step in the left edge at the very top
   of the panel. The rows space themselves through their .row margins, so there
   is deliberately no grid gap here — the two do not collapse together, and
   setting both is what made these rows sit 16px apart. */
.${PREFIX}-scope-row {
  display: grid;
  padding: var(--ap-space-sm) var(--ap-space-lg);
  border-bottom: 1px solid var(--ap-border-subtle);
}
.${PREFIX}-scope-row[data-scoped] {
  box-shadow: inset var(--ap-control-field-gap) 0 0 var(--ap-primary);
  background: var(--ap-surface-hover);
}

/* -- Section sub-heading ---------------------------------------------------
   Names a stack inside a section: Filter vs Backdrop, Background vs Image.
   Same mono eyebrow as .pop-head, which is the panel's other group heading —
   it was authored here as \`rows-sub-head\` at its own size and tracking, and
   the \`rows-\` prefix means "part of a createRowList" everywhere else.

   No horizontal padding: this sits inside the section body, which is already
   inset to the panel's 24px gutter, so any of its own would step the left edge
   in from the rows it heads. */
.${PREFIX}-sect-sub-head {
  padding: var(--ap-control-row-gap) 0 var(--ap-control-field-gap);
  font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-micro); letter-spacing: .6px;
  color: var(--ap-text-tertiary);
}
.${PREFIX}-sect-sub-head:first-child { padding-top: 0; }

/* -- Filters ---------------------------------------------------------------
   Glyph, name, value — The effect-row shape. The type reads from the icon
   before the word, which is what makes a stack of five scannable. The value
   track is fixed rather than a minmax range so every row in a stack lines its
   numbers up on the same edge. */
.${PREFIX}-filter-row {
  display: grid; grid-template-columns: 1fr 84px;
  align-items: center; gap: var(--ap-control-gutter); width: 100%; min-width: 0;
}
.${PREFIX}-filter-name {
  display: flex; align-items: center; gap: var(--ap-control-gutter);
  min-width: 0;
  font-size: var(--ap-font-size-label); color: var(--ap-text-secondary);
}
.${PREFIX}-filter-name { --${PREFIX}-ic-tone: var(--ap-icon-muted); }
.${PREFIX}-filter-name .${PREFIX}-ic { flex: 0 0 auto; }
.${PREFIX}-filter-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* A drop-shadow row carries four controls, so it wraps rather than crushing
   them into a single line the way the other filter rows can afford to. */
/* A column of three lines — name, offsets, colour — rather than a grid with a
   spanning last child. The name line is new: it is what every other filter row
   already had, and it is where the eye and the minus now live. */
.${PREFIX}-filter-shadow {
  display: flex; flex-direction: column;
  gap: var(--ap-control-field-gap); width: 100%; min-width: 0;
}
.${PREFIX}-filter-shadow-head {
  display: flex; align-items: center; gap: var(--ap-control-field-gap);
}
.${PREFIX}-filter-shadow-head > .${PREFIX}-filter-name {
  flex: 1 1 auto; min-width: 0;
}
.${PREFIX}-filter-shadow-nums {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: var(--ap-control-field-gap); min-width: 0;
}
/* A filter function we do not model. Mono, because it is source text. */
.${PREFIX}-filter-raw {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--ap-font-mono);
  color: var(--ap-text-tertiary);
}

/* -- Aspect lock -----------------------------------------------------------
   Sits beside the two size rows, because the thing it locks is the
   relationship between them. See .size-wrap for why that is a flex sibling
   rather than a grid cell. Shape from .row-icon; this adds only the on state. */
.${PREFIX}-aspect-lock[data-on] { color: var(--ap-primary); opacity: 1; }

/* -- Gradient editor -------------------------------------------------------
   Opened from the fill layer's glyph. The raw CSS field stays beside it and
   stays authoritative — this is an alternative view of the same value. */
.${PREFIX}-ctl-glyph-action { cursor: pointer; }
.${PREFIX}-ctl-glyph-action:hover { color: var(--ap-icon-primary); }
/* Shell sets the width, content owns the padding — the same split .pop-color
   and .pop-color-body already use. */
.${PREFIX}-pop-grad { min-width: 236px; }
.${PREFIX}-grad-edit {
  display: flex; flex-direction: column; gap: var(--ap-control-gutter);
  padding: var(--ap-space-xs);
}
/* The type switch is a .ctl-seg like every other icon segmented group; the two
   whole-gradient verbs sit after it, pushed to the far end. */
.${PREFIX}-grad-kinds {
  display: flex; align-items: center; gap: var(--ap-control-gutter);
}
.${PREFIX}-grad-kinds > .${PREFIX}-ctl-seg { flex: 1 1 auto; min-width: 0; }
.${PREFIX}-grad-acts { display: flex; align-items: center; gap: var(--ap-control-field-gap); }
/* The bar is the hit target; the chits are decoration, so a click 3px off a
   stop still grabs it rather than falling through to "add a stop". */
.${PREFIX}-grad-bar-wrap { position: relative; height: 28px; cursor: pointer; }
.${PREFIX}-grad-bar {
  position: absolute; inset: 0 0 10px 0;
  border-radius: var(--ap-radius-sm); border: 1px solid var(--ap-border-default);
  background-color: var(--ap-surface-base);
}
/* 10px chits on a 1px rail: the sizes below are the drawing, not the layout,
   and are the same kind of quantity as .pad-ink's hairlines rather than a gap
   between two controls. */
.${PREFIX}-grad-stop {
  position: absolute; bottom: 0; width: 10px; height: 10px;
  margin-left: -5px; pointer-events: none;
  border-radius: var(--ap-radius-xs); border: 1px solid var(--ap-border-strong);
  background: var(--stop-color, var(--ap-surface-panel));
  box-shadow: 0 0 0 1px var(--ap-surface-base);
}
.${PREFIX}-grad-stop[data-on] {
  border-color: var(--ap-primary);
  box-shadow: 0 0 0 2px var(--ap-primary);
}
.${PREFIX}-grad-angle { display: flex; align-items: center; gap: var(--ap-control-gutter); }
.${PREFIX}-grad-angle > .${PREFIX}-ctl-num { flex: 0 0 72px; }
.${PREFIX}-grad-na { color: var(--ap-text-tertiary); }
.${PREFIX}-grad-stops {
  display: flex; flex-direction: column; gap: var(--ap-control-field-gap);
}
.${PREFIX}-grad-stop-row {
  display: grid; grid-template-columns: 1fr 72px 20px;
  align-items: center; gap: var(--ap-control-field-gap);
  padding: var(--ap-control-field-gap); border-radius: var(--ap-radius-sm);
}
.${PREFIX}-grad-stop-row[data-on] { background: var(--ap-surface-hover); }
.${PREFIX}-grad-del:disabled { opacity: var(--ap-opacity-32); cursor: default; }
.${PREFIX}-grad-del:disabled:hover { background: transparent; }
`;
