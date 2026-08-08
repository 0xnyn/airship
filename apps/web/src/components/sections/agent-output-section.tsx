import { SectionHeading } from "#/components/ui/section-heading";
import {
  AGENT_OUTPUT,
  AGENT_OUTPUT_SECTION,
  type OutputToken,
} from "#/content/agent-output";

const TOKEN_CLASS: Record<OutputToken["kind"], string> = {
  dim: "output-dim",
  heading: "output-heading",
  hint: "output-hint",
  new: "output-new",
  old: "output-old",
  plain: "",
  prop: "output-prop",
};

export function AgentOutputSection() {
  return (
    <section className="section" id="output">
      <SectionHeading
        desc={AGENT_OUTPUT_SECTION.desc}
        title={AGENT_OUTPUT_SECTION.heading}
      />
      <div className="output-block">
        <div className="output-chrome">{AGENT_OUTPUT_SECTION.chromeLabel}</div>
        {/*
          One <pre> holding the whole payload rather than a <div> per line: the
          block is `white-space: pre` and the column alignment of the `→` is what
          makes it read as a payload rather than as prose. Per-line elements would
          survive that, but they would also let a future flex/gap change silently
          break the alignment.
        */}
        <pre className="output-body">
          {AGENT_OUTPUT.map((line) => (
            <span key={line.id}>
              {line.tokens.map((token) => (
                <span className={TOKEN_CLASS[token.kind]} key={token.id}>
                  {token.text}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
    </section>
  );
}
