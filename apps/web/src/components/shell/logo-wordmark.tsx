import { GLYPHS } from "#/content/editor-glyphs";
import { SITE } from "#/content/site";

/**
 * The brand mark and the wordmark, linking back to the top.
 *
 * The mark's path is the same geometry as assets/logo.svg — the file that is the
 * repo's geometry of record — inlined rather than loaded through an <img> so it
 * inherits `currentColor` and follows the bar's text colour without a second
 * asset.
 *
 * The wordmark is set at 500 and is the only word on the page at that weight
 * outside a heading; everything else in the header is 400. That is what makes it
 * read as a mark rather than as the first item of the navigation.
 */
export function LogoWordmark() {
  return (
    <a aria-label={`${SITE.name} — home`} className="header-logo" href="#top">
      <svg
        aria-hidden="true"
        className="header-mark"
        fill="none"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the glyph body
            is a module-level constant of literal SVG markup with no interpolated
            input. Parsing it back into JSX elements would buy nothing and would
            put the path data — which must stay byte-identical to assets/logo.svg
            — at the mercy of the formatter. */}
        <g dangerouslySetInnerHTML={{ __html: GLYPHS.logo.body }} />
      </svg>
      <span className="header-wordmark">{SITE.name}</span>
    </a>
  );
}
