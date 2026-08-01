/**
 * One keyboard-shortcut registry for the whole overlay.
 *
 * Bindings used to live in three files (`picker.ts` owned Escape,
 * `canvas/viewport.ts` owned the zoom set, `app.ts` owned ⌘Enter) with no shared
 * notion of precedence or of "is the user typing right now". Every feature that
 * came after — nudge, undo, delete, tool switching, tooltips that show their own
 * shortcut — needs to answer those questions the same way, so they answer them
 * here.
 *
 * Field-local Enter/Escape handlers are deliberately *not* migrated: they belong
 * to the input they commit, and routing them through a global registry would
 * mean every text field had to re-declare itself.
 */
import { PREFIX } from "./dom";

/** True on Apple platforms, where `mod` means ⌘ rather than Ctrl. */
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** `KeyboardEvent.code` for the layout-independent digit and letter rows. */
const DIGIT_CODE = /^Digit(\d)$/;
const LETTER_CODE = /^Key([A-Z])$/;

export interface Binding {
  /** Fire even while a text field has focus. Rare; ⌘Enter is the real case. */
  allowWhileTyping?: boolean;
  /**
   * A normalised chord, or several separated by commas: `"mod+z"`,
   * `"shift+arrowleft"`, `"v"`, `"mod+=, mod+plus"`. Modifiers are `mod`
   * (⌘ on macOS, Ctrl elsewhere), `alt` and `shift`, always in that order.
   */
  keys: string;
  /** Human-readable action name. Doubles as the tooltip lookup key. */
  label: string;
  run: (e: KeyboardEvent) => void;
  /** Skip this binding when the guard returns false — e.g. nothing selected. */
  when?: () => boolean;
  /**
   * Only fire for keystrokes originating inside this element.
   *
   * What lets a popover own its keys. An open popover suppresses every binding
   * that is not scoped — a shortcut firing under it acts on something the user
   * cannot see — while the bindings scoped to it still run. Scoping to the
   * element rather than flagging "I am a popover" is what keeps nested
   * popovers honest: children are siblings in the host, not descendants, so an
   * outer menu's `within` cannot contain an inner one's rows and its roving
   * keys stay out of the way.
   */
  within?: HTMLElement;
}

/**
 * Is the target inside a popover the editor has open?
 *
 * The popover owns its own keys, and a global shortcut firing underneath it acts
 * on something the user cannot see. So this suppresses every binding that has not
 * scoped itself with `within` — deliberately *not* the same thing as typing,
 * which suppresses scoped and unscoped alike so a field keeps its own Escape.
 *
 * Exported for `canvas/viewport.ts`, whose space-to-pan is a raw listener rather
 * than a binding and so has to ask the same question for itself.
 */
export function isInsidePopover(target: EventTarget | null): boolean {
  const node = target as Element | null;
  return Boolean(node?.closest?.(`.${PREFIX}-pop`));
}

/** Is the user typing? Shortcuts must not fire inside the composer. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node?.tagName) {
    return false;
  }
  const tag = node.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || node.isContentEditable;
}

/**
 * The physical key, independent of layout and of what shift did to it.
 *
 * `e.key` alone is not enough: on a US layout ⇧1 arrives as `"!"`, so a binding
 * written as `shift+1` would never match. Reading the digit and letter rows off
 * `e.code` keeps chords stable across layouts and shift states, which is exactly
 * what the old hand-rolled `e.key === "!" || e.code === "Digit1"` pairs in
 * viewport.ts were working around.
 */
function physicalKey(e: KeyboardEvent): string {
  const digit = DIGIT_CODE.exec(e.code);
  if (digit) {
    return digit[1];
  }
  const letter = LETTER_CODE.exec(e.code);
  if (letter) {
    return letter[1].toLowerCase();
  }
  switch (e.code) {
    case "Equal":
      return "=";
    case "Minus":
      return "-";
    case "Space":
      return "space";
    default:
      return e.key.toLowerCase();
  }
}

/** `"mod+shift+z"` — the canonical form both sides of the match agree on. */
function chordOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (IS_MAC ? e.metaKey : e.ctrlKey) {
    parts.push("mod");
  }
  if (e.altKey) {
    parts.push("alt");
  }
  if (e.shiftKey) {
    parts.push("shift");
  }
  parts.push(physicalKey(e));
  return parts.join("+");
}

/** Split a binding's `keys` into the individual chords it answers to. */
function chordsOf(spec: string): string[] {
  return spec
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

const DISPLAY: Record<string, string> = {
  alt: IS_MAC ? "⌥" : "Alt",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  backspace: IS_MAC ? "⌫" : "Backspace",
  delete: "Del",
  enter: IS_MAC ? "↩" : "Enter",
  escape: "Esc",
  mod: IS_MAC ? "⌘" : "Ctrl",
  shift: IS_MAC ? "⇧" : "Shift",
  space: "Space",
};

/** `"mod+shift+z"` → `"⌘⇧Z"` (mac) or `"Ctrl+Shift+Z"`. */
function displayChord(chord: string): string {
  const parts = chord.split("+").map((p) => DISPLAY[p] ?? p.toUpperCase());
  return IS_MAC ? parts.join("") : parts.join("+");
}

export class Keys {
  /** Newest first, so a later binding shadows an earlier one on the same chord. */
  private readonly bindings: Binding[] = [];
  private listening = false;
  /** Frame documents this registry also listens in. See `observe`. */
  private readonly observed = new Set<Document>();

  /** Register a binding. Returns a disposer. */
  bind(binding: Binding): () => void {
    this.bindings.unshift(binding);
    this.listen();
    return () => {
      const i = this.bindings.indexOf(binding);
      if (i !== -1) {
        this.bindings.splice(i, 1);
      }
    };
  }

  /** Register several at once; the disposer removes all of them. */
  bindAll(bindings: Binding[]): () => void {
    const offs = bindings.map((b) => this.bind(b));
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }

  /** The display string for an action, for tooltips. `null` if unbound. */
  hintFor(label: string): string | null {
    const found = this.bindings.find((b) => b.label === label);
    if (!found) {
      return null;
    }
    const [first] = chordsOf(found.keys);
    return first ? displayChord(first) : null;
  }

  private listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    // Capture phase, like the picker's own handler was: the host app may stop
    // propagation on its own listeners, and the editor's shortcuts have to win
    // over the page it is editing.
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  /**
   * Also listen in a frame's own document.
   *
   * A keydown inside a same-origin iframe does not reach the shell's `document`, so
   * every shortcut was dead while focus was in the app — including Escape, which is
   * what closes an open popover. `text-edit.ts` already worked around this by binding
   * to `ownerWindow(node)`; this makes it the registry's job instead, so one binding
   * table serves both realms.
   *
   * Idempotent per document, and the returned disposer is what a frame calls when it
   * unloads.
   */
  observe(doc: Document): () => void {
    if (doc === document || this.observed.has(doc)) {
      return () => undefined;
    }
    this.observed.add(doc);
    doc.addEventListener("keydown", this.onKeyDown, true);
    return () => {
      this.observed.delete(doc);
      doc.removeEventListener("keydown", this.onKeyDown, true);
    };
  }

  /**
   * Release every listener.
   *
   * There was no teardown at all and `listening` was never reset, so an overlay torn
   * down and rebuilt in the same page — which `?__airship=inline` does on every HMR
   * cycle — left the old registry's capture-phase handler on `document`, still matching
   * chords and still calling `preventDefault` for bindings whose `when()` closed over a
   * dead panel.
   */
  destroy(): void {
    if (this.listening) {
      document.removeEventListener("keydown", this.onKeyDown, true);
      this.listening = false;
    }
    for (const doc of this.observed) {
      doc.removeEventListener("keydown", this.onKeyDown, true);
    }
    this.observed.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const chord = chordOf(e);
    const target = e.target as Node | null;
    const typing = isTypingTarget(e.target);
    /*
     * A keystroke inside an open popover belongs to the popover.
     *
     * `isTypingTarget` only recognises inputs, so focus resting on a colour picker's
     * swatch trigger or one of its sliders read as "not typing" and the canvas nudge
     * bindings fired: open the picker, press → four times, and the element slid 4px
     * across the canvas while nothing in the picker changed. The popover's own handlers
     * `stopPropagation`, but they run in the bubble phase and this listener is capture.
     *
     * Kept apart from `typing` rather than folded into it, which is how this
     * started: one flag skipped every binding without `allowWhileTyping`, and
     * the popover's *own* Escape and roving keys are registered here too and
     * carry no such flag — so they suppressed themselves and every menu in the
     * overlay lost its keyboard. `within` is what tells the two apart.
     */
    const inPopover = isInsidePopover(e.target);
    for (const b of this.bindings) {
      if (typing && !b.allowWhileTyping) {
        continue;
      }
      // A scoped binding never fires outside the subtree it belongs to...
      if (b.within && !b.within.contains(target)) {
        continue;
      }
      // ...and inside a popover, only scoped bindings fire at all: an unscoped
      // one would act on something standing behind what the user is looking at.
      if (inPopover && !b.within) {
        continue;
      }
      if (!chordsOf(b.keys).includes(chord)) {
        continue;
      }
      if (b.when && !b.when()) {
        continue;
      }
      // A binding that matched owns the event. Anything that wants to fall
      // through to a lower binding should say so with `when()`, not by
      // declining inside `run` — otherwise precedence stops being inspectable.
      e.preventDefault();
      e.stopPropagation();
      b.run(e);
      return;
    }
  };
}

/**
 * The overlay's registry. A singleton because the document has exactly one
 * keyboard and both stages (inline and canvas) share it.
 */
export const keys = new Keys();
