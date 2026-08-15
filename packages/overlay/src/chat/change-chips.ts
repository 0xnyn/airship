/**
 * The composer's pending-change strip.
 *
 * Every direct-manipulation edit waiting to be sent gets its own chip with its
 * own ✕. This replaced a single filled-accent pill reading "3 style changes +
 * 1 move", whose ✕ discarded *everything* — so backing out one bad tweak meant
 * throwing away the other four and redoing them.
 *
 * The chips are deliberately quiet: a hover surface, a hairline border and
 * secondary text. They sit inches from the accent-filled Send button, and two
 * blue things side by side both claiming to be the important one is worse than
 * either. The selection chip keeps the accent, which makes it the one coloured
 * thing in the row — the hierarchy the strip actually wants.
 *
 * The strip is a horizontal rail, and reaching the far end of it used to depend
 * on the pointing device. See `attachRailWheel`.
 */
import { pixelDelta } from "../canvas/wheel";
import { cls, el } from "../dom";
import { type IconName, icon } from "../icons";
import { keys } from "../keys/registry";

/** Fractional scroll positions never land exactly on the ends. */
const SCROLL_EPSILON = 1;

/**
 * One pending edit, as the composer shows it.
 *
 * Three fields rather than one string. They were joined with spaces at the call
 * site and rendered as a single run of 10px mono, so a style chip read
 * "RootDocument flex 0 0" — three different kinds of thing with nothing to say
 * where one ended and the next began. Splitting them lets the strip spend its
 * one available axis, tone, on the boundary: what it is about, what changed,
 * what it changed to.
 */
export interface ChangeChip {
  /** What changed: "flex", "moved", "duplicated". */
  readonly detail?: string;
  /** Leading glyph, where the kind is not already spoken by `detail`. */
  readonly icon?: IconName;
  readonly onRemove: () => void;
  /** What the edit is about: "RootDocument", "Button:hover". Ellipsises first. */
  readonly subject: string;
  /** Full text for the tooltip — the fields above are truncated to fit. */
  readonly tip: string;
  /** The new value, where there is one. */
  readonly value?: string;
}

/**
 * Append one chip per change to `host`, plus a trailing "Discard all".
 *
 * Appends rather than clears: the host also carries the selection chip, which
 * the caller owns and has already placed.
 *
 * The bulk action only appears at two or more chips — with a single chip it
 * would be a second control that does exactly what the first one does.
 */
export function renderChangeChips(
  host: HTMLElement,
  chips: ChangeChip[],
  // Handed its own button so the caller can anchor a confirm menu on it —
  // this is the bulk path with no journal entry behind it.
  onDiscardAll?: (anchor: HTMLElement) => void
): void {
  for (const chip of chips) {
    const parts: HTMLElement[] = [];
    if (chip.icon) {
      // `xs`, not `sm`: a 20px glyph beside 11px text made a chip 28px tall and
      // mostly whitespace, on a rail whose scarce axis is width.
      parts.push(icon(chip.icon, "xs"));
    }
    parts.push(el("span", { class: cls("chip-subject"), text: chip.subject }));
    if (chip.detail) {
      parts.push(el("span", { class: cls("chip-detail"), text: chip.detail }));
    }
    if (chip.value) {
      parts.push(el("span", { class: cls("chip-value"), text: chip.value }));
    }
    parts.push(
      el(
        "span",
        {
          "aria-label": `Drop ${chip.tip}`,
          class: cls("chip-x"),
          "data-tip": "Drop this change",
          onClick: chip.onRemove,
          role: "button",
          // Not a tab stop of its own. Twelve pending edits used to mean twelve
          // stops between the composer and anything after it; the rail is one
          // stop now and ⌫ on the focused chip is the keyboard route to this.
          tabindex: "-1",
        },
        [icon("close", "sm")]
      )
    );
    host.append(
      el(
        "span",
        {
          // A labelled group, not a bare span. The rail is a `role="toolbar"`
          // and this is one of its items, so without these a screen reader
          // reaches a focusable element that announces nothing and gives no clue
          // that ⌫ is what removes it.
          "aria-keyshortcuts": "Delete",
          "aria-label": chip.tip,
          class: `${cls("sel-chip")} ${cls("tweak-chip")}`,
          // The tip goes on the chip itself so hovering anywhere on it explains
          // the change; the ✕ overrides it with what clicking will do.
          "data-chip": "",
          "data-tip": chip.tip,
          role: "group",
          tabindex: "-1",
        },
        parts
      )
    );
  }

  if (onDiscardAll && chips.length > 1) {
    const all = el(
      "button",
      {
        class: `${cls("sel-chip")} ${cls("chip-all")}`,
        // In the roving order like every other item, and not a tab stop of its
        // own. As a native button with neither, it escaped `attachRailKeys`
        // (which selects on `[data-chip]`) while still being tabbable — so the
        // rail was two tab stops, which is exactly what the roving exists to
        // prevent. ⌫ on it finds no ✕ and is a safe no-op; Enter and Space
        // activate it natively.
        "data-chip": "",
        "data-tip": "Discard every pending change",
        tabindex: "-1",
        type: "button",
      },
      [icon("close", "sm"), el("span", { text: "Discard all" })]
    );
    all.addEventListener("click", () => onDiscardAll(all));
    host.append(all);
  }
}

/** Shorten a CSS value so a chip stays a chip. */
export function shortValue(value: string, max = 14): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/**
 * Make a horizontal chip rail reachable with a mouse, and say when it has more.
 *
 * The rail has always scrolled. What it had no way of telling you is that it
 * scrolls: the scrollbar was hidden outright, there was no wheel handler, and
 * nothing marked the edges. A trackpad papers over all three — a two-finger
 * swipe produces `deltaX` and scrolls the rail natively — so on a trackpad the
 * strip is fine and on a mouse the twelfth chip does not exist. Every wheel a
 * mouse sends is `deltaY`, and a box that only overflows on X ignores it.
 *
 * So: translate a vertical wheel into horizontal scroll, and publish how much
 * is off each end as `data-overflow` for the mask in `base.css`.
 *
 * `pixelDelta` rather than raw `deltaY`, for the reason written where it lives:
 * most mouse wheels report *lines* (a notch is `deltaY: 3`, not `120`), so the
 * unconverted value scrolls a rail by three pixels per notch and reads as
 * broken rather than as slow. That normalisation is the whole difference
 * between this working on a mouse and only appearing to.
 *
 * The gesture is declined at either end rather than clamped silently: an
 * uncancelled wheel there chains to the transcript above, which is what a
 * vertical wheel over a full rail should do.
 *
 * Self-syncing, because the caller cannot be trusted to remember both triggers:
 * chips arrive and leave without the rail's own box changing (MutationObserver),
 * and the dock resizes without the chips changing (ResizeObserver).
 *
 * A rail already scrolled to its end stays there when a chip is appended — the
 * same pin the transcript keeps (`AirshipApp.scrollTranscript`), and for the
 * same reason: the newest thing is what you just did and what you want to see
 * confirmed. A rail scrolled back is left alone, so reading chip three is not
 * interrupted by chip twelve arriving.
 *
 * It starts *un*pinned, which is the opposite of the transcript and is the
 * whole difference between the two: the transcript's newest entry is at the
 * bottom and nothing above it needs to stay in view, while this rail's leftmost
 * item is the *selection* chip — the one accent-coloured thing in the composer,
 * and the only thing saying what these edits are about. Pinning from the start
 * scrolled it off the moment the first change landed.
 */
export function attachRailWheel(rail: HTMLElement): () => void {
  let pinned = false;

  const sync = (): void => {
    const max = rail.scrollWidth - rail.clientWidth;
    if (max <= SCROLL_EPSILON) {
      rail.removeAttribute("data-overflow");
      return;
    }
    if (pinned) {
      rail.scrollLeft = max;
    }
    const left = rail.scrollLeft > SCROLL_EPSILON;
    const right = rail.scrollLeft < max - SCROLL_EPSILON;
    if (left && right) {
      rail.dataset.overflow = "both";
    } else if (left) {
      rail.dataset.overflow = "left";
    } else {
      rail.dataset.overflow = "right";
    }
  };

  const onScroll = (): void => {
    const max = rail.scrollWidth - rail.clientWidth;
    pinned = max <= SCROLL_EPSILON || rail.scrollLeft >= max - SCROLL_EPSILON;
    sync();
  };

  const onWheel = (e: WheelEvent): void => {
    // A horizontal wheel is already this rail's own scrolling — leave it alone
    // rather than adding our delta to the browser's.
    if (e.deltaX !== 0 || e.deltaY === 0) {
      return;
    }
    const max = rail.scrollWidth - rail.clientWidth;
    if (max <= SCROLL_EPSILON) {
      return;
    }
    const next = Math.max(0, Math.min(max, rail.scrollLeft + pixelDelta(e).y));
    if (next === rail.scrollLeft) {
      return;
    }
    rail.scrollLeft = next;
    e.preventDefault();
  };

  rail.addEventListener("wheel", onWheel, { passive: false });
  rail.addEventListener("scroll", onScroll, { passive: true });
  const resize = new ResizeObserver(sync);
  resize.observe(rail);
  const mutate = new MutationObserver(sync);
  mutate.observe(rail, { childList: true, subtree: true });
  sync();

  return () => {
    rail.removeEventListener("wheel", onWheel);
    rail.removeEventListener("scroll", onScroll);
    resize.disconnect();
    mutate.disconnect();
  };
}

/**
 * Arrow through the chips on a rail, and drop the one you land on.
 *
 * A roving tabindex: the rail is one tab stop, ← and → move between chips,
 * Home and End jump to the ends, and ⌫ discards the focused chip. Before this
 * the only focusable thing in a chip was its ✕, so a dozen pending edits put a
 * dozen tab stops between the composer and everything after it — and there was
 * still no way to *see* a chip that had scrolled off, because focus never
 * moved to one.
 *
 * Bound with `within` so these never fire outside the rail: ← and → are the
 * nudge bindings everywhere else, and a chip is only ever focused while the
 * user is looking at the strip. `within` is checked before the chord, so the
 * nudge never gets the keystroke.
 *
 * The rail is a toolbar rather than a list: its children are controls, one tab
 * stop with arrow navigation between them is the pattern that describes, and a
 * list would promise a reading structure that a horizontally-scrolled strip of
 * eleven-pixel chips does not have.
 */
export function attachRailKeys(rail: HTMLElement): () => void {
  rail.setAttribute("role", "toolbar");
  rail.setAttribute("aria-label", "Pending changes");
  rail.setAttribute("aria-orientation", "horizontal");

  const chipsOf = (): HTMLElement[] => [
    ...rail.querySelectorAll<HTMLElement>("[data-chip]"),
  ];

  /** Exactly one chip must stay tabbable, or the rail drops out of tab order. */
  const seed = (): void => {
    const all = chipsOf();
    if (!all.length || all.some((c) => c.tabIndex === 0)) {
      return;
    }
    all[0].tabIndex = 0;
  };

  const focusAt = (i: number): void => {
    const all = chipsOf();
    if (!all.length) {
      return;
    }
    const next = all[Math.max(0, Math.min(all.length - 1, i))];
    for (const c of all) {
      c.tabIndex = c === next ? 0 : -1;
    }
    next.focus();
    // `nearest`, so a chip already on screen does not recentre the rail under
    // the pointer. This is the half that makes arrowing feel like scrolling.
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const focused = (): { all: HTMLElement[]; chip: HTMLElement | null } => {
    const all = chipsOf();
    const active = rail.ownerDocument.activeElement as HTMLElement | null;
    return { all, chip: active?.closest<HTMLElement>("[data-chip]") ?? null };
  };

  const step = (delta: number) => () => {
    const { all, chip } = focused();
    focusAt(chip ? all.indexOf(chip) + delta : 0);
  };

  const off = keys.bindAll([
    {
      id: "chips.next",
      run: step(1),
      within: rail,
    },
    {
      id: "chips.prev",
      run: step(-1),
      within: rail,
    },
    {
      id: "chips.first",
      run: () => focusAt(0),
      within: rail,
    },
    {
      id: "chips.last",
      run: () => focusAt(chipsOf().length - 1),
      within: rail,
    },
    {
      id: "chips.drop",
      run: () => {
        const { all, chip } = focused();
        if (!chip) {
          return;
        }
        const i = all.indexOf(chip);
        // Click the ✕ rather than calling `onRemove` directly: the chip is
        // rebuilt from scratch by `renderComposerChips`, so the handler that
        // knows how to discard this one lives on the node, not here.
        chip.querySelector<HTMLElement>(`.${cls("chip-x")}`)?.click();
        // The rail has been rebuilt by now. Land on whatever took its place,
        // so a run of ⌫ clears the strip without the focus falling out of it.
        focusAt(Math.min(i, chipsOf().length - 1));
      },
      within: rail,
    },
  ]);

  const mutate = new MutationObserver(seed);
  mutate.observe(rail, { childList: true });
  seed();

  return () => {
    off();
    mutate.disconnect();
  };
}
