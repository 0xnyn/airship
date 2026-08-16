import { PREFIX } from "../dom";
import { MENU_MAX_W } from "./const";

/** The pan/zoom surface, the frames on it, and their per-frame chrome. */
export const css = `
/* The clipping viewport — full-bleed, the way a design tool's canvas is. The docks
   float on top of it rather than pushing it in, so opening one no longer
   resizes the surface underneath: the frames stay exactly where they were.
   What stops a fit from parking frames behind a dock is the safe-area inset
   (\`setSafeInset\` in app.ts → \`safeRect\` in viewport.ts), not this box.
   Sits *below* the overlay root in z-order: it is the substrate, not chrome. */
.${PREFIX}-canvas-viewport {
  position: fixed; inset: 0;
  overflow: hidden; z-index: 0; touch-action: none;
  background: var(--ap-surface-canvas);
  /* A faint dot grid, so panning and zooming read as motion over a surface. */
  background-image: radial-gradient(rgba(255,255,255,var(--ap-opacity-08)) 1px, transparent 1px);
  background-size: 24px 24px;
  font-family: var(--ap-font-sans);
}
.${PREFIX}-canvas-world {
  position: absolute; top: 0; left: 0; width: 0; height: 0;
  transform-origin: 0 0;
  /* One composited layer for the whole canvas: panning past several live app
     instances moves an existing layer instead of re-rasterising them. */
  will-change: transform;
}
/* Space held down, or the Hand tool armed: the canvas is ready to be grabbed.
   Both put the same class on the viewport, so there is one cursor rule for the
   pair — see \`CanvasViewport.setHandTool\` for why the tool exists on top of the
   modifier. Nothing here reaches inside a frame: an iframe renders its own
   cursor, which is exactly the boundary the Hand respects. */
.${PREFIX}-canvas-pannable { cursor: grab; }
.${PREFIX}-canvas-panning { cursor: grabbing; }
.${PREFIX}-canvas-panning .${PREFIX}-canvas-world,
/* Mid-wheel-gesture, stop hit-testing the world: every frame of a pan would
   otherwise drive an elementFromPoint into a moving iframe. */
.${PREFIX}-canvas-gesture .${PREFIX}-canvas-world { pointer-events: none; }

/* A frame: a device-sized window onto the app, positioned in world space. The
   #fff background and drop shadow are the *app preview's* defaults, not editor
   chrome theming — the frame renders the user's own app (which defaults to a
   white page) as a card floating on the canvas, so it intentionally does not
   reference the editor surface/shadow tokens. */
.${PREFIX}-frame {
  position: absolute; overflow: hidden;
  background: #fff; border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.28);
}
.${PREFIX}-frame-doc {
  display: block; width: 100%; height: 100%; border: 0; background: #fff;
  color-scheme: normal;
}
/* The capture plane. In edit mode it takes every pointer event so all input is
   handled in the shell's document and hit-tested into the frame — which is what
   lets one dnd-kit manager see every gesture. Hidden in view mode, when the app
   below is meant to be used.

   A plain arrow, matching the inline overlay's edit-mode rule in \`base.css.ts\`
   — and changing one without the other leaves the same tool showing two
   different cursors depending on which stage it is running on. See that rule for
   why a crosshair is the wrong cursor for pointing at things. */
.${PREFIX}-frame-plane {
  position: absolute; inset: 0; cursor: default;
}
/* The canvas half of the editable-text affordance. The plane is the shell
   element the pointer is actually over, so it is the one that has to say so —
   the node it is hovering lives a realm down and behind it. Paired with the
   \`[data-…-cursor="text"]\` rule in \`base.css.ts\`, which does the same job
   inline; both are driven from the same attribute write. */
html[data-${PREFIX}-cursor="text"] .${PREFIX}-frame-plane { cursor: text; }
html[data-${PREFIX}-drag] .${PREFIX}-frame-plane { cursor: inherit; }

/* Per-frame furniture, drawn in screen space at 1x — see frame-chrome.ts. */
.${PREFIX}-fchrome-root { position: absolute; inset: 0; pointer-events: none; }
.${PREFIX}-fc { position: absolute; pointer-events: none; }
.${PREFIX}-fc-label {
  position: absolute; left: 0; bottom: 100%; margin-bottom: 6px;
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  pointer-events: auto; cursor: grab; user-select: none; white-space: nowrap;
  font-size: var(--ap-font-size-body); line-height: 1.6; color: var(--ap-text-tertiary);
}
.${PREFIX}-fc-label:active { cursor: grabbing; }
/* The name is the drag handle — the badge beside it is a real <button>, and
   dnd-kit's pointer sensor ignores presses that start on native interactive
   elements, so pressing the badge opens the menu rather than moving the frame.
   That is the right split, but it leaves the name as the only grab target, so
   give it enough padding to be one. */
.${PREFIX}-fc-name {
  overflow: hidden; text-overflow: ellipsis;
  padding: 3px 4px; margin: -3px -4px 0;
}
.${PREFIX}-fc-active .${PREFIX}-fc-name { color: var(--ap-primary); }
/* A readout, not a control — it used to open the per-frame menu. The padding
   stays so the numbers keep their inset from the name beside them; the pointer,
   hover surface and button reset go, because there is nothing here to press.
   \`pointer-events\` is inherited from \`.fc-label\`, which is the drag handle. */
.${PREFIX}-fc-size {
  padding: 0 4px;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-placeholder);
}
/* Inline rename field — sized and styled to sit exactly where the title was. */
.${PREFIX}-fc-rename {
  pointer-events: auto; width: 12ch; min-width: 8ch; padding: 0 2px;
  background: var(--ap-surface-panel); color: var(--ap-text-primary);
  border: 1px solid var(--ap-primary); border-radius: var(--ap-radius-xs);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-body); line-height: 1.6;
}
.${PREFIX}-fc-outline {
  position: absolute; inset: 0; pointer-events: none;
  outline: 1px solid transparent; outline-offset: 0;
}
/* Selection is explicit now — no frame is selected until you pick one — so the
   highlight can say something. An earlier version highlighted whichever frame
   was touched last, which meant one was always lit; toning that down to a
   hairline then left clicking a frame with no visible result at all. */
.${PREFIX}-fc-active .${PREFIX}-fc-outline {
  outline: 2px solid var(--ap-primary);
  outline-offset: 1px;
}
.${PREFIX}-fc-busy .${PREFIX}-fc-outline { outline-color: var(--ap-primary); }
/* Frame grips sit on the frame's own border — distinct from the element grips
   in picker.ts, which sit on the selection inside it. */
.${PREFIX}-fc-grip { position: absolute; pointer-events: auto; }
.${PREFIX}-fc-grip-n, .${PREFIX}-fc-grip-s { left: 8px; right: 8px; height: 8px; cursor: ns-resize; }
.${PREFIX}-fc-grip-e, .${PREFIX}-fc-grip-w { top: 8px; bottom: 8px; width: 8px; cursor: ew-resize; }
.${PREFIX}-fc-grip-n { top: -4px; }
.${PREFIX}-fc-grip-s { bottom: -4px; }
.${PREFIX}-fc-grip-w { left: -4px; }
.${PREFIX}-fc-grip-e { right: -4px; }
.${PREFIX}-fc-grip-nw, .${PREFIX}-fc-grip-ne,
.${PREFIX}-fc-grip-sw, .${PREFIX}-fc-grip-se { width: 12px; height: 12px; }
.${PREFIX}-fc-grip-nw { top: -6px; left: -6px; cursor: nwse-resize; }
.${PREFIX}-fc-grip-ne { top: -6px; right: -6px; cursor: nesw-resize; }
.${PREFIX}-fc-grip-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.${PREFIX}-fc-grip-se { bottom: -6px; right: -6px; cursor: nwse-resize; }

/* Edit mode: the frame furniture goes inert — see \`FrameChrome.setEditing\`.
   Interaction is gated, identity is not. The title and size badge stay *visible*
   so you can still tell which frame you are working inside; they simply stop
   answering, along with the grips and the selection outline. Dropping the label
   entirely is what made the first attempt at this unusable. */
/* The badge is a plain span inside the label now, so one rule on the label
   covers both — it used to need naming separately because it was a button. */
.${PREFIX}-fchrome-inert .${PREFIX}-fc-label { pointer-events: none; cursor: default; }
.${PREFIX}-fchrome-inert .${PREFIX}-fc-grip { display: none; }
.${PREFIX}-fchrome-inert .${PREFIX}-fc-active .${PREFIX}-fc-outline { outline-color: transparent; }
.${PREFIX}-fchrome-inert .${PREFIX}-fc-active .${PREFIX}-fc-name { color: var(--ap-text-tertiary); }
/* A live resize still shows its outline: the gesture cannot start in edit mode,
   but one begun in view mode must not lose its feedback if anything toggles. */
.${PREFIX}-fchrome-inert .${PREFIX}-fc-busy .${PREFIX}-fc-outline { outline-color: var(--ap-primary); }

/* Device menu on the size badge.

   Placement is computed in JS (see \`placeMenu\`), not declared here: a frame can
   be anywhere on the canvas, so a menu fixed to one side opens off-screen as
   soon as its frame is near that edge. The offsets below are only the defaults
   for the first paint, before it has been measured.

   \`max-width\` is a cap, and there is deliberately no floor beside it. There used
   to be a hand-measured \`min-width: 288px\` here, sized to the widest device row
   *anywhere in the list* — with Desktop open the longest is "MacBook Pro 16"",
   with Phone open it is "iPhone 16 & 17 Pro Max" beside "440 × 956" in mono —
   because a collapsed group was \`display: none\` and contributed nothing to the
   shrink-to-fit box, so the menu resized on every toggle; and since
   \`placePopover\` derives \`left\` from \`offsetWidth\`, a width jump was a sideways
   jump too. That floor bought stability at the price of an over-wide root pane,
   and it had to be re-measured by hand whenever a device was added.

   The collapse was the thing that was wrong. \`.fc-dgroup-body[inert]\` below is
   shut but still laid out, so the widest row in *any* group sets the width in
   every state and there is nothing left for a floor to prevent. What is left to
   bound is the other direction — see \`MENU_MAX_W\`. */
.${PREFIX}-fc-menu {
  position: absolute; left: 0; top: 0; z-index: 2;
  pointer-events: auto; padding: 4px;
  max-width: min(${MENU_MAX_W}px, calc(100vw - 2 * var(--ap-space-base)));
  display: flex; flex-direction: column;
  background: var(--ap-surface-panel); border: 1px solid var(--ap-border-default);
  border-radius: var(--ap-radius-md); box-shadow: var(--ap-elevation-card);
  overflow-y: auto; overscroll-behavior: contain;
}
/* \`nowrap\` because \`.fc-menu\` is absolutely positioned with no width, so it is
   shrink-to-fit: the widest row sets the box, and this is what stops a row that
   does not fit under the cap above from answering with a second line rather than
   an ellipsis — which is how "402 ×" ends up sitting over "874". */
.${PREFIX}-fc-menu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 5px 8px; border: 0; border-radius: var(--ap-radius-xs);
  background: transparent; cursor: pointer; text-align: left; white-space: nowrap;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label); color: var(--ap-text-primary);
}
.${PREFIX}-fc-menu-item:hover { background: var(--ap-surface-active); }
.${PREFIX}-fc-menu-on { color: var(--ap-primary); }
.${PREFIX}-fc-menu-dim { font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption); opacity: .5; }
.${PREFIX}-fc-menu-head {
  padding: 4px 8px 6px; font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-caption); letter-spacing: .6px; opacity: .5;
}
/* Device groups — Phone / Tablet / Desktop, one open at a time.

   The hairline is drawn from adjacency rather than from separator nodes: a rule
   about "between groups" cannot be forgotten the day a fourth group is
   added. */
.${PREFIX}-fc-dgroup { display: flex; flex-direction: column; }
.${PREFIX}-fc-dgroup + .${PREFIX}-fc-dgroup {
  margin-top: 4px; padding-top: 4px;
  border-top: 1px solid var(--ap-border-default);
}
/* Collapsed, and still measured — the twin of \`.pop-group-body[inert]\`, and the
   reason \`.fc-menu\` above no longer carries a hand-measured floor. The rows are
   laid out at zero height, so they go on setting the menu's width whether their
   group is open or not; \`inert\` keeps them out of the tab order and out of hit
   testing while they do it, and \`syncGroups\` writes that attribute. */
.${PREFIX}-fc-dgroup-body[inert] {
  visibility: hidden; block-size: 0; overflow: hidden;
}
/* Sentence case and body type, not the uppercase mono of \`fc-menu-head\`: these
   are section headers in a list you are reading, not the menu's own title. */
.${PREFIX}-fc-dgroup-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 8px; border: 0; border-radius: var(--ap-radius-xs);
  background: transparent; cursor: pointer; text-align: left;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  color: var(--ap-text-primary);
}
.${PREFIX}-fc-dgroup-head:hover { background: var(--ap-surface-active); }
/* One mark for the whole menu. Rotating \`chev-right\` a quarter turn reproduces
   \`chev-down\` exactly — the set draws them as one path at two rotations — so
   this is exact rather than approximate.

   Driven from \`aria-expanded\` rather than swapped in JS the way the chat
   timeline's collapsibles are. A timeline row is built once and changed by a
   click; this menu's derived state is rewritten by \`syncMenus\` on every frame of
   a pan, and re-parsing three SVGs per frame to flip a direction the DOM already
   records is work that lands on the one gesture that has to stay smooth.

   No transition, deliberately: \`.fc-menu\` is re-placed continuously while the
   canvas moves, and an animating transform inside a box that is itself being
   re-positioned is the smear \`scripts/check-css.mjs\` describes. That guard only
   polices \`chrome.css.ts\`, so this is a choice rather than a constraint. */
.${PREFIX}-fc-dgroup-head .${PREFIX}-ic { flex: 0 0 16px; opacity: .5; }
.${PREFIX}-fc-dgroup-head[aria-expanded="true"] .${PREFIX}-ic { transform: rotate(90deg); }
/* 8px padding + 16px glyph + 6px gap, so the group's name and every device name
   under it share one left edge and the triangle hangs in a gutter of its own.
   Getting this wrong is what makes an accordion read as two unrelated lists
   rather than a tree. */
.${PREFIX}-fc-dgroup-body .${PREFIX}-fc-menu-item { padding-left: 30px; }

/* Custom size: the escape hatch from the preset list. */
.${PREFIX}-fc-menu-custom {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px 6px;
}
.${PREFIX}-fc-menu-num {
  width: 62px; padding: 3px 6px; border-radius: var(--ap-radius-xs);
  background: var(--ap-surface-active); color: var(--ap-text-primary);
  border: 1px solid var(--ap-border-default);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
}
.${PREFIX}-fc-menu-go {
  margin-left: auto; padding: 3px 8px; border: 0; cursor: pointer;
  border-radius: var(--ap-radius-xs);
  background: var(--ap-primary); color: var(--ap-text-primary);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-body);
}
/* The + menu hangs off the toolbar; same JS placement, same clamping. */
.${PREFIX}-fbar-menu { left: 0; top: 0; }

/* Canvas tools — add a frame, fit, zoom readout. A section of the bottom bar
   rather than a surface of its own: the bar already carries the card, so this
   only has to be a row. */
.${PREFIX}-fbar {
  display: inline-flex; align-items: center; gap: 2px;
}
/* The frame verb group, in the bar's view-mode zone rather than in \`bar-tools\`.
   Stretched for the same reason \`.bar-tools .fbar\` is: the dimensions menu is
   placed against this group's rect, and a row centred inside a taller bar would
   measure the gap above the buttons and land the menu on the card's top edge. */
.${PREFIX}-fbar-frame { align-self: stretch; }
/* These are mounted into the app's own bottom bar, so they take its button box:
   \`.tool\` is a 28px square (see docks.css). This used to be a 24-tall,
   36-wide rectangle carrying an \`md\` glyph, which put the canvas verbs both a
   size and a shape apart from the tools beside them.
   \`.fbar-zoom\` keeps the horizontal padding — it carries a text readout, not a
   glyph, so it has to be free to be wider than it is tall. */
.${PREFIX}-fbar-btn, .${PREFIX}-fbar-zoom {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: var(--ap-control-icon-box); border: 0; cursor: pointer;
  border-radius: var(--ap-radius-xs); background: transparent;
  color: var(--ap-text-primary); font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
}
.${PREFIX}-fbar-btn { width: var(--ap-control-icon-box); padding: 0; }
.${PREFIX}-fbar-zoom { min-width: var(--ap-control-icon-box); padding: 0 6px; }
.${PREFIX}-fbar-btn:hover, .${PREFIX}-fbar-zoom:hover { background: var(--ap-surface-active); }
.${PREFIX}-fbar-off { opacity: .35; pointer-events: none; }
.${PREFIX}-fbar-sep { width: 1px; height: 14px; margin: 0 2px; background: var(--ap-border-default); }`;
