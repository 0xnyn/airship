/*
 * The editor's one line of feedback.
 *
 * **A module singleton, not an injected dep.** `keys/registry.ts` ("a singleton because
 * the document has exactly one keyboard") and `dnd/manager.ts` are already
 * imported directly from everywhere, and a toast is the same shape of thing:
 * one document, one place feedback appears, one at a time. Threading an
 * `onToast` through `FrameChromeDeps`, `DesignPanelDeps` and `HistoryDeps` would
 * be three new plumbing paths for a function with no per-instance state. The
 * deps that *are* injected — `applyStyle`, `refresh` — exist to keep models from
 * knowing about the DOM; this is the DOM, and it has nothing to invert.
 *
 * **One persistent element, visibility by class.** The node is built on first
 * use and never removed; `toast-in` toggles opacity and offset. That single
 * choice is what makes both of the hard requirements fall out: replacing a live
 * toast is `replaceChildren()` on a node that never left the layout — no
 * unmount/remount flicker when ⌘Z is held down — and coalescing a repeat is a
 * counter plus a text rewrite on something already on screen. The previous
 * implementation appended a fresh `<div>` per call at identical fixed
 * coordinates, so two toasts in the same 2.6 seconds rendered on top of each
 * other and neither could be read.
 *
 * ---
 *
 * **What earns a toast.** Raise one when the editor changed state and the change
 * is not legible from the change itself. Never for a continuous or dragged
 * gesture — the motion is the feedback, and a toast per `pointermove` would
 * render `Resized ×212`. Never for what a control's own state already reports: a
 * pressed tool, a dimmed button, a field showing its new value, a zoom readout.
 * Never for anything the user typed; they know what they typed.
 *
 * Three clauses that are not about legibility:
 *
 * - **Refusals get a toast even though nothing changed**, because "nothing
 *   changed" is precisely what needs explaining. A button has a disabled state
 *   to lean on. A keyboard shortcut has nothing.
 * - **Acts the undo stack does not cover get one even when they are legible**,
 *   because the message is not "this happened" but "this happened and ⌘Z will
 *   not take it back".
 * - **Some of those can carry their own undo.** `ToastOptions.action` puts a
 *   real button on the toast, and a frame delete is the first caller. `History`
 *   journals element ops and nothing else; teaching it a frame op would put the
 *   model that replays DOM mutations in charge of rebuilding an iframe realm,
 *   which is not a thing a journal can honestly claim to reverse. So the
 *   affordance lives on the receipt instead, and lives exactly as long as it
 *   does. That bargain is the whole reason an actionable toast dwells more than
 *   twice as long and never coalesces — see `ACTION_DWELL` and `repeat`.
 *
 * **Which layer raises it:** whichever one holds the information the message
 * contains. That is why element deletes speak from `DesignPanel` (only it has
 * the node to name, and only it knows whether its own guard refused), why frame
 * verbs speak from `FrameChrome` rather than from `FrameManager` (the manager is
 * also driven by first-run seeding and by every frame of a resize drag) — and,
 * now that a frame delete can be reached from the frame's own menu, from the bar
 * group and from ⌫, from a *single* closure there rather than three, so that
 * neither the receipt nor the undo can depend on which door you came through —
 * and why undo speaks from `AirshipApp` rather than from `History` (the model
 * returns a boolean and lets the caller decide whether an empty stack is worth
 * saying out loud).
 */
import { cls, el } from "./dom";
import { type IconName, icon } from "./icons";

export type ToastTone = "error" | "neutral";

/** An affordance on the toast itself. See the third clause of the header. */
export interface ToastAction {
  /** The button's text. One imperative word — "Undo". */
  label: string;
  run: () => void;
}

export interface ToastOptions {
  /** Put a button on the toast. Implies `ACTION_DWELL` and suppresses `×N`. */
  action?: ToastAction;
  /** Dwell before the fade-out begins. Defaults to `DWELL`. */
  duration?: number;
  /** Leading glyph. `error` supplies `close` on its own; pass this to override. */
  icon?: IconName;
  tone?: ToastTone;
}

/** How long a toast stays at full opacity. */
const DWELL = 2600;

/**
 * The dwell for a toast you are expected to *aim at*.
 *
 * 2.6s is right for a receipt: long enough to read, short enough to stay out of
 * the way. It is not long enough to notice a button, decide, move the pointer
 * and hit it — the affordance would expire under the cursor about as often as it
 * worked. This is the low end of the usual guidance for actionable snackbars;
 * much longer and a toast nobody wants starts loitering over the canvas.
 */
const ACTION_DWELL = 6000;

/** Must match the `transition` duration in `styles/toast.css.ts`. */
const FADE = 140;

interface LiveToast {
  /** The affordance, or null for a plain receipt. */
  action: ToastAction | null;
  count: number;
  /** True once the dwell has expired and the fade-out is running. */
  fading: boolean;
  message: string;
  /** True once the action has been run, so a second click does nothing. */
  spent: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  tone: ToastTone;
}

let host: HTMLElement | null = null;
/**
 * The one toast element, created on first use and never removed.
 *
 * Deliberately *not* a field on `live`. `live` describes the message currently
 * being shown and is nulled when one expires; hanging the element off it would
 * mean every toast after the first expiry appended a fresh `<div>` at the same
 * fixed coordinates — reintroducing, one fade-out later, exactly the pile-up
 * this module was written to remove.
 */
let node: HTMLElement | null = null;
let live: LiveToast | null = null;

/**
 * Mount the singleton host. Called once from `AirshipApp.mount`, deliberately
 * ahead of `mountPopoverHost` so the popover host stays the root's last child —
 * which is hygiene rather than the mechanism, since both declare a numeric
 * `z-index` (see `styles/const.ts`).
 */
export function mountToastHost(root: HTMLElement): HTMLElement {
  host ??= el("div", { class: cls("toast-host") });
  root.append(host);
  return host;
}

/**
 * Raise a toast.
 *
 * Replaces whatever is currently up and restarts its dwell. An identical
 * message arriving while the same one is still at full opacity becomes a count
 * instead of a replacement.
 */
export function toast(message: string, opts: ToastOptions = {}): void {
  const mount = host;
  if (!mount) {
    return;
  }
  const tone: ToastTone = opts.tone ?? "neutral";
  const glyph = opts.icon ?? (tone === "error" ? "close" : undefined);
  const action = opts.action ?? null;

  // Not coalescing across a fade-out is deliberate: once a toast has started
  // leaving, the next one is a new event, and a counter that picks up again
  // across the gap reads as a bug rather than as a tally.
  //
  // An actionable toast never coalesces at all, in either direction. A count is
  // a tally over one event repeated; an action is a handle on one *specific*
  // event. `Deleted Frame 3 ×2` would carry a single Undo that restores the
  // second frame while claiming to speak for both — and would drop the first
  // frame's restore closure on a message the user watched not change, so nothing
  // on screen would say that half of what it names is now unrecoverable. Two
  // deletes therefore make two toasts, the second replacing the first, and only
  // the second is recoverable. The toast is the undo stack, and it is one deep.
  const repeat =
    live !== null &&
    !live.fading &&
    live.message === message &&
    live.tone === tone &&
    live.action === null &&
    action === null;

  const box = ensureNode(mount);
  if (live?.timer) {
    clearTimeout(live.timer);
  }
  // A fresh record every time, even on a repeat. The timers close over the one
  // they were armed for and bail if `live` has moved on since — an identity
  // check that only means something if each call really is a new identity.
  const current: LiveToast = {
    action,
    count: repeat && live ? live.count + 1 : 1,
    fading: false,
    message,
    spent: false,
    timer: null,
    tone,
  };
  live = current;
  if (!repeat) {
    box.classList.toggle(cls("toast-error"), tone === "error");
  }
  render(box, current, glyph);
  show(box);
  current.timer = setTimeout(
    () => startFade(current, box),
    opts.duration ?? (action ? ACTION_DWELL : DWELL)
  );
}

function ensureNode(mount: HTMLElement): HTMLElement {
  if (node) {
    return node;
  }
  // `role="status"` implies `aria-live="polite"`. The `×N` rewrite re-announces
  // on every repeat, which is the accepted cost of having the counter at all —
  // the alternative is a burst of undos that says nothing after the first.
  node = el("div", { class: cls("toast"), role: "status" });
  mount.append(node);
  return node;
}

/**
 * Takes the record rather than three of its fields.
 *
 * The action is the fourth thing to render and every one of them already lives
 * on `current`; four positionals describing one object that is right there is
 * the point at which the object should be the argument.
 */
function render(
  box: HTMLElement,
  current: LiveToast,
  glyph: IconName | undefined
): void {
  const children: (HTMLElement | string)[] = [];
  if (glyph) {
    children.push(icon(glyph, "sm"));
  }
  children.push(el("span", { text: current.message }));
  if (current.count > 1) {
    children.push(
      el("span", { class: cls("toast-count"), text: `×${current.count}` })
    );
  }
  if (current.action) {
    children.push(actionButton(current, box));
  }
  box.replaceChildren(...children);
}

/**
 * The affordance, as a real button.
 *
 * Not a clickable span: this is Tab-reachable, answers Enter and Space, and
 * takes its accessible name from its own text. Deliberately *not* autofocused —
 * stealing focus for a six-second affordance is worse than making the user reach
 * for it, and the toast host is late enough in the root that one Tab from the
 * canvas lands here anyway.
 */
function actionButton(current: LiveToast, box: HTMLElement): HTMLElement {
  return el("button", {
    class: cls("toast-action"),
    onClick: () => runAction(current, box),
    text: current.action?.label ?? "",
    type: "button",
  });
}

/**
 * Run the affordance, once.
 *
 * Two guards answering two different questions. `spent` stops a second click on
 * the button that is still on screen. The identity check stops a click on a
 * button belonging to a toast that has already moved on — `replaceChildren`
 * detaches the old one, but a press already in flight, and the whole `FADE`
 * during which the node is still there and still clickable, both reach this
 * closure. Same `live !== current` idiom the two timers use, and for the same
 * reason.
 */
function runAction(current: LiveToast, box: HTMLElement): void {
  const { action } = current;
  if (current.spent || live !== current || !action) {
    return;
  }
  current.spent = true;
  if (current.timer) {
    clearTimeout(current.timer);
  }
  // Fade first, run second. The action may raise a toast of its own — a refusal
  // — and `toast()` replaces `live`, at which point this fade's own teardown
  // bails on its identity check and the new message is left standing.
  startFade(current, box);
  action.run();
}

function show(box: HTMLElement): void {
  if (box.classList.contains(cls("toast-in"))) {
    return;
  }
  // The node is never `display: none` — only `opacity: 0` — so a class toggle
  // transitions correctly on every toast but the first, where the element was
  // appended in this same tick and has no computed style to transition *from*.
  // Measuring forces the layout that gives it one.
  box.getBoundingClientRect();
  box.classList.add(cls("toast-in"));
}

/**
 * Begin the fade-out, and arm the teardown behind it.
 *
 * Two timers rather than a `transitionend` listener. An interrupted transition —
 * a new toast arriving mid-fade — never fires `transitionend`, so the listener
 * would either leak or, worse, fire late and erase the *replacement*. A timer
 * that a later `toast()` call simply clears has neither failure mode.
 */
function startFade(current: LiveToast, box: HTMLElement): void {
  if (live !== current) {
    return;
  }
  current.fading = true;
  box.classList.remove(cls("toast-in"));
  current.timer = setTimeout(() => {
    if (live !== current) {
      return;
    }
    // The element stays; only its contents and the live state go. Removing it
    // would mean rebuilding — and re-mounting — on the next toast.
    box.replaceChildren();
    box.classList.remove(cls("toast-error"));
    live = null;
  }, FADE);
}
