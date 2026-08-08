import { InstallCopy } from "#/components/ui/install-copy";
import { AGENT_MARKS } from "#/content/agent-marks";
import { HERO } from "#/content/hero";

/**
 * The hero's words. The animation that goes with them is `HeroStage`, which is
 * rendered as a sibling in routes/index.tsx rather than from here — it is
 * full-bleed and this section is a centred column, so they cannot share a box.
 */
export function HeroSection() {
  return (
    <section className="hero" id="overview">
      <p className="hero-eyebrow">
        {HERO.eyebrow}
        {AGENT_MARKS.map((mark) => (
          <svg
            className="hero-eyebrow-mark"
            key={mark.name}
            role="img"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>{mark.name}</title>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: AGENT_MARKS
                is a module-level constant of literal SVG markup with no
                interpolated input. Parsing it back into JSX would buy nothing
                and would put path data that must stay byte-identical to
                assets/local/*.svg at the mercy of the formatter. */}
            <g dangerouslySetInnerHTML={{ __html: mark.body }} />
          </svg>
        ))}
      </p>
      <h1 className="hero-heading">{HERO.heading}</h1>
      <p className="hero-sub">{HERO.sub}</p>

      <div className="cta-row desktop-only">
        <a className="cta-primary" href={HERO.ctaHref}>
          {HERO.ctaLabel}
        </a>
        <InstallCopy command={HERO.installCommand} />
      </div>
    </section>
  );
}
