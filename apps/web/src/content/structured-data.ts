import { EXTERNAL_LINKS, NODE_VERSION, SITE } from "#/content/site";

/*
 * schema.org description of the product, for search engines and for the
 * summarizers that increasingly read a page before a person does.
 *
 * Every claim here is one the README supports. `offers` at zero is not a growth
 * tactic — airship is a local CLI with no account and no server, so "free" is
 * simply what it costs, and omitting the field invites the guess that it is
 * merely unpriced.
 */
export const SOFTWARE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  applicationCategory: "DeveloperApplication",
  codeRepository: EXTERNAL_LINKS.github,
  description: SITE.description,
  name: SITE.name,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  operatingSystem: `macOS, Linux, Windows (Node ${NODE_VERSION}+)`,
  softwareRequirements: `Node.js ${NODE_VERSION} or later, and one of Claude Code, OpenAI Codex or OpenCode`,
  url: SITE.origin,
} as const;
