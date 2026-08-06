import type { ElementContext, SourceLocation } from "@airship/protocol";
import { AIRSHIP_FRAME_NAME } from "@airship/protocol";
import type { TokenScanResult } from "@airship/protocol/tokens";
import { extractElementInfo } from "@airship/source/browser";
import { PREFIX } from "./dom";
import { SWALLOWED } from "./edit-guard";
import { css as portable, TEXT_EDIT_MARK } from "./styles/portable.css";
import { scanRuntimeTokens } from "./tokens/scan";

/**
 * The half of the editor that runs *inside* a frame.
 *
 * The shell can reach a frame's DOM directly — same origin, so
 * `iframe.contentDocument` is just there — and for most work it does exactly
 * that. This agent exists for the operations that are not realm-portable:
 *
 * - `extractElementInfo` walks React's fiber tree and does its own `instanceof`
 *   checks against the realm it was loaded in. Called from the shell on a frame
 *   node it would resolve nothing, and would do it quietly. Here it runs in the
 *   same realm as the React that produced the node, next to the bippy hook the
 *   proxy injected into this document's `<head>`.
 * - Layout notifications need listeners bound to *this* window, since the shell
 *   cannot observe a scroll or a mutation it is not in the document for.
 *
 * Style reads and writes are deliberately *not* here. `inspector/style-model.ts`
 * resolves `getComputedStyle` against the node's own window (see `../realm.ts`),
 * so the shell can drive them directly on a frame node; routing them through
 * here as well would be a second way to do the same thing.
 *
 * The agent mounts no UI, injects no overlay chrome, and opens no control
 * socket. There is one WebSocket per session and the shell owns it.
 */

/** The API a frame publishes to the shell. */
export interface FrameAgent {
  /** Hit-test a point in *this frame's* viewport coordinates. */
  elementAt: (x: number, y: number) => Element | null;
  extract: (
    node: Element
  ) => Promise<{ context: ElementContext; source: SourceLocation | null }>;
  /**
   * Fires when anything in the frame may have moved: scroll, resize, or a DOM
   * mutation (which after HMR is how the shell learns to re-anchor its
   * outlines). Coalesced to one call per frame of animation.
   */
  onLayoutChange: (cb: () => void) => () => void;
  /**
   * The design tokens this frame's stylesheets declare.
   *
   * Realm-local for the same reason `extract` is: the shell's document has the
   * editor's own `--ap-*` theme loaded and none of the user's app CSS, so
   * scanning from up there would return the wrong design system entirely.
   */
  scanTokens: () => TokenScanResult;
  /**
   * Make this frame inert except for the node carrying `TEXT_EDIT_MARK`.
   *
   * Armed while the frame is live for an in-place text edit. The shell's
   * `EditGuard` cannot do this job — it listens in the shell's document, and an
   * event inside an iframe never gets there — so the frame runs the same guard
   * in its own realm, over the same `SWALLOWED` list, with the marked node as
   * the one hatch.
   */
  setTextGuard: (on: boolean) => void;
  /** The frame's own window — also how the shell identifies which frame this is. */
  readonly window: Window;
}

/** A wheel that happened inside a frame, in that frame's own coordinates. */
export interface FrameWheel {
  altKey: boolean;
  /** Frame-viewport coordinates; the shell maps them to screen space. */
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  /** Units of the deltas: 0 pixels, 1 lines, 2 pages. Meaningless without it. */
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  metaKey: boolean;
  shiftKey: boolean;
}

/** A click inside a frame that is live for a text edit, in frame coordinates. */
export interface FramePress {
  /** Frame-viewport coordinates; the shell maps them to screen space. */
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  /** True for `dblclick` — the gesture that *enters* an edit. */
  dbl: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** How the shell learns a frame is ready — including after an HMR full reload. */
export interface FrameHost {
  /**
   * Someone pressed inside this frame. Purely a notification — the press is not
   * consumed, so the app still receives it. In view mode this is the only way
   * the shell can know a frame was clicked, since the event never leaves the
   * frame's document.
   */
  __airshipOnFramePress?: (win: Window) => void;
  __airshipOnFrameReady?: (agent: FrameAgent) => void;
  /**
   * A click or double-click inside a frame that is live for a text edit, which
   * landed outside the node being edited.
   *
   * The counterpart to `__airshipOnFrameWheel`, and it exists for the same
   * reason: while the frame is live its events never reach the shell's document,
   * so the picker's own capture listeners are blind to them. Without this, a
   * click from one string to another inside the same frame would never commit
   * the first — sticky text mode would stop at the frame boundary.
   */
  __airshipOnFrameTextPress?: (win: Window, e: FramePress) => void;
  /**
   * A wheel inside a frame. Returns true if the shell consumed it — a canvas
   * pan or zoom, or a scroll it applied to the frame itself — so the frame can
   * cancel the default action. Must be synchronous: `preventDefault` is only
   * honoured during dispatch.
   */
  __airshipOnFrameWheel?: (win: Window, e: FrameWheel) => boolean;
}

/**
 * Is this document inside an Airship frame, judged by its window name?
 *
 * A secondary signal only. `window.name` turns out to be unreliable for this:
 * setting `iframe.name` after the element is already in the document does not
 * reliably reach `contentWindow.name`, so a frame can come up nameless — and a
 * frame that fails to recognise itself boots the *entire* inline overlay inside
 * itself, complete with its own docks and its own control socket. The injected
 * config is the signal that decides; this is kept for browsers that do not send
 * `Sec-Fetch-Dest`, and because a named frame is far easier to debug.
 */
export function isFrameName(name: string): boolean {
  return name.startsWith(AIRSHIP_FRAME_NAME);
}

/**
 * Styles the frame document needs. Two things, and no more — everything else
 * the editor draws lives in the shell:
 *
 * 1. A frame's scrolling stops at the frame.
 * 2. The portable sheet, which is not local because it is not exclusive to
 *    frames: it styles *page* nodes — the one being edited in place, the one
 *    being dragged, and the ghost standing in for it — and those are page nodes
 *    in the inline stage too. See `styles/portable.css.ts` for why it carries
 *    colour literals rather than `var(--ap-*)`.
 *
 * The dragged-node rule used to be declared here *as well as* in the shell's own
 * stylesheet, as two hand-kept copies of one declaration. It is portable's now,
 * which is the only arrangement where they cannot drift.
 */
const FRAME_CSS = `
/* A frame's scrolling stops at the frame. Reaching the end of the page should
   not hand the gesture onwards to the canvas behind it — the canvas is not a
   bigger version of this page, and having it lurch sideways when you hit the
   bottom of an article is disorienting. Belt and braces now: the shell answers
   every wheel it is offered (see \`onFrameWheel\`), so the default action this
   contains is one that should never run. */
html { overscroll-behavior: contain; }
${portable}`;

function injectFrameStyles(): void {
  const id = `${PREFIX}-frame-styles`;
  if (document.getElementById(id)) {
    return;
  }
  const style = document.createElement("style");
  style.id = id;
  style.textContent = FRAME_CSS;
  document.head.append(style);
}

function createAgent(): FrameAgent {
  const listeners = new Set<() => void>();
  let scheduled = 0;

  // Coalesce to one notification per animation frame. A React re-render can fire
  // hundreds of mutations in a tick and each one would otherwise re-measure and
  // repaint every outline in the shell.
  const notify = (): void => {
    if (scheduled) {
      return;
    }
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      for (const cb of listeners) {
        cb();
      }
    });
  };

  window.addEventListener("scroll", notify, true);
  window.addEventListener("resize", notify);

  // Report presses so clicking a frame selects it, the same as clicking its
  // title. Passive and non-consuming: the app's own buttons and links keep
  // working exactly as they would if the editor were not here.
  window.addEventListener(
    "pointerdown",
    () => {
      try {
        (window.parent as unknown as FrameHost)?.__airshipOnFramePress?.(
          window
        );
      } catch {
        // No reachable shell; nothing to select.
      }
    },
    { capture: true, passive: true }
  );

  // Wheel events inside an iframe never reach the parent document — they do not
  // cross the boundary at all. Without forwarding, ⌘-wheel over a frame does
  // nothing in view mode (where the frame is interactive) and the canvas simply
  // appears frozen wherever the app happens to be. Non-passive so the parent's
  // answer can still cancel the browser's own page zoom.
  window.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      let handled = false;
      try {
        handled =
          (window.parent as unknown as FrameHost)?.__airshipOnFrameWheel?.(
            window,
            {
              altKey: e.altKey,
              clientX: e.clientX,
              clientY: e.clientY,
              ctrlKey: e.ctrlKey,
              deltaMode: e.deltaMode,
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              metaKey: e.metaKey,
              shiftKey: e.shiftKey,
            }
          ) ?? false;
      } catch {
        // No reachable shell — leave the wheel to the app.
      }
      if (handled) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false }
  );
  new MutationObserver(notify).observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  return {
    elementAt: (x, y) => document.elementFromPoint(x, y),
    extract: (node) => extractElementInfo(node),
    onLayoutChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    scanTokens: () => scanRuntimeTokens(document, window),
    setTextGuard,
    window,
  };
}

/** Is this node the one being edited in place, or inside it? */
function inEditedText(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest(`[${TEXT_EDIT_MARK}]`))
  );
}

/** Everything the in-realm guard listens for while a text edit is live. */
const GUARDED = [...SWALLOWED, "click", "dblclick"] as const;
/** Key events the app must not see while the caret is in the frame. */
const GUARDED_KEYS = ["keydown", "keypress", "keyup"] as const;

/**
 * The realm-local half of the text-edit guard.
 *
 * Stateful at module scope rather than per-agent because there is exactly one
 * agent per realm and this listens on that realm's `document` — a second copy
 * would double every listener after an HMR reload that somehow reused the realm.
 */
let textGuardOn = false;

function onGuardedPress(e: Event): void {
  if (inEditedText(e.target)) {
    // The default is the caret, the drag-select, the double-click word. Only the
    // propagation is stopped, so the app's own handler on the button you are
    // renaming never runs.
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.type !== "click" && e.type !== "dblclick") {
    return;
  }
  const me = e as MouseEvent;
  try {
    (window.parent as unknown as FrameHost)?.__airshipOnFrameTextPress?.(
      window,
      {
        clientX: me.clientX,
        clientY: me.clientY,
        ctrlKey: me.ctrlKey,
        dbl: e.type === "dblclick",
        metaKey: me.metaKey,
        shiftKey: me.shiftKey,
      }
    );
  } catch {
    // No reachable shell. The press is already swallowed, which is the part
    // that matters — the app stays inert either way.
  }
}

/**
 * Keep the app's *own* keyboard shortcuts off a live edit.
 *
 * An app with a `document` **capture** keydown handler — a `/`-to-search, a
 * `j`/`k` list — would otherwise act on every character typed into the text, and
 * in a frame the shell is not even in the room to arbitrate: it listens on its
 * own document, which this event never reaches.
 *
 * This stops the descent at the frame's document, which means the *target* is
 * never reached either. That is why `TextEditor` binds its own keydown
 * listener to the node's **window** rather than to the node: window capture is
 * the first step of the path, so the editor has already had the key by the time
 * this runs. Moving either listener without the other silently breaks Escape and
 * ⌘Enter inside a live frame.
 */
function onGuardedKey(e: Event): void {
  if (inEditedText(e.target)) {
    e.stopPropagation();
  }
}

function setTextGuard(on: boolean): void {
  if (on === textGuardOn) {
    return;
  }
  textGuardOn = on;
  for (const type of GUARDED) {
    if (on) {
      document.addEventListener(type, onGuardedPress, true);
    } else {
      document.removeEventListener(type, onGuardedPress, true);
    }
  }
  for (const type of GUARDED_KEYS) {
    if (on) {
      document.addEventListener(type, onGuardedKey, true);
    } else {
      document.removeEventListener(type, onGuardedKey, true);
    }
  }
}

/**
 * Boot as a frame. Publishes the agent to the shell by *calling into it* rather
 * than waiting to be asked: the frame reloads on its own schedule (every HMR
 * full reload tears this realm down and builds a new one), so the shell cannot
 * know when to re-read `contentWindow`. Pushing means re-registration is
 * automatic and the shell's handle is never stale.
 *
 * The agent carries no frame id. It does not need one — it hands over its own
 * `window`, and the shell matches that against its iframes' `contentWindow`.
 * Identity by object reference cannot be spoofed by a stale name or lost in a
 * reload, which an id passed through `window.name` demonstrably can be.
 */
export function bootFrameAgent(): void {
  injectFrameStyles();
  const agent = createAgent();
  (window as unknown as { __airshipFrame?: FrameAgent }).__airshipFrame = agent;
  try {
    (window.parent as unknown as FrameHost)?.__airshipOnFrameReady?.(agent);
  } catch {
    // Cross-origin parent: nothing to register with, and nothing here is worth
    // breaking the frame over. The frame still renders; the editor just cannot
    // resolve source in it.
  }
}
