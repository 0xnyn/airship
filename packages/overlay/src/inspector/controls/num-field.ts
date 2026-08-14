/*
 * The panel's one numeric field.
 *
 * There used to be five: `number-scrub`, `glyphField` in panel.ts, and a local
 * `field()` inside each of `padding.ts`, `quad-field.ts` and `paint.ts`, plus
 * the colour row's alpha input. They rendered the same markup and disagreed
 * about everything else — which of them clamped, which appended a unit, which
 * accepted `auto`, which could be dragged. Four of the five accepted the string
 * "banana" and silently reverted on blur, and none of the five noticed a paste.
 *
 * This is a *primitive*, not a `ControlHandle`: it knows nothing about CSS
 * properties, the change set or the selection. That is deliberate, and it is
 * what lets call sites with very different commit shapes — one property, four
 * longhands, an entry in a serialised shadow list, one channel of a colour —
 * all share one field.
 *
 * Two behaviours are worth naming because they are the reason it exists:
 *
 * **Nothing illegal can be typed.** The filter runs on `beforeinput`, so it
 * sees pastes, drops and IME composition, not just keystrokes — and it works on
 * the *prospective* value, so it rejects before the character lands rather than
 * repairing afterwards. What counts as legal is per-field: `auto` is a real
 * width and nonsense in an opacity, `%` is a real inset and nonsense in a
 * z-index. Each field declares what it takes.
 *
 * **Every field drags.** `glyphField` used to argue that fields without a
 * `Descriptor` "have no min/max/step to read, and a scrub without clamping is
 * worse than no scrub". That was true, and it was an argument about where the
 * three numbers come from — not about whether they can exist. They come from
 * `NumSpec` instead, and Position, Size, blur radii and the rest now scrub like
 * everything else.
 */
import {
  DND,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
} from "../../dnd/manager";
import { cls, el } from "../../dom";
import { hasIcon, type IconName, icon } from "../../icons";
import { clamp, round } from "../../num";
import {
  formatLength,
  isPrefix,
  type Length,
  parseLength,
} from "../css-length";
import type { Gestures } from "./types";

/** Distinguishes concurrent scrub grips; a drag operation is singular anyway. */
let scrubSeq = 0;

export interface NumSpec {
  /**
   * Multiplier for ⇧-arrow and ⇧-drag. Defaults to ×10 — the convention from
   * design tools to a browser's own number inputs.
   */
  bigStep?: number;
  /**
   * A stable identity for this field within the panel, so a rebuild can put the
   * caret back where it was. Optional: a field without one loses focus on
   * rebuild, which is the old behaviour.
   */
  fieldKey?: string;
  /**
   * The field's identity in place of a label rail: an icon slug, or one or two
   * characters where a letter beats any glyph ("W", "H", "X", "Z"). It doubles
   * as the drag handle.
   */
  glyph?: IconName | string;
  /**
   * Reject a fractional value. For the properties where one is not a smaller
   * step but a syntax error — `z-index: 1.5` and a grid track count are both
   * invalid, and both used to be accepted and then silently truncated by a
   * `parseInt` further down.
   */
  integer?: boolean;
  /**
   * Bare words this field accepts as whole values — `auto`, `normal`,
   * `max-content`. Absent means "this is a number, full stop", which is what
   * lets an opacity reject `auto` while a width does not.
   */
  keywords?: string[];
  /** Tooltip and accessible name. */
  label: string;
  max?: number;
  min?: number;
  /** Shown when the field is empty — for values whose absence means something. */
  placeholder?: string;
  /** Drag-to-adjust on the glyph. On by default. */
  scrub?: boolean;
  step?: number;
  /** Rendered after the value, inside the field ("%", "°"). Not part of the value. */
  suffix?: string;
  /** Appended to a bare number on commit. `""` for unitless (opacity, z-index). */
  unit?: string;
  /** Further units the user may type. `unit` is always accepted; these are extra. */
  units?: string[];
}

export interface NumHandle {
  destroy: () => void;
  element: HTMLElement;
  input: HTMLInputElement;
  /** What a click on the field does once it is locked — open its picker. */
  onActivate: (open: () => void) => void;
  /**
   * Refuse edits while going on showing the value.
   *
   * Distinct from `setToken`, which also replaces what the field *reads*. The
   * colour row's alpha needs this one: a bound paint's opacity is the token's,
   * so it must not be editable, but the percentage is still a true fact about
   * the paint and a token name in its place would say less.
   *
   * `readOnly` alone is not enough and was the bug — it stops typing, while
   * arrow-stepping and the drag-scrub are gated on this flag, and the scrub
   * grip is a `<span>` that never consulted `readOnly` at all.
   */
  setLocked: (locked: boolean) => void;
  /** Show a design token in place of the number. See `ControlHandle.setToken`. */
  setToken: (name: string | null) => void;
  /** Reflect an externally-changed value. Display only — never emits. */
  setValue: (css: string) => void;
}

/**
 * Live modifier state during a drag.
 *
 * dnd-kit's `dragmove` carries coordinates and nothing else, so ⇧-to-accelerate
 * has to come from somewhere. A document listener attached for the life of one
 * scrub is cheaper and more reliable than threading modifiers through the
 * sensor: `pointermove` fires alongside every drag frame and carries the
 * current state, and the key listeners catch a modifier pressed while the
 * pointer is held still.
 */
function trackModifiers(): {
  read: () => { alt: boolean; shift: boolean };
  stop: () => void;
} {
  const state = { alt: false, shift: false };
  const from = (e: { altKey: boolean; shiftKey: boolean }): void => {
    state.alt = e.altKey;
    state.shift = e.shiftKey;
  };
  const onPointer = (e: Event): void => from(e as PointerEvent);
  const onKey = (e: Event): void => from(e as KeyboardEvent);
  document.addEventListener("pointermove", onPointer, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKey, true);
  return {
    read: () => state,
    stop() {
      document.removeEventListener("pointermove", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKey, true);
    },
  };
}

export function createNumField(
  spec: NumSpec,
  initial: string,
  onCommit: (css: string) => void,
  gestures?: Gestures
): NumHandle {
  const unit = spec.unit ?? "px";
  const step = spec.step ?? 1;
  const bigStep = spec.bigStep ?? step * 10;
  const keywords = spec.keywords ?? [];
  // `unit` is always typeable; `units` are the extras. Deduped and sorted long
  // first so a prefix test never matches "e" before it can match "em".
  const units = [...new Set([unit, ...(spec.units ?? [])])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  // A field with `min: 0` has no use for a minus sign, and letting one be typed
  // offers an edit that will be silently clamped away — worse than refusing it.
  const signed = spec.min === undefined || spec.min < 0;

  let current = initial;

  const input = el("input", {
    "aria-label": spec.label,
    class: cls("ctl-input"),
    placeholder: spec.placeholder,
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;

  // -- Value <-> display ------------------------------------------------------

  /** Constrain and round one number the way this field's spec asks. */
  function settle(n: number): number {
    const bounded = clamp(n, spec.min, spec.max);
    return spec.integer ? Math.round(bounded) : round(bounded);
  }

  /** Parse against this field's own unit set. Null for anything illegal. */
  function read(css: string): Length | null {
    return parseLength(css, units);
  }

  /**
   * What the field shows for a CSS value.
   *
   * The unit is shown whenever it is *not* the field's default, and hidden when
   * it is. A px field showing a bare `16` is the editor's density and is what the
   * glyph already implies; a `%` value showing a bare `50` is a lie the field
   * then acted on — `display` dropped the unit and `commit` put the default
   * back, so focusing a percentage field and tabbing away rewrote it as pixels.
   *
   * Anything unparseable (a keyword, or the `Mixed` sentinel a multi-selection
   * seeds) is shown verbatim.
   */
  function display(css: string): string {
    if (!css) {
      return "";
    }
    const parsed = read(css);
    if (!parsed) {
      return css;
    }
    const shown = round(parsed.value);
    return parsed.unit === unit ? String(shown) : `${shown}${parsed.unit}`;
  }

  /**
   * The token standing in for this field's value, if any.
   *
   * Held rather than written once, because the panel re-seeds controls from
   * computed style between rebuilds — and a bound field that let a re-seed put
   * the resolved number back would silently stop showing its binding.
   */
  let boundToken: string | null = null;
  /** Edits refused. Set by `setLocked`, and implied by a binding. */
  let locked = false;
  /** What clicking a locked field does, if anything. See `onActivate`. */
  let openBound: (() => void) | null = null;

  /** Refuse edits, keeping whatever the field currently reads. */
  function setLocked(next: boolean): void {
    locked = next;
    input.readOnly = next;
    wrap.toggleAttribute("data-locked", next);
  }

  /** Set the value and repaint. Display only. */
  function reflect(css: string): void {
    current = css;
    if (boundToken === null) {
      input.value = display(css);
    }
  }

  /** Set the value, repaint, and tell the caller. */
  function emit(css: string): void {
    reflect(css);
    onCommit(css);
  }

  // -- Input filtering --------------------------------------------------------

  /**
   * Could this string still become a legal value?
   *
   * Prefixes count, not just complete values — you cannot type `1.5` without
   * passing through `1`, or `auto` without passing through `a`. Rejecting the
   * intermediate states would make the field untypeable, which is how a
   * well-meant validator becomes a worse bug than the one it fixed.
   *
   * This is deliberately *weaker* than `commit`'s check, and that asymmetry is
   * the point: `12r` is fine to be holding and must never be written. One
   * predicate used to serve both, so it was written.
   */
  function acceptable(raw: string): boolean {
    // A field with `min: 0` has no use for a minus sign, and letting one be
    // typed offers an edit that will be silently clamped away.
    if (!signed && raw.trim().startsWith("-")) {
      return false;
    }
    return isPrefix(raw, units, keywords);
  }

  /*
   * `beforeinput` rather than `keypress`, because it is the only event that
   * sees pastes, drag-and-drop text and IME composition the same way it sees
   * typing — and it fires before the value changes, so rejecting is a
   * `preventDefault()` rather than a repair after the fact.
   */
  /*
   * Select everything on focus.
   *
   * The `beforeinput` filter below tests the *prospective* string, so with the field
   * showing the `Mixed` sentinel of a multi-selection — or a keyword like `auto` —
   * typing `1` produced `Mixed1`, which `isPrefix` rejects, and the keystroke was
   * `preventDefault()`ed. Multi-select two elements, click W, type a number: nothing
   * happened, with nothing in the UI to say that select-all-first was required.
   *
   * Selecting on focus is also what every numeric field in every design tool does.
   */
  input.addEventListener("focus", () => {
    input.select();
  });

  input.addEventListener("beforeinput", (e) => {
    const ev = e as InputEvent;
    if (
      ev.inputType.startsWith("delete") ||
      ev.inputType.startsWith("history")
    ) {
      return;
    }
    const data = ev.data ?? ev.dataTransfer?.getData("text") ?? "";
    if (!data) {
      return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + data + input.value.slice(end);
    if (!acceptable(next)) {
      ev.preventDefault();
    }
  });

  // -- Commit -----------------------------------------------------------------

  function commit(raw: string): void {
    const v = raw.trim();
    const keyword = keywords.find((k) => k === v.toLowerCase());
    if (keyword) {
      emit(keyword);
      return;
    }
    const parsed = read(v);
    if (!parsed) {
      /*
       * Everything illegal lands here: the empty field, a keyword this property
       * does not take, a half-typed unit (`12r`), a number too large to be
       * finite, `1.2.3`, a bare `-`.
       *
       * The previous value stands, because this control has no vocabulary for
       * "unset" — the CSS pane's ✕ is how a declaration is removed. What it
       * must not do is write the garbage through, which the old `parseFloat`
       * path did for anything with a leading digit.
       */
      reflect(current);
      return;
    }
    // A unit the user typed wins over the field's default — `50%` in a px field
    // is a deliberate act, not a mistake — and now survives the round trip,
    // because `display` keeps it visible. Clamping still applies: `min: 0`
    // means zero whatever the unit.
    const next = formatLength({
      unit: parsed.unit || unit,
      value: settle(parsed.value),
    });
    /*
     * Nothing was edited. Blur fires whether or not anything changed, and an emit
     * here is not harmless: it writes an inline style onto an element that was
     * taking the value from a stylesheet, so tabbing through the panel pinned a
     * copy of every value it passed.
     *
     * Compared through `display` on both sides, because the field shows a *rounded*
     * value while `current` holds the full one. An element with `padding: 1.04em`
     * computes to `16.6667px`, is displayed as `16.667`, and committing that back
     * produced `16.667px` — different from `current`, so the guard let it through
     * and a pending change appeared for an edit nobody made. Comparing what the
     * user can actually see is the honest test of whether they changed it.
     */
    if (next === current || display(next) === display(current)) {
      reflect(current);
      return;
    }
    emit(next);
  }

  /*
   * Blur is the *only* commit, and Enter reaches it by blurring.
   *
   * Enter used to run `commit(); input.blur();`, and blur was bound to commit
   * as well — so every Enter committed twice. Harmless for a plain number, and
   * not for a value whose display differs from its CSS: the second pass read
   * the field as repainted by the first rather than what the user typed, which
   * is how a typed `50%` could come back as `50px`.
   *
   * Escape is the one blur that must *not* commit: inside a field it means
   * "undo my typing", so the value is reflected back and the pending commit is
   * suppressed. Without the flag, Escape wrote the old value out again as a
   * fresh edit — a no-op the change set would still journal.
   */
  let skipBlurCommit = false;

  /*
   * `pointerdown`, and a keyboard route beside it.
   *
   * This was `mousedown` only. Touch synthesises one after `touchend` — and not at all
   * if the tap is interpreted as the start of a scroll — so tapping a token-bound field
   * on a tablet did nothing at all. `pointerdown` fires for pen, touch and mouse alike.
   *
   * The `preventDefault` that stops the caret landing in a `readOnly` field is also what
   * stopped the field ever *receiving* focus, so there was no keyboard path either: the
   * field showed a token name and the only way to change it was a 20px badge. Enter and
   * Space now open the same picker, which is what those keys mean on anything that opens
   * something.
   */
  input.addEventListener("pointerdown", (e) => {
    // A locked field is not editable, so a press on it is free to mean the one
    // thing it could usefully mean.
    if (locked && openBound) {
      e.preventDefault();
      // Focus explicitly, since `preventDefault` suppressed it — otherwise closing the
      // picker has nowhere to put focus back (see `popover-host`'s `close`).
      input.focus();
      openBound();
    }
  });
  input.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (locked && openBound && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      ev.stopPropagation();
      openBound();
    }
  });

  input.addEventListener("blur", () => {
    if (skipBlurCommit) {
      skipBlurCommit = false;
      return;
    }
    commit(input.value);
  });

  // -- Keyboard stepping ------------------------------------------------------

  /*
   * Arrow keys step, and a held arrow is one undo step.
   *
   * `keydown` repeats while held, so without the bracket a two-second press
   * leaves sixty entries in the history and ⌘Z walks the value back one pixel
   * at a time. `keyup` closes it — and so does `blur`, because a field that
   * loses focus mid-repeat (the panel rebuilding under it) would otherwise
   * leave the batch open and swallow every later edit into this one step.
   */
  let stepping = false;
  const beginStep = (): void => {
    if (!stepping) {
      stepping = true;
      gestures?.begin?.();
    }
  };
  const endStep = (): void => {
    if (stepping) {
      stepping = false;
      gestures?.end?.();
    }
  };

  function stepBy(up: boolean, e: KeyboardEvent): void {
    if (locked) {
      // Nudging a bound field would mean nudging the token, which is a change
      // to the design system rather than to this element.
      return;
    }
    /*
     * ⇧ ×10, ⌥ ÷10 — the same modifiers the scrub uses, so one piece of muscle
     * memory covers both ways of nudging a number.
     *
     * ⌥ does nothing on an integer field, and must not pretend otherwise: `settle`
     * rounds, so `step / 10` on a `z-index` or a grid track count produced 0.1 and
     * landed back on the value it started from. A key that silently does nothing reads
     * as a broken control, so the fine step falls back to the coarse one where a
     * fraction is not a legal value.
     */
    let delta = step;
    if (e.shiftKey) {
      delta = bigStep;
    } else if (e.altKey) {
      delta = spec.integer ? step : step / 10;
    }
    beginStep();
    // Stepping off a keyword starts from zero, the only number that is never a
    // surprise, and adopts the field's own unit. Off a real value it keeps that
    // value's unit, so ↑ on `50%` gives `51%` rather than jumping to pixels.
    const base = read(current);
    emit(
      formatLength({
        unit: base?.unit || unit,
        value: settle((base?.value ?? 0) + (up ? delta : -delta)),
      })
    );
  }

  input.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter") {
      // Blur commits; see the listener above for why Enter must not.
      input.blur();
      return;
    }
    if (ke.key === "Escape") {
      // Stopped here rather than left to the key registry: inside a field,
      // Escape means "undo my typing", not "close whatever is open".
      ke.stopPropagation();
      reflect(current);
      skipBlurCommit = true;
      input.blur();
      return;
    }
    if (ke.key === "ArrowUp" || ke.key === "ArrowDown") {
      ke.preventDefault();
      stepBy(ke.key === "ArrowUp", ke);
    }
  });
  input.addEventListener("keyup", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "ArrowUp" || key === "ArrowDown") {
      endStep();
    }
  });
  input.addEventListener("blur", endStep);

  // -- Glyph, and the drag on it ----------------------------------------------

  const scrubbable = spec.scrub !== false;
  const glyphText = spec.glyph ?? "";
  const glyphIsIcon = Boolean(glyphText) && hasIcon(glyphText);
  const grip = el(
    "span",
    {
      class: scrubbable
        ? cls("ctl-glyph")
        : `${cls("ctl-glyph")} ${cls("ctl-glyph-static")}`,
      "data-tip": scrubbable ? `${spec.label}, drag to adjust` : spec.label,
    },
    glyphText
      ? [
          glyphIsIcon
            ? icon(glyphText as IconName, "sm")
            : el("span", { class: cls("ctl-glyph-txt"), text: glyphText }),
        ]
      : []
  );

  const children: HTMLElement[] = [grip, input];
  if (spec.suffix) {
    children.push(el("span", { class: cls("ctl-suffix"), text: spec.suffix }));
  }
  const wrap = el("div", { class: cls("ctl-num") }, children);
  if (spec.fieldKey) {
    wrap.dataset.field = spec.fieldKey;
  }
  // On the whole field, not just the glyph, whenever the glyph is a letter or
  // absent: a one-character mark like "W" or "Z" is the only thing naming this
  // control, and hitting a 20px target to find out what it does is not an
  // affordance. An icon glyph carries its own tip and does not need the field
  // to repeat it.
  if (!glyphIsIcon) {
    wrap.dataset.tip = spec.label;
  }

  /*
   * Drag-to-scrub, owned by dnd-kit so the grip inherits the shared activation
   * threshold, pointer-cancel recovery and Escape-to-cancel.
   *
   * The scrub is one undo step, not one per pointermove. `onCommit` lands in
   * `panel.onChange`, which wraps each call in its own `history.batch()` —
   * correct for a typed value, and for a drag it meant a 200-event sweep left
   * 200 undo steps. Bracketing the gesture holds one batch open across all of
   * them. `endScrub` must run on cancel and on teardown as well as on
   * completion: an unbalanced `open()` swallows every later edit in the session.
   */
  const disposers: (() => void)[] = [];
  let draggable: Draggable | null = null;
  let scrubbing = false;
  let modifiers: ReturnType<typeof trackModifiers> | null = null;

  const endScrub = (): void => {
    modifiers?.stop();
    modifiers = null;
    if (scrubbing) {
      scrubbing = false;
      gestures?.end?.();
    }
  };

  if (scrubbable) {
    const id = `${DND.scrub}:${scrubSeq}`;
    scrubSeq += 1;
    draggable = new Draggable(
      {
        element: grip,
        id,
        // No visual feedback — the grip must not travel. Only the x component
        // of the delta is read, which is the horizontal-axis lock.
        plugins: FEEDBACK.none,
        type: DND.scrub,
      },
      manager
    );

    const delta = new DragDelta();
    let startVal = 0;
    let startUnit = unit;
    let before = current;
    const isMine = (): boolean => manager.dragOperation.source?.id === id;

    disposers.push(
      manager.monitor.addEventListener("dragstart", () => {
        if (!isMine() || locked) {
          // Same reason as `stepBy`: a locked field's value is not its own.
          return;
        }
        before = current;
        // Same rule as `stepBy`: a scrub keeps the value's own unit, and starts
        // from zero only when there is no number to start from.
        const base = read(current);
        startVal = clamp(base?.value ?? 0, spec.min, spec.max);
        startUnit = base?.unit || unit;
        delta.start();
        modifiers = trackModifiers();
        if (!scrubbing) {
          scrubbing = true;
          gestures?.begin?.();
        }
      }),
      manager.monitor.addEventListener("dragmove", (e) => {
        // `scrubbing` rather than `isMine` alone: a bound field refuses the
        // dragstart, and without this its moves would still emit — off a
        // `delta` that was never started.
        if (!(isMine() && scrubbing)) {
          return;
        }
        const mods = modifiers?.read();
        let perPx = step;
        if (mods?.shift) {
          perPx = bigStep;
        } else if (mods?.alt) {
          perPx = step / 10;
        }
        emit(
          formatLength({
            unit: startUnit,
            value: settle(startVal + delta.update(e).x * perPx),
          })
        );
      }),
      manager.monitor.addEventListener("dragend", (e) => {
        if (!isMine()) {
          return;
        }
        if (e.canceled) {
          emit(before);
        }
        // After the revert, so a cancelled drag collapses to a no-op step that
        // the change set drops rather than to an open batch.
        endScrub();
      })
    );
  }

  reflect(initial);

  return {
    destroy() {
      // A control torn down mid-gesture (the panel rebuilding under it) would
      // otherwise never close its batch.
      endScrub();
      endStep();
      for (const off of disposers) {
        off();
      }
      draggable?.destroy();
    },
    element: wrap,
    input,
    /**
     * Make the field's text open something.
     *
     * For the bound state: the field shows a token name, and the name is what
     * you would click to change it. Without this the only way in is the badge
     * beside it, which is a 20px target for a decision the field is the
     * headline of.
     */
    onActivate(open) {
      openBound = open;
    },
    /*
     * Show a token in place of the number, without changing the field.
     *
     * The chrome, the glyph, the height and the position in the grid all stay
     * exactly as they are — only the text changes, and a tint says why. A bound
     * field is read-only because its value is the token's; typing into it would
     * mean editing the design system, which is not what this control does. The
     * badge beside it is how the binding is changed or removed.
     */
    setLocked,
    setToken(name) {
      boundToken = name;
      wrap.toggleAttribute("data-token", name !== null);
      // A binding implies a lock: the value is the token's either way.
      setLocked(name !== null);
      if (name === null) {
        reflect(current);
        return;
      }
      input.value = name;
    },
    setValue(css) {
      // Never overwrite a field the user is mid-way through typing into: the
      // panel re-seeds on undo and on canvas resize, and both can land while a
      // caret is sitting in a half-finished number.
      if (document.activeElement === input) {
        current = css;
        return;
      }
      reflect(css);
    },
  };
}

/**
 * Commit on blur and Enter, revert on Escape — for the fields that are *not*
 * numeric and so cannot use `createNumField`: a hex colour, a grid track size
 * that legitimately reads `minmax(120px, 1fr)`, a raw gradient.
 *
 * Escape is handled here rather than through the key registry on purpose: the
 * registry skips non-`allowWhileTyping` bindings while a field has focus, so an
 * open popover's Escape-to-close cannot see it — and should not, because inside
 * a field Escape means "undo my typing". A second press, now unfocused, closes
 * the popover.
 */
export function bindField(
  input: HTMLInputElement,
  commit: () => void,
  revert: () => void
): void {
  /*
   * `skipBlur`, so Escape means cancel.
   *
   * `blur` commits, and every caller's `revert` ends by calling `input.blur()` — so
   * Escape reverted the text and then immediately committed it again. On the grid
   * section's custom-track field, which shows the *computed* `320px 320px 320px`, that
   * meant clicking in and pressing Escape recorded a fixed three-column track list and
   * shipped it to the agent: a responsive grid turned rigid by a keystroke that means
   * "leave it alone".
   *
   * `createNumField` and the CSS pane's rows both already carried this guard.
   */
  let skipBlur = false;
  input.addEventListener("blur", () => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    commit();
  });
  input.addEventListener("keydown", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "Enter") {
      commit();
      input.blur();
    } else if (key === "Escape") {
      e.stopPropagation();
      skipBlur = true;
      revert();
    }
  });
}

/**
 * A bare text field in the panel's field chrome, for the non-numeric cases.
 *
 * Deliberately separate from `createNumField` rather than a mode of it: a grid
 * track reading `minmax(120px, 1fr)` has no min, no step and nothing to drag,
 * and giving it a disabled scrub handle would be a lie about what it does.
 */
export function createTextField(opts: {
  glyph?: IconName | string;
  label: string;
  placeholder?: string;
}): { element: HTMLElement; input: HTMLInputElement } {
  const input = el("input", {
    "aria-label": opts.label,
    class: cls("ctl-input"),
    placeholder: opts.placeholder,
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;
  const glyphText = opts.glyph ?? "";
  const mark = el(
    "span",
    { class: `${cls("ctl-glyph")} ${cls("ctl-glyph-static")}` },
    glyphText
      ? [
          hasIcon(glyphText)
            ? icon(glyphText, "sm")
            : el("span", { class: cls("ctl-glyph-txt"), text: glyphText }),
        ]
      : []
  );
  const element = el("div", { class: cls("ctl-num"), "data-tip": opts.label }, [
    mark,
    input,
  ]);
  return { element, input };
}
