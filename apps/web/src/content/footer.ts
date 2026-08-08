import footer from "#/content/footer.json";
import { fill, linkFor } from "#/content/resolve";

/*
 * The footer's link columns.
 *
 * Short on purpose. The obvious move is four columns of eight — Product,
 * Company, Resources, Legal — but airship is a CLI in one repository, and every
 * one of those columns would have to be filled with pages that do not exist.
 * These are the links that resolve today.
 *
 * Two entries in site.json's `links` are deliberately NOT referenced here.
 * Both now name the right thing and still do not resolve: `license` points at
 * /blob/main/LICENSE, which the repo has, but the repo is not public yet; `npm`
 * points at @airshiplabs/cli, which is the package apps/cli publishes but has
 * not published. A footer is the worst place to keep a dead link — it is the
 * part of a page people trust to be boringly correct. Add them back to
 * footer.json once the repo is public and the first version is on npm.
 */

export interface FooterLink {
  href: string;
  label: string;
}

export interface FooterColumn {
  id: string;
  links: readonly FooterLink[];
  title: string;
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = footer.columns.map(
  (column) => ({
    id: column.id,
    links: column.links.map((link) => ({
      href: linkFor(link.link),
      label: link.label,
    })),
    title: column.title,
  })
);

export const FOOTER = {
  /*
   * The only prose the footer carries. There was a bottom bar under the wordmark
   * restating "runs entirely on localhost" and the Node version; both are
   * already said where they matter — the first in the FAQ that is actually about
   * it, the second in the install steps you read before running anything — and a
   * footer repeating them was just the page clearing its throat on the way out.
   */
  blurb: fill(footer.blurb),
};
