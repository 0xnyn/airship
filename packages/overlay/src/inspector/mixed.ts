/*
 * The sentinel a control shows when the values behind it disagree.
 *
 * There were two of these — `panel.ts` and `controls/color-picker.ts` each
 * declared their own `const MIXED = "Mixed"`, the second commented "mirrors
 * `panel.ts`'s own sentinel" — and `sections/stroke.ts` was about to be the
 * third. A sentinel that two modules spell independently is one rename away
 * from a control that renders the literal word for a value the panel never
 * produced, which is the same failure `num.ts` was written to stop.
 *
 * The reason it is a plain string rather than a symbol or a wrapper type is
 * `panel.seed`'s, and it is worth keeping stated: "`MIXED` is a plain string,
 * which is what lets it flow through the existing controls untouched — a number
 * field renders it as text, a segmented group matches no option and shows
 * nothing active. Both are exactly right, and neither needed a new code path."
 *
 * Note what this is *not* used for. A colour row does not test for this string;
 * it asks `isParseableColor`, and treats anything it cannot render as mixed —
 * so a keyword or an unresolved `var()` gets the same hairline. This constant is
 * what a *producer* writes; consumers should keep asking the question they
 * actually care about.
 */

/** What a control shows when the values behind it disagree. */
export const MIXED = "Mixed";

/**
 * Do these all agree? The shared value if so, `MIXED` if not.
 *
 * `same` is a parameter because the right comparison depends on the property.
 * Colours need `sameColor` — `getComputedStyle` hands back the legacy comma
 * form while `formatColor` writes the modern space one, so `===` reports one
 * colour as several. Keywords and lengths are compared as strings.
 *
 * An empty list has nothing to disagree about and returns the fallback, which
 * is what a caller reading four longhands off an element with none wants.
 */
export function agreed(
  values: readonly string[],
  fallback: string,
  same: (a: string, b: string) => boolean = (a, b) => a === b
): string {
  const [first] = values;
  if (first === undefined) {
    return fallback;
  }
  const value = first || fallback;
  return values.every((other) => same(other || fallback, value))
    ? value
    : MIXED;
}
