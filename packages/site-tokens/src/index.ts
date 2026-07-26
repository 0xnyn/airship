// @airship/site-tokens — the marketing site's design source of truth, generated
// from the DESIGN.md front-matter at this package's root (see scripts/gen.mjs).
// Sole consumer: apps/web, which imports ./tokens.css + ./fonts.css and maps
// the `--pk-*` variables into Tailwind's theme with `@theme inline`.
//
// One palette, not two: the page has a single intended look and there is no
// theme to switch between, so ./tokens.css is a single `:root` block.
//
// Distinct from @airship/editor-tokens (`--ap-*`), which is the *editor's*
// palette: dark chrome, generated from EDITOR.md by the same pipeline shape.
// The two namespaces cannot collide. apps/web does consume both — the hero
// recreates the editor in miniature — but the editor palette reaches it as
// ./editor-mock.css, a scoped block this package's postbuild emits so a dark
// chrome palette can never leak onto the light marketing page.

export type { CssOptions } from "./css";
export { buildCss, css, cssVar } from "./css";
export { design } from "./generated/design";
export type {
  ElevationToken,
  LayoutToken,
  MotionToken,
  PaletteColor,
  RadiusToken,
  RoleSpec,
  SemanticColor,
  SpacingToken,
  TypographyRole,
} from "./tokens";
export {
  colors,
  elevation,
  fonts,
  layout,
  motion,
  radius,
  semantic,
  spacing,
  typography,
} from "./tokens";
