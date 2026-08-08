/*
 * The hero's 11.5-second loop, as named numbers.
 *
 * The same percentages appear in three places: the @keyframes in
 * styles/hero-timeline.css, the act-by-act comment at the top of that file, and
 * the handful of values JS needs (the reduced-motion still frame, the scrubber).
 * Naming them here is the only defence against someone nudging a stop in the CSS
 * while the comment quietly becomes a lie.
 *
 * CSS cannot import from TypeScript, so this file does not *drive* the
 * stylesheet — it documents it, and the constants below are the ones code
 * actually reads. Treat a mismatch between the two as a bug in the stylesheet.
 */

/**
 * Loop length. Every track in hero-timeline.css runs at exactly this, via the
 * `--ap-loop` custom property on `.hero-visual`.
 *
 * The number is a residue, not a target. Every beat's duration was chosen on its
 * own terms — 72ms a character for the typing, ~460ms for the pointer to cross
 * the stage, ~390ms per tool call, a ~1.3s hold on the settled frame — and this
 * is what they add up to. It came down from 13s when the CLI act was cut, and it
 * came down by exactly the length of that act: nothing else was compressed.
 *
 * So: to retune the pace, change a beat and let this follow. Changing this on
 * its own scales all fifty tracks at once, which is occasionally what you want
 * and never what you want by accident.
 */
export const LOOP_MS = 11_500;

/** 1% of the loop, in milliseconds — the scrubber's unit. */
export const FRAME_MS = LOOP_MS / 100;

/**
 * The frame the mock is pinned at under `prefers-reduced-motion: reduce`, and
 * the one to screenshot when comparing the mock against the real editor.
 *
 * The breathing beat: selection ring up, the panel on its Edit tab, and BOTH
 * edits visible on the button — the agent's colour and the hand-scrubbed radius.
 * It is the single frame that best sells the product as a still image, which
 * matters because for a visitor who has asked their OS to stop animations it is
 * the only frame they will ever see.
 */
export const SETTLED_FRAME = 77;

/** Act boundaries, for the scrubber's labels and for reading the stylesheet. */
export const ACTS = [
  { at: 0, id: "select", label: "Select" },
  { at: 17, id: "prompt", label: "Prompt" },
  { at: 36, id: "agent", label: "Agent" },
  { at: 56, id: "inspector", label: "Inspector" },
  { at: 74, id: "settle", label: "Breathe" },
  { at: 85.5, id: "teardown", label: "Teardown" },
  { at: 95.5, id: "gap", label: "Gap" },
] as const;

/**
 * What the agent's edit changes.
 *
 * Shared between the inspector's fields and the mock page's button so the two
 * cannot disagree — the payoff only reads as a payoff if the number the panel
 * reports and the shape on the page are the same edit.
 */
export const TWEAKS = {
  /** Changed by the agent, from the prompt. */
  fill: { from: "1C1917", to: "E2603A" },
  /** Changed by hand, scrubbed in the inspector. */
  radius: { from: "6", to: "9999" },
} as const;
