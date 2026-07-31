import { PREFIX } from "../dom";

/**
 * CSS pane: box-model diagram, matched rules, grouped computed list.
 *
 * The box model is the one place in this panel where hue is the content rather
 * than a state: four concentric rings that are only distinguishable by colour,
 * which is the convention every browser's inspector already taught. So it keeps
 * a four-way distinction — but drawn from the editor's own \`-bg\` tints
 * (red/yellow/green, then the selection blue for the content box) rather than
 * DevTools' literal orange. The tints are all ~12% over the panel surface,
 * which is enough to separate four nested boxes and not enough to read as four
 * warnings.
 */
export const css = `
.${PREFIX}-css-pane { padding-bottom: var(--ap-space-md); }
.${PREFIX}-css-block { border-bottom: 1px solid var(--ap-border-default); }

/* ---- Box model ---------------------------------------------------------- */
.${PREFIX}-css-bm {
  display: flex; justify-content: center;
  padding: var(--ap-space-md) var(--ap-space-lg) var(--ap-space-sm);
  border-bottom: 1px solid var(--ap-border-default);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
}
/* Each ring is a labelled box padded enough to seat its four side fields. */
.${PREFIX}-css-bm-ring {
  position: relative; flex: 1 1 auto;
  padding: 20px 34px; border: 1px dashed var(--ap-border-strong);
  border-radius: var(--ap-radius-xs); text-align: center;
}
.${PREFIX}-css-bm-margin { background: var(--ap-semantic-error-bg); }
.${PREFIX}-css-bm-border { background: var(--ap-semantic-warning-bg); }
.${PREFIX}-css-bm-padding { background: var(--ap-semantic-success-bg); }
.${PREFIX}-css-bm-content {
  position: relative; padding: 18px 8px;
  background: var(--ap-selection-fill);
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-xs);
}
.${PREFIX}-css-bm-label {
  position: absolute; top: 2px; left: 5px;
  text-transform: uppercase; letter-spacing: .5px;
  font-size: var(--ap-font-size-micro); color: var(--ap-text-tertiary);
}
.${PREFIX}-css-bm-size { color: var(--ap-text-primary); }
/* Side fields sit on the ring they belong to, one per edge. */
.${PREFIX}-css-bm-cell { position: absolute; display: block; }
.${PREFIX}-css-bm-cell[data-side="top"] { top: 1px; left: 50%; transform: translateX(-50%); }
.${PREFIX}-css-bm-cell[data-side="bottom"] { bottom: 1px; left: 50%; transform: translateX(-50%); }
.${PREFIX}-css-bm-cell[data-side="left"] { left: 1px; top: 50%; transform: translateY(-50%); }
.${PREFIX}-css-bm-cell[data-side="right"] { right: 1px; top: 50%; transform: translateY(-50%); }
/* The side cells are real number fields now — the panel's one numeric field —
   rather than the bare inputs they used to be, which had no keystroke filter,
   no bounds and a parser that let arbitrary text through. That brings the
   shared control chrome with it, and a 20px scrub glyph plus a 28px-tall row
   does not fit on the edge of a ring, so the wrapper is compressed back to the
   cell it sits in. The field's behaviour is what was wanted, not its size. */
.${PREFIX}-css-bm-field-wrap {
  height: auto; padding-left: 0; gap: 0;
  border-radius: var(--ap-radius-xs);
}
.${PREFIX}-css-bm-field-wrap .${PREFIX}-ctl-glyph { display: none; }
.${PREFIX}-css-bm-field-wrap .${PREFIX}-ctl-input {
  width: 34px; padding: 1px 2px; text-align: center;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
}
.${PREFIX}-css-bm-field-wrap:hover { background: var(--ap-surface-active); }

/* ---- Matched rules ------------------------------------------------------ */
.${PREFIX}-css-rules { padding: 0 0 var(--ap-space-xs); }
.${PREFIX}-css-rule { padding: var(--ap-space-xs) var(--ap-space-lg) 0; }
.${PREFIX}-css-rule + .${PREFIX}-css-rule { border-top: 1px solid var(--ap-border-subtle); }
.${PREFIX}-css-rule-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--ap-space-xs);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label);
}
.${PREFIX}-css-selector {
  min-width: 0; color: var(--ap-text-primary); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.${PREFIX}-css-origin { flex: 0 0 auto; color: var(--ap-text-tertiary); font-size: var(--ap-font-size-caption); }
/* Tertiary, the same tone as .css-origin beside it: an @media or @supports
   condition is the same class of thing as the stylesheet a rule came from —
   metadata about where the block applies, not one of its declarations. It was
   purple, which in a panel that otherwise spends colour only on state read as a
   warning about a rule that is merely conditional. Its own line and its indent
   are what separate it from the selector above. */
.${PREFIX}-css-cond {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-tertiary); padding: 1px 0 0 var(--ap-space-xs);
}
/* A declaration a stronger rule already answered. */
.${PREFIX}-css-struck { opacity: .5; }
.${PREFIX}-css-struck .${PREFIX}-css-prop-ro,
.${PREFIX}-css-struck .${PREFIX}-css-val-ro { text-decoration: line-through; }
.${PREFIX}-css-val-ro {
  flex: 1 1 auto; min-width: 0;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label);
  color: var(--ap-text-secondary); word-break: break-word;
}
.${PREFIX}-css-scan {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ap-space-xs);
  padding: 2px var(--ap-space-lg) var(--ap-space-xs);
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption);
  color: var(--ap-text-tertiary);
}
.${PREFIX}-css-rescan {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; cursor: pointer;
  color: var(--ap-text-tertiary); background: transparent;
  border: 0; border-radius: var(--ap-radius-xs);
}
.${PREFIX}-css-rescan:hover { color: var(--ap-text-primary); background: var(--ap-surface-active); }
.${PREFIX}-css-scan-note {
  padding: var(--ap-space-xs) var(--ap-space-lg) 0;
  font-size: var(--ap-font-size-caption); color: var(--ap-text-tertiary); opacity: .8;
}

/* ---- Computed ----------------------------------------------------------- */
.${PREFIX}-css-groups { padding-bottom: var(--ap-space-xs); }
/* Provenance dot: where this value came from. Colour is the whole signal, so
   it stays a 6px mark rather than a word per row. */
.${PREFIX}-css-badge {
  width: 6px; height: 6px; flex: 0 0 auto; margin-right: 4px;
  border-radius: var(--ap-radius-full);
}
.${PREFIX}-css-badge-inline { background: var(--ap-primary); }
.${PREFIX}-css-badge-css { background: var(--ap-semantic-success); }
.${PREFIX}-css-badge-default { background: var(--ap-border-strong); }`;
