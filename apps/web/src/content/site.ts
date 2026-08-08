import site from "#/content/site.json";

/*
 * The product's primitives, read from site.json.
 *
 * Unlike the marketing example this app replaces, nothing here is invented:
 * airship is a real tool in this repository, and every claim below is one the
 * README and apps/cli/src/index.ts actually support. If a capability changes,
 * site.json changes with it.
 *
 * This module is the typed face of that file — it exists so the rest of the app
 * imports named constants rather than reaching into a JSON blob, and so the
 * shape is checked once here instead of at every call site.
 */

export interface Site {
  description: string;
  name: string;
  /**
   * Only used for absolute URLs in metadata (canonical, OG image, sitemap).
   * Relative URLs are correct everywhere else and survive being served from a
   * preview deployment; these do not, which is why there is exactly one.
   */
  origin: string;
  tagline: string;
}

export const SITE: Site = {
  description: site.description,
  name: site.name,
  origin: site.origin,
  tagline: site.tagline,
};

/*
 * Every off-site URL in one place, so a dead link is one edit rather than a grep.
 *
 * NOTE: `license` and `npm` are currently dead — there is no LICENSE file in the
 * repo, and apps/cli is `"private": true` at 0.0.0 so nothing is published under
 * that name. They are kept as the registry's record of where those things will
 * live; nothing renders them today, and the footer deliberately does not.
 */
export const EXTERNAL_LINKS = site.links;

/** The one command quoted in more than one place. */
export const INSTALL_COMMAND: string = site.installCommand;

/**
 * The minimum Node the CLI declares in its engines field. Quoted in the compat
 * line and in the FAQ; if apps/cli bumps it, site.json is the place to follow.
 */
export const NODE_VERSION: string = site.nodeVersion;
