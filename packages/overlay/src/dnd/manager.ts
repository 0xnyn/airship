import {
  type Collision,
  CollisionPriority,
  CollisionType,
  type Plugins,
} from "@dnd-kit/abstract";
import {
  DragDropManager,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";

export {
  type DragEndEvent,
  Draggable,
  type DragMoveEvent,
  type DragStartEvent,
  Droppable,
} from "@dnd-kit/dom";

/**
 * Pointer travel (px) before a press becomes a drag. Matches the threshold the
 * hand-rolled controllers used, so a press still falls through as a plain click.
 */
export const DRAG_THRESHOLD = 4;

/** Structurally identical to dnd-kit's, kept local so we don't depend on a
 * package that is only a transitive dependency here. */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Drag surfaces, kept apart by `type` / `accept` so one manager can host all of
 * them without cross-talk. Only `canvasNode` and `treeRow` have drop targets;
 * the rest are transform-only drags that read `operation.transform`.
 */
export const DND = {
  canvasNode: "airship:canvas-node",
  /** Dragging a dock's header — or its collapsed pill — to float or move it. */
  dockMove: "airship:dock-move",
  /** Dragging a frame's edge or corner grip to resize the frame itself. */
  frameGrip: "airship:frame-grip",
  /** Dragging a frame's title bar to reposition it on the canvas. */
  frameMove: "airship:frame-move",
  /** Dragging a row of the frame list to restack the frames. */
  frameRow: "airship:frame-row",
  resizeHandle: "airship:resize-handle",
  scrub: "airship:scrub",
  splitter: "airship:splitter",
  treeRow: "airship:tree-row",
} as const;

/**
 * One manager for the whole overlay. A drag operation is singular and these
 * interactions are mutually exclusive, so sharing it gives every surface the
 * same sensors, auto-scroll, Escape-to-cancel and screen-reader announcements.
 * The default preset supplies the Accessibility, AutoScroller, Cursor, Feedback,
 * PreventSelection, ScrollListener, Scroller and StyleInjector plugins.
 */
export const manager = new DragDropManager({
  sensors: [
    PointerSensor.configure({
      activationConstraints: [
        new PointerActivationConstraints.Distance({ value: DRAG_THRESHOLD }),
      ],
    }),
    KeyboardSensor,
  ],
});

/**
 * Per-entity feedback presets.
 *
 * `feedback: 'none'` is **not** usable on anything that needs a drop target: the
 * Feedback plugin is what publishes `dragOperation.shape`, and the collision
 * observer returns early when that shape is null — so a 'none' draggable never
 * produces a single collision. Transform-only drags (resize, scrub, splitter)
 * have no droppables and want 'none', since translating the element you are
 * resizing would be nonsense.
 */
export const FEEDBACK = {
  /** Drag a clone; the original stays put behind a placeholder. */
  clone: [Feedback.configure({ feedback: "clone" })] as Plugins,
  /** Move the real element with the cursor; nothing is inserted into the DOM. */
  move: [Feedback.configure({ feedback: "move" })] as Plugins,
  /** No visual feedback — the handler owns all rendering. */
  none: [Feedback.configure({ feedback: "none" })] as Plugins,
};

/**
 * Sensors for a draggable that must not offer a keyboard drag.
 *
 * A `feedback: "none"` draggable **cannot** be dragged by keyboard, and the
 * failure is silent and hostile. `KeyboardSensor.handleMove` returns early on
 * `!shape`, and the only thing that ever sets `dragOperation.shape` is the
 * Feedback plugin — which returns before that line for `feedback: "none"`. So
 * the sensor still *starts* a drag on Space and still ends one on Space, Enter
 * or Tab, but every arrow key in between does nothing at all.
 *
 * What the user gets is worse than "nothing happens": the row latches into its
 * dragging state, the Accessibility plugin has already announced the handle as
 * `aria-roledescription="draggable"`, and the sensor's document-capture listener
 * calls `preventDefault` on Tab — so the one key that should let you leave ends
 * the phantom drag *and* eats the focus move. Unregistering the sensor for these
 * draggables is what stops a promise being made that nothing can keep; the
 * keyboard route is then a real one, next to the drag rather than pretending to
 * be it (see `FramesPanel.moveBy`, and `num-field.ts`'s `stepBy` beside its
 * scrub).
 *
 * The pointer constraint has to be restated because a per-draggable `sensors`
 * array *replaces* the manager's list rather than extending it — omitted, every
 * press on a handle would begin a drag with no threshold at all.
 */
export const POINTER_ONLY = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: DRAG_THRESHOLD }),
    ],
  }),
];

/**
 * Cumulative pointer delta for a transform-only drag (resize grip, scrub, dock
 * splitter).
 *
 * `event.operation.transform` looks like the obvious source and is a trap: the
 * snapshot serves a value that is only recomputed when something *reads*
 * `dragOperation.transform`, and the only thing that ever does is the Feedback
 * plugin — which returns early for `feedback: 'none'`. Every transform-only
 * drag would therefore see `{x: 0, y: 0}` for its entire lifetime.
 *
 * Tracking the sensor's own coordinates also sidesteps a one-frame lag:
 * `dragmove` is dispatched *before* `position.current` is updated, which happens
 * in a microtask afterwards.
 */
export class DragDelta {
  private origin = { x: 0, y: 0 };
  private point = { x: 0, y: 0 };

  /**
   * The live pointer position. Collision detectors must hit-test against this
   * rather than `dragOperation.position.current`, which is a step behind: the
   * manager assigns it in a microtask *after* `dragmove` is dispatched, so a
   * detector triggered from a `dragmove` handler would resolve its drop target
   * from the previous pointer position — far enough off, on a fast drag, to
   * land the drop in a completely different container.
   */
  get pointer(): Coordinates {
    return this.point;
  }

  /** Latch the drag origin. Call from `dragstart`. */
  start(): void {
    const { x, y } = manager.dragOperation.position.current;
    this.origin = { x, y };
    this.point = { x, y };
  }

  /**
   * Delta from the origin. The pointer sensor reports an absolute `to`, the
   * keyboard sensor a relative `by`, so both are folded in here.
   */
  update(e: { by?: Coordinates; to?: Coordinates }): Coordinates {
    if (e.to) {
      this.point = { x: e.to.x, y: e.to.y };
    } else if (e.by) {
      this.point = { x: this.point.x + e.by.x, y: this.point.y + e.by.y };
    }
    return { x: this.point.x - this.origin.x, y: this.point.y - this.origin.y };
  }
}

/**
 * Tracks dnd-kit entities so a group can be torn down together. The inspector
 * re-renders by clearing and rebuilding its body, so entities bound to a row
 * must be destroyed before the next render — otherwise the registry fills with
 * detached elements that still answer collision queries.
 */
export class DndScope {
  private entities: { destroy: () => void }[] = [];

  add<T extends { destroy: () => void }>(entity: T): T {
    this.entities.push(entity);
    return entity;
  }

  clear(): void {
    for (const entity of this.entities) {
      entity.destroy();
    }
    this.entities = [];
  }
}

/**
 * A `Collision` carrying a resolved drop descriptor. Our detectors hit-test the
 * pointer against the live DOM rather than intersecting the dragged shape,
 * hence the PointerIntersection type; Highest priority keeps a hand-resolved
 * target ahead of anything a built-in algorithm might turn up.
 */
export function hit(id: string, value = 1): Collision {
  return {
    id,
    priority: CollisionPriority.Highest,
    type: CollisionType.PointerIntersection,
    value,
  };
}

/** True while the shared manager has a live drag in flight. */
export function isDragging(): boolean {
  return manager.dragOperation.status.dragging;
}
