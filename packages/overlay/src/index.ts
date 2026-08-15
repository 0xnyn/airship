import type { AirshipWindowConfig } from "@airship/protocol";
import { boot } from "./app";
import { bootFrameAgent, isFrameName } from "./frame-agent";
import { bootShell } from "./shell-app";

/**
 * One bundle, three surfaces. The proxy injects this same IIFE into the shell
 * document, into every frame, and into the app itself when the inline escape
 * hatch is used; each picks its role here.
 *
 * Getting the frame case wrong is not a subtle failure: a frame that does not
 * recognise itself falls through to the inline overlay and boots a *second*
 * complete editor inside itself — its own docks, its own pointer capture, its
 * own control socket — one per frame. So the decision leans on the injected
 * config, which the proxy sets from `Sec-Fetch-Dest` and cannot be lost in a
 * reload, and treats `window.name` only as a fallback for clients that do not
 * send that header.
 */
function start(): void {
  const config = (window as unknown as { __AIRSHIP__?: AirshipWindowConfig })
    .__AIRSHIP__;

  if (config?.mode === "frame" || isFrameName(window.name)) {
    bootFrameAgent();
    return;
  }

  if (config?.mode === "shell") {
    bootShell(config);
    return;
  }

  // No mode, or an explicit `inline`: the original single-document overlay.
  boot();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
