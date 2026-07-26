// @airship/editor-tokens — the visual editor's design source of truth,
// generated from /packages/editor-tokens/EDITOR.md. Independent of the `--pk-*`
// marketing tokens used by the examples: its own source, its own `--ap-*` CSS
// namespace, its own vendored fonts.
// Consumers: the overlay (bundles buildCss for its scoped root) and the server
// (serves the self-hosted woff2 from ./fonts/*).

export type { BuildCssOptions } from "./css";
export { buildCss, css, cssVar } from "./css";
export type { EditorDesign } from "./editor";
export { editor } from "./editor";
export type { Design } from "./generated/editor";
export { design } from "./generated/editor";
