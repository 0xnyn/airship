/** A mounted inspector control. */
export interface ControlHandle {
  /** Release anything bound outside the element (e.g. a dnd-kit draggable). */
  destroy?: () => void;
  element: HTMLElement;
  /**
   * What a click on the control's own value does once it cannot be edited.
   *
   * A bound field shows a token name, and the name is the obvious thing to
   * click to change it — leaving the 20px badge beside it as the only way in
   * makes the headline of the decision inert.
   */
  onActivate?: (open: () => void) => void;
  /**
   * The CSS properties this control displays.
   *
   * Lets the panel re-seed it from computed style without tearing the whole
   * body down — which is what an undo, or a resize-handle drag, actually needs.
   * Optional: a control that omits it simply is not re-seeded, which is the
   * behaviour every control had before this existed.
   *
   * A control whose display is *derived* rather than mirrored — Position's X/Y
   * are a measurement, not a property — lists the properties that can change
   * the measurement and re-measures in `setValue`, ignoring the value passed.
   */
  properties?: readonly string[];
  /**
   * Re-read whatever this control displays, from wherever it actually lives.
   *
   * For controls whose value is not a CSS property, so `setValue` can never be
   * handed it: the HTML attribute fields (`alt`, `poster`) and the attribute
   * dropdowns read the element's own markup. Those were unreachable from the
   * refresh pass entirely, so an undo — or an agent edit — left them showing text
   * the element no longer has, and blurring the field re-committed the stale value.
   *
   * Called on every re-seed, `virtual` or not.
   */
  resync?: () => void;
  /**
   * Show a design token in place of the value, or `null` to show the value.
   *
   * The control keeps its shape — same chrome, same height, same glyph — and
   * only what it *reads* changes. An earlier version swapped the whole control
   * out for a pill when a token was bound, which meant binding a property
   * visibly restructured the row: a panel with three bound properties had three
   * controls that no longer looked like the ones around them. The binding is a
   * fact about where the value comes from, not a different kind of control.
   *
   * Optional: a control with nothing text-shaped to put a name in (a segmented
   * group) simply does not implement it, and shows the lit badge alone.
   */
  setToken?: (name: string | null) => void;
  /** Reflect an externally-changed value into the control's display. */
  setValue: (cssProperty: string, value: string) => void;
  /**
   * This control's `properties` are not real CSS — they name *panel* state.
   *
   * The Scope and State selects write `--scope` / `--state`, and the media
   * section's attribute dropdowns write `--attr-loading` and friends; the
   * convention is spelled out in `descriptors.ts`. They are registered so the
   * panel can tear them down and reach them by name, but they must be left out of
   * the re-seed pass: no CSS property carries their value, so reading the DOM for
   * one returns `""` and `createSelect` then relabels the control to whichever
   * option has the empty value.
   *
   * That was a live bug with teeth. Set Scope to `.btn`, press an arrow key, and
   * the dropdown went back to reading "This element" while `editTarget.scope` was
   * untouched — so the next padding edit still wrote to all fourteen buttons,
   * which `sections/scope.ts` calls "the single most confusing thing this inspector
   * could do".
   */
  virtual?: boolean;
}

/** Fired whenever the user edits a control (including live during a drag). */
export type OnChange = (cssProperty: string, value: string) => void;

/**
 * Brackets a continuous gesture so it becomes one undo step rather than one per
 * pointermove. Threaded to any control that drags — `DesignPanel` supplies its
 * own `beginGesture`/`endGesture`, which open and close a `History` batch.
 *
 * Optional throughout: a control that only commits discrete values does not
 * need it, and a control that drags is safe without it, just noisy in the undo
 * stack.
 */
export interface Gestures {
  begin?: () => void;
  end?: () => void;
}
