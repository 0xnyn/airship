import { design } from "@airship/editor-tokens";
import { PREFIX } from "../dom";
import { Z } from "./const";

/**
 * The X that marks an edge a guide matched, as a background image.
 *
 * Inline SVG in a data URI, which forces the colour to be a literal — a `var()`
 * cannot be URL-encoded into one. Read from the token object rather than typed
 * out, so it still moves when the palette does; `portable.css.ts` reaches for
 * `design` for the same reason, from the other direction.
 *
 * Lives here rather than beside the geometry in `guide-overlay.ts` because it is
 * the only part of that module a stylesheet needs, and importing the module here
 * would pull the whole chrome layer into this file's import graph for one string.
 */
function markImage(): string {
  const stroke = encodeURIComponent(design.semantic.error);
  const svg =
    "%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E" +
    `%3Cline x1='2' y1='2' x2='6' y2='6' stroke='${stroke}' stroke-width='1'/%3E` +
    `%3Cline x1='6' y1='2' x2='2' y2='6' stroke='${stroke}' stroke-width='1'/%3E` +
    "%3C/svg%3E";
  return `url("data:image/svg+xml,${svg}")`;
}

/** The floating chrome layer: hover/selection boxes, handles, drop indicators. */
export const css = `
/* The one surface every piece of floating chrome is drawn on. Fixed at inset 0
   so it *is* the viewport, which makes its absolutely-positioned children take
   screen coordinates with no per-element offset. */
.${PREFIX}-chrome-layer {
  position: fixed; inset: 0; z-index: ${Z}; pointer-events: none;
  font-family: var(--ap-font-sans);
}
/* Border-box is load-bearing, not housekeeping. Chrome is positioned by writing
   a measured rect straight into width/height, and every outline here has a
   border — under content-box that border is added *outside* the number, so a
   1136px element gets a 1140px selection box sitting 2px off on every side. It
   used to be masked by host apps that set \`* { box-sizing: border-box }\`
   globally, which is not a thing to depend on. */
.${PREFIX}-chrome-layer, .${PREFIX}-chrome-layer * { box-sizing: border-box; }

/* Hover + selection boxes.

   Everything on the canvas is drawn at exactly 1px with no radius, and that is
   the single biggest thing separating chrome that reads as an editor from chrome
   that reads as a debug tool. Two reasons it has to be this way:

   A rounded outline is a claim about the element. The box is measured from
   \`getBoundingClientRect()\` and traces the border box exactly; putting a 4px
   radius on it draws corners the element does not have, and on a square element
   — most elements — the mismatch is visible at 100% zoom. A design tool's selection is
   square whatever the object's own corner radius is, for the same reason.

   And there is no transition here on purpose. The hover box is re-\`place()\`d on
   every \`mousemove\`, so a transition on \`all\` interpolates left/top/width/height
   between two elements and the outline visibly trails the cursor. It read as lag
   in the overlay rather than as easing.

   Hover carries no fill either. What distinguishes hover from selection is the
   handles, which is the distinction a design tool draws; a tinted fill on top of that
   just puts a wash over the thing you are trying to look at. */
.${PREFIX}-hover-box {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px solid var(--ap-primary);
}
.${PREFIX}-sel-box {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px solid var(--ap-primary);
}

/* Additional nodes in a multi-selection. Deliberately lighter than the primary
   outline: the panel shows the primary's values, so which one it is has to
   stay legible. At 1px the only headroom left is opacity, which is enough —
   the primary is the one wearing handles. */
.${PREFIX}-extra-box {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px solid var(--ap-primary);
  opacity: .65;
}

/* Marquee rubber band. The one place a fill belongs: it is a region being swept
   rather than an element being pointed at. */
.${PREFIX}-marquee {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px solid var(--ap-primary);
  background: var(--ap-primary-bg);
}

/* Structural context, dotted rather than solid.

   The grammar the whole canvas follows: **solid** is the thing you are pointing
   at (hover, selection), **dotted** is context you did not ask for but need —
   where the selection sits in its tree — **dashed** is a drop target, and red is
   only ever measurement. Keeping those four apart is what lets several of them
   be on screen at once without the canvas turning into noise. */
.${PREFIX}-ctx-parent, .${PREFIX}-ctx-sibling {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border: 1px dotted var(--ap-primary);
}
.${PREFIX}-ctx-sibling { opacity: .5; }

/* Identity badge on the hover / selection box (tag.class · W×H).

   A sibling of its box on the layer rather than a child of it, which it used to
   be. \`place()\` writes a \`clip-path\` onto the box to fence chrome inside its
   frame, and a clip applies to descendants — so a badge hanging above a box near
   the top of a frame was being sliced in half by its own outline. As a sibling
   it is positioned independently and clips on its own terms, which for a badge
   is "not at all": it is an annotation *about* the frame's contents, like the
   frame's own title, not something drawn inside them.

   Anchored to the top-left of the box by default, with the corner nearest the
   box left square so it reads as a tab attached to it — and flipped below when
   the box is close enough to the top of the frame that there is no room, which
   is the case that used to push it off-screen entirely. */
.${PREFIX}-box-label {
  position: absolute; z-index: ${Z}; transform: translateY(-100%);
  max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; pointer-events: none;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption); line-height: 1.7;
  color: var(--ap-text-primary); background: var(--ap-primary);
  border-radius: var(--ap-radius-xs) var(--ap-radius-xs) var(--ap-radius-xs) 0;
}
.${PREFIX}-box-label[data-flip] {
  transform: none;
  border-radius: 0 var(--ap-radius-xs) var(--ap-radius-xs) var(--ap-radius-xs);
}

/* Resize grips: four visible corner squares, and four *invisible*
   strips along the edges between them.

   A design tool does not draw a square at the midpoint of an edge — it makes the whole
   edge grabbable — and eight white squares crowding a small element was most of
   what made the selection read as heavy. All eight are still registered as
   dnd-kit draggables in \`picker.ts\`; only paint and geometry are decided here.

   The strips span corner to corner rather than sitting at a midpoint, so the
   entire edge is a target. They are inset by half a corner handle at each end so
   the two never fight over the same pixel, and centred on the border so their
   6px of slop falls evenly inside and outside it. Expressing the span as
   \`left: 4px; right: 4px\` rather than a computed width is what makes this free:
   the handles are children of a box that is already sized to the element, so the
   browser derives \`width − 8\` and clamps at zero on its own. There is no
   per-frame handle layout to run, and nothing goes negative on a 6px element at
   10% zoom. */
.${PREFIX}-handle { position: absolute; pointer-events: auto; z-index: 1; }
.${PREFIX}-handle-nw, .${PREFIX}-handle-ne,
.${PREFIX}-handle-se, .${PREFIX}-handle-sw {
  width: 8px; height: 8px; border-radius: 1px;
  background: var(--ap-selection-handle); border: 1px solid var(--ap-primary);
}
.${PREFIX}-handle-nw { top: -4px; left: -4px; cursor: nwse-resize; }
.${PREFIX}-handle-ne { top: -4px; right: -4px; cursor: nesw-resize; }
.${PREFIX}-handle-se { bottom: -4px; right: -4px; cursor: nwse-resize; }
.${PREFIX}-handle-sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
.${PREFIX}-handle-n { top: -3px; left: 4px; right: 4px; height: 6px; cursor: ns-resize; }
.${PREFIX}-handle-s { bottom: -3px; left: 4px; right: 4px; height: 6px; cursor: ns-resize; }
.${PREFIX}-handle-e { right: -3px; top: 4px; bottom: 4px; width: 6px; cursor: ew-resize; }
.${PREFIX}-handle-w { left: -3px; top: 4px; bottom: 4px; width: 6px; cursor: ew-resize; }

/* The grab area for drag-to-reposition: a transparent stand-in pinned over the
   selection, and the only thing dnd-kit's sensors are ever bound to on the
   canvas (see reorder.ts). It must opt back into pointer events — the chrome
   layer around it is \`pointer-events: none\` — and must sit *below* the
   selection box, whose resize handles would otherwise be unreachable behind it.
   Clicks that land here still resolve normally: the picker hit-tests inside the
   frame rather than reading the event target, so clicking a child of the
   selection selects that child. */
.${PREFIX}-drag-proxy {
  position: absolute; z-index: 1; pointer-events: auto; cursor: grab;
}
html[data-${PREFIX}-drag] .${PREFIX}-drag-proxy { cursor: inherit; }

/* Drag-to-reposition: target-container highlight, insertion line, dragged node. */
.${PREFIX}-drop-box {
  position: absolute; z-index: ${Z}; pointer-events: none;
  background: var(--ap-primary-bg);
  border: 1px dashed var(--ap-primary); border-radius: var(--ap-radius-xs);
}
/* The insertion bar. Flat, with the glow it used to carry removed: the halo and
   the 6px bloom were doing the job of making a 2px bar visible, and a 2px bar
   inset clear of the container's border is already visible. What the glow
   actually added was a second, softer edge that made the bar read as
   approximate — a suggestion of where the element might go — when the whole
   point of it is that it is exact. Geometry in \`reorder.ts\`. */
.${PREFIX}-drop-line {
  position: absolute; z-index: ${Z}; pointer-events: none;
  background: var(--ap-primary); border-radius: 1px;
}
/* \`.${PREFIX}-dragging\` is *not* here. It styles a node in the host app rather
   than a piece of chrome, so it lives in \`portable.css.ts\` — the one stylesheet
   served into a frame's document as well as this one. It used to be declared
   here and hand-copied into \`frame-agent.ts\`'s \`FRAME_CSS\`, which meant the two
   could disagree, and for a while they did. */

/* Spacing measurement (Alt-hover). Zero-thickness divs with one border rather
   than SVG, drawn on this layer at 1x so the numbers stay readable at any
   canvas zoom.

   These live here, with the rest of the chrome layer, because that is where
   \`position: absolute\` comes from. They were authored in controls.css.ts
   carrying only \`cls("layer")\` besides their own class — and \`layer\` is
   edit-guard's hit-test marker, not a style — so nothing positioned them, the
   left/top writes in place() were inert against a static box, and every
   allocated line and chip rendered in normal flow at the top of the page. */
.${PREFIX}-measure-line {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border-top: 1px solid var(--ap-semantic-error);
}
.${PREFIX}-measure-line[data-axis="v"] {
  border-top: none; border-left: 1px solid var(--ap-semantic-error);
}
.${PREFIX}-measure-line[data-dashed] { border-style: dashed; }
.${PREFIX}-measure-label {
  position: absolute; z-index: ${Z}; pointer-events: none;
  padding: 1px var(--ap-space-xxs); border-radius: var(--ap-radius-xs);
  background: var(--ap-semantic-error); color: var(--ap-text-primary);
  font-size: var(--ap-font-size-caption); font-weight: 500;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
/* How the label sits off its anchor point: centred on the line and lifted clear
   of it. Static, so it belongs here rather than being re-assigned as an inline
   style on every pointermove — and the clearance is a token rather than the
   bare \`4\` it was written as in the arithmetic. */
.${PREFIX}-measure-label[data-axis="h"] {
  transform: translate(-50%, calc(-100% - var(--ap-space-xxs)));
}
.${PREFIX}-measure-label[data-axis="v"] {
  transform: translate(var(--ap-space-xxs), -50%);
}

/* Alignment guides. Same red as the measurements, because they are the same
   claim — a fact about distance and position rather than about structure — and
   the same zero-thickness-div-with-one-border trick, which lands on exact
   device pixels where an SVG stroke would not. Geometry in \`guide-overlay.ts\`. */
.${PREFIX}-guide {
  position: absolute; z-index: ${Z}; pointer-events: none;
  border-left: 1px solid var(--ap-semantic-error);
}
.${PREFIX}-guide[data-axis="y"] {
  border-left: none; border-top: 1px solid var(--ap-semantic-error);
}
/* The crosses a design tool puts on the edges a guide matched: one on a centre, two on
   a pair of corners. A background image and not two rotated children — an X is
   one glyph, and drawing it as two elements doubles the pool for no gain.
   Encoded rather than tokenised because a data URI cannot carry a \`var()\`; the
   colour still comes from the palette, via \`markImage()\`. */
.${PREFIX}-guide-mark {
  position: absolute; z-index: ${Z}; pointer-events: none;
  background-image: ${markImage()};
  background-size: contain; background-repeat: no-repeat;
}

/* Box-model hatching: the padding, margin and gap a container is spending.

   Diagonal stripes rather than a flat tint, because these overlap each other and
   overlap the element they describe — a wash would stack into an opaque block,
   while hatching at two angles stays readable through itself. The 4px period is
   a *screen* constant and the rects are drawn at 1×, so it stays 4px at any
   canvas zoom, which is the whole reason this layer exists.

   Three hues, and they are conventions rather than our choice: blue inside the
   border, amber outside it, pink for the space between children. Anyone who has
   used a browser's element inspector already knows which is which. */
.${PREFIX}-hatch {
  position: absolute; z-index: ${Z}; pointer-events: none;
}
.${PREFIX}-hatch[data-kind="padding"] {
  background-image: repeating-linear-gradient(-45deg,
    transparent, transparent 3px,
    color-mix(in srgb, var(--ap-box-padding) 50%, transparent) 3px,
    color-mix(in srgb, var(--ap-box-padding) 50%, transparent) 4px);
}
.${PREFIX}-hatch[data-kind="margin"] {
  background-image: repeating-linear-gradient(-45deg,
    transparent, transparent 3px,
    color-mix(in srgb, var(--ap-box-margin) 50%, transparent) 3px,
    color-mix(in srgb, var(--ap-box-margin) 50%, transparent) 4px);
}
.${PREFIX}-hatch[data-kind="gap"] {
  background-image: repeating-linear-gradient(-45deg,
    transparent, transparent 3px,
    color-mix(in srgb, var(--ap-box-gap) 50%, transparent) 3px,
    color-mix(in srgb, var(--ap-box-gap) 50%, transparent) 4px);
}`;
