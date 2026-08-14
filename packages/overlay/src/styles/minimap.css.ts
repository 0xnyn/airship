import { PREFIX } from "../dom";
import { MINIMAP_H, MINIMAP_W, Z } from "./const";

/**
 * The canvas minimap — a small card in the bottom-right corner.
 *
 * The surface recipe is the dock's, not a new one: same panel fill, hairline
 * border and card elevation, so the map reads as another piece of the editor's
 * furniture rather than something painted onto the canvas.
 *
 * The box's dimensions come from \`const.ts\` rather than being written here,
 * and that is load-bearing. \`minimap.ts\` projects the world into exactly these
 * numbers and then writes the results as inline geometry — a stylesheet that
 * disagreed by a pixel would not misalign the card, it would misplace every
 * frame drawn inside it, silently.
 *
 * Note the absent \`transition\` on the two positioned children. Everything else
 * here may animate; those two are rewritten on every frame of a pan, and an
 * eased \`left\` would leave the indicator trailing the canvas it is supposed to
 * be reporting. Same rule \`chrome.css.ts\` is held to by \`check-css.mjs\`, for
 * the same reason — it is simply not enforceable from here, because the rest of
 * this file is legitimately allowed to move.
 *
 * There is no close button and so no rule for one. The card is furniture: see
 * the header of \`minimap.ts\` for why being able to dismiss it was worth less
 * than the trap it set.
 */
export const css = `
.${PREFIX}-minimap {
  position: fixed;
  right: var(--ap-space-md); bottom: var(--ap-space-md);
  z-index: ${Z}; pointer-events: auto;
  padding: 4px; border-radius: var(--ap-radius-md);
  background: var(--ap-surface-panel);
  border: 1px solid var(--ap-border-default);
  box-shadow: var(--ap-elevation-card);
}

/* The projection box. \`cursor: grab\` says the whole surface is draggable, which
   it is — pressing anywhere jumps there rather than requiring a hit on an
   indicator that is only a few pixels wide when zoomed out. */
.${PREFIX}-minimap-body {
  position: relative; overflow: hidden;
  width: ${MINIMAP_W}px; height: ${MINIMAP_H}px;
  border-radius: var(--ap-radius-xs);
  /* The same fill the canvas itself uses, so the map reads as a scaled copy of
     the surface rather than as a panel that happens to have shapes on it. */
  background: var(--ap-surface-canvas);
  cursor: grab; touch-action: none;
}
.${PREFIX}-minimap-body:active { cursor: grabbing; }

/* A frame. Filled rather than outlined: at this scale a 1px border on a 12px
   box is most of the box, and the fill is what makes a wall of frames legible
   as a shape. */
.${PREFIX}-minimap-frame {
  position: absolute;
  background: var(--ap-text-tertiary);
  border-radius: 1px;
  opacity: .55;
}
.${PREFIX}-minimap-frame-on {
  background: var(--ap-primary);
  opacity: 1;
}

/* Where you are looking. Outline over fill, so it reads as a window onto the
   frames rather than another one of them — and it sits above them all, which is
   why \`syncChips\` inserts new chips *before* it. */
.${PREFIX}-minimap-view {
  position: absolute;
  border: 1px solid var(--ap-primary);
  border-radius: 1px;
  background: var(--ap-primary-bg);
  pointer-events: none;
}

/* The bar is centred at \`bottom: 16px\` and grows with the mode it is in; below
   this the two would overlap. The map is the one that gives way — it is the
   enhancement, and every one of its functions has a keyboard route. */
@media (max-width: 900px) {
  .${PREFIX}-minimap { display: none; }
}
`;
