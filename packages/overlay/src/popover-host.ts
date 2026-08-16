/*
 * The layer every anchored popover — and the tooltip — is drawn on.
 *
 * **Why a host at all.** A popover rendered next to its trigger is clipped
 * twice over: `.__airship-insp-body` is `overflow-y: auto` (and per spec
 * `overflow-x: visible` computes to `auto` when the other axis is not visible,
 * so it clips on *both*), and `.__airship-dock` is `overflow: hidden`. A
 * `position: absolute` menu inside the design panel is cut off at the section
 * edge and scrolls away with the content. It has to be parented somewhere that
 * is not inside either box.
 *
 * **Why inside `#__airship-root` rather than a sibling layer.** The obvious
 * choice — `ChromeLayer`, where the selection outlines live — is wrong, and
 * subtly so: it and the root carry the *same* `z-index`, and the root is
 * appended second, so the docks paint over it (see `chrome-layer.ts`, which
 * chose that on purpose so an outline runs under a panel rather than being
 * clipped at its edge). A menu mounted there renders behind an opaque dock.
 * Hosting inside the root instead — as its last child — puts the popover above
 * every dock *and* inherits three things a third body-level layer would have to
 * re-earn: the `--ap-*` token vars (scoped to the root), the
 * `${ROOT} button:hover .ic` icon-state rules, and membership of
 * `edit-guard.ts`'s `CHROME` list, without which every click inside a colour
 * picker would fall through and re-select the element underneath it.
 *
 * That last point is also why the tooltip moves here: mounted on the chrome
 * layer it was painted *behind* the panels, so every tooltip in the design
 * inspector was invisible.
 *
 * **One at a time.** A select and a colour picker are never usefully open
 * together, and a singleton makes outside-press, Escape and "the panel just
 * rebuilt" one code path each instead of a registry to keep in step.
 */
import {
  DND,
  DndScope,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
  POINTER_ONLY,
} from "./dnd/manager";
import { cls, el } from "./dom";
import { type IconName, icon } from "./icons";
import type { CommandId } from "./keys/catalog";
import { type Binding, keys } from "./keys/registry";
import { type PlaceOptions, placePopover, type Side } from "./popover";

export type CloseReason =
  | "anchor-gone"
  | "escape"
  | "outside"
  | "programmatic"
  | "reopen"
  | "select";

export interface PopoverOptions extends PlaceOptions {
  /**
   * The control this popover belongs to, and the box it is placed against.
   *
   * Omitted only by a `modal` popover, which belongs to no control: the command
   * palette and the shortcuts panel are opened by a chord from anywhere and
   * have nowhere to point at.
   */
  anchor?: HTMLElement;
  /** Extra class on the shell — `pop-menu`, `pop-color`. */
  className?: string;
  content: HTMLElement;
  /** Match the shell's width to the anchor's. For selects. */
  matchAnchorWidth?: boolean;
  /**
   * A centred sheet over a scrim, rather than a box beside a control.
   *
   * Turns off everything that is about an anchor — the placement, the
   * reposition-on-scroll and the frame-by-frame "is my anchor still there"
   * watchdog — and adds a scrim that takes the press meant for the page behind
   * it. Focus returns to wherever it was when the popover opened, since there
   * is no anchor to return it to.
   *
   * Still a `.pop` shell in the same host, which is the point of putting it
   * here rather than in a second layer: it inherits the token scope, membership
   * of `edit-guard`'s `CHROME` list, and — the load-bearing one — the
   * registry's rule that an unscoped binding never fires while focus is inside
   * a popover. Without that, arrowing through the palette would nudge the
   * selected element at the same time.
   */
  modal?: boolean;
  onClose?: (reason: CloseReason) => void;
  prefer?: Side;
  /** Arrow/Home/End roving over `[data-pop-item]` inside `content`. */
  roving?: boolean;
  /**
   * Give the popover a title bar you can drag it by.
   *
   * For the "advanced settings" shape, and not for menus. A menu is a
   * click-once surface that should be gone before you could want it elsewhere;
   * a settings form is one you hold open *against* the thing it edits, and the
   * one place it is guaranteed to be in the way is directly over its own
   * anchor. Every one of these was fixed to that spot, which is what made them
   * read as half-finished.
   *
   * The string is the bar's label. There is no untitled variant: a bar with
   * nothing in it is a grab handle nobody can identify, and every surface that
   * wants one has a name already.
   */
  title?: string;
}

export interface PopoverHandle {
  close: (reason?: CloseReason) => void;
  readonly element: HTMLElement;
  reposition: () => void;
}

const ITEM = "[data-pop-item]";

let host: HTMLElement | null = null;

/** Distinguishes one open popover's drag from another's on the shared monitor. */
let dragSeq = 0;

/** Kept off the viewport edge by this much when dragged. */
const DRAG_MARGIN = 8;

/**
 * A title bar, and the drag that moves the shell by it.
 *
 * `element`, never dnd-kit's `handle` — the same call `armDockDrag` documents
 * in `app.ts`: `preventActivation` tests `handle.contains(target)` first and
 * returns early, which would turn any button placed in this bar into a drag
 * origin instead of a button.
 *
 * `POINTER_ONLY` because this is a `feedback: "none"` draggable, and those
 * cannot be dragged by keyboard — the sensor starts and ends a drag but every
 * arrow between does nothing, latching the handle into a dragging state it
 * cannot leave. Declining the keyboard route is better than pretending to it;
 * the popover is dismissible with Escape either way.
 *
 * Returns the bar and a teardown, because the monitor is global: a listener
 * left behind would go on moving a shell that had closed.
 */
function draggableBar(
  shell: HTMLElement,
  title: string,
  onMoved: () => void
): { bar: HTMLElement; destroy: () => void } {
  const bar = el(
    "div",
    {
      /*
       * Hidden from assistive tech, and the title moved onto the shell instead.
       *
       * This is a `POINTER_ONLY` draggable, and dnd-kit's Accessibility plugin
       * stamps `tabindex="0"` and `aria-roledescription="draggable"` on any
       * handle regardless — so left alone this is a tab stop that announces
       * itself as movable and answers no key, which is the exact promise
       * `POINTER_ONLY`'s own docstring says not to make. Unlike the frame-list
       * grips there is no keyboard verb to offer beside it, because there is
       * nothing to offer: a popover that never moves is fully usable, and the
       * drag is a convenience for people pushing it off what it covers.
       *
       * The name is not lost — `openPopover` puts `title` on the shell.
       *
       * `tabindex` is set here, and its value matters less than its presence:
       * the plugin's guard is `!activator.hasAttribute("tabindex")`, so writing
       * one ourselves is what stops it writing `0`. Without that the bar would
       * be `aria-hidden` *and* focusable — a worse thing than what this fixes,
       * because a keyboard user could tab onto something no screen reader can
       * see. `aria-hidden` is only honest on a node nothing can reach.
       */
      "aria-hidden": "true",
      class: cls("pop-bar"),
      tabindex: "-1",
    },
    [el("span", { class: cls("pop-bar-title"), text: title })]
  );
  bar.dataset.tip = "Drag to move";

  dragSeq += 1;
  const id = `${DND.popMove}:${dragSeq}`;
  const scope = new DndScope();
  scope.add(
    new Draggable(
      {
        element: bar,
        id,
        // The shell is positioned by `left`/`top`; a translate on top of that
        // would double every pixel of the drag.
        plugins: FEEDBACK.none,
        sensors: POINTER_ONLY,
        type: DND.popMove,
      },
      manager
    )
  );

  const delta = new DragDelta();
  let from: { x: number; y: number } | null = null;

  const offs = [
    manager.monitor.addEventListener("dragstart", () => {
      if (manager.dragOperation.source?.id !== id) {
        return;
      }
      // Measured live rather than read back off the style, so the first drag
      // starts from wherever `placePopover` last put it.
      const rect = shell.getBoundingClientRect();
      from = { x: rect.left, y: rect.top };
      delta.start();
      // Before the first move, not after: `place()` runs on scroll and resize,
      // and one of those landing mid-drag would snap the shell back under the
      // pointer it is being dragged away from.
      onMoved();
    }),
    manager.monitor.addEventListener("dragmove", (e) => {
      if (!from) {
        return;
      }
      const d = delta.update(e);
      const max = {
        x: window.innerWidth - shell.offsetWidth - DRAG_MARGIN,
        y: window.innerHeight - shell.offsetHeight - DRAG_MARGIN,
      };
      // Clamped, or a popover can be pushed under the viewport edge and left
      // there — it has no chrome of its own to drag it back by.
      shell.style.left = `${Math.round(Math.min(Math.max(DRAG_MARGIN, from.x + d.x), Math.max(DRAG_MARGIN, max.x)))}px`;
      shell.style.top = `${Math.round(Math.min(Math.max(DRAG_MARGIN, from.y + d.y), Math.max(DRAG_MARGIN, max.y)))}px`;
    }),
    manager.monitor.addEventListener("dragend", () => {
      from = null;
    }),
  ];

  return {
    bar,
    destroy: () => {
      for (const off of offs) {
        off();
      }
      scope.clear();
    },
  };
}

/*
 * Popovers nest, shallowly.
 *
 * The singleton this replaces made "a control inside a popover opens a popover"
 * impossible, in a way that looked like nothing happening at all: the inner
 * `openPopover` saw a different anchor, closed the popover it was standing in,
 * and that `shell.remove()` detached the trigger mid-click — so the new menu
 * measured a zero-width anchor, placed itself in the screen corner, and the
 * watchdog closed it a frame later. Stroke's Advanced form has two selects and
 * the gradient editor has a colour swatch per stop; all of them were dead.
 *
 * A stack rather than a registry. The only nesting that exists is "a control
 * inside an open shell opened its own", so entry `i + 1` was opened from inside
 * entry `i` and dies with it — which keeps outside-press, Escape and "the panel
 * just rebuilt" one rule each, now stated against the stack instead of against a
 * variable.
 */
const stack: OpenPopover[] = [];

interface OpenPopover {
  /** Null for a modal popover, which belongs to no control. */
  anchor: HTMLElement | null;
  dispose: () => void;
  handle: PopoverHandle;
  onClose?: (reason: CloseReason) => void;
  shell: HTMLElement;
}

/**
 * Which level `node` sits inside, or `-1` for "outside every open popover".
 *
 * Shells are siblings in the host — a child popover is deliberately *not* a DOM
 * descendant of its parent, or the parent's `overflow` would clip it — so
 * `contains` matches at most one entry.
 */
function levelOf(node: Node | null): number {
  return node ? stack.findIndex((entry) => entry.shell.contains(node)) : -1;
}

/** Close everything above `index`, topmost first. `-1` closes the whole stack. */
function closeAbove(index: number, reason: CloseReason): void {
  // A reversed snapshot: `close` is a no-op once its entry has left the stack,
  // so a fixed list cannot loop even if an `onClose` opens something new.
  for (const entry of stack.slice(index + 1).reverse()) {
    entry.handle.close(reason);
  }
}

/**
 * Mount the host. Called once, immediately after the overlay root is in the
 * document.
 *
 * It sits above every dock by declared `z-index` (`Z_POP`), not by being last in
 * the DOM. The docks declare a numeric `z-index` of their own, and a positioned
 * element with `z-index: auto` paints in an earlier step of the stacking
 * algorithm than any positioned element with a numeric one — so an auto-stacked
 * host loses to a dock however late it appears. It *is* the root's last child,
 * and `toast.ts` mounts its own host ahead of this one to keep that true, but
 * that is hygiene rather than the mechanism.
 */
export function mountPopoverHost(root: HTMLElement): HTMLElement {
  if (!host) {
    host = el("div", { class: cls("pop-host") });
  }
  root.append(host);
  return host;
}

export function popoverHost(): HTMLElement | null {
  return host;
}

/**
 * Close every open popover — the whole stack, not the top of it.
 *
 * Both callers mean everything. `DesignPanel.renderBody` is about to destroy the
 * controls all of them are anchored to, and `closeGradientEditor` owns a popover
 * that may have a colour picker open on top of it. Closing only the top would
 * leave a parent anchored to a control that no longer exists — exactly the state
 * the watchdog exists to catch, one frame later and with a visible flicker.
 *
 * `createMenu` deliberately does not come through here: a menu must close
 * itself, not whatever it happens to be standing in.
 */
export function closeOpenPopover(reason: CloseReason = "programmatic"): void {
  closeAbove(-1, reason);
}

export function openPopover(opts: PopoverOptions): PopoverHandle {
  /*
   * Three cases, in order.
   *
   * The same anchor twice is a toggle: that entry and anything it parents go,
   * and nothing opens. An anchor *inside* an open shell is a child — a select in
   * the stroke form, a swatch in the gradient editor — so only the levels above
   * it go. Anything else is a hand-off, which is the old unconditional close and
   * still the common case.
   */
  const { anchor } = opts;
  // The toggle only applies to an anchored popover. Two modal ones both have a
  // null anchor, so without this guard opening the palette while the shortcuts
  // panel was up would read as re-clicking the panel's trigger: it would close
  // the panel and open nothing.
  const mine = anchor
    ? stack.findIndex((entry) => entry.anchor === anchor)
    : -1;
  if (mine !== -1) {
    closeAbove(mine - 1, "reopen");
    return DEAD;
  }
  // `levelOf(null)` is -1, so a modal closes every open popover before it opens
  // — which is what you want from a sheet that covers the editor.
  closeAbove(levelOf(anchor ?? null), "reopen");

  // `isConnected`, not a null check. `mountPopoverHost` keeps the host in a
  // module variable and re-appends it, so a host that was detached — by a teardown,
  // or by anything that replaced the body's children — stayed non-null and
  // kept being used. Popovers then mounted into a node that was in no
  // document: no error, no popover, and nothing to see in the DOM you were
  // inspecting. Re-mounting on demand makes the reference a cache rather than
  // a claim about the tree.
  const mount = host?.isConnected ? host : mountPopoverHost(document.body);
  // Whatever had focus when this opened, so a modal can hand it back. An
  // anchored popover returns focus to its anchor instead and ignores this.
  const restoreFocus = document.activeElement as HTMLElement | null;
  const scrim = opts.modal ? el("div", { class: cls("pop-scrim") }) : null;
  if (scrim) {
    mount.append(scrim);
  }
  // `scroll-y` on every shell: a popover is the overlay's own surface and had
  // been the largest family still painting a platform scrollbar — a font list
  // or a token picker sat beside an inspector that hides its own, which is
  // where "the submenus look nothing like the panel" came from.
  const shell = el("div", {
    class: [
      cls("pop"),
      cls("scroll-y"),
      opts.className ? cls(opts.className) : "",
      opts.modal ? cls("pop-modal") : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  // Once the user has put the popover somewhere, it stays there. `place()` is
  // wired to scroll and resize, and re-anchoring a shell that was deliberately
  // moved would drag it back the moment the panel behind it scrolled — the
  // thing that makes a movable surface feel broken rather than absent.
  let moved = false;
  const dragging = opts.title
    ? draggableBar(shell, opts.title, () => {
        moved = true;
      })
    : null;
  if (dragging) {
    // The name the bar can no longer carry — see `draggableBar`. `group` rather
    // than `dialog`: these are anchored, non-modal, and do not trap focus; the
    // two that *are* modal set `role="dialog"` on their own content and pass no
    // title, so neither branch reaches this.
    shell.setAttribute("role", "group");
    shell.setAttribute("aria-label", opts.title as string);
    shell.prepend(dragging.bar);
  }
  shell.append(opts.content);
  // Appended after its parent and left at `z-index: auto` like every other
  // shell, inside the host's single stacking context — so DOM order alone paints
  // a child above the popover it came from, and `Z_POP` stays one number.
  mount.append(shell);

  const place = (): void => {
    // A modal is centred by CSS. There is no anchor to measure against, and
    // running the placement would write a `left`/`top` over the centring.
    // A popover the user has dragged is in the same position for a different
    // reason: its coordinates are now an answer, not a derivation.
    if (!anchor || moved) {
      return;
    }
    placePopover(
      shell,
      anchor.getBoundingClientRect(),
      opts.prefer ?? "below",
      {
        align: opts.align,
        /*
         * A floor, not a fixed width.
         *
         * This was `shell.style.width = anchor.offsetWidth`, which fought
         * `.pop-menu`'s own `min-width: 150px`: off a narrow trigger the menu
         * was wider than the shell it lived in and hung out of its side. It
         * also lied to the placement below, which reads `offsetWidth` back off
         * this element to clamp the right edge — so the clamp was computed from
         * the constrained width and let the menu overrun the viewport by the
         * difference. As a floor it does the one thing a select wants (never
         * narrower than its trigger) and lets the content have the rest.
         */
        minWidth: opts.matchAnchorWidth ? anchor.offsetWidth : opts.minWidth,
        scroll: opts.scroll,
      }
    );
  };
  place();

  const handle: PopoverHandle = {
    close(reason = "programmatic") {
      if (levelOf(shell) === -1) {
        // Already closed. This one guard is what makes every path idempotent.
        return;
      }
      // Children first, and before this shell leaves the DOM: their anchors live
      // inside it, and a child outliving its parent by even one frame is a
      // popover anchored to a detached node.
      closeAbove(levelOf(shell), reason);
      // Re-read rather than reuse the index: a child's `onClose` is free to have
      // closed levels below us while we were in there.
      const at = levelOf(shell);
      if (at === -1) {
        return;
      }
      const [entry] = stack.splice(at, 1);
      entry.dispose();
      /*
       * Focus back to the anchor, before the shell leaves the DOM.
       *
       * `focusItem` moves focus *into* the popover on open and nothing put it back, so
       * closing dropped focus to `<body>`: open a select with the keyboard, arrow to a
       * value, press Enter, and the next Tab restarted at the top of the document.
       * Affects `createSelect`, the token picker and every `createMenu`.
       *
       * Only when focus is still inside this popover — if the user has already clicked
       * elsewhere, stealing it back would be worse than leaving it.
       */
      const active = shell.ownerDocument.activeElement;
      const hadFocus = active instanceof Node && shell.contains(active);
      shell.remove();
      scrim?.remove();
      // A modal has no anchor to go back to, so it goes back to whatever the
      // user was on when they hit ⌘K — otherwise focus lands on `<body>` and
      // the next Tab restarts at the top of the document.
      const back = anchor ?? restoreFocus;
      if (hadFocus && back?.isConnected) {
        back.focus?.();
      }
      // Out of the stack before `onClose` runs, as before — a parent's `onClose`
      // may destroy a control that owns a child popover, and every path has to
      // find a stack it can trust.
      entry.onClose?.(reason);
    },
    element: shell,
    reposition: place,
  };

  const installed = install(opts, handle);
  // The drag's listeners live on the shared monitor rather than on the shell,
  // so removing the element does not remove them — a closed popover would go
  // on answering a drag it can no longer show.
  const dispose = (): void => {
    installed();
    dragging?.destroy();
  };
  stack.push({
    anchor: anchor ?? null,
    dispose,
    handle,
    onClose: opts.onClose,
    shell,
  });

  if (opts.roving) {
    focusItem(opts.content, 0);
  }
  return handle;
}

/**
 * Everything that has to be undone on close, wired in one place.
 *
 * No longer takes the shell: outside-press asks the stack whether the press
 * landed in any open popover, not whether it landed in this one.
 */
function install(opts: PopoverOptions, handle: PopoverHandle): () => void {
  // Deferred, or the press that opened the popover closes it again on the way
  // back up. Same reason the old `createMenu` did it.
  const onOutside = (e: Event): void => {
    const target = e.target as Node | null;
    // Inside *any* open shell counts as inside. `shell.contains` — all this used
    // to test — cannot see a child, because children are siblings in the host,
    // so a press in a menu opened from this popover read as a press outside it.
    if (levelOf(target) !== -1 || opts.anchor?.contains(target)) {
      return;
    }
    handle.close("outside");
  };
  const armed = setTimeout(
    () => document.addEventListener("pointerdown", onOutside, true),
    0
  );

  /*
   * Reposition rather than close. The design panel's body is a scroller and the
   * canvas pans under a frame menu; closing on every wheel tick would make a
   * dropdown unusable next to a scrollbar. Capture phase so scrolls inside
   * `.insp-body` are seen — they do not bubble to `window`.
   *
   * This is also the backstop for an anchor removed by something that did not
   * route through `DesignPanel.renderBody`.
   *
   * **The popover's own scrolling is not a reflow, and treating it as one made
   * every tall menu unscrollable.** Capture is what makes that a real hazard:
   * the listener sees scroll events from *inside* this shell as well as around
   * it. `reposition` is `place`, and `placePopover` starts by clearing
   * `max-height` so it can measure the content unconstrained — which lets the
   * box grow to full height, so the browser clamps `scrollTop` back toward zero
   * before the cap is written again. The frame menu's twenty-seven rows scrolled
   * and then snapped to the top on every wheel tick. This popover's own scroll
   * cannot move its own anchor, so skipping it is not a heuristic: there is
   * nothing to re-place.
   *
   * `handle.element`, not `levelOf` — the test has to be "*this* shell", not
   * "any open shell". Popovers nest, and a nested one's anchor lives inside its
   * parent's body: when that parent scrolls, the child's anchor really has
   * moved, and the child really does have to follow it.
   */
  const watched = opts.anchor;
  const onReflow = (e: Event): void => {
    if (e.type === "scroll" && handle.element.contains(e.target as Node)) {
      return;
    }
    if (!watched?.isConnected) {
      handle.close("anchor-gone");
      return;
    }
    handle.reposition();
  };
  // A modal is centred and belongs to no control, so there is nothing for a
  // scroll or a resize to move it away from and nothing to watch for removal.
  if (watched) {
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
  }

  /*
   * A frame-by-frame check that the anchor still exists.
   *
   * `DesignPanel.renderBody` closes explicitly, which covers the common case,
   * but it is not the only thing that removes a control: `row-list.ts` re-renders
   * its own rows, and a fill or shadow row can vanish without the panel doing
   * anything. Rather than teach every list to remember, the host watches. The
   * work is one property read per frame while a popover is open — and nothing at
   * all when none is.
   */
  let frame = watched
    ? requestAnimationFrame(function watch() {
        if (!watched.isConnected) {
          handle.close("anchor-gone");
          return;
        }
        frame = requestAnimationFrame(watch);
      })
    : 0;

  /*
   * Through the registry, not a raw listener, and every one of them scoped to
   * `content`.
   *
   * The scope is what makes them win: the registry suppresses unscoped bindings
   * outright while focus sits inside a popover — the picker's Escape-to-deselect,
   * the panel's arrow-key nudge — so these do not have to out-rank them, they are
   * simply the only ones left standing. They also stop applying the moment the
   * disposer runs, and cannot reach a *sibling* popover's rows, which is what
   * keeps a nested menu's arrows from moving its parent's invisible cursor.
   *
   * Note `Keys` skips non-`allowWhileTyping` bindings while a field has focus,
   * which is correct for the arrows (they should move the caret inside the
   * picker's hex field) but means a focused field swallows Escape too. Fields
   * inside a popover therefore keep their own Escape handler, which is what
   * `keys/registry.ts` prescribes for field-local commit/cancel anyway.
   */
  const bindings: Binding[] = [
    {
      id: "popover.close",
      run: () => handle.close("escape"),
    },
  ];
  if (opts.roving) {
    const step = (delta: number) => () => moveItem(opts.content, delta);
    bindings.push(
      { id: "popover.next", run: step(1) },
      { id: "popover.prev", run: step(-1) },
      {
        id: "popover.first",
        run: () => focusItem(opts.content, 0),
      },
      {
        id: "popover.last",
        run: () => focusItem(opts.content, -1),
      },
      {
        id: "popover.choose",
        run: () => activeItem(opts.content)?.click(),
      }
    );
  }
  // Scoped in one place rather than on each literal above, so a binding added
  // later cannot be the one that forgets and silently goes dead again.
  const unbind = keys.bindAll(
    bindings.map((b) => ({ ...b, within: opts.content }))
  );

  return () => {
    clearTimeout(armed);
    cancelAnimationFrame(frame);
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow);
    unbind();
  };
}

// -- Roving -------------------------------------------------------------------

/*
 * `data-pop-active` is the keyboard cursor; `pop-item-on` is the selected value.
 * They are different things — you arrow *past* the current value on the way to
 * another one — and collapsing them into one class is what makes a hand-rolled
 * menu feel broken.
 */

/**
 * The rows the cursor may land on.
 *
 * Filtered rather than un-marked, and that is the whole reason a collapsed group
 * keeps its rows in the DOM at all. Stripping `data-pop-item` on collapse would
 * work for the cursor and break everything else that reads the built menu back —
 * the same trap `frame-chrome.ts` documents for its own accordion, where a
 * `[data-preset]` sweep has to reach rows inside a shut group to keep their
 * current-device mark from going stale. Shut rows measure zero *height* for
 * `placePopover` either way — and, since the collapse became `inert` rather than
 * `display: none`, they go on measuring their full *width*, which is the whole
 * of what stopped the menu resizing on a toggle.
 *
 * The filter is structural rather than a trust in `inert`'s own semantics. A
 * browser really does take an inert subtree out of the tab order; happy-dom does
 * not implement inertness at all, and the keyboard cursor has to be right in
 * both.
 */
function items(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>(ITEM)).filter(
    (node) => !node.closest(`.${cls("pop-group-body")}[inert]`)
  );
}

function activeItem(content: HTMLElement): HTMLElement | null {
  return content.querySelector<HTMLElement>("[data-pop-active]");
}

function focusItem(content: HTMLElement, index: number): void {
  const all = items(content);
  if (!all.length) {
    return;
  }
  const at = index < 0 ? all.length - 1 : Math.min(index, all.length - 1);
  for (const [i, node] of all.entries()) {
    node.tabIndex = i === at ? 0 : -1;
    node.toggleAttribute("data-pop-active", i === at);
  }
  all[at].focus({ preventScroll: true });
  all[at].scrollIntoView({ block: "nearest" });
}

function moveItem(content: HTMLElement, delta: number): void {
  const all = items(content);
  if (!all.length) {
    return;
  }
  const current = activeItem(content);
  const from = current ? all.indexOf(current) : -1;
  // Wrap, so ↓ from the last option lands on the first rather than dead-ending.
  const next = (from + delta + all.length) % all.length;
  focusItem(content, next);
}

/** Returned when a toggle-close consumed the call; every method is inert. */
const DEAD: PopoverHandle = {
  close: () => undefined,
  element: el("div"),
  reposition: () => undefined,
};

// -- Menus --------------------------------------------------------------------

export interface MenuItem {
  /**
   * The command this row runs, so its chord is rendered from the registry.
   *
   * Prefer this over spelling a chord into `hint`. Five rows in
   * `canvas/frame-chrome.ts` used to carry hand-written Mac glyphs — `"⌘+"`
   * where the binding was `mod+=`, `"⌘−"` with a U+2212 minus, all of them
   * shown unchanged to Windows and Linux — and one row in `chat/transcript.ts`
   * advertised `⌘Z` for the server-side revert, which ⌘Z has never run.
   */
  command?: CommandId;
  /** Present but unusable — greyed, and skipped by the keyboard cursor. */
  disabled?: boolean;
  /**
   * Rendered right-aligned in a dimmed mono.
   *
   * For a size or a unit. If it is a *shortcut*, use `command` instead — a
   * chord typed in here is a copy of the registry that nothing keeps honest,
   * and `keys/catalog.test.ts` will reject one that looks like a chord.
   */
  hint?: string;
  /** Leading glyph. Optional: a menu of plain verbs is better without one. */
  icon?: IconName;
  label: string;
  on?: boolean;
  run: () => void;
}

/**
 * A collapsible run of rows, one open at a time within a menu.
 *
 * A flat header is the right answer for three verbs under "Selection"; it is the
 * wrong one for the twenty-two device presets, where the menu becomes a
 * twenty-seven-item column that `placePopover` caps and scrolls. Grouping turns
 * that into four lines you choose from.
 *
 * `open` seeds which one starts expanded. Exactly one does — an accordion that
 * opens with everything shut presents a stack of headers and nothing to read —
 * so an `open` that matches nothing falls back to the first group.
 */
export interface MenuGroup {
  /** Stable id, written to `data-group`. What `open` is matched against. */
  group: string;
  /**
   * Glyph on the header, after the disclosure chevron.
   *
   * For a group whose identity is a mark rather than a word — the agent
   * picker's three backends are known by their logos, and a shut accordion
   * that reads "Claude / Codex / OpenCode" in plain text throws away the
   * fastest thing about it. Optional, because a group of *sizes* has no glyph
   * worth showing and the device menus are right not to carry one.
   */
  icon?: IconName;
  items: MenuItem[];
  label: string;
  open?: boolean;
}

/**
 * Arbitrary content, dropped in as its own row.
 *
 * The escape hatch for the one thing a list of buttons cannot express — the
 * custom width × height form that ends both device menus. Deliberately narrow:
 * anything that is a *row* should be a `MenuItem`, or the keyboard cursor and
 * the disabled/selected grammar have to be reinvented per call site.
 */
export interface MenuNode {
  node: HTMLElement;
}

/**
 * A menu row. Headers and separators carry no `data-pop-item`, so the roving
 * cursor steps over them without the keyboard code needing to know they exist.
 * A group's *header* does carry one — it is the only way to open the group from
 * the keyboard — and its rows carry theirs but are filtered out while shut. See
 * {@link items}.
 */
export type MenuEntry =
  | MenuItem
  | { separator: true }
  | { header: string }
  | MenuGroup
  | MenuNode;

/**
 * Is this entry a clickable row?
 *
 * Exported because narrowing a `MenuEntry` by hand is now a trap: `"label" in
 * entry` was a complete test while rows were the only labelled thing, and a
 * group has a label too. Callers that duck-typed it silently started admitting
 * groups. `run` is what actually separates them.
 */
export function isMenuItem(entry: MenuEntry): entry is MenuItem {
  return "label" in entry && "run" in entry;
}

function isMenuGroup(entry: MenuEntry): entry is MenuGroup {
  return "group" in entry;
}

/**
 * One collapsible group: a disclosure button and a body of rows.
 *
 * **A `<button>` and a `<div>`, not `<details>`/`<summary>`.** Two reasons, both
 * learned elsewhere in this codebase rather than here. `chat/disclosure.ts`'s
 * header has the first: host-page resets reach `<details>` and there is no way
 * to opt out of the marker in every engine. `frame-chrome.ts`'s accordion has
 * the second and it is the one that would bite here — `<summary>` swallows the
 * activation of every nested control, and a group body is nothing *but* nested
 * buttons.
 *
 * **Hidden, not detached.** A collapsed body keeps its rows in the tree so
 * anything that reads the built menu back still finds them; `items` filters them
 * out of the keyboard cursor instead. Both `inert` and `aria-expanded` are seeds
 * only — `openGroup` owns them from the first click on.
 */
function buildGroup(
  entry: MenuGroup,
  buildRow: (item: MenuItem) => HTMLElement,
  menu: HTMLElement,
  reposition: () => void
): HTMLElement {
  const head = el(
    "button",
    {
      "aria-expanded": "false",
      class: cls("pop-group-head"),
      // On the header, so a group can be opened without a pointer. Its rows
      // carry theirs too, and are filtered out of the cursor while shut.
      "data-pop-item": "",
      onClick: (e: Event) => {
        // The row handlers close the menu; a disclosure must not, and must not
        // be read as a choice by anything listening above it either.
        e.stopPropagation();
        openGroup(
          menu,
          head.getAttribute("aria-expanded") === "true" ? null : entry.group
        );
        // The list just changed shape, so re-measure it. This is the one case
        // `install`'s "a popover's own scroll is not a reflow" guard is *not*
        // about: that guard exists because `placePopover` clears `maxHeight` and
        // re-reads `scrollHeight`, which snapped a wheel-scrolled menu back to
        // the top on every tick. A disclosure toggle is a deliberate change to
        // what the list contains, and the scroll position afterwards is not a
        // position anybody chose. The *width* no longer moves — see
        // `.pop-group-body[inert]` — so this is only about `max-height`.
        reposition();
      },
      type: "button",
    },
    [
      icon("chev-right", "xs"),
      // "xs", not "sm". `.pop-group-head > .ic` declares `flex: 0 0 16px`, and a
      // 20px glyph in a 16px basis overflowed its slot by four pixels — the
      // declaration has been describing something that was not true.
      ...(entry.icon ? [icon(entry.icon, "xs")] : []),
      el("span", { text: entry.label }),
    ]
  );
  return el("div", { class: cls("pop-group"), "data-group": entry.group }, [
    head,
    // `inert`, not the `hidden` utility. `display: none !important` takes a
    // collapsed group out of layout entirely, so it contributed nothing to the
    // shrink-to-fit width of the menu around it — which is why the frame kebab
    // was ~158px wide with its groups shut and ~250 with one open. A shut group
    // that is still *laid out* makes the menu as wide as its widest row in any
    // group, in every state, with no number anywhere. `inert` is what makes that
    // safe: the rows are measured but unreachable.
    el(
      "div",
      { class: cls("pop-group-body"), inert: "" },
      entry.items.map(buildRow)
    ),
  ]);
}

/**
 * Expand one group and shut the rest, or shut them all for `null`.
 *
 * Single-open because the whole point is to make a long list short again; two
 * groups expanded at once is most of the way back to the flat column. Written
 * across the built DOM rather than held as state, for the reason
 * `frame-chrome.ts` gives for the same choice: the open group is re-derived on
 * every open and left alone in between, so a field would be a second copy of
 * something the tree already says.
 */
function openGroup(menu: HTMLElement, id: string | null): void {
  for (const group of menu.querySelectorAll<HTMLElement>(
    `.${cls("pop-group")}`
  )) {
    const on = group.dataset.group === id;
    group
      .querySelector(`.${cls("pop-group-head")}`)
      ?.setAttribute("aria-expanded", String(on));
    group
      .querySelector(`.${cls("pop-group-body")}`)
      ?.toggleAttribute("inert", !on);
  }
}

/**
 * Open the group the caller asked for, or the first one.
 *
 * Never all-shut: a menu that opens as three headers and nothing to read makes
 * the reader work out that they are headers before it will show them anything.
 * `frame-chrome.ts`'s accordion holds the same rule, and its test suite fences
 * it as `never opens with every group shut`.
 */
function seedOpenGroup(menu: HTMLElement, entries: MenuEntry[]): void {
  const groups = entries.filter(isMenuGroup);
  if (!groups.length) {
    return;
  }
  const wanted = groups.find((g) => g.open) ?? groups[0];
  openGroup(menu, wanted.group);
}

export interface MenuOpenOptions {
  /** Match the menu's width to the trigger's — right for a full-width select. */
  matchAnchorWidth?: boolean;
  /** Fires whenever the menu goes away, however it went. Drives `aria-expanded`. */
  onClose?: () => void;
}

export interface MenuHandle {
  close: () => void;
  /**
   * Open against a live anchor. Calling it again from the same anchor toggles
   * shut, which is what a trigger button wants.
   */
  open: (anchor: HTMLElement, prefer?: Side, opts?: MenuOpenOptions) => void;
}

/**
 * A dropdown of plain items — the zoom readout, the effect-type switch, the
 * position select.
 *
 * The markup is built once and handed to `openPopover` on each open, which owns
 * placement, outside-press, Escape, arrow-key roving and the "your anchor was
 * just destroyed" case. The previous version owned a private copy of the first
 * two and no version of the last three; more to the point it rendered *inside*
 * whatever called it, which in the design panel meant inside two nested
 * `overflow` boxes that clipped it. Hence no `element` on the handle any more —
 * the content belongs to the host while it is up and to nobody when it is not,
 * which is also what stops a rebuilt row from leaving its old menu behind.
 *
 * Still deliberately not a general menu system: no submenus. It does group,
 * though — headers, separators, and single-open accordions, because a menu
 * carrying "Undo", "Create pull request" and "Open in VS Code" in one
 * undifferentiated column reads as a junk drawer, and one carrying
 * twenty-two device presets reads as a scroll. `frame-chrome.ts`'s device menu
 * still is not a client of this: it places itself against world-space canvas
 * geometry and re-anchors on pan.
 */
export function createMenu(entries: MenuEntry[]): MenuHandle {
  /*
   * This menu's own popover, not "whatever is open".
   *
   * The row used to call `closeOpenPopover`, which was right while only one
   * popover could exist. Against a stack it takes the popover the menu is
   * standing in down with it — choosing a value in the stroke form's select
   * would close the stroke form. The row still closes *before* `entry.run()`,
   * which is what lets a `run` that opens another popover from the same anchor
   * place itself instead of being read as a toggle.
   */
  let handle: PopoverHandle | null = null;
  const menu = el("div", { class: cls("pop-menu"), role: "menu" });
  /** Re-measure after a disclosure changes what the list contains. */
  const reposition = (): void => handle?.reposition();

  const buildRow = (entry: MenuItem): HTMLElement => {
    const disabled = Boolean(entry.disabled);
    const row = el(
      "button",
      {
        class: `${cls("pop-item")}${entry.on ? ` ${cls("pop-item-on")}` : ""}`,
        role: "menuitem",
        type: "button",
        // Omitting the attribute is what keeps the roving cursor off it; the
        // arrow-key code only ever queries `[data-pop-item]`.
        ...(disabled
          ? { "aria-disabled": "true", disabled: "" }
          : { "data-pop-item": "" }),
        onClick: disabled
          ? undefined
          : () => {
              handle?.close("select");
              entry.run();
            },
      },
      [
        el("span", { class: cls("pop-item-main") }, [
          // "xs", so a verb row's label lands on the same 30px edge as a group
          // head's and a device row's — 8px of padding, a 16px glyph, a 6px gap.
          // At "sm" it was 36, which also made the row five pixels taller than
          // every other row family in the same menu.
          ...(entry.icon ? [icon(entry.icon, "xs")] : []),
          el("span", { class: cls("pop-item-label"), text: entry.label }),
        ]),
      ]
    );
    // The command's own chord wins over a hand-written `hint`, so a row that
    // names a command can never disagree with the key that runs it.
    const hint = entry.command ? keys.hint(entry.command) : entry.hint;
    if (hint) {
      row.append(el("span", { class: cls("pop-item-hint"), text: hint }));
    }
    return row;
  };

  for (const entry of entries) {
    if (isMenuItem(entry)) {
      menu.append(buildRow(entry));
      continue;
    }
    if (isMenuGroup(entry)) {
      menu.append(buildGroup(entry, buildRow, menu, reposition));
      continue;
    }
    if ("node" in entry) {
      menu.append(entry.node);
      continue;
    }
    menu.append(
      "header" in entry
        ? el("div", { class: cls("pop-head"), text: entry.header })
        : el("div", { class: cls("pop-sep"), role: "separator" })
    );
  }
  seedOpenGroup(menu, entries);

  return {
    close: () => handle?.close(),
    open(anchor, prefer = "above", opts = {}) {
      // A menu told to match its trigger has already been given a width, and
      // `MENU_MAX_W` would leave the content narrower than the shell around it —
      // a strip of empty panel down the right of every wide select. The cap is
      // for menus whose width comes from their own rows.
      menu.style.maxWidth = opts.matchAnchorWidth ? "none" : "";
      const opened = openPopover({
        anchor,
        content: menu,
        matchAnchorWidth: opts.matchAnchorWidth,
        onClose: () => {
          handle = null;
          opts.onClose?.();
        },
        prefer,
        roving: true,
      });
      // `DEAD` is the toggle-shut path — there is nothing open to hold on to.
      handle = opened === DEAD ? null : opened;
    },
  };
}
