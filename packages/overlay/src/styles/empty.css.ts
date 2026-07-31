import { PREFIX } from "../dom";

/**
 * Empty states: the brand mark over a title and an optional sentence.
 *
 * The mark is pure `currentColor` (see `empty.ts`), so one declaration moves all
 * of it and the two-tone inside does the work a second colour would otherwise
 * have to.
 *
 * The old empty states were a single line at `opacity: .5`. That is not carried
 * forward: fading a block fades the mark *and* the words together, and the words
 * are the part that has to stay readable. Each part takes a token colour instead
 * — title at the secondary text level, body at the tertiary one, the mark below
 * both — which is the same ladder every other stacked pair in the panel is built
 * on.
 */
export const css = `
.${PREFIX}-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
}
/* Dock-sized: takes the whole empty panel and centres in it. Auto margins
   rather than \`justify-content\` — the transcript is a scroll container, and
   this centres without fighting the flow the first message arrives in. */
.${PREFIX}-empty-md {
  margin: auto 0; gap: var(--ap-space-xxs);
  padding: var(--ap-space-lg) var(--ap-space-md);
}
/* Section-sized: sits inline where a one-line hint used to, so it keeps the
   hint's own left/right padding and only spends height. */
.${PREFIX}-empty-sm {
  gap: var(--ap-space-hair); padding: var(--ap-space-md) var(--ap-space-lg);
}
/* Below the icon ramp's resting tone, and further below it than the line
   drawings this replaced needed to be. \`--ap-icon-muted\` is calibrated for a
   glyph read at 16px; the brand mark is solid where those were 1.25-unit
   hairlines, so at 48px it carries far more ink per unit and has to be dimmed to
   sit back. The fade rides on top of the token rather than being a darker
   colour, so the mark stays tied to the icon ramp — it is scenery behind the
   words, not a status. */
.${PREFIX}-empty-art { display: block; color: var(--ap-icon-muted); opacity: .55; }
.${PREFIX}-empty-md .${PREFIX}-empty-art { margin-bottom: var(--ap-space-xs); }
.${PREFIX}-empty-sm .${PREFIX}-empty-art { margin-bottom: var(--ap-space-xxs); }
.${PREFIX}-empty-title {
  color: var(--ap-text-secondary); font-size: var(--ap-font-size-title);
  line-height: 1.4;
}
.${PREFIX}-empty-sm .${PREFIX}-empty-title { font-size: var(--ap-font-size-label); }
/* Capped rather than free. A sentence set across a 320px dock is one long line,
   and the column the title sets is narrower than that. */
.${PREFIX}-empty-body {
  max-width: 32ch; font-size: var(--ap-font-size-label); line-height: 1.5;
  color: var(--ap-text-tertiary);
}
.${PREFIX}-empty-sm .${PREFIX}-empty-body { font-size: var(--ap-font-size-body); }`;
