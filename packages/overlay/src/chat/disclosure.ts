/**
 * A collapsible row: an always-visible header button plus a hidden body.
 *
 * Deliberately not `<details>/<summary>`, even though that is the obvious
 * choice. The overlay injects into the host page with no shadow root, so host
 * stylesheets reach our nodes — and `<summary>` carries UA *behaviour*
 * (`display: list-item`, the disclosure marker) that resets like Tailwind's
 * preflight routinely override. Worse, `<summary>` is an activation target:
 * every nested button toggles the disclosure unless it stops the event, which
 * is exactly the footgun for the action buttons a tool row wants to grow.
 *
 * A button + div reproduces the same semantics — `aria-expanded`, keyboard
 * operation, screen-reader announcement — in a shape host CSS can't surprise,
 * and matches the disclosure idiom already used by the design inspector.
 */
import { cls, el } from "../dom";

export interface Disclosure {
  /** The collapsible region. Nested interactive elements are safe here. */
  body: HTMLElement;
  /** The always-visible header row. */
  head: HTMLElement;
  isOpen: () => boolean;
  root: HTMLElement;
  setOpen: (open: boolean) => void;
}

export function disclosure(opts: {
  /** Class for the collapsible region. Defaults to the timeline's `tl-body`. */
  bodyClass?: string;
  /** Extra classes for the root, beyond `tl-row`. */
  class?: string;
  head: (HTMLElement | string)[];
  /** Class for the header row. Defaults to the timeline's `tl-head`. */
  headClass?: string;
  /**
   * Fired whenever the open state settles, including once at construction.
   *
   * A timeline row needs no chevron — its status dot is the affordance — so
   * this primitive draws none. Anything that *does* need one (a collapsed file
   * diff reads as inert without it) owns the glyph and swaps it from here,
   * rather than this growing a chevron option only some callers want.
   */
  onToggle?: (open: boolean) => void;
  open?: boolean;
  /** When false, the header renders as plain text with no toggle affordance. */
  toggleable?: boolean;
}): Disclosure {
  const toggleable = opts.toggleable !== false;
  let open = Boolean(opts.open) && toggleable;

  const body = el("div", { class: opts.bodyClass ?? cls("tl-body") });
  const head = el(
    toggleable ? "button" : "div",
    {
      class: opts.headClass ?? cls("tl-head"),
      ...(toggleable ? { "aria-expanded": String(open), type: "button" } : {}),
    },
    opts.head
  );

  const root = el(
    "div",
    { class: opts.class ? `${cls("tl-row")} ${opts.class}` : cls("tl-row") },
    [head]
  );

  const sync = (): void => {
    if (!toggleable) {
      return;
    }
    head.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!body.isConnected) {
        root.append(body);
      }
    } else {
      body.remove();
    }
    opts.onToggle?.(open);
  };

  if (toggleable) {
    head.addEventListener("click", () => {
      open = !open;
      sync();
    });
  }
  sync();

  // A click on anything inside the body must not bubble to a parent row's
  // header and collapse the thing the user is reading.
  body.addEventListener("click", (e) => e.stopPropagation());

  return {
    body,
    head,
    isOpen: () => open,
    root,
    setOpen(next: boolean): void {
      if (!toggleable) {
        return;
      }
      open = next;
      sync();
    },
  };
}
