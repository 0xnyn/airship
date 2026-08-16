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
 * What a binding carries is `run`, `when` and `within`. The chord, the name and
 * everything a reader needs comes from `./catalog`, keyed by a typed `id`. That
 * split is what lets the shortcuts panel, the command palette and
 * `CONTROLS.md` all be generated from the same table the runtime uses, and what
 * makes a mistyped shortcut a compile error instead of a dead key.
 *
 * Field-local Enter/Escape handlers are deliberately *not* migrated: they belong
 * to the input they commit, and routing them through a global registry would
 * mean every text field had to re-declare itself. See the note in `catalog.ts`.
 */
import { PREFIX } from "../dom";
import {
  ALL_COMMANDS,
  type ChordPlatform,
  type Command,
  type CommandId,
  commandSpec,
  displayChord,
  displayChordParts,
} from "./catalog";

/**
 * True on Apple platforms, where `mod` means ⌘ rather than Ctrl.
 *
 * `userAgentData.platform` first: `navigator.platform` is deprecated and frozen
 * on some engines. Both are read defensively because this module is imported by
 * tests running under happy-dom, where either may be absent.
 */
const APPLE_PLATFORM = /mac|iphone|ipad/i;

function detectMac(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const source =
    nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? "";
  return APPLE_PLATFORM.test(source);
}

const IS_MAC = detectMac();

/** The glyph set this browser should be shown chords in. */
export const PLATFORM: ChordPlatform = IS_MAC ? "mac" : "pc";

/** `KeyboardEvent.code` for the layout-independent digit and letter rows. */
const DIGIT_CODE = /^Digit(\d)$/;
const LETTER_CODE = /^Key([A-Z])$/;

/**
 * Codes whose physical identity matters more than the character they produce.
 *
 * `Slash` is here for `?` (the shortcuts panel), and the two numpad keys because
 * a numeric keypad's `+` and `−` are the ones a lot of people reach for to zoom
 * and they arrive under names nothing else would match.
 */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Equal: "=",
  Minus: "-",
  NumpadAdd: "numpadadd",
  NumpadSubtract: "numpadsubtract",
  Slash: "/",
  Space: "space",
};

/** Text-entry input types. Everything else in an `<input>` is a widget. */
const TEXT_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

/** Roles that mean "a text field built out of a div". */
const TEXT_ROLES = new Set(["combobox", "searchbox", "textbox"]);

/**
 * Bare keys that a native control legitimately owns.
 *
 * A `<select>`'s arrows change the option, a range's arrows move the thumb, a
 * checkbox's space toggles it. Suppressing a shortcut for these is right; doing
 * it for Escape or a ⌘-chord is not, which is why this is a separate question
 * from `isTypingTarget` rather than a wider version of it.
 */
const NATIVE_KEYS = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "end",
  "enter",
  "home",
  "space",
]);

export interface Binding {
  /** Which command this implements. The chord comes from the catalog. */
  readonly id: CommandId;
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

/** A command that would fire right now, as the palette lists it. */
export interface LiveCommand {
  readonly run: () => void;
  readonly spec: Command;
}

/**
 * The deepest node the event actually came from.
 *
 * `e.target` is retargeted to the shadow *host* for an event that crossed a
 * shadow boundary, so a real `<input>` inside a host app's web component read
 * as its host and `isTypingTarget` said no — meaning Backspace deleted the
 * selected element while the user was typing into their own form.
 */
function originOf(e: Event): EventTarget | null {
  return e.composedPath?.()[0] ?? e.target;
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

/**
 * Is the user entering text? Shortcuts must not fire inside the composer.
 *
 * Duck-typed on `tagName` and `type` rather than `instanceof HTMLElement`,
 * because with `observe()` live the node can come from a frame's realm, where
 * `instanceof` is false for a perfectly ordinary input. See `realm.ts`.
 */
export function isTypingTarget(
  target: EventTarget | null,
  e?: KeyboardEvent
): boolean {
  // An IME candidate window is mid-composition; those keystrokes are the user
  // spelling a character, never a chord. `keyCode === 229` is the same signal
  // on Safari and older WebKit, where `isComposing` is unreliable.
  if (e?.isComposing || e?.keyCode === 229) {
    return true;
  }
  const node = target as HTMLElement | null;
  if (!node?.tagName) {
    return false;
  }
  const tag = node.tagName.toLowerCase();
  if (tag === "textarea") {
    return true;
  }
  if (tag === "input") {
    // A missing `type` is `text`. Everything not in the set — checkbox, radio,
    // range, button, submit, colour, file — is a widget, and treating those as
    // "typing" suppressed *every* shortcut including Escape while one had focus.
    return TEXT_INPUT_TYPES.has(
      (node as HTMLInputElement).type?.toLowerCase() || "text"
    );
  }
  if (node.isContentEditable) {
    return true;
  }
  const role = node.getAttribute?.("role");
  return Boolean(role && TEXT_ROLES.has(role));
}

/**
 * Does this control own the plain navigation and activation keys itself?
 *
 * Asked only of bare arrows, Home, End, Enter and Space — a modified chord is
 * never a native control's business. Splitting this out of `isTypingTarget` is
 * what lets a focused checkbox pass Escape and ⌘Z through while a focused
 * `<select>` still gets its own arrow keys.
 */
export function isNativeKeyTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node?.tagName) {
    return false;
  }
  const tag = node.tagName.toLowerCase();
  if (tag === "select" || tag === "option") {
    return true;
  }
  return tag === "input";
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
  return CODE_KEYS[e.code] ?? e.key.toLowerCase();
}

/**
 * `"mod+shift+z"` — the canonical form both sides of the match agree on, or `""`
 * for a keystroke no binding may claim.
 *
 * `mod` is Command on a Mac and Control everywhere else, which leaves the *other*
 * one with no place in the vocabulary. Ignoring it rather than rejecting it is
 * what made `⌃←` on a Mac produce the bare chord `arrowleft`: the registry ran
 * `element.nudge` and, because a match always `preventDefault`s, swallowed the
 * Mission Control gesture on the way. `⌃⌫` deleted the selection and `⌃F` opened
 * the device picker for the same reason.
 *
 * There is no chord in the catalog that wants the off-platform modifier, so an
 * empty string is the whole answer: it matches nothing and leaves the keystroke
 * to the OS and the page.
 */
function chordOf(e: KeyboardEvent): string {
  if (IS_MAC ? e.ctrlKey : e.metaKey) {
    return "";
  }
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

/** A chord with no modifiers, whose key a native control might want. */
function isBareNativeChord(chord: string): boolean {
  return NATIVE_KEYS.has(chord);
}

/** Scoped beats modal beats normal. Lower wins. */
function rankOf(binding: Binding): number {
  if (binding.within) {
    return 0;
  }
  return commandSpec(binding.id).priority === "modal" ? 1 : 2;
}

/** What one keystroke needs to know about where it came from. */
interface Origin {
  chord: string;
  /** From a frame's own document rather than the shell's. */
  foreign: boolean;
  inPopover: boolean;
  native: boolean;
  target: Node | null;
  typing: boolean;
}

export class Keys {
  /** Newest first, so a later binding shadows an earlier one at the same rank. */
  private readonly bindings: Binding[] = [];
  private listening = false;
  /**
   * Frame documents this registry also listens in.
   *
   * Weak: `shell-app.ts` prunes a dead frame's subscriptions precisely so its
   * realm can be collected, and a strong `Set` here would have pinned every
   * document a session ever mounted. Membership is only used for idempotence;
   * the listeners themselves are released through the disposer `observe`
   * returns.
   */
  private readonly observed = new WeakSet<Document>();
  /**
   * One release per live `observe()`, so `destroy()` can let go of frame
   * documents it has no other way to enumerate — a `WeakSet` cannot be walked,
   * and holding the documents in a real `Set` to make it walkable would pin
   * every frame the overlay ever showed.
   */
  private readonly unobserve: (() => void)[] = [];
  /**
   * Torn down. Checked on every keystroke rather than trusted to listener
   * removal, because a frame that navigated away takes its document — and any
   * chance of removing a listener from it — with it.
   */
  private dead = false;

  /** Register a binding. Returns a disposer. */
  bind(binding: Binding): () => void {
    this.bindings.unshift(binding);
    this.dead = false;
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

  /**
   * The primary chord for a command, as a tooltip chip shows it.
   *
   * Same three-step preference as `chords` and as `gen-controls.mjs`, and for
   * the same reason: a `display` override exists precisely because the literal
   * chord reads badly, so a surface that ignores it puts the spelling the
   * override was written to replace back on screen. This read `keys[0]`
   * directly, so the bar's ? button showed a ⇧/ chip while the sheet it opens,
   * the palette, `CONTROLS.md` and the README all said `?` — the one command
   * with both a `display` and a control naming it.
   *
   * `primary` before `keys` for the same reason `chords` prefers it: zoom's
   * first bound chord is not the one you would teach someone.
   */
  hint(id: CommandId): string | null {
    const spec = commandSpec(id);
    if (spec.display) {
      return spec.display;
    }
    const [first] = spec.primary ?? spec.keys;
    return first ? displayChord(first, PLATFORM) : null;
  }

  /**
   * Every chord a command answers to.
   *
   * The panel shows all of them. `hint` shows one, which is why Redo used to
   * advertise only ⌘⇧Z and Zoom-to-100% only ⌘0 — the very spelling the README
   * documented, ⇧0, was invisible in the product.
   */
  chords(id: CommandId): string[] {
    const spec = commandSpec(id);
    if (spec.display) {
      return [spec.display];
    }
    // `primary` where one is declared: zoom answers to six real keystrokes and
    // a panel row showing all six is noise, not thoroughness.
    return (spec.primary ?? spec.keys).map((k) => displayChord(k, PLATFORM));
  }

  /**
   * The same list, split into the keys you press — `[["⌘", "⇧", "Z"], ["⌘", "Y"]]`.
   *
   * For the two discovery surfaces, which render a chip per key rather than one
   * chip per chord. A `display` override is deliberately *not* split: it exists
   * because the literal spelling reads badly, so it is a phrase somebody wrote
   * ("?", "← → ↑ ↓") rather than a chord to take apart.
   */
  chordParts(id: CommandId): string[][] {
    const spec = commandSpec(id);
    if (spec.display) {
      return [[spec.display]];
    }
    return (spec.primary ?? spec.keys).map((k) =>
      displayChordParts(k, PLATFORM)
    );
  }

  /** Is this command bound at all right now? */
  isBound(id: CommandId): boolean {
    return this.bindings.some((b) => b.id === id);
  }

  /**
   * Every command that would fire if its chord were pressed now.
   *
   * The palette's input, and the reason no mode enum was needed: the `when`
   * closures are pure predicates that each subsystem already maintains, so
   * asking all of them at once *is* the live answer. A command nothing bound —
   * the zoom set on the inline surface, where there is no viewport — is simply
   * absent, which is correct rather than something to filter.
   *
   * Catalog order, so the palette's grouping matches the panel's.
   */
  available(): LiveCommand[] {
    const out: LiveCommand[] = [];
    for (const spec of ALL_COMMANDS) {
      if (spec.hidden) {
        continue;
      }
      const hit = this.bindings.find(
        (b) => b.id === spec.id && !b.within && b.when?.() !== false
      );
      if (hit) {
        out.push({ run: () => hit.run(syntheticEvent()), spec });
      }
    }
    return out;
  }

  /** Run a command by id. False if nothing is bound, or its guard declines. */
  run(id: CommandId): boolean {
    const hit = this.bindings.find(
      (b) => b.id === id && b.when?.() !== false && !b.within
    );
    if (!hit) {
      return false;
    }
    hit.run(syntheticEvent());
    return true;
  }

  /**
   * Chords that more than one *currently bound* command would answer to.
   *
   * A diagnostic, surfaced in the shortcuts panel rather than logged: this
   * module ships inside somebody else's page and has no business writing to
   * their console. `catalog.test.ts` asks the same question statically, where
   * it can fail a build; this one catches a pair that only overlaps once both
   * are actually bound.
   */
  conflicts(): { chord: string; ids: CommandId[] }[] {
    const byChord = new Map<string, Set<CommandId>>();
    for (const b of this.bindings) {
      const spec = commandSpec(b.id);
      // Guards included, which is the difference between a diagnostic and
      // noise. Several pairs share a chord on purpose and are told apart by
      // mutually exclusive `when`s — Escape is Deselect in edit mode and Put
      // the Hand down in view mode, and `element.delete`/`frame.delete` are the
      // same arrangement on ⌫. Those are the design, not a clash.
      if (b.within || spec.scoped || b.when?.() === false) {
        continue;
      }
      for (const chord of spec.keys) {
        const seen = byChord.get(chord) ?? new Set<CommandId>();
        seen.add(b.id);
        byChord.set(chord, seen);
      }
    }
    const out: { chord: string; ids: CommandId[] }[] = [];
    for (const [chord, ids] of byChord) {
      if (ids.size > 1) {
        out.push({ chord, ids: [...ids] });
      }
    }
    return out;
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
   * A keydown inside a same-origin iframe does not reach the shell's `document`,
   * so every shortcut was dead while focus was in the app — including Escape, which
   * is what closes an open popover. `text-edit.ts` already worked around this by
   * binding to `ownerWindow(node)`; this makes it the registry's job instead, so one
   * binding table serves both realms.
   *
   * Only commands marked `inFrame` are routed from here. Focus reaches a frame
   * in view mode, where the page is the user's and they may be typing into it —
   * so Escape and the zoom keys are welcome and `f`, `h`, `v` and `i` would be
   * theft. The filter is in `originFor`, not here, because a shell keystroke
   * must still reach everything.
   *
   * Idempotent per document, and the returned disposer is what a frame calls when it
   * unloads.
   */
  observe(doc: Document): () => void {
    if (doc === document || this.observed.has(doc)) {
      return () => undefined;
    }
    this.observed.add(doc);
    this.dead = false;
    doc.addEventListener("keydown", this.onKeyDown, true);
    const release = (): void => {
      this.observed.delete(doc);
      doc.removeEventListener("keydown", this.onKeyDown, true);
      const at = this.unobserve.indexOf(release);
      if (at !== -1) {
        this.unobserve.splice(at, 1);
      }
    };
    this.unobserve.push(release);
    return release;
  }

  /**
   * Release every listener and forget every binding.
   *
   * There was no teardown at all and `listening` was never reset, so an overlay torn
   * down and rebuilt in the same page — which `?__airship=inline` does on every HMR
   * cycle — left the old registry's capture-phase handler on `document`, still matching
   * chords and still calling `preventDefault` for bindings whose `when()` closed over a
   * dead panel.
   */
  destroy(): void {
    this.dead = true;
    this.bindings.length = 0;
    // Every observed frame document, not just `document`. These came off in
    // practice only because `AirshipApp.destroy` happens to run `stage.destroy`
    // — which disposes the frame subscriptions — before it gets here, an
    // ordering dependency nothing stated and nothing enforced. Each release also
    // drops the document from `observed`, which matters as much as removing the
    // listener: `observe()` hands back a no-op for a `Document` it already
    // holds, so a stale entry would make re-observing that frame never
    // re-attach. `splice(0)` because each release splices itself out.
    for (const release of this.unobserve.splice(0)) {
      release();
    }
    if (this.listening) {
      document.removeEventListener("keydown", this.onKeyDown, true);
      this.listening = false;
    }
  }

  private eligible(b: Binding, o: Origin): boolean {
    const spec = commandSpec(b.id);
    if (o.typing && !spec.allowWhileTyping) {
      return false;
    }
    // A scoped binding never fires outside the subtree it belongs to...
    if (b.within && !b.within.contains(o.target)) {
      return false;
    }
    // ...and inside a popover, only scoped bindings fire at all: an unscoped
    // one would act on something standing behind what the user is looking at.
    if (o.inPopover && !b.within) {
      return false;
    }
    // A keystroke from inside a live frame belongs to the user's own page
    // unless the command explicitly says otherwise.
    if (o.foreign && !spec.inFrame) {
      return false;
    }
    // A native control keeps the bare keys it implements itself.
    if (o.native && isBareNativeChord(o.chord) && !b.within) {
      return false;
    }
    if (!spec.keys.includes(o.chord)) {
      return false;
    }
    return b.when?.() !== false;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.dead) {
      return;
    }
    // Mid-composition, every keystroke belongs to the IME — including ⌘↵, which
    // is the Enter that commits a candidate rather than the one that sends a
    // message. This is the single case `allowWhileTyping` must not punch
    // through, which is why it is here and not folded into `eligible`.
    if (e.isComposing || e.keyCode === 229) {
      return;
    }
    // No binding declares the empty chord, so this only saves a pass over the
    // table — but it is also where the off-platform modifier stops, and that is
    // worth being able to point at.
    const chord = chordOf(e);
    if (!chord) {
      return;
    }
    const origin = originOf(e);
    const node = origin as Node | null;
    const o: Origin = {
      chord,
      foreign: Boolean(node?.ownerDocument && node.ownerDocument !== document),
      inPopover: isInsidePopover(origin),
      native: isNativeKeyTarget(origin),
      target: node,
      typing: isTypingTarget(origin, e),
    };

    // One pass, keeping the lowest rank seen. `bindings` is newest-first and
    // the comparison is strict, so within a rank the newest still wins — but
    // across ranks a scoped or modal binding now beats an older global one on
    // merit rather than on the order two constructors happened to run in.
    let best: Binding | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const b of this.bindings) {
      if (!this.eligible(b, o)) {
        continue;
      }
      const rank = rankOf(b);
      if (rank < bestRank) {
        best = b;
        bestRank = rank;
      }
    }
    if (!best) {
      return;
    }
    // A binding that matched owns the event. Anything that wants to fall
    // through to a lower binding should say so with `when()`, not by
    // declining inside `run` — otherwise precedence stops being inspectable.
    e.preventDefault();
    e.stopPropagation();
    best.run(e);
  };
}

/**
 * A stand-in for the keystroke a palette invocation never had.
 *
 * `Binding.run` takes the event because two commands read it — the nudge pair
 * derive their axis from `e.key`. Those are `hidden` in the catalog and so are
 * never reachable from the palette, but the signature has to be honest for the
 * ones that are.
 */
function syntheticEvent(): KeyboardEvent {
  return new KeyboardEvent("keydown");
}

/**
 * The overlay's registry. A singleton because the document has exactly one
 * keyboard and both stages (inline and canvas) share it.
 */
export const keys = new Keys();

/**
 * Tooltip attributes for a control, with its shortcut chip.
 *
 * `data-tip` is the copy and `data-key` is the command, which is the whole
 * point: the chip used to be found by matching the tooltip's *text* against a
 * binding's label, so rewording a tooltip silently dropped its shortcut and
 * two commands could not share a name. Spread into `el()`.
 */
export function tip(text: string, id?: CommandId): Record<string, string> {
  return id ? { "data-key": id, "data-tip": text } : { "data-tip": text };
}
