/*
 * The empty state: a mark, a title, and an optional sentence.
 *
 * An empty panel used to be a line of grey text floating in a dock, which is
 * the moment the product feels thinnest — the one screen with nothing on it is
 * also the first screen most people see. This is what goes above that line.
 *
 * It is the brand mark, every time, and that is the whole design. There were
 * five bespoke spot illustrations here before: a frame with the old ship mark
 * holding station over it, a stylesheet card, three receding chat cards, a
 * selection rect with its four grips and a Move cursor, an indented DOM rail.
 * Each was legible on its own and all five were wrong together. An empty state
 * is a thing you read *past* — it says "nothing here yet, do this" and gets out
 * of the way — and a four-element scene is read instead of the sentence beneath
 * it. The drawing meant to stop the panel feeling thin was taking the attention
 * the words needed.
 *
 * So: one mark, repeated. Repetition is what turns it into furniture rather
 * than art — by the third empty panel it is not being looked at, which is
 * exactly the job. And the mark is the brand's, so the quiet place where the
 * product has nothing to show is also the place it says its own name.
 *
 * The tone (`--ap-icon-muted`, a step below the resting glyph tone) and the
 * size below both work to keep it scenery. See `styles/empty.css.ts`.
 */
import { cls, el } from "./dom";
import { iconSvg } from "./icons";

/** How much room the empty state has. `sm` is for a state inside a section. */
export type EmptySize = "md" | "sm";

/**
 * The mark's box, per size.
 *
 * Smaller than the 72px the illustrations occupied, and deliberately: those
 * were 1.25-unit line drawings — mostly white space — where the mark is solid.
 * At the same box it would be several times the ink and would read as a logo
 * splash rather than as a watermark.
 *
 * There is no legibility floor to trade against here, which is the dividend of
 * a monogram over the pictogram this replaced: two slabs and one counter still
 * resolve at any size an empty state would ever use, where the old saucer's
 * dome, hull and three lights closed into a smudge below about 44. So the only
 * question left is how much attention the mark should take from the sentence
 * under it, and the answer to that is "less" — hence 48 rather than 56.
 */
const ART: Record<EmptySize, number> = { md: 48, sm: 28 };

export interface EmptyStateSpec {
  /** The sentence under the title. Optional — a title alone is often enough. */
  body?: string;
  /** `md` fills a dock; `sm` sits inside a section. Defaults to `md`. */
  size?: EmptySize;
  /** One line, sentence case. What is missing, or what to do about it. */
  title: string;
}

/**
 * The one empty state, for every surface with room for a mark.
 *
 * Deliberately not used inside a section's row list. Those used to render a
 * "None" row on the reasoning that a placeholder stopped the section jumping
 * when the first fill was added; it also stated a value the element did not
 * have, and Filters — which stacks two lists — opened onto four lines of it.
 * An empty list now renders nothing and the section header's `+` carries the
 * affordance, which is both what a design tool does and what those headers already had.
 */
export function emptyState(spec: EmptyStateSpec): HTMLElement {
  const size = spec.size ?? "md";
  return el("div", { class: `${cls("empty")} ${cls(`empty-${size}`)}` }, [
    // A bare span rather than `icon()`: `base.css` paints every `.ic` under
    // `#${PREFIX}-root`, and an id outranks any number of classes, so wearing
    // the icon wrapper's class here would override the muted tone below with
    // the resting glyph tone and put the mark level with the title.
    el("span", { class: cls("empty-art"), html: iconSvg("logo", ART[size]) }),
    el("div", { class: cls("empty-title"), text: spec.title }),
    spec.body ? el("div", { class: cls("empty-body"), text: spec.body }) : null,
  ]);
}
