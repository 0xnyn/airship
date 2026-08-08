import type { ReactNode } from "react";

/**
 * The wallpaper the hero's window sits on: a full-bleed band, edge to edge.
 *
 * It used to carry a menu bar and a dock as well, and was boxed at 800px with
 * rounded corners so the three together read as a screenshot of a Mac. Once the
 * band spans the viewport that conceit stops working — chrome authored at 8.5px
 * to be seen inside a shrunken desktop is simply small type at 1:1 — so the
 * wallpaper now stands on its own and the window is the only thing on it.
 *
 * `overflow: clip` stays: nothing overhangs any more, but it is what guarantees
 * a full-width band can never produce a horizontal scrollbar.
 *
 * The cursor is still rendered as a SIBLING of this element rather than as a
 * child — see the comment in hero-stage.tsx, which owns that constraint.
 */
export function DesktopBackdrop({ children }: { children: ReactNode }) {
  return <div className="desktop-bg">{children}</div>;
}
