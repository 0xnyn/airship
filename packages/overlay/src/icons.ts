/*
 * The overlay's icon renderer.
 *
 * Icons come from `@airship/editor-icons` — a vendored UI set plus a handful of
 * marks that set does not carry (the brand mark, a status dot, the two panel
 * toggles, the agent logos), all normalised at build time. See that package's
 * ICONS.md.
 *
 * Everything the renderer needs is already true of the registry: every glyph is
 * on a 24 box with its artwork centred at 12.8 units, so one `icon(name, "md")`
 * is one optical size everywhere and this file has no geometry left to do. That
 * was not always so — the marks below used to be authored here, by eye, against
 * a 16-unit inset the imported set did not share.
 */
import { EDITOR_ICONS, type EditorIconName } from "@airship/editor-icons";
import { design } from "@airship/editor-tokens";
import { cls, el } from "./dom";

export type IconName = EditorIconName;

/**
 * Named sizes, straight from the `--ap-icon-size-*` token group.
 *
 * Read from the tokens rather than restated here: this used to be a hand-copied
 * literal that happened to agree with them, which meant editing `EDITOR.md`
 * moved the CSS variables and changed nothing on screen — size is applied as SVG
 * `width`/`height` attributes, not in CSS, so this object is what actually
 * decides. Prefer the names over raw numbers so the scale stays swappable.
 */
const SIZES = design.iconSize;
export type IconSize = keyof typeof SIZES;

function resolve(name: IconName) {
  const found = EDITOR_ICONS[name];
  if (!found) {
    throw new Error(`icons: unknown icon "${name}"`);
  }
  return found;
}

/**
 * Is this string a registered icon slug?
 *
 * For the controls whose glyph slot takes *either* an icon or one or two
 * letters ("W", "H", "X", "B"). They used to decide with `glyph.length > 2`,
 * which is a heuristic that quietly breaks the day someone wants a three-letter
 * mark or adds a two-character slug.
 */
export function hasIcon(name: string): name is IconName {
  return name in EDITOR_ICONS;
}

/**
 * SVG markup for an icon, at a named size or an explicit pixel one.
 *
 * The raw number is for *artwork* — the empty state's watermark is 48px, which
 * is not a chrome size and should not be added to the scale to make one call
 * site compile. Chrome goes through {@link icon}, which takes named sizes only,
 * so a stray pixel number in a toolbar is a type error rather than the sort of
 * thing you find later by noticing one glyph looks bigger than its neighbours.
 */
export function iconSvg(
  name: IconName,
  size: IconSize | number = "md"
): string {
  const { box, body } = resolve(name);
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    `<svg width="${px}" height="${px}" viewBox="0 0 ${box} ${box}" fill="none" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** An inline-flex span wrapping the icon, for use as an element child. */
export function icon(name: IconName, size: IconSize = "md"): HTMLElement {
  return el("span", { class: cls("ic"), html: iconSvg(name, size) });
}
