/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately not `clsx` and deliberately not `tailwind-merge`: this page is a
 * CSS-first port whose class names are semantic (`.step-card`, `.toc-link`), not
 * utility soup, so there are no conflicting Tailwind utilities to resolve and
 * nothing to gain from a merge pass. Objects and nested arrays are unsupported
 * for the same reason — if a call site wants one, it can spread it itself.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
