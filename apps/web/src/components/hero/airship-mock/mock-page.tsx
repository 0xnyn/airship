import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";
import { MOCK_PAGE } from "#/content/mock-page";

/**
 * The app being edited: this site, in miniature.
 *
 * Not a fictional product — `make run` points the CLI at apps/web, so the page
 * inside the hero's browser window really is the page around it. The button the
 * agent changes is the same button a reader can see a few hundred pixels above.
 *
 * `.ap-cta` carries the id the measuring effect looks for, and its radius and
 * fill come from custom properties the timeline drives. Everything else here is
 * scenery — it exists so the picker has somewhere plausible to hover.
 */
export function MockPage() {
  return (
    <div className="ap-page">
      <div className="ap-page-nav">
        <span className="ap-page-brand">
          <EditorGlyph name="logo" size={24} />
          {MOCK_PAGE.brand}
        </span>
        <span className="ap-page-links">
          {MOCK_PAGE.nav.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </span>
      </div>

      <div className="ap-page-hero">
        {/*
          A <p>, not an <h2>. This is a picture of a heading inside an
          aria-hidden illustration; giving it a real heading element puts a
          phantom entry in the document outline that no reader can reach.
        */}
        <p className="ap-page-heading">{MOCK_PAGE.heading}</p>
        <p className="ap-page-sub">{MOCK_PAGE.sub}</p>
        <div className="ap-page-actions">
          <span className="ap-cta" id="ap-cta">
            {MOCK_PAGE.ctaLabel}
          </span>
          <span className="ap-cta-secondary">{MOCK_PAGE.secondaryLabel}</span>
        </div>
      </div>

      <div className="ap-page-cards">
        {MOCK_PAGE.cards.map((card) => (
          <div className="ap-page-card" key={card.title}>
            <p className="ap-page-card-title">{card.title}</p>
            <p className="ap-page-card-body">{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
