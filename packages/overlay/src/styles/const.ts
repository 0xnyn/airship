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
