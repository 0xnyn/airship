/*
 * The only stylesheet the editor injects into more than one document.
 *
 * Everything else in `styles/` is scoped to `#__airship-root` and lives in the
 * shell. These rules have to reach the *edited* node, which is a page node —
 * inside an iframe on the canvas, and in the host app's own body inline — so the
 * string is shared: `styles/index.ts` concatenates it into the overlay sheet,
 * and `frame-agent.ts` concatenates it into `FRAME_CSS`.
 *
 * **Colours are literals read from `design`, not `var(--ap-*)`, and that is not
 * laziness.** The token vars are scoped (see `VARS` in `styles/index.ts`) to the
 * root, the two chrome layers and the canvas viewport — and the edited node is
 * inside none of them, in *either* document. A `var(--ap-primary)` here would be
 * invalid at computed-value time and drop the declaration silently, in the shell
 * exactly as in a frame. Reading `design` keeps one source of truth without the
 * indirection that cannot work here.
 */
import { design } from "@airship/editor-tokens";
import { PREFIX } from "../dom";

/** The attribute `TextEditor` marks the node it is editing with. */
export const TEXT_EDIT_MARK = `data-${PREFIX}-text-edit`;

/** The attribute `DragGhost` marks its wrapper with — see `drag-ghost.ts`. */
export const GHOST_MARK = `data-${PREFIX}-ghost`;

/** The class the reorder controller puts on the node currently being dragged. */
export const DRAGGING_CLASS = `${PREFIX}-dragging`;

/** The class its siblings wear while they step aside — see `displace.ts`. */
export const DISPLACING_CLASS = `${PREFIX}-displacing`;

export const css = `
/* In-place text editing. Replaces the UA focus ring rather than removing it: an
   editable box with no ring at all is worse than a dark one, and the dark one is
   what this is here to get rid of.

   A 1px *inset* hairline, not a 2px ring. \`.__airship-sel-box\` on the chrome
   layer is already drawing a 2px primary outline around this same node, and two
   concentric primary rings read as a rendering bug. This one sits inside it and
   says "that box is a field now".

   \`user-select\` and \`cursor\` are restated because inline — and only inline —
   \`base.css\`'s edit-mode block sets them with \`!important\` on a selector
   carrying two ID-weight \`:not()\` arguments, which this would otherwise lose to.
   That block is taught to stand down on this attribute; the declarations here
   are the other half of the same handshake. */
[${TEXT_EDIT_MARK}] {
  outline: 1px solid ${design.primary.primary} !important;
  outline-offset: -1px !important;
  caret-color: ${design.primary.primary} !important;
  user-select: text !important;
  cursor: text !important;
}

/* \`TextEditor.begin\` selects the whole contents, so this band is the first thing
   you see. Without an explicit colour it renders in the UA's *inactive* palette —
   flat grey — whenever the owning document is not the focused one, which on the
   canvas is the normal case: the frame sits inert behind its capture plane and
   every gesture is handled in the shell's document.

   Background only. Overriding \`color\` too would fight the app's own type colour,
   and the point of editing in place is that it still looks like the app. The
   descendant selector is defensive — \`isEditableText\` forbids element children,
   but a browser inserts a \`<br>\` as soon as you press Enter. */
[${TEXT_EDIT_MARK}]::selection,
[${TEXT_EDIT_MARK}] *::selection {
  background-color: ${design.selection.fill};
}

/* The node currently being dragged.

   \`visibility: hidden\` and not \`opacity: .4\`, which is what this was. Both hide
   it, but only one of them keeps its box: the drag ghost shows where the element
   *is*, while the siblings around it animate into the space it is leaving, and
   that space has to be measurable. An element at 40% opacity still occupies its
   margins, its flex basis and its grid track — so the hole never opened and every
   displacement offset was computed against a layout that had not changed.

   It also happens to be free: a hidden element is skipped by
   \`elementFromPoint\`, which is the guarantee \`pointer-events: none\` was here to
   provide. That declaration stays anyway — the two are independent in the spec,
   and this one is load-bearing enough not to rest on a coincidence.

   A **class**, not an inline style. The node belongs to the host app, and a
   React render mid-drag rewrites inline styles while leaving class attributes it
   does not know about alone. */
.${DRAGGING_CLASS} {
  visibility: hidden !important;
  pointer-events: none !important;
}

/* Siblings opening a hole for the dragged element to land in.

   The offset itself is an inline \`transform\`, written per node by
   \`displace.ts\`; all this contributes is the easing, because a duration and a
   curve are the same for every sibling and do not belong in a loop.

   The curve is written out rather than referenced as \`var(--ap-motion-*)\`.
   These are the app's nodes, in the app's document, and the token variables are
   scoped to the editor's own roots — a \`var()\` that resolves to nothing here is
   invalid at computed-value time and takes the whole declaration with it,
   silently. Same reason the colours above are literals. */
.${DISPLACING_CLASS} {
  transition: transform ${design.motion["dur-base"]} ${design.motion["ease-out"]};
}

/* The drag ghost: a clone of the dragged element, living in that element's own
   document so the page's stylesheets still reach it.

   \`pointer-events\` has to be forced onto the descendants and not just the
   wrapper. \`none\` is inherited, but any child the app styles with
   \`pointer-events: auto\` overrides it and becomes hit-testable — and a ghost
   that answers \`elementFromPoint\` would have the drag resolving drop targets
   against the thing being dragged. */
[${GHOST_MARK}], [${GHOST_MARK}] * {
  pointer-events: none !important;
}`;
