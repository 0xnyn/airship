import hero from "#/content/hero.json";
import { fill } from "#/content/resolve";

export interface Hero {
  ctaHref: string;
  /**
   * The primary action is an in-page anchor, not a "try it here" button.
   *
   * The tool it would have to demo is a CLI that drives a coding agent against
   * files on your machine; there is nothing a marketing page can honestly wire
   * that button to. A button that fakes the product is worse than one that just
   * sends you to the install instructions, and the hero animation already shows
   * what the real thing does.
   */
  ctaLabel: string;
  /**
   * The small line above the heading, front-loading the compatibility fact.
   *
   * It ends on "Works with" because the agents that complete the sentence are
   * their own brand marks, not words — see `AGENT_MARKS`, which `HeroSection`
   * renders after this string.
   */
  eyebrow: string;
  heading: string;
  installCommand: string;
  sub: string;
}

export const HERO: Hero = {
  ctaHref: hero.ctaHref,
  ctaLabel: hero.ctaLabel,
  eyebrow: hero.eyebrow,
  heading: hero.heading,
  installCommand: fill(hero.installCommand),
  sub: hero.sub,
};
