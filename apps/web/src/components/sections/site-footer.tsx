import { ExternalIcon } from "#/components/ui/external-icon";
import { GLYPHS } from "#/content/editor-glyphs";
import { FOOTER, FOOTER_COLUMNS } from "#/content/footer";
import { SITE } from "#/content/site";

/**
 * The footer: a brand column, the links that actually resolve, the wordmark as
 * art, and a bottom bar.
 *
 * The oversized wordmark is `aria-hidden` and clipped to roughly the top two
 * thirds of its letterforms. It is set in the page's own type at a size nothing
 * else comes near, which is the whole trick — it reads as the brand rather than
 * as a heading, and cropping it is what keeps it from being read as one. There
 * is no image involved, so it costs nothing to ship and follows the tokens.
 */
export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <span className="footer-logo">
            <svg
              aria-hidden="true"
              className="footer-brand-mark"
              fill="none"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the glyph
                  body is a module-level constant of literal SVG markup with no
                  interpolated input — same reasoning as the header wordmark. */}
              <g dangerouslySetInnerHTML={{ __html: GLYPHS.logo.body }} />
            </svg>
            <span className="footer-brand-name">{SITE.name}</span>
          </span>
          <p className="footer-blurb">{FOOTER.blurb}</p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav
            aria-labelledby={`footer-${column.id}`}
            className="footer-col"
            key={column.id}
          >
            <h2 className="footer-col-title" id={`footer-${column.id}`}>
              {column.title}
            </h2>
            {column.links.map((link) => (
              <a
                className="footer-col-link"
                href={link.href}
                key={link.href}
                {...("external" in link && link.external
                  ? { rel: "noopener", target: "_blank" }
                  : {})}
              >
                {link.label}
                {"external" in link && link.external ? <ExternalIcon /> : null}
              </a>
            ))}
          </nav>
        ))}
      </div>

      {/* Decorative, and the last thing on the page. The name is already
          announced by the brand column above, and a screen reader meeting it
          twice learns nothing the second time. */}
      <div aria-hidden="true" className="footer-art">
        <span className="footer-art-word">{SITE.name}</span>
      </div>
    </footer>
  );
}
