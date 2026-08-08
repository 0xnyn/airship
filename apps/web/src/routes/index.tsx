import { createFileRoute } from "@tanstack/react-router";
import { HeroStage } from "#/components/hero/hero-stage";
import { AgentOutputSection } from "#/components/sections/agent-output-section";
import { FaqSection } from "#/components/sections/faq-section";
import { GetStartedSection } from "#/components/sections/get-started-section";
import { HeroSection } from "#/components/sections/hero-section";
import { HowItWorksSection } from "#/components/sections/how-it-works-section";
import { SiteFooter } from "#/components/sections/site-footer";
import { SiteHeader } from "#/components/shell/site-header";
import { SkipLink } from "#/components/shell/skip-link";

export const Route = createFileRoute("/")({
  component: HomePage,
});

/**
 * The whole site. One route, six sections, and nothing else — every anchor in
 * content/nav.ts points at an `id` below, and the scroll-spy watches exactly
 * those. Not every section has a link: `#output` is reached by scrolling, and
 * `#overview` is what the wordmark points at.
 *
 * `HeroStage` is a direct child of <main> rather than living inside
 * `HeroSection`, and that is structural rather than cosmetic: it is the one
 * full-bleed element on the page, so it must sit outside `.content` and its
 * horizontal padding. Nesting it and escaping with `width: 100vw` would have
 * meant fighting both the scrollbar and `.content`'s centring.
 */
function HomePage() {
  return (
    <div className="layout" id="top">
      <SkipLink />
      <SiteHeader />

      <main className="main" id="main-content">
        <HeroSection />
        <HeroStage />

        <div className="content">
          <HowItWorksSection />
          <AgentOutputSection />
          <GetStartedSection />
          <FaqSection />
          <SiteFooter />
        </div>
      </main>
    </div>
  );
}
