// Typed views over the generated design tokens. The values originate in this
// package's ./DESIGN.md front-matter (see scripts/gen.mjs); this module only
// re-shapes and types them for ergonomic consumption.
import { design } from "./generated/design";

export const {
  colors,
  semantic,
  spacing,
  elevation,
  motion,
  typography,
  layout,
} = design;
export const radius = design.rounded;
export const fonts = design.typography.families;

export type SemanticColor = keyof typeof design.semantic;
export type PaletteColor = keyof typeof design.colors;
export type SpacingToken = keyof typeof design.spacing;
export type RadiusToken = keyof typeof design.rounded;
export type ElevationToken = keyof typeof design.elevation;
export type MotionToken = keyof typeof design.motion;
export type LayoutToken = keyof typeof design.layout;
export type TypographyRole = keyof typeof design.typography.roles;

export interface RoleSpec {
  family: "sans" | "mono";
  line: number;
  size: number;
  tracking: number;
  transform?: string;
  weight: number;
}
