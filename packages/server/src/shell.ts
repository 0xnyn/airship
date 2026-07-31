/**
 * The canvas shell document.
 *
 * In canvas mode the proxy stops serving the app's HTML at the top level and
 * serves this instead. The app still runs — one full copy per frame, inside
 * same-origin iframes the shell creates — but it no longer shares a document
 * with the editor.
 *
 * That separation is the point. Until now the overlay lived inside the app and
 * had to defend itself from it: scoped CSS variables so the app's `:root` didn't
 * bleed in, a `__airship-` prefix on every class, and a `z-index` of 2147483600
 * to stay on top. None of the app's CSS reaches this document, so the editor
 * finally has a clean page of its own.
 *
 * Deliberately minimal: no app CSS, no framework, no build step. Fonts resolve
 * same-origin from `/__airship/fonts/*` (see `serveAirshipAsset`), and every
 * pixel of UI is drawn by the overlay bundle.
 */
import type { AirshipWindowConfig } from "@airship/protocol";

/**
 * The tab icon: Airship's brand mark, inlined.
 *
 * A data URI rather than a route, for the same reason this file has no build
 * step — the favicon is the first thing a browser asks for, and serving it
 * would mean a second round trip and another branch in `serveAirshipAsset` for
 * ~300 bytes. `assets/logo.svg` at the repo root is the geometry of record;
 * this is the third copy of that path (with the overlay's `logo` glyph), and
 * all three change together.
 *
 * Two differences from the in-UI glyph, both because a favicon is 16 physical
 * pixels:
 *
 * - The viewBox is cropped to `3.6 3.6 16.8 16.8` instead of the full 24 box.
 *   The set's optical inset gives back a third of the tab icon as empty margin,
 *   which matters at 24px and is waste at 16.
 * - Full opacity, not the set's 0.9. That step exists to seat a glyph among
 *   other glyphs; in a tab strip there is nothing to seat it against.
 *
 * The colour comes from a `prefers-color-scheme` rule because the tab strip
 * follows the *browser's* theme, not this page's — the shell is always dark,
 * the chrome around it is not. Black is the base so that a renderer which
 * ignores the query still lands on the readable answer for a default light
 * tab strip.
 */
const FAVICON =
  "data:image/svg+xml," +
  "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='3.6 3.6 16.8 16.8'%3E" +
  "%3Cstyle%3Epath{fill:%23000}" +
  "@media(prefers-color-scheme:dark){path{fill:%23fff}}%3C/style%3E" +
  "%3Cpath d='M12 5.1L20 18.9H15.47L9.73 9.01ZM7.47 12.92H12L8.53 18.9H4Z'/%3E" +
  "%3C/svg%3E";

/**
 * `</script>` inside a JSON string would close the tag early; U+2028 and U+2029
 * are legal in JSON but are line terminators to a JS parser, so both have to be
 * escaped before the config can be inlined into a `<script>`.
 *
 * Exported because the inline injection embeds the same config into the app's
 * own HTML, and that config now carries a `pathname` taken from the request —
 * i.e. a string the page's author does not control.
 */
export function escapeForScript(json: string): string {
  return json.replace(/[<\u2028\u2029]/g, (c) => {
    if (c === "<") {
      return "\\u003c";
    }
    return c === "\u2028" ? "\\u2028" : "\\u2029";
  });
}

export function shellHtml(config: AirshipWindowConfig): string {
  const json = escapeForScript(JSON.stringify(config));
  return `<!doctype html>
<html lang="en" data-airship-shell>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>Airship</title>
<link rel="icon" href="${FAVICON}">
<style>
/* Painted before the bundle runs so the canvas never flashes white. */
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#141414;}
</style>
<script>window.__PIKA__=${json};</script>
</head>
<body>
<script src="/__airship/overlay.js"></script>
</body>
</html>
`;
}
