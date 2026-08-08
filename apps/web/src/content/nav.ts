import nav from "#/content/nav.json";
import { linkFor } from "#/content/resolve";

/*
 * The header's navigation.
 *
 * `id` is both the anchor target and the key the scroll-spy matches on, so every
 * entry in nav.json must correspond to a real `id` on a <section> in
 * routes/index.tsx. There is no runtime check for that — a typo is a link that
 * scrolls nowhere and an indicator that never lights up.
 *
 * Deliberately shorter than the set of sections on the page. In the old left
 * rail this was a table of contents and listing every section was the point. In
 * a top bar it is navigation, and seven items in a row reads as a site map
 * rather than a route through the page. `#overview` is what the wordmark links
 * to, and `#output` still renders — it is simply reached by scrolling.
 */

export interface NavLink {
  id: string;
  label: string;
}

export interface NavExternalLink {
  href: string;
  label: string;
}

export const TOC_LINKS: readonly NavLink[] = nav.sections;

/** Just the ids, for the scroll-spy's IntersectionObserver. */
export const SECTION_IDS: readonly string[] = TOC_LINKS.map((link) => link.id);

/** Rendered after the TOC, past a divider, each with the 45° arrow. */
export const TOC_EXTERNAL_LINKS: readonly NavExternalLink[] = nav.external.map(
  (entry) => ({ href: linkFor(entry.link), label: entry.label })
);

/*
 * `.toc-inner` child count, asserted here because the responsive stagger below
 * the mobile breakpoint is keyed to it with :nth-child rules. Adding a link
 * without updating the stagger leaves the new one un-animated; the constant
 * exists so the CSS has something to be checked against rather than a number
 * nobody remembers.
 *
 * Currently 5: 3 sections, the divider, and 1 external link. The CSS carries
 * rules up to :nth-child(8), so there is headroom before it needs touching.
 */
export const TOC_CHILD_COUNT = TOC_LINKS.length + TOC_EXTERNAL_LINKS.length + 1;
