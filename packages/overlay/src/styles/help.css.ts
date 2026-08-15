import { PREFIX } from "../dom";

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

.${PREFIX}-palette-list {
  flex: 1 1 auto; min-height: 0;
  padding: var(--ap-space-xxs) 0;
}

/* A row is two lines: what it is, and what it does. The second line is what
   makes a palette teachable rather than a list of names you already know. */
.${PREFIX}-palette-row {
  display: flex; align-items: center; gap: var(--ap-space-xs);
  padding: var(--ap-space-xs) var(--ap-space-base);
  cursor: pointer;
}
.${PREFIX}-palette-title {
  display: block; color: var(--ap-text-primary);
  font-size: var(--ap-font-size-title);
}
.${PREFIX}-palette-doc {
  display: block; color: var(--ap-text-tertiary);
  font-size: var(--ap-font-size-label);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* The active row is a surface step, not an accent fill: the palette lists forty
   things and a saturated bar sliding through them on every keystroke is the
   same "two loud things at once" problem the change chips were demoted for.
   Driven by a class rather than \`:hover\`, because the keyboard moves it and
   the pointer must not fight the arrows for which row is current. */
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
.${PREFIX}-sc-row {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--ap-space-sm);
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
.${PREFIX}-sc-row-off .${PREFIX}-sc-key { opacity: .5; }

.${PREFIX}-sc-keys {
  flex: 0 0 auto; display: flex; align-items: center; gap: 4px;
}
.${PREFIX}-sc-key {
  display: inline-flex; align-items: center;
  padding: 1px 5px;
  background: var(--ap-surface-hover);
  border: 1px solid var(--ap-border-subtle);
  border-radius: var(--ap-radius-xs);
  color: var(--ap-text-secondary);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  white-space: nowrap;
}`;
