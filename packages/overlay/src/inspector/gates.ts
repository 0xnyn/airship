/*
 * The questions that decide whether a control exists at all.
 *
 * Three sections hide a whole row when the element does not have the thing the
 * row edits — the design-tool behaviour, and the right one: a Fill section showing
 * `000000 / 0%` for every unstyled div is technically true and reads as a bug.
 * The problem was never the hiding, it was who was allowed to answer.
 *
 * Two rules, and both were broken:
 *
 * 1. **The panel has to know these can flip.** `shapeKey` decides whether a
 *    refresh re-seeds or rebuilds, and none of these were in it — so a control
 *    could stop being appropriate and the panel would go on showing it until
 *    something unrelated forced a rebuild, at which point it vanished with no
 *    apparent cause.
 *
 * 2. **A pending edit counts.** These read computed style, and the value the
 *    user just set is exactly what can make the answer `false`: picking a
 *    colour token whose `var()` did not resolve blanked `background-color`, so
 *    the fill row deleted itself the moment it was bound. A property with an
 *    edit queued against it keeps its control, whatever that edit resolved to
 *    on screen — otherwise the panel takes away the control you are using to
 *    fix the thing you just did.
 *
 * Hence `Reader`: the caller composes "pending, then computed" once and every
 * gate asks the same question the same way.
 *
 * These are the *element* half of the four colour predicates — "does this node
 * have a fill at all", not "is this string a colour". `isParseableColor` in
 * `css-value.ts` lists all four and says which question each answers.
 */
import { alphaOf } from "./css-value";

/** How a gate reads a property. Pending value first, computed style behind it. */
export type Reader = (property: string) => string;

/**
 * Does this element have a background worth showing a Fill row for?
 *
 * `node` is the element the value was read from, and it is here because the
 * answer can depend on which document resolves it. A pending edit can be
 * `var(--brand)`, and `alphaOf` reaches `parseColor`'s engine probe to read it —
 * against the overlay shell, where `--brand` is undefined, unless it is told
 * otherwise. That returned the shell's inherited colour at alpha 1, so an
 * unresolvable token read as a fill and the row stayed. Optional because the
 * gates are pure functions of a `Reader` and the tests exercise them that way.
 */
export function hasFill(read: Reader, node?: Element): boolean {
  const color = read("background-color");
  if (!color) {
    return false;
  }
  // `transparent` never comes back from computed style — it resolves to
  // `rgba(0, 0, 0, 0)` — but it is exactly what a pending "remove fill" writes,
  // so both spellings have to be understood here.
  return color.trim() !== "transparent" && alphaOf(color, node) > 0;
}

/** The four edges, so a gate never speaks for the box from one of them. */
const EDGES = ["top", "right", "bottom", "left"];

/**
 * Does this element have a border to show a Stroke row for?
 *
 * All four edges, not just the top. `border-top-style` alone meant
 * `.header { border-bottom: 1px solid #eee }` — the canonical divider — reported *no*
 * stroke, so `sections/stroke.ts` emptied the whole section and left a `+` that, when
 * clicked, wrote a border on all four sides. There was no way to see or edit the bottom
 * border from the Design tab at all.
 */
export function hasStroke(read: Reader): boolean {
  return EDGES.some((edge) => {
    const style = read(`border-${edge}-style`);
    return Boolean(style) && style !== "none" && style !== "hidden";
  });
}

const BOUND_PROPERTIES = ["min-width", "min-height", "max-width", "max-height"];

/**
 * Is any min/max constraint actually set?
 *
 * Anything that is not one of the "unset" keywords counts. The test used to be
 * `Number.parseFloat(value) > 0`, which is `NaN` for every value that does not *start*
 * with a digit — so `max-width: calc(100% - 2rem)` and `max-width: fit-content` both
 * reported no bounds. The min/max grid was then hidden, and `shapeKey` agreed with it,
 * so it never appeared: the only way to discover a bound that was already set was to
 * press `+` and watch a populated field appear.
 */
export function hasBounds(read: Reader): boolean {
  return BOUND_PROPERTIES.some((property) => {
    const value = read(property).trim();
    if (!value || value === "none" || value === "auto") {
      return false;
    }
    // A literal zero is not a constraint; anything else — a length, a keyword, a
    // `calc()`, a `var()` — is.
    const asNumber = Number.parseFloat(value);
    return Number.isNaN(asNumber) || asNumber > 0;
  });
}
