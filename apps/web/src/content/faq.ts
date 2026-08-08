import faq from "#/content/faq.json";

/*
 * Ten questions, answered the way the README answers them — including where the
 * honest answer is a limitation. The sandboxing and agent-parity entries in
 * particular say less than a marketing page would like them to, because the
 * README says less, and a FAQ that oversells the safety story is the one place
 * on a page like this where being wrong actually costs someone something.
 */

export interface FaqEntry {
  answer: string;
  id: string;
  question: string;
}

export const FAQ: readonly FaqEntry[] = faq.entries;

export const FAQ_SECTION = {
  desc: faq.desc,
  heading: faq.heading,
};
