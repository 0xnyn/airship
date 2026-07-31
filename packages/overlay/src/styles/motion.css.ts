import { PREFIX } from "../dom";
import { ROOT } from "./const";

/**
 * Motion policy: the one place `prefers-reduced-motion` is honoured.
 *
 * Every other module declares its transitions in terms of `--ap-motion-*` and
 * says nothing about whether they should run. This module answers that once, for
 * all of them, which is the only way the answer stays consistent — the
 * alternative is the shape the reference implementation ended up in, a hand-kept
 * list of twenty-odd selectors that drifts the moment anyone adds a control.
 *
 * `transition-duration: 0s` rather than `transition: none`: the duration is the
 * part someone asked us not to animate, and zeroing it leaves the declared
 * property list intact so a `transitionend` listener still fires. Killing the
 * shorthand outright would strand any code waiting on one — which is exactly how
 * a "reduce motion" setting turns into a stuck panel.
 *
 * Appended last in `styles/index.ts` so it outranks every module it overrides
 * without needing `!important` on anything but the animation reset, where the
 * competing declaration is often a shorthand with its own duration inside it.
 */
export const css = `
@media (prefers-reduced-motion: reduce) {
  ${ROOT}, ${ROOT} *,
  .${PREFIX}-chrome-layer, .${PREFIX}-chrome-layer *,
  .${PREFIX}-canvas-viewport, .${PREFIX}-canvas-viewport * {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-delay: 0s !important;
  }
}`;
