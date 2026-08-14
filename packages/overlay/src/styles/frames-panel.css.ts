import { PREFIX } from "../dom";

/**
 * The frame list — the left dock's view-mode body.
 *
 * Written against the same measures as the chat panel it shares a dock with, so
 * switching modes does not move the panel's edges or change its rhythm: the bar
 * across the top matches the composer's padding, and a row is the same height
 * as an inspector control.
 *
 * The row is a three-column grid rather than a flex row, and that is what makes
 * a long device name shorten instead of pushing the size readout out of the
 * panel — \`minmax(0, 1fr)\` on the middle column is the whole mechanism.
 */
export const css = `
.${PREFIX}-fp { display: flex; flex-direction: column; min-height: 0; flex: 1; }

/* Count and add, across the top. The count is not decoration: the cap is eight
   and nothing else on screen says so until you hit it and get a toast. */
.${PREFIX}-fp-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--ap-space-sm);
  padding: var(--ap-space-sm) var(--ap-space-md);
  border-bottom: 1px solid var(--ap-border-subtle);
}
.${PREFIX}-fp-count {
  font-size: var(--ap-font-size-label); color: var(--ap-text-tertiary);
  letter-spacing: .02em;
}
.${PREFIX}-fp-add {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: none; border-radius: var(--ap-radius-xs);
  background: transparent; color: var(--ap-text-secondary); cursor: pointer;
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-fp-add:hover:not(:disabled) {
  background: var(--ap-surface-hover); color: var(--ap-text-primary);
}
.${PREFIX}-fp-add:disabled { opacity: .4; cursor: default; }

.${PREFIX}-fp-scroll {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: var(--ap-space-xs) var(--ap-space-sm);
}

/* The list is the drop line's containing block, and it has to be: an absolutely
   positioned box is placed against its containing block's *padding* box, so with
   the scroller in that role the line was offset by the scroller's own
   \`padding-top\` — measured from the list, drawn from the padding edge, one
   \`--ap-space-xs\` too high on every row. Being the list also means the line's
   left and right edges are the rows' own, with nothing to restate. */
.${PREFIX}-fp-list { position: relative; }

/* The whole row is the drag target (see \`buildRow\`), but the cursor stays what
   each part of it does: \`fp-pick\` selects and shows a pointer, \`fp-more\` opens
   a menu. A \`grab\` here would be painted only in the gaps between those two —
   \`fp-pick\` covers most of the row and sets its own — so it would read as a
   rendering fault rather than as an affordance. The grip is the visual signal,
   the way it is in every list of this shape. */
.${PREFIX}-fp-row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: 2px;
  border-radius: var(--ap-radius-xs);
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-fp-row:hover { background: var(--ap-surface-hover); }
/* Blue, matching the canvas.

   The active frame is outlined in \`--ap-primary\` and its title goes blue with
   it (\`canvas.css.ts\`'s \`.fc-active\`), while this row was \`--ap-surface-selected\`
   — a flat grey. Two surfaces showing the same fact in two colours, and the
   panel's was the one that did not look like a selection at all: grey is also
   what \`:hover\` gives, one token apart. \`--ap-primary-bg\` is the established
   "this is the active one" fill (\`controls.css.ts\`'s pad modes,
   \`inspector.css.ts\`), which keeps the grammar \`guide-overlay.ts\` states —
   blue is what you are pointing at. */
.${PREFIX}-fp-row-on { background: var(--ap-primary-bg); }
/* Faded rather than moved: the row stays where it is for the whole drag and the
   drop line does the reporting, so the list cannot reflow under the pointer. */
.${PREFIX}-fp-row-drag { opacity: .4; }

/* Revealed on hover — and on focus, which is not symmetry for its own sake.
   dnd-kit makes this a real tab stop (see \`buildRow\`), so a hover-only reveal
   would leave a keyboard user landing on a control that is not painted.

   No longer the drag *target* — the whole row is — but still the drag
   affordance: it is what says the row can be picked up at all, and it is the
   only keyboard route to a restack, because \`POINTER_ONLY\` unregisters the
   keyboard sensor and \`onGripKey\` takes its place. */
.${PREFIX}-fp-grip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; color: var(--ap-text-tertiary);
  cursor: grab; opacity: 0;
  transition: opacity var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-fp-row:active .${PREFIX}-fp-grip { cursor: grabbing; }
.${PREFIX}-fp-row:hover .${PREFIX}-fp-grip,
.${PREFIX}-fp-grip:focus-visible { opacity: 1; }

/* The row's own hit target. Transparent and borderless because the row behind
   it carries the surface — a nested button with its own background would paint
   a second rectangle inside the first. */
.${PREFIX}-fp-pick {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--ap-space-sm);
  min-width: 0; padding: 6px 4px;
  border: none; background: transparent; cursor: pointer; text-align: left;
  color: var(--ap-text-secondary); font: inherit;
}
.${PREFIX}-fp-row-on .${PREFIX}-fp-pick { color: var(--ap-text-primary); }
/* The name carries the blue, mirroring \`.fc-active .fc-name\` on the canvas. The
   size stays tertiary: it is a readout, and colouring it too would make the row
   read as one blue block rather than as a name that is selected. */
.${PREFIX}-fp-row-on .${PREFIX}-fp-name { color: var(--ap-primary); }

.${PREFIX}-fp-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--ap-font-size-body);
}
/* The editing affordance has to be visible or a double-click looks like it did
   nothing — the caret alone is not enough on a one-line label. */
.${PREFIX}-fp-name-edit {
  outline: 1px solid var(--ap-primary); outline-offset: 2px;
  border-radius: 2px; cursor: text;
}
.${PREFIX}-fp-dims {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label);
  color: var(--ap-text-tertiary); white-space: nowrap;
}

.${PREFIX}-fp-more {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: none; border-radius: var(--ap-radius-xs);
  background: transparent; color: var(--ap-text-tertiary);
  cursor: pointer; opacity: 0;
  transition: opacity var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-fp-row:hover .${PREFIX}-fp-more,
.${PREFIX}-fp-more:focus-visible { opacity: 1; }
.${PREFIX}-fp-more:hover { color: var(--ap-text-primary); }

/* Where the dragged row would land. \`pointer-events: none\` because it tracks
   the cursor and would otherwise sit under it, eating the moves that place it. */
.${PREFIX}-fp-drop {
  position: absolute; left: 0; right: 0;
  height: 2px; border-radius: 1px;
  background: var(--ap-primary); pointer-events: none;
}
`;
