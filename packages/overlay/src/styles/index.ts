import { buildCss } from "@airship/editor-tokens";
import { PREFIX } from "../dom";
import { css as base } from "./base.css";
import { css as canvas } from "./canvas.css";
import { css as chat } from "./chat.css";
import { css as chrome } from "./chrome.css";
import { ROOT } from "./const";
import { css as controls } from "./controls.css";
import { css as cssPane } from "./css-pane.css";
import { css as docks } from "./docks.css";
import { css as empty } from "./empty.css";
import { css as inspector } from "./inspector.css";
import { css as motion } from "./motion.css";
import { css as pop } from "./pop.css";
import { css as portable } from "./portable.css";
import { css as toast } from "./toast.css";

let injected = false;

export function injectStyles(): void {
  if (injected) {
    return;
  }
  injected = true;
  const style = document.createElement("style");
  style.id = `${PREFIX}-styles`;
  style.textContent = CSS;
  document.head.append(style);
}

// Airship's editor design tokens, scoped under the overlay root. They come from
// @airship/editor-tokens (a dark editor palette — dense neutral
// surfaces, hairline borders, striking Blue #0D99FF), independent of the
// marketing tokens; the overlay is editor chrome floating over the user's own
// app. Fonts are self-hosted; the proxy serves the woff2 from
// @airship/editor-tokens at /__airship/fonts/* (same-origin, no CORS).
const FONTS = `
@font-face {
  font-family: "Inter"; font-style: normal; font-display: swap; font-weight: 100 900;
  src: url("/__airship/fonts/inter-variable.woff2") format("woff2");
}
@font-face {
  font-family: "JetBrains Mono"; font-style: normal; font-display: swap; font-weight: 400;
  src: url("/__airship/fonts/jetbrains-mono-400.woff2") format("woff2");
}
@font-face {
  font-family: "JetBrains Mono"; font-style: normal; font-display: swap; font-weight: 700;
  src: url("/__airship/fonts/jetbrains-mono-700.woff2") format("woff2");
}`;

// Token vars are scoped, not global, so they can't leak into the host app. The
// floating chrome (hover/selection boxes, drop indicators) lives outside the
// overlay root — as a sibling on `document.body`, so it can paint over anything
// — so `.__airship-layer` is scoped alongside the root. Without it every
// `var(--ap-*)` on those elements is invalid-at-computed-value-time and silently
// drops the declaration. The toast host is listed for the same reason: it is a
// child of the root today, and that is one refactor away from not being true.
const VARS = buildCss({
  scope: `${ROOT}, .${PREFIX}-layer, .${PREFIX}-chrome-layer, .${PREFIX}-canvas-viewport, .${PREFIX}-toast-host`,
});

/**
 * The whole stylesheet, as one string.
 *
 * Exported so it can be asserted about. Every rule here is written in terms of
 * `var(--ap-*)`, and a variable that is not actually emitted does not fall back
 * to anything — the declaration is invalid at computed-value time and the
 * browser drops it, silently and at runtime. That failure mode has bitten this
 * file before (see the note on `VARS`), and it is the sort of thing a test can
 * catch for nothing while a person cannot.
 */
export function overlayCss(): string {
  return CSS;
}

// One stylesheet, assembled from co-equal modules. The order is the cascade:
// base establishes the reset and the icon colour roles, canvas is the substrate
// beneath the chrome, and chrome sits near the end so its z-indexed layers win
// ties. `pop` sits after `controls` because a popover's shell overrides control
// styling its content inherits, not the other way round. `toast` is the last of
// the *layers* because it is the topmost of them — see `Z_TOAST`; `motion` comes
// after it, but it is policy rather than a layer and overrides all of them.
//
// Two placements are load-bearing rather than aesthetic. `portable` goes
// directly after `base` because its text-edit rules and `base`'s edit-mode
// block both target the same node and can tie on specificity — and `portable`
// is the one that must win. It is also the only module here that is *not*
// exclusive to this document: `frame-agent.ts` serves the same string inside
// every frame, because the node it styles is a page node in both stages.
const CSS = [
  FONTS,
  VARS,
  base,
  portable,
  canvas,
  docks,
  chat,
  inspector,
  cssPane,
  // Empty states are surface-agnostic — the same block renders in the chat
  // dock, the inspector and the CSS pane — so it sits after all three, where
  // its own tones win over whatever the host surface set on the container.
  empty,
  controls,
  pop,
  chrome,
  toast,
  // Last, and it has to be: it overrides the motion every module above declares,
  // and it does so by winning on order rather than on `!important` everywhere.
  motion,
]
  .join("\n")
  .trim();
