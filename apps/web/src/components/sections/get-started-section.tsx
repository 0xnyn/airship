import { CodeBlock } from "#/components/ui/code-block";
import { SectionHeading } from "#/components/ui/section-heading";
import { GET_STARTED, GET_STARTED_SECTION } from "#/content/get-started";

export function GetStartedSection() {
  return (
    <section className="section" id="get-started">
      <SectionHeading
        desc={GET_STARTED_SECTION.desc}
        title={GET_STARTED_SECTION.heading}
      />
      <ol className="install-steps">
        {GET_STARTED.map((step) => (
          <li className="install-step" key={step.id}>
            <h3 className="install-step-title">{step.title}</h3>
            <CodeBlock
              code={step.code}
              copyable={step.copyable}
              label={step.title}
            />
            {step.note ? <p className="install-note">{step.note}</p> : null}
          </li>
        ))}
      </ol>
      <p className="install-compat">{GET_STARTED_SECTION.compat}</p>
    </section>
  );
}
