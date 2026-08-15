/*
 * The overlay's tooltips.
 *
 * Native `title` was doing this job, and it cannot: it opens after ~1s, cannot
 * be styled, and — the reason this exists — cannot show a keyboard shortcut.
 * Design-tool tooltips carry their own shortcut, and that is a real part of why the
 * app feels like someone cared rather than like a prototype.
 *
 * One delegated listener and one shared element, not a tooltip per control:
 * every icon button in the editor would otherwise be an extra DOM node and an
 * extra pair of listeners for something shown a few hundred milliseconds at a
 * time.
 */
import { cls, el } from "./dom";
import type { CommandId } from "./keys/catalog";
import { keys } from "./keys/registry";
import { clamp } from "./num";
import { placePopover, type Side } from "./popover";

/** Breathing room between the tip and the edge of the panel it sits in. */
const MARGIN = 6;
/** How long a pointer must rest before a tooltip opens. */
const DELAY = 400;
/**
 * Once one tooltip has been shown, the next opens instantly for this long. This
 * is what makes scanning a toolbar feel responsive instead of like waiting out
 * the delay once per button.
 */
const CHAIN = 500;

export class Tooltips {
  private readonly node: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastShown = 0;
  private current: HTMLElement | null = null;

  /**
   * `host` is the popover host — the overlay root's last child. It is not the
   * chrome layer, which shares the root's `z-index` but is appended before it
   * and therefore paints *under* the docks: mounted there, a tooltip anchored to
   * any control inside a panel was drawn behind that panel and never seen.
   */
  constructor(host: HTMLElement) {
    this.node = el("div", { class: `${cls("tip")} ${cls("hidden")}` });
    host.append(this.node);
    document.addEventListener("pointerover", this.onOver, true);
    document.addEventListener("pointerdown", this.hide, true);
    document.addEventListener("pointerout", this.onOut, true);
    // Capture, because scrolls inside `.insp-body` do not bubble to `window` —
    // the same reason `popover-host`'s reflow listener is registered this way.
    window.addEventListener("scroll", this.onScroll, true);
    // A tooltip left open over a control that just disappeared (a re-render,
    // a section collapse) would hang there with nothing under it.
    window.addEventListener("blur", this.hide);
  }

  destroy(): void {
    document.removeEventListener("pointerover", this.onOver, true);
    document.removeEventListener("pointerdown", this.hide, true);
    document.removeEventListener("pointerout", this.onOut, true);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("blur", this.hide);
    this.clearTimer();
    this.node.remove();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private readonly hide = (): void => {
    this.clearTimer();
    this.current = null;
    this.node.classList.add(cls("hidden"));
  };

  private readonly onOver = (e: Event): void => {
    const target = (e.target as Element | null)?.closest?.("[data-tip]");
    if (!(target instanceof HTMLElement)) {
      if (this.current) {
        this.hide();
      }
      return;
    }
    if (target === this.current) {
      return;
    }
    this.clearTimer();
    this.current = target;
    const wait = Date.now() - this.lastShown < CHAIN ? 0 : DELAY;
    this.timer = setTimeout(() => this.show(target), wait);
  };

  /**
   * The pointer left the window.
   *
   * Hiding was driven entirely by `pointerover` of something *else*, and leaving
   * the window fires no such event — so a tip stayed up over a control the
   * pointer had long since left. A null `relatedTarget` is that exit; moves
   * between children carry one and `onOver` already handles them.
   */
  private readonly onOut = (e: Event): void => {
    if (!(e as PointerEvent).relatedTarget) {
      this.hide();
    }
  };

  /**
   * Hide rather than follow.
   *
   * `.insp-body` scrolls, so the control slides out from under its own tip —
   * and because `onOver` early-returns while the same element is under the
   * pointer, nothing ever re-placed it. A tooltip is a fact about where the
   * pointer is resting; the next `pointerover` re-earns it. Following would also
   * have to notice the anchor leaving the panel's clipped body, which is more
   * machinery than a 400ms label is worth.
   */
  private readonly onScroll = (): void => {
    if (this.current || this.timer !== null) {
      this.hide();
    }
  };

  private show(target: HTMLElement): void {
    const text = target.dataset.tip;
    if (!(text && target.isConnected)) {
      return;
    }
    // The class is a contract, not decoration: it is what the line clamp in
    // `pop.css.ts` targets, and a bare span would wrap without ever clamping.
    this.node.replaceChildren(el("span", { class: cls("tip-text"), text }));

    // The shortcut is looked up by the control's `data-key`, which is a
    // `CommandId`. It used to be looked up by the tooltip's own *text* — elegant
    // right up until someone reworded a tooltip, at which point the chip
    // silently vanished with nothing failing, or until two commands wanted the
    // same name and one of them shadowed the other's chord. `tooltip.copy.test.ts`
    // existed to freeze thirteen spellings by hand against exactly that, and it
    // was missing four of them. The compiler holds this instead.
    const id = target.dataset.key as CommandId | undefined;
    const hint = id ? keys.hint(id) : null;
    if (hint) {
      this.node.append(el("span", { class: cls("tip-key"), text: hint }));
    }

    this.node.classList.remove(cls("hidden"));
    this.place(target.getBoundingClientRect());
    this.lastShown = Date.now();
  }

  /** Centred on the control, kept inside the panel it belongs to. */
  private place(anchor: DOMRect): void {
    /*
     * Measured from a known origin.
     *
     * `placePopover` writes a `left` and never clears it, and an absolutely
     * positioned box with `left` set has only `containing block - left` to lay
     * out in. The host is `inset: 0`, so a tip last placed near the right edge
     * measures against the sliver beyond it: the text wraps into a narrow column
     * and `offsetWidth` reports the column. Under the old `nowrap` this was
     * invisible — min-content and max-content were the same number, so the box
     * never shrank — which is why it surfaces now and not before.
     */
    this.node.style.left = "0px";
    const w = this.node.offsetWidth;
    const bounds = this.bounds();
    /*
     * Clamped to the dock first, the viewport second.
     *
     * A tip on a caret at the right edge of a 360px panel is inside the window
     * and still outside the panel — hanging past a rounded border with nothing
     * under it, which reads as a bug rather than as that control's label. Doing
     * this here rather than in `placePopover` keeps the canvas's world-space
     * menus, which share that function, out of it.
     */
    const left = clamp(
      anchor.left + anchor.width / 2 - w / 2,
      bounds.left + MARGIN,
      bounds.right - w - MARGIN
    );
    /*
     * `placePopover` owns the vertical, and the horizontal clamp of last resort.
     *
     * This used to be bespoke: always 6px below, flipping only when the tip ran
     * past `window.innerHeight` — it never asked whether the space it flipped
     * *into* was any bigger — and never converting through the offset parent.
     * The rect handed over is the anchor's box slid to the left chosen above, so
     * the default `align: "start"` reproduces "centred on the control".
     */
    placePopover(
      this.node,
      new DOMRect(left, anchor.top, w, anchor.height),
      this.side(),
      { scroll: false }
    );
  }

  /** The panel the anchor belongs to, or the viewport for chrome outside one. */
  private bounds(): DOMRect {
    const rect = this.current
      ?.closest(`.${cls("dock")}`)
      ?.getBoundingClientRect();
    return rect ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /**
   * Above inside the inspector body, below everywhere else.
   *
   * The panel is the one place in the editor where full-width controls stack six
   * pixels apart, so a tip placed below a row lands squarely on the next one —
   * the control you are on your way to. The rows above it are values you have
   * already read. Toolbars and canvas chrome keep "below", where the space under
   * the control is empty.
   */
  private side(): Side {
    return this.current?.closest(`.${cls("insp-body")}`) ? "above" : "below";
  }
}
