/*
 * CSS Grid track editing, in Layout Grid vocabulary.
 *
 * Layout Grid has three types — Columns, Rows, and Grid (uniform) — each
 * with a count, a size, a gutter and a margin. The mapping is close enough to be
 * worth keeping:
 *
 * | Layout Grid  | CSS                                              |
 * |--------------|--------------------------------------------------|
 * | Columns, N   | `grid-template-columns: repeat(N, <size>)`        |
 * | Rows, N      | `grid-template-rows: repeat(N, <size>)`           |
 * | Uniform      | `repeat(auto-fill, minmax(<size>, 1fr))`          |
 * | Gutter       | `gap`                                            |
 * | Margin       | `padding`                                        |
 *
 * The one place it stops being a rename is `Stretch` vs a fixed width: its
 * stretch columns are `1fr`, and a fixed one is a length — which is why `size`
 * here is a raw CSS track size rather than a number.
 */

export type TrackKind = "columns" | "rows" | "uniform";

export interface TrackSpec {
  count: number;
  kind: TrackKind;
  /** A CSS track size: `1fr`, `120px`, `minmax(80px, 1fr)`. */
  size: string;
}

const REPEAT = /^repeat\(\s*(\d+|auto-fill|auto-fit)\s*,\s*(.+)\s*\)$/;

/**
 * Read a `grid-template-*` value back into the editor's model.
 *
 * Anything that is not a plain `repeat()` — an explicit track list, named lines,
 * `subgrid` — returns `null` rather than being mangled into the nearest
 * repeat. The panel shows the raw value in that case, because silently
 * rewriting someone's hand-tuned track list is worse than not offering to.
 */
export function parseTracks(css: string, kind: TrackKind): TrackSpec | null {
  const value = css.trim();
  if (!value || value === "none") {
    return { count: 0, kind, size: "1fr" };
  }
  const m = REPEAT.exec(value);
  if (!m) {
    return null;
  }
  const [, countRaw, size] = m;
  if (countRaw === "auto-fill" || countRaw === "auto-fit") {
    return { count: 0, kind: "uniform", size: size.trim() };
  }
  return { count: Number(countRaw), kind, size: size.trim() };
}

/** The `grid-template-*` value for a spec. */
export function formatTracks(spec: TrackSpec): string {
  if (spec.kind === "uniform") {
    const inner = spec.size.startsWith("minmax(")
      ? spec.size
      : `minmax(${spec.size}, 1fr)`;
    return `repeat(auto-fill, ${inner})`;
  }
  if (spec.count < 1) {
    return "none";
  }
  return `repeat(${spec.count}, ${spec.size})`;
}

/** Which property a track kind writes. Uniform is always columns. */
export function trackProperty(kind: TrackKind): string {
  return kind === "rows" ? "grid-template-rows" : "grid-template-columns";
}
