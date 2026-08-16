import { PREFIX } from "../dom";
import { PALETTE_TITLE_MAX, PALETTE_TITLE_W } from "./const";

/**
 * The two discovery surfaces: the ⌘K palette and the `?` shortcuts sheet.
 *
 * Both are `.pop-modal` shells (see `pop.css.ts`), so the card, the centring
 * and the scrim come from there and this file is only what is inside them.
 *
 * They deliberately do not look the same. The palette is a *control* — one
 * column, one active row, sized like the rest of the editor's chrome — and the
 * sheet is a *document*, so it reads in two columns at a comfortable measure
 * and nothing in it is selectable. Making them share a skin would have made the
 * sheet look operable, which is the one thing it is not.
 */
export const css = `
/* -- Command palette ------------------------------------------------------ */

.${PREFIX}-palette { display: flex; flex-direction: column; min-height: 0; }

/* The search row. A bottom hairline rather than a gap, so the results read as
   the field's own output rather than as a second list beside it. */
.${PREFIX}-palette-head {
  flex: 0 0 auto; display: flex; align-items: center; gap: var(--ap-space-xs);
  padding: var(--ap-space-sm) var(--ap-space-base);
  border-bottom: 1px solid var(--ap-border-default);
  --${PREFIX}-ic-tone: var(--ap-text-tertiary);
}
.${PREFIX}-palette-field {
  flex: 1 1 auto; min-width: 0;
  background: transparent; border: 0; outline: none;
  color: var(--ap-text-primary); font-family: var(--ap-font-sans);
  font-size: var(--ap-font-size-heading); line-height: 1.4;
}
.${PREFIX}-palette-field::placeholder { color: var(--ap-text-placeholder); }

/* The results, and the grid every row's columns come from.

   A row carries two lines' worth of information — what it is, and what it does,
   the second being what makes a palette teachable rather than a list of names
   you already know — and it used to be *laid out* as two lines. It reads better
   as one: forty rows of two lines is a scroll rather than a list, and the second
   line was being blockified into a flex row and printed beside the title anyway.

   The tracks live on the *list*, not on the row, and that is the whole trick.
   Each \`.palette-row\` is a formatting context of its own, so a per-row grid
   sizes its title column from that row alone and forty rows land their sentences
   on forty different edges — the same argument \`.filter-row\` makes in
   \`controls.css.ts\` for its fixed value track, one level up. \`subgrid\` is what
   lets a row keep its own box, which it has to: \`.palette-row-on\` paints it and
   \`setActive\` calls \`scrollIntoView\` on it, and neither survives
   \`display: contents\`.

   \`fit-content()\` rather than a number, so the title column is as wide as the
   longest title *currently listed* — a query filtered down to "Undo" does not
   reserve room for "Drop the change you are on" — and \`PALETTE_TITLE_MAX\` only
   stops one long title from eating the sentence beside it. */
.${PREFIX}-palette-list {
  flex: 1 1 auto; min-height: 0;
  padding-block: var(--ap-space-xxs);
}

/* The fallback, and deliberately the base rule rather than the override.

   \`grid-template-columns: subgrid\` is an *invalid value* where it is not
   supported, so the declaration is dropped whole and the row would fall back to
   a one-column grid stacking its three cells vertically — worse than the flex
   row this replaces. So the literal column is declared first and the measured
   one overrides it inside \`@supports\`, rather than the other way round.

   The row keeps its own inline padding and the list has none, so the highlight
   below is full-bleed. Padding on a subgrid item does inset its tracks from the
   parent's grid lines — but every row here carries the *same* padding, so they
   are inset identically and go on agreeing with each other, which is the only
   thing the subgrid is here to do. Only the list's other children have to be
   padded to match, and \`.pop-head\` is. Inset instead, the active row was a
   1318px stripe with a 4px radius floating in a 16px margin: too wide for the
   corner to read as a corner, and too narrow for the bar to read as the row. */
.${PREFIX}-palette-row {
  display: grid;
  grid-template-columns: ${PALETTE_TITLE_W}px minmax(0, 1fr) auto;
  column-gap: var(--ap-space-base);
  /* Centre, not baseline. The chord is a row of bordered chips rather than a run
     of text now, so there is no baseline in it to align to — sitting them on the
     title's would hang them below it by their own border and padding. */
  align-items: center;
  padding: var(--ap-space-xs) var(--ap-space-base);
  cursor: pointer;
}
@supports (grid-template-columns: subgrid) {
  .${PREFIX}-palette-list {
    display: grid;
    grid-template-columns: fit-content(${PALETTE_TITLE_MAX}px) minmax(0, 1fr) auto;
    column-gap: var(--ap-space-base);
    align-content: start;
  }
  .${PREFIX}-palette-row { grid-column: 1 / -1; grid-template-columns: subgrid; }
  /* The two children of the list that are not rows. Left to auto-place they
     would drop into the title column and size it. */
  .${PREFIX}-palette-list > .${PREFIX}-pop-head,
  .${PREFIX}-palette-list > .${PREFIX}-palette-empty { grid-column: 1 / -1; }
}

/* \`.pop-head\` carries 8px of its own inset, sized for a menu whose rows are
   padded to match. A palette row is padded to 16, so that 8 would put a group
   heading eight pixels left of every title it heads — the same "one left edge"
   argument \`.pop-group-body\` makes for its rows, and the reason a heading that
   is slightly out reads as a different list rather than as a label. */
.${PREFIX}-palette-list > .${PREFIX}-pop-head {
  padding-inline: var(--ap-space-base);
}

.${PREFIX}-palette-title {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ap-text-primary);
  font-size: var(--ap-font-size-title);
}
/* The sentence, and the first thing to give way. \`min-width: 0\` is what makes
   the ellipsis engage at all: this was a flex item with the initial
   \`min-width: auto\`, so its min-content width was the whole sentence and it
   pushed the row wider instead of eliding — the rule declared an ellipsis that
   could never fire. The track's \`minmax(0, 1fr)\` bounds the column; this bounds
   the item inside it, and both are needed. */
.${PREFIX}-palette-doc {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ap-text-tertiary);
  font-size: var(--ap-font-size-label);
}
/* Right-aligned in a column of its own, so the chords read down the list rather
   than trailing each sentence at whatever x it happened to end on. */
.${PREFIX}-palette-row > .${PREFIX}-keys { justify-self: end; }

/* The active row is a surface step, not an accent fill: the palette lists forty
   things and a saturated bar sliding through them on every keystroke is the
   same "two loud things at once" problem the change chips were demoted for.
   Driven by a class rather than \`:hover\`, because the keyboard moves it and
   the pointer must not fight the arrows for which row is current.

   There is no \`:hover\` rule beside it, and there deliberately is not one. The
   row used to compose \`.pop-item\`, whose \`:hover\` at (0,2,0) out-ranked this
   class at (0,1,0) whatever the source order — so the pointer won every argument
   with the arrow keys about which row was current, in a surface whose whole
   navigation is the arrow keys. The pointer still moves the cursor; it does it
   through \`pointerover\` → \`setActive\`, which is one highlight moved by two
   inputs rather than two highlights fighting. */
.${PREFIX}-palette-row-on { background: var(--ap-surface-hover); }
.${PREFIX}-palette-row-on .${PREFIX}-palette-doc { color: var(--ap-text-secondary); }

.${PREFIX}-palette-empty {
  padding: var(--ap-space-base); text-align: center;
  color: var(--ap-text-tertiary); font-size: var(--ap-font-size-label);
}

/* -- Shortcuts sheet ------------------------------------------------------ */

.${PREFIX}-sc { display: flex; flex-direction: column; min-height: 0; }
.${PREFIX}-sc-bar {
  flex: 0 0 auto; display: flex; align-items: center; gap: var(--ap-space-xs);
  padding: var(--ap-space-sm) var(--ap-space-base);
  border-bottom: 1px solid var(--ap-border-default);
  --${PREFIX}-ic-tone: var(--ap-text-secondary);
}
.${PREFIX}-sc-title {
  color: var(--ap-text-primary); font-size: var(--ap-font-size-heading);
  font-weight: 500;
}

/* Two columns, because this is a reference and a single column of fifty rows is
   a scroll rather than a map. \`break-inside: avoid\` keeps a section's heading
   with its rows; without it a group splits across the fold and the heading is
   left advertising the wrong list. */
.${PREFIX}-sc-body {
  flex: 1 1 auto; min-height: 0;
  padding: var(--ap-space-base);
  columns: 2; column-gap: var(--ap-space-xl);
  outline: none;
}
.${PREFIX}-sc-sect { break-inside: avoid; margin-bottom: var(--ap-space-base); }
.${PREFIX}-sc-head {
  margin: 0 0 var(--ap-space-xxs);
  color: var(--ap-text-tertiary);
  font-size: var(--ap-font-size-caption); font-weight: 500;
  text-transform: uppercase; letter-spacing: .06em;
}

/* A grid, not \`justify-content: space-between\`.

   The chip track is a fixed width, and that is the point: every \`.sc-row\` is a
   formatting context of its own, so an \`auto\` track is sized by *that row's*
   chips alone and sixty rows each land their chip block on a different left
   edge. \`.filter-row\` in \`controls.css.ts\` makes the identical argument — "the
   value track is fixed rather than a minmax range so every row in a stack lines
   its numbers up on the same edge".

   A variable rather than a literal, because the sheet renders two different
   things into that column. A chord tops out at "Ctrl+Shift+Z": twelve characters
   of JetBrains Mono at \`--ap-font-size-caption\` (10px, so about 6px a
   character) plus a \`.sc-key\`'s 12px of padding and border, or 84. A *gesture's*
   input is a phrase — "Wheel over the selected frame" is 29 characters, about
   186px, and \`.sc-key\` declares \`white-space: nowrap\` so it cannot give any of
   it back. One track sized for the phrase would spend 186px of a 408px column on
   a gutter in every command section; one sized for the chord would push the
   phrase out over its own name. So the gesture section declares its own.

   112 rather than 84 because a handful of commands answer to two chords. Redo is
   the worst pair — "Ctrl+Shift+Z" and "Ctrl+Y", 136 together — and it wraps onto
   a second line *inside its own track* rather than overhanging into the name,
   which is what \`flex-wrap\` on \`.sc-keys\` is for. */
.${PREFIX}-sc-sect { --${PREFIX}-sc-chord-w: 112px; }
.${PREFIX}-sc-sect-input { --${PREFIX}-sc-chord-w: 196px; }
.${PREFIX}-sc-row {
  display: grid;
  /* The fallback is not decoration: an undefined custom property makes the whole
     declaration invalid at computed-value time, so a \`.sc-row\` that ever landed
     outside a \`.sc-sect\` would lose its columns and stack. */
  grid-template-columns: minmax(0, 1fr) var(--${PREFIX}-sc-chord-w, 112px);
  align-items: baseline; gap: var(--ap-space-sm);
  padding: 3px 0;
  font-size: var(--ap-font-size-label);
}
.${PREFIX}-sc-name {
  min-width: 0; display: flex; align-items: baseline; gap: 6px;
  color: var(--ap-text-primary);
}

/* Why a row is not live right now. The whole argument for the sheet showing
   unavailable rows at all is that this says what to do about it. */
.${PREFIX}-sc-why {
  color: var(--ap-text-tertiary); font-size: var(--ap-font-size-caption);
  white-space: nowrap;
}
.${PREFIX}-sc-row-off .${PREFIX}-sc-name { color: var(--ap-text-tertiary); }
.${PREFIX}-sc-row-off .${PREFIX}-key { opacity: .5; }

/* -- Key chips ------------------------------------------------------------ */

/* Shared by both surfaces — see \`keys/chips.ts\` for why that is not a breach of
   the "they should not look the same" note at the top of this file.

   Two gaps doing two jobs. Inside a chord the keys are one keystroke, so they
   sit 3px apart and read as a unit; between chords the gap is 10px, which is
   what tells you Redo's ⌘⇧Z and ⌘Y are two answers rather than one five-key
   press. Nothing has to write the word "or".

   \`flex-wrap\` because the chip track is a fixed width (see \`.sc-row\`) and a
   two-chord row can exceed it — better a second line inside the track than an
   overhang into the name beside it. */
.${PREFIX}-keys {
  display: flex; align-items: center; justify-content: flex-end;
  flex-wrap: wrap; gap: 10px;
}
.${PREFIX}-chord { display: flex; align-items: center; gap: 3px; }
/* Sized like a key, not like a footnote. At \`--ap-font-size-caption\` in a 1px
   box this was a 10px glyph in a 14px chip — legible only if you already knew
   what it said. Body type, a 16px minimum box and real padding make ⌘ and ⇧
   distinguishable at a glance, which is the whole job: a chord nobody can read
   is a chord nobody learns. */
.${PREFIX}-key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; padding: 1px 5px;
  background: var(--ap-surface-hover);
  border: 1px solid var(--ap-border-subtle);
  border-radius: var(--ap-radius-xs);
  color: var(--ap-text-secondary);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  line-height: 16px; white-space: nowrap;
}

/* The field-local conventions. Prose, and shaped like prose.

   These went through \`.sc-row\`/\`.sc-name\` and came out as three shortcut rows
   with an empty chord column, which reads as a rendering fault rather than as a
   note — the same "a class must mean what it says" argument
   \`styles/index.test.ts\` makes about \`className:\`. They wrap rather than
   truncate: two of the three name a chord mid-sentence, and an ellipsis would
   take exactly the part worth reading. */
.${PREFIX}-sc-note {
  margin: 0; padding: 3px 0;
  color: var(--ap-text-secondary);
  font-size: var(--ap-font-size-label); line-height: 1.45;
}`;
