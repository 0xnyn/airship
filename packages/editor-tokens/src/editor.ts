// Typed views over the generated editor design tokens. The values originate in
// /packages/editor-tokens/EDITOR.md front-matter (see scripts/gen.mjs); this
// module only re-shapes and types them for ergonomic consumption.
import { design } from "./generated/editor";

export const editor = design;

export type EditorDesign = typeof design;
