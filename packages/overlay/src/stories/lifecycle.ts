/*
 * Teardown for stories that own more than their own DOM.
 *
 * Most of the catalogue needs nothing here: Storybook removes the node a story
 * returned, and a control that lives entirely inside it goes with it. The
 * exceptions are the ones that reach outward — `CanvasViewport.bind()` listens
 * on `window` in capture phase, `Tooltips` binds four document-level listeners
 * and mounts into the popover host, `FrameManager` writes `localStorage`, and
 * `markSelection` holds a `ResizeObserver` on a node that is about to be
 * discarded. None of those are undone by removing an element.
 *
 * A leaked listener is not a crash. It is the next story reacting to a wheel
 * event meant for a viewport that no longer exists, or a tooltip appearing over
 * a panel that never registered one — a story showing something that is not
 * true, which is the failure mode this whole catalogue is built to avoid.
 */

const pending: (() => void)[] = [];

/**
 * Register a disposer to run before the next story renders.
 *
 * Call it as soon as the thing exists, not at the end of `render`: a story that
 * throws halfway through building a canvas has already bound a viewport, and the
 * disposer registered before the throw is the only one that will ever run.
 */
export function onStoryTeardown(dispose: () => void): void {
  pending.push(dispose);
}

/**
 * Run every registered disposer, once.
 *
 * At story *entry* rather than on unmount, for the reason `preview.ts` already
 * gives for `closeOpenPopover()`: Storybook's unmount hook is not somewhere to
 * rely on for module state, and entry is idempotent and runs even when the
 * previous story crashed before it finished building.
 *
 * `splice(0)` empties the queue before running anything, so a disposer that
 * itself registers one — plausible, since these are constructors' own cleanup
 * paths — queues for the next story instead of looping here.
 */
export function runStoryTeardown(): void {
  for (const dispose of pending.splice(0)) {
    try {
      dispose();
    } catch {
      /*
       * A story that failed to clean up is not worth failing the next one over.
       * Swallowed rather than logged: this runs 96 times in a `test-browser`
       * pass, and a warning nobody can act on is noise in a log people need to
       * be able to read.
       */
    }
  }
}
