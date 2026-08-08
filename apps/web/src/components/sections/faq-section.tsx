import { useCallback, useState } from "react";
import { FaqItem } from "#/components/ui/faq-item";
import { SectionHeading } from "#/components/ui/section-heading";
import { FAQ, FAQ_SECTION } from "#/content/faq";

export function FaqSection() {
  // One open at a time. `null` rather than an index so "nothing open" is not the
  // same value as "the first one".
  const [openId, setOpenId] = useState<string | null>(null);

  // One handler for every row, rather than one closure per row per render.
  const toggle = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  return (
    <section className="section" id="faq">
      <SectionHeading desc={FAQ_SECTION.desc} title={FAQ_SECTION.heading} />
      <div className="faq-list">
        {FAQ.map((entry) => (
          <FaqItem
            answer={entry.answer}
            id={entry.id}
            isOpen={openId === entry.id}
            key={entry.id}
            onToggle={toggle}
            question={entry.question}
          />
        ))}
      </div>
    </section>
  );
}
