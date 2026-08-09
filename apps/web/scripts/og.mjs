/*
 * Regenerates public/og.png.
 *
 * The card used to be a hand-made binary with the headline and the install
 * command painted into it, which is exactly how it ended up advertising
 * "The visual editor for the app you're already running" and `npx airship`
 * long after the page had stopped saying either. A picture of copy is still
 * copy, and nothing checks it.
 *
 * So the two strings that actually drift — the heading and the install
 * command — are read from the same content files the page renders from, and
 * the card is a screenshot. Change the copy, run `make web:og`, commit the png.
 *
 * The blurb below is NOT read from content on purpose: a social card has room
 * for about a dozen words, and every descriptive string in content/ is written
 * for a page that can afford three lines. Keeping it here, short, beats
 * force-fitting hero.sub into a space it does not fit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pw from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");
const TOKENS = join(WEB, "../../packages/site-tokens/dist");

const WIDTH = 1200;
const HEIGHT = 630;

/** The one line of copy this file owns. See the note above. */
const BLURB =
  "Point at any element, describe the change, and Claude Code, Codex or OpenCode edits the source file.";

const site = JSON.parse(
  readFileSync(join(WEB, "src/content/site.json"), "utf8")
);
const hero = JSON.parse(
  readFileSync(join(WEB, "src/content/hero.json"), "utf8")
);

/** The install command, with hero.json's `{{installCommand}}` resolved. */
const install = hero.installCommand.replace(
  /\{\{installCommand\}\}/g,
  site.installCommand
);

function font(file) {
  try {
    return readFileSync(join(TOKENS, "fonts", file)).toString("base64");
  } catch (cause) {
    throw new Error(
      `Missing ${file}. Build the tokens first: pnpm turbo run build --filter=@airship/site-tokens`,
      { cause }
    );
  }
}

const inter = font("inter-variable.woff2");
const mono = font("jetbrains-mono-400.woff2");

/*
 * The brand mark, inlined from assets/logo.svg. The <style> block in that file
 * is dropped deliberately — its `svg { color }` rule is scoped to the document,
 * not the element, so it would repaint anything else on the page. Inline is the
 * one context where inheriting the surrounding colour is what you want.
 */
const LOGO_PATH = "M12 5.1L20 18.9H15.47L9.73 9.01ZM7.47 12.92H12L8.53 18.9H4Z";

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Inter";
    font-weight: 100 900;
    src: url(data:font/woff2;base64,${inter}) format("woff2");
  }
  @font-face {
    font-family: "JetBrains Mono";
    font-weight: 400;
    src: url(data:font/woff2;base64,${mono}) format("woff2");
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 28px;
    padding: 0 88px;
    font-family: "Inter", system-ui, sans-serif;
    /* --pk-color-surface-page, under the hero band's warm accent (#e2603a). */
    background:
      radial-gradient(58% 88% at 84% 76%,
        rgba(226, 96, 58, 0.30) 0%,
        rgba(226, 96, 58, 0.11) 40%,
        rgba(226, 96, 58, 0) 72%),
      #fafaf9;
    color: #1c1917;
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: center; gap: 11px; }
  .brand svg { width: 30px; height: 30px; }
  .brand span { font-size: 25px; font-weight: 600; letter-spacing: -0.01em; }
  h1 {
    font-size: 68px;
    font-weight: 600;
    line-height: 1.06;
    letter-spacing: -0.032em;
    max-width: 15ch;
  }
  p {
    font-size: 25px;
    line-height: 1.45;
    /* --pk-color-text-muted */
    color: #57534e;
    max-width: 30ch;
  }
  code {
    align-self: flex-start;
    margin-top: 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 22px;
    color: #1c1917;
    /* --pk-color-surface-input / --pk-color-border-default */
    background: #f5f5f4;
    border: 1px solid #e7e5e4;
    border-radius: 9px;
    padding: 13px 19px;
  }
</style>
<div class="brand">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="${LOGO_PATH}" fill="#1c1917" fill-opacity="0.9" />
  </svg>
  <span>${site.name}</span>
</div>
<h1>${hero.heading}.</h1>
<p>${BLURB}</p>
<code>${install}</code>
`;

const browser = await pw.chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { height: HEIGHT, width: WIDTH },
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

const out = join(WEB, "public/og.png");
await page.screenshot({ path: out });
await browser.close();

process.stdout.write(`og: wrote ${out} (${WIDTH}x${HEIGHT})\n`);
