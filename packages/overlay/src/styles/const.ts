import { PREFIX } from "../dom";

/** One stacking level for every piece of overlay chrome. */
export const Z = "2147483600";

/**
 * The popover layer, one step above the rest of the chrome.
 *
 * This has to be a real `z-index` rather than "be the last child of the root".
 * The docks declare `z-index: ${Z}` explicitly, and a positioned element with
 * `z-index: auto` paints in an earlier step of the algorithm than any positioned
 * element with a numeric one — so an auto-stacked host loses to a dock however
 * late it appears in the DOM. It is also appended last, and `toast.ts` mounts
 * its own host ahead of this one to keep that true, but that is hygiene rather
 * than the mechanism.
 */
export const Z_POP = "2147483601";

/**
 * The toast layer, one step above the popovers.
 *
 * Above rather than below, and that ordering is deliberate: a toast is
 * `pointer-events: none` and gone in under three seconds, so putting it on top
 * can never cost anyone a click — whereas a toast painted *under* an open colour
 * picker is unreadable at exactly the moment it is trying to tell you something.
 */
export const Z_TOAST = "2147483602";

/** The overlay root selector — token vars and the reset are scoped to it. */
export const ROOT = `#${PREFIX}-root`;

/**
 * The narrowest a dock can be dragged.
 *
 * Here rather than in `app.ts` because it is a number the stylesheet, the
 * splitter clamp and the story catalogue all have to agree on, and this module
 * is already where those shared numbers live. The stories in particular need it
 * without paying for `app.ts`: importing a 3,000-line module that constructs the
 * dnd-kit singleton on load, in order to read one integer, would put the whole
 * application in the dependency graph of every control story.
 */
export const MIN_DOCK_W = 280;

/**
 * The minimap's projection box, in CSS px, and the margin held inside it.
 *
 * Here for the same reason `MIN_DOCK_W` is, one clause stronger. The dock width
 * is a number the stylesheet and the clamp merely have to *agree* on; this one
 * is a number the stylesheet and the arithmetic have to be the *same* on. The
 * minimap projects the world into this box with `projectInto` and then writes
 * the results as inline `left`/`top`/`width`/`height`, so a stylesheet that
 * disagreed by a pixel would not misalign the card — it would draw every frame
 * in the wrong place inside it, and nothing would report it.
 *
 * Fixed rather than measured, which also buys the tests: the projection is
 * pure arithmetic over these constants, so it can be asserted under happy-dom
 * without stubbing a layout that happy-dom does not do.
 */
export const MINIMAP_W = 208;
export const MINIMAP_H = 136;

/**
 * Breathing room between the projected content and the card's edge.
 *
 * Not cosmetic: the viewport indicator is drawn as a 1px-bordered box, and at
 * the exact fit it would land flush against the card's own border and read as
 * part of it.
 */
export const MINIMAP_PAD = 10;

/**
 * The widest a tooltip may be.
 *
 * Narrow enough to fit inside the narrowest dock, which is the constraint that
 * picks the number. `Tooltips.bounds()` clamps to the enclosing dock with a 6px
 * margin either side, and `clamp` resolves a min above its max to the *max* — so
 * a tip as wide as `MIN_DOCK_W` gets shoved off the panel's left edge by the very
 * clamp that exists to contain it. 260 + 12 keeps that impossible.
 *
 * It is also the right measure. At `--ap-font-size-body` (11px Inter) the 242px
 * of content inside the padding and border runs about 43 characters — the bottom
 * of the 45-75 band, which is where micro-copy shown for half a second belongs.
 */
export const TIP_MAX_W = 260;
