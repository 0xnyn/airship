import type { DesignToken } from "@airship/protocol/tokens";
import type { IconName } from "../../icons";
import type { NumHandle, NumSpec } from "../controls/num-field";
import type { ControlHandle, Gestures, OnChange } from "../controls/types";
import type { Descriptor } from "../descriptors";
import type { Reader } from "../gates";

/**
 * A token affordance for one field.
 *
 * `element` is always the badge, and always sits *beside* the control — it
 * never replaces it. `label` is the token's short name when the field is bound,
 * for the control to show in place of its value via `ControlHandle.setToken`.
 *
 * An earlier version returned a pill that stood in for the whole control, which
 * meant binding a property restructured its row: different height, different
 * chrome, different colour, and a grid where bound and unbound cells no longer
 * looked like the same kind of thing. Binding is a fact about where a value
 * comes from — the control that shows it should not change shape.
 */
export interface TokenSlot {
  /**
   * Bind these properties to a token, without going through the badge.
   *
   * For the one control that owns its own list: the font-family field offers
   * design-system families and installed ones from a single menu, because they
   * are one question. Everything else keeps the badge as its trigger, and this
   * seam is deliberately small — see the note below on widening it.
   */
  apply: (token: DesignToken) => void;
  bound: boolean;
  element: HTMLElement;
  /** The token's short name when bound, else null. */
  label: string | null;
  /** Open the picker, for a control that wants its own text to be the trigger. */
  open: () => void;
  /** Detach, writing the value the token was providing as a literal. */
  unlink: () => void;
}

/** How a control asks the panel for the slot covering one of its fields. */
export type TokenSlotFor = (properties: readonly string[]) => TokenSlot | null;

/*
 * The seam between `DesignPanel` and its sections.
 *
 * `panel.ts` reached 3,800 lines and thirteen section renderers, and the
 * sections were never the reason: each one is a pure function of a node and a
 * handful of the panel's services. This interface is that handful, and it is
 * deliberately small — if a section needs something not on it, that is a signal
 * about the design of the section rather than a reason to widen the seam.
 *
 * `DesignPanel` implements it as one private field literal, the same pattern
 * `this.gestures` already used to hand its history brackets to a control.
 */
export interface SectionContext {
  /** Build the control a descriptor asks for, seeded from the selection. */
  buildControl: (
    descriptor: Descriptor,
    node: Element,
    after?: () => void
  ) => ControlHandle;
  /**
   * A `[swatch][hex][alpha]` row, bracketed and registered.
   *
   * `node` and `properties` are what the row writes, and are optional only so a
   * row with no property behind it stays expressible. Passing them is what
   * gives the row a token affordance — without it a colour has no way to reach
   * the project's palette, which is the scale people reach for most.
   */
  colorRow: (
    value: string,
    tip: string,
    onChange: (next: string) => void,
    node?: Element,
    properties?: readonly string[]
  ) => HTMLElement;
  /** One cell of the two-column field grid. */
  fieldCell: (descriptor: Descriptor, node: Element) => HTMLElement;
  /** Flash a node the panel just edited on its owner's behalf (a flex parent). */
  flash: (node: Element) => void;
  /**
   * How to read a property when deciding whether a control should exist:
   * the pending edit if there is one, else computed style.
   *
   * Only for *gates*. A control's displayed value still comes from `seed`,
   * which reads the DOM — the preview is already applied there, so the two
   * agree. What they must not agree on is a value the DOM refused: a gate that
   * believed computed style alone would delete the row whose own edit had just
   * failed to paint.
   */
  gate: (node: Element) => Reader;
  /** Brackets a continuous gesture into one undo step. */
  gestures: Gestures;
  /** A small ghost button for a section header. */
  headerAction: (
    iconName: IconName,
    tip: string,
    onClick: () => void
  ) => HTMLElement;
  /** A bespoke numeric field, registered so the panel can re-seed it. */
  numControl: (
    spec: NumSpec,
    initial: string,
    onCommit: (css: string) => void,
    properties: readonly string[],
    read?: (value: string, property: string) => string
  ) => NumHandle;
  /**
   * Write an HTML attribute. `null` removes it.
   *
   * Separate from `onChange` because an attribute is not a declaration: it
   * lands in `AttrSet` rather than `ChangeSet`, ships in its own array, and is
   * described to the agent as a JSX prop rather than a style.
   */
  onAttr: (node: Element, attribute: string, value: string | null) => void;
  /** Preview + record one declaration on the selection. */
  onChange: OnChange;
  /** Preview + record on an arbitrary node — the alignment row writes to the parent. */
  recordOn: (node: Element, cssProperty: string, value: string) => void;
  /** Re-pin the selection outline after an edit that moved or resized the node. */
  redrawOutline: () => void;
  /** Re-seed, or rebuild if the selection's shape changed. */
  refresh: () => void;
  /** Mount a control so `setValue` and the re-seed pass can reach it. */
  register: (control: ControlHandle) => void;
  /**
   * A repaint that owns what it builds.
   *
   * Several sections rebuild one block in place rather than asking for a whole
   * panel rebuild — the stroke rows when the border style changes, Size's
   * min/max grid, the grid tracks, the constraints anchor. Each of them calls
   * `colorRow`, `fieldCell` or `register` again on every run, and none of them
   * unregistered what it had replaced: after N repaints the panel held N copies
   * of each control, `reseed` wrote into detached DOM, and `renderBody`'s
   * teardown ran `destroy()` on all of them.
   *
   * Returns a runner. Each call disposes the controls the previous call
   * registered, then runs the paint and adopts whatever it registers.
   * `row-list.ts`'s `disposeRows` is the same idea, scoped to one control.
   */
  repaintScope: () => (paint: () => void) => void;
  /** Full clear-and-rebuild. For changes of *shape*, not of value. */
  rerender: () => void;
  /** Push freshly-computed values into every mounted control. */
  reseed: () => void;
  /** A collapsible section, keyed on a stable id. */
  section: (
    id: string,
    label: string,
    body: HTMLElement,
    opts?: {
      actions?: HTMLElement[];
      /** Settled open/closed, including once on first render — lets a section
       * defer expensive content until someone asks for it. */
      onToggle?: (open: boolean) => void;
      /** Closed on first render only; the user's choice wins thereafter. */
      startCollapsed?: boolean;
    }
  ) => HTMLElement;
  /** The primary's value, or `Mixed` when the rest of the selection disagrees. */
  seed: (node: Element, property: string, fallback: string) => string;
  /** Padding or margin, as the pair-with-a-switch-to-four. */
  spacingControl: (node: Element, group: "padding" | "margin") => ControlHandle;
  /**
   * The design-token affordance for the properties one field writes, or null
   * when the project declares no tokens that could apply.
   *
   * `bound` says which it is: a pill *replacing* the field's value, or a badge
   * sitting beside it. Controls that build bespoke fields — colours, sizes,
   * paired longhands — take this as a `tokenSlot` in their spec and render one
   * or the other per field.
   *
   * A set of properties rather than one, because the panel's paired controls
   * write several longhands from a single input.
   */
  tokenSlot: (node: Element, properties: readonly string[]) => TokenSlot | null;
}
