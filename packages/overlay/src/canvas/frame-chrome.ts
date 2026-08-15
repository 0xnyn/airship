import { type ChromeLayer, place } from "../chrome-layer";
import {
  type Coordinates,
  DND,
  DndScope,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
} from "../dnd/manager";
import { clear, cls, el, PREFIX } from "../dom";
import { type IconName, icon } from "../icons";
import { keys } from "../keys/registry";
import { placePopover } from "../popover";
import { createMenu, type MenuEntry } from "../popover-host";
import { isElement } from "../realm";
import { customSizeRow } from "./device-menu";
import { deleteFrame, duplicateFrame, reloadFrame } from "./frame-verbs";
import {
  type DevicePreset,
  type Frame,
  type FrameManager,
  framePreset,
  groupOfPreset,
  MAX_FRAMES,
  PRESET_GROUPS,
} from "./frames";
import { frameScreenRect } from "./space";
import type { CanvasViewport } from "./viewport";

/**
 * The furniture around each frame: title, size badge, and the grips that resize
 * the frame itself.
 *
 * The badge is a readout, not a control. It used to open a menu carrying
 * Dimensions, Rotate, Reload, Duplicate and Delete — all five of which are now
 * buttons in the bottom bar's frame group, acting on the selected frame. Two
 * routes to one set of verbs is one more than this canvas needs, and the route
 * hanging off the frame was the one you had to already know was there.
 *
 * All of it is drawn in screen space at 1×, like the selection chrome — a title
 * that shrank to nothing at 20% zoom would defeat the purpose of zooming out to
 * see the whole canvas, which is precisely when you most need to tell frames
 * apart. Only the *positions* come from the world transform.
 *
 * Two resize gestures exist on this canvas and they are deliberately distinct:
 * the grips here change a **frame's viewport** (making the app inside reflow, as
 * a real browser resize would), while the grips in `picker.ts` change a selected
 * **element's CSS**. Frame grips sit on the frame's outer border, element grips
 * on the selection, and only one is ever armed for a given press.
 */

interface FrameChromeDeps {
  frames: FrameManager;
  /** Is a screen point over the canvas at all (vs. over a dock)? */
  inCanvas: (point: { x: number; y: number }) => boolean;
  layer: ChromeLayer;
  onChanged: () => void;
  viewport: CanvasViewport;
}

/** Menu key for the toolbar's add-frame menu, alongside the per-frame ids. */
const ADD_MENU = "__add__";

/**
 * Menu key for the frame group's dimensions menu.
 *
 * A second sentinel beside `ADD_MENU` rather than reusing a frame's own id: this
 * box is anchored to the bar, not to a frame's title, and `syncMenus` picks the
 * anchor off the key. Sharing an id would place the bar's menu over the canvas.
 */
const DIMS_MENU = "__dims__";

const GRIPS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type GripPos = (typeof GRIPS)[number];

interface MoveState {
  id: string;
  /** Latched at drag start so a mid-drag zoom cannot change the ratio. */
  scale: number;
  startX: number;
  startY: number;
}

interface ResizeState {
  grip: GripPos;
  id: string;
  scale: number;
  startH: number;
  startW: number;
  startX: number;
  startY: number;
}

/**
 * Did this press land on a frame's own furniture — its title, size badge or a
 * resize grip?
 *
 * Deliberately *not* part of `edit-guard.ts`'s `isOwn`. That predicate answers
 * "is this the editor's chrome", and the note above its `CHROME` list explains
 * why frame furniture is excluded from it: a wheel or a space-drag over a frame
 * title belongs to the canvas or to the frame beneath, and folding it into
 * `isOwn` would make that whole band dead to four different controllers at once.
 *
 * This is the narrower question, asked by the one caller that needs it: the Hand
 * tool, which pans the surface but must not swallow a press aimed at a single
 * frame's title. See `CanvasViewport.onPointerDown`.
 */
export function isFrameChrome(target: EventTarget | null): boolean {
  // `isElement`, not `instanceof Element`, for the reason spelled out on
  // `isOwn`: a node from inside a frame's iframe belongs to that realm, and
  // `instanceof` answers false for every one of them.
  return isElement(target) && Boolean(target.closest(`.${cls("fc")}`));
}

export class FrameChrome {
  private readonly root: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly addMenu: HTMLElement;
  private readonly addBtn: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  /** The selection-contingent verb group — see `buildFrameTools`. */
  private readonly frameTools: HTMLElement;
  private readonly dimsMenu: HTMLElement;
  private readonly dimsBtn: HTMLElement;
  private readonly dupBtn: HTMLElement;
  private readonly scope = new DndScope();
  private readonly delta = new DragDelta();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly boxes = new Map<string, HTMLElement>();

  private move: MoveState | null = null;
  private resize: ResizeState | null = null;
  private menuFor: string | null = null;
  /**
   * Which device group the open menu has expanded, or null for none.
   *
   * Beside `menuFor` rather than in the DOM, for the same reason that is: one
   * menu is open at a time, so its expanded group is a property of that one open
   * state. Single-open for the reason `presetGroups` gives. And it is *seeded*,
   * not derived. `syncMenus` runs on every frame of a pan, so a value re-derived
   * there would reopen the group the frame's device is in and fight whatever the
   * user had just expanded. Seeding on open and only writing it from `setGroup`
   * makes every later sync idempotent.
   */
  private menuGroup: string | null = null;
  /** Escape, bound only while a menu is up. */
  private unbindMenuKeys: (() => void) | null = null;
  /** Edit mode makes the frame furniture inert — see `setEditing`. */
  private editing = false;

  private readonly deps: FrameChromeDeps;

  constructor(deps: FrameChromeDeps) {
    this.deps = deps;
    this.root = el("div", { class: cls("fchrome-root") });
    // The readout is a menu, not a reset button. "Click the percentage to go
    // back to 100%" is a hidden affordance; the list also surfaces zoom-to-
    // selection, which had no discoverable entry point at all.
    this.zoomLabel = el("button", {
      class: cls("fbar-zoom"),
      "data-tip": "Zoom",
      onClick: (e: Event) => {
        e.stopPropagation();
        // Built per open rather than once. It carried a minimap checkbox whose
        // `on` was read at render time, so a menu built in the constructor
        // showed that state forever; the checkbox is gone, but the rows still
        // close over live viewport state and this costs nothing. Re-opening
        // still toggles shut — that is keyed on the *anchor* in `openPopover`'s
        // stack, not on the handle.
        createMenu(this.zoomEntries()).open(this.zoomLabel, "above");
      },
      text: "100%",
      type: "button",
    });
    this.addMenu = this.buildAddMenu();
    this.addBtn = this.barButton("plus", "Add a frame", (e) => {
      e.stopPropagation();
      this.toggleMenu(ADD_MENU);
    });
    this.toolbar = el("div", { class: cls("fbar") }, [
      this.addBtn,
      el("div", { class: cls("fbar-sep") }),
      // "Zoom to fit", not "Zoom to fit (⇧1)". `barButton` uses the label as the
      // tip, and `Tooltips.show` resolves the chord by matching that string
      // against a binding's `label` — so spelling the chord into the text both
      // duplicated it and stopped the real chip from ever being found.
      this.barButton("fit", "Zoom to fit", () => {
        this.deps.viewport.zoomToFit();
        this.deps.viewport.save();
      }),
      this.zoomLabel,
      this.addMenu,
    ]);

    // A glyph, not a readout. This was the frame's size as text, which made it
    // the one control in the bar that changed width with its own value — the
    // group jumped every time you resized a frame, and "1440 × 900" is three
    // buttons wide next to glyphs. The numbers are not lost: they are on the
    // frame's own label a few pixels up (`.fc-size`, and with the device name
    // besides), and `syncDims` keeps them in this button's tooltip.
    this.dimsBtn = this.barButton("layer-frame", "Frame dimensions", (e) => {
      e.stopPropagation();
      this.toggleMenu(DIMS_MENU);
    });
    this.dupBtn = this.barButton("doc-plus", "Duplicate frame", (e) => {
      e.stopPropagation();
      this.duplicateActiveFrame();
    });
    this.dimsMenu = this.buildDimsMenu();
    this.frameTools = this.buildFrameTools();

    this.unsubscribe.push(
      manager.monitor.addEventListener("dragstart", () => this.onDragStart()),
      manager.monitor.addEventListener("dragmove", (e) =>
        this.onDragMove(this.delta.update(e))
      ),
      manager.monitor.addEventListener("dragend", (e) =>
        this.onDragEnd(e.canceled)
      ),
      // Backspace, in **view** mode — the exact complement of the element delete
      // in `AirshipApp.bindEditorKeys`, which is gated on `editing` for the
      // reason written there: in view mode the page belongs to the user. This
      // does not contradict that, it completes it. Element selection exists only
      // while editing and frame selection only while not (see
      // `onDocumentPress`), so the two guards are disjoint by construction and
      // exactly one of the pair can ever match.
      //
      // Registration order is *not* the guarantee and must not become one.
      // `keys.bind` unshifts and `CanvasStage` is built before `AirshipApp`, so
      // the element delete actually sits ahead of this one; it is the guards
      // that keep them apart. `catalog.test.ts` now checks that pairing rather
      // than trusting this paragraph: two commands may share a chord only if
      // their modes are disjoint, which `element.delete` (edit) and
      // `frame.delete` (view) are.
      //
      // Bound here rather than through `Stage`. `Keys` evaluates `when` before
      // `run` and consumes the event on any match, so an honest guard needs a
      // *live* read of the selection — which through that seam would mean two
      // new members on an interface whose whole point is being narrow, to reach
      // state that is already sitting in this file. `viewport.ts` binds its zoom
      // set locally for the same reason.
      //
      // A keystroke typed into the app cannot reach this. In view mode frames
      // are live, and a key pressed inside one is delivered to that frame's own
      // document — the shell listens on its own and never sees it (see the note
      // on `onGuardedKey` in `frame-agent.ts`). What *can* reach it is a key
      // typed into the shell's own fields: the composer, the inline rename, this
      // menu's W/H boxes. `isTypingTarget` skips every binding without
      // `allowWhileTyping` for exactly those, and this one does not carry it.
      //
      keys.bind({
        id: "frame.delete",
        run: () => this.deleteActiveFrame(),
        when: () => !this.editing && this.deps.frames.active !== null,
      })
    );
    // A press anywhere else closes an open device menu.
    document.addEventListener("pointerdown", this.onDocumentPress, true);
  }

  /** Open the add-frame menu — what the `F` shortcut resolves to. */
  openAddMenu(): void {
    this.toggleMenu(ADD_MENU);
  }

  /**
   * `toolbar` is the canvas's section of the shell's one bottom bar, so it is
   * handed a host rather than being parked on the chrome layer as a second
   * floating toolbar of its own. The frame furniture in `root` still belongs on
   * the layer: it is drawn over the canvas, in screen space, per frame.
   */
  mount(toolbarHost: HTMLElement): void {
    this.deps.layer.add(this.root);
    toolbarHost.append(this.toolbar);
  }

  /**
   * The frame verbs go into their own slot in the bar's **view-mode** zone,
   * beside the Hand — not into `toolbar` with the canvas tools.
   *
   * Two reasons, and the first is a real bug rather than a preference.
   * `syncMenus` places the add menu against `toolbar`'s own rect, aligned to its
   * left edge; five selection-contingent controls inside that element would move
   * the `+` menu's anchor every time a frame is selected or deselected. And the
   * bar's zones mean something: `toolbar` carries add-frame, fit and zoom, which
   * are true with nothing selected and are shown in both modes, while these are
   * true of one picked frame and only in the mode where a frame can be picked.
   *
   * The host is `AirshipApp`'s and the group inside it is ours, which is what
   * lets both gates be written independently: the app hides the host by *mode*
   * through `syncBar`, and `syncFrameTools` hides this group by *selection*.
   * Neither writes the other's class, so neither can clobber it.
   */
  mountFrameTools(host: HTMLElement): void {
    host.append(this.frameTools);
  }

  /**
   * Frame furniture is mode-dependent again — but in the opposite direction, and
   * gating *interaction* rather than identity.
   *
   * The history is worth keeping. The first version hid the title, outline and
   * grips in **view** mode, reasoning that they were editing affordances. That
   * was wrong and was reverted: identifying a frame, selecting it, moving it and
   * resizing it are canvas operations, and hiding them made view mode strictly
   * worse — you could not tell which frame was which, and could not resize one,
   * which is exactly what you want to do while *using* the app at a width.
   *
   * The gate now runs the other way. In **edit** mode the canvas is scaffolding:
   * you are working on an element inside a frame, and a drag that was meant for
   * a node is not improved by also being able to grab the frame under it. So
   * edit mode makes the furniture inert — no drag, no menu, no rename, no grips,
   * no selection outline — while leaving the **title and size badge visible**.
   * That is the half of the old objection that was right: knowing which frame is
   * which costs nothing to keep, and is what made the first attempt unusable.
   *
   * Everything falls out of one class on the root, rather than a per-frame
   * rebuild: the chrome is rebuilt only when the frame *set* changes, and
   * re-running that on every mode toggle would throw away every dnd-kit entity
   * in it to change what amounts to four CSS declarations.
   */
  setEditing(on: boolean): void {
    if (on === this.editing) {
      return;
    }
    this.editing = on;
    this.root.classList.toggle(cls("fchrome-inert"), on);
    if (on) {
      // A device menu is anchored to a badge that is about to stop responding;
      // leaving it open would strand it above dead chrome.
      this.closeMenu();
    }
  }

  /**
   * Rebuild the per-frame furniture, then position it.
   *
   * Structure is rebuilt only when the set of frames changes; the common case —
   * a pan or a zoom, many times a second — takes the `position` path alone.
   */
  render(): void {
    const wanted = new Set(this.deps.frames.all.map((f) => f.id));
    for (const [id, node] of this.boxes) {
      if (!wanted.has(id)) {
        node.remove();
        this.boxes.delete(id);
      }
    }
    // A menu whose frame has gone — deleted from the keyboard, or by the bar,
    // while its own menu was open. `syncMenus` iterates the boxes that exist, so
    // a dead `menuFor` is invisible to it: the box has already been pruned above,
    // nothing un-hides, and `armMenuKeys` leaves Escape bound to an id that
    // resolves to nothing. Could not happen while `menuAction` was the only way
    // in, because that closes the menu first.
    if (
      this.menuFor !== null &&
      this.menuFor !== ADD_MENU &&
      this.menuFor !== DIMS_MENU &&
      !this.deps.frames.byId(this.menuFor)
    ) {
      this.closeMenu();
    }
    if (this.boxes.size !== wanted.size) {
      this.rebuild();
    }
    this.position();
  }

  destroy(): void {
    this.scope.clear();
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.unbindMenuKeys?.();
    this.unbindMenuKeys = null;
    document.removeEventListener("pointerdown", this.onDocumentPress, true);
    this.root.remove();
    this.toolbar.remove();
    // The host belongs to the bar, but the group in it is ours — and the bar
    // outlives a stage swap.
    this.frameTools.remove();
  }

  /**
   * The zoom readout's menu.
   *
   * A menu rather than a reset button: "click the percentage to go back to
   * 100%" is a hidden affordance, and the list also surfaces zoom-to-selection,
   * which had no discoverable entry point at all.
   *
   * It used to carry a "Show minimap" checkbox as its last row, and that row was
   * the only way to bring the map back once its close button had been used —
   * a control whose off switch sat on the card itself and whose on switch was
   * buried under a percentage readout. The map does not hide any more, so
   * neither the row nor the deps behind it exist. See `minimap.ts`.
   */
  private zoomEntries(): MenuEntry[] {
    // `command`, not `hint`. These five used to spell their own chords: "⌘+"
    // where the binding is `mod+=`, "⌘−" with a U+2212 minus where it is an
    // ASCII hyphen, and all five rendered as Mac glyphs on Windows and Linux.
    // The registry renders them now, in the reader's own platform's spelling.
    const entries: MenuEntry[] = [
      { command: "view.zoomIn", label: "Zoom in", run: () => this.zoomBy(1) },
      {
        command: "view.zoomOut",
        label: "Zoom out",
        run: () => this.zoomBy(-1),
      },
      {
        command: "view.zoomToFit",
        label: "Zoom to fit",
        run: () => this.runZoom(() => this.deps.viewport.zoomToFit()),
      },
      {
        command: "view.zoomToSelection",
        label: "Zoom to selection",
        run: () => this.runZoom(() => this.deps.viewport.zoomToSelection()),
      },
      {
        command: "view.zoom100",
        label: "Zoom to 100%",
        run: () => this.runZoom(() => this.deps.viewport.zoomTo100()),
      },
    ];
    return entries;
  }

  private runZoom(fn: () => void): void {
    fn();
    this.deps.viewport.save();
  }

  private zoomBy(step: 1 | -1): void {
    this.deps.viewport.zoomStep(step);
    this.deps.viewport.save();
  }

  // -- Building --------------------------------------------------------------

  private rebuild(): void {
    this.scope.clear();
    clear(this.root);
    this.boxes.clear();
    for (const frame of this.deps.frames.all) {
      const box = this.buildFrameChrome(frame);
      this.boxes.set(frame.id, box);
      this.root.append(box);
    }
  }

  private buildFrameChrome(frame: Frame): HTMLElement {
    const title = el("span", { class: cls("fc-name"), text: frame.name });
    // A label, not a button. It used to open a menu carrying Dimensions,
    // Rotate, Reload, Duplicate and Delete — every one of which is now a button
    // in the bottom bar's frame group, on the selected frame. Two routes to the
    // same five verbs is one more than the canvas needs, and the one attached to
    // the frame was the one you had to know was there.
    const size = el("span", {
      class: cls("fc-size"),
      text: sizeLabel(frame),
    });

    const label = el(
      "div",
      {
        class: cls("fc-label"),
        "data-tip": "Drag to move, double-click to rename",
        onClick: () => this.deps.frames.setActive(frame.id),
        onDblclick: () => this.renameFrame(frame),
      },
      [title, size]
    );
    this.scope.add(
      new Draggable(
        {
          element: label,
          id: `${DND.frameMove}:${frame.id}`,
          // The label is pinned to the frame's screen rect and re-placed every
          // move; letting dnd-kit translate it too would double the motion.
          plugins: FEEDBACK.none,
          type: DND.frameMove,
        },
        manager
      )
    );

    const outline = el("div", { class: cls("fc-outline") });
    for (const pos of GRIPS) {
      const grip = el("div", {
        class: `${cls("fc-grip")} ${cls(`fc-grip-${pos}`)}`,
      });
      this.scope.add(
        new Draggable(
          {
            element: grip,
            id: `${DND.frameGrip}:${frame.id}:${pos}`,
            plugins: FEEDBACK.none,
            type: DND.frameGrip,
          },
          manager
        )
      );
      outline.append(grip);
    }

    return el("div", { class: cls("fc"), "data-frame": frame.id }, [
      label,
      outline,
    ]);
  }

  /**
   * One device row. `data-preset` is what lets `syncMenuState` re-derive the
   * current-device mark on an already-built menu; `isCurrent` only seeds it,
   * because rows are built once and `rebuild()` only runs when the *set* of
   * frames changes, so a mark left to the build alone goes stale the moment you
   * pick a different device. Inert for the add-frame menu, which has no current
   * device.
   */
  private presetRow(
    preset: DevicePreset,
    pick: (preset: DevicePreset) => void,
    isCurrent?: (preset: DevicePreset) => boolean
  ): HTMLElement {
    return el(
      "button",
      {
        class: `${cls("fc-menu-item")}${isCurrent?.(preset) ? ` ${cls("fc-menu-on")}` : ""}`,
        "data-preset": preset.id,
        onClick: (e: Event) => {
          e.stopPropagation();
          pick(preset);
          this.closeMenu();
        },
        type: "button",
      },
      [
        el("span", { text: preset.label }),
        el("span", {
          class: cls("fc-menu-dim"),
          text: `${preset.width} × ${preset.height}`,
        }),
      ]
    );
  }

  /**
   * The device list, shared by every menu that asks "which viewport?" — the
   * frame's size badge, the canvas's `+`, and the bar's dimensions button — so
   * all three show the same sizes rather than one of them silently guessing.
   *
   * Twenty-three devices in one column is a scroll with no structure, so they
   * are bucketed the way a design tool buckets them and only one bucket is open at a
   * time. `menuGroup` holds which; `syncGroups` applies it.
   *
   * Deliberately not `chat/disclosure.ts`, though this is exactly its shape.
   * Read that file's header for why a disclosure here is a `<button>` and a
   * `<div>` rather than `<details>/<summary>` — host-page resets, and `<summary>`
   * swallowing the activation of every nested button, which is precisely what a
   * list of device buttons would hit. That reasoning holds and is not re-derived.
   *
   * What does not carry over is ownership of the open state. That primitive
   * keeps a boolean per row; this accordion is single-open, and its one open
   * group is re-seeded on every menu open and left alone on every pan in
   * between. Per-row handles would mean a registry keyed like `menuFor`, alive
   * alongside `boxes` and pruned with it; one field beside `menuFor` is the
   * mechanism this file already uses for open state, and it is three lines.
   * That primitive also *detaches* a closed body, which would put collapsed rows
   * out of reach of `syncMenuState`'s `[data-preset]` sweep and let a mark go
   * stale while its group was shut. Hiding rather than detaching keeps every row
   * addressable and still measures zero for `placePopover`.
   *
   * `aria-expanded` and the `hidden` class here are seeds only, on the same
   * terms as `isCurrent` above: `syncGroups` owns them from the first sync on.
   */
  private presetGroups(
    pick: (preset: DevicePreset) => void,
    isCurrent?: (preset: DevicePreset) => boolean
  ): HTMLElement[] {
    return PRESET_GROUPS.map((group) =>
      el("div", { class: cls("fc-dgroup"), "data-group": group.id }, [
        el(
          "button",
          {
            "aria-expanded": "false",
            class: cls("fc-dgroup-head"),
            onClick: (e: Event) => {
              e.stopPropagation();
              this.setGroup(group.id);
            },
            type: "button",
          },
          [icon("chev-right", "xs"), el("span", { text: group.label })]
        ),
        el(
          "div",
          { class: `${cls("fc-dgroup-body")} ${cls("hidden")}` },
          group.presets.map((preset) => this.presetRow(preset, pick, isCurrent))
        ),
      ])
    );
  }

  /**
   * A width × height row that commits on Enter or on its button.
   *
   * The form itself is `device-menu.ts`'s — the frame list's `+` grew one too,
   * and two copies of a two-field form is two places for the minimum to drift.
   * This wrapper is the part that is genuinely this file's: which closer to hand
   * it, and where the fields start.
   *
   * They start at the frame's *current* size, which is what makes this a nudge
   * rather than a form: almost every custom size is an adjustment of the size
   * you already have — 1440 wide but shorter, this phone but taller — and
   * starting from a fixed 1280 × 800 meant retyping both numbers to change one.
   * `syncCustomRow` re-seeds them each time a menu opens, because the menu is
   * built once and the frame keeps changing under it.
   *
   * The `+` menu passes nothing: there is no current frame to inherit from, so
   * it keeps the neutral desktop default it always had.
   */
  private customRow(
    apply: (width: number, height: number) => void,
    start?: { height: number; width: number }
  ): HTMLElement {
    return customSizeRow(apply, () => this.closeMenu(), start);
  }

  // -- Verbs -------------------------------------------------------------------

  /*
   * The verbs themselves live in `frame-verbs.ts`, shared with the frame list.
   *
   * What stays here is the *active-frame* half of each pair, and the split is
   * the same one it has always been: the bar has no `Frame` in hand — it acts
   * on whatever is selected — while the keyboard paths and the list do. Moving
   * the bodies out is what stops a third door from growing its own wording, or
   * its own missing undo; see the header of that file.
   */

  private rotateActiveFrame(): void {
    const frame = this.deps.frames.active;
    if (frame) {
      // Silent, like the menu row: `syncFrameTools` rewrites the readout on the
      // very button that was clicked, and the frame visibly changes shape.
      this.deps.frames.rotate(frame.id);
    }
  }

  private reloadActiveFrame(): void {
    const frame = this.deps.frames.active;
    if (frame) {
      reloadFrame(this.deps.frames, frame);
    }
  }

  private duplicateActiveFrame(): void {
    const frame = this.deps.frames.active;
    if (frame) {
      duplicateFrame(this.deps.frames, frame);
    }
  }

  /** What ⌫ and the bar's `−` resolve to. */
  private deleteActiveFrame(): void {
    const frame = this.deps.frames.active;
    if (frame) {
      deleteFrame(this.deps.frames, frame);
    }
  }

  /** The + button's menu: pick the size up front instead of guessing one. */
  private buildAddMenu(): HTMLElement {
    return el(
      "div",
      {
        class: `${cls("fc-menu")} ${cls("fbar-menu")} ${cls("scroll-y")} ${cls("hidden")}`,
        onClick: (e: Event) => e.stopPropagation(),
      },
      [
        el("div", { class: cls("fc-menu-head"), text: "New frame" }),
        ...this.presetGroups((preset) =>
          this.deps.frames.add({ presetId: preset.id })
        ),
        this.customRow((width, height) =>
          this.deps.frames.add({ height, name: `${width} × ${height}`, width })
        ),
      ]
    );
  }

  /**
   * The selected frame's verbs, as a bar group.
   *
   * The same five the frame's own menu carries, hoisted somewhere you can see
   * them. That menu opens off a badge tooltipped "Change device size" and is
   * inert in edit mode, so Delete in particular was reachable only by knowing it
   * was there — while `+` has both a button and `F`. This is the other half of
   * that pair.
   *
   * The leading separator is a child of the group, not a sibling: `buildBar`'s
   * own rule is that a separator goes with the group it divides, and as a child
   * it hides with the group instead of leaving a hairline hanging off the Hand.
   *
   * On the glyphs — the imported set publishes no refresh and no copy, so two of
   * these are chosen rather than found:
   *
   * - `rotate-ccw` for Reload, because a circular arrow *is* the reload mark. It
   *   is also the Undo glyph — deliberately, and it is not a collision: Undo
   *   lives in `editOnlyBar` and this lives in `viewOnlyBar`, and `syncBar`
   *   guarantees the two are never on screen together.
   * - `doc-plus` for Duplicate: a frame is a document, and this makes one more.
   *
   * Delete was a third. It drew `minus`, on the argument that `−` is the literal
   * counterpart of the `+` three controls along — which is a real grammar, but
   * the wrong one: `+`/`−` over a *list* adds and removes a row, and this
   * destroys a frame. The same verb in the frame list drew `✕`, so one action
   * had two glyphs and neither said "destroy". The set now carries a `trash` of
   * our own; see ICONS.md for why it was drawn rather than found.
   */
  private buildFrameTools(): HTMLElement {
    return el(
      "div",
      {
        class: `${cls("fbar")} ${cls("fbar-frame")} ${cls("hidden")}`,
      },
      [
        el("div", { class: cls("fbar-sep") }),
        this.dimsBtn,
        this.barButton("rotation", "Rotate frame", (e) => {
          e.stopPropagation();
          this.rotateActiveFrame();
        }),
        this.barButton("rotate-ccw", "Reload frame", (e) => {
          e.stopPropagation();
          this.reloadActiveFrame();
        }),
        this.dupBtn,
        this.barButton("trash", "Delete frame", (e) => {
          e.stopPropagation();
          this.deleteActiveFrame();
        }),
        this.dimsMenu,
      ]
    );
  }

  /**
   * The device list again, but for *whichever* frame is selected.
   *
   * Built once in the constructor, and it outlives every selection there will
   * ever be, so its rows have to resolve the frame at click time rather than
   * closing over one. That is also why no `isCurrent` is passed to `presetGroups`: a mark
   * seeded at build time would be answering for a frame that has not been chosen
   * yet. `syncMenuState` is the only thing that may write it, and it runs on
   * every `syncMenus` — which is every open, and every pan while one is open.
   * The same goes for which accordion group is expanded, which is derived from
   * the selected frame's own device rather than latched at build time.
   *
   * One pane, not two. The frame's own menu needs a root pane because the verbs
   * and the sizes share one box; here the verbs are already the bar group, so
   * this box is only ever the list.
   */
  private buildDimsMenu(): HTMLElement {
    return el(
      "div",
      {
        class: `${cls("fc-menu")} ${cls("fbar-menu")} ${cls("scroll-y")} ${cls("hidden")}`,
        onClick: (e: Event) => e.stopPropagation(),
      },
      [
        el("div", { class: cls("fc-menu-head"), text: "Dimensions" }),
        ...this.presetGroups((preset) => {
          const frame = this.deps.frames.active;
          if (frame) {
            this.deps.frames.applyPreset(frame.id, preset.id);
          }
        }),
        this.customRow((width, height) => {
          const frame = this.deps.frames.active;
          if (frame) {
            this.deps.frames.resize(frame.id, width, height);
          }
        }, this.deps.frames.active ?? undefined),
      ]
    );
  }

  private barButton(
    name: IconName,
    label: string,
    onClick: (e: Event) => void
  ): HTMLElement {
    return el(
      "button",
      {
        "aria-label": label,
        class: cls("fbar-btn"),
        "data-tip": label,
        onClick,
        type: "button",
      },
      // `sm`, matching `.tool` in the bottom bar. These buttons are mounted
      // into that same bar, so an `md` glyph here put the canvas verbs a size
      // above the app's own tools sitting inches away.
      [icon(name, "sm")]
    );
  }

  // -- Positioning -----------------------------------------------------------

  private position(): void {
    for (const frame of this.deps.frames.all) {
      const box = this.boxes.get(frame.id);
      if (!box) {
        continue;
      }
      const r = frameScreenRect(frame.el);
      place(box, r);
      // The chrome box is not clipped to the canvas the way selection chrome is:
      // its own contents are what get clipped, by the layer, so a frame panned
      // half off-screen keeps a correctly-truncated title instead of vanishing.
      const name = box.querySelector(`.${cls("fc-name")}`);
      const size = box.querySelector(`.${cls("fc-size")}`);
      if (name) {
        name.textContent = frame.name;
      }
      if (size) {
        size.textContent = sizeLabel(frame);
      }
      box.classList.toggle(
        cls("fc-active"),
        this.deps.frames.active?.id === frame.id
      );
      const busy = this.move?.id === frame.id || this.resize?.id === frame.id;
      box.classList.toggle(cls("fc-busy"), busy);
    }
    this.zoomLabel.textContent = `${Math.round(this.deps.viewport.scale * 100)}%`;
    // Each frame is a whole app instance, so the count is capped. Say so on the
    // button instead of letting a click quietly do nothing.
    const full = this.deps.frames.all.length >= MAX_FRAMES;
    this.addBtn.classList.toggle(cls("fbar-off"), full);
    this.addBtn.setAttribute(
      "title",
      full ? `Frame limit reached (${MAX_FRAMES})` : "Add a frame"
    );
    this.syncFrameTools(full);
    // An open menu is anchored to something that moves with the canvas, so it
    // has to be re-placed on every pan and zoom or it drifts off its frame.
    if (this.menuFor) {
      this.syncMenus();
    }
  }

  /**
   * Show the frame group for the selected frame, and keep its readout true.
   *
   * Driven from `position` rather than from a subscription of its own, because
   * every path that can change the answer already ends here: `setActive` calls
   * `onChanged`, which is `CanvasStage.onFramesChanged` → `render` → `position`,
   * and so does every frame of a resize drag. That is what makes the dimensions
   * track a drag for free.
   *
   * Only the *selection* gate is ours. The mode gate is on the host this group
   * was mounted into, which `AirshipApp.syncBar` already hides in edit mode —
   * see `mountFrameTools`.
   */
  private syncFrameTools(full: boolean): void {
    const frame = this.deps.frames.active;
    this.frameTools.classList.toggle(cls("hidden"), frame === null);
    // Same treatment the `+` button gets, and for the same reason: a click that
    // quietly does nothing is worse than a control that says it cannot.
    this.dupBtn.classList.toggle(cls("fbar-off"), full);
    this.dupBtn.setAttribute(
      "title",
      full ? `Frame limit reached (${MAX_FRAMES})` : "Duplicate frame"
    );
    if (!frame) {
      // The menu is anchored to a group that is no longer on screen. Leaving it
      // open would strand it over the bar with nothing to act on.
      if (this.menuFor === DIMS_MENU) {
        this.closeMenu();
      }
      return;
    }
    // `sizeLabel`, not the bare numbers: a tooltip has room for the device name
    // that the bar itself does not, and naming it is most of why you would hover
    // a dimensions button in the first place.
    //
    // Tooltip only — the `aria-label` stays "Frame dimensions". This button's
    // name is what it *opens*, and folding the current value into it would both
    // rename a control every time a grip moved and make the screen reader
    // re-announce a whole device name mid-drag.
    this.dimsBtn.setAttribute("data-tip", sizeLabel(frame));
  }

  // -- Menus -----------------------------------------------------------------

  private toggleMenu(id: string): void {
    this.menuFor = this.menuFor === id ? null : id;
    // Re-seeded on every open, not just the first, so the list never presents
    // three shut headers and nothing to read.
    this.menuGroup = this.menuFor ? this.defaultGroup(this.menuFor) : null;
    this.armMenuKeys();
    this.syncMenus();
  }

  private closeMenu(): void {
    this.menuFor = null;
    this.menuGroup = null;
    this.armMenuKeys();
    this.syncMenus();
  }

  /**
   * The group a menu opens on: the one holding that frame's own device.
   *
   * The `+` menu has no frame, and `byId` answers null for its sentinel, so it
   * falls through to the first group with no special case — as does a frame at a
   * custom size, which belongs to no group. The bar's dimensions menu is for
   * whichever frame is selected, so it resolves that one.
   *
   * A size-based guess for the custom case (wide ⇒ Desktop) was considered and
   * dropped: width is not a taxonomy here. Android Medium is 700 × 840 in Phone
   * and Android Expanded is 1280 × 800 in Tablet, so the guess would be wrong in
   * both directions. Defaulting the `+` menu to Desktop because `shell-app`
   * happens to open with a desktop frame was dropped for a related reason — it
   * would make this menu's default depend on an unrelated choice in another file.
   */
  private defaultGroup(menuFor: string): string {
    const frame =
      menuFor === DIMS_MENU
        ? this.deps.frames.active
        : this.deps.frames.byId(menuFor);
    const preset = frame ? framePreset(frame) : null;
    return groupOfPreset(preset?.id ?? null)?.id ?? PRESET_GROUPS[0].id;
  }

  /**
   * Expand one device group, or collapse the open one.
   *
   * The setter does not place anything: `syncMenus` is what knows
   * where the box goes. A group opening or closing changes the menu's height,
   * and `placePopover` clears `maxHeight` and re-reads `scrollHeight` on every
   * call while a hidden body measures zero — so routing the toggle back through
   * the sync is the whole of what the re-anchor needs. No extra call site, no
   * rAF, no bookkeeping.
   */
  private setGroup(id: string): void {
    this.menuGroup = this.menuGroup === id ? null : id;
    this.syncMenus();
  }

  /**
   * Apply `menuGroup` to one menu's device groups.
   *
   * Separate from `syncMenuState`, which early-returns when the frame is gone
   * and whose contract is state derived from *the frame*. The accordion is
   * derived from the menu, and the `+` menu has no frame at all — so every menu
   * that carries a device list needs this, whether or not it has a frame behind
   * it.
   */
  private syncGroups(menu: HTMLElement): void {
    for (const group of menu.querySelectorAll<HTMLElement>(
      `.${cls("fc-dgroup")}`
    )) {
      const open = group.dataset.group === this.menuGroup;
      group
        .querySelector(`.${cls("fc-dgroup-head")}`)
        ?.setAttribute("aria-expanded", String(open));
      group
        .querySelector(`.${cls("fc-dgroup-body")}`)
        ?.classList.toggle(cls("hidden"), !open);
    }
  }

  /** Swap the open menu's pane. `syncMenus` is what knows where the box goes. */
  /**
   * Escape, for as long as a menu is up.
   *
   * Through the `keys` registry rather than a raw listener: `Keys.bind` unshifts,
   * so this shadows the picker's Escape-to-deselect for exactly the menu's
   * lifetime and stops shadowing it the moment the disposer runs — the same
   * arrangement `popover-host.ts` uses for its own popovers. This menu never got
   * that for free, because it is not one of that host's clients.
   *
   * The accordion adds no step of its own: a group is a filter on one list
   * rather than a level of navigation, so Escape from an expanded group closes
   * the menu rather than collapsing back to it.
   */
  private armMenuKeys(): void {
    this.unbindMenuKeys?.();
    this.unbindMenuKeys = null;
    if (!this.menuFor) {
      return;
    }
    // Unscoped, and `priority: "modal"` in the catalog rather than a `within`.
    // The menu is opened by a click, so focus is still on `document.body` and a
    // scoped binding would never match its own keystroke — while the menu is
    // up, Escape belongs to it, and saying so as a priority is the honest way
    // to outrank the picker's Deselect without depending on which constructor
    // ran first.
    this.unbindMenuKeys = keys.bind({
      id: "frameMenu.close",
      run: () => this.closeMenu(),
    });
  }

  private syncMenus(): void {
    const addOpen = this.menuFor === ADD_MENU;
    this.addMenu.classList.toggle(cls("hidden"), !addOpen);
    if (addOpen) {
      this.syncGroups(this.addMenu);
      // The toolbar is in the bottom bar, so the preset list opens upwards over
      // the canvas. `placeMenu` still flips and clamps if the window is short.
      placePopover(this.addMenu, this.toolbar.getBoundingClientRect(), "above");
    }
    // The bar's dimensions menu, on the same terms as the add menu — anchored to
    // a group that is fixed to the screen, so unlike the per-frame menu above it
    // does not move when the canvas is panned under it.
    const dimsOpen = this.menuFor === DIMS_MENU;
    const { active } = this.deps.frames;
    this.dimsMenu.classList.toggle(cls("hidden"), !dimsOpen);
    this.dimsBtn.setAttribute("aria-expanded", String(dimsOpen));
    if (dimsOpen && active) {
      this.syncGroups(this.dimsMenu);
      this.syncMenuState(active.id, this.dimsMenu);
      placePopover(
        this.dimsMenu,
        this.frameTools.getBoundingClientRect(),
        "above"
      );
    }
  }

  /**
   * Refresh the parts of an open menu that are derived from the frame rather
   * than fixed at build time: the `Dimensions` hint, and which preset is
   * current.
   *
   * `position()` already does exactly this for the `.fc-size` badge, and for the
   * same reason — `rebuild()` only runs when the *set* of frames changes, so a
   * menu built once keeps showing the size the frame used to be. That was
   * half-hidden before, because picking a device closed the menu; with a pane to
   * come back to, a stale checkmark is something you look straight at.
   *
   * Called only from the `open` branch, so a pan with nothing up costs nothing.
   */
  private syncMenuState(id: string, menu: HTMLElement): void {
    const frame = this.deps.frames.byId(id);
    if (!frame) {
      return;
    }
    const current = framePreset(frame);
    for (const row of menu.querySelectorAll<HTMLElement>("[data-preset]")) {
      row.classList.toggle(
        cls("fc-menu-on"),
        row.dataset.preset === current?.id
      );
    }
    // The custom fields are seeded at build time too, but a menu is built once
    // and the frame it describes changes under it — by a preset pick, a grip
    // drag, or simply by selecting a different frame. Without this the "start
    // from the current size" promise holds only until the first resize.
    //
    // Skipped while either field has focus: re-seeding under a cursor would
    // discard half-typed digits every time a sync ran, and syncs run on pans.
    const custom = menu.querySelector(`.${cls("fc-menu-custom")}`);
    if (!custom) {
      return;
    }
    const [w, h] = custom.querySelectorAll<HTMLInputElement>(
      `.${cls("fc-menu-num")}`
    );
    for (const [input, value] of [
      [w, frame.width],
      [h, frame.height],
    ] as const) {
      if (input && input !== document.activeElement) {
        input.value = String(Math.round(value));
      }
    }
  }

  /**
   * A press anywhere decides two things: whether an open menu should close, and
   * which frame is now selected.
   *
   * Selection is resolved by geometry rather than by the event target, for the
   * same reason canvas gestures are: what is under the pointer may be a capture
   * plane, a drag proxy or an iframe, none of which is the frame itself.
   */
  private readonly onDocumentPress = (e: Event): void => {
    const target = e.target as Element | null;
    if (
      this.menuFor &&
      !target?.closest?.(
        `.${cls("fc-menu")}, .${cls("fc-size")}, .${cls("fbar-btn")}`
      )
    ) {
      this.closeMenu();
    }

    const pointer = e as PointerEvent;
    if (typeof pointer.clientX !== "number") {
      return;
    }
    const point = { x: pointer.clientX, y: pointer.clientY };
    // Presses on the editor's own panels leave the selection alone; only the
    // canvas itself can change it — and in edit mode, not even then: a press
    // there is aimed at an element, and quietly moving the frame selection under
    // it is the sort of thing you only notice two actions later.
    if (
      this.editing ||
      target?.closest?.(`#${PREFIX}-root`) ||
      !this.deps.inCanvas(point)
    ) {
      return;
    }
    const onChrome = target?.closest?.(`.${cls("fc")}`);
    const frame = onChrome
      ? this.deps.frames.byId(onChrome.getAttribute("data-frame") ?? "")
      : this.deps.frames.frameAt(point);
    this.deps.frames.setActive(frame?.id ?? null);
  };

  /**
   * Rename in place, design-tool style: the title turns into a field where it sits.
   * Enter or blur commits, Escape reverts. Renaming a frame is a small enough
   * act that a modal would be louder than the change it makes.
   */
  private renameFrame(frame: Frame): void {
    const box = this.boxes.get(frame.id);
    const name = box?.querySelector(`.${cls("fc-name")}`);
    if (!(name instanceof HTMLElement)) {
      return;
    }
    const input = el("input", {
      class: cls("fc-rename"),
      spellcheck: "false",
      value: frame.name,
    }) as HTMLInputElement;
    name.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      const next = input.value.trim();
      input.replaceWith(name);
      if (commit && next && next !== frame.name) {
        this.deps.frames.rename(frame.id, next);
        this.deps.onChanged();
      }
      this.position();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  // -- Drag: move + resize ---------------------------------------------------

  private onDragStart(): void {
    // Belt and braces. In edit mode the label and the grips are `pointer-events:
    // none`, so neither draggable can be pressed — but dnd-kit's monitor is
    // global, and a guard that depends on a CSS rule staying exactly right is
    // one refactor from being no guard at all.
    if (this.editing) {
      return;
    }
    const { source } = manager.dragOperation;
    const id = String(source?.id ?? "");
    const { scale } = this.deps.viewport;

    if (source?.type === DND.frameMove) {
      const frame = this.deps.frames.byId(id.slice(DND.frameMove.length + 1));
      if (!frame) {
        return;
      }
      this.deps.frames.setActive(frame.id);
      this.move = { id: frame.id, scale, startX: frame.x, startY: frame.y };
      this.delta.start();
      return;
    }

    if (source?.type === DND.frameGrip) {
      const [, frameId, pos] = id.split(":").slice(1);
      const frame = this.deps.frames.byId(frameId);
      if (!(frame && GRIPS.includes(pos as GripPos))) {
        return;
      }
      this.deps.frames.setActive(frame.id);
      this.resize = {
        grip: pos as GripPos,
        id: frame.id,
        scale,
        startH: frame.height,
        startW: frame.width,
        startX: frame.x,
        startY: frame.y,
      };
      this.delta.start();
    }
  }

  private onDragMove(d: Coordinates): void {
    // The pointer travels in screen pixels; frames are laid out in world units.
    // At 50% zoom a 100px drag moves the frame 200 world units, so the frame
    // stays under the cursor.
    if (this.move) {
      const dx = d.x / this.move.scale;
      const dy = d.y / this.move.scale;
      this.deps.frames.move(
        this.move.id,
        this.move.startX + dx,
        this.move.startY + dy
      );
      return;
    }
    const rz = this.resize;
    if (!rz) {
      return;
    }
    const dx = d.x / rz.scale;
    const dy = d.y / rz.scale;
    let { startW: width, startH: height, startX: x, startY: y } = rz;
    // A west or north grip moves the frame's origin as well as its size, so the
    // opposite edge stays put — the same convention as the element grips.
    if (rz.grip.includes("e")) {
      width = rz.startW + dx;
    } else if (rz.grip.includes("w")) {
      width = rz.startW - dx;
      x = rz.startX + dx;
    }
    if (rz.grip.includes("s")) {
      height = rz.startH + dy;
    } else if (rz.grip.includes("n")) {
      height = rz.startH - dy;
      y = rz.startY + dy;
    }
    this.deps.frames.resize(rz.id, width, height);
    if (x !== rz.startX || y !== rz.startY) {
      this.deps.frames.move(rz.id, x, y);
    }
  }

  private onDragEnd(canceled: boolean): void {
    const { move, resize } = this;
    // Cleared *before* notifying: `onChanged` re-renders the chrome, and the
    // "busy" highlight is derived from these — leaving them set would light the
    // frame up permanently after a drop.
    this.move = null;
    this.resize = null;
    if (!(move || resize)) {
      return;
    }
    if (canceled && move) {
      this.deps.frames.move(move.id, move.startX, move.startY);
    }
    if (canceled && resize) {
      this.deps.frames.resize(resize.id, resize.startW, resize.startH);
      this.deps.frames.move(resize.id, resize.startX, resize.startY);
    }
    this.deps.onChanged();
  }
}

/** Keep a popover this far from the window edge. */

/** "iPhone 16 · 393 × 852", or just the numbers for a custom size. */
function sizeLabel(frame: Frame): string {
  const preset: DevicePreset | null = framePreset(frame);
  const dims = `${Math.round(frame.width)} × ${Math.round(frame.height)}`;
  return preset && preset.label !== frame.name
    ? `${preset.label} · ${dims}`
    : dims;
}
