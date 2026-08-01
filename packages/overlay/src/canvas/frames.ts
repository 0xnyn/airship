import { AIRSHIP_FRAME_NAME, AIRSHIP_MODE_PARAM } from "@airship/protocol";
import { cls, el } from "../dom";
import type { FrameAgent } from "../frame-agent";
import { frameScreenRect, type Point, type Rect } from "./space";

/**
 * Frames — the canvas's unit of content, in the design-tool sense of the word: a named,
 * explicitly-sized container that clips what is inside it.
 *
 * Ours holds a live copy of the user's app in a same-origin iframe. That choice
 * is the whole feature. Scaling the app with a CSS transform would have been far
 * less machinery, but a transform does not change what the app *believes* about
 * its viewport: `innerWidth` would stay the browser's, and every media query
 * would answer for the window rather than the device. An iframe at 375px is a
 * real 375px viewport, so `@media (max-width: 560px)` fires inside it and keeps
 * firing at 10% zoom, which is what makes two breakpoints visible side by side.
 *
 * The costs are honest and worth naming: each frame is a full app instance with
 * its own HMR socket and its own JS realm (see `../realm.ts`), and there is no
 * way to change a frame's user-agent or `devicePixelRatio` — so these are true
 * viewports, not device emulation.
 */

export interface DevicePreset {
  height: number;
  id: string;
  label: string;
  width: number;
}

export interface PresetGroup {
  id: string;
  label: string;
  presets: DevicePreset[];
}

/**
 * The device list, in buckets — sizes, not device emulation (see the note above).
 *
 * Groups are the source of truth and `PRESETS` is the flattening, not the other
 * way round. "Every preset is in exactly one bucket" is then true by
 * construction rather than by convention, and the group's order and the flat
 * lookup order stay one fact instead of two that can drift apart.
 *
 * Within a group the order is newest first — which makes it *not*
 * small → large, as this list used to be. That matters more than it looks,
 * because the order decides `matchPreset`'s fallback and four sizes here belong
 * to two devices each (402 × 874, 393 × 852, 430 × 932, 1440 × 1024). Newest
 * first means the un-preferred answer is the current name, which is the right
 * guess when there is nothing to prefer.
 */
export const PRESET_GROUPS: PresetGroup[] = [
  {
    id: "phone",
    label: "Phone",
    presets: [
      { height: 874, id: "iphone-17", label: "iPhone 17", width: 402 },
      {
        height: 874,
        id: "iphone-16-pro",
        label: "iPhone 16 & 17 Pro",
        width: 402,
      },
      { height: 852, id: "iphone-16", label: "iPhone 16", width: 393 },
      {
        height: 956,
        id: "iphone-16-pro-max",
        label: "iPhone 16 & 17 Pro Max",
        width: 440,
      },
      {
        height: 932,
        id: "iphone-16-plus",
        label: "iPhone 16 Plus",
        width: 430,
      },
      { height: 912, id: "iphone-air", label: "iPhone Air", width: 420 },
      {
        height: 932,
        id: "iphone-14-pro-max",
        label: "iPhone 14 & 15 Pro Max",
        width: 430,
      },
      {
        height: 852,
        id: "iphone-14-pro",
        label: "iPhone 14 & 15 Pro",
        width: 393,
      },
      { height: 844, id: "iphone-13", label: "iPhone 13 & 14", width: 390 },
      {
        height: 926,
        id: "iphone-14-plus",
        label: "iPhone 14 Plus",
        width: 428,
      },
      {
        height: 917,
        id: "android-compact",
        label: "Android Compact",
        width: 412,
      },
      {
        height: 840,
        id: "android-medium",
        label: "Android Medium",
        width: 700,
      },
    ],
  },
  {
    id: "tablet",
    label: "Tablet",
    presets: [
      { height: 1133, id: "ipad-mini", label: 'iPad mini 8.3"', width: 744 },
      { height: 1194, id: "ipad-pro-11", label: 'iPad Pro 11"', width: 834 },
      {
        height: 1366,
        id: "ipad-pro-12-9",
        label: 'iPad Pro 12.9"',
        width: 1024,
      },
      { height: 960, id: "surface-pro-8", label: "Surface Pro 8", width: 1440 },
      {
        height: 800,
        id: "android-expanded",
        label: "Android Expanded",
        width: 1280,
      },
    ],
  },
  {
    id: "desktop",
    label: "Desktop",
    presets: [
      { height: 832, id: "macbook-air", label: "MacBook Air", width: 1280 },
      {
        height: 982,
        id: "macbook-pro-14",
        label: 'MacBook Pro 14"',
        width: 1512,
      },
      {
        height: 1117,
        id: "macbook-pro-16",
        label: 'MacBook Pro 16"',
        width: 1728,
      },
      { height: 1024, id: "desktop", label: "Desktop", width: 1440 },
      { height: 1024, id: "wireframe", label: "Wireframes", width: 1440 },
      { height: 720, id: "tv", label: "TV", width: 1280 },
    ],
  },
];

/** Flat, in group order — the sequence `matchPreset` falls back through. */
export const PRESETS: DevicePreset[] = PRESET_GROUPS.flatMap((g) => g.presets);

export function presetById(id: string | null): DevicePreset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * The bucket a preset belongs to, for the group the device menu opens on.
 *
 * Group ids and preset ids share the string `"desktop"`. They are separate
 * namespaces — `data-group` against `data-preset`, this function against
 * `presetById` — and the collision is harmless, since `groupOfPreset("desktop")`
 * returns the group holding the `desktop` preset either way. Said out loud so
 * the next reader does not have to work out whether it matters.
 */
export function groupOfPreset(id: string | null): PresetGroup | null {
  return PRESET_GROUPS.find((g) => g.presets.some((p) => p.id === id)) ?? null;
}

/** A live frame reduced to the fields `build` can make one from. */
function snapshot(frame: Frame): StoredFrame {
  return {
    height: frame.height,
    id: frame.id,
    name: frame.name,
    presetId: frame.presetId,
    width: frame.width,
    x: frame.x,
    y: frame.y,
  };
}

/**
 * The preset matching a size in either orientation, for the frame's badge.
 *
 * `preferId` is the frame's own `presetId`, and it settles the ambiguity this
 * list creates: four sizes belong to two devices each, so a lookup by numbers
 * alone answers with whichever comes first and quietly relabels the device the
 * user just picked. That was the old behaviour — the frame recorded which device
 * it was and nothing ever read it back.
 *
 * The preference is honoured *only while the numbers still agree*, and that is
 * the whole safety property: an id is a preference, not a key. A preset can
 * change its dimensions or leave the list entirely, and a frame carrying the old
 * id simply stops matching and falls back to the numbers. That is what lets the
 * list be edited with no migration and no versioned storage, and why no frame
 * can ever claim to be a device it is not the size of.
 *
 * Either orientation still matches, which is what lets `rotate` keep the badge.
 */
export function matchPreset(
  width: number,
  height: number,
  preferId?: string | null
): DevicePreset | null {
  const fits = (p: DevicePreset): boolean =>
    (p.width === width && p.height === height) ||
    (p.height === width && p.width === height);
  const preferred = presetById(preferId ?? null);
  return (
    (preferred && fits(preferred) ? preferred : PRESETS.find(fits)) ?? null
  );
}

/** The device a frame is showing as — its own, when the numbers still agree. */
export function framePreset(
  frame: Pick<Frame, "height" | "presetId" | "width">
): DevicePreset | null {
  return matchPreset(frame.width, frame.height, frame.presetId);
}

export interface Frame {
  /** Resolved once the frame's agent has registered itself. */
  agent: FrameAgent | null;
  /** The frame's document, or null before it has loaded. */
  readonly doc: Document | null;
  /** The world-space wrapper. Its screen rect is the frame's screen rect. */
  readonly el: HTMLElement;
  height: number;
  readonly id: string;
  readonly iframe: HTMLIFrameElement;
  /** True once `src` has been set (frames mount lazily). */
  mounted: boolean;
  name: string;
  /** The transparent plane that receives pointer input in edit mode. */
  readonly plane: HTMLElement;
  presetId: string | null;
  width: number;
  /** The frame's window, or null before it has loaded. */
  readonly win: Window | null;
  x: number;
  y: number;
}

/**
 * A frame minus its live realm — everything `build` needs to make one.
 *
 * Two consumers, and that is not a coincidence: it is the same question asked by
 * `save`/`restore` (what survives a page reload?) and by `remove`/`restoreRemoved`
 * (what survives a delete?). Neither can carry the iframe, so neither carries
 * anything else that depends on it either.
 */
export interface StoredFrame {
  height: number;
  id: string;
  name: string;
  presetId: string | null;
  width: number;
  x: number;
  y: number;
}

/** Everything needed to put a removed frame back exactly where it was. */
export interface RemovedFrame {
  /**
   * Its index in `frames`, which is paint order — see `frameAt`. A restore
   * splices, it does not push.
   */
  index: number;
  stored: StoredFrame;
  /**
   * Was it the selected frame? A restore that does not re-select it does not
   * return you to the state you undid.
   */
  wasActive: boolean;
}

export interface FrameManagerDeps {
  /** Frames were added, removed, moved or resized. */
  onChanged?: () => void;
  /** A frame's agent registered (initial load, or an HMR full reload). */
  onFrameReady?: (frame: Frame) => void;
  /** App path every frame loads, carried through from the shell's own URL. */
  pathname: string;
  /** Storage key, so two projects on different ports keep separate layouts. */
  storageKey: string;
  /** The world element frames are appended to. */
  world: HTMLElement;
}

/** Gap between frames when auto-placing a new one. */
const FRAME_GAP = 80;

/**
 * Live frames are capped. Each is a full app instance — React tree, HMR socket,
 * timers, network — and the browser will happily let you make the canvas
 * unusable before it complains.
 */
export const MAX_FRAMES = 8;

/** How far outside the visible viewport a frame mounts, in screen px. */
const MOUNT_MARGIN = 400;

export class FrameManager {
  private readonly frames: Frame[] = [];
  private activeId: string | null = null;
  private seq = 1;
  /**
   * Edit/view mode. Defaults to edit, which is both where the editor starts and
   * what `.frame-plane`'s bare CSS already says — so a frame built before
   * `setEditing` has ever run agrees with its own stylesheet.
   */
  private editing = true;
  /** The frame that owns a live in-place text edit. See `setTextFrame`. */
  private textFrameId: string | null = null;

  private readonly deps: FrameManagerDeps;

  constructor(deps: FrameManagerDeps) {
    this.deps = deps;
    // Frames push their agent here rather than being polled. A frame's realm is
    // rebuilt on every HMR full reload, so any handle the shell cached would go
    // stale with no event to tell it — pushing makes re-registration automatic.
    //
    // Which frame is asking is settled by comparing the agent's own `window`
    // against each iframe's `contentWindow`: object identity, which survives
    // reloads and cannot be confused by a stale or missing name.
    (
      window as unknown as {
        __airshipOnFrameReady?: (agent: FrameAgent) => void;
      }
    ).__airshipOnFrameReady = (agent) => {
      const frame = this.frames.find((f) => f.win === agent.window);
      if (!frame) {
        return;
      }
      frame.agent = agent;
      this.deps.onFrameReady?.(frame);
    };
  }

  get all(): readonly Frame[] {
    return this.frames;
  }

  /**
   * The selected frame, or null.
   *
   * Deliberately no fallback to the first frame. When "active" was implicit,
   * some frame was always highlighted whether or not the user had chosen it,
   * which made the highlight meaningless — and led to it being toned down until
   * actually selecting a frame produced no visible change at all.
   */
  get active(): Frame | null {
    return this.activeId ? this.byId(this.activeId) : null;
  }

  setActive(id: string | null): void {
    if (id === this.activeId) {
      return;
    }
    this.activeId = id;
    // Selection is a visible state, so it has to re-render. Without this the
    // highlight only appeared once something *else* caused a render — which is
    // why a frame could seemingly only be selected by resizing it.
    this.deps.onChanged?.();
  }

  byId(id: string): Frame | null {
    return this.frames.find((f) => f.id === id) ?? null;
  }

  /** The frame owning a node, by walking up to its document. Cross-realm safe. */
  frameOf(node: Node | null): Frame | null {
    if (!node) {
      return null;
    }
    const doc = node.ownerDocument ?? (node as Document);
    return this.frames.find((f) => f.doc === doc) ?? null;
  }

  /** Topmost frame under a screen point — later frames paint over earlier ones. */
  frameAt(point: Point): Frame | null {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const f = this.frames[i];
      const r = frameScreenRect(f.el);
      if (
        point.x >= r.left &&
        point.x <= r.left + r.width &&
        point.y >= r.top &&
        point.y <= r.top + r.height
      ) {
        return f;
      }
    }
    return null;
  }

  /** World-space rects of every frame, for zoom-to-fit. */
  worldRects(): Rect[] {
    return this.frames.map((f) => ({
      height: f.height,
      left: f.x,
      top: f.y,
      width: f.width,
    }));
  }

  // -- Mutation --------------------------------------------------------------

  add(
    options: {
      height?: number;
      name?: string;
      presetId?: string | null;
      width?: number;
      x?: number;
      y?: number;
    } = {}
  ): Frame | null {
    if (this.frames.length >= MAX_FRAMES) {
      return null;
    }
    const preset = presetById(options.presetId ?? null);
    // The bare fallback names no device, and since `desktop` moved to
    // 1440 × 1024 that is now true rather than merely intended: a frame born
    // without a preset gets a null `presetId` and a plain-dimensions badge,
    // instead of silently claiming to be "Desktop" the way this coincidence
    // used to make it. Left at 900 for that reason — and because `biome.jsonc`
    // quotes this expression verbatim to justify a rule exemption.
    const width = options.width ?? preset?.width ?? 1440;
    const height = options.height ?? preset?.height ?? 900;
    const at = this.placeNext(options.x, options.y);
    const id = `f${this.seq}`;
    this.seq += 1;
    const frame = this.build({
      height,
      id,
      name: options.name ?? preset?.label ?? `Frame ${this.frames.length + 1}`,
      presetId: options.presetId ?? preset?.id ?? null,
      width,
      x: at.x,
      y: at.y,
    });
    this.frames.push(frame);
    // A newly added frame is not auto-selected: selection is something the user
    // does, and the highlight only means anything if it stays that way.
    this.deps.onChanged?.();
    return frame;
  }

  /**
   * Take a frame off the canvas, and hand back what it would take to undo that.
   *
   * The snapshot is the persisted shape plus two things `localStorage` never
   * needs: where in the array it sat, and whether it was selected. Returning it
   * rather than journalling it keeps this a model operation — the caller decides
   * whether the delete is one a user can take back (`FrameChrome.deleteFrame`)
   * or one nobody asked about, the way `destroy` does.
   */
  remove(id: string): RemovedFrame | null {
    const i = this.frames.findIndex((f) => f.id === id);
    if (i === -1) {
      return null;
    }
    const [frame] = this.frames.splice(i, 1);
    const removed: RemovedFrame = {
      index: i,
      stored: snapshot(frame),
      wasActive: this.activeId === id,
    };
    frame.el.remove();
    if (this.activeId === id) {
      this.activeId = null;
    }
    // Otherwise a frame added later could inherit the departed one's id and be
    // born live. The edit itself is torn down by the app's `pruneTextEdit`,
    // which notices the node has left the DOM.
    if (this.textFrameId === id) {
      this.textFrameId = null;
    }
    this.deps.onChanged?.();
    return removed;
  }

  /**
   * Put a removed frame back. Returns false if it cannot.
   *
   * What comes back is a *new* frame carrying the old geometry, name and id —
   * not the old one resumed. `build` makes a fresh iframe and the app inside it
   * boots from scratch, so route, scroll position and in-app state are gone.
   * Nothing in the DOM survives a `remove`, and keeping it would mean detaching
   * an iframe without destroying it, which no browser offers.
   *
   * Two refusals. The cap can have been reached in the meantime — delete one,
   * add two, then undo — and an id can already be back if a restore somehow runs
   * twice. `seq` is deliberately untouched: it only ever moves forward, so the
   * id riding in on the snapshot cannot collide with anything it will issue.
   */
  restoreRemoved(removed: RemovedFrame): boolean {
    if (this.frames.length >= MAX_FRAMES || this.byId(removed.stored.id)) {
      return false;
    }
    const frame = this.build(removed.stored);
    const at = Math.min(removed.index, this.frames.length);
    this.frames.splice(at, 0, frame);
    // `build` appended the wrapper, so without this the array says one thing
    // about paint order and the DOM says another. Frames are absolutely
    // positioned with no `z-index`, so the DOM has the last word on what paints
    // over what while `frameAt` reads the array — leave them disagreeing and a
    // restored frame that overlaps a neighbour is selected where it is not
    // visible.
    this.frames[at + 1]?.el.before(frame.el);
    if (removed.wasActive) {
      // The field, not `setActive`: the single `onChanged` below already covers
      // both the new frame and the new selection in one render.
      this.activeId = frame.id;
    }
    this.deps.onChanged?.();
    return true;
  }

  /**
   * Copy a frame, device and all. Carrying `presetId` across now preserves a
   * specific device rather than merely a size — before, the copy re-derived its
   * device from its dimensions and so could come back named after a different
   * one of the same shape.
   */
  duplicate(id: string): Frame | null {
    const src = this.byId(id);
    if (!src) {
      return null;
    }
    return this.add({
      height: src.height,
      name: `${src.name} copy`,
      presetId: src.presetId,
      width: src.width,
    });
  }

  move(id: string, x: number, y: number): void {
    const frame = this.byId(id);
    if (!frame) {
      return;
    }
    frame.x = Math.round(x);
    frame.y = Math.round(y);
    this.applyBox(frame);
    this.deps.onChanged?.();
  }

  resize(id: string, width: number, height: number): void {
    const frame = this.byId(id);
    if (!frame) {
      return;
    }
    frame.width = Math.max(120, Math.round(width));
    frame.height = Math.max(120, Math.round(height));
    // The preference is only given up when another device claims the size, not
    // whenever the size stops matching. Several devices share a size exactly, so
    // without this a drag off "iPhone 14 & 15 Pro" and back would re-badge it as
    // "iPhone 16" — and since `applyPreset` renamed the frame, the badge would
    // then be reading a different device than the title two rows above it. A
    // resize gesture calls this continuously, so "and back" is not a rare path:
    // every drag that returns to where it started goes through it.
    //
    // Keeping the id while the frame sits at a size no device has costs nothing,
    // because nothing trusts it: `framePreset` re-checks it against the numbers
    // on every read, so a dormant preference resolves to null and the badge
    // falls back to bare dimensions. It only wakes up if the frame comes home.
    frame.presetId = framePreset(frame)?.id ?? frame.presetId;
    this.applyBox(frame);
    this.deps.onChanged?.();
  }

  /**
   * Adopt a device wholesale, renaming the frame to match.
   *
   * The rename is what keeps two same-sized devices apart. "iPhone 17" and
   * "iPhone 16 & 17 Pro" are both 402 × 874, so the name is the only thing on
   * the canvas that distinguishes them — and it is also what keeps the size
   * badge short, since `sizeLabel` drops the device name once it would only
   * repeat the frame's own.
   */
  applyPreset(id: string, presetId: string): void {
    const preset = presetById(presetId);
    const frame = this.byId(id);
    if (!(preset && frame)) {
      return;
    }
    frame.width = preset.width;
    frame.height = preset.height;
    frame.presetId = preset.id;
    frame.name = preset.label;
    this.applyBox(frame);
    this.deps.onChanged?.();
  }

  /**
   * Swap width and height, keeping the device.
   *
   * `presetId` is deliberately left alone, and that is now load-bearing rather
   * than incidental. It used to not matter — `matchPreset` matched either
   * orientation, so the badge came back either way — but with several devices
   * sharing a size, dropping the id is what would make a rotated frame fall to
   * the first device of that shape. Leaving it is what keeps a rotated
   * "iPhone 14 & 15 Pro" from coming back as "iPhone 16".
   */
  rotate(id: string): void {
    const frame = this.byId(id);
    if (!frame) {
      return;
    }
    const { width, height } = frame;
    frame.width = height;
    frame.height = width;
    this.applyBox(frame);
    this.deps.onChanged?.();
  }

  rename(id: string, name: string): void {
    const frame = this.byId(id);
    if (!frame) {
      return;
    }
    frame.name = name;
    this.deps.onChanged?.();
  }

  /** Reload a frame from the server — the app's own state is discarded. */
  reload(frame: Frame): void {
    if (frame.mounted) {
      frame.iframe.contentWindow?.location.reload();
    }
  }

  // -- Edit / view mode ------------------------------------------------------

  /**
   * In edit mode the frames go inert and their capture planes take every
   * pointer event, so all input is handled in the shell's document and
   * hit-tested into the frame with `elementFromPoint`.
   *
   * This is what makes dnd-kit work at all here. Its `PointerSensor` binds
   * element-level listeners; a draggable that lived inside a frame would emit
   * its pointer events into *that* document, where the shell's manager — bound
   * to the shell's — would never see them. With the planes there is only ever
   * one document producing input.
   *
   * It also means the app cannot steal a click, focus an input or run a
   * mousedown handler while you are editing it, which the old inline overlay
   * needed a list of eight swallowed event types to approximate.
   *
   * **The mode is remembered, not just broadcast.** This used to be the only
   * thing that ever touched `plane.display` and `iframe.pointerEvents`, applied
   * by looping over the frames that happened to exist when it was called — so a
   * frame added *afterwards* was born with the plane's CSS default (`block`,
   * i.e. edit mode) no matter which mode the editor was actually in. Add a frame
   * in view mode and its plane covered it: clicks still selected the frame,
   * because the plane is in the shell's document and the press reached
   * `onDocumentPress`, so it looked selected and behaved correctly — but the
   * wheel hit the plane instead of the app, and the canvas panned instead of the
   * page scrolling. Every frame now takes the current mode at birth.
   */
  setEditing(on: boolean): void {
    this.editing = on;
    // An edit cannot outlive the mode that hosts it. `AirshipApp.setEditing`
    // commits before it gets here, so this is only ever tidying a field — but a
    // stale id would make the next `applyMode` leave a frame live.
    this.textFrameId = null;
    for (const frame of this.frames) {
      this.applyMode(frame);
    }
  }

  /**
   * Make one frame live for the duration of an in-place text edit.
   *
   * Everything the canvas does rests on frames being inert in edit mode — the
   * capture plane is what lets one dnd-kit manager see every gesture, and what
   * stops the app running a mousedown handler while its clicks are being stolen.
   * A caret is the one thing that cannot be synthesised from up here: placing it
   * is a *default action* of a press on the text, in the text's own realm. So
   * exactly one frame drops its plane, for exactly as long as an edit runs, and
   * the guarantee the plane was giving is re-established one realm down by
   * `FrameAgent.setTextGuard`.
   */
  setTextFrame(frame: Frame | null): void {
    const id = frame?.id ?? null;
    if (id === this.textFrameId) {
      return;
    }
    const prev = this.textFrameId ? this.byId(this.textFrameId) : null;
    this.textFrameId = id;
    if (prev) {
      this.applyMode(prev);
    }
    if (frame) {
      this.applyMode(frame);
    }
  }

  /**
   * Put one frame into the current mode. Called for every frame ever built —
   * which is what makes the text override survive a mode change and a new
   * frame's birth without either having to know about it.
   */
  private applyMode(frame: Frame): void {
    const inert = this.editing && frame.id !== this.textFrameId;
    frame.plane.style.display = inert ? "block" : "none";
    frame.iframe.style.pointerEvents = inert ? "none" : "auto";
  }

  // -- Lazy mounting ---------------------------------------------------------

  /**
   * Give `src` to frames that are on (or near) screen. Booting eight app
   * instances to render a canvas the user has scrolled away from is the kind of
   * cost that only shows up on someone else's laptop.
   */
  updateMounts(viewportRect: Rect): void {
    for (const frame of this.frames) {
      if (frame.mounted) {
        continue;
      }
      const r = frameScreenRect(frame.el);
      const visible =
        r.left < viewportRect.left + viewportRect.width + MOUNT_MARGIN &&
        r.left + r.width > viewportRect.left - MOUNT_MARGIN &&
        r.top < viewportRect.top + viewportRect.height + MOUNT_MARGIN &&
        r.top + r.height > viewportRect.top - MOUNT_MARGIN;
      if (visible) {
        this.mount(frame);
      }
    }
  }

  mount(frame: Frame): void {
    if (frame.mounted) {
      return;
    }
    frame.mounted = true;
    frame.iframe.src = this.frameSrc();
  }

  // -- Persistence -----------------------------------------------------------

  save(): void {
    const stored: StoredFrame[] = this.frames.map(snapshot);
    try {
      localStorage.setItem(
        this.deps.storageKey,
        JSON.stringify({ frames: stored, seq: this.seq })
      );
    } catch {
      // Private browsing or a full quota. A lost layout is not worth a crash.
    }
  }

  /**
   * Returns true if a saved layout was restored.
   *
   * A stored `presetId` naming a device that no longer exists is restored as-is
   * rather than pruned, and needs no migration: width and height are stored
   * alongside it and are what the frame is actually built from, and every read
   * of the id goes through `matchPreset`, which verifies it against those
   * numbers before honouring it. A stale id therefore degrades to "no device" —
   * a plain-dimensions badge — and never to a wrong one. Nulling unresolvable
   * ids here was considered and dropped: it would buy nothing, and an id can
   * become valid again if the list gains that device back.
   */
  restore(): boolean {
    let parsed: { frames?: StoredFrame[]; seq?: number } | null = null;
    try {
      const raw = localStorage.getItem(this.deps.storageKey);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const stored = parsed?.frames;
    if (!Array.isArray(stored) || stored.length === 0) {
      return false;
    }
    this.seq = typeof parsed?.seq === "number" ? parsed.seq : stored.length + 1;
    for (const s of stored.slice(0, MAX_FRAMES)) {
      const frame = this.build({
        height: s.height,
        id: s.id,
        name: s.name,
        presetId: s.presetId ?? null,
        width: s.width,
        x: s.x,
        y: s.y,
      });
      this.frames.push(frame);
    }
    return true;
  }

  destroy(): void {
    for (const frame of this.frames) {
      frame.el.remove();
    }
    this.frames.length = 0;
  }

  // -- Internals -------------------------------------------------------------

  private frameSrc(): string {
    const url = new URL(this.deps.pathname, window.location.origin);
    // Belt and braces alongside `window.name`: browsers that do not send
    // `Sec-Fetch-Dest` still need the proxy to serve the app here, not a shell.
    url.searchParams.set(AIRSHIP_MODE_PARAM, "frame");
    return url.pathname + url.search;
  }

  /** Place a new frame to the right of the rightmost one, top-aligned. */
  private placeNext(x?: number, y?: number): Point {
    if (x !== undefined && y !== undefined) {
      return { x, y };
    }
    if (this.frames.length === 0) {
      return { x: 0, y: 0 };
    }
    const right = Math.max(...this.frames.map((f) => f.x + f.width));
    const top = Math.min(...this.frames.map((f) => f.y));
    return { x: right + FRAME_GAP, y: top };
  }

  private build(init: StoredFrame): Frame {
    // Deliberately unsandboxed. A sandbox here would buy nothing — the frame is
    // same-origin by necessity (an opaque origin means `contentDocument` is
    // null, which ends picking, inspecting and source mapping), and
    // `allow-same-origin allow-scripts` together is escapable anyway. What it
    // would cost is fidelity: sandboxing quietly disables downloads, top-level
    // navigation and modals, so the app would stop behaving the way it does when
    // you load it directly, which is the one thing a frame has to get right.
    const iframe = el("iframe", {
      // Let the app ask for whatever it asks for at the top level today.
      allow: "clipboard-read; clipboard-write; fullscreen",
      class: cls("frame-doc"),
      // Set before the element is inserted, which is the only point at which it
      // reliably reaches the nested browsing context. It is not what the frame
      // boots from — the injected config decides that — but a named frame is
      // vastly easier to identify in devtools than four anonymous ones.
      name: `${AIRSHIP_FRAME_NAME}${init.id}`,
      title: init.name,
    }) as HTMLIFrameElement;

    const plane = el("div", { class: cls("frame-plane") });
    const wrapper = el("div", { class: cls("frame"), "data-frame": init.id }, [
      iframe,
      plane,
    ]);

    const frame: Frame = {
      agent: null,
      get doc(): Document | null {
        return iframe.contentDocument;
      },
      el: wrapper,
      height: init.height,
      id: init.id,
      iframe,
      mounted: false,
      name: init.name,
      plane,
      presetId: init.presetId,
      width: init.width,
      get win(): Window | null {
        return iframe.contentWindow;
      },
      x: init.x,
      y: init.y,
    };

    this.applyBox(frame);
    // Before it is in the document, so a frame added in view mode never gets a
    // frame of its capture plane covering it — see `setEditing`.
    this.applyMode(frame);
    this.deps.world.append(wrapper);
    return frame;
  }

  private applyBox(frame: Frame): void {
    Object.assign(frame.el.style, {
      height: `${frame.height}px`,
      left: `${frame.x}px`,
      top: `${frame.y}px`,
      width: `${frame.width}px`,
    });
    frame.iframe.title = frame.name;
  }
}
