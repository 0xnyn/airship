import { ProxyFigure } from "#/components/figures/proxy-figure";
import { SourceFigure } from "#/components/figures/source-figure";
import { SectionHeading } from "#/components/ui/section-heading";
import { STEPS, STEPS_SECTION, type StepFigure } from "#/content/steps";

/**
 * A lookup rather than a conditional, so adding a third card is a new entry in
 * content/steps.ts plus a new figure — and never an edit to this component.
 * `StepFigure` is derived from the content, so a key with no figure here is a
 * type error rather than a blank card.
 */
const FIGURES: Record<StepFigure, () => React.JSX.Element> = {
  proxy: ProxyFigure,
  source: SourceFigure,
};

/**
 * Two cards, each an illustration over the claim it illustrates.
 *
 * This is the layout that pushed every section from 640px to the header's own
 * 1120px: at 640 two cards side by side are ~310px each, which is too narrow for
 * a figure to say anything. The 640 measure still exists, but as a cap on prose
 * inside a section rather than on the section — see `.section` in shell.css.
 */
export function HowItWorksSection() {
  return (
    <section className="section" id="how-it-works">
      <SectionHeading desc={STEPS_SECTION.desc} title={STEPS_SECTION.heading} />

      <div className="steps-grid">
        {STEPS.map((step) => {
          const Figure = FIGURES[step.figure];
          return (
            <article className="step-card" key={step.id}>
              <div className="step-figure">
                <Figure />
              </div>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-card-desc">{step.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
