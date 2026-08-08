/*
 * The glyphs the hero's miniature editor draws.
 *
 * Hand-authored, NOT imported from @airship/editor-icons. That package vendors
 * an upstream UI icon set — appropriate inside a local dev tool that is
 * deliberately imitating a design tool's affordances, but a different
 * distribution posture from serving them to every visitor of a public marketing
 * page. These are simple geometric stand-ins drawn against the same 24×24 box,
 * and at the mock's render scale (~0.58) they read as shapes rather than as
 * anybody's artwork.
 *
 * Conventions, all inherited from the real set so the mock composes the same:
 *   - 24×24 viewBox, artwork inset to roughly 4..20 (the optical inset that
 *     makes a 24px icon sit correctly beside a 24px control).
 *   - Stroked, not filled, at 1.5 — except `logo`, which is the real brand mark
 *     and is filled.
 *   - `currentColor` throughout; colour is the caller's business.
 *
 * The one glyph here that is NOT a stand-in is `logo`: it carries the exact path
 * from assets/logo.svg, which is the geometry of record. If that file changes,
 * this string changes with it.
 */

export type GlyphName = keyof typeof GLYPHS;

export interface Glyph {
  /** Inner markup, already using currentColor. */
  body: string;
  /** True when the artwork is filled rather than stroked. */
  filled?: boolean;
}

const stroke = (d: string): Glyph => ({
  body: `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
});

export const GLYPHS = {
  alignBottom: stroke("M4 19h16M8 9v7M16 5v11"),
  alignCenterH: stroke("M12 4v16M8 8h8M6 16h12"),
  alignCenterV: stroke("M4 12h16M8 8v8M16 6v12"),

  /* ── the nine align-row cells ─────────────────────────────────────── */
  alignLeft: stroke("M5 4v16M8 8h7M8 16h11"),
  alignRight: stroke("M19 4v16M9 8h7M5 16h11"),
  alignTop: stroke("M4 5h16M8 8v7M16 8v11"),
  /** Blend / layer mode. */
  blend: stroke("M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 4v16a8 8 0 0 0 0-16z"),

  /* ── the terminal beat ────────────────────────────────────────────── */
  /** The filled dot that opens a tool-call row, matching the overlay. */
  bullet: {
    body: '<circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.9"/>',
    filled: true,
  },

  /* ── inspector section chevrons ───────────────────────────────────── */
  chevronDown: stroke("M7 10l5 5 5-5"),
  chevronRight: stroke("M10 7l5 5-5 5"),
  chevronUp: stroke("M7 14l5-5 5 5"),
  /** Clip content / overflow. */
  clip: stroke("M5 5h14v14H5zM9 9h10M9 9v10"),
  code: stroke("M9 8l-4 4 4 4M15 8l4 4-4 4"),
  /** Independent corners, the toggle beside a quad field. */
  corners: stroke("M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"),

  /* ── bottom bar tools ─────────────────────────────────────────────── */
  /** Move / select arrow. The default tool. */
  cursor: {
    body: '<path d="M6 4l12 7-5 1.4L10.5 18z" fill="currentColor" fill-opacity="0.9"/>',
    filled: true,
  },

  /* ── inspector tabs ───────────────────────────────────────────────── */
  design: stroke("M5 19l3-1 9.5-9.5-2-2L6 16zM15 7l2 2M5 5h6"),
  distributeH: stroke("M5 5v14M19 5v14M10.5 8v8h3V8z"),
  distributeV: stroke("M5 5h14M5 19h14M8 10.5h8v3H8z"),
  /** Edit mode — the pencil half of the Edit|View toggle. */
  edit: stroke("M16.5 5.5l2 2L9 17l-3 1 1-3zM15 7l2 2"),
  /** The ⎿ elbow that introduces a tool result. */
  elbow: stroke("M8 5v11h8"),
  /** Hide a row. */
  eye: stroke(
    "M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
  ),
  /** Hand, for the view-mode tool group. */
  hand: stroke(
    "M9 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-2.5a1.5 1.5 0 0 1 3 0"
  ),
  /** Inspect / pick an element. */
  inspect: stroke(
    "M5 5h4M5 5v4M19 5h-4M19 5v4M5 19h4M5 19v-4M19 19h-4M19 19v-4"
  ),
  layers: stroke("M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"),
  /*
   * The brand mark. Same path as assets/logo.svg and the `logo` entry in
   * packages/overlay/src/icons.ts — three copies of one geometry, which must be
   * changed together. Filled, with the 0.9 opacity the original carries.
   */
  logo: {
    body: '<path d="M12 5.1L20 18.9H15.47L9.73 9.01ZM7.47 12.92H12L8.53 18.9H4Z" fill="currentColor" fill-opacity="0.9"/>',
    filled: true,
  },
  /** Remove a row. */
  minus: stroke("M6 12h12"),
  /** Opacity — the checkerboard-and-square mark. */
  opacity: stroke(
    "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 4v16M12 7h4M12 11h6M12 15h6"
  ),
  /** Collapse the dock. */
  panelRight: stroke("M5 5h14v14H5zM15 5v14"),
  /** Add a row. */
  plus: stroke("M12 6v12M6 12h12"),

  /* ── inspector control glyphs ─────────────────────────────────────── */
  /** Corner radius. The classic quarter-round with a tick. */
  radius: stroke("M5 19v-8a6 6 0 0 1 6-6h8M5 5h.01M19 19h.01"),
  /** Reset panel width. */
  reset: stroke("M8 8H5V5M5.5 8.5a7 7 0 1 1-1 5"),
  /** Rotation. */
  rotation: stroke("M12 5a7 7 0 1 1-6.3 4M5 5v4h4"),

  /* ── dock chrome ──────────────────────────────────────────────────── */
  /** The right dock's header mark, beside the word "Design". */
  settings: stroke(
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l1.6-1.2-1.7-3-1.9.7a7 7 0 0 0-2-1.2L14.6 4h-3.4l-.3 2a7 7 0 0 0-2 1.2l-2-.7-1.7 3 1.6 1.2A7 7 0 0 0 6.7 12"
  ),
  /** Text tool. */
  text: stroke("M6 6h12M12 6v12M9.5 18h5"),
  tidy: stroke("M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z"),
  /** The token badge — "this value is a design token". */
  token: stroke("M12 4l7 4v8l-7 4-7-4V8zM12 12l7-4M12 12v8M12 12L5 8"),
  /** Undo. Redo is the same mark flipped with scaleX(-1). */
  undo: stroke("M8 8H5V5M5.5 8.5a7 7 0 1 1-1 5"),
  /** View mode — the eye half. */
  view: stroke(
    "M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
  ),
} as const satisfies Record<string, Glyph>;
