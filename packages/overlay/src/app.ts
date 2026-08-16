import {
  type AgentKind,
  AIRSHIP_MODE_PARAM,
  AIRSHIP_SURFACE_COOKIE,
  type AirshipSurface,
  type AirshipWindowConfig,
  type CreateJobRequest,
  type Editor,
  type ElementContext,
  type ImageInput,
  type JobDiffBundle,
  type JobHistorySummary,
  type JobSnapshot,
  type ModelCatalogue,
  modeToSurface,
  type ServerEvent,
} from "@airship/protocol";
import { SEED_MODELS } from "@airship/protocol/models";
import { AttrSet } from "./attr-set";
import type { Point } from "./canvas/space";
import type { SafeInset } from "./canvas/viewport";
import { ChangeSet } from "./change-set";
import { buildEditRequest, hasVisualDeltas } from "./chat/build-request";
import {
  attachRailKeys,
  attachRailWheel,
  type ChangeChip,
  renderChangeChips,
  shortValue,
} from "./chat/change-chips";
import { openCommentPopover } from "./chat/comment-popover";
import { customModelRow, modelGroups, modelLabel } from "./chat/model-menu";
import { restoreModelPick, saveModelPick } from "./chat/model-store";
import { renderThreads } from "./chat/threads";
import {
  type AssistantActions,
  type AssistantTurn,
  assistantTurn,
  fillAssistant,
  setTurnStatus,
  userBubble,
} from "./chat/transcript";
import { ChromeLayer } from "./chrome-layer";
import { CommentSet } from "./comment-set";
import { selectedLineRange } from "./diff-view";
import {
  DND,
  DndScope,
  DragDelta,
  Draggable,
  FEEDBACK,
  manager,
} from "./dnd/manager";
import { basename, clear, cls, el, elementLabel, PREFIX } from "./dom";
import { emptyState } from "./empty";
import { History } from "./history";
import { createOpApplier } from "./history-ops";
import { type IconName, icon } from "./icons";
import { DesignPanel } from "./inspector/panel";
import { applyPreview, clearPreview } from "./inspector/style-model";
import { isEditableText, textTargetIn } from "./inspector/text-edit";
import { type CommandId, commandSpec } from "./keys/catalog";
import { openPalette } from "./keys/palette";
import { keys, tip } from "./keys/registry";
import { openShortcuts } from "./keys/shortcuts-panel";
import { MoveSet } from "./move-set";
import {
  type Hit,
  type Mods,
  type Selection,
  SelectionController,
  type SelectMode,
} from "./picker";
import {
  closeOpenPopover,
  createMenu,
  type MenuHandle,
  mountPopoverHost,
} from "./popover-host";
import { StructureSet } from "./structure-set";
import { injectStyles } from "./styles";
import { MIN_DOCK_W } from "./styles/const";
import { InlineResolver, type Surface, type SurfaceResolver } from "./surface";
import { mountToastHost, type ToastOptions, toast } from "./toast";
import { setRuntimeTokens, setStaticTokens } from "./tokens/registry";
import { TOOLS, type Tool, ToolController } from "./tools";
import { Tooltips } from "./tooltip";
import { AirshipSocket } from "./ws";

/**
 * How long a nudge burst stays open before it becomes one undo step.
 *
 * Longer than a key-repeat interval (~30ms once repeating) and shorter than a
 * deliberate pause between two separate nudges.
 */
const NUDGE_COALESCE_MS = 250;

/**
 * Which way each arrow moves a selection.
 *
 * Read off the event rather than baked into eight separate bindings, so Nudge
 * is one command in the catalog and one row in the shortcuts panel. `e.key` and
 * not `e.code`: the arrows are the same physical keys on every layout, and the
 * registry has already matched the chord by the time this runs.
 */
const NUDGE_AXIS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
};

/** Default floating-panel widths. Live widths are CSS vars on the overlay root. */
const LEFT_W = 340;
const RIGHT_W = 360;
/** Resize bounds: narrow enough to be useful, never more than half the viewport.
 *  `MIN_DOCK_W` lives in `styles/const.ts` — the stories need it too. */
const MAX_DOCK_W = 720;
const WIDTH_KEY = `${PREFIX}-dock-widths`;

/** Floor for a floating panel's height. Below this a panel is a title bar with
 *  a sliver under it, which is worse than not being resizable at all. */
const MIN_DOCK_H = 200;
/** Fallback header height. A collapsed dock is `display: none` and every metric
 *  inside it measures 0, so clamping one needs a number to fall back on. */
const HEAD_H = 40;
/** The dock's inset from the viewport edge — `--ap-space-md`, read at mount so
 *  the number is not written twice. This is only the first-paint fallback. */
const DOCK_INSET = 20;
const DOCKS_KEY = `${PREFIX}-dock-layout`;

/** How long the prompt preview waits for edits to settle before re-rendering.
 *  One keystroke is not a new prompt, and each request has the daemon resolve
 *  every pending delta against the project's files. */
const PREVIEW_DEBOUNCE_MS = 250;

type Side = "left" | "right";

/**
 * Pinned to its edge — full height, splitter live, counted in the canvas's safe
 * inset — or torn off and free-floating with its own position and height.
 */
type DockMode = "docked" | "floating";

/** Where a dock is. `x`/`y`/`h` are ignored while docked; the edge anchors in
 *  `docks.css.ts` drive it there. */
interface DockPlacement {
  h: number;
  mode: DockMode;
  x: number;
  y: number;
}

/**
 * The backends the picker offers, each with its own product mark.
 *
 * Spelled out here rather than imported from `@airship/protocol`: that module's
 * runtime exports pull zod in, and the overlay takes types from it only. A
 * short list is a cheap duplication.
 */
const AGENTS: { icon: IconName; kind: AgentKind; label: string }[] = [
  { icon: "claude", kind: "claude", label: "Claude" },
  { icon: "codex", kind: "codex", label: "Codex" },
  { icon: "opencode", kind: "opencode", label: "OpenCode" },
];

/**
 * The models the picker paints before the daemon has answered.
 *
 * Imported rather than restated, which is the opposite of what `AGENTS` above
 * does — and the difference is what the two lists are. Three backends is a
 * sentence; the model list is thirty-odd rows *generated* from models.dev, and
 * hand-copying generated output is how it goes stale in exactly the way the
 * generator exists to prevent. `@airship/protocol/models` is its own entry
 * point precisely so a value can be taken from it without zod coming too.
 */
const SEED_CATALOGUE: ModelCatalogue = AGENTS.map((a) => ({
  agent: a.kind,
  models: SEED_MODELS[a.kind],
}));

/**
 * The two stages, as the surface picker offers them.
 *
 * Same shape and same reasoning as `AGENTS` above: a list short enough that
 * spelling it out beats importing it, and one the picker can map straight into
 * menu items.
 */
const SURFACES: { icon: IconName; kind: AirshipSurface; label: string }[] = [
  { icon: "grid-view", kind: "canvas", label: "Canvas" },
  { icon: "layer-frame", kind: "inline", label: "Inline" },
];

/** Toolbar glyphs. Kept beside the bar rather than in `tools.ts` so the tool
 * model stays free of the icon set. */
const TOOL_ICON: Record<Tool, IconName> = {
  inspect: "tool-inspect",
  move: "tool-move",
};

/**
 * What the editor is pointed at, and where its chrome goes.
 *
 * There are two: the inline stage, where the app is the document the overlay is
 * injected into, and the canvas stage, where the app is a set of frames on a
 * pan/zoom surface. Everything above this line — chat, jobs, the change set, the
 * inspector, the socket — is identical in both, which is the reason for the
 * seam: it keeps the editor from growing two versions of itself.
 */
export interface Stage {
  /** Let the stage open its own add-frame affordance — the `F` shortcut. */
  addFrame?: () => void;
  /** Frames may need re-checking after an edit lands (HMR reloads them). */
  afterApply?: () => void;
  /**
   * Hand the stage a way to report a press that happened *inside* one of its
   * frames.
   *
   * Only meaningful on a stage whose content lives in another realm. The shell's
   * document-level listeners cannot see an event inside an iframe, so while a
   * frame is live for a text edit this is the only route a click-away has back —
   * without it, clicking from one string to another inside the same frame would
   * never commit the first.
   */
  bindFramePress?: (
    report: (at: Point, mods: Mods, dbl: boolean) => void
  ) => void;
  /** Hand the stage a live read of the selection — the canvas needs it for
   * zoom-to-selection, which cannot be answered from frame geometry alone. */
  bindSelection?: (get: () => Selection | null) => void;
  /**
   * Release everything the stage owns. Called from `AirshipApp.destroy`.
   *
   * Optional the way the rest of this interface is: `InlineStage` holds one
   * chrome layer and two window listeners it shares with the page, and has
   * nothing of its own to take down.
   */
  destroy?: () => void;
  /** True while a pan/zoom gesture is in flight; hover is suppressed then. */
  isGesturing?: () => boolean;
  /** Where outlines, handles and drop indicators are drawn. */
  readonly layer: ChromeLayer;
  /**
   * Attach to the page. Called before the overlay root is appended, so the
   * canvas paints beneath the docks rather than over them.
   *
   * `tools` is a slot in the bottom bar for whatever controls the stage owns —
   * on the canvas, add-frame, zoom-to-fit and the zoom readout. They used to be
   * a second floating toolbar of their own, pinned top-centre; there is one bar
   * now, and the stage fills its own section of it. A stage with no controls
   * ignores the slot and it collapses to nothing.
   */
  mount: (tools: HTMLElement) => void;
  /**
   * The left dock's **view-mode** body — on the canvas, the list of frames.
   *
   * A third slot rather than a second stage-owned dock, for the same reason the
   * two bar slots are slots: the app owns where panels go and how wide they
   * are, and the stage owns what is in them. A stage with nothing to list omits
   * this and the app never builds the alternate body, so the inline overlay's
   * dock is exactly what it was.
   */
  mountFramesPanel?: (host: HTMLElement) => void;
  /**
   * A second bar slot, for controls that act on the stage's *selected object*
   * rather than on the stage itself.
   *
   * Separate from `mount`'s `tools` because the two zones answer different
   * questions and are shown on different terms. `tools` carries add-frame, fit
   * and zoom — true whether or not anything is selected, and visible in both
   * modes. This one sits beside the Hand in the view-mode zone and is empty
   * until a frame is picked. Folding them into one slot would also put the
   * add-frame menu's anchor, which is that toolbar's own rect, under the control
   * of the selection.
   *
   * A slot, not a verb: no state crosses it, and the stage keeps sole ownership
   * of what goes in and when it shows. Optional, and the absence is the gate the
   * same way `addFrame` and `setHandTool` are — inline has no frames, so it
   * never fills this and its bar is unchanged.
   */
  mountFrameTools?: (host: HTMLElement) => void;
  /**
   * The bottom-right corner, for a stage that has somewhere to *be* — on the
   * canvas, the minimap.
   *
   * Gated by mode in `syncMinimap`, the way `mountFrameTools`' host is gated in
   * `syncBar`, and by its own visible flag from inside. One element per owner,
   * so neither can clobber the `hidden` the other wrote. Inline is the page
   * itself and has no world to map, so it omits this.
   */
  mountMinimap?: (host: HTMLElement) => void;
  /**
   * A pan/zoom gesture settled. The pointer has not moved but the canvas under
   * it has, so the app re-resolves what is being hovered — without this the
   * highlight stays on whatever was under the cursor before the gesture, which
   * is the trailing half of the ghost-outline bug.
   */
  onGestureEnd?: (cb: () => void) => void;
  /**
   * Register a callback for anything that can move a node under the chrome: a
   * pan, a zoom, a frame scroll, an HMR re-render. The app answers by re-drawing
   * the outline and re-pinning the drag proxy.
   */
  onLayoutChange: (cb: () => void) => void;
  /** Docks opened, closed or resized — the canvas re-checks what it can see. */
  relayout?: () => void;
  /** Resolves screen points and nodes to the surface they belong to. */
  readonly resolver: SurfaceResolver;
  /** Edit/view mode changed. */
  setEditing?: (on: boolean) => void;
  /**
   * Arm or disarm the Hand tool.
   *
   * Absent on a stage with no pan surface, and that absence is the gate: the
   * bar builds the Hand button and `bindEditorKeys` registers `H` only when
   * this is present, exactly the way `addFrame` gates the `+` shortcut. Inline
   * is the page itself, which the browser already scrolls, so there is nothing
   * for a Hand to move there.
   */
  setHandTool?: (on: boolean) => void;
  /**
   * How much of the stage the floating docks are covering. The canvas is
   * full-bleed, so this is what keeps zoom-to-fit aiming at the part of it you
   * can actually see. Inline has nothing floating over a canvas and skips it.
   */
  setSafeInset?: (inset: SafeInset) => void;
  /**
   * A node is being edited in place, or null on exit.
   *
   * The canvas answers by making that node's frame live for the duration —
   * `pointer-events: none` is precisely what makes a caret unplaceable, and
   * placing one is a *default action* of a press on the text in the text's own
   * realm, so it cannot be synthesised from up here. Inline shares one document
   * with the app and has nothing to lift, so it omits this.
   */
  setTextOwner?: (node: Element | null) => void;
  /** Whether the guard must intercept presses — see `EditGuardOptions`. */
  readonly swallowPresses: boolean;
}

/**
 * The inline stage: the overlay is injected straight into the running app and
 * edits the document it is part of. Retained as `?__airship=inline`, and useful
 * beyond debugging — it is the configuration the canvas has to stay honest
 * against, since both drive the same controllers through `Surface`.
 */
class InlineStage implements Stage {
  readonly layer = new ChromeLayer();
  readonly resolver: SurfaceResolver = new InlineResolver();
  readonly swallowPresses = true;

  /**
   * Held so `destroy` can take them off again.
   *
   * `onLayoutChange` returns nothing — the canvas keeps its subscribers in an
   * array it clears itself, so the interface never needed a disposer. Inline
   * subscribes to `window` instead, where nothing is cleared by anything, and
   * an overlay torn down without this left a scroll and a resize listener
   * calling `syncChrome` on a dead app for the life of the page.
   */
  private readonly listeners: (() => void)[] = [];

  /** No canvas, so no canvas controls — the bar's tool slot stays empty. */
  mount(): void {
    this.layer.mount(document.body);
  }

  onLayoutChange(cb: () => void): void {
    // The page scrolls under fixed chrome, so both matter.
    window.addEventListener("scroll", cb, true);
    window.addEventListener("resize", cb);
    this.listeners.push(() => {
      window.removeEventListener("scroll", cb, true);
      window.removeEventListener("resize", cb);
    });
  }

  destroy(): void {
    for (const off of this.listeners.splice(0)) {
      off();
    }
    this.layer.destroy();
  }
}

/**
 * Whether *this* bundle holds the page.
 *
 * Module-level, not on `window`, and that is the whole point. The two things
 * this has to tell apart are a second `boot()` from this same bundle — turn it
 * away — and a bundle the dev server swapped in wholesale, which must proceed
 * and take its predecessor down first. A module flag separates them for free: a
 * re-entrant call sees this scope, a replaced bundle gets a fresh one.
 *
 * It used to be `window.__airshipBooted`, which cannot make that distinction,
 * because it survives a bundle swap for exactly the same reason
 * `__airshipDestroy` does. The incoming bundle was turned away at the guard, one
 * line before the hook that guard existed to let it run — so no overlay was ever
 * torn down and `destroy()` was dead code in production.
 */
let booted = false;

/**
 * Take the page for this bundle, running whatever held it before.
 *
 * `false` means someone else in this same module already has it, and the caller
 * should do nothing at all — in particular it must not tear down the overlay it
 * just built.
 */
function claimBoot(): boolean {
  if (booted) {
    return false;
  }
  const w = window as unknown as { __airshipDestroy?: () => void };
  // Published by the *outgoing* bundle, so this runs in that bundle's scope and
  // releases that bundle's claim, not ours. Ours is set immediately after.
  w.__airshipDestroy?.();
  booted = true;
  return true;
}

/**
 * Publish a teardown hook on `window`, and release this bundle's claim when it
 * runs.
 *
 * A dev server that replaces the injected bundle wholesale leaves the old
 * overlay's capture-phase listeners on `document` with no reference left to
 * remove them by. A hook on `window` survives the swap, so the incoming bundle
 * can take the outgoing one down before it builds its own.
 *
 * The `booted = false` is here rather than in `AirshipApp.destroy` so that both
 * boot paths get it without either knowing about this module's state, and so
 * that a destroy which did *not* come through the published hook — a test
 * calling `app.destroy()` directly — leaves the flag alone.
 */
function publishDestroy(destroy: () => void): void {
  const w = window as unknown as { __airshipDestroy?: () => void };
  w.__airshipDestroy = () => {
    booted = false;
    destroy();
  };
}

export function boot(): void {
  if (!claimBoot()) {
    return;
  }
  injectStyles();
  const config = (window as unknown as { __AIRSHIP__?: AirshipWindowConfig })
    .__AIRSHIP__;
  // The whole config, not just `wsPath`: the surface switcher needs to know
  // which surface it is on and the clean app path to navigate back to, and an
  // injection old enough to carry neither still boots — it just falls back to
  // reading the current URL.
  const app = new AirshipApp(
    { ...config, mode: "inline", wsPath: config?.wsPath ?? "/__airship/ws" },
    new InlineStage()
  );
  app.mount();
  publishDestroy(() => app.destroy());
}

export { claimBoot, publishDestroy };

export class AirshipApp {
  private readonly socket: AirshipSocket;
  private readonly controller: SelectionController;
  private readonly commentSet = new CommentSet();
  private readonly changeSet = new ChangeSet();
  private readonly moveSet = new MoveSet();
  private readonly structureSet = new StructureSet();
  private readonly attrSet = new AttrSet();
  /** Documents already scanned for runtime tokens. Weak: a frame can unload. */
  private readonly scannedDocs = new WeakSet<Document>();
  private readonly history: History;
  private readonly panel: DesignPanel;

  private root!: HTMLElement;
  private bar!: HTMLElement;
  /** The bar's slot for stage-owned controls — filled by `stage.mount`. */
  private barTools!: HTMLElement;

  // Left (chat) dock
  private leftDock!: HTMLElement;
  private leftPill!: HTMLElement;
  private transcriptEl!: HTMLElement;
  private selChipsEl!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private chipsEl!: HTMLElement;
  private histEl!: HTMLElement;
  private sendBtn!: HTMLButtonElement;
  private newChatBtn!: HTMLElement;
  /** The bar's Apply/Discard pair; hidden while nothing is pending. */
  private applyGroup!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private discardBtn!: HTMLButtonElement;

  // Right (design) dock
  private rightDock!: HTMLElement;
  private rightPill!: HTMLElement;

  private leftOpen = false;
  /** High-water mark for `pendingCount()`; the composer reveals on an increase. */
  private pendingSeen = 0;
  private rightOpen = false;

  /** Live dock widths, persisted across reloads and reset from the splitters. */
  private readonly width: Record<Side, number> = {
    left: LEFT_W,
    right: RIGHT_W,
  };
  /** The dock a splitter drag is currently resizing, plus its start geometry.
   * `startX` matters only while floating — see `watchSplitters`. */
  private resizing: {
    side: Side;
    startW: number;
    startX: number;
  } | null = null;
  private readonly splitterDelta = new DragDelta();

  /** Where each dock is: pinned to its edge, or floating and where. */
  private readonly placement: Record<Side, DockPlacement> = {
    left: { h: 0, mode: "docked", x: 0, y: 0 },
    right: { h: 0, mode: "docked", x: 0, y: 0 },
  };
  /** The dock a header drag is currently moving, plus its state at grab time. */
  private moving: {
    side: Side;
    startPlacement: DockPlacement;
    startX: number;
    startY: number;
  } | null = null;
  private readonly moveDelta = new DragDelta();
  /** The two header rows, held so a *collapsed* dock's header can still be
   * measured — it is `display: none`, so it cannot be reached through the DOM
   * and read at the moment a clamp needs its height. */
  private readonly heads = {} as Record<Side, HTMLElement>;
  /** `--ap-space-md` in pixels, read once at mount. */
  private inset = DOCK_INSET;

  // Design-tool Edit/View mode: edit auto-selects on hover + click; view is a
  // clean pass-through. Land in edit (set in mount).
  private editing = false;
  private editBtn!: HTMLElement;
  private viewBtn!: HTMLElement;

  // The predicate is a lazy closure, so reading `this.editing` from a field
  // initializer is fine — it is not called until a key is pressed.
  private readonly tools = new ToolController(() => this.editing);
  private readonly toolButtons = new Map<Tool, HTMLElement>();
  /** Everything in the bar that is edit-mode furniture — hidden in view mode. */
  private editOnlyBar: HTMLElement[] = [];
  /** The mirror of `editOnlyBar`: view-mode furniture, hidden while editing.
   * Empty on a stage with no `setHandTool`, which is what keeps the inline
   * overlay's bar exactly as it was. */
  private viewOnlyBar: HTMLElement[] = [];
  /** The stage's slot in `viewOnlyBar` — see `Stage.mountFrameTools`. */
  private frameToolsHost: HTMLElement | null = null;
  /** View mode's one word about a running job — see `buildJobChip`. */
  private jobChip: HTMLElement | null = null;
  /**
   * The left dock's two heads and two bodies, swapped by mode.
   *
   * One dock element with two contents, rather than two docks. The splitter,
   * the drag handle, the pill and the four `--__airship-left-*` placement
   * properties are all keyed on the *side*, so a second element on the same
   * side would mean two dnd entities racing for one id and two pills fighting
   * over one corner — while the thing actually being asked for is that the
   * panel keep its width and position and change what is inside it.
   *
   * The frames pair is null on a stage that has no frames to list.
   */
  private chatHead!: HTMLElement;
  private chatBody!: HTMLElement;
  private framesHead: HTMLElement | null = null;
  private framesBody!: HTMLElement;
  /** The collapsed pill's label — it names whichever body the mode is showing. */
  private leftBrand!: HTMLElement;
  /** The bottom-right slot — see `Stage.mountMinimap`. */
  private minimapHost: HTMLElement | null = null;
  /**
   * The Hand tool's latch.
   *
   * Not a member of `ToolController`, deliberately. That is a radio group over
   * what a click means *while editing*, and the Hand is the other side of the
   * mode seam — in view mode there is no sibling tool for it to be exclusive
   * against, so joining the group would mean inventing a "no tool" member that
   * nothing else needs. See the note atop `tools.ts`.
   */
  private hand = false;
  private handBtn: HTMLElement | null = null;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private tooltips: Tooltips | null = null;

  private selected: Selection | null = null;
  private images: ImageInput[] = [];
  private activeJobId: string | null = null;
  private parentJobId: string | null = null;
  private activeThreadRoot: string | null = null;
  private historyOpen = false;
  private forkNext = false;

  /** Prompt-preview pane: the assembled instruction, as the agent will get it. */
  private previewEl!: HTMLElement;
  private previewBodyEl!: HTMLElement;
  private previewBtn!: HTMLButtonElement;
  private previewCountEl!: HTMLElement;
  private previewOpen = false;
  private previewText: string | null = null;
  private previewTimer: number | null = null;
  /**
   * The last request we asked the daemon to render, serialized.
   *
   * The dedupe that makes a live preview affordable: reopening the pane, a
   * selection change that leaves the payload alone, or a slider dragged back to
   * where it started would all otherwise spend a project walk to be handed back
   * the string already on screen.
   */
  private previewKey = "";
  /** The backend the next turn runs on. Seeded from the daemon's `--agent`,
   * then re-seeded from a thread's own agent when one is reopened, so a
   * follow-up stays on the backend that holds the conversation. */
  private agent: AgentKind = "claude";
  /**
   * The model each backend runs on, keyed by backend.
   *
   * Per harness rather than one string because the picker can move between
   * them mid-session: a single value would follow the switch and hand Codex a
   * `claude-opus-5`. An absent entry means "no model on the request", which
   * lets the daemon's own resolved default stand.
   */
  private models: Partial<Record<AgentKind, string>> = {};
  /** Live catalogue once the daemon answers; the generated seed until then. */
  private catalogue: ModelCatalogue = SEED_CATALOGUE;
  /** Whether this session has already asked. The menu asks on first open. */
  private modelsRequested = false;
  /** The open picker, so a late `models:result` can repaint it in place. */
  private agentMenu: MenuHandle | null = null;
  /** Whether a stored pick was found, which is what outranks `hello`. */
  private modelRestored = false;
  private agentBtn!: HTMLElement;
  private awaiting = false;
  private applyingVisual = false;
  /** Non-null while an arrow-key nudge burst is still coalescing. */
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTurn: AssistantTurn | null = null;
  /**
   * A text edit waiting on its node's selection to resolve. See
   * `enterTextEdit` — this is what keeps entry from racing `extract`.
   */
  private pendingTextEdit: { caret: Point | null; node: Element } | null = null;

  private readonly stage: Stage;
  /** Which surface this document is, for the bar's switcher. */
  private readonly surface: AirshipSurface;
  /**
   * The switcher: one button, whose glyph is the readout. No resting tip is
   * held beside it — `surface` is readonly, so the tip it reverts to when the
   * block lifts is always derivable rather than something to remember.
   */
  private surfaceBtn!: HTMLButtonElement;
  /**
   * The app path with `__airship` stripped, as the proxy resolved it. Used as
   * the navigation target when switching surface, so a document reached through
   * an explicit `?__airship=` override does not carry that override forward and
   * silently defeat the preference just written.
   */
  private readonly appPathname: string | undefined;
  /** The docks' dnd-kit entities — the two splitters, and the header and pill
   * of each panel. They live as long as the app does. */
  private readonly dockScope = new DndScope();
  /**
   * Everything this app subscribed to, released by `destroy()`.
   *
   * Listeners and key bindings used to be registered and their disposers
   * dropped on the floor, which is survivable only for as long as an overlay is
   * never torn down. `?__airship=inline` rebuilds one on every HMR cycle.
   */
  private readonly disposers: (() => void)[] = [];

  constructor(config: AirshipWindowConfig, stage: Stage) {
    this.stage = stage;
    this.surface = modeToSurface(config.mode ?? "inline");
    this.appPathname = config.pathname;
    this.socket = new AirshipSocket(config.wsPath);
    this.controller = new SelectionController(
      {
        onDeselect: () => this.clearSelectionScope(),
        onExtraChange: (nodes) => this.panel.setExtra(nodes),
        onResize: (node, size) => this.onResize(node, size),
        onResizeEnd: () => this.history.close(),
        onResizeStart: () => this.history.open(),
        onSelect: (sel) => this.onSelected(sel),
        onTextClickAway: (hit, at, mods) => this.onTextClickAway(hit, at, mods),
        onTextEnter: (hit, at) => this.onTextEnter(hit, at),
      },
      {
        isGesturing: () => stage.isGesturing?.() ?? false,
        layer: stage.layer,
        onContextMenu: (at) => this.openContextMenu(at),
        resolver: stage.resolver,
        swallowPresses: stage.swallowPresses,
      }
    );
    this.history = new History({
      apply: createOpApplier({
        attrSet: this.attrSet,
        changeSet: this.changeSet,
        moveSet: this.moveSet,
        preview: (node, property, value, tracked, important) => {
          if (!property) {
            return;
          }
          if (tracked) {
            applyPreview(node, property, value, important);
            return;
          }
          clearPreview(node, property);
          // Undoing a forced-state tweak can expose a still-pending default
          // tweak to the same property — put it back rather than leaving the
          // element showing the stylesheet's value.
          this.changeSet.reapplyPreviews(node);
        },
        structureSet: this.structureSet,
        syncControl: (property, value) =>
          this.panel.syncControl(property, value),
      }),
      onChange: () => this.syncUndoButtons(),
      refresh: () => {
        // An undo that touched a forced-state edit has moved the change set but
        // not the inline styles standing in for `:hover`; re-enter to reconcile
        // them before the panel re-seeds from what the DOM now says.
        this.panel.resyncState();
        this.controller.drawOutline();
        this.panel.refresh();
        this.onVisualChanged();
      },
    });
    this.panel = new DesignPanel({
      attrSet: this.attrSet,
      changeSet: this.changeSet,
      controller: this.controller,
      history: this.history,
      layer: stage.layer,
      moveSet: this.moveSet,
      onChanged: () => this.onVisualChanged(),
      onCopyPath: (file) => this.copyPath(file),
      onOpenIn: (editor, file, line) => this.openIn(editor, file, line),
      onTextOwner: (node) => stage.setTextOwner?.(node),
      resolver: stage.resolver,
      structureSet: this.structureSet,
    });
    this.tools.on((tool) => this.onToolChange(tool));
    this.bindEditorKeys();
  }

  /**
   * The editing shortcuts that need a selection.
   *
   * All guarded on `this.editing` as well as on having something selected: in
   * view mode the page belongs to the user, and Backspace there should delete
   * the character they are typing into the app, not the element behind it.
   *
   * The one delete shortcut that fires in *view* mode is `FrameChrome`'s frame
   * delete. It is not an exception to that rule but its mirror: frame selection
   * exists only in the mode element selection does not, so the two guards are
   * disjoint and exactly one of the pair can ever match. The reasoning, and why
   * it does not reach a key typed into a live frame, is written where it is
   * bound.
   */
  private bindEditorKeys(): void {
    const live = (): boolean => this.editing && this.selected !== null;
    // The disposer is kept now. It used to be dropped on the floor, so an
    // overlay rebuilt in the same page — which `?__airship=inline` does on
    // every HMR cycle — stacked a second full set of bindings on top of the
    // first, each closing over a dead panel.
    this.disposers.push(
      keys.bindAll([
        // Not gated on `canUndo` any more. An empty stack is a thing worth
        // reporting, and a binding that declines to match hands ⌘Z to the browser's
        // native undo on the page underneath — which can mangle a form the user
        // has open. In edit mode the page belongs to the editor, so it takes the
        // key either way. (`Keys` calls `preventDefault` on any binding that
        // matches, so this widening is what consumes the event.)
        {
          id: "history.undo",
          run: () => this.undoEdit(),
          when: () => this.editing,
        },
        {
          id: "history.redo",
          run: () => this.redoEdit(),
          when: () => this.editing,
        },
        {
          id: "element.delete",
          run: () => this.panel.removeSelection(),
          when: live,
        },
        {
          id: "element.duplicate",
          run: () => this.panel.duplicateSelection(),
          when: live,
        },
        // Both spellings of the same command, now that Text is no longer a tool
        // (see `tools.ts`). It toasts on refusal, which the `Enter` path used not
        // to: the old split — silent from `Enter`, loud from the `T` *tool* — was
        // justified by `T` being a tool whose light went out with nothing to show
        // for it. It is a command now, and a command that silently declines is
        // worse than one that says why. A tooltip shows the catalog's first
        // chord, so it still reads ↩.
        {
          id: "element.editText",
          run: () => this.editTextOrExplain(),
          when: live,
        },
        // F is the canvas `+` button's shortcut, not a tool. Deliberately outside
        // `live` — adding a frame needs no selection — and deliberately not gated
        // on `editing` either, because `+` itself stays visible in view mode and a
        // shortcut that disagrees with the button it stands for is worse than no
        // shortcut. Inline has no stage controls and `addFrame` is absent there,
        // which is what the guard checks.
        {
          id: "frame.add",
          run: () => this.stage.addFrame?.(),
          when: () => Boolean(this.stage.addFrame),
        },
        // H toggles the Hand. Gated the other way from the tools above: it is
        // view-mode furniture, so its `when` matches the button's visibility
        // exactly — a shortcut that works while its button is hidden is the same
        // disagreement `F` was fixed to avoid, read backwards. Unlike space-to-pan
        // this is a plain chord, so it belongs in the registry (see the note in
        // `viewport.ts` above the raw keydown/keyup pair).
        {
          id: "tool.hand",
          run: () => this.setHandTool(!this.hand),
          when: () => !this.editing && Boolean(this.stage.setHandTool),
        },
        // Escape drops the Hand, the way it drops every other latched thing in the
        // editor. It cannot collide with the picker's Escape: that one is bound
        // only while editing, and the Hand can only be armed while not.
        //
        // `dragActive` is the same guard the picker's Escape carries, and for the
        // same reason. A matched binding stops propagation, and dnd-kit's own
        // Escape-to-cancel listener sits downstream of this one — so without the
        // check, hitting Escape to abandon a dock drag would put the Hand down and
        // leave the panel wherever the pointer had dragged it to.
        {
          id: "tool.handDrop",
          run: () => this.setHandTool(false),
          when: () => this.hand && !this.controller.guard.dragActive,
        },
        // Nudge. One device pixel by default, ten with shift — the same pair
        // every editor uses, and both go through `translate` so they compose with
        // the Position fields rather than fighting them.
        //
        // Two bindings rather than eight. One command answers to all four
        // arrows and reads its axis off the event, which is what lets the
        // shortcuts panel show a single "← → ↑ ↓" row instead of four that say
        // the same thing.
        {
          id: "element.nudge",
          run: (e) => {
            const [dx, dy] = NUDGE_AXIS[e.key] ?? [0, 0];
            this.nudgeStep(dx, dy);
          },
          when: live,
        },
        {
          id: "element.nudgeBig",
          run: (e) => {
            const [dx, dy] = NUDGE_AXIS[e.key] ?? [0, 0];
            this.nudgeStep(dx * 10, dy * 10);
          },
          when: live,
        },
        // The two discovery surfaces. Ungated: they document both modes and
        // both surfaces, and a help sheet you can only reach from the mode you
        // already understand is the wrong way round.
        { id: "help.shortcuts", run: () => openShortcuts() },
        { id: "help.palette", run: () => openPalette() },
      ])
    );
  }

  /**
   * One nudge, coalesced into a single undo step per burst.
   *
   * `nudge` opened no gesture bracket, so holding an arrow key journalled an op per
   * key repeat — about sixty for two seconds — and ⌘Z then walked the element back a
   * pixel at a time. The bracket closes on a short idle rather than on keyup, because
   * the key registry reports repeats as fresh `run` calls and never reports the release.
   *
   * `num-field.ts`'s `beginStep`/`endStep` solves the same problem for its own arrow
   * stepping, and this is the same shape.
   */
  private nudgeStep(dx: number, dy: number): void {
    if (this.nudgeTimer === null) {
      this.history.open();
    } else {
      clearTimeout(this.nudgeTimer);
    }
    this.panel.nudge(dx, dy);
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      this.history.close();
    }, NUDGE_COALESCE_MS);
  }

  /**
   * Undo one direct-manipulation step, and say so.
   *
   * Shared by ⌘Z and the bar's Undo button so the receipt does not depend on
   * which one you reached for. Note the name: `undo(jobId)` further down is a
   * different feature entirely — it asks the *server* to revert the agent's file
   * edits and reports through the `undo:result` socket event. The two must never
   * be wired together.
   *
   * Why this toasts at all, when the edit is right there on screen: often it is
   * not. Undoing a 1px nudge, or a colour on an element you have since scrolled
   * past, changes nothing you can see, and nothing else in the UI confirms it.
   */
  private undoEdit(): void {
    // Neutral tone on both branches — an empty stack is a state, not an error.
    toast(this.history.undo() ? "Undo" : "Nothing to undo", {
      icon: "rotate-ccw",
    });
  }

  private redoEdit(): void {
    toast(this.history.redo() ? "Redo" : "Nothing to redo", {
      icon: "rotate-ccw",
    });
  }

  mount(): void {
    this.stage.bindSelection?.(() => this.selected);
    this.root = el("div", { id: `${PREFIX}-root` });
    this.restoreWidths();
    this.restoreDocks();
    // Before the docks are built: `buildAgentButton` paints the tooltip from
    // this state, and a restore afterwards would leave the first frame showing
    // a backend the composer is not actually on.
    this.modelRestored = this.restoreModel();
    this.buildBar();
    this.buildLeftDock();
    this.buildRightDock();
    // The stage goes into the body *before* the root, so the canvas paints
    // beneath the docks; the chrome layer it owns is a sibling of the root, not
    // a child, because chrome has to be clippable to the canvas independently of
    // the panels — and because being earlier in the body is what lets the panels
    // paint over it. Building the bar first is what gives the stage somewhere to
    // put its own controls — both slots of it.
    if (this.frameToolsHost) {
      this.stage.mountFrameTools?.(this.frameToolsHost);
    }
    if (this.stage.mountMinimap) {
      // Built only when there is something to put in it, the same way the frame
      // tools host is — an empty fixed-position box in the corner is invisible
      // but is still a node the pointer has to be reasoned about against.
      this.minimapHost = el("div", { class: cls("minimap-host") });
      this.root.append(this.minimapHost);
      this.stage.mountMinimap(this.minimapHost);
    }
    this.stage.mount(this.barTools);
    // Inline fills nothing in, and the bar collapses to just the mode toggle.
    this.bar.classList.toggle(
      cls("bar-bare"),
      this.barTools.childElementCount === 0
    );
    document.body.append(this.root);
    // Only readable once the root is in the document — the token vars are scoped
    // to it (see `styles/index.ts`), so this resolves to nothing before that.
    this.inset = readPx(this.root, "--ap-space-md", DOCK_INSET);
    // A store written on a bigger window can hold a placement that is off this
    // one, so the restored values are clamped before they are ever painted.
    this.clampPlacements();
    this.applyWidths();
    this.watchSplitters();
    this.watchDockDrag();
    window.addEventListener("resize", this.onViewportResize);
    this.stage.onLayoutChange(() => {
      // One `isConnected` read per coalesced tick, and it covers every way a
      // node can vanish out from under a live edit: a frame reload, a frame
      // removal, a React unmount.
      this.panel.pruneTextEdit();
      this.syncChrome();
    });
    this.stage.bindFramePress?.((at, mods, dbl) =>
      this.routeFramePress(at, mods, dbl)
    );
    this.stage.onGestureEnd?.(() => this.controller.repick());
    // Both inside the root and above every dock by declared `z-index` — see
    // `Z_TOAST` and `Z_POP`. The toast goes first so the popover host stays the
    // root's last child, which is hygiene rather than the mechanism.
    mountToastHost(this.root);
    const popHost = mountPopoverHost(this.root);
    // The tooltip lives here too, and not on the chrome layer where it started.
    // That layer is a body sibling with the same `z-index` as the root and is
    // appended *first*, so the docks paint over it — which is deliberate for
    // selection outlines and fatal for a tooltip, because it made every tooltip
    // in the design panel render behind an opaque panel.
    this.tooltips?.destroy();
    this.tooltips = new Tooltips(popHost);
    // Land in edit mode: hover-to-auto-select is live from the start.
    this.setEditing(true);
    this.socket.on((ev) => this.onEvent(ev));
    this.socket.connect();
  }

  /**
   * The right-click menu on the selection.
   *
   * Every row carries a `command`, so its chord is rendered from the registry
   * and it appears in the generated reference for free — the menu cannot end up
   * advertising a key that runs something else, which is exactly what the
   * transcript's hand-written `⌘Z` was doing.
   *
   * Anchored to a one-pixel element parked at the pointer. `openPopover` places
   * against an element's rect and watches that element for removal, so a point
   * needs a stand-in with a real box; it is removed when the menu closes.
   */
  private openContextMenu(at: Point): void {
    const spot = el("div", { class: cls("point-anchor") });
    spot.style.left = `${at.x}px`;
    spot.style.top = `${at.y}px`;
    this.root.append(spot);

    const menu = createMenu([
      {
        command: "element.editText",
        icon: "layer-text",
        label: "Edit text",
        run: () => this.editTextOrExplain(),
      },
      {
        command: "element.duplicate",
        icon: "plus",
        label: "Duplicate",
        run: () => this.panel.duplicateSelection(),
      },
      {
        command: "element.delete",
        icon: "minus",
        label: "Delete",
        run: () => this.panel.removeSelection(),
      },
      { separator: true },
      // Absent rather than disabled on the inline surface, where there is no
      // canvas to zoom — the same rule `tools.ts` states for the missing pen.
      ...(this.stage.setHandTool
        ? [
            {
              command: "view.zoomToSelection" as const,
              label: "Zoom to selection",
              run: () => keys.run("view.zoomToSelection"),
            },
          ]
        : []),
      {
        icon: "code",
        label: "Copy selector",
        run: () => this.copySelector(),
      },
    ]);
    menu.open(spot, "below", { onClose: () => spot.remove() });
  }

  /** The selected element's CSS selector, on the clipboard. */
  private copySelector(): void {
    const node = this.selected?.node;
    if (!node) {
      return;
    }
    // `elementLabel` and not a full unique path: what people paste this into is
    // a message to the agent or a CSS file, and `div.card.is-open` is the part
    // that names the thing. A generated `:nth-child` chain is precise and
    // useless in both places.
    const selector = elementLabel(node);
    navigator.clipboard?.writeText(selector).then(
      () => toast(`Copied ${selector}`),
      () => toast("Could not reach the clipboard", { tone: "error" })
    );
  }

  /**
   * Take the overlay back down.
   *
   * There was no teardown at all, which is survivable only for as long as an
   * overlay is never rebuilt — and `?__airship=inline` rebuilds one on every
   * HMR cycle. What was left behind each time was a full second set of
   * capture-phase key bindings, every one of them `preventDefault`-ing for a
   * `when()` that closed over a dead panel; `ToolController.destroy` had never
   * been called at all; and `Keys.destroy`, whose docstring describes exactly
   * this leak, had no caller anywhere in the tree.
   *
   * `keys.destroy()` goes last on purpose: the disposers above unbind their own
   * commands one at a time, and this is the sweep that catches anything bound
   * by a subsystem that forgot to hand its disposer over.
   */
  destroy(): void {
    for (const off of this.disposers.splice(0)) {
      off();
    }
    // Both debounces, before anything they would call is torn down. The preview
    // one is the one that bites: its callback reaches `socket.send`, so a
    // destroy inside the debounce window would fire a request at a socket that
    // is about to close, and hold the whole app graph alive until it did.
    this.clearPreviewTimer();
    if (this.nudgeTimer !== null) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.tools.destroy();
    this.controller.destroy();
    this.panel.destroy();
    // The socket's reconnect loop is self-sustaining — `onclose` schedules the
    // next attempt — so without this an overlay rebuilt in the same page leaves
    // a live socket behind on every cycle, each still delivering events to a
    // dead app's listeners.
    this.socket.destroy();
    this.tooltips?.destroy();
    this.tooltips = null;
    closeOpenPopover("programmatic");
    this.stage.destroy?.();
    window.removeEventListener("resize", this.onViewportResize);
    this.dockScope.clear();
    this.root?.remove();
    keys.destroy();
  }

  /**
   * Re-anchor everything drawn in screen space over a node that may have moved.
   * The outline and the reorder drag proxy must move together — an outline that
   * tracks while its hit area does not is worse than neither.
   *
   * The hover chrome is in the same position and was for a long time missing
   * from here, which is what left a ghost highlight behind after every canvas
   * pan: hover is only ever recomputed from a `mousemove`, and a wheel pan does
   * not produce one. `syncHover` re-hit-tests instead of re-measuring, because
   * panning changes which element is under the cursor.
   */
  private syncChrome(): void {
    this.controller.drawOutline();
    this.controller.syncHover();
    this.panel.syncChrome();
  }

  // -- Dock resizing ---------------------------------------------------------

  /**
   * A splitter on the dock's inner edge. dnd-kit drives the gesture so it picks
   * up the same activation threshold and Escape-to-cancel as every other drag;
   * double-clicking snaps the dock back to its default width.
   */
  private buildSplitter(side: Side): HTMLElement {
    const handle = el("div", {
      class: `${cls("splitter")} ${cls(`splitter-${side}`)}`,
      "data-tip": "Drag to resize, double-click to reset",
      onDblclick: () => this.resetWidth(side),
    });
    this.dockScope.add(
      new Draggable(
        {
          element: handle,
          id: `${DND.splitter}:${side}`,
          // The splitter itself must not travel — the dock width is the output.
          // Only the x component is read, which is the horizontal-axis lock.
          plugins: FEEDBACK.none,
          type: DND.splitter,
        },
        manager
      )
    );
    return handle;
  }

  private watchSplitters(): void {
    // Captured, like every other monitor listener in the repo. `manager` is a
    // module singleton, so `dockScope.clear()` in `destroy` takes the draggable
    // *entities* out but leaves these handlers on it — and a drag on the next
    // overlay would then also run this one, against a dead app.
    this.disposers.push(
      manager.monitor.addEventListener("dragstart", () => {
        const id = String(manager.dragOperation.source?.id ?? "");
        if (!id.startsWith(DND.splitter)) {
          return;
        }
        const side: Side = id.endsWith("left") ? "left" : "right";
        this.resizing = {
          side,
          startW: this.width[side],
          startX: this.placement[side].x,
        };
        this.splitterDelta.start();
        this.controller.guard.setDragging(true, "col-resize");
      }),
      manager.monitor.addEventListener("dragmove", (e) => {
        const rz = this.resizing;
        if (!rz) {
          return;
        }
        // The left dock grows rightwards, the right dock grows leftwards.
        const dx =
          this.splitterDelta.update(e).x * (rz.side === "left" ? 1 : -1);
        this.width[rz.side] = clampWidth(rz.startW + dx);
        this.trackFloatingResize(rz);
        this.applyWidths();
      }),
      manager.monitor.addEventListener("dragend", (e) => {
        const rz = this.resizing;
        if (!rz) {
          return;
        }
        if (e.canceled) {
          this.width[rz.side] = rz.startW;
          this.placement[rz.side].x = rz.startX;
          this.applyWidths();
        }
        this.resizing = null;
        this.controller.guard.setDragging(false);
        this.saveWidths();
        this.saveDocks();
        this.autoGrow();
        // The outline lives in viewport coords; realign after the layout settles.
        requestAnimationFrame(() => this.controller.drawOutline());
      })
    );
  }

  /**
   * Keep a *floating* right dock's grip under the pointer while it resizes.
   *
   * The right dock's splitter sits on its left edge, so the right edge is what
   * should stay put. Docked, `right` is the anchor and that happens for free.
   * Floating, the anchor is `left` — so growing the panel leftwards would extend
   * it rightwards instead, and the grip would slide away from the cursor. Moving
   * the origin by the width the panel *actually* gained (rather than by the raw
   * pointer delta) is what makes it stop exactly where `clampWidth` does.
   *
   * The left dock needs none of this: its splitter is on its right edge, and it
   * is anchored by `left` in both states.
   */
  private trackFloatingResize(rz: {
    side: Side;
    startW: number;
    startX: number;
  }): void {
    const p = this.placement[rz.side];
    if (rz.side !== "right" || p.mode !== "floating") {
      return;
    }
    const right = rz.startX + rz.startW;
    p.x = this.clampFloat("right", right - this.width.right, p.y).x;
  }

  // -- Dock dragging ---------------------------------------------------------

  /**
   * Make a node a grab handle for its panel.
   *
   * `element`, never dnd-kit's `handle` option — and that is not a style
   * preference. Its `preventActivation` default declines to start a drag when
   * the press lands on an interactive element, which is what leaves every button
   * in the header clickable; but the check it runs first is
   * `handle.contains(target)`, so naming the header as a handle would return
   * early and turn its collapse button and agent picker into drag origins.
   * `frame-chrome.ts` arms `.fc-label` the same way, for the same reason.
   */
  private armDockDrag(side: Side, node: HTMLElement, part: string): void {
    this.dockScope.add(
      new Draggable(
        {
          element: node,
          id: `${DND.dockMove}:${side}:${part}`,
          // The panel travels by its own CSS vars; letting dnd-kit translate it
          // too would double every pixel of the drag.
          plugins: FEEDBACK.none,
          type: DND.dockMove,
        },
        manager
      )
    );
    node.addEventListener("dblclick", () => this.redock(side));
  }

  /**
   * Tear a panel off its edge, carry it, and put it down.
   *
   * The tear-off happens on `dragstart` rather than on the first move, measured
   * from the panel's live rect — so it detaches exactly where it already was
   * instead of jumping to wherever the anchors would have put it.
   */
  private watchDockDrag(): void {
    this.disposers.push(
      manager.monitor.addEventListener("dragstart", () => {
        const { source } = manager.dragOperation;
        if (source?.type !== DND.dockMove) {
          return;
        }
        const side: Side = String(source.id).includes(":left")
          ? "left"
          : "right";
        const open = this.isOpen(side);
        const rect = (
          open ? this.dockEl(side) : this.pillEl(side)
        ).getBoundingClientRect();
        const from = { ...this.placement[side] };
        this.moving = {
          side,
          startPlacement: from,
          startX: rect.left,
          startY: rect.top,
        };
        this.moveDelta.start();
        this.controller.guard.setDragging(true, "grabbing");
        this.dockEl(side).classList.add(cls("dock-moving"));
        this.pillEl(side).classList.add(cls("dock-moving"));
        this.placement[side] = {
          h: floatHeight(from, open, rect.height, this.inset),
          mode: "floating",
          x: rect.left,
          y: rect.top,
        };
        // Once, here — not per move. The panel has stopped being a wall, and the
        // canvas has to hear that; but `applyWidths` reaches `stage.relayout`,
        // which re-clips the chrome layer, re-checks frame mounts and re-renders
        // every frame's furniture. That is a drag's worth of work per pointer
        // frame if it runs in `dragmove`, to publish a number that does not change
        // again until the drop.
        this.applyWidths();
      }),
      manager.monitor.addEventListener("dragmove", (e) => {
        const mv = this.moving;
        if (!mv) {
          return;
        }
        const d = this.moveDelta.update(e);
        const p = this.placement[mv.side];
        const { x, y } = this.clampFloat(
          mv.side,
          mv.startX + d.x,
          mv.startY + d.y
        );
        p.x = x;
        p.y = y;
        this.applyPlacement(mv.side);
      }),
      manager.monitor.addEventListener("dragend", (e) => {
        const mv = this.moving;
        // Cleared before anything downstream runs: `afterDockToggle` re-renders,
        // and a handler that reads a stale `moving` would think a drag is still in
        // flight. Same order, and the same reason, as `FrameChrome.onDragEnd`.
        this.moving = null;
        if (!mv) {
          return;
        }
        this.dockEl(mv.side).classList.remove(cls("dock-moving"));
        this.pillEl(mv.side).classList.remove(cls("dock-moving"));
        this.controller.guard.setDragging(false);
        if (e.canceled) {
          this.placement[mv.side] = { ...mv.startPlacement };
        }
        this.applyPlacement(mv.side);
        this.saveDocks();
        // `applyWidths` → `autoGrow` → realign chrome. The composer's max height
        // is derived from the left dock's own height, which a tear-off changes.
        this.afterDockToggle();
      })
    );
  }

  private resetWidth(side: Side): void {
    this.width[side] = side === "left" ? LEFT_W : RIGHT_W;
    this.applyWidths();
    this.saveWidths();
    this.autoGrow();
    requestAnimationFrame(() => this.controller.drawOutline());
  }

  /**
   * Publish the live dock widths, and tell the stage what they are covering.
   *
   * The widths go on `documentElement` rather than the overlay root only
   * because that is one place both the root's own rules and any future sibling
   * can read them from.
   *
   * The stage gets the same numbers a second way, as a *safe inset*. Docks used
   * to physically inset the canvas, which kept frames out from under them for
   * free but meant every toggle resized the surface and shifted everything on
   * it. They float over a full-bleed canvas now — the design-tool arrangement — so
   * nothing moves when a panel opens, and this inset is the only thing left
   * telling zoom-to-fit which part of the canvas is actually visible.
   *
   * Only a panel that is *docked* counts toward it. A docked panel is a wall
   * running the height of the window and a fit has to respect it; a floating one
   * is a card the user has just put somewhere and can move again with one drag,
   * and permanently shrinking the fit target against it would leave the canvas
   * quietly narrower than the window for as long as the panel is out. So the
   * inset is now specifically about *edge-anchored* panels, not open ones.
   */
  private applyWidths(): void {
    const root = document.documentElement;
    for (const side of ["left", "right"] as const) {
      root.style.setProperty(
        `--${PREFIX}-${side}-w`,
        `${clampWidth(this.width[side])}px`
      );
      this.applyPlacement(side);
    }
    // The gutter is the breathing room between a dock's inner edge and the
    // nearest frame a fit is allowed to place there.
    const gutter = 8;
    // `isVisible`, not the raw open flag: in view mode the inspector is gated
    // away, and reserving 360px for a panel that is not on screen would leave
    // every fit and every centring quietly off-centre to the left.
    const covers = (side: Side): number =>
      this.isVisible(side) && this.placement[side].mode === "docked"
        ? clampWidth(this.width[side]) + gutter
        : 0;
    this.stage.setSafeInset?.({
      left: covers("left"),
      right: covers("right"),
    });
    this.stage.relayout?.();
  }

  private restoreWidths(): void {
    try {
      const raw = localStorage.getItem(WIDTH_KEY);
      const saved = raw
        ? (JSON.parse(raw) as Partial<Record<Side, number>>)
        : null;
      if (saved?.left) {
        this.width.left = clampWidth(saved.left);
      }
      if (saved?.right) {
        this.width.right = clampWidth(saved.right);
      }
    } catch {
      // A malformed or blocked store just means the defaults stand.
    }
  }

  private saveWidths(): void {
    try {
      localStorage.setItem(WIDTH_KEY, JSON.stringify(this.width));
    } catch {
      // Private mode / quota — resizing still works for this session.
    }
  }

  // -- Dock placement --------------------------------------------------------

  private dockEl(side: Side): HTMLElement {
    return side === "left" ? this.leftDock : this.rightDock;
  }

  private pillEl(side: Side): HTMLElement {
    return side === "left" ? this.leftPill : this.rightPill;
  }

  private isOpen(side: Side): boolean {
    return side === "left" ? this.leftOpen : this.rightOpen;
  }

  /**
   * Publish one side's placement.
   *
   * Four custom properties and two classes, and the dock and its collapsed pill
   * both read them — which is what keeps the invariant the docked arrangement
   * already had: the pill sits exactly where the header was, so collapsing a
   * panel drops the body away rather than moving anything. The vars go on
   * `documentElement` beside the widths, for the same reason they do.
   *
   * `x` and `r` are the same edge expressed from either side, and both are
   * published because a *pill* is narrower than the panel it stands for, so the
   * edge it should keep is not the edge the panel is positioned from. The left
   * pill anchors on `x`; the right pill anchors on `r`, or collapsing a 360px
   * panel into a ~110px pill would hold the left edge and drag the right one
   * inwards — the panel would appear to collapse leftwards, away from the edge
   * it lives on. `trackFloatingResize` compensates for the same asymmetry in the
   * resize gesture, and for the same reason.
   *
   * Height is clamped **here and not in the state**. A panel torn off its edge
   * starts at full height, so carrying it downwards would run its foot off the
   * bottom of the window; but clamping the stored number would make that a
   * one-way trip, shrinking the panel a little on every downward drag and never
   * giving it back when you carry it up again. So `h` keeps what the user asked
   * for and only what is *painted* is fitted to the room below `y`.
   */
  private applyPlacement(side: Side): void {
    const p = this.placement[side];
    const floating = p.mode === "floating";
    const room = Math.max(MIN_DOCK_H, window.innerHeight - p.y - this.inset);
    const root = document.documentElement;
    root.style.setProperty(`--${PREFIX}-${side}-x`, `${Math.round(p.x)}px`);
    root.style.setProperty(`--${PREFIX}-${side}-y`, `${Math.round(p.y)}px`);
    // The width the panel is actually painted at — `--*-w` is clamped too, so
    // an unclamped number here would put the two edges out of step.
    root.style.setProperty(
      `--${PREFIX}-${side}-r`,
      `${Math.round(window.innerWidth - p.x - clampWidth(this.width[side]))}px`
    );
    root.style.setProperty(
      `--${PREFIX}-${side}-h`,
      `${Math.round(Math.min(p.h, room))}px`
    );
    this.dockEl(side).classList.toggle(cls("dock-float"), floating);
    this.pillEl(side).classList.toggle(cls("pill-float"), floating);
  }

  /**
   * Put a panel back on its edge.
   *
   * The counterpart to tearing it off, and the only way back — there is
   * deliberately no snap zone. A drop that silently re-docks because the pointer
   * strayed near an edge is a gesture that has to be *avoided* while dragging,
   * and it costs a ghost element, a live hit-test and a drop-resolution branch
   * to build something whose main effect is to surprise you. Double-click is the
   * same idiom the splitter already teaches one control over (`buildSplitter`).
   */
  private redock(side: Side): void {
    if (this.placement[side].mode === "docked") {
      return;
    }
    this.placement[side].mode = "docked";
    this.applyPlacement(side);
    this.saveDocks();
    this.afterDockToggle();
  }

  /**
   * Keep a floating panel reachable: the whole width on screen horizontally, at
   * least the header row vertically — the header is what you grab, so it is the
   * part that must never go under an edge.
   */
  private clampFloat(
    side: Side,
    x: number,
    y: number
  ): { x: number; y: number } {
    const w = this.isOpen(side)
      ? clampWidth(this.width[side])
      : this.pillEl(side).offsetWidth || MIN_DOCK_W;
    // `offsetHeight` reads 0 on a collapsed dock — it is `display: none` — which
    // is why the header is held in `this.heads` and why there is a floor.
    const headH = Math.max(this.heads[side]?.offsetHeight ?? 0, HEAD_H);
    return {
      x: clamp(x, 0, Math.max(0, window.innerWidth - w)),
      y: clamp(y, 0, Math.max(0, window.innerHeight - headH)),
    };
  }

  /** Re-clamp both floating placements against the current window. */
  private clampPlacements(): void {
    for (const side of ["left", "right"] as const) {
      const p = this.placement[side];
      if (p.mode !== "floating") {
        continue;
      }
      // Height is deliberately not touched here. `applyPlacement` already fits
      // what it paints to the room below `y`, so clamping the stored number
      // would only make a shrunk window permanent — the panel would come back
      // short after the window grew again, having lost the height the user
      // actually chose.
      const { x, y } = this.clampFloat(side, p.x, p.y);
      p.x = x;
      p.y = y;
      this.applyPlacement(side);
    }
  }

  /**
   * Everything the window size constrains, re-derived.
   *
   * `clampWidth` caps a dock at half the window but was only ever applied when a
   * width was *written*, so a panel sized on a wide monitor stayed that width on
   * a narrow one until you next touched the splitter. Floating placements have
   * the same exposure and no splitter to fix them by hand, so both are handled
   * here. Bound as a field so the listener can be removed by identity.
   */
  private readonly onViewportResize = (): void => {
    for (const side of ["left", "right"] as const) {
      this.width[side] = clampWidth(this.width[side]);
    }
    this.clampPlacements();
    this.applyWidths();
    this.autoGrow();
    this.saveDocks();
    this.saveWidths();
  };

  /**
   * Placement gets its own store key rather than joining `WIDTH_KEY`.
   *
   * Not only because the payload shape differs — `restoreWidths` would read an
   * object where it expects a number — but because of write cadence. `saveWidths`
   * fires from the splitter's drop and from `resetWidth`, whose entire job is to
   * put a width back; folding placement into the same blob would put the float
   * state one careless `JSON.stringify(this.width)` away from being erased by a
   * double-click on a splitter. Two keys make that impossible, and an existing
   * install keeps its widths across the upgrade with no migration to write.
   */
  private restoreDocks(): void {
    try {
      const raw = localStorage.getItem(DOCKS_KEY);
      const saved = raw
        ? (JSON.parse(raw) as Partial<Record<Side, Partial<DockPlacement>>>)
        : null;
      for (const side of ["left", "right"] as const) {
        const s = saved?.[side];
        // Anything that is not exactly "floating" is docked, so a truncated or
        // hand-edited store degrades to the default arrangement rather than to a
        // panel floating at NaN.
        if (s?.mode !== "floating") {
          continue;
        }
        this.placement[side] = {
          h: clampHeight(Number(s.h) || 0),
          mode: "floating",
          x: Number(s.x) || 0,
          y: Number(s.y) || 0,
        };
      }
    } catch {
      // A malformed or blocked store just means the defaults stand.
    }
  }

  private saveDocks(): void {
    try {
      localStorage.setItem(DOCKS_KEY, JSON.stringify(this.placement));
    } catch {
      // Private mode / quota — moving panels still works for this session.
    }
  }

  // -- Shell -----------------------------------------------------------------

  /**
   * The one bar, in five zones:
   *
   *     [ ↺ ↻ ] │ [ Move Text ] │ [ Inspect ] │ [ Edit ⇄ View ] │ {stage tools}
   *
   * Tools and mode are deliberately both present. Edit/View answers "is the page
   * underneath interactive at all"; the tools answer "what does a click do while
   * you are editing". Collapsing them into one control would mean either losing
   * view mode or pretending Inspect and View are the same thing, and they are
   * not — you can inspect while the page is inert.
   *
   * The first three zones are edit-mode furniture and are hidden in view mode
   * (see `syncBar`), which leaves the bar carrying only the two things that are
   * true in both: which mode you are in, and where you are looking. Undo, the
   * tools and Inspect all act on a selection that view mode does not have, so
   * showing them there was offering controls that could not do anything.
   *
   * View mode has its own furniture in that same slot:
   *
   *     [ ✋ ] [ 1440 × 900 ↻ ⟳ ⧉ − ] │ [ Edit ⇄ View ] │ {stage tools}
   *
   * The Hand, and the selected frame's verbs. The Hand sits where the tools sit
   * because it answers the same question they do — what does a press do — and
   * putting it anywhere else would say the two are different kinds of control.
   * The zone is therefore never empty and never doubled: whichever mode you are
   * in, the bar reads *what a press does*, then *which mode*, then *where you
   * are looking*.
   *
   * The frame group shares that zone for the same kind of reason. The Hand
   * answers "what does a press do"; the group answers "what can you do to the
   * thing you picked" — the same question one step on, and it is empty until
   * there is something to ask it about. It is the stage's, filled through
   * `mountFrameTools`; the bar owns only the slot and hides it by mode.
   *
   * The brand and the panel toggles used to live here too; they are in the
   * corner pills now, beside the panels they belong to.
   *
   * The separators are held rather than built anonymously because they have to
   * go with the group they divide — a hairline stub hanging off the mode toggle
   * is worse than either.
   */
  private buildBar(): void {
    this.barTools = el("div", { class: cls("bar-tools") });
    const undoGroup = this.buildUndoGroup();
    const toolGroup = this.buildToolGroup(["move"]);
    const inspectGroup = this.buildToolGroup(["inspect"]);
    const sep = (): HTMLElement => el("div", { class: cls("bar-sep") });
    // Built once and spread into the bar, so the list that gets hidden and the
    // list that gets rendered cannot drift apart. The trailing separator is in
    // it too: it divides Inspect from the mode toggle, and left standing in view
    // mode it would be a hairline leading the bar with nothing in front of it.
    this.editOnlyBar = [
      undoGroup,
      sep(),
      toolGroup,
      sep(),
      inspectGroup,
      sep(),
      // Lands immediately before the surface toggle on purpose: that toggle is
      // blocked by exactly this pending state, so the remedy sits beside the
      // control it unblocks. Two nested `display: contents` wrappers, one per
      // owner — the outer is mode-hidden by `syncBar`, the inner is
      // pending-hidden by `syncApplyGroup` — so neither can clobber the
      // `hidden` the other wrote (same pattern as the frame-tools slot).
      el("div", { class: cls("bar-apply-host") }, [this.buildApplyGroup()]),
    ];
    // Same bargain as `editOnlyBar`, in the opposite direction — and empty
    // rather than disabled when the stage has no pan surface, so the inline
    // overlay's bar is unchanged rather than carrying a Hand that cannot move
    // anything.
    //
    // The frame slot goes in the same list, so `syncBar` hides it by mode with
    // no code of its own. It is an empty wrapper on purpose: two things gate the
    // group inside it and they are owned by different objects — the mode, which
    // is the bar's business, and the selection, which only the stage can see. One
    // element per owner means neither has to know the other exists, and neither
    // can clobber the `hidden` the other wrote. See `Stage.mountFrameTools`.
    this.frameToolsHost = this.stage.mountFrameTools
      ? el("div", { class: cls("bar-frame-tools") })
      : null;
    this.viewOnlyBar = this.stage.setHandTool
      ? [
          this.buildHandGroup(),
          ...(this.frameToolsHost ? [this.frameToolsHost] : []),
          this.buildJobChip(),
          sep(),
        ]
      : [];
    // The surface switcher goes beside the edit toggle, in front of it: they are
    // the two questions that apply on both stages, and "which surface" is the
    // outer of the two. Both sit outside `editOnlyBar`/`viewOnlyBar`, so neither
    // is hidden by the mode.
    this.bar = el("div", { class: cls("bar") }, [
      ...this.editOnlyBar,
      ...this.viewOnlyBar,
      // Outside both mode lists on purpose: the shortcuts sheet documents both
      this.buildSurfaceToggle(),
      el("div", { class: cls("bar-sep") }),
      this.buildEditToggle(),
      el("div", { class: `${cls("bar-sep")} ${cls("bar-sep-tools")}` }),
      this.barTools,
      // The two help surfaces, last, and that placement is arithmetic rather
      // than taste. The bar is `left: 50%` with a `-50%` translate, so it is the
      // *bar* that is centred and any control's offset from the middle is
      // (what precedes it − what follows it) / 2. Everything here used to
      // precede the mode toggle and almost nothing followed it, which pushed
      // Edit/View — the one control you aim at without looking — well right of
      // centre, with a pair of glyphs sitting in the middle instead. Moving the
      // pair to the tail moves the toggle back by half their width.
      //
      // Outside both mode lists on purpose: the shortcuts sheet documents both
      // modes, and a help button that disappears in the mode you are stuck in is
      // the one place it is least useful.
      //
      // Its own separator rather than reusing `bar-sep-tools`, which the inline
      // overlay hides along with the stage slot it divides. Inline that slot is
      // empty, so a shared separator would leave the pair welded to the mode
      // toggle; this one is always the divider between them.
      el("div", { class: cls("bar-sep") }),
      // The palette had no pointer affordance at all, so the one surface that
      // lists every command the editor can run was reachable only by already
      // knowing ⌘K.
      this.iconButton(
        "command",
        "Command palette",
        () => openPalette(),
        "help.palette"
      ),
      // `question`, not `keyboard`: the sheet's own chord is `?`, and the glyph
      // that names it should be the one you press. It also stops reading as
      // "keyboard settings" beside a `command` mark that is already a key.
      this.iconButton(
        "question",
        "Keyboard shortcuts",
        () => openShortcuts(),
        "help.shortcuts"
      ),
    ]);
    this.root.append(this.bar);
    this.syncSurfaceToggle();
    this.syncUndoButtons();
    // The bar is built before `mount` lands in edit mode, so seed it from the
    // flag rather than leaving the DOM disagreeing with the state it reflects.
    this.syncBar();
  }

  /**
   * Apply and Discard, as bar buttons — the save affordance the reporter went
   * looking for. Apply is a second entry point onto `submit()`, not a new
   * mechanism: `buildEditRequest` already accepts an empty prompt when visual
   * deltas exist, and `turnLabel` already synthesizes "Applied 3 style
   * changes". Discard is the same unjournalled bulk clear the composer offers,
   * so it goes through the same confirm.
   */
  private buildApplyGroup(): HTMLElement {
    this.applyBtn = el(
      "button",
      {
        "aria-label": "Apply pending changes",
        class: cls("tool"),
        "data-tip": "Apply",
        onClick: () => this.submit(),
        type: "button",
      },
      [icon("check", "sm")]
    ) as HTMLButtonElement;
    this.discardBtn = el(
      "button",
      {
        "aria-label": "Discard pending changes",
        class: cls("tool"),
        "data-tip": "Discard",
        onClick: () =>
          this.confirmPending(
            this.discardBtn,
            (n) => `Discard all ${n} pending change${n === 1 ? "" : "s"}`,
            () => this.panel.discard(),
            "above"
          ),
        type: "button",
      },
      [icon("close", "sm")]
    ) as HTMLButtonElement;
    this.applyGroup = el(
      "div",
      { class: `${cls("bar-apply-group")} ${cls("hidden")}` },
      [
        el("div", { class: cls("tool-group") }, [
          this.applyBtn,
          this.discardBtn,
        ]),
        el("div", { class: cls("bar-sep") }),
      ]
    );
    return this.applyGroup;
  }

  /**
   * Show the pair only while something is pending, keep the tooltips counting,
   * and disable Apply during a live job — `submit()` silently no-ops on
   * `awaiting`, and a control that eats clicks without a word is the exact
   * shape of complaint this group exists to answer.
   */
  private syncApplyGroup(): void {
    if (!this.applyGroup) {
      return;
    }
    const pending = this.pendingCount();
    this.applyGroup.classList.toggle(cls("hidden"), pending === 0);
    if (pending === 0) {
      return;
    }
    const s = pending === 1 ? "" : "s";
    this.applyBtn.dataset.tip = `Apply ${pending} change${s}`;
    this.discardBtn.dataset.tip = `Discard ${pending} pending change${s}`;
    this.applyBtn.disabled = this.awaiting;
  }

  /**
   * Undo and redo, as buttons.
   *
   * ⌘Z has always worked; nothing on screen said so, and nothing reported
   * whether there was anything left to undo. Both call the same
   * `undoEdit`/`redoEdit` wrappers the keys do, so the receipt does not depend
   * on which one you reached for.
   *
   * `data-tip` is the binding *label*, not prose: `Tooltips` looks a shortcut up
   * by matching tooltip text against the registered bindings, and `bindEditorKeys`
   * already labels these "Undo" and "Redo" — so the buttons carry "Undo ⌘Z" for
   * free without either side knowing about the other.
   *
   * The glyph: the icon set publishes `rotate-ccw` and no clockwise twin, so
   * redo is the same mark mirrored in CSS (`.bar-redo`). Cheaper and more honest
   * than hand-authoring a near-copy into `icons.ts`'s `LEGACY` block.
   */
  private buildUndoGroup(): HTMLElement {
    const make = (
      label: string,
      command: CommandId,
      extra: string,
      run: () => void
    ): HTMLButtonElement =>
      el(
        "button",
        {
          "aria-label": label,
          class: `${cls("tool")} ${cls(extra)}`,
          // `tip`, not a bare `data-tip`: the chip is resolved from `data-key`
          // now, so a control that names only its copy renders without one.
          ...tip(label, command),
          onClick: run,
          type: "button",
        },
        [icon("rotate-ccw", "sm")]
      ) as HTMLButtonElement;
    this.undoBtn = make("Undo", "history.undo", "bar-undo", () =>
      this.undoEdit()
    );
    this.redoBtn = make("Redo", "history.redo", "bar-redo", () =>
      this.redoEdit()
    );
    return el("div", { class: cls("tool-group") }, [
      this.undoBtn,
      this.redoBtn,
    ]);
  }

  /**
   * Dim the two buttons when their stack is empty.
   *
   * Driven by `HistoryDeps.onChange` rather than polled, because the stacks move
   * from a dozen places — every control, every drag, every replay, and `clear()`
   * after an agent apply. `base.css` already dims `[disabled] .ic`, so a
   * disabled button costs no new CSS.
   */
  private syncUndoButtons(): void {
    if (!this.undoBtn) {
      return;
    }
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
  }

  /**
   * Show the edit-mode half of the bar, or the view-mode half.
   *
   * Undo, the tools and Inspect all operate on a selection, and view mode has
   * none — it detaches every pointer hook so the page is the user's again. A row
   * of controls that cannot do anything is worse than a shorter bar. The Hand is
   * the exact converse: it exists *because* the page is live, and offering it
   * while editing would duplicate a drag that already pans.
   */
  private syncBar(): void {
    for (const node of this.editOnlyBar) {
      node.classList.toggle(cls("hidden"), !this.editing);
    }
    for (const node of this.viewOnlyBar) {
      node.classList.toggle(cls("hidden"), this.editing);
    }
  }

  /**
   * The Hand, as a button.
   *
   * `data-tip` is the binding *label*, not prose — `Tooltips` looks a shortcut up
   * by matching tooltip text against the registered bindings, and
   * `bindEditorKeys` labels this one "Hand tool", so the button carries
   * "Hand tool H" without either side knowing about the other. Same trick the
   * undo buttons use.
   */
  /**
   * "Working" — the one thing view mode has to say about a job.
   *
   * Everything that reports a turn's progress lives inside the assistant bubble:
   * the pulsing status dot, the timeline rows, the result. All of it is in the
   * chat body, which view mode swaps out — so before this, sending a prompt and
   * flipping to view meant the editor gave no sign that anything was happening
   * at all, and a turn that carried no inspector deltas finished without a word
   * anywhere (`reconcileVisual` and `keepVisual` are both gated on
   * `applyingVisual`).
   *
   * A button, not a badge, because there is an obvious thing to want next: it
   * puts you back where the transcript is. In `viewOnlyBar` rather than the
   * always-on part of the bar, since in edit mode the transcript is already
   * saying this — two live indicators for one job is one more than the fact
   * deserves.
   *
   * The dot is the transcript's own (`.dot`, `@keyframes ap-pulse`), so the
   * thing in the bar and the thing in the bubble are visibly the same state.
   */
  private buildJobChip(): HTMLElement {
    this.jobChip = el(
      "button",
      {
        // The visible "Working" and the dot carry the state; the tip carries
        // what pressing it does. Kept apart rather than joined with a dash,
        // which is the whole point of the rule `tooltip.copy.test.ts` enforces.
        "aria-label": "Working. Show the agent panel",
        class: `${cls("bar-job")} ${cls("hidden")}`,
        "data-tip": "Show the agent panel",
        onClick: () => this.showTranscript(),
        type: "button",
      },
      [
        el("span", { class: cls("dot") }),
        el("span", { class: cls("bar-job-label"), text: "Working" }),
      ]
    );
    /*
     * Two elements, one per owner — the same bargain `bar-frame-tools` and
     * `bar-apply-host` make, and for a reason this very nearly shipped without.
     *
     * Two things gate this chip and they belong to different code: the *mode*,
     * which `syncBar` hides the whole `viewOnlyBar` by, and `awaiting`, which
     * `syncJobChip` owns. Written to one element they clobber each other — and
     * in the direction that matters: start a job in edit mode and
     * `syncJobChip` would strip the `hidden` that `syncBar` had put there,
     * putting the chip in a bar that is supposed to have swapped it out.
     */
    return el("div", { class: cls("bar-job-host") }, [this.jobChip]);
  }

  private syncJobChip(): void {
    this.jobChip?.classList.toggle(cls("hidden"), !this.awaiting);
  }

  /**
   * Go to where the transcript is, from wherever you are.
   *
   * Three things can be hiding it and any of them can be true at once: view
   * mode swapped the body out, the dock is collapsed to its pill, and the
   * preview pane is over the top of it. The chip and the completion toast both
   * land here so neither has to know which one it is fixing.
   */
  private showTranscript(): void {
    this.setEditing(true);
    this.setPreview(false);
    if (!this.leftOpen) {
      this.setLeft(true);
    }
    this.repinTranscript();
  }

  /** Is the transcript actually on screen? Not the same as "in edit mode". */
  private transcriptVisible(): boolean {
    return (
      this.editing &&
      this.leftOpen &&
      !(this.previewOpen || this.chatBody.classList.contains(cls("hidden")))
    );
  }

  private buildHandGroup(): HTMLElement {
    this.handBtn = el(
      "button",
      {
        "aria-label": "Hand tool",
        "aria-pressed": "false",
        class: cls("tool"),
        ...tip("Hand tool", "tool.hand"),
        onClick: () => this.setHandTool(!this.hand),
        type: "button",
      },
      [icon("tool-hand", "sm")]
    );
    return el("div", { class: cls("tool-group") }, [this.handBtn]);
  }

  /**
   * Arm or disarm the Hand, from wherever — the button, `H`, Escape, or a mode
   * change. The canvas is the thing that actually changes behaviour; this owns
   * only the latch and what the bar says about it.
   */
  private setHandTool(on: boolean): void {
    if (on === this.hand) {
      return;
    }
    this.hand = on;
    this.handBtn?.classList.toggle(cls("tool-on"), on);
    this.handBtn?.setAttribute("aria-pressed", String(on));
    this.stage.setHandTool?.(on);
  }

  private buildToolGroup(wanted: Tool[]): HTMLElement {
    const group = el("div", { class: cls("tool-group") });
    for (const tool of wanted) {
      const binding = TOOLS.find((t) => t.tool === tool);
      if (!binding) {
        continue;
      }
      const spec = commandSpec(binding.id);
      const btn = el(
        "button",
        {
          "aria-label": spec.title,
          class: cls("tool"),
          onClick: () => this.tools.set(tool),
          type: "button",
          ...tip(spec.title, binding.id),
        },
        [icon(TOOL_ICON[tool], "sm")]
      );
      btn.classList.toggle(cls("tool-on"), this.tools.active === tool);
      this.toolButtons.set(tool, btn);
      group.append(btn);
    }
    return group;
  }

  /** Reflect the active tool, and apply what it means. */
  private onToolChange(tool: Tool): void {
    for (const [name, btn] of this.toolButtons) {
      btn.classList.toggle(cls("tool-on"), name === tool);
    }
    // Inspect is a read-only mode: hovering reports rather than selects, so it
    // rides the CSS tab and suppresses the picker's click-to-select. It also
    // ends any live edit — the mode exists to read specs off a hover, and a
    // caret blinking in the page while it is on is a contradiction.
    if (tool === "inspect") {
      this.panel.endTextEdit();
    }
    this.panel.setInspecting(tool === "inspect");
    this.controller.setInspecting(tool === "inspect");
  }

  /** Edits that only exist in memory, and so would not survive a navigation. */
  private hasPendingEdits(): boolean {
    return this.pendingCount() > 0;
  }

  /**
   * Every pending in-memory edit, as one number — the single spelling of "is
   * anything pending". The composer reveal, the surface-toggle block and the
   * bar's Apply/Discard group all read it. Structure edits are included on
   * purpose: the old reveal predicate forgot them, so a delete rendered a chip
   * and blocked the surface toggle without ever revealing the composer.
   */
  private pendingCount(): number {
    return (
      this.changeSet.count() +
      this.moveSet.count() +
      this.attrSet.count() +
      this.structureSet.count()
    );
  }

  /**
   * Switch surface.
   *
   * Necessarily a document navigation: the proxy decides canvas-or-inline when
   * it serves the HTML, before any script runs, and the two surfaces take the
   * same boot claim, so neither could replace the other in place. The cookie is
   * what makes the choice outlive the reload — it is read server-side on the
   * next navigation.
   *
   * `__airship` is stripped from the target rather than set to the new surface,
   * so an explicit override in the current URL cannot outrank the preference we
   * just wrote and bounce the user straight back.
   */
  private switchSurface(next: AirshipSurface): void {
    if (next === this.surface) {
      return;
    }
    // `document.cookie` and not the Cookie Store API: that one is async and not
    // universally available, and this write has to be committed before the
    // navigation on the next line — a promise that resolves after the document
    // is gone would leave the preference unwritten and bounce the user back.
    // biome-ignore lint/suspicious/noDocumentCookie: must be synchronous before navigating
    document.cookie = `${AIRSHIP_SURFACE_COOKIE}=${next}; path=/; SameSite=Lax`;
    const url = new URL(
      this.appPathname ?? window.location.href,
      window.location.origin
    );
    url.searchParams.delete(AIRSHIP_MODE_PARAM);
    window.location.assign(url.toString());
  }

  /** The surface the document booted on, as the picker describes it. */
  private activeSurface(): (typeof SURFACES)[number] {
    return SURFACES.find((s) => s.kind === this.surface) ?? SURFACES[0];
  }

  /**
   * Canvas ⇄ inline: one glyph, opening a menu.
   *
   * Sits in the bar's one always-present zone because it is the one control
   * that means the same thing on both stages. Disabled while edits are pending:
   * the change set, the history and the transcript are in-memory only, and a
   * navigation would discard them with no warning — cheaper to withhold the
   * button than to build a confirm dialog the overlay does not otherwise have.
   *
   * A glyph rather than the labelled segmented pair it used to be. Sitting next
   * to Edit/View, two labelled pill-groups read as one four-option control, and
   * they are nothing like equal: Edit/View is flipped constantly and costs
   * nothing, while this one is rare and navigates the document. Same trade as
   * the backend picker (`buildAgentButton`) — the glyph is the state readout,
   * and the menu is where the control names itself.
   */
  private buildSurfaceToggle(): HTMLElement {
    const active = this.activeSurface();
    this.surfaceBtn = el(
      "button",
      {
        "aria-expanded": "false",
        "aria-haspopup": "menu",
        "aria-label": `Surface: ${active.label}`,
        // `.tool`, not `.iconbtn`: same box and the same ghost recipe, but only
        // `.tool` carries the `:disabled` rules this button needs.
        class: cls("tool"),
        "data-tip": `Surface: ${active.label}`,
        onClick: () => this.openSurfaceMenu(),
        type: "button",
      },
      [icon(active.icon, "sm")]
    ) as HTMLButtonElement;
    return this.surfaceBtn;
  }

  /**
   * The picker's menu. Opens *above*: the bar is pinned to the bottom of the
   * viewport, so a menu placed below it would open off-screen — the same reason
   * the canvas's zoom menu prefers that side.
   *
   * Headed, unlike the backend picker's: that one hangs off a button in a dock
   * header with a title beside it, this one off a bare glyph, so the header row
   * is the only place the menu says what it is about.
   */
  private openSurfaceMenu(): void {
    this.surfaceBtn.setAttribute("aria-expanded", "true");
    createMenu([
      { header: "Surface" },
      ...SURFACES.map((s) => ({
        icon: s.icon,
        label: s.label,
        on: s.kind === this.surface,
        run: () => this.switchSurface(s.kind),
      })),
    ]).open(this.surfaceBtn, "above", {
      onClose: () => this.surfaceBtn.setAttribute("aria-expanded", "false"),
    });
  }

  /**
   * Reflect whether switching is currently possible. Cheap; called on change.
   *
   * The reason rides the accessible name as well as the tip. `disabled` alone
   * announces only that the control is unavailable, never why, and the tooltip
   * carrying the explanation is exactly the half a screen reader cannot reach.
   */
  private syncSurfaceToggle(): void {
    const blocked = this.hasPendingEdits();
    /*
     * The remedy has to be one you can actually reach.
     *
     * Apply, Discard and the composer's per-change chips are all edit-mode
     * furniture, so in view mode the old wording named three controls that were
     * not on screen — and on the canvas the whole chat body is swapped out, so
     * there was no route to any of them without first doing the thing the
     * message did not mention.
     */
    let label = `Surface: ${this.activeSurface().label}`;
    if (blocked) {
      label = this.editing
        ? "Apply or discard your changes before switching surface"
        : "Switch to Edit to apply or discard your changes";
    }
    this.surfaceBtn.disabled = blocked;
    this.surfaceBtn.setAttribute("data-tip", label);
    this.surfaceBtn.setAttribute("aria-label", label);
  }

  private buildEditToggle(): HTMLElement {
    const editBtn = el(
      "button",
      {
        class: `${cls("seg")} ${cls("seg-on")}`,
        "data-tip": "Edit mode. Hover to select, click to edit",
        onClick: () => this.setEditing(true),
        type: "button",
      },
      [icon("edit-mode", "sm"), el("span", { text: "Edit" })]
    );
    const viewBtn = el(
      "button",
      {
        class: cls("seg"),
        "data-tip": "View mode. The page stays interactive",
        onClick: () => this.setEditing(false),
        type: "button",
      },
      [icon("preview", "sm"), el("span", { text: "View" })]
    );
    this.editBtn = editBtn;
    this.viewBtn = viewBtn;
    return el("div", { class: cls("seg-group") }, [editBtn, viewBtn]);
  }

  /** Switch between the design-tool edit and view modes. Edit mode auto-selects
   * (hover to highlight, click to select) and drives the inspector; view mode
   * detaches all pointer hooks so the page is fully interactive. Entering view
   * drops the current selection and any inspector drag modes. */
  private setEditing(on: boolean): void {
    if (on === this.editing) {
      return;
    }
    // Before anything else, and before `stage.setEditing` in particular: the
    // canvas re-applies every frame's mode there, and the frame override has to
    // be released first or it survives into view mode. This also fixes a plain
    // leak — a mode switch mid-edit used to leave `contenteditable` and the
    // editor's marker attribute on the page permanently, with the guard and the
    // picker already detached.
    this.panel.endTextEdit();
    this.pendingTextEdit = null;
    this.editing = on;
    this.editBtn?.classList.toggle(cls("seg-on"), on);
    this.viewBtn?.classList.toggle(cls("seg-on"), !on);
    if (on) {
      // The mirror of the line above, and for the same reason: a latched tool
      // whose button is about to disappear would keep changing what a drag means
      // with nothing on screen to say so.
      this.setHandTool(false);
    } else {
      // Before hiding the tool group, not after. Inspect is a latched tool that
      // keeps the page inert and suppresses click-to-select; left armed behind a
      // hidden button it would go on doing that in view mode with nothing on
      // screen to explain why the page will not respond.
      this.tools.reset();
      this.clearSelectionScope();
    }
    // Both of the left dock's overlays come down, and for the same reason: they
    // are drawn over the transcript's slot, so either one left standing would
    // survive the swap and sit on top of the frame list — the drawer as a
    // full-panel sheet of past chats (`inset: 0`), the preview as the prompt
    // pane in the transcript's place. The preview is the one that bites on the
    // way *back*, where it hides the turn that just finished.
    this.closeHistory();
    this.setPreview(false);
    this.syncBar();
    this.syncDocks();
    this.syncMinimap();
    this.syncJobChip();
    // Its blocked message names a different remedy per mode, so the mode is now
    // one of its inputs — `renderComposerChips` is no longer the only thing
    // that can make it stale.
    this.syncSurfaceToggle();
    // Republishes the safe inset — which has just changed, because the
    // inspector is gated away in view mode — and re-anchors the chrome.
    this.afterDockToggle();
    this.panel.setEditing(on);
    this.controller.setEditing(on);
    // On the canvas this is what makes the frames inert (edit) or live (view),
    // and what catches the minimap and the frame list up on everything that
    // moved while they were off screen. After `afterDockToggle`, so the inset
    // they aim against is the one they will be looking at.
    this.stage.setEditing?.(on);
    if (on) {
      this.repinTranscript();
    }
  }

  /**
   * Put the transcript back at the bottom after it has been off screen.
   *
   * `.hidden` is `display: none`, and an element with no box reports zero for
   * `scrollTop`, `scrollHeight` and `clientHeight` — so while the chat is
   * swapped out, `atBottom()` computes `0 - 0 - 0 < 40` and answers *true* to
   * everything, and the `scrollTop` writes `scrollTranscript` makes are
   * discarded by the CSSOM. The box that comes back is a fresh one at offset 0.
   *
   * The upshot before this: stream a turn, flip to view mode and back, and the
   * transcript was scrolled to the very top showing the oldest bubble — with a
   * live turn still writing into the bottom of it.
   *
   * The frame of delay is load-bearing. `syncDocks` has un-hidden the subtree
   * but layout has not run, so `scrollHeight` is still 0 this tick; scrolling
   * now would write into the same void that lost the position in the first
   * place.
   */
  private repinTranscript(): void {
    requestAnimationFrame(() => {
      if (!this.chatBody.classList.contains(cls("hidden"))) {
        this.scrollTranscript();
      }
    });
  }

  private buildLeftDock(): void {
    this.input = el("textarea", {
      class: cls("input"),
      // The shortcut used to live in the placeholder. It is on the Send
      // button's tooltip now — `Tooltips` looks a binding up by tooltip text,
      // and the `mod+enter` binding below is already labelled "Send", so the
      // glyph carries "Send ⌘⏎" for free without spending a line of the field.
      placeholder: "Describe the change…",
      rows: "1",
    }) as HTMLTextAreaElement;
    this.input.addEventListener("input", () => {
      this.autoGrow();
      // Typed text is part of the turn but is not a chip, so it needs its own
      // trigger — `renderComposerChips` never runs for a keystroke.
      this.schedulePreview();
    });
    // The one shortcut that has to fire *while* a field has focus — it is the
    // field's own submit. Guarded on the composer specifically so ⌘Enter in any
    // other input (the frame rename, a CSS value) does nothing.
    this.disposers.push(
      keys.bind({
        id: "chat.send",
        run: () => this.submit(),
        when: () => document.activeElement === this.input,
      })
    );
    this.input.addEventListener("paste", (e) => this.onPaste(e));
    this.chipsEl = el("div", {
      class: `${cls("chips")} ${cls("scroll-x")}`,
    });
    this.selChipsEl = el("div", {
      class: `${cls("sel-chips")} ${cls("scroll-x")}`,
    });
    // Both rails, not just the pending-change one: a paste of six screenshots
    // overflows exactly the same way and was exactly as unreachable.
    this.disposers.push(
      attachRailWheel(this.chipsEl),
      attachRailWheel(this.selChipsEl),
      // Keys only on the strip whose chips are individually meaningful. The
      // attachment rail's chips are images with one action each, and arrowing
      // between them would collide with the nudge bindings for no gain.
      attachRailKeys(this.selChipsEl)
    );

    this.sendBtn = el(
      "button",
      {
        "aria-label": "Send",
        class: `${cls("action")} ${cls("action-icon")} ${cls("primary")} ${cls("send")}`,
        ...tip("Send", "chat.send"),
        onClick: () => this.submit(),
        type: "button",
      },
      [icon("chev-up", "sm")]
    ) as HTMLButtonElement;

    // Built by hand rather than through `iconButton`, which hardcodes the `md`
    // glyph: this sits directly beside Send's `sm` one and the two have to read
    // as a pair. The control that answers "what will Send send?" belongs next
    // to Send.
    this.previewBtn = el(
      "button",
      {
        "aria-label": "Show the prompt",
        class: `${cls("iconbtn")} ${cls("field-btn")}`,
        "data-tip": "Show the prompt",
        onClick: () => this.setPreview(!this.previewOpen),
        type: "button",
      },
      [icon("code", "sm")]
    ) as HTMLButtonElement;

    // "Airship", not "Agent". The right dock is named for what it does
    // ("Design") because there could be another panel; there is only ever one
    // of these, and it is the product. "Agent" also collided with the backend
    // picker sitting two elements to its right, where the word means Claude or
    // Codex — so the header said "Agent" and the control beside it said
    // "Agent: claude" about two different things. The mark and the name
    // together are the one place the product signs its own work.
    const head = el(
      "div",
      { class: cls("head"), ...dockHeadAttrs("Chat panel") },
      [
        el("div", { class: cls("brand") }, [
          icon("logo", "sm"),
          el("span", { class: cls("brand-name"), text: "Airship" }),
        ]),
        el("div", { class: cls("head-actions") }, [
          this.buildAgentButton(),
          this.buildNewChatButton(),
          this.iconButton("history", "Past chats", () => this.toggleHistory()),
          this.iconButton("rotate-ccw", "Reset width", () =>
            this.resetWidth("left")
          ),
          this.panelToggle("left", "chat", false),
        ]),
      ]
    );

    // `scroll-y` for the same reason the inspector body and the palette take
    // it: the transcript was the tallest scroller in the product still drawing
    // a platform scrollbar, so the one panel you read for minutes at a time was
    // the one that looked least like the rest of the overlay.
    this.transcriptEl = el("div", {
      class: `${cls("transcript")} ${cls("scroll-y")}`,
    });
    this.histEl = el("div", {
      class: `${cls("drawer")} ${cls("scroll-y")} ${cls("hidden")}`,
    });
    // One field, not four stacked rows. The composer used to spend ~145px at
    // rest on its own padding, a 64px textarea floor and a labelled Send pill
    // on a line of its own; everything now shares a single bordered box that
    // starts one line tall and grows with the text.
    const field = el("div", { class: cls("field") }, [
      this.selChipsEl,
      this.chipsEl,
      this.input,
      this.previewBtn,
      this.sendBtn,
    ]);
    const composer = el("div", { class: cls("composer") }, [field]);
    this.buildPreviewPane();

    /*
     * The chat's four children, wrapped so the mode can hide them as a group.
     *
     * `display: contents` on the wrapper, not a real box: the dock is a flex
     * column and these have to stay its own flex items — the transcript is what
     * takes the remaining height, and a wrapper with a box of its own would take
     * it instead and leave the composer floating. It also keeps the drawer's
     * `inset: 0` resolving against the dock, which is what it is drawn over.
     */
    this.chatBody = el("div", { class: cls("dock-body") }, [
      this.transcriptEl,
      this.previewEl,
      this.histEl,
      composer,
    ]);
    this.chatHead = head;
    this.framesHead = this.buildFramesHead();
    this.framesBody = el("div", {
      class: `${cls("dock-body")} ${cls("hidden")}`,
    });
    this.leftDock = el(
      "div",
      { class: `${cls("dock")} ${cls("dock-left")} ${cls("hidden")}` },
      [
        this.chatHead,
        ...(this.framesHead ? [this.framesHead] : []),
        this.chatBody,
        this.framesBody,
        this.buildSplitter("left"),
      ]
    );
    this.leftBrand = el("span", {
      class: cls("brand-name"),
      text: "Airship",
    });
    this.leftPill = this.buildPill("left", "chat", [
      el("div", { class: cls("brand") }, [icon("logo", "sm"), this.leftBrand]),
      this.panelToggle("left", "chat", true),
    ]);
    this.heads.left = head;
    this.armDockDrag("left", head, "head");
    if (this.framesHead) {
      // A distinct `part`, or the two would build dnd entities with the same
      // id — `armDockDrag` keys on `${type}:${side}:${part}`.
      this.armDockDrag("left", this.framesHead, "frames-head");
    }
    this.armDockDrag("left", this.leftPill, "pill");
    this.root.append(this.leftDock, this.leftPill);
    this.stage.mountFramesPanel?.(this.framesBody);
    this.clearTranscript();
    this.renderComposerChips();
  }

  /**
   * The left dock's view-mode header.
   *
   * Its own header rather than a retitled one, because the actions differ all
   * the way down: no agent picker, no new chat, no past chats — none of which
   * mean anything in a mode with no element selection to scope a prompt to.
   * What it keeps is the pair every dock header has, reset-width and collapse,
   * so the panel behaves like the panel it replaced.
   *
   * Null on a stage with no frames to list, and that absence is what leaves the
   * inline overlay's dock exactly as it was.
   */
  private buildFramesHead(): HTMLElement | null {
    if (!this.stage.mountFramesPanel) {
      return null;
    }
    return el(
      "div",
      {
        class: `${cls("head")} ${cls("hidden")}`,
        ...dockHeadAttrs("Frames panel"),
      },
      [
        el("div", { class: cls("brand") }, [
          icon("layer-frame", "sm"),
          el("span", { class: cls("brand-name"), text: "Frames" }),
        ]),
        el("div", { class: cls("head-actions") }, [
          this.iconButton("rotate-ccw", "Reset width", () =>
            this.resetWidth("left")
          ),
          this.panelToggle("left", "frames", false),
        ]),
      ]
    );
  }

  /**
   * Size the composer to its content: one line at rest, growing until it would
   * eat the transcript, then scrolling.
   *
   * `height` must be cleared before `scrollHeight` is read — the property is
   * the content height *of the current box*, so measuring without the reset
   * only ever ratchets upwards and the field can never shrink again.
   *
   * Bails while the composer is not on screen, where every layout metric reads
   * 0 and the field would collapse to nothing; `afterDockToggle` re-runs it on
   * the way back. That is two cases now, not one: the dock can be collapsed to
   * its pill, and — since the left dock started carrying the frame list in view
   * mode — the dock can be open with the chat swapped out from under it.
   */
  private autoGrow(): void {
    if (!this.leftOpen || this.chatBody.classList.contains(cls("hidden"))) {
      return;
    }
    const max = Math.max(96, Math.round(this.leftDock.clientHeight * 0.4));
    this.input.style.height = "auto";
    const wanted = this.input.scrollHeight;
    this.input.style.height = `${Math.min(wanted, max)}px`;
    this.input.style.overflowY = wanted > max ? "auto" : "hidden";
  }

  // -- Transcript ------------------------------------------------------------

  private clearTranscript(): void {
    clear(this.transcriptEl);
    this.activeTurn = null;
    // The single sentence this used to be was doing two jobs at once — naming
    // the thing and teaching the scoping trick — in one 90-character line set
    // across a 320px dock. Split: the title is the invitation, the body is the
    // tip, and the ship above them carries the weight the em-dash was.
    const empty = emptyState({
      body: "Pick an element first to scope it.",
      title: "Ask airship to change anything",
    });
    empty.classList.add(cls("chat-empty"));
    this.transcriptEl.append(empty);
  }

  private pushBubble(node: HTMLElement): void {
    this.transcriptEl.querySelector(`.${cls("chat-empty")}`)?.remove();
    this.transcriptEl.append(node);
    this.scrollTranscript();
  }

  /**
   * Pin to the bottom only if we were already there. A busy timeline fires many
   * rows a second, and hard-pinning would yank a reader out of an earlier one.
   * Must be called *after* the DOM mutation — it re-measures.
   */
  private scrollTranscript(wasAtBottom = true): void {
    if (wasAtBottom) {
      this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
    }
  }

  /** Whether the transcript is scrolled to (or within a hair of) the bottom. */
  private atBottom(): boolean {
    const e = this.transcriptEl;
    return e.scrollHeight - e.scrollTop - e.clientHeight < 40;
  }

  /**
   * New chat, behind the confirm. Held as a field because the confirm menu
   * anchors on it — and because `newChat` destroys pending edits, comments,
   * the draft and the transcript, and doing that silently was how the
   * complaint arrived.
   */
  private buildNewChatButton(): HTMLElement {
    this.newChatBtn = this.iconButton("plus", "New chat", () =>
      this.confirmPending(
        this.newChatBtn,
        (n) =>
          `Discard ${n} pending change${n === 1 ? "" : "s"} and start a new chat`,
        () => this.newChat()
      )
    );
    return this.newChatBtn;
  }

  /**
   * Run a destructive action, asking first when there is something to lose.
   *
   * `panel.discard()` clears four delta sets *and* the journal, so unlike
   * everything else in the editor there is no ⌘Z behind it — and the toast
   * doctrine reserves an actionable toast for acts the journal can honestly
   * reverse, which this is not. The two-step menu is the same shape the
   * push-and-open-PR flow uses: it says exactly what will happen and takes a
   * second deliberate click. With nothing pending it stays out of the way.
   */
  private confirmPending(
    anchor: HTMLElement,
    verb: (pending: number) => string,
    run: () => void,
    prefer: "above" | "below" = "below"
  ): void {
    const pending = this.pendingCount();
    if (pending === 0) {
      run();
      return;
    }
    createMenu([
      { header: "This cannot be undone" },
      { icon: "close", label: verb(pending), run },
    ]).open(anchor, prefer);
  }

  private newChat(): void {
    this.parentJobId = null;
    this.activeThreadRoot = null;
    this.forkNext = false;
    // Drop any pending inspector tweaks (reverts previews + clears both sets)
    // so a fresh chat starts with an empty composer.
    this.panel.discard();
    this.commentSet.clear();
    this.clearSelectionScope();
    this.input.value = "";
    this.images = [];
    this.renderChips();
    this.closeHistory();
    this.clearTranscript();
    this.setLeft(true);
    this.input.focus();
  }

  /**
   * The collapsed form of a dock: a small floating card in the corner the dock's
   * own header would occupy.
   *
   * This is the design-tool arrangement, and the reason it reads as one thing rather
   * than two is that the pill and the header share a position — collapsing does
   * not move the brand or the toggle, it just drops everything below them. The
   * previous version was a slim tab pinned to the middle of the viewport edge,
   * which had nothing to do with where the panel had been.
   */
  private buildPill(
    side: Side,
    label: string,
    children: HTMLElement[]
  ): HTMLElement {
    return el(
      "div",
      {
        class: `${cls("pill")} ${cls(`pill-${side}`)}`,
        "data-tip": `Show ${label}`,
      },
      children
    );
  }

  /** The show/hide button for a dock, in the glyph that matches its side. Both
   * the pill and the dock header use this, so the control that closes a panel is
   * the control that reopens it. */
  private panelToggle(side: Side, label: string, open: boolean): HTMLElement {
    return this.iconButton(
      side === "left" ? "panel-left" : "panel-right",
      `${open ? "Show" : "Hide"} ${label}`,
      () => (side === "left" ? this.setLeft(open) : this.setRight(open))
    );
  }

  private buildRightDock(): void {
    const head = el(
      "div",
      { class: cls("head"), ...dockHeadAttrs("Design panel") },
      [
        el("div", { class: cls("brand") }, [
          icon("settings", "sm"),
          el("span", { class: cls("brand-name"), text: "Design" }),
        ]),
        el("div", { class: cls("head-actions") }, [
          this.iconButton("rotate-ccw", "Reset width", () =>
            this.resetWidth("right")
          ),
          this.panelToggle("right", "design", false),
        ]),
      ]
    );
    this.rightDock = el(
      "div",
      { class: `${cls("dock")} ${cls("dock-right")} ${cls("hidden")}` },
      [head, this.panel.element, this.buildSplitter("right")]
    );
    this.rightPill = this.buildPill("right", "design", [
      el("div", { class: cls("brand") }, [
        icon("settings", "sm"),
        el("span", { class: cls("brand-name"), text: "Design" }),
      ]),
      this.panelToggle("right", "design", true),
    ]);
    this.heads.right = head;
    this.armDockDrag("right", head, "head");
    this.armDockDrag("right", this.rightPill, "pill");
    this.root.append(this.rightDock, this.rightPill);
  }

  private iconButton(
    name: IconName,
    label: string,
    onClick: () => void,
    command?: CommandId
  ): HTMLElement {
    return el(
      "button",
      {
        "aria-label": label,
        class: cls("iconbtn"),
        onClick,
        type: "button",
        // The overlay's own tooltip, not the native one: it opens in 400ms
        // rather than a second, is styled, and renders the action's keyboard
        // shortcut beside it — from `command`, not from this label, so the copy
        // can be reworded without silently dropping the chord. Every
        // dock-header button used to use `title`.
        ...tip(label, command),
      },
      // `sm`, to match the bottom bar's tools — `.iconbtn` and `.tool` are the
      // same ghost recipe on the same `--ap-control-icon-box`. This said `md`
      // and the box was a control tall, so the glyph ran edge to edge with no
      // optical padding while the identical button in the bar had 4px a side.
      [icon(name, "sm")]
    );
  }

  // -- Dock open / close ------------------------------------------------------

  private setLeft(open: boolean): void {
    this.leftOpen = open;
    this.syncDocks();
    this.afterDockToggle();
  }

  private setRight(open: boolean): void {
    this.rightOpen = open;
    this.syncDocks();
    this.afterDockToggle();
  }

  /** Does this side's panel have a home in the mode we are in? */
  private isVisible(side: Side): boolean {
    return dockVisible({
      editing: this.editing,
      modeScoped: Boolean(this.stage.mountFramesPanel),
      open: this.isOpen(side),
      side,
    });
  }

  /**
   * Publish which panels exist, and which body the left one is showing.
   *
   * The open flags are the *user's* state and are never written here — the mode
   * is a second term laid over them, so a round trip through view mode returns
   * the inspector exactly as it was found, open or collapsed. Writing
   * `rightOpen = false` on the way in would have been a line shorter and would
   * have quietly thrown that away.
   *
   * A collapsed panel's pill goes with it. The pill means "there is a panel
   * here, folded up"; in view mode there is no inspector to unfold, so a pill
   * offering to show one would be a control that lies.
   */
  private syncDocks(): void {
    const leftOn = this.isVisible("left");
    const rightOn = this.isVisible("right");
    const modeScoped = Boolean(this.stage.mountFramesPanel);
    const frames = modeScoped && !this.editing;
    this.leftDock.classList.toggle(cls("hidden"), !leftOn);
    this.leftPill.classList.toggle(cls("hidden"), leftOn);
    this.rightDock.classList.toggle(cls("hidden"), !rightOn);
    this.rightPill.classList.toggle(
      cls("hidden"),
      rightOn || (modeScoped && !this.editing)
    );
    this.chatHead.classList.toggle(cls("hidden"), frames);
    this.chatBody.classList.toggle(cls("hidden"), frames);
    this.framesHead?.classList.toggle(cls("hidden"), !frames);
    this.framesBody.classList.toggle(cls("hidden"), !frames);
    this.leftBrand.textContent = frames ? "Frames" : "Airship";
    this.leftPill.dataset.tip = frames ? "Show frames" : "Show chat";
  }

  /** The bottom-right slot exists only in the mode the minimap belongs to. */
  private syncMinimap(): void {
    this.minimapHost?.classList.toggle(cls("hidden"), this.editing);
  }

  /**
   * Docks float over the canvas in both stages — nothing under them moves when
   * one opens. What the canvas is told is how much of itself is now covered, so
   * that a zoom-to-fit still aims at the part you can see; see `applyWidths`.
   * Inline has no canvas and ignores it: reserving space there once meant
   * padding `documentElement`, which shoved the user's app sideways on every
   * toggle — a 392px jump on the first click, once edit mode started
   * auto-selecting.
   */
  private afterDockToggle(): void {
    this.applyWidths();
    // A width change rewraps the composer, and opening the dock is the first
    // moment its metrics are readable at all. Deliberately not hooked into
    // `applyWidths`, which also runs on every splitter dragmove — a forced
    // reflow per frame of a resize, to correct a wrap the user is watching
    // happen. The splitter re-grows on drop instead.
    this.autoGrow();
    // Chrome lives in screen coords; realign once the layout has settled.
    requestAnimationFrame(() => this.syncChrome());
  }

  // -- Selection / edit mode -------------------------------------------------

  private onSelected(sel: Selection): void {
    this.selected = sel;
    this.scanFrameTokens(sel.node);
    this.setRight(true);
    this.panel.setSelection(sel);
    // The second half of `enterTextEdit`. Consumed unconditionally so a
    // selection that resolved to something else — a race the generation guard in
    // `select` can still produce — cannot leave the arming latched for the next
    // unrelated click.
    const pending = this.pendingTextEdit;
    this.pendingTextEdit = null;
    if (pending && pending.node === sel.node) {
      this.panel.beginTextEdit(sel.node, pending.caret);
    }
    this.renderComposerChips();
  }

  /**
   * Enter in-place text editing on a node, from whichever gesture asked.
   *
   * Selection first, editing second, and never the other way round. A
   * double-click arrives as `click`, `click`, `dblclick`, and `select()`
   * resolves the component context through an `await` — so at `dblclick` time
   * the panel's selection is routinely still the *previous* one. Beginning the
   * edit there would let its commit be attributed to the wrong element and ship
   * a text change for a file the user never touched. Arming `pendingTextEdit`
   * and beginning from `onSelected` makes "the panel's selection is the node
   * being edited" an invariant instead of a hope, and `beginTextEdit` refuses
   * outright if it is ever broken.
   *
   * The order below matters: `select()` has a synchronous fast path for
   * re-selecting a node it has already extracted, and that path calls
   * `onSelected` *inline* — so the arming has to happen before the call, not
   * after.
   */
  private enterTextEdit(
    node: Element,
    surface: Surface,
    caret: Point | null
  ): boolean {
    if (!isEditableText(node)) {
      return false;
    }
    this.panel.endTextEdit();
    if (this.selected?.node === node) {
      return this.panel.beginTextEdit(node, caret);
    }
    this.pendingTextEdit = { caret, node };
    this.controller.select(node, surface, "replace");
    return true;
  }

  /**
   * `element.editText`, wherever it is run from.
   *
   * The two call sites — the key binding and the context-menu row — had a
   * verbatim copy of this each. One command with two copies of its failure path
   * is one reword away from a menu that declines silently while the keystroke
   * explains itself, which is the exact split the binding's own comment says was
   * wrong the last time it existed.
   */
  private editTextOrExplain(): void {
    if (!this.editSelectedText()) {
      toast("This layer has no text to edit", { tone: "error" });
    }
  }

  /** `Enter` and `T`: edit the selection, with the whole string selected. */
  private editSelectedText(): boolean {
    const sel = this.selected;
    return sel ? this.enterTextEdit(sel.node, sel.surface, null) : false;
  }

  /**
   * Double-click: enter text edit, drilling to the sole text descendant.
   *
   * Silent when there is nothing to edit or the drill-down is ambiguous — a
   * gesture that lands on the wrong thing should do nothing, not explain itself.
   * The `T` command toasts instead, because it was asked for by name.
   */
  private onTextEnter(hit: Hit, at: Point): void {
    const target = textTargetIn(hit.node);
    if (target) {
      this.enterTextEdit(target, hit.surface, at);
    }
  }

  /**
   * Sticky text mode: a click landed away from a live edit.
   *
   * Commit first, always. Then another editable text layer takes the caret,
   * anything else takes the selection, and empty space deselects — the
   * design-tool model, and the thing that makes editing a run of labels one gesture instead
   * of one gesture per label.
   *
   * Modifier clicks deliberately opt out of the caret branch. A shift-click
   * means "add to the selection" whether or not you happen to be editing, and
   * starting a second edit there would make multi-select unreachable from inside
   * text.
   *
   * Note the asymmetry with `onTextEnter`: a single click tests `isEditableText`
   * directly where a double-click drills down. Drill-down is what makes the
   * double-click worth having; applying it here would make an ordinary click on
   * a card start editing its caption.
   */
  private onTextClickAway(hit: Hit | null, at: Point, mods: Mods): void {
    this.panel.endTextEdit();
    if (!hit) {
      this.controller.deselect();
      return;
    }
    if (!(mods.meta || mods.shift) && isEditableText(hit.node)) {
      this.enterTextEdit(hit.node, hit.surface, at);
      return;
    }
    let mode: SelectMode = "replace";
    if (mods.shift) {
      mode = "add";
    } else if (mods.meta) {
      mode = "toggle";
    }
    this.controller.select(hit.node, hit.surface, mode);
  }

  /**
   * A press the frame agent forwarded up from inside a live frame.
   *
   * Resolved back to a node through the same `pick` a shell-originated gesture
   * uses, so the two paths cannot drift — which is the whole reason the picker
   * never reads `event.target` to decide what is under the pointer.
   */
  private routeFramePress(at: Point, mods: Mods, dbl: boolean): void {
    const hit = this.controller.hitTest(at);
    if (dbl) {
      if (hit) {
        this.onTextEnter(hit, at);
      }
      return;
    }
    this.onTextClickAway(hit, at, mods);
  }

  /**
   * Scan the selection's frame for tokens the server's file scan could not see
   * (CSS-in-JS, anything injected at runtime).
   *
   * Done on selection rather than on frame-ready because a frame's stylesheets
   * are not all loaded the instant its agent registers, and because this is the
   * first moment the answer is actually needed. Once per document: the result
   * does not change between clicks, and walking the CSSOM of a Tailwind build on
   * every pick would be felt.
   */
  private scanFrameTokens(node: Element): void {
    const surface = this.stage.resolver.of(node);
    const doc = surface?.doc;
    if (!doc || this.scannedDocs.has(doc)) {
      return;
    }
    this.scannedDocs.add(doc);
    try {
      setRuntimeTokens(surface.scanTokens());
    } catch {
      // A token scan is an enhancement; never let it break selection.
    }
  }

  /**
   * Live resize drag from the selection handles.
   *
   * Takes a declaration map rather than a width/height pair because a resize is
   * not always only a size: dragging the west grip has to hold the east edge,
   * and how that is expressed depends on what is holding the element in place —
   * an inset, or `translate` for something in normal flow. `picker.ts` works out
   * which; everything that arrives here is applied the same way.
   *
   * Goes through `DesignPanel.recordOn` — the panel's one style write — rather
   * than repeating it here. It used to be a hand-copy of that method, and had
   * drifted apart from it in a way nothing surfaced: the copy never passed
   * `token` or `hardcode`, so dragging a handle to a value that sits on the
   * spacing scale shipped a bare literal where typing the same number shipped
   * `[token: --pk-space-md — write this token]`, and a property the user had
   * explicitly detached quietly re-attached itself on the next drag.
   *
   * `open()`/`close()` in `onResizeStart`/`onResizeEnd` still collapse the whole
   * drag into a single undo step; `recordOn` journals each frame into it.
   */
  private onResize(node: Element, decls: Record<string, string>): void {
    const sel = this.selected;
    if (!sel || sel.node !== node) {
      return;
    }
    for (const [property, value] of Object.entries(decls)) {
      if (!value) {
        continue;
      }
      this.panel.recordOn(node, property, value);
      this.panel.syncControl(property, value);
    }
    this.panel.refresh();
    this.controller.drawOutline();
  }

  /** The inspector recorded or discarded a tweak. Surface it in the left
   * composer and — so direct-manipulation edits visibly "land in the chat" —
   * open the left dock when a *new* edit arrives. */
  private onVisualChanged(): void {
    this.renderComposerChips();
    // Reveal on an increase only, never on "non-zero": this fires on every
    // panel change including deselect, undo and refresh, and re-opening a dock
    // the user deliberately closed on a plain empty-canvas click was a bug.
    const pending = this.pendingCount();
    if (pending > this.pendingSeen && !this.leftOpen) {
      this.setLeft(true);
    }
    // Stored unconditionally — inside the `if`, the watermark would latch high
    // after a discard and the reveal would be dead for the rest of the session.
    this.pendingSeen = pending;
    this.syncApplyGroup();
  }

  /** The composer's context chips: the selected element (scopes the next edit)
   * followed by one chip per pending inspector delta. The chips are how visual
   * edits ride into the single Send; each ✕ drops just that change. */
  private renderComposerChips(): void {
    // The DesignPanel ctor pings onChanged (via setSelection(null)) before the
    // composer DOM is built; ignore until buildLeftDock has created the row.
    if (!this.selChipsEl) {
      return;
    }
    clear(this.selChipsEl);
    const s = this.selected;
    if (s) {
      const label = s.element.displayName || `<${s.element.tagName}>`;
      this.selChipsEl.append(
        // `data-chip` puts it in the rail's roving order alongside the pending
        // edits: it is the first thing on the strip, so arrowing from it is
        // where circling through the changes naturally starts.
        el(
          "span",
          {
            class: cls("sel-chip"),
            "data-chip": "",
            "data-tip": label,
            tabindex: "-1",
          },
          [
            icon("tool-move", "sm"),
            el("span", { class: cls("chip-subject"), text: label }),
            el(
              "span",
              {
                "aria-label": `Deselect ${label}`,
                class: cls("chip-x"),
                onClick: () => this.clearSelectionScope(),
                role: "button",
                tabindex: "-1",
              },
              [icon("close", "sm")]
            ),
          ]
        )
      );
    }
    renderChangeChips(this.selChipsEl, this.pendingChips(), (anchor) =>
      this.confirmPending(
        anchor,
        (n) => `Discard all ${n} pending change${n === 1 ? "" : "s"}`,
        () => this.panel.discard(),
        "above"
      )
    );
    // The single funnel every delta mutation already passes through — selection
    // set or cleared, a tweak recorded, a chip discarded, `reconcileVisual`
    // after a turn. Hanging the preview here is what stops a path being missed;
    // it is a no-op whenever the pane is closed.
    this.schedulePreview();
    // Same reasoning: the surface switcher is blocked by exactly the edits these
    // chips represent, so it can only go stale if it is synced anywhere else.
    this.syncSurfaceToggle();
  }

  /**
   * Every pending direct-manipulation edit, as one chip each.
   *
   * Labels come from the `ElementContext` captured when the edit was recorded,
   * never from the live node: by the time a chip is drawn the element may have
   * been moved, re-rendered by HMR, or deleted outright, and the chip still has
   * to say which thing it is about.
   */
  private pendingChips(): ChangeChip[] {
    return [
      ...this.styleChips(),
      ...this.structureChips(),
      ...this.attrChips(),
      ...this.commentChips(),
    ];
  }

  /** One chip per pending style declaration. */
  private styleChips(): ChangeChip[] {
    const chips: ChangeChip[] = [];
    for (const entry of this.changeSet.entries()) {
      for (const c of entry.changes) {
        // A disabled declaration is still listed in the CSS tab but is not
        // going to be sent, so it is not pending anything.
        if (c.disabled) {
          continue;
        }
        const label = chipLabel(entry.element);
        // A scoped or state-bound tweak reads as a different edit than the same
        // property at rest, and the chip has to say so — two chips reading
        // "Button color #fff" with no way to tell which is the hover one would
        // make the ✕ a coin flip.
        const where = [c.scope, c.state].filter(Boolean).join("");
        const suffix = where ? ` ${where}` : "";
        chips.push({
          detail: c.property,
          // No glyph. `settings` said "a style change" on every one of these,
          // which is the one thing a strip of style chips does not need told
          // twelve times — and it cost 26px of the rail each time.
          onRemove: () =>
            this.panel.discardOneStyle(entry.node, c.property, {
              scope: c.scope,
              state: c.state,
            }),
          subject: `${label}${suffix}`,
          tip: `${label}${suffix} · ${c.property}: ${c.from} → ${c.to}${
            c.token ? ` (token ${c.token.name})` : ""
          }`,
          value: shortValue(c.to),
        });
      }
    }
    return chips;
  }

  /** Moves, deletes, duplicates and text edits. */
  private structureChips(): ChangeChip[] {
    const chips: ChangeChip[] = [];
    for (const entry of this.moveSet.entries()) {
      chips.push({
        detail: "moved",
        icon: "drag",
        onRemove: () => this.panel.discardOneMove(entry.node),
        subject: chipLabel(entry.element),
        tip: `${chipLabel(entry.element)} · moved in the tree`,
      });
    }
    for (const entry of this.structureSet.entries()) {
      const verb = entry.op === "delete" ? "deleted" : "duplicated";
      chips.push({
        detail: verb,
        icon: entry.op === "delete" ? "minus" : "plus",
        onRemove: () => this.panel.discardOneStructure(entry.node),
        subject: chipLabel(entry.element),
        tip: `${chipLabel(entry.element)} · ${verb}`,
      });
    }
    for (const entry of this.structureSet.textEntries()) {
      const label = chipLabel(entry.element);
      chips.push({
        detail: "text",
        icon: "layer-text",
        onRemove: () => this.panel.discardOneText(entry.node),
        subject: label,
        tip: `${label} · text: ${JSON.stringify(entry.from)} → ${JSON.stringify(entry.to)}`,
        value: `“${shortValue(entry.to)}”`,
      });
    }
    return chips;
  }

  /** One chip per pending HTML attribute edit. */
  private attrChips(): ChangeChip[] {
    const chips: ChangeChip[] = [];
    for (const entry of this.attrSet.entries()) {
      const label = chipLabel(entry.element);
      const shown = entry.to === null ? "removed" : shortValue(entry.to);
      chips.push({
        detail: entry.attribute,
        icon: "insert",
        onRemove: () => this.panel.discardOneAttr(entry.node, entry.attribute),
        subject: label,
        tip: `${label} · ${entry.attribute}: ${entry.from ?? "(unset)"} → ${
          entry.to ?? "(unset)"
        }`,
        value: shown,
      });
    }
    return chips;
  }

  /** One chip per review comment left on the last edit's diff. */
  private commentChips(): ChangeChip[] {
    const chips: ChangeChip[] = [];
    for (const c of this.commentSet.entries()) {
      const where =
        c.fromLine === undefined
          ? basename(c.file)
          : `${basename(c.file)}:${c.fromLine}${c.toLine === c.fromLine ? "" : `–${c.toLine}`}`;
      chips.push({
        // No `detail`: the glyph already says "a comment", and the file and
        // line are the whole of what this chip is about.
        icon: "tool-comment",
        onRemove: () => {
          this.commentSet.remove(c.id);
          this.renderComposerChips();
        },
        subject: where,
        tip: c.body,
      });
    }
    return chips;
  }

  private clearSelectionScope(): void {
    this.selected = null;
    // A pending edit is armed against a node that is no longer selected, and an
    // `extract` that resolves after a deselect is exactly the case the
    // generation guard in `select` drops — so nothing would ever consume it.
    this.pendingTextEdit = null;
    this.controller.clearSelection();
    this.panel.setSelection(null);
    this.renderComposerChips();
  }

  // -- Images ----------------------------------------------------------------

  private onPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          this.addImage(file);
        }
      }
    }
  }

  private async addImage(file: File): Promise<void> {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    this.images.push({
      dataBase64: dataUrl.slice(comma + 1),
      mediaType: file.type || "image/png",
      name: file.name || "pasted.png",
    });
    this.renderChips();
  }

  private renderChips(): void {
    clear(this.chipsEl);
    this.images.forEach((img, i) => {
      this.chipsEl.append(
        el("span", { class: cls("chip") }, [
          icon("image", "sm"),
          el("span", { text: img.name }),
          // A real button, not a click-only span. This rail takes
          // `attachRailWheel` but deliberately not `attachRailKeys`, so there is
          // no roving to route ⌫ through — which left removing a pasted image
          // reachable by pointer alone. A native button is both a tab stop and
          // activatable, and a few attachments is a few stops.
          el(
            "button",
            {
              "aria-label": `Remove ${img.name}`,
              class: cls("chip-x"),
              onClick: () => {
                this.images.splice(i, 1);
                this.renderChips();
              },
              type: "button",
            },
            [icon("close", "sm")]
          ),
        ])
      );
    });
  }

  // -- Submit — the single outbox --------------------------------------------

  /**
   * Ship one edit turn from the left composer: the typed instruction plus any
   * pasted images and any pending direct-manipulation deltas (style tweaks +
   * structural moves) accumulated in the inspector — all in a single request.
   * With deltas present, `prompt` rides along as an accompanying note (the
   * server treats it that way); with none, a plain typed message sends as before.
   */
  private submit(): void {
    if (this.awaiting) {
      return;
    }
    /*
     * Refuse rather than send into a closed socket.
     *
     * `AirshipSocket.send` drops silently when the socket is down, which is the
     * right bargain for fire-and-forget traffic and the wrong one here:
     * `beginJob` would latch `awaiting` for a job the daemon was never told to
     * create, and nothing would ever clear it — Send and Apply disabled for the
     * rest of the session, with a "Working" chip pulsing over a turn that does
     * not exist. `isOpen` was added for exactly this distinction on the prompt
     * preview; see its docstring.
     *
     * The socket reconnects on a 1.5s timer, so this refuses a keystroke the
     * user can repeat rather than one they cannot take back.
     */
    if (!this.socket.isOpen()) {
      toast("Not connected. Try again in a moment.", { tone: "error" });
      return;
    }
    // Before `buildRequest`, not after. An uncommitted edit is not yet in the
    // structure set, so the request would ship without the text *and*
    // `hasVisualDeltas` could answer false, skipping the reconcile that puts the
    // agent's version of the change back on the page.
    this.panel.endTextEdit();
    const built = this.buildRequest();
    if (!built) {
      return;
    }
    // `takeFork` is a one-shot that clears the pending "Branch", so it is
    // merged here and never inside `buildRequest` — the preview calls that on
    // a debounce, and looking at the prompt must not consume the flag.
    const fork = this.takeFork();
    const request = fork ? { ...built, fork } : built;

    this.pushBubble(userBubble(this.turnLabel(request)));
    this.beginJob();
    this.applyingVisual = hasVisualDeltas(request);
    this.socket.send({ request, type: "edit" });
    // A pre-flight view has done its job once the turn is away; what matters
    // now is the streaming reply, in the transcript this pane is covering.
    this.setPreview(false);
    this.input.value = "";
    this.images = [];
    this.commentSet.clear();
    this.renderChips();
    this.renderComposerChips();
    this.autoGrow();
    // Don't clear changeSet/moveSet here — reconcileVisual() clears them on
    // job:done, so the inline previews stay live until HMR lands the real code.
  }

  /** This turn's composer state, as the request Send and the preview share. */
  private buildRequest(): CreateJobRequest | null {
    return buildEditRequest({
      agent: this.agent,
      attrSet: this.attrSet,
      changeSet: this.changeSet,
      commentSet: this.commentSet,
      images: this.images,
      model: this.models[this.agent],
      moveSet: this.moveSet,
      parentJobId: this.parentJobId,
      prompt: this.input.value,
      selected: this.selected,
      structureSet: this.structureSet,
    });
  }

  /**
   * The user bubble's text. A send concern, not part of the request — and it
   * counts declarations via the sets' own `count()`, which is not the same
   * number as `targets().length` once scope/state grouping has split them.
   */
  private turnLabel(request: CreateJobRequest): string {
    if (request.prompt) {
      return request.prompt;
    }
    const comments = request.comments?.length ?? 0;
    if (comments) {
      return `${comments} comment${comments === 1 ? "" : "s"} on the last change`;
    }
    return applyLabel(
      this.changeSet.count(),
      this.moveSet.count(),
      this.structureSet.count(),
      "",
      this.attrSet.count()
    );
  }

  /**
   * The backend picker: an icon button carrying the *active* agent's mark.
   *
   * The glyph is the state readout — there is no room for a label in the header
   * and no need for one, since the logo is the more legible of the two anyway.
   * Same `iconButton` shape and same `createMenu` as the transcript's kebab, so
   * it reads as one of the header's controls rather than a widget dropped in.
   *
   * It now picks the model too, which is why the menu is grouped rather than
   * flat: a model id only means something against a backend, so the two are
   * chosen in one gesture. The button stays a single glyph — the model goes in
   * the tooltip, where there is room for it.
   */
  private buildAgentButton(): HTMLElement {
    this.agentBtn = this.iconButton("claude", "Agent", () =>
      this.openAgentMenu()
    );
    // `iconButton` does not set these — most header buttons run an action
    // rather than open anything. This one opens a menu, and after growing a
    // second level it is the header's most complex control, so a screen reader
    // has to be told that and told when it is open. `buildSurfaceToggle` is the
    // same shape; `aria-expanded` is driven from `openAgentMenu`'s `onClose`.
    this.agentBtn.setAttribute("aria-haspopup", "menu");
    this.agentBtn.setAttribute("aria-expanded", "false");
    this.syncAgentButton();
    return this.agentBtn;
  }

  /**
   * Open the picker, and ask the daemon what each backend offers.
   *
   * The menu is built from whatever is in hand — the seed on first open — and
   * rebuilt when `models:result` lands. It is never blocked on the answer:
   * probing starts an `opencode serve` and can take seconds, and a picker that
   * hangs on that is worse than one that fills in a moment later.
   */
  /**
   * @param probe Whether this open may ask the daemon. True when the user
   * clicked; **false** when `models:result` is repainting the menu it just
   * answered. Without that distinction the two feed each other: a result
   * carrying a `note` would repaint, the repaint would re-probe, and the next
   * result would repaint again, forever.
   */
  private openAgentMenu(probe = true): void {
    // A group with a `note` is one that could not be reached — usually a
    // backend the user is not signed into. That is the one state worth asking
    // about again, because the fix for it happens outside this window: sign in
    // in a terminal, reopen the menu, and the list is there. A clean result is
    // never re-probed, since re-running an `opencode serve` boot on every open
    // would cost seconds to learn nothing.
    const incomplete = this.catalogue.some((g) => g.note);
    // `isOpen()` before the flag, because `send` drops on the floor when the
    // socket is not open — a ~1.5s window on every reconnect. Marking it asked
    // anyway pinned the picker to the seed for the life of the page: the only
    // re-probe condition is a group carrying a `note`, and `SEED_CATALOGUE` sets
    // none, so `incomplete` was false forever and the live list never arrived.
    if (
      probe &&
      this.socket.isOpen() &&
      (!this.modelsRequested || incomplete)
    ) {
      this.socket.send({ refresh: this.modelsRequested, type: "models" });
      this.modelsRequested = true;
    }
    this.agentMenu = createMenu([
      ...modelGroups({
        agent: this.agent,
        catalogue: this.catalogue,
        models: this.models,
        pick: ({ agent, model }) => this.setAgentModel(agent, model),
      }),
      { separator: true },
      {
        node: customModelRow(
          this.agent,
          (model) => this.setAgentModel(this.agent, model),
          () => this.agentMenu?.close()
        ),
      },
    ]);
    this.agentBtn.setAttribute("aria-expanded", "true");
    this.agentMenu.open(this.agentBtn, "below", {
      onClose: () => {
        this.agentMenu = null;
        this.agentBtn.setAttribute("aria-expanded", "false");
      },
    });
  }

  /**
   * Point the picker at a backend and a model together.
   *
   * One call because they are one choice. The model is stored under its own
   * backend, so switching away and back returns to what was picked there
   * rather than carrying an id across to a backend that cannot run it.
   */
  private setAgentModel(agent: AgentKind, model: string): void {
    this.agent = agent;
    // Empty means the Default row: drop the entry so the request carries no
    // model at all and the daemon's resolved default applies again.
    if (model) {
      this.models[agent] = model;
    } else {
      delete this.models[agent];
    }
    saveModelPick({ agent: this.agent, models: this.models });
    this.syncAgentButton();
  }

  /** Point the picker at a backend, keeping the control and the state in step. */
  private setAgent(agent: AgentKind): void {
    this.agent = agent;
    this.syncAgentButton();
  }

  private syncAgentButton(): void {
    const active = AGENTS.find((a) => a.kind === this.agent) ?? AGENTS[0];
    const model = modelLabel(
      this.catalogue,
      this.agent,
      this.models[this.agent]
    );
    // Rebuilt rather than swapped: `icon()` owns the svg markup, and reaching
    // into it to retarget a path would duplicate that knowledge here.
    this.agentBtn.replaceChildren(icon(active.icon, "sm"));
    this.agentBtn.setAttribute("data-tip", `${active.label} · ${model}`);
    this.agentBtn.setAttribute(
      "aria-label",
      `Coding agent: ${active.label}, model: ${model}`
    );
  }

  /**
   * Read the stored picks back.
   *
   * Returns whether a backend was restored, because that is what decides if the
   * daemon's `hello` may seed the picker: a stored pick is the user's, and a
   * reconnect must not overwrite it. See the `hello` handler.
   */
  private restoreModel(): boolean {
    const stored = restoreModelPick();
    this.models = stored.models;
    if (stored.agent) {
      this.agent = stored.agent;
      return true;
    }
    return false;
  }

  /** Consume the one-shot "branch" flag set by an assistant Branch action. */
  private takeFork(): boolean | undefined {
    if (!this.forkNext) {
      return;
    }
    this.forkNext = false;
    return true;
  }

  private beginJob(): void {
    this.awaiting = true;
    this.activeJobId = null;
    this.sendBtn.disabled = true;
    this.syncApplyGroup();
    this.syncJobChip();
    const turn = assistantTurn();
    this.activeTurn = turn;
    this.pushBubble(turn.root);
  }

  /**
   * Reconcile a latched `awaiting` against what the daemon actually has.
   *
   * `awaiting` is cleared in exactly one place — a `job:done` whose id matches
   * `activeJobId` — so anything that eats that one broadcast strands the editor
   * with Send and Apply disabled and no way back. The daemon sends it once; a
   * socket that is down at that moment simply never hears it, and the 1.5s
   * reconnect brings back a connection with nothing to say about the turn that
   * ended while it was gone.
   *
   * `hello` is the answer because the server sends it on *every* connection
   * carrying `jobs.snapshots()`, and `JobStore` never evicts — so a reconnect
   * arrives holding the outcome of the job we stopped hearing about.
   *
   * Adopting the running job when we have no id of our own is sound rather than
   * a guess: the server serialises edits on one chain, so at most one job is
   * ever `running`, and having no id means our `job:created` was the thing we
   * missed.
   */
  private reconcileAwaiting(jobs: JobSnapshot[]): void {
    if (!this.awaiting) {
      return;
    }
    const verdict = reconcileJob(this.activeJobId, jobs);
    if (verdict.kind === "running") {
      // Still going, and we are back in time to hear it land.
      this.activeJobId = verdict.jobId;
      return;
    }
    this.releaseAwaiting(verdict.job);
  }

  /**
   * Let go of a turn whose ending we will never see.
   *
   * The bundle is what `finalizeAssistant` needs and the one thing a snapshot
   * cannot carry, so the turn is closed rather than filled: the pulse comes
   * off, the bubble takes the error treatment, and the text points at Past
   * chats, which is where the daemon did persist the result. Saying that is
   * better than either leaving it pulsing forever or quietly deleting it.
   */
  private releaseAwaiting(job?: JobSnapshot): void {
    this.awaiting = false;
    this.activeJobId = null;
    this.applyingVisual = false;
    this.sendBtn.disabled = false;
    this.syncApplyGroup();
    this.syncJobChip();

    const turn = this.activeTurn;
    this.activeTurn = null;
    if (turn) {
      turn.status.remove();
      (turn.result.parentElement ?? turn.result).classList.add(cls("msg-err"));
      clear(turn.result);
      turn.result.append(
        el("div", {
          class: cls("msg-body"),
          text: job
            ? `Lost the connection while this ran. It ${job.status}; open Past chats for the result.`
            : "Lost the connection before this was sent. Nothing ran.",
        })
      );
    }
    // Pending visual deltas are deliberately left alone: the turn may well have
    // landed, and discarding a user's unsaved changes on a socket blip would be
    // a far worse trade than leaving them to re-apply.
    toast("Connection dropped. The turn was released.", { tone: "error" });
  }

  /**
   * Say a turn finished, when nothing on screen otherwise would.
   *
   * A finished turn reports itself by *becoming* the assistant bubble — which
   * is the right design and says nothing at all if the transcript is not on
   * screen. That is now three ordinary states, not an edge case: view mode, a
   * dock collapsed to its pill, and the preview pane open over the top.
   *
   * Gated on visibility rather than on the mode, so all three are covered by
   * one condition; and gated on that rather than firing always, because a toast
   * duplicating a bubble the user is already looking at is noise. The action is
   * the same door the bar chip opens — see `showTranscript`.
   */
  private reportOffscreenTurn(bundle: JobDiffBundle): void {
    if (this.transcriptVisible()) {
      return;
    }
    const ok = bundle.status === "done";
    toast(ok ? "Change applied" : `Change ${bundle.status}`, {
      action: { label: "Show", run: () => this.showTranscript() },
      icon: ok ? "check" : "attention",
      tone: ok ? "neutral" : "error",
    });
  }

  // -- Socket events ---------------------------------------------------------

  private onEvent(ev: ServerEvent): void {
    switch (ev.type) {
      case "hello":
        // The daemon's `--agent` is the resting default, and it seeds the
        // picker only when nothing has been stored.
        //
        // It used to seed unconditionally, which was invisible while `hello`
        // arrived once and wrong the moment it did not: `ws.ts` reconnects on a
        // 1.5s timer, so any blip silently threw away whatever the user had
        // picked and snapped the composer back to the launch flag. Harmless
        // enough to lose a backend you can re-pick in one click; not harmless
        // now that the same event would take the model with it.
        if (!this.modelRestored) {
          this.setAgent(ev.defaultAgent);
        }
        // The snapshot is the only thing that can tell us a turn ended while we
        // were not listening — see `reconcileAwaiting`.
        this.reconcileAwaiting(ev.jobs);
        // A reconnect drops whatever request was in flight. Reset the key
        // first, or the dedupe decides nothing changed and the pane never
        // repaints.
        this.previewKey = "";
        this.schedulePreview();
        break;
      case "job:created":
        if (this.awaiting && !this.activeJobId) {
          this.activeJobId = ev.job.jobId;
        }
        break;
      case "job:step":
        // Coarse, self-overwriting status. The durable record of what happened
        // is the timeline below it, not this line.
        if (ev.jobId === this.activeJobId && this.activeTurn) {
          setTurnStatus(this.activeTurn.status, ev.step);
        }
        break;
      case "job:timeline":
      case "job:timeline:patch":
        if (ev.jobId === this.activeJobId && this.activeTurn) {
          const stick = this.atBottom();
          this.activeTurn.timeline.apply(ev);
          this.scrollTranscript(stick);
        }
        break;
      // Superseded by the timeline's text and todos items, which persist and
      // replay. Still broadcast for older clients; ignored here.
      case "job:text":
      case "job:todos":
        break;
      case "job:done":
        if (ev.jobId === this.activeJobId) {
          this.onDone(ev.bundle);
        }
        break;
      case "history":
        this.renderHistory(ev.entries);
        break;
      case "tokens:result":
        // The panel subscribes to the registry and rebuilds itself, which is
        // what `refresh()` here could not do: it re-seeds unless the element's
        // shape changed, and badges are decided at render time.
        setStaticTokens(ev.scan);
        break;
      case "models:result":
        this.catalogue = ev.catalogue;
        // The tooltip carries the model's *label*, which until now could only
        // be the raw id — the seed does not know every model a backend offers.
        this.syncAgentButton();
        // Repaint an open menu in place. Rebuilding rather than patching keeps
        // one construction path, and reopening on the same anchor is a toggle
        // as far as the host is concerned, so the old handle is dropped first.
        if (this.agentMenu) {
          this.agentMenu.close();
          this.agentMenu = null;
          // `false`: this repaint must not ask again. See `openAgentMenu`.
          this.openAgentMenu(false);
        }
        break;
      // No correlation token: the socket preserves order and the daemon answers
      // this one synchronously, so replies land in request order and the last
      // always wins. If that handler ever goes async, this needs a token.
      case "prompt:result":
        this.previewText = ev.text;
        if (this.previewOpen) {
          this.renderPreviewBody(ev.text);
        }
        break;
      case "thread":
        this.onThread(ev.rootJobId, ev.entries);
        break;
      default:
        this.onOutcome(ev);
        break;
    }
  }

  /**
   * The events whose whole job is to raise a toast. Split from `onEvent` so the
   * streaming path above stays readable as one list of job phases.
   */
  private onOutcome(ev: ServerEvent): void {
    switch (ev.type) {
      case "undo:result":
        // Two calls rather than one with a ternary on both arguments: the tone
        // is the difference between these, and a nested ternary hid it.
        if (ev.ok) {
          toast("Reverted", { icon: "rotate-ccw" });
        } else {
          toast(`Undo failed: ${ev.error ?? ""}`, { tone: "error" });
        }
        break;
      case "commit:result": {
        // A push can fail after the commit succeeded, so `error` is reported
        // even when `ok` — the commit really did land.
        const sha = ev.sha?.slice(0, 7) ?? "";
        const opts: ToastOptions =
          ev.ok && !ev.error ? { icon: "version-current" } : { tone: "error" };
        toast(
          ev.error ??
            (ev.pushed ? `Committed & pushed ${sha}` : `Committed ${sha}`),
          opts
        );
        break;
      }
      case "open:result":
        if (!ev.ok) {
          toast(`Could not open ${ev.file}: ${ev.error ?? ""}`, {
            tone: "error",
          });
        }
        break;
      case "pr:result":
        if (ev.ok && ev.url) {
          toast("Pull request opened", { icon: "version-branch" });
          window.open(ev.url, "_blank", "noopener");
        } else {
          toast(`PR ${ev.stage ?? "failed"}: ${ev.error ?? ""}`, {
            tone: "error",
          });
        }
        break;
      case "error":
        toast(ev.message, { tone: "error" });
        break;
      default:
        break;
    }
  }

  private onDone(bundle: JobDiffBundle): void {
    this.awaiting = false;
    this.sendBtn.disabled = false;
    this.syncApplyGroup();
    this.syncJobChip();
    this.reportOffscreenTurn(bundle);
    this.parentJobId = bundle.jobId;
    if (!this.activeThreadRoot) {
      this.activeThreadRoot = bundle.jobId;
    }
    this.finalizeAssistant(bundle);
    this.socket.send({ type: "history" });

    if (this.applyingVisual) {
      this.applyingVisual = false;
      /*
       * Only a turn that *landed* gets reconciled.
       *
       * `reconcileVisual` drops every preview, both delta sets and the undo
       * stack, on the reasoning that the agent's source edit plus HMR now own
       * the real DOM. That reasoning holds for `done` and for nothing else —
       * and the daemon broadcasts `job:done` for every terminal status, cancels
       * and failures included (`server/src/index.ts`). So a run that hit its
       * budget cap, errored, or was cancelled used to strip the user's pending
       * tweaks from the page, empty the change set and clear the history, with
       * no path back to work that was never written anywhere.
       *
       * Keeping them is also what makes Cancel useful: the deltas are still
       * queued, so Send tries again rather than starting from nothing.
       */
      if (bundle.status === "done") {
        this.reconcileVisual(bundle);
      } else {
        this.keepVisual(bundle.status);
      }
    }
  }

  /**
   * A visual turn that did not land. The transcript bubble already reports the
   * failure; this says the thing the bubble cannot, which is that the edits are
   * still here.
   */
  private keepVisual(status: JobDiffBundle["status"]): void {
    const pending =
      this.changeSet.count() +
      this.moveSet.count() +
      this.structureSet.count() +
      this.attrSet.count();
    if (pending === 0) {
      return;
    }
    const what = status === "cancelled" ? "Cancelled" : "Edit failed";
    toast(
      `${what}. Your ${pending === 1 ? "change is" : "changes are"} still pending`,
      {
        icon: "rotate-ccw",
      }
    );
  }

  /** Settle the streaming turn into its finished form (or append a fresh one if
   * streaming already ended), keeping the activity timeline above the result. */
  private finalizeAssistant(bundle: JobDiffBundle): void {
    const actions = this.assistantActions(bundle);
    let turn = this.activeTurn;
    if (turn) {
      this.activeTurn = null;
    } else {
      turn = assistantTurn();
      this.pushBubble(turn.root);
    }
    turn.status.remove();
    // Empty means we never streamed this job — a reconnect, or a second tab
    // watching. The bundle carries the whole log, so replay it wholesale.
    if (turn.timeline.isEmpty()) {
      turn.timeline.hydrate(bundle.timeline ?? []);
    }
    turn.timeline.setCollapsed(true);
    fillAssistant(turn.result, bundle, actions);
    this.scrollTranscript();
  }

  private assistantActions(bundle: JobDiffBundle): AssistantActions {
    const canRevert = bundle.status === "done" && bundle.diffs.length > 0;
    return {
      onBranch:
        bundle.status === "done" ? () => this.branch(bundle.jobId) : undefined,
      onComment: canRevert
        ? (file, body) => this.startComment(bundle.jobId, file, body)
        : undefined,
      onCommit: canRevert
        ? (push: boolean) => this.commit(bundle.jobId, push)
        : undefined,
      onCopyPath: canRevert ? (file) => this.copyPath(file) : undefined,
      onCreatePr: canRevert ? () => this.createPr(bundle.jobId) : undefined,
      onFollowUp: (text) => this.useFollowUp(text),
      onOpenIn: canRevert
        ? (editor, file, line) => this.openIn(editor, file, line)
        : undefined,
      onUndo: canRevert ? () => this.undo(bundle.jobId) : undefined,
    };
  }

  /** After a visual apply lands in code, drop the inline previews so the
   * HMR-updated DOM (the real code) is what's shown. */
  private reconcileVisual(bundle: JobDiffBundle): void {
    this.changeSet.clearPreviews();
    this.changeSet.clear();
    // The drag reposition was a live preview; the agent's source edit + HMR now
    // own the real DOM, so just drop tracking (don't restore the old position).
    this.moveSet.clear();
    // Same reasoning for structure, text and attributes: the agent's edit plus
    // HMR now own the real DOM, so drop tracking rather than restoring.
    this.structureSet.clear();
    this.attrSet.clear();
    this.history.clear();
    this.clearSelectionScope();
    this.stage.afterApply?.();
    if (bundle.status === "done") {
      toast("Applied. Reload if it doesn't update", { icon: "check" });
    }
  }

  private useFollowUp(text: string): void {
    this.input.value = text;
    // setLeft → afterDockToggle re-grows the field for the new value.
    this.setLeft(true);
    this.input.focus();
  }

  /** Continue from an earlier turn as a fresh attempt (SDK session fork). */
  private branch(jobId: string): void {
    this.parentJobId = jobId;
    this.forkNext = true;
    this.setLeft(true);
    toast("Branching. Type a new instruction", { icon: "version-branch" });
    this.input.focus();
  }

  private undo(jobId: string): void {
    this.socket.send({ jobId, type: "undo" });
  }

  private commit(jobId: string, push = false): void {
    this.socket.send({ jobId, push, type: "commit" });
  }

  /** Confirmed in the menu before it gets here — see `turnMenu`. */
  private createPr(jobId: string): void {
    this.socket.send({ jobId, type: "pr" });
  }

  private openIn(editor: Editor, file: string, line?: number): void {
    this.socket.send({ editor, file, line, type: "open" });
  }

  private copyPath(file: string): void {
    copyText(file, `Copied ${file}`);
  }

  /** Open the comment box for a file, pinned to the selected lines if any. */
  private startComment(jobId: string, file: string, body: HTMLElement): void {
    const anchor = body.closest<HTMLElement>(`.${cls("diff")}`) ?? body;
    const range = selectedLineRange(body);
    openCommentPopover(
      anchor,
      { file, fromLine: range?.from, toLine: range?.to },
      (text) => {
        this.commentSet.add({
          body: text,
          file,
          fromLine: range?.from,
          jobId,
          snippet: range?.text ?? "",
          toLine: range?.to,
        });
        this.setLeft(true);
        this.renderComposerChips();
        toast("Comment added. Send to apply", { icon: "tool-comment" });
      }
    );
  }

  // -- Prompt preview --------------------------------------------------------

  /**
   * The pane that shows the instruction the agent will actually receive.
   *
   * A pane in flow, not a `.drawer`. The drawer is `inset: 0` over the whole
   * dock, which is right for Past chats and wrong here: the point of this
   * surface is watching the string change as you type, and a full-dock overlay
   * would cover the field you type into. So it takes the transcript's slot and
   * leaves the head and composer exactly where they are.
   *
   * The head is built once and only the body is swapped — clearing the whole
   * pane on every result would reset `scrollTop` mid-keystroke.
   */
  private buildPreviewPane(): void {
    this.previewCountEl = el("span", { class: cls("prompt-count") });
    this.previewBodyEl = el("div", { class: cls("prompt-body") });
    this.previewEl = el(
      "div",
      { class: `${cls("pane")} ${cls("scroll-y")} ${cls("hidden")}` },
      [
        el("div", { class: cls("drawer-head") }, [
          el("div", { class: cls("eyebrow"), text: "Prompt" }),
          el("div", { class: cls("head-actions") }, [
            this.previewCountEl,
            this.iconButton("clipboard", "Copy prompt", () =>
              this.copyPrompt()
            ),
            this.iconButton("close", "Close", () => this.setPreview(false)),
          ]),
        ]),
        this.previewBodyEl,
      ]
    );
  }

  private setPreview(open: boolean): void {
    this.previewOpen = open;
    this.previewEl.classList.toggle(cls("hidden"), !open);
    this.transcriptEl.classList.toggle(cls("hidden"), open);
    this.previewBtn.classList.toggle(cls("iconbtn-on"), open);
    if (!open) {
      this.clearPreviewTimer();
      return;
    }
    // Past chats is `inset: 0` over the whole dock, so leaving it up would hide
    // the pane the user just asked for.
    this.closeHistory();
    // The pane may have been closed across a change that the dedupe would now
    // swallow, so the key starts over every time it opens.
    this.previewKey = "";
    this.renderPreviewBody(this.previewText);
    // Immediate: the debounce exists for edits, not for opening.
    this.requestPreview();
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  /**
   * Re-render the preview when the turn changes, once the edits settle.
   *
   * Every keystroke and every scrub tick lands here, and each request re-runs
   * the daemon's source resolution — which for an element the browser could not
   * source-map falls back to a walk of the project tree. That is not a thing to
   * do per keystroke.
   */
  private schedulePreview(): void {
    if (!this.previewOpen) {
      return;
    }
    this.clearPreviewTimer();
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      this.requestPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  private requestPreview(): void {
    const built = this.buildRequest();
    if (!built) {
      this.previewKey = "";
      this.renderPreviewBody(null);
      return;
    }
    // Images never reach `buildEditPrompt`, and stringifying base64 blobs on
    // every keystroke is the expensive way to learn nothing changed.
    const request = { ...built, images: undefined };
    const key = JSON.stringify(request);
    if (key === this.previewKey) {
      return;
    }
    if (!this.socket.isOpen()) {
      this.renderPreviewBody(null, "Not connected");
      return;
    }
    this.previewKey = key;
    this.socket.send({ request, type: "prompt" });
  }

  /**
   * Three states, not two: nothing to send, a request in flight, and text.
   * Showing "nothing to send yet" while a request is out would be a lie, and a
   * spinner flashing on every keystroke is worse than no spinner at all.
   */
  private renderPreviewBody(text: string | null, note?: string): void {
    if (text) {
      const chars = text.length.toLocaleString();
      this.previewCountEl.textContent = `${chars} chars`;
      const existing = this.previewBodyEl.firstElementChild;
      // Patch in place when a `<pre>` is already mounted: replacing it would
      // throw away the scroll position the user is reading from.
      if (existing instanceof HTMLPreElement) {
        existing.textContent = text;
        return;
      }
      clear(this.previewBodyEl);
      this.previewBodyEl.append(el("pre", { class: cls("prompt-text"), text }));
      return;
    }
    this.previewCountEl.textContent = "";
    clear(this.previewBodyEl);
    if (note) {
      this.previewBodyEl.append(el("div", { class: cls("meta"), text: note }));
      return;
    }
    if (this.buildRequest()) {
      this.previewBodyEl.append(
        el("div", { class: cls("meta"), text: "Assembling…" })
      );
      return;
    }
    this.previewBodyEl.append(
      emptyState({
        body: "Select an element, tweak it in the inspector, or type an instruction. The prompt the agent receives appears here.",
        title: "Nothing to send yet",
      })
    );
  }

  private copyPrompt(): void {
    if (!this.previewText) {
      return;
    }
    copyText(this.previewText, "Prompt copied");
  }

  // -- Threads / Past chats --------------------------------------------------

  private toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    this.histEl.classList.toggle(cls("hidden"), !this.historyOpen);
    if (this.historyOpen) {
      this.socket.send({ type: "history" });
    }
  }

  private closeHistory(): void {
    this.historyOpen = false;
    this.histEl.classList.add(cls("hidden"));
  }

  private renderHistory(entries: JobHistorySummary[]): void {
    if (!this.historyOpen) {
      return;
    }
    clear(this.histEl);
    this.histEl.append(
      el("div", { class: cls("drawer-head") }, [
        el("div", { class: cls("eyebrow"), text: "Past chats" }),
        this.iconButton("close", "Close", () => this.closeHistory()),
      ])
    );
    renderThreads(this.histEl, entries, {
      onOpen: (rootJobId) => this.loadThread(rootJobId),
    });
  }

  private loadThread(rootJobId: string): void {
    this.socket.send({ rootJobId, type: "thread" });
    this.closeHistory();
    this.setLeft(true);
  }

  private onThread(rootJobId: string, entries: JobDiffBundle[]): void {
    this.activeThreadRoot = rootJobId;
    const last = entries.at(-1);
    this.parentJobId = last?.jobId ?? rootJobId;
    this.forkNext = false;
    this.activeTurn = null;
    // Follow the thread's own backend. Continuing on the other one would fail
    // the server's resume gate and silently start a fresh session, so the
    // model would answer with no memory of the code being discussed.
    // Bundles written before `agent` existed are Claude by construction.
    //
    // The model follows for the same reason, one step weaker: crossing models
    // inside a thread is allowed where crossing backends is not, so a bundle
    // that predates the field simply leaves the current pick alone rather than
    // guessing one.
    //
    // Through `setAgentModel`, which is the only write that persists. This one
    // used to set the field and call `setAgent` directly, so reopening a thread
    // moved the composer for the session and a reload put it back — leaving what
    // is stored disagreeing with what the header shows. An empty model means the
    // Default row, so falling back to the current pick is what keeps a bundle
    // that predates the field from clearing one.
    if (last) {
      const agent = last.agent ?? "claude";
      this.setAgentModel(agent, last.model ?? this.models[agent] ?? "");
    }
    if (!entries.length) {
      this.clearTranscript();
      return;
    }
    clear(this.transcriptEl);
    for (const b of entries) {
      const prompt = b.prompt?.trim() ? b.prompt : "Applied visual changes";
      this.transcriptEl.append(userBubble(prompt));
      // Same construction as a live turn, so a replayed thread and a just-run
      // one are the same thing. Bundles predating the timeline hydrate to an
      // empty list and render exactly as they always did.
      const turn = assistantTurn();
      turn.status.remove();
      turn.timeline.hydrate(b.timeline ?? []);
      turn.timeline.setCollapsed(true);
      fillAssistant(turn.result, b, this.assistantActions(b));
      this.transcriptEl.append(turn.root);
    }
    this.scrollTranscript();
  }
}

/** "3 style changes + 1 move" — the parts summary shared by the composer's
 * pending-tweaks pill and the deltas-only apply user-bubble label. */
/** Keep a dock usable and never wider than half the viewport. */
function clampWidth(w: number): number {
  const max = Math.min(MAX_DOCK_W, Math.round(window.innerWidth / 2));
  return Math.round(Math.max(MIN_DOCK_W, Math.min(max, w)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.round(Math.max(lo, Math.min(hi, v)));
}

/**
 * The attributes a dock header carries once it is a drag handle.
 *
 * The `aria-label` is not decoration. dnd-kit's Accessibility plugin stamps
 * `tabindex="0"` and `role="button"` on every registered draggable, so each
 * header becomes a tab stop — and without a name of its own, its accessible name
 * is the concatenated text of every control in the row. The splitters and frame
 * labels already take the same treatment; they are just smaller, so nobody had
 * to name them.
 *
 * `data-tip` names both gestures at once. `Tooltips` resolves through
 * `closest("[data-tip]")`, so each button in the row keeps its own tip and only
 * the bare header shows this one.
 */
/**
 * What a reconnect's job snapshot says about the turn we think is in flight.
 *
 * Free and exported so the rule can be asserted directly. Standing up an
 * `AirshipApp` to check three cases would mean a socket, a dnd-kit manager, a
 * `DesignPanel` and a live document — and this is the part that has to be
 * right: answering "running" for a job that ended leaves the editor latched,
 * and answering "release" for one that is still going throws away a live turn's
 * transcript while the agent is still writing to it.
 */
export type AwaitingVerdict =
  | { jobId: string; kind: "running" }
  | { job?: JobSnapshot; kind: "release" };

export function reconcileJob(
  activeJobId: string | null,
  jobs: JobSnapshot[]
): AwaitingVerdict {
  // With no id of our own, `job:created` is precisely what we missed — and the
  // server runs edits on one chain, so at most one job is ever `running`.
  const mine = activeJobId
    ? jobs.find((job) => job.jobId === activeJobId)
    : jobs.find((job) => job.status === "running");
  return mine?.status === "running"
    ? { jobId: mine.jobId, kind: "running" }
    : { job: mine, kind: "release" };
}

/**
 * Is a dock on screen, given what the user asked for and which mode we are in?
 *
 * Free and exported so the rule can be asserted without standing up an
 * `AirshipApp` — which means a socket, a dnd-kit manager, a `DesignPanel` and a
 * live document — to check three booleans. `AirshipApp.isVisible` is the only
 * caller in the product.
 *
 * `modeScoped` is what keeps the inline overlay out of this. Edit and view mean
 * different things on the two stages: on the canvas, view mode is *about* the
 * frames and has a panel and a map of its own to put in their place, so giving
 * up the two element-scoped panels is a trade. Inline has neither, so the same
 * rule would just take the inspector away and put nothing there — the gate is
 * therefore the stage's ability to fill the gap, which is exactly what
 * `Stage.mountFramesPanel` reports.
 */
export function dockVisible(opts: {
  editing: boolean;
  modeScoped: boolean;
  open: boolean;
  side: Side;
}): boolean {
  if (!(opts.open && opts.modeScoped)) {
    return opts.open;
  }
  // The left dock stays: it is the one that has something else to show.
  return opts.side === "left" || opts.editing;
}

function dockHeadAttrs(name: string): Record<string, string> {
  return {
    "aria-label": name,
    "data-tip": "Drag to move, double-click to dock",
  };
}

/**
 * The height a panel takes when it is torn off its edge.
 *
 * Three cases, and the third is the one worth naming. A panel that was already
 * floating keeps the height it had. One torn off *expanded* keeps the height it
 * was just rendered at, so it does not resize under the cursor. But dragging a
 * **collapsed** panel measures its pill — a ~32px strip — and adopting that
 * would mean expanding it afterwards produced a panel two rows tall. The full
 * inset height is what it would have had if it had been open, which is what the
 * user is about to get back.
 */
function floatHeight(
  from: DockPlacement,
  open: boolean,
  measured: number,
  inset: number
): number {
  if (from.mode === "floating") {
    return from.h;
  }
  return clampHeight(open ? measured : window.innerHeight - 2 * inset);
}

/** Keep a floating panel taller than a header and never taller than the window. */
function clampHeight(h: number): number {
  return clamp(h, MIN_DOCK_H, window.innerHeight);
}

/**
 * Read a length token off an element, in pixels.
 *
 * Used for `--ap-space-md`, which is the dock's inset from the viewport edge and
 * is declared in the stylesheet. Reading it back beats re-declaring the number
 * in TypeScript, where it would be a second source of truth that drifts the
 * first time someone retunes the spacing scale.
 */
function readPx(node: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(node).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** A chip's label for an element: its component name, else its tag. */
function chipLabel(e: ElementContext): string {
  return e.displayName || `<${e.tagName}>`;
}

function changeSummary(
  styleCount: number,
  moveCount: number,
  structureCount = 0,
  attrCount = 0
): string {
  const parts: string[] = [];
  if (styleCount) {
    parts.push(`${styleCount} style change${styleCount === 1 ? "" : "s"}`);
  }
  if (moveCount) {
    parts.push(`${moveCount} move${moveCount === 1 ? "" : "s"}`);
  }
  if (structureCount) {
    parts.push(`${structureCount} edit${structureCount === 1 ? "" : "s"}`);
  }
  if (attrCount) {
    parts.push(`${attrCount} attribute${attrCount === 1 ? "" : "s"}`);
  }
  return parts.join(" + ") || "visual changes";
}

/**
 * Copy to the clipboard, reporting either way.
 *
 * `writeText` needs a secure context, and the overlay is injected into whatever
 * origin the dev server serves — often plain http on a LAN IP — so the failure
 * path is a real one the user has to be told about, not a formality.
 */
function copyText(text: string, okMessage: string): void {
  navigator.clipboard?.writeText(text).then(
    () => toast(okMessage, { icon: "clipboard" }),
    () => toast("Could not copy", { tone: "error" })
  );
}

/** A user-bubble label summarizing a direct-manipulation apply. */
function applyLabel(
  styleCount: number,
  moveCount: number,
  structureCount: number,
  note: string,
  attrCount = 0
): string {
  const base = `Applied ${changeSummary(styleCount, moveCount, structureCount, attrCount)}`;
  return note ? `${base}. ${note}` : base;
}
