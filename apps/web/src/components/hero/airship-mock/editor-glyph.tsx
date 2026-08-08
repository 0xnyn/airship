import { GLYPHS, type GlyphName } from "#/content/editor-glyphs";

/**
 * Every glyph in the hero's editor, rendered from one place.
 *
 * `aria-hidden` is not a prop: the entire hero is an illustration, and there is
 * no glyph in it that carries meaning a screen reader should hear. Hard-coding
 * it here means `noSvgWithoutTitle` is satisfied once rather than at twenty call
 * sites, and it cannot be forgotten at the twenty-first.
 *
 * The body is injected as markup because the path data is vendored-shaped
 * constant text; turning it into JSX elements would buy nothing and would let
 * the formatter reflow coordinates that are meant to stay byte-stable.
 */
export function EditorGlyph({
  className,
  name,
  size = 24,
}: {
  className?: string;
  name: GlyphName;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GLYPHS is a
          module-level constant of literal SVG markup, keyed by a union type —
          there is no path through which caller input reaches this string. */}
      <g dangerouslySetInnerHTML={{ __html: GLYPHS[name].body }} />
    </svg>
  );
}
