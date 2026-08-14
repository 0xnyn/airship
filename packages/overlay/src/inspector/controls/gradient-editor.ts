/**
 * The visual gradient editor: a stop bar, a colour per stop, and an angle.
 *
 * Opened from the fill layer's glyph, *beside* the raw CSS field rather than
 * instead of it. That is the whole design: the text field stays authoritative
 * and can express things this cannot (colour hints, exotic colour spaces), and
 * a gradient the parser declines to model simply does not offer the button.
 */
import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { closeOpenPopover, openPopover } from "../../popover-host";
import type { Descriptor } from "../descriptors";
import {
  angleOf,
  barCss,
  formatGradient,
  type Gradient,
  type GradientKind,
  type GradientStop,
  interpolate,
  normalizeAngle,
  parseGradient,
  reverse,
  sortedStops,
  stopFraction,
  withAngle,
} from "../gradient";
import { createColorRow } from "./color-picker";
import { createNumField } from "./num-field";
import { createSegmented } from "./segmented";
import type { Gestures } from "./types";

/** How close a click has to land to grab an existing stop rather than add one. */
const GRAB_RADIUS_PX = 20;
/** CSS requires two; below that it is a solid colour, not a gradient. */
const MIN_STOPS = 2;
/** Shift-arrow on the angle field, matching every design tool's 15° detent. */
const ANGLE_COARSE_STEP = 15;

export interface GradientEditorOptions {
  gestures?: Gestures;
  /** The realm a stop colour resolves against. See `ColorRowOptions.node`. */
  node?: Element | null;
  onChange: (css: string) => void;
  /** The gradient's current CSS text. */
  value: string;
}

/** True when the value is a gradient this editor can safely open. */
export function canEditGradient(value: string): boolean {
  return parseGradient(value) !== null;
}

export function openGradientEditor(
  anchor: HTMLElement,
  opts: GradientEditorOptions
): void {
  const initial = parseGradient(opts.value);
  if (!initial) {
    return;
  }
  let gradient = initial;
  let selected = 0;

  const content = el("div", { class: cls("grad-edit") });
  const handle = openPopover({
    anchor,
    // The stem, not `cls(...)` — the host prefixes it (popover-host.ts:126).
    className: "pop-grad",
    content,
    /*
     * Dispose the *last* generation of controls when the editor closes.
     *
     * `paint` tears down the generation it replaces, so every generation but the final
     * one was cleaned up — and that last one kept its `createColorRow` and
     * `createNumField` registrations, each still answering dnd-kit hit-tests from
     * detached DOM, and each holding whatever gesture bracket was open. There was no
     * `onClose` at all.
     */
    onClose: () => {
      for (const dispose of mounted) {
        dispose();
      }
      mounted = [];
    },
  });

  const commit = (next: Gradient): void => {
    gradient = next;
    opts.onChange(formatGradient(gradient));
    paint();
  };

  /*
   * Everything the current paint mounted, torn down before the next one.
   *
   * `paint` runs on every commit and replaces the whole subtree, and the number
   * fields and colour rows inside it each hold a dnd-kit `Draggable` in the
   * shared registry plus a gesture bracket. Nothing was destroying them, so a
   * drag of one stop leaked a registration per pointermove — each still
   * answering hit-tests from a detached element. `paint.ts` and
   * `sections/filters.ts` already dispose the same way; this did not.
   */
  let mounted: (() => void)[] = [];
  const track = (dispose: () => void): void => {
    mounted.push(dispose);
  };

  const paint = (): void => {
    for (const dispose of mounted) {
      dispose();
    }
    mounted = [];
    content.replaceChildren(
      kindRow(gradient, commit),
      stopBar(gradient, selected, {
        onAdd: (fraction) => {
          const stop: GradientStop = {
            color: interpolate(gradient, fraction, opts.node),
            position: `${Math.round(fraction * 100)}%`,
          };
          const stops = [...gradient.stops, stop];
          selected = stops.length - 1;
          commit({ ...gradient, stops });
        },
        onMove: (index, fraction) => {
          const stops = gradient.stops.map((s, i) =>
            i === index
              ? {
                  ...s,
                  position: `${Math.round(fraction * 100)}%`,
                  positionEnd: undefined,
                }
              : s
          );
          commit({ ...gradient, stops });
        },
        onSelect: (index) => {
          selected = index;
          paint();
        },
      }),
      // `opts.gestures` so an angle drag is one undo step, as `stopList`'s fields
      // already are — without it a 40-degree drag left ~40 entries in the history.
      angleRow(gradient, commit, track, opts.gestures),
      stopList(
        gradient,
        selected,
        opts.gestures,
        track,
        {
          onEdit: (index, stop) => {
            const stops = gradient.stops.map((s, i) =>
              i === index ? stop : s
            );
            commit({ ...gradient, stops });
          },
          onRemove: (index) => {
            if (gradient.stops.length <= MIN_STOPS) {
              return;
            }
            const stops = gradient.stops.filter((_, i) => i !== index);
            selected = Math.min(selected, stops.length - 1);
            commit({ ...gradient, stops });
          },
          onSelect: (index) => {
            selected = index;
            paint();
          },
        },
        opts.node
      )
    );
    handle.reposition();
  };

  paint();
}

/**
 * The type switch, as a real segmented group.
 *
 * It was hand-built from `ctl-seg-btn` children inside a bare flex row, which
 * borrowed the cells but not the control: no track background, no radius, and
 * — because `data-variant="icon"` is set by `createSegmented`, not by the CSS —
 * none of the 24px sizing that makes every other icon group in the panel square.
 */
const KIND_DESCRIPTOR: Descriptor = {
  controlType: "segmented",
  cssProperty: "background-image",
  defaultValue: "linear",
  enumValues: [
    { icon: "gradient-linear", label: "Linear", value: "linear" },
    { icon: "gradient-radial", label: "Radial", value: "radial" },
    { icon: "gradient-angular", label: "Conic", value: "conic" },
  ],
  group: "appearance",
  key: "gradient-kind",
  label: "Gradient type",
};

/** Type switch, plus reverse and rotate. */
function kindRow(
  gradient: Gradient,
  commit: (next: Gradient) => void
): HTMLElement {
  const kinds = createSegmented(
    KIND_DESCRIPTOR,
    gradient.kind,
    () => undefined,
    {
      onSelect: (value) => {
        // Geometry is per-kind — an angle means nothing to a radial, and a
        // `circle at 50%` means nothing to a linear. Dropping it lets CSS apply
        // the new kind's default rather than emitting something invalid.
        commit({ ...gradient, geometry: "", kind: value as GradientKind });
      },
    }
  );

  return el("div", { class: cls("grad-kinds") }, [
    kinds.element,
    el("div", { class: cls("grad-acts") }, [
      action("rotate-ccw", "Reverse", () => commit(reverse(gradient))),
      action("rotation", "Rotate 45°", () => {
        const current = angleOf(gradient);
        if (current !== null) {
          commit(withAngle(gradient, current + 45));
        }
      }),
    ]),
  ]);
}

function action(
  glyph: "rotate-ccw" | "rotation",
  label: string,
  onClick: () => void
): HTMLElement {
  const button = el("button", {
    "aria-label": label,
    class: cls("row-icon"),
    "data-tip": label,
    onClick,
    type: "button",
  });
  button.append(icon(glyph, "xs"));
  return button;
}

interface BarHandlers {
  onAdd: (fraction: number) => void;
  onMove: (index: number, fraction: number) => void;
  onSelect: (index: number) => void;
}

/**
 * The stop bar.
 *
 * Hit-testing is geometric against the bar rather than per-handle: the handles
 * are `pointer-events: none`, so a click 3px off a stop still grabs it. Drag
 * listeners go on the document so the gesture survives leaving the bar, which
 * is what makes dragging a stop to 0% or 100% possible at all.
 */
function stopBar(
  gradient: Gradient,
  selected: number,
  handlers: BarHandlers
): HTMLElement {
  const wrap = el("div", { class: cls("grad-bar-wrap") });
  const bar = el("div", { class: cls("grad-bar") });
  bar.style.backgroundImage = barCss(gradient);
  wrap.append(bar);

  const fractionAt = (clientX: number): number => {
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const nearest = (clientX: number): number | null => {
    const rect = bar.getBoundingClientRect();
    const target = fractionAt(clientX);
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    gradient.stops.forEach((stop, i) => {
      const distance = Math.abs(
        stopFraction(stop, i, gradient.stops.length) - target
      );
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return bestDistance * rect.width < GRAB_RADIUS_PX ? best : null;
  };

  gradient.stops.forEach((stop, i) => {
    const chit = el("span", { class: cls("grad-stop") });
    chit.style.left = `${stopFraction(stop, i, gradient.stops.length) * 100}%`;
    chit.style.setProperty("--stop-color", stop.color);
    if (i === selected) {
      chit.dataset.on = "";
    }
    wrap.append(chit);
  });

  wrap.addEventListener("pointerdown", (e) => {
    const index = nearest(e.clientX);
    if (index === null) {
      handlers.onAdd(fractionAt(e.clientX));
      return;
    }
    /*
     * Measured against `wrap`, and `wrap` is captured before anything repaints.
     *
     * `onSelect` triggers a repaint, which `replaceChildren`es this whole subtree away
     * — so the closure below used to measure a **detached** `bar`:
     * `getBoundingClientRect()` returned all zeros, `(clientX - 0) / 0` was `Infinity`,
     * and the clamp turned that into `1`. Every stop drag therefore snapped the stop to
     * 100% on its first pointermove and pinned it there, which left typing as the only
     * way to position a stop at all.
     *
     * The rect is taken once, here, from the element that is still in the document.
     * That is also better behaviour: the drag keeps the geometry it started with rather
     * than re-measuring a bar that may have moved under it.
     */
    const rect = wrap.getBoundingClientRect();
    const fractionInRect = (clientX: number): number =>
      rect.width > 0
        ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        : 0;
    handlers.onSelect(index);

    /*
     * Pointer capture, and a teardown for every way a gesture can end.
     *
     * `pointerup` alone left the listeners on `document` for the rest of the session
     * whenever the gesture was *cancelled* — a touch interruption, an OS gesture, a
     * context menu — after which the stop followed the cursor with no button held, and
     * a second pointerdown stacked another pair on top. `color-picker.ts` already had
     * this right; this is the same three events.
     */
    const move = (ev: PointerEvent): void =>
      handlers.onMove(index, fractionInRect(ev.clientX));
    const end = (): void => {
      document.removeEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        document.removeEventListener(type, end);
      }
    };
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      // No capture available (a synthetic event in a test); the document listeners
      // below are the fallback that made this work before capture was added.
    }
    document.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      document.addEventListener(type, end);
    }
  });

  return wrap;
}

function angleRow(
  gradient: Gradient,
  commit: (next: Gradient) => void,
  track: (dispose: () => void) => void,
  gestures?: Gestures
): HTMLElement {
  const degrees = angleOf(gradient);
  const row = el("div", { class: cls("grad-angle") });
  row.append(el("span", { class: cls("row-label"), text: "Angle" }));

  if (degrees === null) {
    // A radial gradient has no angle. Shown and disabled rather than hidden, so
    // the row does not appear and disappear as the type changes.
    const dash = el("span", { class: cls("grad-na"), text: "—" });
    dash.dataset.tip = "A radial gradient has no angle";
    row.append(dash);
    return row;
  }

  /*
   * A real field, not a bare `.ctl-input`.
   *
   * `.ctl-input` is the borderless inner input of `.ctl-num`; on its own it has
   * no height, no radius, no hover or focus chrome and no accessible name —
   * everything that makes a field look like one lives on the wrapper. Going
   * through `createNumField` also buys the scrub handle, the ⇧-arrow coarse
   * step, and Enter/Escape commit-revert for free, all of which this had been
   * re-implementing by hand.
   */
  const field = createNumField(
    {
      bigStep: ANGLE_COARSE_STEP,
      glyph: "rotation",
      label: "Angle",
      step: 1,
      suffix: "°",
      unit: "deg",
    },
    `${degrees}deg`,
    (css) => {
      const parsed = Number.parseFloat(css);
      if (Number.isFinite(parsed)) {
        commit(withAngle(gradient, normalizeAngle(parsed)));
      }
    },
    gestures
  );
  track(field.destroy);
  row.append(field.element);
  return row;
}

interface StopHandlers {
  onEdit: (index: number, stop: GradientStop) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
}

/** One row per stop: colour, position, remove. Listed in rendered order. */
function stopList(
  gradient: Gradient,
  selected: number,
  gestures: Gestures | undefined,
  track: (dispose: () => void) => void,
  handlers: StopHandlers,
  node?: Element | null
): HTMLElement {
  const list = el("div", { class: cls("grad-stops") });
  const order = sortedStops(gradient);

  for (const stop of order) {
    // Index in the *authored* array, which is what the handlers address.
    const index = gradient.stops.indexOf(stop);
    const row = el("div", { class: cls("grad-stop-row") });
    if (index === selected) {
      row.dataset.on = "";
    }
    row.addEventListener("pointerdown", () => handlers.onSelect(index));

    const color = createColorRow({
      gestures,
      node,
      onChange: (next) => handlers.onEdit(index, { ...stop, color: next }),
      tip: "Stop color",
      value: stop.color,
    });
    const position = createNumField(
      { label: "Position", max: 100, min: 0, suffix: "%", unit: "%" },
      stop.position ||
        `${Math.round(stopFraction(stop, index, gradient.stops.length) * 100)}%`,
      (css) =>
        handlers.onEdit(index, {
          ...stop,
          position: css,
          // A typed position replaces a band; keeping `positionEnd` would leave
          // the stop spanning from the new value to a stale one.
          positionEnd: undefined,
        }),
      gestures
    );
    track(color.destroy);
    track(position.destroy);

    const remove = el("button", {
      "aria-label": "Remove stop",
      class: `${cls("row-icon")} ${cls("grad-del")}`,
      "data-tip":
        gradient.stops.length <= MIN_STOPS
          ? "A gradient needs at least two stops"
          : "Remove stop",
      type: "button",
    }) as HTMLButtonElement;
    remove.disabled = gradient.stops.length <= MIN_STOPS;
    remove.append(icon("minus", "xs"));
    remove.addEventListener("click", () => handlers.onRemove(index));

    row.append(color.element, position.element, remove);
    list.append(row);
  }
  return list;
}

/** Close any open editor — the panel calls this before a rebuild. */
export function closeGradientEditor(): void {
  closeOpenPopover("anchor-gone");
}
