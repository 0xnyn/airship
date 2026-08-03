/*
 * The colours you just used, for the picker's bottom row.
 *
 * Module-level state on purpose. The design panel is clear-and-rebuild — every
 * control is destroyed and reconstructed on each selection change and on most
 * edits — so anything owned by a control cannot outlive the next click. A
 * module-scoped list is not a shortcut around that; it is the only place a
 * "recent" can live and still be recent.
 *
 * Deliberately *not* persisted. A colour from four sessions ago is a palette,
 * not a recent, and a palette you cannot name, reorder or delete is worse than
 * no palette at all. Dying with the page is the correct lifetime.
 */

const LIMIT = 10;

let recents: string[] = [];
const listeners = new Set<() => void>();

export function recentColors(): readonly string[] {
  return recents;
}

/**
 * Record a colour as most-recently-used.
 *
 * Call this on gesture *end* and on committed field edits — never per
 * pointermove, or a single sweep across the saturation square fills the whole
 * row with ten shades of the same colour and evicts everything else.
 */
export function pushRecentColor(css: string): void {
  const value = css.trim();
  if (!value) {
    return;
  }
  const next = [value, ...recents.filter((c) => c !== value)];
  recents = next.slice(0, LIMIT);
  for (const cb of listeners) {
    cb();
  }
}

/** Subscribe to changes. Returns a disposer. */
export function onRecentColorsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
