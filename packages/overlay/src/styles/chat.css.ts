import { PREFIX } from "../dom";
import { ROOT } from "./const";

/** Left dock: transcript, bubbles, composer, chips, actions, todos, diffs. */
export const css = `
.${PREFIX}-transcript {
  flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column;
  gap: var(--ap-space-md); padding: var(--ap-space-md) var(--ap-space-lg);
}
/* The transcript's empty state is a \`.empty-md\` block (empty.css). This class
   carries no styling of its own any more — it is the handle \`pushBubble\` uses
   to find and drop the block when the first bubble lands. */
.${PREFIX}-msg { font-size: var(--ap-font-size-heading); line-height: 1.5; }
.${PREFIX}-msg-user {
  align-self: flex-end; max-width: 88%; padding: 8px 12px; word-break: break-word;
  background: var(--ap-surface-selected); color: var(--ap-text-primary);
  border-radius: var(--ap-radius-md) var(--ap-radius-md) var(--ap-radius-xs) var(--ap-radius-md);
}
.${PREFIX}-msg-assistant {
  align-self: flex-start; max-width: 96%; padding: 10px 12px; word-break: break-word;
  background: var(--ap-surface-active); border: 1px solid var(--ap-border-default);
  border-radius: var(--ap-radius-md) var(--ap-radius-md) var(--ap-radius-md) var(--ap-radius-xs);
}
/* A failed turn. The bubble's body *is* the error string (\`fillAssistant\` puts
   \`bundle.error\` or "Edit failed." there), so the words already carry the news;
   a tinted box around a sentence that says "Edit failed" is the same message a
   second time, in the loudest register the panel has. A stronger border is
   enough to mark it as the odd bubble in the column. */
.${PREFIX}-msg-assistant.${PREFIX}-msg-err { border-color: var(--ap-border-strong); }
.${PREFIX}-msg-body > *:first-child { margin-top: 0; }
.${PREFIX}-msg-body > *:last-child { margin-bottom: 0; }
.${PREFIX}-msg-body p { margin: 6px 0; }
.${PREFIX}-msg-body h4, .${PREFIX}-msg-body h5, .${PREFIX}-msg-body h6 { margin: 8px 0 4px; font-size: var(--ap-font-size-heading); font-weight: 600; }
.${PREFIX}-msg-body ul, .${PREFIX}-msg-body ol { margin: 6px 0; padding-left: 18px; }
.${PREFIX}-msg-body li { margin: 2px 0; }
/* Underlined rather than tinted. A link still has to announce itself, but the
   affordance can be a rule instead of a hue — see the panel's colour note at
   \`.tl-glyph\` below. */
.${PREFIX}-msg-body a { color: var(--ap-text-primary); text-decoration: underline; text-underline-offset: 2px; }
.${PREFIX}-msg-stream { white-space: pre-wrap; }
.${PREFIX}-md-code {
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label); padding: 0 4px;
  background: var(--ap-surface-panel); border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-xs);
}
.${PREFIX}-md-pre {
  margin: 6px 0; padding: 8px 10px; overflow-x: auto;
  background: var(--ap-surface-panel); border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-md);
}
.${PREFIX}-md-pre code { font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label); white-space: pre; }

/* Composer (pinned below the transcript).

   One field, not a stack. The chips, the textarea and Send share a single
   bordered box that starts one line tall — the previous arrangement spent
   ~145px at rest on padding, a 64px textarea floor and a Send pill on its own
   row, which is a lot of permanent furniture for a panel whose real content is
   the transcript above it. The right padding clears the absolutely-positioned
   Send glyph so text never runs under it. */
.${PREFIX}-composer { flex: 0 0 auto; border-top: 1px solid var(--ap-border-default); padding: var(--ap-space-sm) var(--ap-space-md); }
.${PREFIX}-field {
  position: relative; display: flex; flex-direction: column; gap: 4px;
  padding: 6px 65px 6px 8px;
  background: var(--ap-input-bg); border: 1px solid var(--ap-input-border);
  border-radius: var(--ap-radius-sm);
}
.${PREFIX}-field:focus-within { border-color: var(--ap-input-focus-border); }
/* Chip rows scroll sideways rather than wrapping: each pending change is now
   its own chip, and wrapping a dozen of them would push the field to half the
   dock. Hidden when empty so they cost nothing at rest. */
.${PREFIX}-sel-chips {
  display: flex; flex-wrap: nowrap; gap: var(--ap-space-xs);
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
}
.${PREFIX}-sel-chips::-webkit-scrollbar { display: none; }
.${PREFIX}-sel-chips:empty { display: none; }
/* In a nowrap row a chip would otherwise shrink to fit rather than scroll. */
.${PREFIX}-sel-chips > * { flex: 0 0 auto; }
.${PREFIX}-sel-chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: var(--ap-font-size-label); font-family: var(--ap-font-mono);
  color: var(--ap-text-primary); background: var(--ap-surface-active);
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-sm); padding: 3px 6px 3px 8px;
}
/* Pending-change chips — one per inspector delta, riding into Send.

   Deliberately quiet. These used to be a single accent-filled pill, which put
   a second saturated element inches from the filled Send button; with a dozen
   of them that reads as an alarm rather than a list. Demoting them to a hover
   surface leaves the selection chip as the one emphasised thing in the strip,
   which is the hierarchy the row wants — now a step of the surface ladder
   rather than a hue, since the strip has no colour left to spend. */
.${PREFIX}-tweak-chip {
  color: var(--ap-text-secondary); background: var(--ap-surface-hover);
  border-color: var(--ap-border-subtle);
  font-size: var(--ap-font-size-caption); max-width: 240px;
}
.${PREFIX}-tweak-chip:hover { color: var(--ap-text-primary); border-color: var(--ap-border-default); }
.${PREFIX}-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The bulk escape hatch, at the end of the strip. Ghost — it is the most
   destructive thing in the row and should not look like the cheapest. */
.${PREFIX}-chip-all {
  cursor: pointer; color: var(--ap-text-tertiary);
  background: transparent; border-style: dashed;
  font-size: var(--ap-font-size-caption);
}
.${PREFIX}-chip-all:hover { color: var(--ap-text-primary); border-color: var(--ap-border-strong); }

/* Past-chats drawer (overlays the whole left dock). */
/* A column for the same reason \`.insp-body\` is one: it covers the whole dock,
   so its empty state has a dock's worth of space to centre in, and \`margin:
   auto\` needs a flex container to have anything to distribute. The head stays
   pinned at the top either way — it is content-sized. */
.${PREFIX}-drawer {
  position: absolute; inset: 0; z-index: 2; overflow-y: auto;
  padding: var(--ap-space-md) var(--ap-space-lg); background: var(--ap-surface-panel);
  display: flex; flex-direction: column;
}
.${PREFIX}-drawer-head {
  flex: 0 0 auto; display: flex; align-items: center;
  justify-content: space-between; margin-bottom: var(--ap-space-sm);
}

/* Prompt preview — the instruction as the agent will actually receive it.

   A pane in flow, not a \`.drawer\`. The drawer is \`inset: 0\` over the whole
   dock, which is right for Past chats and wrong here: the point of this surface
   is watching the string change as you type, and a full-dock overlay covers the
   field you type into. So it takes the transcript's slot (hidden while this is
   up) and leaves the head and composer where they are. Borrows the drawer's
   head, eyebrow and close button so it still reads as the same kind of surface. */
.${PREFIX}-pane {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: var(--ap-space-md) var(--ap-space-lg); background: var(--ap-surface-panel);
  display: flex; flex-direction: column;
}
/* A column, so the empty state has the pane's height to centre in — same
   reasoning as \`.drawer\`. */
.${PREFIX}-prompt-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.${PREFIX}-prompt-text {
  margin: 0; flex: 1 1 auto;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  line-height: 1.5; color: var(--ap-text-secondary);
  /* pre-wrap, not pre: a source-context fence runs past 100 columns and a 340px
     dock would scroll sideways for every line of it. */
  white-space: pre-wrap; word-break: break-word;
  -webkit-user-select: text; user-select: text;
}
/* The character count. Genuinely useful here — it is the one place the user can
   see what a dozen chips actually cost in context. */
.${PREFIX}-prompt-count {
  align-self: center; font-family: var(--ap-font-mono);
  font-size: var(--ap-font-size-caption); color: var(--ap-text-tertiary);
  margin-right: var(--ap-space-xs); white-space: nowrap;
}
/* Past-chats list rows. Hover rides the hover surface (one step lighter than
   the panel, not the pressed/active step) and the radius matches the buttons. */
.${PREFIX}-thread-item { display: flex; align-items: flex-start; gap: var(--ap-space-xs); cursor: pointer; padding: 8px; border-radius: var(--ap-radius-sm); }
.${PREFIX}-thread-item:hover { background: var(--ap-surface-hover); }
.${PREFIX}-thread-item .${PREFIX}-ic { margin-top: 2px; opacity: .6; }
.${PREFIX}-thread-main { min-width: 0; flex: 1 1 auto; }
.${PREFIX}-thread-title { font-size: var(--ap-font-size-title); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PREFIX}-thread-meta { font-family: var(--ap-font-mono); font-size: var(--ap-font-size-caption); opacity: .5; margin-top: 2px; }

.${PREFIX}-eyebrow {
  font-family: var(--ap-font-mono); text-transform: uppercase;
  font-size: var(--ap-font-size-body); letter-spacing: .6px; color: var(--ap-text-primary); opacity: .55;
  margin-bottom: var(--ap-space-xs);
}
.${PREFIX}-meta {
  margin-top: 4px; font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  color: var(--ap-text-primary); opacity: .5; word-break: break-word;
}

/* Chat input. The box, border and background now belong to \`.field\`; this is
   just the text surface inside it. \`resize: none\` because the height is
   driven by content (see \`autoGrow\`) — a manual resize handle would fight it
   on the next keystroke. No min-height: one row is the resting state. */
.${PREFIX}-input {
  width: 100%; resize: none; display: block; font-family: var(--ap-font-sans);
  font-size: var(--ap-font-size-title); line-height: 1.45; color: var(--ap-text-primary);
  background: transparent; border: 0; padding: 2px 0;
}
.${PREFIX}-input::placeholder { color: var(--ap-text-placeholder); }
.${PREFIX}-input:focus { outline: none; }

/* Send. Sits inside the field's right gutter rather than on a row of its own.
   Icon-only — the label lives in \`data-tip\`, which also picks up its ⌘⏎
   binding because tooltips resolve shortcuts by tooltip text.

   The box comes from \`.action\`/\`.action-icon\` below: 28px. This rule used to
   restate 24 and lose on source order, so the numbers here described a button
   that never existed. */
.${PREFIX}-send {
  position: absolute; right: 5px; bottom: 5px;
}

/* The prompt-preview toggle, in the field's gutter beside Send — the control
   that answers "what will Send send?" belongs next to Send.

   Send is 28px, so this clears 28 + a 4px gap, and its \`bottom\` is 7px rather
   than 5 so that a 24px ghost sits centred against a 28px primary. Smaller on
   purpose — it is the secondary control of the pair. Overrides \`.iconbtn\`'s
   taller control height without \`!important\`, since this file loads after
   docks.css.

   The tone goes on --ic-tone, not \`color\`: the glyph is a child span with its
   own rule in base.css, so a \`color\` here never reached it and "secondary
   control is dimmer" was a hierarchy that only existed in this file. */
.${PREFIX}-field-btn {
  position: absolute; right: 37px; bottom: 7px;
  width: 24px; height: 24px; padding: 0;
  --${PREFIX}-ic-tone: var(--ap-text-tertiary);
}
/* A toggle that stays down while its surface is open. */
.${PREFIX}-iconbtn-on { background: var(--ap-surface-selected); color: var(--ap-text-primary); }

/* Chips. */
.${PREFIX}-chips {
  display: flex; flex-wrap: nowrap; gap: var(--ap-space-xs);
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
}
.${PREFIX}-chips::-webkit-scrollbar { display: none; }
.${PREFIX}-chips:empty { display: none; }
.${PREFIX}-chips > * { flex: 0 0 auto; }
.${PREFIX}-chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: var(--ap-font-size-label);
  background: var(--ap-surface-active); border: 1px solid var(--ap-border-default);
  border-radius: var(--ap-radius-sm); padding: 4px 6px 4px 8px;
}
.${PREFIX}-chip-x { cursor: pointer; display: inline-flex; opacity: .6; }
.${PREFIX}-chip-x:hover { opacity: 1; }

/* Action buttons — compact, at editor density. Self-sized and right-aligned in the
   composer (not a full-width marketing pill): the editor's controls are 28px
   tall with a 6px radius, so the primary Send reads as one of them, not as a
   CTA dropped in from the marketing site. State tokens drive hover/pressed so
   there's no opacity hack. */
.${PREFIX}-actions { display: flex; justify-content: flex-end; gap: var(--ap-space-xs); margin-top: var(--ap-space-sm); }
.${PREFIX}-action {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--ap-control-icon-box); padding: 0 12px; cursor: pointer;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label); font-weight: 500;
  background: var(--ap-surface-hover); color: var(--ap-text-primary);
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-sm);
  transition: background var(--ap-motion-dur-micro) var(--ap-motion-ease), border-color var(--ap-motion-dur-micro) var(--ap-motion-ease), opacity var(--ap-motion-dur-micro) var(--ap-motion-ease);
}
.${PREFIX}-action:not(:disabled):hover { background: var(--ap-surface-active); border-color: var(--ap-border-strong); }
.${PREFIX}-action:not(:disabled):active { background: var(--ap-surface-selected); }
/* The primary action — one step up the surface ladder from its siblings, plus a
   stronger border. It used to be an accent fill, which made Send the loudest
   thing in a panel whose content is the transcript above it; the ladder still
   ranks it above the secondary actions without spending the panel's only hue on
   a button that sits in the same place every time.

   --ic-tone alongside \`color\`: the label is this element's own text and takes
   \`color\`, the glyph is a child span that base.css paints, and both have to be
   the bright tone against the fill. */
.${PREFIX}-action.${PREFIX}-primary {
  background: var(--ap-surface-selected); color: var(--ap-text-primary); border-color: var(--ap-border-strong);
  --${PREFIX}-ic-tone: var(--ap-text-primary);
}
.${PREFIX}-action.${PREFIX}-primary:not(:disabled):hover { background: var(--ap-gray-700); border-color: var(--ap-border-strong); }
.${PREFIX}-action.${PREFIX}-primary:not(:disabled):active { background: var(--ap-gray-600); }
.${PREFIX}-action:disabled { opacity: .45; cursor: default; }
/* Square, so the per-turn actions read as one cluster of glyphs rather than
   three pills competing with the message above them. Their labels live in the
   tooltip. */
.${PREFIX}-action-icon { width: var(--ap-control-icon-box); padding: 0; }
.${PREFIX}-action:focus-visible {
  outline: 1px solid var(--ap-border-focus); outline-offset: 1px;
}

/* Streaming step indicator (inside the assistant bubble). The dot pulses; that
   is what says "running". Tinting it as well says it twice, and a saturated dot
   blinking through a long turn is the most attention-drawing thing the panel
   could do for its least surprising message. */
.${PREFIX}-step,
.${PREFIX}-turn-status { display: flex; align-items: center; gap: var(--ap-space-xs); font-size: var(--ap-font-size-title); color: var(--ap-text-tertiary); }
.${PREFIX}-turn-status { margin-top: var(--ap-space-xs); }
.${PREFIX}-dot { width: 7px; height: 7px; border-radius: var(--ap-radius-full); background: var(--ap-text-tertiary); animation: ${PREFIX}-pulse 1s infinite; }
@keyframes ${PREFIX}-pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }

/* ---- Agent activity timeline ------------------------------------------- *
 * Claude Code's terminal grammar rendered in editor tokens: a status dot
 * leading the tool name, an elbow rail carrying the one-line result, and the
 * full output behind a disclosure. The rail glyphs are drawn SVGs, not text —
 * U+23FA/U+23BF aren't in the latin font subsets we self-host.
 *
 * The overlay has no shadow root, so every rule below states its box, type and
 * background outright rather than inheriting from the host page.
 */
.${PREFIX}-tl { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; }
.${PREFIX}-tl:empty { display: none; }

.${PREFIX}-tl-row { display: block; margin: 0; padding: 0; border: 0; background: none; }

/* Header row. A <button> when expandable, a <div> when not — both must present
   as the same dense, left-aligned line. */
.${PREFIX}-tl-head {
  display: flex; align-items: baseline; gap: var(--ap-space-xs);
  width: 100%; margin: 0; padding: 2px 4px; cursor: pointer; text-align: left;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-label);
  line-height: 1.5; color: var(--ap-text-primary);
  background: transparent; border: 0; border-radius: var(--ap-radius-xs);
  -webkit-appearance: none; appearance: none;
}
.${PREFIX}-tl-head:hover { background: var(--ap-surface-hover); }
.${PREFIX}-tl-head:focus-visible { outline: 1px solid var(--ap-border-focus); outline-offset: -1px; }
/* Nothing to expand — drop the affordance but keep the alignment. */
.${PREFIX}-tl-flat > .${PREFIX}-tl-head { cursor: default; }
.${PREFIX}-tl-flat > .${PREFIX}-tl-head:hover { background: transparent; }

/* Leading glyph. Shape carries which tool (\`TOOL_GLYPH\` in tool-row.ts) and
   nothing else — every glyph in the timeline rests at one quiet tone.

   There used to be a per-phase colour here: green for ok, red for error, purple
   on the thinking row. It never actually rendered — \`base.css\` paints every
   \`.ic\` under \`#\${PREFIX}-root\`, and an id outranks any number of classes,
   so the wrapper's colour was overridden by the icon inside it. Making it work
   showed why it should not: a finished turn is thirty rows, nearly all of them
   \`ok\`, so the effect was a column of green demanding attention on behalf of
   "this worked", which is the least surprising thing a transcript can say.

   That argument has since been taken to its end across this whole file. Diff
   add/del is the only hue left in the panel — the one place where the thing
   being distinguished has no shape, weight or position of its own to carry it.
   Everything else ranks by the tools a monochrome column still has: the text
   ramp for emphasis, \`font-weight\` for the row that matters, \`opacity\` for
   the row that does not, the surface ladder for fills, and motion for pending.

   Failure is still the loudest thing here, just not the reddest — the result
   line under a failed row goes bright and bold (see \`.tl-res-text\` below),
   which is what separates it from thirty \`--ap-text-secondary\` siblings.

   Scoped to \`ROOT\` and reaching the \`.ic\` for the same specificity reason: a
   rule on the wrapper alone would lose to \`base.css\` and the glyphs would sit
   at \`--ap-icon-secondary\`, a step brighter than the rest of the row. */
.${PREFIX}-tl-glyph { display: inline-flex; flex: 0 0 auto; align-self: center; }
${ROOT} .${PREFIX}-tl-glyph .${PREFIX}-ic { --${PREFIX}-ic-tone: var(--ap-text-tertiary); }
.${PREFIX}-tl-row[data-phase="pending"] .${PREFIX}-tl-glyph { animation: ${PREFIX}-pulse 1s infinite; }

.${PREFIX}-tl-name { font-weight: 600; color: var(--ap-text-primary); white-space: nowrap; }
.${PREFIX}-tl-args {
  min-width: 0; flex: 0 1 auto; color: var(--ap-text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Result line. Lives outside the collapsible body so the summary reads at rest;
   the glyph column is indented to sit under the tool name. */
.${PREFIX}-tl-res {
  display: flex; align-items: baseline; gap: var(--ap-space-xs);
  margin: 0; padding: 0 4px 2px 10px;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body);
  line-height: 1.5; color: var(--ap-text-secondary); word-break: break-word;
}
${ROOT} .${PREFIX}-tl-res .${PREFIX}-ic { flex: 0 0 auto; --${PREFIX}-ic-tone: var(--ap-text-tertiary); align-self: flex-start; }
.${PREFIX}-tl-res-text { min-width: 0; }
/* The one row in a thirty-row turn worth finding. Brighter and heavier than the
   \`--ap-text-secondary\` result lines around it, which is enough to catch the
   eye scanning the column — see the glyph note above for why it is not red. */
.${PREFIX}-tl-row[data-phase="error"] .${PREFIX}-tl-res-text { color: var(--ap-text-primary); font-weight: 600; }

/* Expanded body. */
/* Collapsing is per-row state (see TimelineView.setCollapsed) — deliberately
   no \`.tl-collapsed .tl-body { display: none }\` here. A descendant rule like
   that outranks the row's own disclosure, which is what used to freeze every
   finished turn's rows shut. */
.${PREFIX}-tl-body { margin: 0 0 var(--ap-space-xs) 0; padding: 0 4px 0 26px; }

.${PREFIX}-tl-args-list {
  display: grid; grid-template-columns: auto 1fr; gap: 0 var(--ap-space-xs);
  margin: 0 0 var(--ap-space-xs) 0; padding: 0;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body); line-height: 1.6;
}
.${PREFIX}-tl-args-list dt { margin: 0; color: var(--ap-text-tertiary); }
.${PREFIX}-tl-args-list dd { margin: 0; color: var(--ap-text-secondary); word-break: break-word; }

.${PREFIX}-tl-out {
  margin: 0; padding: 6px 8px; max-height: 260px; overflow: auto;
  font-family: var(--ap-font-mono); font-size: var(--ap-font-size-body); line-height: 1.5;
  color: var(--ap-text-secondary); white-space: pre-wrap; word-break: break-word;
  background: var(--ap-surface-panel);
  border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-xs);
}
.${PREFIX}-tl-trunc {
  margin-top: 2px; font-family: var(--ap-font-mono);
  font-size: var(--ap-font-size-caption); color: var(--ap-text-tertiary);
}

/* Thinking. Sans and italic so it reads as reflection, not tool activity —
   carried by the label alone. The bulb stays at the timeline's one glyph tone
   like every other row: the italic word beside it already says what kind of row
   this is, and tinting the mark as well says it twice.

   The label was purple until the semantic palette lost that family, and the
   panel has since stopped spending hue on anything but diff add/del. It would
   not have earned one back regardless: "the model is thinking" is a *kind* of
   row rather than a state, and the sans face and the italic already carry that
   against a column of mono tool names. */
.${PREFIX}-tl-think > .${PREFIX}-tl-head { font-family: var(--ap-font-sans); font-size: var(--ap-font-size-title); }
.${PREFIX}-tl-think-label { color: var(--ap-text-tertiary); font-style: italic; }
.${PREFIX}-tl-think-text {
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-title); line-height: 1.55;
  color: var(--ap-text-secondary); white-space: pre-wrap; word-break: break-word;
}

/* Assistant prose inside the timeline keeps the bubble's sans body scale. */
.${PREFIX}-tl-text { padding: var(--ap-space-xs) 4px; font-size: var(--ap-font-size-heading); }

/* Todos, hung off the same rail as a tool result. */
.${PREFIX}-tl-todos { display: flex; align-items: flex-start; gap: var(--ap-space-xs); padding: 0 4px 0 10px; }
.${PREFIX}-tl-todos .${PREFIX}-tl-res-glyph { display: inline-flex; flex: 0 0 auto; color: var(--ap-text-tertiary); }
.${PREFIX}-tl-todos .${PREFIX}-todos { margin-top: 0; flex: 1 1 auto; min-width: 0; }

/* A diff nested in a tool body already sits inside a bordered box. */
.${PREFIX}-tl-body .${PREFIX}-diff { margin: 0; border: 0; border-radius: 0; }

.${PREFIX}-turn-result:empty { display: none; }

/* Todos. Status rides opacity and weight, not hue.

   Completed used to be green and in-progress blue, which inverted the hierarchy
   the list actually wants: a checklist is read to find the row still in flight,
   and colouring the finished ones made the answered question the loud one. The
   \`check\` glyph and the line-through already say "done" twice over, so done
   recedes and in-progress is the single brightest, heaviest line. */
.${PREFIX}-todos { margin-top: var(--ap-space-sm); list-style: none; padding: 0; }
.${PREFIX}-todos li { display: flex; gap: var(--ap-space-xs); align-items: center; font-size: var(--ap-font-size-title); padding: 2px 0; opacity: .8; }
.${PREFIX}-todos li .${PREFIX}-ic { opacity: .6; }
.${PREFIX}-todos li[data-s="completed"] { opacity: .55; }
.${PREFIX}-todos li[data-s="completed"] span { text-decoration: line-through; }
.${PREFIX}-todos li[data-s="in_progress"] { opacity: 1; font-weight: 500; }

/* A collapsed disclosure outside the timeline. The timeline uses its status dot
   as the affordance and draws no chevron; anything else has to, or it reads as
   a line of inert text. */
.${PREFIX}-disc-chev { display: inline-flex; align-items: center; flex: 0 0 auto; color: var(--ap-text-tertiary); }
.${PREFIX}-disc-head {
  display: flex; align-items: center; gap: var(--ap-space-xs);
  width: 100%; padding: 5px 8px; cursor: pointer; text-align: left;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label);
  color: var(--ap-text-secondary);
  background: transparent; border: 0; border-radius: var(--ap-radius-sm);
  -webkit-appearance: none; appearance: none;
}
.${PREFIX}-disc-head:hover { color: var(--ap-text-primary); background: var(--ap-surface-hover); }
.${PREFIX}-disc-body { padding-top: var(--ap-space-xs); }
.${PREFIX}-follow-disc { margin-top: var(--ap-space-xs); }

/* Diffs. */
.${PREFIX}-diffs { margin-top: var(--ap-space-md); }
.${PREFIX}-diff { margin-bottom: var(--ap-space-sm); border: 1px solid var(--ap-border-default); border-radius: var(--ap-radius-md); overflow: hidden; }
/* Also the disclosure header for a collapsed file, hence the button reset and
   the pointer — a plain header and a toggle have to look identical here. */
.${PREFIX}-diff-head {
  display: flex; align-items: center; gap: var(--ap-space-xs);
  width: 100%; padding: 6px 10px; text-align: left; cursor: pointer;
  background: var(--ap-surface-active); font-size: var(--ap-font-size-body);
  color: var(--ap-text-primary); border: 0;
  -webkit-appearance: none; appearance: none;
}
.${PREFIX}-diff-head:hover { background: var(--ap-surface-selected); }
.${PREFIX}-diff-head .${PREFIX}-diff-file { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PREFIX}-diff-more {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex: 0 0 auto; padding: 0; cursor: pointer;
  color: var(--ap-text-tertiary); background: transparent; border: 0;
  border-radius: var(--ap-radius-xs); opacity: 0;
}
.${PREFIX}-diff:hover .${PREFIX}-diff-more,
.${PREFIX}-diff-more:focus-visible { opacity: 1; }
.${PREFIX}-diff-more:hover { color: var(--ap-text-primary); background: var(--ap-surface-hover); }
.${PREFIX}-diff-plain { display: block; }
.${PREFIX}-diff-file { font-family: var(--ap-font-mono); color: var(--ap-text-primary); font-weight: 600; }
.${PREFIX}-diff-stat { font-family: var(--ap-font-mono); opacity: .5; }
.${PREFIX}-diff-body { margin: 0; padding: 6px 0; background: var(--ap-surface-panel); overflow-x: auto; font: var(--ap-font-size-body)/1.5 var(--ap-font-mono); }
.${PREFIX}-diff-line { padding: 0 10px; white-space: pre; }
.${PREFIX}-diff-add { background: var(--ap-semantic-success-bg); color: var(--ap-semantic-success); }
.${PREFIX}-diff-del { background: var(--ap-semantic-error-bg); color: var(--ap-semantic-error); }
/* Structural punctuation between hunks, not content — quieter than the code it
   separates. The add/del pair below are the only hue left in this panel. */
.${PREFIX}-diff-hunk { color: var(--ap-text-tertiary); }
.${PREFIX}-diff-ctx { opacity: .55; }

/* Follow-ups — same secondary-button recipe as the composer actions: 6px
   radius, 12px type, surface-hover default → surface-active on hover, so they
   read as one control family with Send rather than a third distinct shape. */
.${PREFIX}-follow { margin-top: var(--ap-space-sm); display: flex; flex-direction: column; gap: var(--ap-space-xs); }
.${PREFIX}-follow button {
  display: flex; align-items: center; gap: var(--ap-space-xs); text-align: left; cursor: pointer;
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-label); color: var(--ap-text-primary);
  background: var(--ap-surface-hover); border: 1px solid var(--ap-border-default);
  border-radius: var(--ap-radius-sm); padding: 6px 10px;
}
.${PREFIX}-follow button:hover { border-color: var(--ap-border-strong); background: var(--ap-surface-active); }
.${PREFIX}-follow button { --${PREFIX}-ic-tone: var(--ap-text-tertiary); }`;
