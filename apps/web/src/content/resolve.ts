import site from "#/content/site.json";

/*
 * The two things every copy file needs from every other one.
 *
 * The page's prose lives in `content/*.json` so it can be edited without opening
 * a component — but prose is not self-contained. The hero quotes the install
 * command, the install steps quote the Node version, the footer and the nav
 * quote URLs, and every one of those also appears in site.json. Copying the
 * literal into each file is how a page ends up advertising two different
 * versions of the same command.
 *
 * So JSON carries references instead of values, and this file is the only place
 * that turns one into the other:
 *
 *   "npx {{installCommand}}"          → fill()     → the real command
 *   { "link": "github", … }           → linkFor()  → the real URL
 *
 * Both throw on an unknown key rather than degrading. A typo'd token would
 * otherwise ship to a visitor as the literal text `{{nodeVerison}}`, and a
 * typo'd link key as `undefined` in an href — failures that are invisible in
 * review and obvious in production. Module-load is the right time to find out.
 */

export type LinkKey = keyof typeof site.links;

const TOKENS: Readonly<Record<string, string>> = {
  installCommand: site.installCommand,
  name: site.name,
  nodeVersion: site.nodeVersion,
  origin: site.origin,
  tagline: site.tagline,
};

const TOKEN_PATTERN = /\{\{(\w+)\}\}/g;

/** Substitute every `{{token}}` in a copy string. */
export function fill(text: string): string {
  return text.replace(TOKEN_PATTERN, (_whole, key: string) => {
    const value = TOKENS[key];
    if (value === undefined) {
      throw new Error(
        `content: unknown token {{${key}}}. Known tokens: ${Object.keys(TOKENS).sort().join(", ")}`
      );
    }
    return value;
  });
}

/** Resolve a `link` key from a copy file to its URL in site.json. */
export function linkFor(key: string): string {
  const url = (site.links as Record<string, string>)[key];
  if (url === undefined) {
    throw new Error(
      `content: unknown link "${key}". Known links: ${Object.keys(site.links).sort().join(", ")}`
    );
  }
  return url;
}

/**
 * Narrow a string from JSON to one of a known set of literals.
 *
 * `resolveJsonModule` widens every string in a JSON file to `string`, so a field
 * that is a union in TypeScript — a token's `kind`, a card's `figure` — arrives
 * untyped and unchecked. This restores both: the return type is the union, and
 * an unrecognised value throws instead of silently rendering an element with a
 * class nobody styled.
 */
export function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  field: string
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `content: "${value}" is not a valid ${field}. Expected one of: ${allowed.join(", ")}`
  );
}
