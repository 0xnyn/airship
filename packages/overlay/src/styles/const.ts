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

/**
 * The label rail on a `labelled()` row, in CSS px.
 *
 * Here for the reason `MIN_DOCK_W` is: comments in `inspector.css.ts` and
 * `controls.css.ts` reason about "the 68px label rail" in five places while the
 * number itself lived in exactly one of them, as a literal. Anything that has
 * to be quoted to be explained belongs where it can be imported.
 *
 * It is one half of a wrap threshold rather than a free choice. A `.row` breaks
 * when the rail, a gutter and `--ap-row-ctl-min` stop fitting the dock, so this
 * number and that one decide together whether a row is one line or two.
 */
export const LABEL_RAIL_W = 68;

/**
 * The command palette's title column, and the ceiling it may grow to.
 *
 * Two numbers for one column, for the reason `LABEL_RAIL_W` and
 * `LABEL_MAX_CHARS` below are two numbers for one rail: the width is what the
 * layout uses and the character count is the budget prose cannot hold.
 *
 * The column is *measured*, not declared — `.palette-list` sizes it with
 * `fit-content()`, so it is as wide as the longest title actually on screen and
 * a query filtered down to two rows does not reserve room for twenty-six
 * characters. `PALETTE_TITLE_MAX` is only the ceiling that stops one long title
 * from eating the sentence beside it. `PALETTE_TITLE_W` is the same column for
 * an engine without `subgrid`, where nothing can measure across rows and a
 * literal is the honest fallback rather than a shrug.
 *
 * 176 is arrived at rather than picked: the longest title the catalog ships is
 * "Drop the change you are on" at 26 characters, and at `--ap-font-size-title`
 * (13px Inter) a mixed-case character averages ~6.6px — 172, rounded onto the
 * 8px grid. `keys/catalog.test.ts` asserts against `PALETTE_TITLE_MAX_CHARS`,
 * because the derivation is only true while that sentence is still the longest.
 */
export const PALETTE_TITLE_W = 176;
export const PALETTE_TITLE_MAX = 220;
export const PALETTE_TITLE_MAX_CHARS = 26;

/**
 * The widest a menu may get, in CSS px.
 *
 * A cap, and deliberately not a floor. `.fc-menu` in `canvas.css.ts` used to
 * answer the same problem with `min-width: 288px` and a paragraph apologising
 * for it — "the root pane being over-wide is the price" — because a collapsed
 * `display: none` group measures zero and the box therefore resized every time
 * you opened one. The collapse was what was wrong: a group that is shut but
 * still *laid out* contributes its width, so a menu is already as wide as its
 * widest row in any group and there is nothing left for a floor to prevent. See
 * `.pop-group-body[inert]` in `pop.css.ts`.
 *
 * What is left to bound is the other direction. Menu labels are not all
 * authored here — a token name, a font family, a comment range — and one long
 * one would widen a menu of six verbs into a panel. 320 is measured against the
 * widest row the product actually ships: a device row is 30px of group indent,
 * "iPhone 16 & 17 Pro Max" (~132px at `--ap-font-size-label`), a 12px gutter,
 * "440 × 956" (nine mono characters at `--ap-font-size-caption`, 54px) and 8px
 * of padding — 236, plus `.pop-menu`'s own 8 and the shell's 2, about 246. 320
 * leaves ten more characters for a device that ships next year and still reads
 * as a menu rather than a panel.
 */
export const MENU_MAX_W = 320;

/**
 * The shortest a panel may be dragged, in CSS px.
 *
 * Here rather than in `app.ts` for the reason `MIN_DOCK_W` is: the stylesheet's
 * docked-height fallback, the drag clamp and the dock stories all have to agree
 * on it, and a number that has to be quoted to be explained belongs where it can
 * be imported.
 *
 * Below this a panel is a title bar with a sliver under it, which is worse than
 * not being resizable at all.
 */
export const MIN_DOCK_H = 200;

/**
 * The most characters a rail label may run to.
 *
 * Derived the way `TIP_MAX_W` derives its own: at `--ap-font-size-label` (12px
 * Inter) the rail holds about fourteen characters. The rail neither ellipsises
 * nor clips — there is nowhere for a fifteenth to go, so it wraps to a second
 * line and takes the row's height with it.
 *
 * The rule was written down in `descriptors.ts` long before this constant, and
 * drifted anyway: it claimed "Blend mode" at ten was the longest label shipped,
 * by which time three labels were past fourteen and one was twenty-four. Prose
 * cannot hold a budget. `tooltip.copy.test.ts` asserts against this.
 */
export const LABEL_MAX_CHARS = 14;
