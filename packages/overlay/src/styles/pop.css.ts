import { PREFIX } from "../dom";
import { MENU_MAX_W, TIP_MAX_W, Z_POP } from "./const";

/**
 * The popover layer: the host, the shared shell, and the menu shape.
 *
 * The host is the overlay root's last child and covers it exactly, so a shell's
 * `position: absolute` coordinates are already screen coordinates and
 * `placePopover`'s offset-parent conversion collapses to the identity.
 *
 * The colour picker's own internals live in `controls.css.ts` next to the swatch
 * they belong to; only the shell chrome is here.
 */
export const css = `
.${PREFIX}-pop-host {
  position: absolute; inset: 0; z-index: ${Z_POP}; pointer-events: none;
}
/* The tooltip. Here rather than beside the docks it mostly labels, because
   \`Tooltips\` mounts it into the host above and its neighbours are the shells
   below it.

   \`z-index: 1\`, and not the global \`Z\`: the host is a stacking context of its
   own, so the global scale means nothing inside it. What this orders is the tip
   against its *siblings* — the \`.pop\` shells, which carry no z-index and are all
   appended after the tip, which is created once when the overlay mounts. Drop
   the number and DOM order takes over: the tip paints under every popover ever
   opened, which is how it reads on a control inside the colour picker.

   It wraps, and that is the shape of the whole rule. Most tips are one short
   line, but a handful carry values the editor did not author — a font stack, a
   stylesheet URL, a review comment body — and for those the tip *is* the
   untruncated view of a field that already truncated. Ellipsing them throws
   away the only thing they were opened for.

   This used to say \`white-space: nowrap\` alongside the same width cap and no
   overflow rule at all. Those cannot both hold: the text laid out at its full
   intrinsic width while the border, background and shadow painted at the cap, so
   from about 45 characters up the label sat outside its own box. It also made
   \`offsetWidth\` report the cap rather than the painted width, so the centring in
   \`Tooltips.place\` and its dock clamp were both computed from a number that was
   never true of anything on screen. */
.${PREFIX}-tip {
  position: absolute; z-index: 1; pointer-events: none;
  display: flex; align-items: baseline; gap: 6px;
  width: max-content; max-width: ${TIP_MAX_W}px; padding: 4px 8px;
  background: var(--ap-surface-selected); color: var(--ap-text-primary);
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-xs);
  box-shadow: var(--ap-elevation-floating);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-body); line-height: 1.5;
}
/* Three lines, then an ellipsis. A tip is a label and not a document, and the
   interpolated ones have no length bound at all — a comment body is whatever
   somebody typed into it.

   \`overflow-wrap: anywhere\` rather than \`break-word\` is for the values with no
   spaces to break at, a stylesheet URL being the one that actually turns up:
   only \`anywhere\` lowers the min-content width, so the box settles at
   \`max-width\` instead of being pushed past it by a single unbreakable token. */
.${PREFIX}-tip-text {
  min-width: 0;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
  overflow: hidden; overflow-wrap: anywhere;
}
/* The chord never wraps and never shrinks. It is the one part of a tooltip that
   is unreadable if it breaks, so the \`min-width: 0\` above makes the *text* the
   item that gives way — the container stays \`flex-wrap: nowrap\`, which is what
   keeps the chip on the first line beside a wrapped tip instead of orphaning it
   onto a line of its own. \`baseline\` on the container is what sits it on that
   first line rather than halfway down the block, and it is also what lines
   JetBrains Mono up with Inter at the same size, which \`center\` never did. */
.${PREFIX}-tip-key {
  flex: 0 0 auto; white-space: nowrap;
  font-family: var(--ap-font-mono); color: var(--ap-text-tertiary);
}
/* The shell is the scroller, because the shell is what carries the cap.

   \`placePopover\` measures the content and writes a \`max-height\` *here* — and a
   max-height on a box with no overflow does not scroll. It just shortens the
   painted box and lets the rest of the content run out through the radius, over
   the page, with no background under it. A long menu rendered its first dozen
   rows on the panel and the rest on the canvas.

   \`.fc-menu\` — the canvas's own client of the same placement code — has always
   carried \`overflow-y: auto\`. This rule was written from it and kept
   \`overscroll-behavior\`, which is only meaningful on a scroller, while dropping
   the property that made it one.

   \`overflow-x: hidden\` rather than auto: nothing here should ever be wider than
   its own shell (see \`matchAnchorWidth\`), and a horizontal scrollbar under a
   menu is a bug report rather than an affordance. Note this also makes the shell
   a clipping box, so a popover that hangs a decoration outside its content will
   lose it — every current one keeps its knobs and chits inside the 8px padding. */
.${PREFIX}-pop {
  position: absolute; pointer-events: auto;
  background: var(--ap-surface-panel);
  border: 1px solid var(--ap-border-default);
  border-radius: var(--ap-radius-md);
  box-shadow: var(--ap-elevation-floating);
  /* Vertical overflow and the scrollbar itself come from \`.scroll-y\`, which
     every shell carries. \`overflow-x\` stays here: it is a clipping decision
     rather than a scrolling one, and the note above depends on it. */
  overflow-x: hidden;
}

/* A popover's title bar, and the only part of it you can drag by.
   Reads as the section heading it sits under — same mono uppercase eyebrow as
   \`.sect-head\` — because a settings popover is a section that happens to
   float, and giving it a second visual language would make it a dialog.

   \`sticky\` rather than static: the shell is the scroller (\`.scroll-y\`), and a
   bar that scrolled away would take the grab handle with it, stranding a
   popover you had scrolled to the bottom of. */
.${PREFIX}-pop-bar {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: var(--ap-control-row-gap);
  padding: var(--ap-space-xs) var(--ap-space-sm);
  margin-bottom: var(--ap-control-row-gap);
  background: var(--ap-surface-panel);
  border-bottom: 1px solid var(--ap-border-default);
  cursor: grab; user-select: none; touch-action: none;
}
.${PREFIX}-pop-bar:active { cursor: grabbing; }
.${PREFIX}-pop-bar-title {
  flex: 1 1 auto; min-width: 0;
  font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-caption); letter-spacing: .6px; opacity: .6;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* A modal popover: the command palette and the shortcuts panel.

   Centred by CSS rather than placed, which is why \`openPopover\` skips
   \`placePopover\` entirely for one of these — the placement writes a \`left\` and
   a \`top\`, and either would fight the transform below.

   Above centre, not at it: a sheet pinned to the exact middle of the window
   reads as lower than centre, and this one grows downward as you type, so
   anchoring it high keeps the first result where the eye already is. The same
   trick every command palette uses.

   \`overflow: hidden\` overrides \`.pop\`'s \`auto\`: a palette scrolls its
   *results*, not its shell, or the search field scrolls away from the query
   being typed into it. The rows below own the scrolling; this only clips them
   to the rounded corner. */
.${PREFIX}-pop-modal {
  position: fixed; left: 50%; top: 18vh; transform: translateX(-50%);
  width: min(560px, calc(100vw - 2 * var(--ap-space-xl)));
  max-height: min(60vh, 520px);
  display: flex; flex-direction: column;
  overflow: hidden;
}

/* The palette, wider than the modal it composes, and the sentence is why.

   Declared rather than left to the fallback so the class \`openPalette\` passes
   has a rule to find: an applied class with no rule anywhere is
   indistinguishable from a missing stylesheet, and \`styles/index.test.ts\` now
   fails one.

   The width is measured rather than picked. Left to right: 2 × \`--ap-space-base\`
   of list inset (32), a title column that tops out at \`PALETTE_TITLE_MAX\` for
   the longest title shipped, two 16px gutters (32), a chord column at about 72 —
   twelve characters of "Ctrl+Shift+Z" in 10px JetBrains Mono, which is 6px a
   character — and the shell's own 2px of border. That is over 350 before a
   single word of the sentence.

   At \`.pop-modal\`'s 560 the sentence gets about 200px, some 33 characters, and
   every doc in the catalog runs past it — a description column that always
   elides is not a description column. 680 gives it about 320, some 53
   characters, which clears most of the catalog and elides the longest honestly.
   It also sits between 560 and \`.pop-shortcuts\`'s 880, so the three sheets read
   as a scale rather than as three guesses. */
.${PREFIX}-pop-palette {
  width: min(680px, calc(100vw - 2 * var(--ap-space-xl)));
}

/* The shortcuts sheet is a reference, not a search box, and wants a different
   box from the palette it shares \`.pop-modal\` with.

   \`.sc-body\` sets \`columns: 2\`, so at the modal's 560px each column is about
   250px — and the sheet renders every command, every gesture and the closing
   notes, roughly sixty rows, into that. Both classes were applied with no rule
   of their own, so this inherited a box sized for ten results and a query.

   Higher, too: a taller box anchored at 18vh would push its own tail off the
   bottom of the window. */
.${PREFIX}-pop-shortcuts {
  top: 10vh;
  width: min(880px, calc(100vw - 2 * var(--ap-space-xl)));
  max-height: min(80vh, 720px);
}

/* The scrim. Takes the press meant for the page behind it — without one, a
   click beside the palette lands on the app and selects an element on the way
   to closing the palette. \`pointer-events: auto\` because \`.pop-host\` is
   \`none\`, and the host's own outside-press handler is what closes it.

   A literal rather than a token: the set has no scrim colour, and inventing an
   \`--ap-\` name here would put a value in the stylesheet that
   \`packages/editor-tokens/EDITOR.md\` has never heard of. */
.${PREFIX}-pop-scrim {
  position: fixed; inset: 0; pointer-events: auto;
  background: rgba(0, 0, 0, 0.4);
}

/* A stand-in for the pointer, so a context menu can be anchored at a *point*.
   \`openPopover\` places against an element's rect and watches that element for
   removal, so a bare coordinate needs a box; this is the smallest honest one.
   Removed when the menu closes. */
.${PREFIX}-point-anchor {
  position: fixed; width: 1px; height: 1px; pointer-events: none;
}

/* Menu. Mirrors \`.fc-menu-item\` rather than sharing it: the canvas keeps its
   own \`.fc-menu*\` for the device and add-frame menus, which are placed against
   world-space geometry on every pan and re-anchor themselves, so they never
   came through this host. Two shapes that look alike but answer to different
   placement code are better apart than accidentally coupled. */
/* \`overflow-y\` here is now redundant for a plain menu — the shell hits its cap
   first — but it is load-bearing for \`.token-list\`, which composes this class
   and takes its scrolling from it. Do not tidy it away. */
/* A cap and a floor, and they answer opposite complaints.

   150 is the floor, against a menu narrower than its own rows are readable.
   What it could never fix is the direction this menu was actually failing in: a
   collapsed \`.pop-group\` used to be \`display: none\`, so the shrink-to-fit box
   was as wide as the four visible verbs — about 158 — and snapped to ~250 the
   moment you opened a device group, which \`placePopover\` then read back as a
   different \`offsetWidth\` and turned into a horizontal jump on the next scroll.
   \`canvas.css.ts\` used to answer that with a hand-measured floor and a paragraph
   accepting an over-wide root pane as the price; \`.pop-group-body[inert]\` below
   answers it by not breaking the measurement in the first place, so there is no
   price and no number to keep in step with the device list.

   \`MENU_MAX_W\` is the remaining bound and it points the other way — see its
   docstring. The viewport term is not decoration: \`placePopover\` clamps \`left\`,
   not width, so a menu wider than the window would still run off the side of
   it. */
.${PREFIX}-pop-menu {
  display: flex; flex-direction: column;
  padding: 4px; min-width: 150px;
  max-width: min(${MENU_MAX_W}px, calc(100vw - 2 * var(--ap-space-base)));
  overflow-y: auto;
}
/* \`line-height\` is the row height, stated once.

   Three row families sat at three heights: a verb row with a 20px glyph was 30,
   a group head with a 16px chevron 26, and a device row with no glyph 25 —
   because a text-only row is sized by \`line-height: normal\`, which at 12px Inter
   is about 15. Pinning the text box to the *glyph* box makes all three
   5 + 16 + 5, and it also stops \`.pop-item-hint\`'s 10px mono from setting a
   shorter box than the label beside it.

   \`nowrap\` for the reason \`.fc-menu-item\` gives, one file over: with a cap on
   the menu above, a row that could wrap would answer a too-narrow box by growing
   a second line rather than eliding — which is how "402 ×" ended up sitting over
   "874". */
.${PREFIX}-pop-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 5px 8px; border: 0; border-radius: var(--ap-radius-xs);
  background: transparent; cursor: pointer; text-align: left;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  line-height: 16px; white-space: nowrap;
  color: var(--ap-text-primary);
}
.${PREFIX}-pop-item:hover { background: var(--ap-surface-active); }
/* The selected value and the keyboard cursor are different states — you arrow
   past the current value on the way to another one, and a menu that moves its
   checkmark with the arrow keys is lying about what is set. */
.${PREFIX}-pop-item-on { color: var(--ap-primary); }
.${PREFIX}-pop-item[data-pop-active] {
  background: var(--ap-surface-active); outline: none;
}
.${PREFIX}-pop-item:focus-visible {
  outline: 1px solid var(--ap-border-focus); outline-offset: -1px;
}
/* The label gives way, and only the label. \`.pop-item-main\` already carries
   \`min-width: 0\`; this is the item inside it that has somewhere to put the
   overflow, and without it the cap on \`.pop-menu\` would have nothing to elide
   and would simply be overrun. */
.${PREFIX}-pop-item-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
/* Never shrinks, never wraps. It is a size or a chord — the two things in a menu
   that are *wrong* rather than merely short when they break. */
.${PREFIX}-pop-item-hint {
  flex: 0 0 auto;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption); opacity: .5;
}
.${PREFIX}-pop-sep { height: 1px; margin: 4px 2px; background: var(--ap-border-default); }
/* Group heading. Same mono eyebrow as the inspector's section headers, so a
   grouped menu reads as part of the same system. */
.${PREFIX}-pop-head {
  padding: 6px 8px 2px; font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-micro); letter-spacing: .6px; color: var(--ap-text-tertiary);
}
/* ---- Collapsible group -------------------------------------------------- */

/* The long-list answer, next to \`pop-head\`'s short-list one. Written to the same
   measures as \`fc-dgroup\` in \`canvas.css.ts\` on purpose: the device list appears
   in both menu systems, and two accordions over the same twenty-two rows must
   not be visibly different objects. */
.${PREFIX}-pop-group { display: flex; flex-direction: column; }
.${PREFIX}-pop-group + .${PREFIX}-pop-group {
  margin-top: 4px; padding-top: 4px;
  border-top: 1px solid var(--ap-border-default);
}
/* Sentence case and body type, not \`pop-head\`'s uppercase mono: these are
   section headers in a list you are reading, not the menu's own title. */
.${PREFIX}-pop-group-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 8px; border: 0; border-radius: var(--ap-radius-xs);
  background: transparent; cursor: pointer; text-align: left;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  line-height: 16px; white-space: nowrap;
  color: var(--ap-text-primary);
}
.${PREFIX}-pop-group-head:hover { background: var(--ap-surface-active); }
/* Rotating \`chev-right\` a quarter turn reproduces \`chev-down\` exactly — the set
   draws them as one path at two rotations — so one glyph serves both states.
   Driven from \`aria-expanded\`, which is where the state already lives. */
/* \`:first-child\` because a group may now carry a second glyph — its own mark,
   after the chevron. Both of these are about the *disclosure*: an unscoped
   selector dimmed the mark to half and, worse, spun it a quarter turn every
   time the group opened. */
.${PREFIX}-pop-group-head > .${PREFIX}-ic { flex: 0 0 16px; }
.${PREFIX}-pop-group-head > .${PREFIX}-ic:first-child { opacity: .5; }
.${PREFIX}-pop-group-head[aria-expanded="true"] > .${PREFIX}-ic:first-child { transform: rotate(90deg); }
/* Collapsed, and still measured.

   The two halves of that sentence are the whole fix. \`.hidden\` is
   \`display: none !important\`, and a box that is not laid out contributes nothing
   to the shrink-to-fit width of the flex column above it — so this menu was one
   width with its groups shut and another with one open, and since
   \`placePopover\` derives \`left\` from \`offsetWidth\`, the width change was a
   sideways jump on the next scroll or resize as well. A shut group that is still
   laid out contributes its widest row's width, so the menu is as wide as its
   widest row *in any group* in every state, and there is no floor to maintain
   and no number to get wrong.

   \`block-size: 0\` collapses it on the axis it is being collapsed on — as a flex
   item its \`flex-basis: auto\` resolves to this, so the height really is zero and
   \`placePopover\`'s \`scrollHeight\` reads exactly what it read before.
   \`overflow: hidden\` clips what no longer fits, and is scoped to the shut state
   so an open group cannot clip a row's focus ring. \`visibility: hidden\` is the
   paint half; \`inert\` — the attribute this selects on — is the interaction half,
   and is what keeps a measured row out of the tab order, out of hit-testing and
   out of the accessibility tree. \`items()\` filters on that same attribute rather
   than trusting either, so the keyboard cursor is right even under happy-dom,
   where nothing computes a style and nothing implements inertness. */
.${PREFIX}-pop-group-body[inert] {
  visibility: hidden; block-size: 0; overflow: hidden;
}
/* 8px padding + 16px glyph + 6px gap, so a group's name and every row under it
   share one left edge and the triangle hangs in a gutter of its own. Getting
   this wrong is what makes an accordion read as two unrelated lists rather than
   a tree.

   The row above agrees now: \`buildRow\` draws its glyph at "xs" and
   \`.pop-item-main\` gaps at 6, so a verb, a group name and a device name all
   start at 30. They used to start at 36, 30 and 30 — three families, two left
   edges, in one menu. */
.${PREFIX}-pop-group-body .${PREFIX}-pop-item { padding-left: 30px; }

.${PREFIX}-pop-item-main { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.${PREFIX}-pop-item-main { --${PREFIX}-ic-tone: var(--ap-icon-secondary); }
.${PREFIX}-pop-item-main .${PREFIX}-ic { flex: 0 0 auto; }
.${PREFIX}-pop-item[aria-disabled="true"] { opacity: .4; cursor: default; }
.${PREFIX}-pop-item[aria-disabled="true"]:hover { background: transparent; }

/* ---- Review comment box ------------------------------------------------- */
/* Anchored to the diff it is about, rather than prefilling the composer: the
   whole value of a comment is that it points at specific lines. */
.${PREFIX}-pop-comment { padding: var(--ap-space-xs); }
.${PREFIX}-comment-pop { display: flex; flex-direction: column; gap: 6px; width: 280px; }
.${PREFIX}-comment-where {
  display: flex; align-items: center; gap: var(--ap-space-xs);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-tertiary);
}
.${PREFIX}-comment-where { --${PREFIX}-ic-tone: var(--ap-primary); }
.${PREFIX}-comment-input {
  width: 100%; resize: vertical; min-height: 56px;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  line-height: 1.45; color: var(--ap-text-primary);
  background: var(--ap-input-bg); border: 1px solid var(--ap-input-border);
  border-radius: var(--ap-radius-sm); padding: 6px 8px;
}
.${PREFIX}-comment-input:focus { outline: none; border-color: var(--ap-input-focus-border); }
.${PREFIX}-comment-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--ap-space-xs); }
.${PREFIX}-comment-hint { font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption); color: var(--ap-text-tertiary); }

/* ---- A form in a popover ------------------------------------------------ */
/* The "advanced settings" shape: the two or three properties you set once
   and then forget, kept out of the section's everyday height. Same labelled
   rows as the panel, so it reads as the same system rather than a dialog. */
/* A gap, and the rows give up their margins to it — the same correction
   \`.sect-body\` takes, and for a sharper reason: this is a flex column, and
   margins do not collapse between flex items, so two rows each asking for 6px
   were sitting 12px apart. The form read a pitch looser than the panel it is
   supposed to look like. */
.${PREFIX}-pop-form {
  display: flex; flex-direction: column;
  gap: var(--ap-control-row-gap);
  padding: var(--ap-space-sm); min-width: 236px;
}
.${PREFIX}-pop-form > .${PREFIX}-row { margin: 0; }
.${PREFIX}-pop-form .${PREFIX}-row-label { flex: 0 0 60px; }
/* The control's floor, restated for this shell rather than inherited.

   \`--ap-row-ctl-min\` is 192px, measured against a dock: 60 + 8 + 192 is 260,
   and a 236px form minus its padding leaves 212 — so every labelled row in
   here wrapped its label onto its own line, in a popover with no dock edge
   forcing it to. 144 is what actually fits, and it is arrived at rather than
   guessed: the content box less the rail and the gutter.

   Not by widening the shell instead: 236 is shared with the token picker
   deliberately, after this panel had grown three popover widths for three
   popovers. A number that exists to be the same everywhere is the wrong one to
   change for one caller. */
.${PREFIX}-pop-form > .${PREFIX}-row > .${PREFIX}-ctl-seg,
.${PREFIX}-pop-form > .${PREFIX}-row > .${PREFIX}-select-wrap,
.${PREFIX}-pop-form > .${PREFIX}-row > .${PREFIX}-pad-row {
  --${PREFIX}-row-ctl-min: 144px;
}
/* The honest footnote. Quiet, and wrapped rather than truncated — it is the
   only place the panel explains what CSS cannot express, so it has to be
   readable rather than tidy. */
.${PREFIX}-pop-note {
  margin-top: var(--ap-control-row-gap);
  padding-top: var(--ap-control-row-gap);
  border-top: 1px solid var(--ap-border-default);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-caption);
  line-height: 1.45; color: var(--ap-text-tertiary);
}
/* A control that exists to name something CSS will not do. Legible enough to
   read, plainly inert. */
.${PREFIX}-pop-form [disabled],
.${PREFIX}-pop-form .${PREFIX}-ctl-input[disabled] {
  cursor: default; opacity: .38;
}

/* ---- Design token picker ------------------------------------------------ */
/* A menu with a search field on top. Same width as .pop-form above — the panel
   had grown three different popover widths (236, 240, 260) for three popovers
   that all sit against the same 320px rail.

   \`overflow: hidden\` is load-bearing, not tidiness. \`placePopover\` defaults to
   \`scroll: true\` and writes a \`max-height\` measured from the shell as it stands
   at open time — and this shell opens with an empty list, so that height was the
   search field alone. Every row added afterwards overflowed a ~40px box that had
   no \`overflow\` set, so the options painted *outside* the shell, over the page,
   with no background under them; scrolling the inner list moved them back into
   the painted strip, which is exactly what it looked like. The reposition after
   each render fixes the height, and this makes the failure impossible rather
   than merely fixed.

   \`.pop\` is a scroller in its own right now, and this opts *out* of it: the
   search field is pinned and only the list below it may move, which is the one
   shape the shared shell cannot express. The shorthand here wins over \`.pop\`'s
   two longhands at equal specificity by source order. */
.${PREFIX}-pop-token {
  display: flex; flex-direction: column;
  min-width: 236px; overflow: hidden;
}
.${PREFIX}-token-pick {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
}

/* ---- A typed value at the end of a list --------------------------------- */
/* The escape hatch a menu of presets needs: the list can only offer what was
   known when it was built, and a model shipped this morning is not on it.

   Its own classes rather than the canvas's \`.fc-menu-custom\` trio, which is
   the same idea one shape away — that row holds two 62px number fields for a
   width and a height, and an identifier wants the whole width. Sharing them
   would mean one of the two callers overriding most of what it inherited. */
.${PREFIX}-pop-custom {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px 6px;
}
.${PREFIX}-pop-custom-input {
  flex: 1 1 auto; min-width: 0; padding: 3px 6px;
  border-radius: var(--ap-radius-xs);
  background: var(--ap-input-bg); color: var(--ap-text-primary);
  border: 1px solid var(--ap-input-border);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
}
.${PREFIX}-pop-custom-input:focus {
  outline: none; border-color: var(--ap-input-focus-border);
}
.${PREFIX}-pop-custom-go {
  flex: 0 0 auto; padding: 3px 8px; border: 0; cursor: pointer;
  border-radius: var(--ap-radius-xs);
  background: var(--ap-primary); color: var(--ap-text-primary);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-caption);
}

/* ---- Colour picker ------------------------------------------------------ */

.${PREFIX}-pop-color { width: 232px; }
.${PREFIX}-pop-color-body { display: flex; flex-direction: column; gap: 8px; padding: 8px; }

/* Saturation / value. Three stacked gradients: white to transparent across,
   black to transparent up, over the current hue. Same construction a design tool uses,
   and it costs no canvas and no repaint beyond one custom property. */
.${PREFIX}-pop-sv {
  position: relative; height: 140px; border-radius: var(--ap-radius-xs);
  cursor: crosshair; touch-action: none;
  background:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent),
    var(--${PREFIX}-hue, #f00);
}
.${PREFIX}-pop-sv:focus-visible { outline: 1px solid var(--ap-border-focus); outline-offset: 2px; }
.${PREFIX}-pop-sv-knob {
  position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px;
  border: 2px solid #fff; border-radius: var(--ap-radius-full);
  box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none;
}

.${PREFIX}-pop-sliders { display: flex; flex-direction: column; gap: 8px; }
.${PREFIX}-pop-slider {
  position: relative; height: 12px; border-radius: var(--ap-radius-full);
  cursor: pointer; touch-action: none;
}
.${PREFIX}-pop-slider:focus-visible { outline: 1px solid var(--ap-border-focus); outline-offset: 2px; }
.${PREFIX}-pop-slider-hue {
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
/* The alpha track is the checkerboard; the gradient to the current colour is a
   child so it can be restyled without rebuilding the checker. */
.${PREFIX}-pop-slider-alpha {
  background-image: var(--${PREFIX}-checker); background-size: 8px 8px;
}
.${PREFIX}-pop-slider-fill {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
}
/* The knob travels inside the track, not across it.
   \`left\` used to be the raw percentage against a \`-7px\` margin, which put the
   knob's centre on the track's end at both extremes — so half of a 14px dial
   hung outside a 12px track, into the 8px of \`.pop-color-body\` padding, and
   came to rest one pixel from the shell's border. At 0% and 100%, which is
   where an alpha slider spends most of its life, it read as falling off.

   Travelling the *box* from 0 to \`100% - 14px\` keeps both ends flush with the
   track instead: the knob still marks the value it always did, because the
   track's own ends are what moved under it. The 14px is stated twice here and
   has to stay in step with \`width\`; there is no third place it appears.
   \`--knob\` is a 0-1 number written by \`color-picker.ts\`. */
.${PREFIX}-pop-slider-knob {
  position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 0;
  left: calc((100% - 14px) * var(--${PREFIX}-knob, 0));
  background: #fff; border-radius: var(--ap-radius-full);
  box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none;
}

.${PREFIX}-pop-row { display: flex; align-items: center; gap: 4px; }
.${PREFIX}-pop-fields { flex: 1 1 auto; min-width: 0; display: flex; gap: 2px; }
.${PREFIX}-pop-fields > * { flex: 1 1 0; min-width: 0; }
/* Wide enough for "100" plus the % suffix — at 58px the value clipped to "10",
   which is a wrong number rather than a truncated one. */
.${PREFIX}-pop-row > .${PREFIX}-ctl-num { flex: 0 0 66px; padding-left: 6px; }
.${PREFIX}-pop-mode {
  display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto;
  height: var(--ap-control-height); padding: 0 2px 0 4px;
  border: 0; cursor: pointer; background: transparent; color: var(--ap-text-secondary);
  border-radius: var(--ap-radius-xs);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-pop-mode:hover { background: var(--ap-surface-hover); color: var(--ap-text-primary); }
.${PREFIX}-pop-eyedrop {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: var(--ap-control-height); height: var(--ap-control-height);
  padding: 0; border: 0; cursor: pointer; background: transparent;
  border-radius: var(--ap-radius-xs); transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-pop-eyedrop:hover { background: var(--ap-surface-active); }

.${PREFIX}-pop-recents {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  padding-top: 8px; border-top: 1px solid var(--ap-border-default);
}
.${PREFIX}-pop-recents:empty { display: none; }
.${PREFIX}-pop-recents-label {
  flex: 0 0 100%;
  font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-caption); letter-spacing: .6px; opacity: .5;
}
.${PREFIX}-pop-recent {
  width: 18px; height: 18px; flex: 0 0 auto; padding: 0; cursor: pointer;
  background-size: 6px 6px; border-radius: var(--ap-radius-xs);
  border: 1px solid var(--ap-border-default);
}
.${PREFIX}-pop-recent:hover { border-color: var(--ap-border-strong); }
.${PREFIX}-pop-recent:focus-visible { outline: 1px solid var(--ap-border-focus); outline-offset: 1px; }`;
