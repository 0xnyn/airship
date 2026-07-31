import { PREFIX } from "../dom";
import { Z_TOAST } from "./const";

/*
 * The toast.
 *
 * Its own module rather than a block in `chrome.css.ts`, where it used to live:
 * that file is "the floating chrome layer" by its own doc comment, and the toast
 * was the one thing in it that is not on that layer. It is a child of the
 * overlay root with a declared layer of its own — see `Z_TOAST`.
 */
export const css = `
.${PREFIX}-toast-host {
  position: absolute; inset: 0; z-index: ${Z_TOAST}; pointer-events: none;
}

/* The centring \`translateX(-50%)\` appears in *both* states on purpose. Written
   only on the resting state, the fade-in would also slide the toast in from half
   its own width — which reads as the toast arriving from the left rather than
   rising into place. */
.${PREFIX}-toast {
  position: fixed; left: 50%; bottom: 76px;
  transform: translate(-50%, 6px); opacity: 0;
  transition:
    opacity var(--ap-motion-dur-base) var(--ap-motion-ease-out),
    transform var(--ap-motion-dur-base) var(--ap-motion-ease-out);
  pointer-events: none; display: inline-flex; align-items: center; gap: var(--ap-space-xs);
  max-width: min(420px, calc(100vw - 32px));
  background: var(--ap-primary); color: var(--ap-text-primary);
  padding: 8px 12px; border-radius: var(--ap-radius-md); font-size: var(--ap-font-size-title);
  box-shadow: var(--ap-elevation-card);
}
.${PREFIX}-toast-in { opacity: 1; transform: translate(-50%, 0); }
.${PREFIX}-toast-error { background: var(--ap-semantic-error); }
/* The repeat counter. Dimmed so a burst of undos reads as one message with a
   tally rather than as a message that keeps changing. */
.${PREFIX}-toast-count { font-family: var(--ap-font-mono); opacity: .65; }

/* The affordance — the one part of a toast that takes a pointer.

   The host and the box are both \`pointer-events: none\` so a receipt floating
   over the canvas never eats a click meant for the app underneath. An action is
   the exact exception, and it has to say so itself rather than by loosening the
   box around it.

   A hairline ghost rather than a filled chip, in white alpha throughout: the
   toast has two backgrounds — \`--ap-primary\` and, on the error tone,
   \`--ap-semantic-error\` — and any fixed colour that reads on one is wrong on
   the other. \`--ap-button-ghost-*\` are defined as white alpha for exactly this,
   so hover and press land correctly on both. */
.${PREFIX}-toast-action {
  pointer-events: auto; cursor: pointer;
  margin-left: var(--ap-space-xs); padding: 2px 8px;
  background: transparent; color: var(--ap-text-primary);
  border: 1px solid var(--ap-border-strong); border-radius: var(--ap-radius-xs);
  font-family: var(--ap-font-sans); font-size: var(--ap-font-size-body); font-weight: 500;
}
.${PREFIX}-toast-action:hover { background: var(--ap-button-ghost-hover); }
.${PREFIX}-toast-action:active { background: var(--ap-button-ghost-pressed); }`;
