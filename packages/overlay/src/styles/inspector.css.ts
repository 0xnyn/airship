import { PREFIX } from "../dom";
import { Z } from "./const";

/** Right dock: tabs, the DOM tree, sections, the field grid, the CSS tab. */
export const css = `
/*
 * A fill layer and its geometry, stacked.
 *
 * background-size, -position, -repeat and -blend-mode are parallel lists index-aligned
 * with background-image, so each layer's four entries belong *with* that layer rather
 * than in one shared row elsewhere. See sections/fill.ts.
 */
.${PREFIX}-fill-layer {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.${PREFIX}-fill-geom {
  display: grid;
  gap: 2px 4px;
  grid-template-columns: 1fr 1fr;
  padding-left: 8px;
}

.${PREFIX}-insp { display: flex; flex-direction: column; flex: 1 1 auto; overflow: hidden; }
/* Bare container: the Source section inside it brings its own padding and
   bottom rule, so anything here would double them. Hidden with no selection. */
.${PREFIX}-insp-head { flex: 0 0 auto; }
.${PREFIX}-insp-multi {
  padding: var(--ap-space-xs) var(--ap-space-lg);
  font-size: var(--ap-font-size-caption); opacity: .5;
}
/* Basename plus line, riding in the Source section's header. \`text-transform\`
   is reset because the heading row uppercases its contents, and a file name is
   not a heading — \`APP.TSX:31\` names nothing on disk. */
.${PREFIX}-insp-src {
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-primary); opacity: .75; text-transform: none;
  letter-spacing: normal;
}
.${PREFIX}-insp-src-off { font-style: italic; opacity: .5; }
/* Why the element has no source. Prose, not a path — it wraps on words. */
.${PREFIX}-insp-src-note {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  opacity: .55; line-height: 1.5;
}
/* The expanded section: Path and Line as two labelled facts, sharing the
   panel's 68px label rail so they line up with every other row in the dock. */
.${PREFIX}-insp-src-kv > .${PREFIX}-row { align-items: baseline; }
/* Baseline, not center, puts "Path" on the first line of a path that wrapped
   rather than halfway down it — and reconciles the 12px label against the 10px
   value for free. An icon button has no baseline worth aligning to. */
.${PREFIX}-insp-src-kv .${PREFIX}-sect-act { align-self: center; }
/* Breaks anywhere: a deep path has no useful break points and an ellipsis would
   defeat the point of expanding. */
/* The basis is load-bearing, not decoration. A .row wraps now, and wrapping is
   decided on an item's flex-basis before any shrinking — so \`auto\` here means
   the max-content width of a full source path, which exceeds the rail at every
   dock width and would put "Path" on a line of its own always. 140px is under
   the 154px a row's control gets at the narrowest dock, and break-all above
   means going narrow costs nothing. */
.${PREFIX}-insp-src-val {
  flex: 1 1 140px; min-width: 0;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-secondary); word-break: break-all; line-height: 1.5;
}
.${PREFIX}-insp-tabs { display: flex; border-bottom: 1px solid var(--ap-border-default); }
.${PREFIX}-insp-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center;
  gap: var(--ap-control-row-gap);
  padding: var(--ap-space-xs); cursor: pointer; background: transparent; border: none;
  color: var(--ap-text-primary); opacity: .55; font-family: var(--ap-font-sans); font-size: var(--ap-font-size-title);
  border-bottom: 2px solid transparent;
}
.${PREFIX}-insp-tab-on { opacity: 1; border-bottom-color: var(--ap-primary); }

/* DOM tab — expandable tree + drag-to-reparent. */
.${PREFIX}-tree { padding: 4px 0 var(--ap-space-md); }
/* Layer rows. Sans, not mono, and named after the component or its text — a
   row reading "Button" is worth far more than div.inline-flex.items-center. */
.${PREFIX}-tree-node {
  display: flex; align-items: center; gap: var(--ap-control-field-gap);
  padding: 2px var(--ap-space-xxs) 2px 0;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  white-space: nowrap; opacity: .85;
}
.${PREFIX}-tree-kind {
  display: inline-flex; align-items: center; flex: 0 0 auto;
  color: var(--ap-icon-muted);
}
.${PREFIX}-tree-node:hover .${PREFIX}-tree-kind { color: var(--ap-icon-secondary); }
.${PREFIX}-tree-self .${PREFIX}-tree-kind { color: var(--ap-primary); }
/* A component reads as the primary thing in the tree, the way it does in a design tool. */
.${PREFIX}-tree-node[data-kind="component"] .${PREFIX}-tree-kind,
.${PREFIX}-tree-node[data-kind="instance"] .${PREFIX}-tree-kind {
  color: var(--ap-primary);
}
.${PREFIX}-tree-hidden { opacity: .45; }
.${PREFIX}-tree-locked .${PREFIX}-tree-label { opacity: .6; }
/* Row actions stay hidden until hover, or until they are doing something. */
.${PREFIX}-tree-act {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; cursor: pointer;
  background: transparent; border-radius: var(--ap-radius-xs); opacity: 0;
  transition: opacity var(--ap-motion-dur-micro) var(--ap-motion-ease), background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-tree-node:hover .${PREFIX}-tree-act,
.${PREFIX}-tree-hidden .${PREFIX}-tree-act,
.${PREFIX}-tree-locked .${PREFIX}-tree-act,
.${PREFIX}-tree-act:focus-visible { opacity: .65; }
.${PREFIX}-tree-act:hover { opacity: 1; background: var(--ap-surface-active); }
.${PREFIX}-tree-node:hover { background: var(--ap-surface-active); opacity: 1; }
.${PREFIX}-tree-self { color: var(--ap-primary); background: var(--ap-surface-active); opacity: 1; }
.${PREFIX}-tree-chev {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; flex: 0 0 auto; cursor: pointer; opacity: .55;
}
.${PREFIX}-tree-chev:hover { opacity: 1; }
.${PREFIX}-tree-chev-spacer { width: 16px; flex: 0 0 auto; }
.${PREFIX}-tree-label {
  flex: 1 1 auto; min-width: 0;
  cursor: pointer; overflow: hidden; text-overflow: ellipsis; user-select: none;
  padding: 1px 4px; border-radius: var(--ap-radius-xs);
}
.${PREFIX}-tree-drop-line {
  position: absolute; z-index: ${Z}; pointer-events: none;
  background: var(--ap-primary); border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255,255,255,var(--ap-opacity-48)), 0 0 6px color-mix(in srgb, var(--ap-primary) 50%, transparent);
}
.${PREFIX}-tree-drop-into {
  position: absolute; z-index: ${Z}; pointer-events: none;
  background: var(--ap-primary-bg); border: 1px solid var(--ap-primary);
  border-radius: var(--ap-radius-xs);
}

/* Sections + rows.

   The scrollbar is hidden, not the scrolling — same treatment the chip rails
   get in \`chat.css\`. A dock this narrow loses real width to a gutter, and the
   bar is drawn *over* the right-hand column of the field grid, which is where
   the number fields sit. Section headings already say how much is below. */
/* A column, not a block. Sections stack identically either way — a column flex
   container with the default \`align-items: stretch\` reproduces block flow for
   full-width children, and \`min-height: auto\` keeps them at content height —
   but a *block* container gives \`margin: auto\` nothing to distribute, so the
   panel's empty state pinned itself to the top while the transcript's (already
   a flex column) centred correctly. Same block, two different results, which is
   the bug. Both hosts are columns now. */
.${PREFIX}-insp-body {
  flex: 1 1 auto; overflow-y: auto; scrollbar-width: none;
  display: flex; flex-direction: column;
}
.${PREFIX}-insp-body::-webkit-scrollbar { display: none; }
.${PREFIX}-insp-hint { font-size: var(--ap-font-size-label); opacity: .5; padding: var(--ap-space-md) var(--ap-space-lg); }
.${PREFIX}-sect { border-bottom: 1px solid var(--ap-border-default); }
/* Symmetric inset, matching \`sect-body\` and the field grid: with the chevron
   moved to the right (see \`section()\`) the heading starts on the same margin
   as the rows it heads, and no arrow is pressed against the dock edge. */
.${PREFIX}-sect-head {
  display: flex; align-items: center; justify-content: space-between; cursor: pointer;
  gap: var(--ap-control-row-gap);
  padding: var(--ap-space-xs) var(--ap-space-lg);
  font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-caption); letter-spacing: .6px; opacity: .6;
}
.${PREFIX}-sect-head:hover { opacity: .9; }
.${PREFIX}-sect-title { flex: 1 1 auto; }
.${PREFIX}-sect-chev { display: inline-flex; align-items: center; flex: 0 0 auto; }
.${PREFIX}-sect-actions {
  display: inline-flex; align-items: center; flex: 0 0 auto;
  gap: var(--ap-control-field-gap);
}
/* \`flex: 0 0 auto\` because a header action is not always inside
   \`sect-actions\` — the computed sub-head puts one straight next to a
   \`flex: 1 1 auto\` filter box, which squashed an 18px button to a sliver. */
.${PREFIX}-sect-act {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex: 0 0 auto; padding: 0; border: 0; cursor: pointer;
  background: transparent; border-radius: var(--ap-radius-xs);
}
.${PREFIX}-sect-act:hover { background: var(--ap-surface-active); }
/* Symmetric, and both halves from the rhythm. It was 4px top / 20px bottom,
   which put consecutive sections at two different distances from their shared
   divider — the heading crowded its own body and floated away from the section
   above it. A heading is now exactly one group-gap from its content, which is
   the same distance two groups inside it are from each other. */
.${PREFIX}-sect-body {
  padding: var(--ap-control-group-gap) var(--ap-space-lg);
}

/* The field grid.
   A design tool's rail is two columns of glyph-fielded controls, not a label rail with
   one control per row — the field carries its own identity, so the 68px of
   left-hand text is dead weight. Controls that genuinely need a word (Weight,
   Align) opt back into a labelled full-width row via \`span: "full"\`. */

/* Three pitches, not one. See EDITOR.md's control group.

   There used to be a single --ap-row-gap, described in a comment as the pitch
   "everything below defers to it" — which was true of this file and not of
   controls.css.ts, where twenty rules hardcoded 1, 1.5, 2, 3, 4, 5, 6 and 8px.
   More to the point, one pitch cannot express structure: with every row the
   same distance from every other, a section is a flat list and the reader has
   to work out for themselves which two controls are one decision.

   --ap-control-field-gap (2)  parts of one control
   --ap-control-row-gap   (6)  rows within a group
   --ap-control-group-gap (12) groups within a section
   --ap-control-gutter    (8)  columns on one row  */
/* Two columns, with a floor under them. auto-fill and not auto-fit: auto-fit
   collapses a track nothing is placed in, and Auto layout's grid branch builds
   a .grid holding a single gutter field — which would then stretch across the
   rail. Half a row of deliberate space is the shape this grid has always had.
   (.pad-fields above wants the opposite, and takes auto-fit for it.)

   In the 280-720 range this resolves to two tracks at every width; it drops to
   one only below a 202px dock, which MIN_DOCK_W does not allow. It is a
   guarantee, not a reflow. */
.${PREFIX}-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill,
    minmax(max(var(--${PREFIX}-field-min), (100% - var(--ap-control-gutter)) / 2), 1fr));
  gap: var(--ap-control-row-gap) var(--ap-control-gutter);
  align-items: center;
}
.${PREFIX}-grid > .${PREFIX}-span2 { grid-column: 1 / -1; }
.${PREFIX}-grid > .${PREFIX}-cell { min-width: 0; }
/* Margin, not gap: a .row is a sibling of grids and lists rather than a child
   of one, so it owns its own separation. Collapsed against the section's own
   padding at the edges. */
/* Wraps, so the 68px label rail gives up its line before the control gives up
   its legibility. The rail is \`flex: 0 0 68px\` and never yielded, so at the
   narrowest dock Padding, Margin and Stroke position were working in 154px —
   two number fields and a mode switch in less room than one field wants. Now
   the label goes above and the control gets the whole 230px back.

   Two-value gap: once the row is two lines, the distance between the label and
   its control is rows-within-a-group (6), not columns-on-one-row (8). */
.${PREFIX}-row {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--ap-control-row-gap) var(--ap-control-gutter);
  margin: var(--ap-control-row-gap) 0;
}
.${PREFIX}-row:first-child { margin-top: 0; }
.${PREFIX}-row:last-child { margin-bottom: 0; }

/* A group: the level between a row and a section. Everything inside it is one
   decision — the alignment pad and the fields beside it, a stroke's colour and
   its weight — and the gap above says where the previous decision ended. */
.${PREFIX}-group + .${PREFIX}-group,
.${PREFIX}-group + .${PREFIX}-grid,
.${PREFIX}-grid + .${PREFIX}-group,
.${PREFIX}-group + .${PREFIX}-rows,
.${PREFIX}-rows + .${PREFIX}-group {
  margin-top: var(--ap-control-group-gap);
}
.${PREFIX}-row-label {
  flex: 0 0 68px; font-size: var(--ap-font-size-label); color: var(--ap-text-tertiary);
}
/* Opt out of the row's centring, for a one-line control standing beside a
   control that stacks. A .row centres because almost everything in it is one
   line tall; where that stops being true — Stroke's advanced button next to a
   quad field that has split into a 2x2 — centred means "in the gutter between
   the two rows", level with neither. */
.${PREFIX}-row > .${PREFIX}-row-top { align-self: flex-start; }
/* A labelled row's control takes the rest of the line, whatever it is — so
   Stroke's Style and Position segmented groups end up the same width as the
   Constraints select above them instead of each sizing to its own content.
   The options then share that width equally: two content-sized pills in a
   full-width track leave half of it visibly empty.

   A real basis and not auto, because the row wraps now and the browser picks
   the line break from the hypothetical main size — the flex-basis, before any
   shrinking. On a box wrapping an input, auto resolves to that input's default
   size="20" intrinsic width, so every labelled row would have wrapped at every
   width. 180px is what these controls actually want: two fields plus a gutter
   plus the 24px mode switch is 178, and three word pills about 191.

   .pad-row joins them here rather than staying content-sized: it is the widest
   thing the rail carries and the reason the rail had to start yielding. */
.${PREFIX}-row > .${PREFIX}-ctl-seg,
.${PREFIX}-row > .${PREFIX}-select-wrap,
.${PREFIX}-row > .${PREFIX}-pad-row {
  flex: 1 1 var(--${PREFIX}-row-ctl-min); min-width: 0;
}
/* A pad row asks for more, and asks for it in its own terms: two roomy fields,
   the gutter between them, and the mode switch. Sharing the 192 above, the rail
   unstacked as soon as two fields and a switch could technically be crammed in,
   so widening the dock from 280 to 306 made Padding's fields shrink from 98px
   to 73 — a control getting smaller as its panel gets bigger, which reads as a
   bug because it is one. Stated this way the step lands on {field.roomy} by
   construction and cannot drift away from it. */
.${PREFIX}-row > .${PREFIX}-pad-row {
  --${PREFIX}-row-ctl-min: calc(
    var(--${PREFIX}-field-roomy) * 2 + var(--ap-control-gutter) +
    var(--ap-control-height) + var(--ap-control-field-gap)
  );
}
.${PREFIX}-row > .${PREFIX}-ctl-seg > .${PREFIX}-ctl-seg-btn {
  flex: 1 1 0; min-width: 0;
}

/* Alignment row — always present, never collapsible, above the first section.
   Three groups of three, mirroring the design-tool layout exactly. */
.${PREFIX}-align-row {
  display: flex; justify-content: space-between; gap: var(--ap-space-xs);
  padding: var(--ap-space-sm) var(--ap-space-lg);
  border-bottom: 1px solid var(--ap-border-default);
}
.${PREFIX}-align-grp { display: inline-flex; gap: 1px; }
.${PREFIX}-align-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ap-control-height); height: var(--ap-control-height);
  padding: 0; border: 0; cursor: pointer; background: transparent;
  border-radius: var(--ap-radius-xs); transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-align-btn:hover:not(:disabled) { background: var(--ap-surface-active); }
.${PREFIX}-align-btn:disabled { cursor: default; opacity: .3; }
/* A button that reaches past the selection carries a hairline accent mark, so
   the side effect is visible before you commit to it rather than after. */
.${PREFIX}-align-btn[data-scope="parent"] { position: relative; }
.${PREFIX}-align-btn[data-scope="parent"]::after {
  content: ""; position: absolute; left: 50%; bottom: 3px;
  width: 8px; height: 1px; transform: translateX(-50%);
  background: var(--ap-primary); opacity: .5;
}
.${PREFIX}-align-btn[data-scope="parent"]:hover::after { opacity: 1; }

/* The parent-edited flash. Deliberately the selection blue at low weight — it
   should read as "this was touched", not as a second selection. */
.${PREFIX}-flash-box {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px solid var(--ap-primary); border-radius: var(--ap-radius-xs);
  background: var(--ap-primary-bg);
  animation: ${PREFIX}-flash .62s ease-out forwards;
}
@keyframes ${PREFIX}-flash {
  0% { opacity: 0; }
  18% { opacity: 1; }
  100% { opacity: 0; }
}

/* CSS tab — DevTools-style declaration editor. Horizontal padding is
   \`space-lg\` throughout, the same margin the sections and the layer tree
   start on; this pane was alone on \`space-md\` and read as a wider column
   pushed out past everything above and below it. */
.${PREFIX}-css-head {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body); opacity: .5;
  padding: var(--ap-space-sm) var(--ap-space-lg) 0;
}
.${PREFIX}-css-list { padding: 4px var(--ap-space-lg) var(--ap-space-md); }
.${PREFIX}-css-decl { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.${PREFIX}-css-decl.${PREFIX}-css-off { opacity: .4; }
.${PREFIX}-css-cb {
  width: 13px; height: 13px; flex: 0 0 auto; cursor: pointer;
  accent-color: var(--ap-primary);
}
.${PREFIX}-css-cb-spacer { width: 13px; flex: 0 0 auto; }
.${PREFIX}-css-prop, .${PREFIX}-css-val {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label); color: var(--ap-text-primary);
  background: transparent; border: 1px solid transparent; border-radius: var(--ap-radius-xs);
  padding: 2px 4px; min-width: 40px;
}
.${PREFIX}-css-prop { flex: 0 1 auto; max-width: 46%; color: var(--ap-primary); }
.${PREFIX}-css-val { flex: 1 1 auto; }
.${PREFIX}-css-prop:hover, .${PREFIX}-css-val:hover { background: var(--ap-surface-active); }
.${PREFIX}-css-prop:focus, .${PREFIX}-css-val:focus {
  outline: none; background: var(--ap-surface-active); border-color: var(--ap-primary);
}
.${PREFIX}-css-prop::placeholder, .${PREFIX}-css-val::placeholder { color: var(--ap-text-primary); opacity: .35; }
.${PREFIX}-css-colon { opacity: .45; }
.${PREFIX}-css-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex: 0 0 auto; padding: 0; cursor: pointer; opacity: 0;
  color: var(--ap-text-primary); background: transparent; border: none; border-radius: var(--ap-radius-sm);
}
.${PREFIX}-css-decl:hover .${PREFIX}-css-del { opacity: .5; }
.${PREFIX}-css-del:hover { opacity: 1; background: var(--ap-surface-active); }
.${PREFIX}-css-del-spacer {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; flex: 0 0 auto; opacity: .4;
}
.${PREFIX}-css-add .${PREFIX}-css-prop, .${PREFIX}-css-add .${PREFIX}-css-val {
  border: 1px dashed var(--ap-border-default);
}

/* CSS tab — computed styles (full list, filterable, editable values).

   No \`border-top\` here: whatever precedes this already draws one (the matched
   rules are a \`sect\`, and every \`sect\` carries a bottom rule), so owning a
   second put two lines 4px apart with nothing between them. */
.${PREFIX}-css-sub-head {
  display: flex; align-items: center; gap: 8px;
  padding: var(--ap-space-sm) var(--ap-space-lg) 4px;
}
/* A control, not a declaration: sans on the input scale, on the same bg,
   border, height and radius as \`select\` and the number fields. It was mono at
   its own padding, which made the one thing here you type into look like the
   property values underneath it. */
.${PREFIX}-css-filter {
  flex: 1 1 auto; min-width: 0;
  height: var(--ap-control-height); padding: 0 var(--ap-space-xs);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  color: var(--ap-text-primary); background: var(--ap-input-bg);
  border: 1px solid var(--ap-input-border); border-radius: var(--ap-radius-sm);
  transition: border-color var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-css-filter::placeholder { color: var(--ap-text-placeholder); }
.${PREFIX}-css-filter:focus { outline: none; border-color: var(--ap-primary); }
.${PREFIX}-css-computed { padding-top: 2px; }
.${PREFIX}-css-prop-ro {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label); color: var(--ap-primary);
  flex: 0 1 auto; max-width: 46%; padding: 2px 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}`;
