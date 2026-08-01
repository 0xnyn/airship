import { clamp } from "./num";

const MARGIN = 8;
const GAP = 6;

export type Side = "above" | "below";

export interface PlaceOptions {
  /**
   * Which edge tracks the anchor's. `start` pins left to left — right for a
   * dropdown as wide as its trigger. `end` pins right to right, which is what a
   * 232px colour picker hanging off a 22px swatch needs: aligned left it runs
   * straight off the side of a 360px dock.
   */
  align?: "end" | "start";
  /** Floor for the popover's width, so a menu is never narrower than readable. */
  minWidth?: number;
  /**
   * Cap the height to the room available and let the content scroll. True for
   * menus. The colour picker opts out — a squashed saturation/value area near a
   * viewport edge is worse than one that flips.
   */
  scroll?: boolean;
}

function flip(side: Side): Side {
  return side === "above" ? "below" : "above";
}

/**
 * Place a popover next to `anchor` (a screen rect), flipping and clamping so it
 * stays on screen.
 *
 * Declaring the side in CSS is not enough. A frame can sit anywhere on an
 * infinite canvas, so a menu pinned to `bottom: 100%` opens off the top of the
 * window the moment its anchor is near the top edge — which is exactly where a
 * frame ends up after zoom-to-fit. The menu has to look at where it actually is.
 *
 * The maths is done in screen space and converted back at the end against the
 * popover's *offset parent* — which is not the same element as the anchor. A
 * frame's menu hangs off its title bar but is positioned inside the frame's
 * chrome box, and using the anchor for both puts it out by the gap between them.
 */
export function placePopover(
  menu: HTMLElement,
  anchor: DOMRect,
  prefer: Side,
  opts: PlaceOptions = {}
): void {
  const { align = "start", minWidth, scroll = true } = opts;

  if (minWidth) {
    menu.style.minWidth = `${minWidth}px`;
  }

  // Measure unconstrained, then cap to whatever room the chosen side has.
  menu.style.maxHeight = "";
  /*
   * Content plus the chrome around it, because the cap lands on the border box.
   *
   * Everything under the overlay root is `border-box` (`base.css.ts`), so a
   * `max-height` written here has to cover the border as well — but `scrollHeight`
   * is the content box and stops short of it. Capping straight to `scrollHeight`
   * left every scrollable popover exactly `borderTop + borderBottom` short of its
   * own content: a two-pixel overflow, and `.pop`'s `overflow-y: auto` duly drew a
   * scrollbar on menus with three rows in them. It also placed them two pixels off,
   * since `shown` is what the `above` case measures back from.
   *
   * `offsetHeight - clientHeight` rather than reading the border widths: it is the
   * same number without parsing two computed styles, and it stays right if the
   * shell ever grows a horizontal scrollbar.
   */
  const chrome = menu.offsetHeight - menu.clientHeight;
  const height = menu.scrollHeight + chrome;
  const width = menu.offsetWidth;

  const roomAbove = anchor.top - GAP - MARGIN;
  const roomBelow = window.innerHeight - anchor.bottom - GAP - MARGIN;
  // Flip only when the preferred side cannot hold it and the other side is
  // roomier — flipping into an even tighter space helps nobody.
  const wanted = prefer === "above" ? roomAbove : roomBelow;
  const other = prefer === "above" ? roomBelow : roomAbove;
  const side = height <= wanted || wanted >= other ? prefer : flip(prefer);

  const room = side === "above" ? roomAbove : roomBelow;
  // Unscrollable popovers keep their full height and rely on the clamp below to
  // stay on screen; scrollable ones give up height instead.
  const shown = scroll ? Math.min(height, Math.max(120, room)) : height;
  menu.style.maxHeight = scroll ? `${shown}px` : "";

  const top = side === "above" ? anchor.top - GAP - shown : anchor.bottom + GAP;

  let left = align === "end" ? anchor.right - width : anchor.left;
  const overflowRight = left + width - (window.innerWidth - MARGIN);
  if (overflowRight > 0) {
    left -= overflowRight;
  }
  left = Math.max(MARGIN, left);

  const parent = (
    menu.offsetParent ?? menu.parentElement
  )?.getBoundingClientRect();
  const originX = parent?.left ?? 0;
  const originY = parent?.top ?? 0;
  const clampedTop = clamp(top, MARGIN, window.innerHeight - MARGIN - shown);
  menu.style.left = `${Math.round(left - originX)}px`;
  menu.style.top = `${Math.round(clampedTop - originY)}px`;
}

/*
 * `createMenu` used to live here. It moved to `popover-host.ts`: a menu is a
 * *client* of the host, and leaving it here made this module import the host
 * that imports it back. What is left is the placement maths, which the host and
 * the canvas's own world-space menus both call and neither owns.
 */
