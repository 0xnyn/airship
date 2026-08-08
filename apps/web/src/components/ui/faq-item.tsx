import { useCallback } from "react";
import { cn } from "#/lib/cn";

/**
 * One accordion row.
 *
 * Open state is owned by the section so only one answer can be open at a time —
 * an accordion where every row can be open is just a list with extra clicks.
 * `onToggle` therefore takes the id rather than being a nullary closure: that
 * lets the section pass one stable handler for every row instead of allocating a
 * new one per row on every render.
 *
 * The answer stays in the DOM when closed, collapsed by a grid row rather than
 * unmounted, which is what lets it animate to a height nobody measured. `hidden`
 * would defeat that, so the state is carried by `aria-expanded` on the button and
 * `aria-labelledby` pointing the region back at it.
 */
export function FaqItem({
  answer,
  id,
  isOpen,
  onToggle,
  question,
}: {
  answer: string;
  id: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  question: string;
}) {
  const handleClick = useCallback(() => onToggle(id), [onToggle, id]);

  return (
    <div className={cn("faq-item", isOpen && "open")}>
      <h3>
        <button
          aria-controls={`faq-answer-${id}`}
          aria-expanded={isOpen}
          className="faq-question"
          id={`faq-question-${id}`}
          onClick={handleClick}
          type="button"
        >
          {question}
          <Chevron />
        </button>
      </h3>
      <section
        aria-labelledby={`faq-question-${id}`}
        className="faq-answer"
        id={`faq-answer-${id}`}
      >
        <div>
          <p>{answer}</p>
        </div>
      </section>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      className="faq-chevron"
      fill="none"
      height="12"
      viewBox="0 0 12 12"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}
