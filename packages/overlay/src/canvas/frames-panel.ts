/**
 * The frame list — what the left dock shows in view mode.
 *
 * Until now the only handle on a frame was the frame: its title on the canvas
 * was the sole entry point to selecting one, so a frame parked off-screen was
 * effectively lost, and there was nowhere at all that answered "what have I
 * got?". Eight is a small number, but it is more than enough to lose one in.
 *
 * It sits opposite the agent panel deliberately, in the mode where a frame is
 * the thing you are working on. Edit mode is about an element inside a frame,
 * and it already has two panels scoped to that; view mode is about the frames
 * themselves — `frame-chrome.ts` has restricted frame selection to view mode
 * since before this existed — so the list and the minimap take that slot rather
 * than leaving two element-scoped panels open over a mode with no element
 * selection.
 *
 * The verbs are not implemented here. They live in `frame-verbs.ts`, shared
 * with the canvas furniture and the bar, so a frame deleted from this list is
 * the same act with the same receipt and the same undo as one deleted with ⌫.
 * That file's header has the argument.
 */

import {
  DND,
  DndScope,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
  POINTER_ONLY,
} from "../dnd/manager";
import { clear, cls, el, PREFIX } from "../dom";
import { type IconName, icon } from "../icons";
import { keys, tip } from "../keys/registry";
import { createMenu, type MenuEntry, type MenuHandle } from "../popover-host";
import { customSizeRow, deviceGroups } from "./device-menu";
import { deleteFrame, duplicateFrame, reloadFrame } from "./frame-verbs";
import {
  type Frame,
  type FrameManager,
  groupOfPreset,
  MAX_FRAMES,
} from "./frames";
import type { CanvasViewport } from "./viewport";

/** A frame's glyph, by the device family it belongs to. */
function glyphFor(frame: Frame): IconName {
  switch (groupOfPreset(frame.presetId)?.id) {
    case "phone":
      return "device-mobile";
    case "tablet":
      return "device-tablet";
    default:
      return "layer-frame";
  }
}

export interface FramesPanelDeps {
  frames: FrameManager;
  viewport: CanvasViewport;
}

export class FramesPanel {
  readonly element: HTMLElement;

  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly dropLine: HTMLElement;
  private readonly scope = new DndScope();
  private readonly delta = new DragDelta();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly deps: FramesPanelDeps;

  /**
   * The ids the current rows were built from, in order.
   *
   * Structure is rebuilt only when this changes; renaming, resizing or
   * selecting takes the update path. Rebuilding on every render would be
   * cheap enough in DOM terms and wrong in two others: it destroys and
   * recreates a dnd-kit entity per row on every frame of a canvas pan, and it
   * throws away an in-progress inline rename the moment anything else moves.
   */
  private shape = "";
  /** The row being dragged, and where it would land. Null when not dragging. */
  private drag: { id: string; to: number } | null = null;
  /** The row whose name is being edited, so a render leaves it alone. */
  private renaming: string | null = null;

  constructor(deps: FramesPanelDeps) {
    this.deps = deps;
    this.count = el("span", { class: cls("fp-count") });
    this.addBtn = el(
      "button",
      {
        "aria-label": "Add a frame",
        class: cls("fp-add"),
        ...tip("Add a frame", "frame.add"),
        onClick: () => this.openAddMenu(),
        type: "button",
      },
      [icon("plus", "sm")]
    ) as HTMLButtonElement;
    this.dropLine = el("div", {
      class: `${cls("fp-drop")} ${cls("hidden")}`,
    });
    this.list = el("div", { class: cls("fp-list"), role: "list" });
    this.element = el("div", { class: cls("fp") }, [
      el("div", { class: cls("fp-bar") }, [this.count, this.addBtn]),
      // The drop line goes *inside* the list, which is what makes its `top`
      // mean what `showDropLine` computes. Parked in the scroller it was
      // positioned against that element's padding box while being measured from
      // the list's top edge, so every line drew one `--ap-space-xs` too high.
      el("div", { class: `${cls("fp-scroll")} ${cls("scroll-y")}` }, [
        this.list,
      ]),
    ]);
    this.list.append(this.dropLine);
    this.watchDrag();
    this.bindGripKeys();
  }

  /**
   * ↑ and ↓ on a focused grip, as real commands.
   *
   * These were a raw `onKeydown` on each grip, with the two menu rows that
   * describe them spelling `"↑"` and `"↓"` by hand — so the restack existed in
   * three places that agreed only by inspection, and in none that the shortcuts
   * panel or `CONTROLS.md` could see.
   *
   * Scoped to the list rather than to a grip: rows are rebuilt whenever the
   * frame set changes, and a binding per grip would be registered and disposed
   * on every rebuild. The list outlives them, and `within` is checked before
   * the chord, so ↑/↓ elsewhere still belong to whatever owns them there.
   */
  private bindGripKeys(): void {
    // The row comes from the keystroke's own origin, not from
    // `document.activeElement`: the binding only fired because the key was
    // pressed inside this list, so the event already says which row, and asking
    // the document instead would answer differently the moment anything else
    // took focus between the press and the handler.
    const move = (delta: number) => (e: KeyboardEvent) => {
      const from = e.target as HTMLElement | null;
      const id = from?.closest?.<HTMLElement>("[data-frame]")?.dataset.frame;
      if (!id) {
        return;
      }
      if (this.moveBy(id, delta)) {
        // The row this grip lived on has been rebuilt; take focus to the new one
        // so a run of presses keeps moving the same frame.
        this.rowOf(id)
          ?.querySelector<HTMLElement>(`.${cls("fp-grip")}`)
          ?.focus();
      }
    };
    this.unsubscribe.push(
      keys.bindAll([
        { id: "frame.bringForward", run: move(-1), within: this.list },
        { id: "frame.sendBackward", run: move(1), within: this.list },
      ])
    );
  }

  /**
   * Redraw. Driven from the stage's `notify`, so it runs on every frame of a
   * pan as well as on every frame mutation — see `shape`.
   */
  render(): void {
    const { frames } = this.deps;
    const shape = frames.all.map((f) => f.id).join(",");
    if (shape !== this.shape) {
      this.shape = shape;
      this.rebuild();
    }
    this.sync();
  }

  destroy(): void {
    this.scope.clear();
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.element.remove();
  }

  // -- Structure ---------------------------------------------------------------

  private rebuild(): void {
    // Every row owns a dnd entity; clearing before the DOM goes is what keeps
    // the registry from filling with detached elements that still answer
    // collision queries. See `DndScope`.
    this.scope.clear();
    clear(this.list);
    this.renaming = null;
    for (const frame of this.stackOrder()) {
      this.list.append(this.buildRow(frame));
    }
    // The line lives in the list so its offsets are the list's — which means
    // `clear` above takes it too. `rows()` is a class query rather than
    // `children` precisely so this sibling cannot be mistaken for a row.
    this.list.append(this.dropLine);
  }

  /**
   * The frames as the list shows them: front-most first.
   *
   * `frames.all` is paint order, and paint order runs the other way —
   * `FrameManager.applyOrder` writes each frame's array index straight out as
   * its `z-index`, so index 0 is the *back* of the stack and the last entry is
   * the front. Rendered in that order the panel read bottom-up, which is the
   * reverse of every layers panel there has ever been, and it made the restack
   * verbs incoherent: "Bring forward" moved a row *up* the list while moving the
   * frame *down* the stack, so the two halves of one gesture disagreed.
   *
   * Reversing the view rather than the model is what fixes it without touching
   * z-order: `reorder` and `applyOrder` still speak in stack indices, this panel
   * speaks in list positions, and {@link stackIndexAt} is the only place the two
   * meet. It also puts a newly added frame at the top, where a new layer goes.
   */
  private stackOrder(): Frame[] {
    return [...this.deps.frames.all].reverse();
  }

  /** The row elements, and only those — the drop line is a sibling of them. */
  private rows(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>(`.${cls("fp-row")}`)];
  }

  private buildRow(frame: Frame): HTMLElement {
    const gripId = `${PREFIX}-fp-grip-${frame.id}`;
    /*
     * Named, and deliberately not `aria-hidden`.
     *
     * The obvious reading of a drag handle is that it is decoration for the row
     * it sits on — which is what it was, until the restack arrived. It is no
     * longer dnd-kit's *handle* (the row is), but it is still a real tab stop
     * that this file gives a `tabindex` to, so an `aria-hidden` grip would be a
     * focusable element inside a hidden subtree: the exact shape of axe's
     * `aria-hidden-focus`, and a tab stop with no accessible name at all.
     *
     * The label is the same bargain `dockHeadAttrs` makes for the dock headers,
     * and for the same reason written there — a control with no name of its own
     * borrows the concatenated text of everything near it. `sync` keeps it
     * current, because a rename changes what this handle moves.
     */
    const grip = el(
      "span",
      {
        "aria-keyshortcuts": "ArrowUp ArrowDown",
        "aria-label": `Reorder ${frame.name}`,
        class: cls("fp-grip"),
        "data-tip": "Drag to restack",
        id: gripId,
        // The keyboard half of the same job. Bound here rather than through
        // `keys` because it is only meaningful while this handle has focus,
        // and the registry's `when` predicates are for global chords.
        /*
         * Ours, not dnd-kit's.
         *
         * The Accessibility plugin does stamp `tabindex="0"` on a handle — but
         * it does it from an effect, a tick after the entity is constructed.
         * `bindGripKeys` re-takes focus on a row that `reorder` has just rebuilt,
         * and in that window the fresh `span` is not focusable yet, so the
         * `focus()` silently did nothing and the second arrow press went to the
         * body. Setting it here makes the row focusable the moment it exists,
         * which is when it is needed.
         */
        tabindex: "0",
      },
      [icon("drag", "sm")]
    );
    const name = el("span", { class: cls("fp-name"), text: frame.name });
    const dims = el("span", { class: cls("fp-dims") });
    const pick = el(
      "button",
      {
        class: cls("fp-pick"),
        onClick: () => this.goTo(frame.id),
        onDblClick: () => this.zoomTo(frame.id),
        type: "button",
      },
      [icon(glyphFor(frame), "sm"), name, dims]
    );
    // The rename is armed on the label rather than the row: a double-click
    // anywhere else is zoom-to-frame, and one gesture cannot mean both.
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.beginRename(frame, name);
    });
    const more = el(
      "button",
      {
        "aria-haspopup": "menu",
        "aria-label": `Options for ${frame.name}`,
        class: cls("fp-more"),
        "data-tip": "Frame options",
        onClick: (e: Event) => {
          e.stopPropagation();
          this.openRowMenu(frame, more as HTMLElement);
        },
        // The whole row is the drag handle now, and dnd-kit's pointer sensor
        // listens on it — so without this a press on `⋯` arms a drag. The 4px
        // threshold means the click still lands, but the row fades and a drop
        // line appears under a pointer that was only opening a menu.
        onPointerdown: (e: Event) => e.stopPropagation(),
        type: "button",
      },
      [icon("more", "sm")]
    );
    /*
     * Three attributes written here to *stop* dnd-kit writing them.
     *
     * The Accessibility plugin stamps its markup on `handle ?? element`, and
     * every one of its writes is guarded by "if the attribute is absent" — so
     * pre-setting one is how you decline it. With the row as the handle
     * (see the `Draggable` below) all three would otherwise land here:
     *
     * - **`tabindex="0"`**, making every row a tab stop. The grip beside it is
     *   already one and is the real keyboard route, so this would be a second
     *   stop per row that does nothing the first does not.
     * - **`aria-describedby`** pointing at dnd-kit's hidden "to pick up a
     *   draggable item, press the space bar" text. That instruction cannot be
     *   followed: `POINTER_ONLY` unregisters the keyboard sensor precisely
     *   because a `FEEDBACK.none` draggable latches on Space and cannot be moved
     *   by any arrow key (see the note in `dnd/manager.ts`). Pointed at the grip
     *   instead, the description is the one control that *can* do the job.
     * - `role`, which is skipped anyway because `listitem` is already here — but
     *   only by that guard, so the attribute is load-bearing rather than
     *   decorative.
     *
     * `aria-roledescription="draggable"` is left to the plugin: unlike the
     * others it is simply true, and now true of the whole row.
     */
    const row = el(
      "div",
      {
        "aria-describedby": gripId,
        class: cls("fp-row"),
        "data-frame": frame.id,
        role: "listitem",
        tabindex: "-1",
      },
      [grip, pick, more]
    );
    this.scope.add(
      new Draggable(
        {
          element: row,
          /*
           * No `handle`, so the element *is* the handle — the whole row drags.
           *
           * It used to be the grip, which is a 16px strip at the far left that
           * is `opacity: 0` until the row is hovered: an invisible target the
           * width of a scrollbar, when every list of this shape lets you drag a
           * row by picking it up anywhere.
           *
           * Safe because the sensor has a 4px activation distance
           * (`DRAG_THRESHOLD`, restated in `POINTER_ONLY`), so a press that does
           * not travel still falls through to `pick`'s click and its
           * double-click. The one child that must not arm a drag is `⋯`, which
           * stops the press itself.
           */
          id: `${DND.frameRow}:${frame.id}`,
          // Nothing is translated: the row stays put and the drop line does the
          // reporting, so the list never reflows under the pointer.
          plugins: FEEDBACK.none,
          // …which is exactly why the keyboard sensor must go. See
          // `POINTER_ONLY`: left on, Space would latch a drag that no arrow key
          // can move and that eats the Tab out of it. The `frame.bringForward` and
          // `frame.sendBackward` commands are the real keyboard route.
          sensors: POINTER_ONLY,
          type: DND.frameRow,
        },
        manager
      )
    );
    return row;
  }

  /** Everything that changes without the set of frames changing. */
  private sync(): void {
    const { frames } = this.deps;
    const total = frames.all.length;
    this.count.textContent = `${total} of ${MAX_FRAMES} frames`;
    this.addBtn.disabled = total >= MAX_FRAMES;
    this.addBtn.dataset.tip =
      total >= MAX_FRAMES
        ? `Frame limit reached (${MAX_FRAMES})`
        : "Add a frame";
    const activeId = frames.active?.id ?? null;
    for (const frame of frames.all) {
      const row = this.rowOf(frame.id);
      if (!row) {
        continue;
      }
      row.classList.toggle(cls("fp-row-on"), frame.id === activeId);
      const name = row.querySelector(`.${cls("fp-name")}`);
      // Skipped mid-rename, or every keystroke would be overwritten by the
      // model value the edit has not committed yet.
      if (name && this.renaming !== frame.id) {
        name.textContent = frame.name;
      }
      const dims = row.querySelector(`.${cls("fp-dims")}`);
      if (dims) {
        dims.textContent = `${Math.round(frame.width)} × ${Math.round(frame.height)}`;
      }
      // Three names derived from the frame's own, so a rename does not leave
      // the row announcing itself by the name it used to have.
      row
        .querySelector(`.${cls("fp-pick")}`)
        ?.setAttribute(
          "aria-label",
          `${frame.name}, ${Math.round(frame.width)} by ${Math.round(frame.height)}`
        );
      row
        .querySelector(`.${cls("fp-grip")}`)
        ?.setAttribute("aria-label", `Reorder ${frame.name}`);
      row
        .querySelector(`.${cls("fp-more")}`)
        ?.setAttribute("aria-label", `Options for ${frame.name}`);
    }
  }

  private rowOf(id: string): HTMLElement | null {
    return this.list.querySelector(`[data-frame="${id}"]`);
  }

  // -- Navigation --------------------------------------------------------------

  /**
   * Select a frame and move the camera onto it, *without* changing the zoom.
   *
   * A list whose every click re-zoomed you would be unusable for the thing a
   * list is for — stepping between frames while working at one scale. Getting
   * closer is the double-click, and ⇧2 already exists for the selection.
   */
  private goTo(id: string): void {
    const frame = this.deps.frames.byId(id);
    if (!frame) {
      return;
    }
    this.deps.frames.setActive(id);
    this.deps.viewport.centerOn({
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    });
    this.deps.viewport.save();
  }

  private zoomTo(id: string): void {
    const frame = this.deps.frames.byId(id);
    if (!frame) {
      return;
    }
    this.deps.frames.setActive(id);
    this.deps.viewport.fitToRect({
      height: frame.height,
      left: frame.x,
      top: frame.y,
      width: frame.width,
    });
    this.deps.viewport.save();
  }

  // -- Rename ------------------------------------------------------------------

  /**
   * Edit a frame's name in place.
   *
   * `contenteditable` on the label already in the row, rather than swapping in
   * an `input`: the row is a grid and a field with its own metrics would resize
   * it under the pointer at the moment of the double-click. Enter commits,
   * Escape restores, blur commits — the same bargain the canvas title makes.
   */
  private beginRename(frame: Frame, label: HTMLElement): void {
    if (this.renaming === frame.id) {
      return;
    }
    this.renaming = frame.id;
    const before = frame.name;
    label.contentEditable = "plaintext-only";
    label.classList.add(cls("fp-name-edit"));
    label.focus();
    getSelection()?.selectAllChildren(label);

    /*
     * Local, not `this.renaming`.
     *
     * The shared field cannot tell two *sessions* apart, only two frames — and
     * the label is reused rather than rebuilt, so a second rename of the same
     * row left the first session's listener attached and still matching. Both
     * fired, and the older one ran first: Escape restored the name from before
     * the *first* rename, over a model holding the second, and it stayed wrong
     * until something else happened to re-render.
     *
     * `FrameChrome.renameFrame` never had this because it swaps in a fresh
     * `input` and drops it again — the listeners die with the element. This
     * takes the other half of the same bargain: a flag that belongs to the
     * session, and listeners that are taken down with it.
     */
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      this.renaming = null;
      label.removeEventListener("keydown", onKey);
      label.removeEventListener("blur", onBlur);
      label.contentEditable = "false";
      label.classList.remove(cls("fp-name-edit"));
      const next = (label.textContent ?? "").trim();
      // An empty name would leave a row with nothing to click and nothing to
      // read; the previous one is the only sensible thing to fall back to.
      if (commit && next && next !== before) {
        this.deps.frames.rename(frame.id, next);
      } else {
        label.textContent = before;
      }
    };

    function onKey(e: KeyboardEvent): void {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      // Every other key is the user typing a name, and must not reach the
      // canvas bindings underneath — ⌫ deletes the selected frame in this mode.
      e.stopPropagation();
    }
    function onBlur(): void {
      finish(true);
    }

    label.addEventListener("keydown", onKey);
    label.addEventListener("blur", onBlur);
  }

  // -- Menus -------------------------------------------------------------------

  /**
   * The panel's `+` — pick a device, get a frame.
   *
   * Its own menu, against its own button. It used to call the stage's
   * `openAddMenu`, which opens a menu parented to the bottom bar and placed
   * against it: pressing `+` in the left dock popped the device list open above
   * the middle of the window, nowhere near the control that was clicked. It
   * could not be dismissed by pressing `+` again either — `FrameChrome`'s
   * outside-press guard spares `.fc-menu, .fc-size, .fbar-btn` and the panel's
   * button is none of them, so the press closed the menu and the click reopened
   * it.
   *
   * The bar's own `+` and the `F` shortcut still go to `FrameChrome`, which is
   * right: that menu is anchored to *that* button.
   */
  private openAddMenu(): void {
    // Declared before the menu that owns it: the form has to be able to close
    // the menu it is standing in, and it is built as one of that menu's entries.
    let handle: MenuHandle | null = null;
    const custom = customSizeRow(
      (width, height) =>
        this.deps.frames.add({ height, name: `${width} × ${height}`, width }),
      () => handle?.close()
    );
    handle = createMenu([
      ...deviceGroups((preset) =>
        this.deps.frames.add({ presetId: preset.id })
      ),
      { separator: true },
      { node: custom },
    ]);
    handle.open(this.addBtn, "below");
  }

  /**
   * The row's `⋯` — the verbs, then the device list.
   *
   * **Verbs first, and that ordering is not taste.** Even grouped, the device
   * list is four more lines; built the other way round the verbs start below the
   * fold on a row near the bottom of the panel, which puts Delete out of sight in
   * a menu you opened to reach it. Leading with the verbs means everything that
   * acts on the frame is in view on open and the devices are the tail you open
   * deliberately.
   *
   * The device half is `device-menu.ts`'s, shared with the panel's `+` and built
   * from `PRESET_GROUPS` — so this list cannot drift out of step with the one on
   * the canvas.
   */
  private openRowMenu(frame: Frame, anchor: HTMLElement): void {
    const at = this.indexOf(frame.id);
    const last = this.deps.frames.all.length - 1;
    const entries: MenuEntry[] = [
      /*
       * The discoverable half of the restack. The grip's arrows are the fast
       * route and are announced on the handle itself; a menu row is what tells
       * anyone the operation exists at all.
       *
       * `at` is a *list* position, so forward is `-1` and the guards read off
       * the ends of the list — which is the same thing as the ends of the stack
       * now that the list is front-first. This pair used to say `-1` for forward
       * against a back-first list and therefore did the opposite of its label:
       * `applyOrder` writes the array index straight out as `z-index`, so
       * lowering the index sends a frame *back*. See `stackOrder`.
       */
      {
        command: "frame.bringForward",
        disabled: at <= 0,
        icon: "chev-up",
        label: "Bring forward",
        run: () => this.moveBy(frame.id, -1),
      },
      {
        command: "frame.sendBackward",
        disabled: at < 0 || at >= last,
        icon: "chev-down",
        label: "Send backward",
        run: () => this.moveBy(frame.id, 1),
      },
      { separator: true },
      {
        icon: "rotation",
        label: "Rotate",
        run: () => this.deps.frames.rotate(frame.id),
      },
      {
        icon: "rotate-ccw",
        label: "Reload",
        run: () => reloadFrame(this.deps.frames, frame),
      },
      {
        // The one door onto Duplicate that has a control to grey out, so the
        // refusal does not have to be spoken here — see `duplicateFrame`.
        disabled: this.deps.frames.all.length >= MAX_FRAMES,
        icon: "doc-plus",
        label: "Duplicate",
        run: () => duplicateFrame(this.deps.frames, frame),
      },
      {
        // The bin, matching the bar's Delete frame button. These two are one
        // verb and drew two different glyphs — a `✕` here and a `−` there —
        // because the imported set publishes no trash and both call sites
        // improvised. See `trash` in the icon set's ICONS.md.
        icon: "trash",
        label: "Delete",
        run: () => deleteFrame(this.deps.frames, frame),
      },
      { separator: true },
      ...deviceGroups(
        (preset) => this.deps.frames.applyPreset(frame.id, preset.id),
        frame
      ),
    ];
    createMenu(entries).open(anchor, "below");
  }

  // -- Reorder -----------------------------------------------------------------

  /**
   * Move a frame one row through the list.
   *
   * `delta` is in *list* terms — `-1` is one row up, which is one place toward
   * the front of the stack. Everything the panel does is stated that way, and
   * {@link stackIndexAt} turns the answer back into the index `reorder` wants.
   *
   * The keyboard and menu route to the same thing the drag does, so there is one
   * definition of what "restack" means. The precedent is `num-field.ts`, whose
   * `FEEDBACK.none` scrub has `stepBy` beside it on the arrow keys for the same
   * reason: the drag is a pointer gesture, and a pointer gesture is not an
   * interaction — it is one way to reach one.
   *
   * Returns whether anything moved, which is what lets the menu grey out its
   * ends and the key handler decide whether to swallow the press.
   */
  private moveBy(id: string, delta: number): boolean {
    const from = this.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= this.deps.frames.all.length) {
      return false;
    }
    this.deps.frames.reorder(id, this.stackIndexAt(to));
    return true;
  }

  /**
   * ↑/↓ on a focused grip.
   *
   * Focus is re-taken after the move because `reorder` fires `onChanged`, which
   * re-renders, which rebuilds every row — so the element the key arrived on is
   * gone by the time this returns and the next press would land on the body.
   * Looked up by frame id rather than held as a node, for the same reason.
   *
   * Plain arrows are safe without a guard: the global Nudge binding is gated on
   * `editing && selection`, and this panel exists only in view mode.
   */
  /**
   * Drag a row to restack the frames.
   *
   * The list is the stack seen from the front, which is what makes this worth
   * having at all: frames may overlap on the canvas, and until now nothing could
   * change which one was on top. Dragging a row up moves its frame toward you,
   * because up the list *is* toward the front — see `stackOrder`.
   * `FrameManager.reorder` publishes the result as `z-index` rather than moving
   * anything in the DOM — moving an `iframe` reloads it, and a drag that
   * rebooted the app you were looking at would be a strange price for raising it
   * one place.
   *
   * The pointer is read from `DragDelta`, not from the operation's own
   * `position.current`, for the reason that class documents: the manager
   * assigns that in a microtask *after* `dragmove` is dispatched, so a target
   * resolved here from it would be one move behind.
   */
  private watchDrag(): void {
    this.unsubscribe.push(
      manager.monitor.addEventListener("dragstart", () => {
        const id = rowIdOf(manager.dragOperation.source);
        if (!id) {
          return;
        }
        this.delta.start();
        this.drag = { id, to: this.indexOf(id) };
        this.rowOf(id)?.classList.add(cls("fp-row-drag"));
      }),
      manager.monitor.addEventListener("dragmove", (e) => {
        if (!this.drag) {
          return;
        }
        this.delta.update(e);
        this.drag.to = this.dropIndexAt(this.delta.pointer.y);
        this.showDropLine(this.drag.to);
      }),
      manager.monitor.addEventListener("dragend", (e) => {
        const { drag } = this;
        if (!drag) {
          return;
        }
        this.drag = null;
        this.rowOf(drag.id)?.classList.remove(cls("fp-row-drag"));
        this.dropLine.classList.add(cls("hidden"));
        if (e.canceled) {
          return;
        }
        this.deps.frames.reorder(
          drag.id,
          dropStackIndex(
            drag.to,
            this.indexOf(drag.id),
            this.deps.frames.all.length
          )
        );
      })
    );
  }

  /** A frame's row position, counting from the top. -1 if it has no row. */
  private indexOf(id: string): number {
    const at = this.deps.frames.all.findIndex((f) => f.id === id);
    return at === -1 ? -1 : this.stackIndexAt(at);
  }

  /**
   * List position ↔ stack index, in one function because it is one fact.
   *
   * The list runs front-to-back and the model runs back-to-front, so the two are
   * mirror images: `last - n`. That makes this its own inverse, which is why one
   * name serves both directions — `stackIndexAt(listPosition)` and
   * `stackIndexAt(stackIndex)` are the same arithmetic read the other way round.
   * See {@link stackOrder} for why the view is the half that got reversed.
   */
  private stackIndexAt(n: number): number {
    return this.deps.frames.all.length - 1 - n;
  }

  /** How many rows the pointer has passed the midpoint of — the insertion slot. */
  private dropIndexAt(y: number): number {
    let index = 0;
    for (const row of this.rows()) {
      const r = row.getBoundingClientRect();
      if (y > r.top + r.height / 2) {
        index += 1;
      }
    }
    return index;
  }

  /**
   * Draw the line at an insertion slot.
   *
   * Slot `n` is the *top* of row `n`, except for the one past the end, which is
   * the bottom of the last row — so the line can be shown below everything
   * without a phantom row to hang it on. Positioned against the list rather
   * than the scroller so it travels with the rows when the list is scrolled
   * mid-drag.
   */
  private showDropLine(index: number): void {
    const rows = this.rows();
    const past = index >= rows.length;
    const edge = past ? rows.at(-1) : rows[index];
    if (!edge) {
      return;
    }
    const host = this.list.getBoundingClientRect();
    const r = edge.getBoundingClientRect();
    this.dropLine.style.top = `${(past ? r.bottom : r.top) - host.top}px`;
    this.dropLine.classList.remove(cls("hidden"));
  }
}

/**
 * Where a dropped row lands, as a stack index.
 *
 * Two corrections, and getting either wrong moves the frame one place from
 * where the line promised — which is the kind of bug that reads as the drop
 * being imprecise rather than as arithmetic.
 *
 * First, `to` is an *insertion slot* in the list as it currently stands, with
 * the dragged row still in it. Lifting the row out shifts everything below it up
 * by one, so a row that travelled downward lands one place earlier than its slot
 * number says. A row that travelled up is unaffected: nothing between it and the
 * slot has moved.
 *
 * Second, the result is still a list position, and the list runs front-to-back
 * while `FrameManager` runs back-to-front. See `FramesPanel.stackOrder`.
 *
 * Exported to the test rather than left inline because it is the whole of the
 * drop's correctness and the only part of the drag that can be checked without
 * standing up dnd-kit's manager in a DOM that does no layout.
 */
export function dropStackIndex(
  to: number,
  from: number,
  total: number
): number {
  return total - 1 - (to > from ? to - 1 : to);
}

/** The frame id carried by a drag source, or null if it is not one of ours. */
function rowIdOf(
  source: { id?: unknown; type?: unknown } | null
): string | null {
  if (!source || source.type !== DND.frameRow) {
    return null;
  }
  const id = String(source.id);
  return id.slice(id.indexOf(":", DND.frameRow.length) + 1) || null;
}
