import { PREFIX } from "../dom";
import { ROOT, Z } from "./const";

/** Root reset, icon colour roles, edit/drag cursors, the drop sentinel. */
export const css = `
${ROOT}, ${ROOT} * { box-sizing: border-box; }
${ROOT} {
  position: fixed; inset: 0; z-index: ${Z}; pointer-events: none;
  font-family: var(--ap-font-sans); color: var(--ap-text-primary);
  -webkit-font-smoothing: antialiased;
}

/* Icons sit one step below text, the way a design tool's do — an icon that matches the
   text colour reads as loud as a label, which is what made the old chrome feel
   busy. The --ap-icon-* ramp exists for exactly this and was previously unused,
   so every glyph inherited --ap-text-primary (#FFF).

   The tone comes through a custom property rather than being set flat, because
   this selector is \`#id .class\` and it matches the glyph's own span. A rule
   that matches an element beats any \`color\` that element would have inherited,
   whatever the parent's specificity — so a button could not tint its own glyph.
   Send was the visible casualty: \`.action.primary\` sets white, and the caret
   painted #BEBEBE on the blue anyway, which is most of why it read as badly
   set rather than merely small. A custom property inherits, so any ancestor can
   set --ic-tone and the var() picks it up here with no specificity contest. */
${ROOT} .${PREFIX}-ic, .${PREFIX}-chrome-layer .${PREFIX}-ic {
  display: inline-flex;
  color: var(--${PREFIX}-ic-tone, var(--ap-icon-secondary));
}
${ROOT} .${PREFIX}-ic svg, .${PREFIX}-chrome-layer .${PREFIX}-ic svg { display: block; }
/* State tones set the same property, so there is one way to tint a glyph. These
   land on the \`.ic\` element itself and a container's --ic-tone only reaches it
   by inheritance, which is what keeps hover and disabled winning over it. */
${ROOT} button:hover .${PREFIX}-ic,
${ROOT} .${PREFIX}-ctl-seg-on .${PREFIX}-ic,
${ROOT} .${PREFIX}-insp-tab-on .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-primary); }
${ROOT} button:disabled .${PREFIX}-ic,
${ROOT} [disabled] .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-icon-disabled); }

.${PREFIX}-hidden { display: none !important; }

/* Scrollbars. One definition, applied by class, for every scroll container the
   overlay owns.

   These were \`scrollbar-width: none\` plus \`::-webkit-scrollbar { display: none }\`
   — a deliberate-looking choice that quietly broke the mouse. A trackpad can
   swipe a horizontal rail sideways and a hidden scrollbar costs it nothing; a
   mouse wheel produces vertical delta only, so with no scrollbar, no wheel
   handler and no visible edge, the chips past the fold were simply unreachable.
   The people who built it were on trackpads, which is exactly why it survived.

   Transparent at rest so the chrome stays quiet, tinted once the surface is
   under the pointer or holds focus. \`scrollbar-width: thin\` reserves its gutter
   whether or not the thumb is painted, so revealing it shifts nothing — and the
   rails are \`:empty { display: none }\`, so the ~6px is only spent when there is
   something to scroll, which is when you want the affordance anyway.

   Both syntaxes: \`scrollbar-color\` is the standard one (Firefox, Chrome 121+),
   \`::-webkit-scrollbar\` covers Safari and older WebKit. An engine that honours
   the first ignores the second, so they do not fight.

   The \`--ap-scrollbar-*\` ramp has been shipping from @airship/editor-tokens
   since the token set was written and had no reader until now. */
.${PREFIX}-scroll-x, .${PREFIX}-scroll-y {
  scrollbar-width: thin; scrollbar-color: transparent transparent;
}
/* \`overflow-y: hidden\` on the rail is deliberate: the thin scrollbar takes 6px
   off the content box, and without it a chip that exactly fills the row can
   provoke a vertical scrollbar on a one-row strip. \`.scroll-y\` sets no
   cross-axis value at all — the panels it dresses hold rows that are
   occasionally wider than the dock, and \`overflow-x: hidden\` would clip them
   where today they scroll. */
.${PREFIX}-scroll-x { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
.${PREFIX}-scroll-y { overflow-y: auto; overscroll-behavior-y: contain; }
.${PREFIX}-scroll-x:hover, .${PREFIX}-scroll-x:focus-within,
.${PREFIX}-scroll-y:hover, .${PREFIX}-scroll-y:focus-within {
  scrollbar-color: var(--ap-scrollbar-thumb) var(--ap-scrollbar-track);
}
.${PREFIX}-scroll-x::-webkit-scrollbar, .${PREFIX}-scroll-y::-webkit-scrollbar {
  width: 6px; height: 6px;
}
.${PREFIX}-scroll-x::-webkit-scrollbar-track, .${PREFIX}-scroll-y::-webkit-scrollbar-track {
  background: var(--ap-scrollbar-track);
}
.${PREFIX}-scroll-x::-webkit-scrollbar-thumb, .${PREFIX}-scroll-y::-webkit-scrollbar-thumb {
  background: transparent; border-radius: var(--ap-radius-pill);
}
.${PREFIX}-scroll-x:hover::-webkit-scrollbar-thumb, .${PREFIX}-scroll-x:focus-within::-webkit-scrollbar-thumb,
.${PREFIX}-scroll-y:hover::-webkit-scrollbar-thumb, .${PREFIX}-scroll-y:focus-within::-webkit-scrollbar-thumb {
  background: var(--ap-scrollbar-thumb);
}
.${PREFIX}-scroll-x::-webkit-scrollbar-thumb:hover, .${PREFIX}-scroll-y::-webkit-scrollbar-thumb:hover {
  background: var(--ap-scrollbar-thumb-hover);
}
.${PREFIX}-scroll-x::-webkit-scrollbar-thumb:active, .${PREFIX}-scroll-y::-webkit-scrollbar-thumb:active {
  background: var(--ap-scrollbar-thumb-active);
}

/* Fade the edge a rail can still scroll toward, so the overflow is visible
   before you hover it — the affordance a mouse user actually notices. The
   attribute is written by \`attachRailWheel\` from the rail's own scroll position;
   absent means it fits and nothing is masked. */
.${PREFIX}-scroll-x[data-overflow="right"] {
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent 100%);
}
.${PREFIX}-scroll-x[data-overflow="left"] {
  mask-image: linear-gradient(to right, transparent 0, #000 24px);
}
.${PREFIX}-scroll-x[data-overflow="both"] {
  mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
}

/* Edit mode: the page is a canvas, not an app. Element-level cursors (a link's
   pointer, an input's text caret) beat \`document.body.style.cursor\`, so the
   arrow has to be forced from here — and text selection has to be off, or
   dragging across the page selects paragraphs instead of moving elements.

   The cursor is a plain arrow and not a crosshair, which is what this was for a
   long time. A crosshair is what a design tool shows when you are about to *draw*
   something — it means "click and drag defines a new rect". Edit mode does the
   opposite: it points at things that already exist. Forcing a crosshair over
   every element in the page turned a direct-manipulation surface into something
   that read like a screenshot tool, and it fought the resize and grab cursors
   the chrome sets deliberately.
   The \`:not([data-…-drag])\` guard hands the cursor over to the drag rule below
   for the duration of a gesture, which would otherwise lose on specificity. The
   \`:not([data-…-text-edit])\` guard on the descendant does the same job for the
   node being edited in place: this selector carries two ID-weight \`:not()\`
   arguments and declares \`!important\`, so the rules in \`portable.css.ts\` cannot
   beat it on merit, and without the exemption you get a crosshair and
   \`user-select: none\` sitting on top of the text you are typing into. Inline
   only — which is exactly why it is the sort of thing that gets found late.

   Scoped to \`:not([data-…-shell])\` because it only applies to the inline
   overlay. On the canvas this document contains no app to make inert — the
   frames handle that with \`pointer-events: none\` — and blanket-crosshairing
   the shell would put a crosshair on the chat composer. */
html[data-${PREFIX}-mode="edit"]:not([data-${PREFIX}-shell]):not([data-${PREFIX}-drag]),
html[data-${PREFIX}-mode="edit"]:not([data-${PREFIX}-shell]):not([data-${PREFIX}-drag]) body,
html[data-${PREFIX}-mode="edit"]:not([data-${PREFIX}-shell]):not([data-${PREFIX}-drag]) body *:not(${ROOT}):not(${ROOT} *):not([data-${PREFIX}-text-edit]) {
  cursor: default !important;
  user-select: none !important;
}
/* A text cursor over anything a double-click would open for editing, so the
   gesture reads as available rather than as something you have to already know
   about. Driven from a root attribute for the reason the block above is:
   \`document.body.style.cursor\` loses to any element-level \`cursor: pointer\`, so
   a link you can edit the label of would keep showing a hand. Written by
   \`SelectionController.applyHover\`, and only when the value changes.

   Placed after the edit-mode block and before the drag block deliberately: it
   has to beat the blanket \`cursor: default\`, and lose to a live drag. */
html[data-${PREFIX}-mode="edit"][data-${PREFIX}-cursor="text"]:not([data-${PREFIX}-shell]):not([data-${PREFIX}-drag]) body *:not(${ROOT}):not(${ROOT} *) {
  cursor: text !important;
}
/* While a drag is live the gesture owns the cursor, overlay chrome included. */
html[data-${PREFIX}-drag], html[data-${PREFIX}-drag] body, html[data-${PREFIX}-drag] body * {
  cursor: var(--${PREFIX}-drag-cursor, grabbing) !important;
  user-select: none !important;
}
html[data-${PREFIX}-drag="col-resize"] { --${PREFIX}-drag-cursor: col-resize; }
/* The horizontal twin of \`col-resize\`, for a dock's bottom edge. Not
   \`ns-resize\`, which is beside it: that is the cursor for a *handle* that moves
   an edge in space, and this is a splitter that redistributes room between two
   things — the distinction the pointer-cursor spec draws, and the one the width
   splitter already relies on. */
html[data-${PREFIX}-drag="row-resize"] { --${PREFIX}-drag-cursor: row-resize; }
html[data-${PREFIX}-drag="ns-resize"] { --${PREFIX}-drag-cursor: ns-resize; }
html[data-${PREFIX}-drag="ew-resize"] { --${PREFIX}-drag-cursor: ew-resize; }
html[data-${PREFIX}-drag="nwse-resize"] { --${PREFIX}-drag-cursor: nwse-resize; }
html[data-${PREFIX}-drag="nesw-resize"] { --${PREFIX}-drag-cursor: nesw-resize; }

/* Viewport-sized stand-in that gives the canvas droppable a shape. It is never
   hit-tested — the collision detector reads the pointer against the live DOM. */
.${PREFIX}-drop-sentinel {
  position: fixed; inset: 0; pointer-events: none; opacity: 0;
}`;
