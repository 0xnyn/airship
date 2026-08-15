import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFIX } from "../dom";
import { ALL_COMMANDS } from "./catalog";
import {
  isInsidePopover,
  isNativeKeyTarget,
  isTypingTarget,
  keys,
  PLATFORM,
} from "./registry";

/*
 * What the registry asks before it runs anything.
 *
 * Three questions, and they used to be two. "Is the user typing?" and "is this
 * keystroke inside a popover?" were once a single flag, and that is the bug the
 * first half of this file holds shut: `isInsidePopover` folded into `typing`
 * meant one `continue` skipped every binding without `allowWhileTyping` —
 * including the ones `popover-host` registers for the popover *itself*, which
 * carry no such flag. Every menu in the overlay lost Escape and its arrow keys,
 * and nothing caught it because nothing here dispatched a key inside a popover.
 *
 * The third is "does this control own the key already?", split out of `typing`
 * because widening `typing` to exclude a checkbox is right and widening it to
 * exclude a `<select>`'s arrows is not. See `isNativeKeyTarget`.
 *
 * Fixtures use real command ids. A `test.*` id would have to be declared in the
 * catalog to compile, and would then show up in the palette and in CONTROLS.md.
 */

/** Undo every binding a test registered. The registry is a singleton. */
const disposers: (() => void)[] = [];

function bind(binding: Parameters<typeof keys.bind>[0]): () => void {
  const off = keys.bind(binding);
  disposers.push(off);
  return off;
}

interface PressOpts {
  code?: string;
  composed?: boolean;
  /**
   * Control, whatever the platform. On a PC this is `mod`; on a Mac it is the
   * modifier no chord in the catalog uses, which is the point of setting it.
   */
  ctrl?: boolean;
  isComposing?: boolean;
  /** Command, whatever the platform. The mirror of `ctrl` above. */
  meta?: boolean;
  /**
   * ⌘ on a Mac, Ctrl elsewhere — the modifier chords actually spell.
   *
   * This used to set `ctrlKey` *and* `metaKey` together, so "either branch
   * matches" whichever platform the suite ran on. That is also why nothing
   * caught `chordOf` ignoring the off-platform modifier instead of refusing it:
   * no test could produce a keystroke carrying only one of them.
   */
  mod?: boolean;
  shift?: boolean;
}

/**
 * Dispatch from a specific node.
 *
 * `bubbles` so the event reaches `document`, where the registry listens. The
 * chord only needs `key` — `physicalKey` falls back to `e.key.toLowerCase()`
 * for everything outside the digit and letter rows and the handful in
 * `CODE_KEYS`.
 */
function press(from: Node, key: string, opts: PressOpts = {}): KeyboardEvent {
  const onMac = PLATFORM === "mac";
  const mod = opts.mod ?? false;
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: opts.code ?? "",
    composed: opts.composed ?? false,
    ctrlKey: (opts.ctrl ?? false) || (mod && !onMac),
    isComposing: opts.isComposing ?? false,
    key,
    metaKey: (opts.meta ?? false) || (mod && onMac),
    shiftKey: opts.shift ?? false,
  });
  from.dispatchEvent(e);
  return e;
}

/** The modifier that is *not* `mod` here — the one no chord may claim. */
const OFF_PLATFORM: "ctrl" | "meta" = PLATFORM === "mac" ? "ctrl" : "meta";

/** A popover shell, as `popover-host` builds it: the class is what is matched. */
function popover(): { item: HTMLElement; shell: HTMLElement } {
  const shell = document.createElement("div");
  shell.className = `${PREFIX}-pop`;
  const item = document.createElement("button");
  shell.append(item);
  document.body.append(shell);
  return { item, shell };
}

function plain(tag = "button"): HTMLElement {
  const node = document.createElement(tag);
  document.body.append(node);
  return node;
}

function input(type: string): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  document.body.append(node);
  return node;
}

afterEach(() => {
  for (const off of disposers.splice(0)) {
    off();
  }
  keys.destroy();
  document.body.replaceChildren();
});

describe("isInsidePopover", () => {
  it("is true for a node inside a popover shell and false outside one", () => {
    const { item } = popover();
    expect(isInsidePopover(item)).toBe(true);
    expect(isInsidePopover(plain())).toBe(false);
  });

  it("is false for a target that is not an element", () => {
    // `document` and `window` reach the handler too, and neither has `closest`.
    expect(isInsidePopover(document)).toBe(false);
    expect(isInsidePopover(null)).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("is true for the things a person types into", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(input("text"))).toBe(true);
    expect(isTypingTarget(input("search"))).toBe(true);
    expect(isTypingTarget(input("number"))).toBe(true);
    // A missing `type` is a text input.
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
  });

  it("is false for the inputs that are widgets, not fields", () => {
    // These all report `tagName === "INPUT"`, which is why the old three-line
    // check treated them as typing and suppressed *every* shortcut — Escape
    // included — while a checkbox had focus.
    expect(isTypingTarget(input("checkbox"))).toBe(false);
    expect(isTypingTarget(input("radio"))).toBe(false);
    expect(isTypingTarget(input("range"))).toBe(false);
    expect(isTypingTarget(input("button"))).toBe(false);
    expect(isTypingTarget(input("color"))).toBe(false);
    expect(isTypingTarget(input("file"))).toBe(false);
  });

  it("is true for a div wearing a textbox role", () => {
    const node = plain("div");
    node.setAttribute("role", "textbox");
    expect(isTypingTarget(node)).toBe(true);
  });

  it("is true mid-IME-composition, whatever the target", () => {
    const node = plain();
    expect(
      isTypingTarget(node, new KeyboardEvent("keydown", { isComposing: true }))
    ).toBe(true);
    // The Safari and older-WebKit spelling of the same fact.
    expect(
      isTypingTarget(node, new KeyboardEvent("keydown", { keyCode: 229 }))
    ).toBe(true);
  });
});

describe("isNativeKeyTarget", () => {
  it("covers the controls that implement the bare keys themselves", () => {
    expect(isNativeKeyTarget(document.createElement("select"))).toBe(true);
    expect(isNativeKeyTarget(input("range"))).toBe(true);
    expect(isNativeKeyTarget(input("checkbox"))).toBe(true);
  });

  it("does not cover an ordinary button or div", () => {
    expect(isNativeKeyTarget(plain())).toBe(false);
    expect(isNativeKeyTarget(plain("div"))).toBe(false);
  });
});

describe("a native control's own keys", () => {
  it("keeps its arrows away from the nudge bindings", () => {
    const run = vi.fn();
    bind({ id: "element.nudge", run });

    press(document.createElement("select"), "ArrowDown");
    press(input("range"), "ArrowRight");

    expect(run).not.toHaveBeenCalled();
  });

  it("still lets Escape and modified chords through from a checkbox", () => {
    // The regression the naive "stop treating inputs as typing" fix causes,
    // read the other way: a checkbox must not swallow Escape.
    const onEscape = vi.fn();
    const undo = vi.fn();
    bind({ id: "selection.deselect", run: onEscape });
    bind({ id: "history.undo", run: undo });
    const box = input("checkbox");

    press(box, "Escape");
    press(box, "z", { code: "KeyZ", mod: true });

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe("a binding scoped with `within`", () => {
  it("fires for a keystroke inside its element", () => {
    const { item, shell } = popover();
    const run = vi.fn();
    bind({ id: "popover.close", run, within: shell });

    press(item, "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("declines a keystroke from outside its element", () => {
    const { shell } = popover();
    const run = vi.fn();
    bind({ id: "popover.close", run, within: shell });

    press(plain(), "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("does not reach a sibling popover's rows", () => {
    // The nesting case: a menu opened from inside a popover is the host's
    // sibling, not its descendant, so the outer scope must not contain it.
    const outer = popover();
    const inner = popover();
    const outerRun = vi.fn();
    const innerRun = vi.fn();
    bind({ id: "popover.next", run: outerRun, within: outer.shell });
    bind({ id: "popover.next", run: innerRun, within: inner.shell });

    press(inner.item, "ArrowDown");

    expect(innerRun).toHaveBeenCalledTimes(1);
    expect(outerRun).not.toHaveBeenCalled();
  });

  it("declines a target in another document, where `contains` cannot reach", () => {
    // The `observe` path: a frame's own document shares this binding table.
    const { shell } = popover();
    const run = vi.fn();
    bind({ id: "popover.close", run, within: shell });

    const other = document.implementation.createHTMLDocument();
    const node = other.createElement("button");
    other.body.append(node);
    // The disposer, not another call to `observe` — which is what this line
    // used to push, so it re-registered on teardown and never removed anything.
    disposers.push(keys.observe(other));

    press(node, "Escape");

    expect(run).not.toHaveBeenCalled();
  });
});

describe("an unscoped binding", () => {
  it("fires normally outside a popover", () => {
    const run = vi.fn();
    bind({ id: "selection.deselect", run });

    press(plain(), "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is suppressed while the keystroke comes from inside a popover", () => {
    // The guard's whole purpose: the canvas nudge must not run under an open
    // colour picker, whose sliders are focusable divs and so read as "not typing".
    const { item } = popover();
    const run = vi.fn();
    bind({ id: "element.nudge", run });

    press(item, "ArrowRight");

    expect(run).not.toHaveBeenCalled();
  });

  it("yields to the popover's own binding on the same chord", () => {
    const { item, shell } = popover();
    const global = vi.fn();
    const scoped = vi.fn();
    bind({ id: "selection.deselect", run: global });
    bind({ id: "popover.close", run: scoped, within: shell });

    press(item, "Escape");

    expect(scoped).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe("precedence is declared, not incidental", () => {
  it("gives a modal binding the chord over an ordinary one", () => {
    const menu = vi.fn();
    const deselect = vi.fn();
    // Registered *first*, so recency would hand this the key.
    bind({ id: "frameMenu.close", run: menu });
    bind({ id: "selection.deselect", run: deselect });

    press(plain(), "Escape");

    expect(menu).toHaveBeenCalledTimes(1);
    expect(deselect).not.toHaveBeenCalled();
  });

  it("does not depend on which was registered first", () => {
    const menu = vi.fn();
    const deselect = vi.fn();
    bind({ id: "selection.deselect", run: deselect });
    bind({ id: "frameMenu.close", run: menu });

    press(plain(), "Escape");

    expect(menu).toHaveBeenCalledTimes(1);
    expect(deselect).not.toHaveBeenCalled();
  });

  it("still puts a scoped binding above a modal one", () => {
    const { item, shell } = popover();
    const menu = vi.fn();
    const scoped = vi.fn();
    bind({ id: "frameMenu.close", run: menu });
    bind({ id: "popover.close", run: scoped, within: shell });

    press(item, "Escape");

    expect(scoped).toHaveBeenCalledTimes(1);
    expect(menu).not.toHaveBeenCalled();
  });
});

describe("typing still outranks scope", () => {
  it("withholds a scoped binding from a field inside the popover", () => {
    // A field owns its own Escape — the token picker clears its query on the
    // first press and closes on the second, and `bindField` reverts a value.
    // The registry matching first would `preventDefault` both out of existence.
    const { shell } = popover();
    const field = document.createElement("input");
    shell.append(field);
    const run = vi.fn();
    bind({ id: "popover.close", run, within: shell });

    press(field, "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("still lets an `allowWhileTyping` binding through in a field", () => {
    const field = input("text");
    const run = vi.fn();
    bind({ id: "chat.send", run });

    press(field, "Enter", { mod: true });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("withholds everything mid-composition", () => {
    const field = input("text");
    const run = vi.fn();
    bind({ id: "chat.send", run });

    press(field, "Enter", { isComposing: true, mod: true });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("a keystroke from inside a live frame", () => {
  function frameDoc(): { doc: Document; node: HTMLElement } {
    const doc = document.implementation.createHTMLDocument();
    const node = doc.createElement("button");
    doc.body.append(node);
    disposers.push(keys.observe(doc));
    return { doc, node };
  }

  it("reaches the commands marked `inFrame`", () => {
    const run = vi.fn();
    bind({ id: "selection.deselect", run });
    const { node } = frameDoc();

    press(node, "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still protects a field in the user's own page", () => {
    // The typing guard reaches one realm down as well: Escape while filling in
    // a form in view mode is the field's, not the editor's.
    const run = vi.fn();
    bind({ id: "selection.deselect", run });
    const { doc } = frameDoc();
    const field = doc.createElement("input");
    doc.body.append(field);

    press(field, "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("does not reach the ones that are not", () => {
    // `f`, `h`, `v` and the nudge set would be theft: in view mode the page in
    // a frame is the user's and they may well be typing into it.
    const run = vi.fn();
    bind({ id: "frame.add", run });
    const { doc } = frameDoc();
    const button = doc.createElement("button");
    doc.body.append(button);

    press(button, "f", { code: "KeyF" });

    expect(run).not.toHaveBeenCalled();
  });

  it("leaves those commands working in the shell", () => {
    const run = vi.fn();
    bind({ id: "frame.add", run });
    frameDoc();

    press(plain(), "f", { code: "KeyF" });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is idempotent per document", () => {
    const doc = document.implementation.createHTMLDocument();
    const node = doc.createElement("button");
    doc.body.append(node);
    const run = vi.fn();
    bind({ id: "selection.deselect", run });
    disposers.push(keys.observe(doc));
    disposers.push(keys.observe(doc));

    press(node, "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops when the frame's disposer runs", () => {
    const doc = document.implementation.createHTMLDocument();
    const node = doc.createElement("button");
    doc.body.append(node);
    const run = vi.fn();
    bind({ id: "selection.deselect", run });
    const off = keys.observe(doc);

    off();
    press(node, "Escape");

    expect(run).not.toHaveBeenCalled();
  });
});

describe("a binding that matches", () => {
  it("consumes the event so nothing underneath sees it", () => {
    const { item, shell } = popover();
    bind({ id: "popover.close", run: () => undefined, within: shell });

    const e = press(item, "Escape");

    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves the event alone when scope declines it", () => {
    const { shell } = popover();
    bind({ id: "popover.close", run: () => undefined, within: shell });

    const e = press(plain(), "Escape");

    expect(e.defaultPrevented).toBe(false);
  });
});

describe("destroy", () => {
  it("forgets every binding and stops answering", () => {
    const run = vi.fn();
    keys.bind({ id: "selection.deselect", run });

    keys.destroy();
    press(plain(), "Escape");

    expect(run).not.toHaveBeenCalled();
  });

  it("leaves the registry usable again afterwards", () => {
    keys.bind({ id: "selection.deselect", run: () => undefined });
    keys.destroy();

    const run = vi.fn();
    bind({ id: "selection.deselect", run });
    press(plain(), "Escape");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("silences a frame document whose disposer never ran", () => {
    // A frame that navigated away takes its document with it, and any chance of
    // removing a listener from it. The dead flag is the backstop.
    const doc = document.implementation.createHTMLDocument();
    const node = doc.createElement("button");
    doc.body.append(node);
    const run = vi.fn();
    keys.bind({ id: "selection.deselect", run });
    keys.observe(doc);

    keys.destroy();
    press(node, "Escape");

    expect(run).not.toHaveBeenCalled();
  });
});

describe("what the surfaces read", () => {
  it("renders a command's primary chord and all of its chords", () => {
    // Redo answers to two, and only ever advertised the first.
    expect(keys.chords("history.redo")).toHaveLength(2);
    expect(keys.hint("history.redo")).toBe(keys.chords("history.redo")[0]);
  });

  it("uses a command's `display` override where one is set", () => {
    // Nudge is one command answering to four arrows; four rows saying the same
    // thing is not what a reference wants.
    expect(keys.chords("element.nudge")).toEqual(["← → ↑ ↓"]);
  });

  it("lists only what is bound and currently allowed", () => {
    expect(keys.available().map((c) => c.spec.id)).not.toContain(
      "history.undo"
    );

    let allowed = false;
    bind({ id: "history.undo", run: () => undefined, when: () => allowed });
    expect(keys.available().map((c) => c.spec.id)).not.toContain(
      "history.undo"
    );

    allowed = true;
    expect(keys.available().map((c) => c.spec.id)).toContain("history.undo");
  });

  it("keeps the popover's own keys out of the palette", () => {
    const { shell } = popover();
    bind({ id: "popover.next", run: () => undefined, within: shell });

    expect(keys.available().map((c) => c.spec.id)).not.toContain(
      "popover.next"
    );
  });

  it("runs a command by id, and says so when nothing is bound", () => {
    const run = vi.fn();
    expect(keys.run("history.undo")).toBe(false);

    bind({ id: "history.undo", run });

    expect(keys.run("history.undo")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports two bound commands that answer to the same chord", () => {
    bind({ id: "selection.deselect", run: () => undefined });
    bind({ id: "tool.handDrop", run: () => undefined });

    const clash = keys.conflicts().find((c) => c.chord === "escape");

    expect(clash?.ids).toEqual(
      expect.arrayContaining(["selection.deselect", "tool.handDrop"])
    );
  });

  it("does not count a scoped binding as a conflict", () => {
    const { shell } = popover();
    bind({ id: "selection.deselect", run: () => undefined });
    bind({ id: "popover.close", run: () => undefined, within: shell });

    expect(keys.conflicts()).toHaveLength(0);
  });
});

/*
 * The modifier the platform does not use.
 *
 * `mod` is Command on a Mac and Control everywhere else, and `chordOf` used to
 * simply not read the other one. Nothing rejected it, so the *unmodified* chord
 * matched: on a Mac `⌃←` produced `arrowleft` and nudged the selection, `⌃⌫`
 * deleted it, `⌃F` opened the device picker — each of them also swallowing the
 * OS gesture, because a match always calls `preventDefault`.
 *
 * These press the off-platform modifier alone, which the old fixture could not
 * express: `mod` set `ctrlKey` and `metaKey` together on every platform.
 */
describe("the off-platform modifier", () => {
  it("does not fire a bare-key command", () => {
    const run = vi.fn();
    bind({ id: "frame.add", run });

    press(document.body, "f", { [OFF_PLATFORM]: true });

    expect(run).not.toHaveBeenCalled();
  });

  it("does not fire a destructive bare-key command", () => {
    const run = vi.fn();
    bind({ id: "element.delete", run });

    press(document.body, "Backspace", { [OFF_PLATFORM]: true });

    expect(run).not.toHaveBeenCalled();
  });

  it("leaves the keystroke to the OS rather than swallowing it", () => {
    // The half that is not about the wrong command running. `⌃←` is Mission
    // Control on a Mac; consuming it is a bug even when nothing else fires.
    bind({ id: "element.nudge", run: () => undefined });

    const e = press(document.body, "ArrowLeft", { [OFF_PLATFORM]: true });

    expect(e.defaultPrevented).toBe(false);
  });

  it("does not fire a mod-chord command when both modifiers are down", () => {
    const run = vi.fn();
    bind({ id: "history.undo", run });

    press(document.body, "z", { mod: true, [OFF_PLATFORM]: true });

    expect(run).not.toHaveBeenCalled();
  });

  it("still fires the command when only the platform modifier is down", () => {
    // The guard rejects one specific extra modifier, and nothing else.
    const run = vi.fn();
    bind({ id: "history.undo", run });

    press(document.body, "z", { mod: true });

    expect(run).toHaveBeenCalledTimes(1);
  });
});

/*
 * One command, one spelling, whichever surface is asking.
 *
 * `chords` (the sheet, the palette) and `gen-controls.mjs` (CONTROLS.md, the
 * README) both prefer `display` over the literal chord, and both prefer
 * `primary` over the full key list. `hint` — the tooltip chip — read `keys[0]`
 * and did neither, so the bar's `?` button carried a `⇧/` chip while the sheet
 * it opens said `?`. Exactly the drift the catalog exists to end, one layer in.
 */
describe("keys.hint", () => {
  it("prefers a display override over the literal chord", () => {
    // `help.shortcuts` is bound to shift+/ and mod+/ and displays as "?".
    expect(keys.hint("help.shortcuts")).toBe("?");
    expect(keys.chords("help.shortcuts")).toEqual(["?"]);
  });

  it("agrees with what the sheet shows, for every command", () => {
    // The invariant, rather than a list: a chip is the first of the chords the
    // panel would show, always. Nothing may spell one its own way.
    for (const spec of ALL_COMMANDS) {
      expect(keys.hint(spec.id)).toBe(keys.chords(spec.id)[0] ?? null);
    }
  });

  it("still renders a plain command from its chord", () => {
    expect(keys.hint("history.undo")).toBe(
      PLATFORM === "mac" ? "⌘Z" : "Ctrl+Z"
    );
  });
});
