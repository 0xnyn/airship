/**
 * Every command the editor answers to, declared once.
 *
 * Chords used to be string literals at the `keys.bind` call site, and the only
 * thing that knew a command existed was the line that bound it. That made three
 * things impossible and one thing silently wrong:
 *
 * - **Nothing could enumerate the bindings**, so there was no shortcuts panel
 *   and no command palette, and twenty-seven of the thirty-three shortcuts were
 *   undiscoverable unless you already knew them.
 * - **Nothing could document them.** The only shortcut reference in the repo
 *   was a hand-written six-row table in `README.md`, and its copy in
 *   `apps/cli/README.md` had already drifted two rows out of date.
 * - **A tooltip found its chord by matching its own text against a binding's
 *   `label`.** Reword the tooltip and the chip silently disappears; name two
 *   commands "Delete" and one of them shadows the other's chip. Both happened.
 *   `tooltip.copy.test.ts` existed to freeze thirteen spellings by hand, and it
 *   was missing four of them.
 * - **Five menu rows spelled their own chords** — `"⌘+"` where the binding was
 *   `mod+=`, Mac glyphs rendered on Windows, and a `⌘Z` on a row wired to the
 *   server-side revert, a feature `app.ts` warns must never be reached by ⌘Z.
 *
 * So the declaration lives here and the implementation stays where it belongs.
 * A binding supplies `run`, `when` and `within`; everything a *reader* needs —
 * the chord, the name, the sentence, which mode it works in — comes from this
 * table. `CommandId` is a union, so a mistyped id is a compile error rather
 * than a shortcut that quietly never fires.
 *
 * ## This module must stay loadable by plain Node
 *
 * `scripts/gen-controls.mjs` imports it directly to generate `CONTROLS.md`, so
 * it may contain **no value imports** — Node's type stripper erases `import
 * type` before module resolution, but a real import would need an extension it
 * does not have. `catalog.test.ts` enforces this. Keep this file data and pure
 * functions; anything that needs the DOM belongs in `registry.ts`.
 */
import type { IconName } from "../icons";

/** Which editor mode a command belongs to. */
export type CommandMode = "any" | "edit" | "view";

/** Which of the two surfaces a command exists on. */
export type CommandSurface = "both" | "canvas" | "inline";

/** The sections of the shortcuts panel, in the order they are shown. */
export type CommandGroup =
  | "Agent"
  | "Edit"
  | "Frames"
  | "Help"
  | "Menus"
  | "Selection"
  | "View";

/**
 * How a binding is ordered against another that answers the same chord.
 *
 * `modal` is for a surface that is standing in front of everything else — an
 * open device menu owns Escape while it is up. It exists because the honest
 * alternative, scoping that Escape to the menu, does not work: focus is on
 * `document.body` after the click that opened it, so `within` would never
 * match. Registration order used to decide this, and `canvas/frame-chrome.ts`
 * says in as many words that it must not.
 */
export type CommandPriority = "modal" | "normal";

export interface CommandSpec {
  /**
   * Fire even while a text field has focus.
   *
   * Rare, and every use is a field's own submit: ⌘↵ in the composer, ⌘↵ in a
   * comment, the palette's own navigation. Anything else stealing a keystroke
   * from someone who is typing is a bug.
   */
  readonly allowWhileTyping?: boolean;
  /**
   * Overrides the rendered chord where the literal spelling reads badly.
   *
   * The nudge commands are the case: one command answers to four arrows, and
   * "← → ↑ ↓" is what a reader wants to see rather than four separate rows.
   */
  readonly display?: string;
  /** One sentence, for the palette's second line and the generated reference. */
  readonly doc: string;
  /** Include in the short table in `README.md`. */
  readonly essential?: boolean;
  readonly group: CommandGroup;
  /** Kept out of the palette — popover-local keys and modal navigation. */
  readonly hidden?: boolean;
  readonly icon?: IconName;
  /** Stable, dotted, never shown to a user. The only thing code refers to. */
  readonly id: string;
  /**
   * Reaches the registry from inside a live frame's document.
   *
   * In view mode the page in a frame belongs to the user and takes focus, and
   * a keydown there never reaches the shell — which is why Escape, the zoom
   * keys and the two help surfaces were dead the moment you clicked into your
   * own app. `Keys.observe` fixes that, but it must not hand the app's own
   * typing to a single-letter command: `f` would add a frame while someone
   * filled in a form. So only the commands marked here are routed.
   */
  readonly inFrame?: boolean;
  /** Every chord it answers to. The first is the one a tooltip shows. */
  readonly keys: readonly string[];
  readonly mode: CommandMode;
  /**
   * The subset of `keys` worth showing a reader. Defaults to all of them.
   *
   * Zoom is why this exists. `⌘=`, `⌘⇧=`, `⇧=`, `=` and the two numpad keys are
   * six genuinely distinct keystrokes and all six should work — "⌘+" on a US
   * layout is `mod+shift+=`, and a lot of people reach for the keypad. Printing
   * all six in a table nobody can scan is not documentation, it is a shrug. The
   * aliases stay bound; the reference names the two you would teach someone.
   */
  readonly primary?: readonly string[];
  readonly priority?: CommandPriority;
  /**
   * Always bound with `within`, and so exempt from the duplicate-chord rule.
   *
   * A scoped binding cannot collide with a global one: it only fires for a
   * keystroke that originated inside the element it belongs to.
   */
  readonly scoped?: boolean;
  readonly surface: CommandSurface;
  /** Sentence case. The palette, the panel and the docs all show this. */
  readonly title: string;
  /**
   * Where a scoped or modal command applies, as a phrase.
   *
   * The reference shows every command including the ones that are not live, and
   * says why — which is the whole argument for showing them. `mode` and
   * `surface` answer that for a global command ("edit mode", "canvas only") and
   * cannot answer it for a scoped one, which is live exactly while some
   * particular thing is on screen. Nineteen rows read "not available here"
   * before this existed, which tells a reader nothing they can act on.
   */
  readonly where?: string;
}

/**
 * The table.
 *
 * `as const satisfies` rather than a plain annotation: the annotation would
 * widen every `id` to `string` and there would be no union to key on, while
 * `as const` alone would not type-check the fields. Same pattern as
 * `stories/foundations.stories.ts`.
 */
export const COMMANDS = [
  // -- Edit -----------------------------------------------------------------
  {
    doc: "Step back through your pending direct-manipulation edits.",
    essential: true,
    group: "Edit",
    icon: "rotate-ccw",
    id: "history.undo",
    keys: ["mod+z"],
    mode: "edit",
    surface: "both",
    title: "Undo",
  },
  {
    doc: "Step forward again through edits you have undone.",
    group: "Edit",
    // No glyph: the set has `rotate-ccw` and no mirrored twin, and Redo wearing
    // Undo's mark is worse than Redo wearing none.
    id: "history.redo",
    keys: ["mod+shift+z", "mod+y"],
    mode: "edit",
    surface: "both",
    title: "Redo",
  },
  {
    doc: "Remove the selected element.",
    essential: true,
    group: "Edit",
    icon: "minus",
    id: "element.delete",
    keys: ["backspace", "delete"],
    mode: "edit",
    surface: "both",
    title: "Delete element",
  },
  {
    doc: "Copy the selected element in place.",
    essential: true,
    group: "Edit",
    icon: "plus",
    id: "element.duplicate",
    keys: ["mod+d"],
    mode: "edit",
    surface: "both",
    title: "Duplicate",
  },
  {
    doc: "Edit the selected element's text in place.",
    essential: true,
    group: "Edit",
    icon: "layer-text",
    id: "element.editText",
    keys: ["enter", "t"],
    mode: "edit",
    surface: "both",
    title: "Edit text",
  },
  {
    display: "← → ↑ ↓",
    doc: "Move the selected element one pixel.",
    group: "Edit",
    // Out of the palette, in the sheet. `run` reads its direction off the
    // keystroke, so a palette row saying "Nudge" has no direction to nudge in
    // and would do nothing at all — which is the exact failure the palette's
    // "only list what is runnable" rule exists to prevent. The sheet renders
    // the whole catalog, `hidden` included, so it is still documented.
    hidden: true,
    id: "element.nudge",
    keys: ["arrowleft", "arrowright", "arrowup", "arrowdown"],
    mode: "edit",
    surface: "both",
    title: "Nudge",
  },
  {
    display: "⇧ ← → ↑ ↓",
    doc: "Move the selected element ten pixels.",
    group: "Edit",
    hidden: true,
    id: "element.nudgeBig",
    keys: [
      "shift+arrowleft",
      "shift+arrowright",
      "shift+arrowup",
      "shift+arrowdown",
    ],
    mode: "edit",
    surface: "both",
    title: "Nudge by ten",
  },

  // -- Selection ------------------------------------------------------------
  {
    doc: "Clear the selection.",
    group: "Selection",
    id: "selection.deselect",
    inFrame: true,
    keys: ["escape"],
    mode: "edit",
    surface: "both",
    title: "Deselect",
  },
  {
    doc: "Hover highlights and clicks select. The default.",
    essential: true,
    group: "Selection",
    icon: "tool-move",
    id: "tool.move",
    keys: ["v"],
    mode: "edit",
    surface: "both",
    title: "Move",
  },
  {
    doc: "Hover reads out an element's specs instead of selecting it.",
    essential: true,
    group: "Selection",
    icon: "tool-inspect",
    id: "tool.inspect",
    keys: ["i"],
    mode: "edit",
    surface: "both",
    title: "Inspect",
  },

  // -- View -----------------------------------------------------------------
  {
    doc: "Zoom in a step, centred on the canvas. On Safari, use + rather than ⌘+.",
    essential: true,
    group: "View",
    id: "view.zoomIn",
    inFrame: true,
    keys: [
      "mod+=",
      "mod+shift+=",
      "shift+=",
      "=",
      "numpadadd",
      "mod+numpadadd",
    ],
    mode: "any",
    primary: ["mod+=", "="],
    surface: "canvas",
    title: "Zoom in",
  },
  {
    doc: "Zoom out a step. On Safari, use − rather than ⌘−.",
    essential: true,
    group: "View",
    id: "view.zoomOut",
    inFrame: true,
    keys: [
      "mod+-",
      "mod+shift+-",
      "shift+-",
      "-",
      "numpadsubtract",
      "mod+numpadsubtract",
    ],
    mode: "any",
    primary: ["mod+-", "-"],
    surface: "canvas",
    title: "Zoom out",
  },
  {
    doc: "Return the canvas to actual size.",
    essential: true,
    group: "View",
    id: "view.zoom100",
    inFrame: true,
    keys: ["mod+0", "shift+0"],
    mode: "any",
    surface: "canvas",
    title: "Zoom to 100%",
  },
  {
    doc: "Fit every frame on screen.",
    essential: true,
    group: "View",
    id: "view.zoomToFit",
    inFrame: true,
    keys: ["shift+1"],
    mode: "any",
    surface: "canvas",
    title: "Zoom to fit",
  },
  {
    doc: "Fill the canvas with the current selection.",
    group: "View",
    id: "view.zoomToSelection",
    inFrame: true,
    keys: ["shift+2"],
    mode: "any",
    surface: "canvas",
    title: "Zoom to selection",
  },
  {
    doc: "Drag anywhere to move the canvas, leaving the page beneath untouched.",
    essential: true,
    group: "View",
    icon: "tool-hand",
    id: "tool.hand",
    keys: ["h"],
    mode: "view",
    surface: "canvas",
    title: "Hand tool",
  },
  {
    doc: "Put the Hand down and go back to pointing.",
    group: "View",
    id: "tool.handDrop",
    keys: ["escape"],
    mode: "view",
    surface: "canvas",
    title: "Put the Hand down",
  },

  // -- Frames ---------------------------------------------------------------
  {
    doc: "Open the device picker and place a new frame on the canvas.",
    essential: true,
    group: "Frames",
    icon: "plus",
    id: "frame.add",
    keys: ["f"],
    mode: "any",
    surface: "canvas",
    title: "Add a frame",
  },
  {
    doc: "Remove the active frame from the canvas.",
    group: "Frames",
    icon: "minus",
    id: "frame.delete",
    keys: ["backspace", "delete"],
    mode: "view",
    surface: "canvas",
    title: "Delete frame",
  },
  {
    doc: "Move the frame up the stack, so it covers the ones it overlaps.",
    group: "Frames",
    id: "frame.bringForward",
    keys: ["arrowup"],
    mode: "view",
    scoped: true,
    surface: "canvas",
    title: "Bring frame forward",
    where: "on a frame's handle",
  },
  {
    doc: "Move the frame down the stack, behind the ones it overlaps.",
    group: "Frames",
    id: "frame.sendBackward",
    keys: ["arrowdown"],
    mode: "view",
    scoped: true,
    surface: "canvas",
    title: "Send frame backward",
    where: "on a frame's handle",
  },

  // -- Agent ----------------------------------------------------------------
  {
    allowWhileTyping: true,
    doc: "Send the description and the pending edits to the agent.",
    essential: true,
    group: "Agent",
    icon: "chev-up",
    id: "chat.send",
    keys: ["mod+enter"],
    mode: "any",
    surface: "both",
    title: "Send",
  },
  {
    allowWhileTyping: true,
    doc: "Attach the comment to the diff line it is anchored on.",
    group: "Agent",
    icon: "tool-comment",
    id: "comment.add",
    keys: ["mod+enter"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Add comment",
    where: "in a comment",
  },
  {
    doc: "Move to the next pending change on the composer's strip.",
    group: "Agent",
    hidden: true,
    id: "chips.next",
    keys: ["arrowright"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Next change",
    where: "on the change strip",
  },
  {
    doc: "Move to the previous pending change.",
    group: "Agent",
    hidden: true,
    id: "chips.prev",
    keys: ["arrowleft"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Previous change",
    where: "on the change strip",
  },
  {
    doc: "Jump to the first pending change.",
    group: "Agent",
    hidden: true,
    id: "chips.first",
    keys: ["home"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "First change",
    where: "on the change strip",
  },
  {
    doc: "Jump to the last pending change.",
    group: "Agent",
    hidden: true,
    id: "chips.last",
    keys: ["end"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Last change",
    where: "on the change strip",
  },
  {
    doc: "Discard the pending change you are on.",
    group: "Agent",
    id: "chips.drop",
    keys: ["backspace", "delete"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Drop the change you are on",
    where: "on the change strip",
  },

  // -- Help -----------------------------------------------------------------
  {
    // `shift+/` renders as "⇧/", which is the chord and not what anyone calls
    // this key. Four places already told the user to press `?` — the panel's own
    // header, the generated reference, `README.md` and the doc below — while
    // every chip, row and table spelled the other thing. `?` is the same
    // keystroke on both platforms, so one override settles all of them.
    display: "?",
    doc: "Every shortcut and gesture, grouped, with what is live right now.",
    essential: true,
    group: "Help",
    icon: "question",
    id: "help.shortcuts",
    inFrame: true,
    keys: ["shift+/", "mod+/"],
    mode: "any",
    surface: "both",
    title: "Keyboard shortcuts",
  },
  {
    doc: "Search everything the editor can do right now, and run it.",
    essential: true,
    group: "Help",
    icon: "command",
    id: "help.palette",
    inFrame: true,
    keys: ["mod+k"],
    mode: "any",
    surface: "both",
    title: "Command palette",
  },

  // -- Menus ----------------------------------------------------------------
  // Scoped to whichever popover is open, and hidden: a palette row reading
  // "Next option" with no menu on screen is an action that cannot be taken.
  {
    doc: "Close the open menu.",
    group: "Menus",
    hidden: true,
    id: "popover.close",
    keys: ["escape"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Close the menu",
    where: "in an open menu",
  },
  {
    doc: "Move down the open menu.",
    group: "Menus",
    hidden: true,
    id: "popover.next",
    keys: ["arrowdown"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Next option",
    where: "in an open menu",
  },
  {
    doc: "Move up the open menu.",
    group: "Menus",
    hidden: true,
    id: "popover.prev",
    keys: ["arrowup"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Previous option",
    where: "in an open menu",
  },
  {
    doc: "Jump to the first option.",
    group: "Menus",
    hidden: true,
    id: "popover.first",
    keys: ["home"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "First option",
    where: "in an open menu",
  },
  {
    doc: "Jump to the last option.",
    group: "Menus",
    hidden: true,
    id: "popover.last",
    keys: ["end"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Last option",
    where: "in an open menu",
  },
  {
    doc: "Take the option you are on.",
    group: "Menus",
    hidden: true,
    id: "popover.choose",
    keys: ["enter"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Choose option",
    where: "in an open menu",
  },
  // The device menu is opened by a click, so focus is still on `document.body`
  // and `within` would never match. `modal` is the honest way to say "this is
  // in front of everything" — see the note on `CommandPriority`.
  {
    doc: "Close the frame's device menu.",
    group: "Menus",
    hidden: true,
    id: "frameMenu.close",
    keys: ["escape"],
    mode: "any",
    priority: "modal",
    surface: "canvas",
    title: "Close the device menu",
    where: "in the device menu",
  },
  // The palette's own navigation. `allowWhileTyping`, because the search field
  // has focus the whole time it is open, and scoped so none of it leaks.
  {
    allowWhileTyping: true,
    doc: "Move down the results.",
    group: "Menus",
    hidden: true,
    id: "palette.next",
    keys: ["arrowdown"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Next result",
    where: "in the command palette",
  },
  {
    allowWhileTyping: true,
    doc: "Move up the results.",
    group: "Menus",
    hidden: true,
    id: "palette.prev",
    keys: ["arrowup"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Previous result",
    where: "in the command palette",
  },
  {
    allowWhileTyping: true,
    doc: "Run the result you are on.",
    group: "Menus",
    hidden: true,
    id: "palette.run",
    keys: ["enter"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Run result",
    where: "in the command palette",
  },
  {
    allowWhileTyping: true,
    doc: "Clear the search, then close.",
    group: "Menus",
    hidden: true,
    id: "palette.close",
    keys: ["escape"],
    mode: "any",
    scoped: true,
    surface: "both",
    title: "Close the palette",
    where: "in the command palette",
  },
] as const satisfies readonly CommandSpec[];

export type CommandId = (typeof COMMANDS)[number]["id"];

/**
 * A declaration whose `id` has been narrowed back to the union.
 *
 * `CommandSpec.id` has to be `string` — it is the interface the literals are
 * checked *against*, so it cannot name a type derived from them. Every real
 * entry does carry a `CommandId`, and this is where that fact is stated so
 * callers iterating the table can pass an id straight to `keys.chords`.
 */
export type Command = CommandSpec & { readonly id: CommandId };

/**
 * The table, widened to the interface.
 *
 * Iterate this rather than `COMMANDS`. `as const` gives each entry a literal
 * type in which an omitted optional field is *absent* rather than optional, so
 * `spec.hidden` on the union does not type-check — which is the price of having
 * `CommandId` be a union at all. `COMMANDS` is for the type; this is for the
 * loops.
 */
export const ALL_COMMANDS: readonly Command[] = COMMANDS;

const BY_ID = new Map<string, Command>(
  COMMANDS.map((c): [string, Command] => [c.id, c])
);

/**
 * The declaration for a command.
 *
 * Total by construction — `CommandId` is derived from `COMMANDS`, so the only
 * way to reach the throw is to hand it a string that was cast past the type.
 */
export function commandSpec(id: CommandId): Command {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`No command is declared for "${id}"`);
  }
  return found;
}

/** The panel's sections, in order. */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  "Edit",
  "Selection",
  "View",
  "Frames",
  "Agent",
  "Help",
  "Menus",
];

// ---------------------------------------------------------------------------
// Pointer gestures
// ---------------------------------------------------------------------------

/** Which device a gesture is really for. */
export type GestureDevice = "any" | "mouse" | "trackpad";

/**
 * A pointer gesture — documentation only.
 *
 * Gestures cannot be commands and should not pretend to be: space-to-pan is a
 * state held between a keydown and a keyup, a wheel is a stream, and neither has a
 * `run()` a palette could call. What they do have is the same need to be
 * discoverable and documented, which is the half of the input surface that was
 * missing entirely — the README's six-row table was the only place any of this
 * was written down, and it covered the canvas alone.
 *
 * `impl` is what keeps the table honest, and it works in both directions in
 * `gestures.test.ts`: forward, every symbol named here must exist, so a renamed
 * handler fails the build rather than leaving a row describing nothing;
 * backward, every file that registers a pointer or wheel listener must be named
 * by some row, so the right-drag somebody adds next year cannot go undocumented.
 */
export interface GestureSpec {
  readonly device: GestureDevice;
  readonly doc: string;
  readonly essential?: boolean;
  readonly id: string;
  /** `"canvas/viewport.ts#onSpaceDown"` — the file and the symbol. */
  readonly impl: string;
  /** How it is performed, on a Mac: "Space-drag", "⌘-wheel", "Middle-drag". */
  readonly input: string;
  /**
   * The same, spelled for Windows and Linux. Omit when it is identical.
   *
   * Only two gestures carry a modifier glyph, and both read as Mac-only to
   * everyone else. Commands have had two spellings since the catalog existed;
   * this is the same fact for the pointer half, and without it the generated
   * tables were quietly Mac-only wherever a gesture used a glyph.
   */
  readonly inputPc?: string;
  readonly mode: CommandMode;
  readonly surface: CommandSurface;
  readonly title: string;
}

export const GESTURES = [
  {
    device: "any",
    doc: "Two fingers or a wheel move the canvas under you.",
    essential: true,
    id: "gesture.pan",
    impl: "canvas/viewport.ts#applyWheel",
    input: "Wheel / two-finger",
    mode: "any",
    surface: "canvas",
    title: "Pan the canvas",
  },
  {
    device: "any",
    doc: "Zooms toward the pointer, not the middle of the screen.",
    essential: true,
    id: "gesture.zoom",
    impl: "canvas/viewport.ts#applyWheel",
    input: "⌘-wheel / pinch",
    inputPc: "Ctrl-wheel / pinch",
    mode: "any",
    surface: "canvas",
    title: "Zoom at the cursor",
  },
  {
    device: "any",
    doc: "Hold space and drag, from anywhere, without changing tool.",
    essential: true,
    id: "gesture.spacePan",
    impl: "canvas/viewport.ts#onSpaceDown",
    input: "Space-drag",
    mode: "any",
    surface: "canvas",
    title: "Pan without the Hand",
  },
  {
    device: "mouse",
    doc: "The middle button pans, whatever tool is armed.",
    id: "gesture.middlePan",
    impl: "canvas/viewport.ts#onPointerDown",
    input: "Middle-drag",
    mode: "any",
    surface: "canvas",
    title: "Pan with the middle button",
  },
  {
    device: "any",
    doc: "A selected frame keeps the wheel to its own ends, so the canvas never lurches sideways.",
    id: "gesture.frameScroll",
    impl: "canvas/wheel.ts#routeWheel",
    input: "Wheel over the selected frame",
    mode: "view",
    surface: "canvas",
    title: "Scroll a frame",
  },
  {
    device: "any",
    doc: "Hover highlights, click selects.",
    essential: true,
    id: "gesture.select",
    impl: "picker.ts#onClick",
    input: "Click",
    mode: "edit",
    surface: "both",
    title: "Select an element",
  },
  {
    device: "any",
    doc: "Drag from empty space to band-select several elements.",
    id: "gesture.marquee",
    impl: "picker.ts#onMarqueeDown",
    input: "Drag from empty space",
    mode: "edit",
    surface: "both",
    title: "Marquee-select",
  },
  {
    device: "any",
    doc: "Opens the caret in the element itself, not in a field beside it.",
    essential: true,
    id: "gesture.editText",
    impl: "picker.ts#onDblClick",
    input: "Double-click",
    mode: "edit",
    surface: "both",
    title: "Edit text in place",
  },
  {
    device: "any",
    doc: "Verbs for the element you clicked, which it selects first.",
    essential: true,
    id: "gesture.contextMenu",
    impl: "picker.ts#onContextMenu",
    input: "Right-click",
    mode: "edit",
    surface: "both",
    title: "Open the element menu",
  },
  {
    device: "any",
    doc: "Hold Alt and hover to read the distance to the element under the pointer.",
    id: "gesture.measure",
    impl: "picker.ts#onModifier",
    input: "⌥-hover",
    inputPc: "Alt-hover",
    mode: "edit",
    surface: "both",
    title: "Measure spacing",
  },
  {
    device: "any",
    doc: "Drag a frame by its title; drag a grip to resize it.",
    id: "gesture.frameMove",
    impl: "canvas/frame-chrome.ts#onDragMove",
    input: "Drag the title or a grip",
    mode: "view",
    surface: "canvas",
    title: "Move or resize a frame",
  },
  {
    device: "any",
    doc: "Drag a row in the frame list to change which frame is in front.",
    id: "gesture.restack",
    impl: "canvas/frames-panel.ts#watchDrag",
    input: "Drag a row in the frame list",
    mode: "view",
    surface: "canvas",
    title: "Restack frames",
  },
  {
    device: "any",
    doc: "Press anywhere on the minimap to jump there, and keep dragging to keep moving.",
    id: "gesture.minimap",
    impl: "canvas/minimap.ts#onPress",
    input: "Press or drag the minimap",
    mode: "view",
    surface: "canvas",
    title: "Jump the camera",
  },
  {
    device: "any",
    doc: "Drag a field's glyph sideways. Shift for ten at a time, Alt for a tenth.",
    essential: true,
    id: "gesture.scrub",
    impl: "inspector/controls/num-field.ts#createNumField",
    input: "Drag a field's glyph",
    mode: "edit",
    surface: "both",
    title: "Scrub a number",
  },
  {
    device: "any",
    doc: "Double-click a floating panel's header to put it back against the edge.",
    id: "gesture.redock",
    impl: "app.ts#redock",
    input: "Double-click a panel header",
    mode: "any",
    surface: "both",
    title: "Re-dock a panel",
  },
  // Both of these shipped undocumented. The splitter is a 7px strip that shows
  // a hairline on hover and nothing otherwise, so a reader who does not already
  // know it is there has no way to find out — which is the exact case a gesture
  // table exists for.
  {
    device: "any",
    doc: "Drag the inner edge for width, the bottom edge for height.",
    id: "gesture.dockResize",
    impl: "app.ts#watchSplitters",
    input: "Drag a panel edge",
    mode: "any",
    surface: "both",
    title: "Resize a panel",
  },
  {
    device: "any",
    doc: "Width goes back to its default; a docked panel goes back to filling its edge.",
    id: "gesture.dockReset",
    impl: "app.ts#buildSplitter",
    input: "Double-click a panel edge",
    mode: "any",
    surface: "both",
    title: "Reset a panel's size",
  },
  {
    device: "mouse",
    doc: "A vertical wheel scrolls the strip sideways, because a mouse has no sideways.",
    id: "gesture.chipRail",
    impl: "chat/change-chips.ts#attachRailWheel",
    input: "Wheel over the strip",
    mode: "any",
    surface: "both",
    title: "Scroll the pending changes",
  },
] as const satisfies readonly GestureSpec[];

/** The table, widened. See the note on `ALL_COMMANDS`. */
export const ALL_GESTURES: readonly GestureSpec[] = GESTURES;

/**
 * Conventions that hold everywhere and belong to no command.
 *
 * Every editor field owns its own Enter and Escape — they commit and revert the
 * input they are typed into, and are deliberately *not* registry bindings,
 * because routing them through a global table would mean twenty fields each
 * re-declaring "…but only while I have focus", which is a thing the DOM already
 * does. They are still real, and a reference that omitted them would be lying
 * by omission, so they are declared here as prose bound to nothing.
 *
 * Prose, which means these are the one place in the catalog no `displayChord`
 * can reach — so a modifier written as a Mac glyph here is a Mac glyph in
 * `CONTROLS.md` and in the shortcuts panel on every platform. They are spelled
 * out for that reason, and the one chord that has to be named is given both ways.
 */
export const NOTES: readonly string[] = [
  "Enter commits the field you are in; Esc reverts it.",
  "↑ and ↓ step a number field. Shift for ten at a time, Alt for a tenth.",
  "A shortcut never fires while you are typing, except a field's own submit — ⌘↵ on a Mac, Ctrl+Enter elsewhere.",
];

// ---------------------------------------------------------------------------
// Rendering a chord
// ---------------------------------------------------------------------------

/** Which glyph set to spell a chord in. */
export type ChordPlatform = "mac" | "pc";

const DISPLAY_MAC: Readonly<Record<string, string>> = {
  alt: "⌥",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  backspace: "⌫",
  delete: "Del",
  end: "End",
  enter: "↩",
  escape: "Esc",
  home: "Home",
  mod: "⌘",
  numpadadd: "+",
  numpadsubtract: "−",
  shift: "⇧",
  space: "Space",
};

const DISPLAY_PC: Readonly<Record<string, string>> = {
  alt: "Alt",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  backspace: "Backspace",
  delete: "Del",
  end: "End",
  enter: "Enter",
  escape: "Esc",
  home: "Home",
  mod: "Ctrl",
  numpadadd: "+",
  numpadsubtract: "−",
  shift: "Shift",
  space: "Space",
};

/**
 * `"mod+shift+z"` → `"⌘⇧Z"` on a Mac, `"Ctrl+Shift+Z"` everywhere else.
 *
 * The platform is a parameter rather than read from `navigator`, because the
 * docs generator renders *both* columns and runs under Node — where
 * `globalThis.navigator` exists with an undefined `platform`, so a probe would
 * silently emit the Windows spelling for every reader.
 */
export function displayChord(chord: string, platform: ChordPlatform): string {
  const parts = displayChordParts(chord, platform);
  return platform === "mac" ? parts.join("") : parts.join("+");
}

/**
 * The same chord, as the keys you actually press.
 *
 * `"mod+shift+z"` → `["⌘", "⇧", "Z"]`. For prose — a table cell, a tooltip — the
 * joined form above is right. For a *chip* it is not: "⌘⇧Z" set in 10px mono is
 * three glyphs with no space between them, and a reader has to know the set
 * already to tell where one key ends and the next begins. One chip per key is
 * the difference between a label you decode and one you read.
 *
 * `displayChord` is written in terms of this rather than beside it, so the two
 * cannot drift — a chip and the `CONTROLS.md` row it documents must never
 * disagree about which keys a chord is.
 */
export function displayChordParts(
  chord: string,
  platform: ChordPlatform
): string[] {
  const map = platform === "mac" ? DISPLAY_MAC : DISPLAY_PC;
  return chord.split("+").map((p) => map[p] ?? p.toUpperCase());
}
