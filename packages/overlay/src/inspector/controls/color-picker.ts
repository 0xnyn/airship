/*
 * The overlay's colour control: an inline row, and the picker behind its swatch.
 *
 * This replaces two near-identical implementations — `colorRow` in `paint.ts`
 * (Fill, Stroke, Effects) and `createColorSwatch` here (the Text → Colour
 * descriptor) — which had drifted apart to the point of parsing hex differently.
 * Both opened the native `<input type="color">`, which hands the user an OS
 * dialog with no alpha, no eyedropper and no memory of what they just picked.
 *
 * Two entry points, one implementation: `createColorRow` for the hand-built
 * sections and `createColorControl` for the descriptor pipeline.
 */
import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { clamp01 } from "../../num";
import { openPopover, type PopoverHandle } from "../../popover-host";
import {
  alphaOf,
  formatColor,
  hsvToRgb,
  isHexColor,
  isParseableColor,
  opaque,
  parseColor,
  type RGBA,
  rgbToHsl,
  rgbToHsv,
  withAlpha,
} from "../css-value";
import type { Descriptor } from "../descriptors";
import { MIXED } from "../mixed";
import {
  onRecentColorsChange,
  pushRecentColor,
  recentColors,
} from "../recent-colors";
import { bindField, createNumField, createTextField } from "./num-field";
import type { ControlHandle, Gestures, OnChange } from "./types";

/** The hex field shows and accepts bare digits; the `#` is chrome. */
const LEADING_HASH = /^#/;

type Mode = "hex" | "rgb" | "hsl";

/** The order the format button cycles through. */
/** Which way an arrow key moves a slider. */
const ARROW_DELTA: Record<string, number> = {
  ArrowDown: -1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

const MODE_CYCLE: readonly Mode[] = ["hex", "rgb", "hsl"];

interface HSVA {
  a: number;
  h: number;
  s: number;
  v: number;
}

export interface ColorRowOptions {
  /** Brackets a slider drag into one undo step. See `Gestures`. */
  gestures?: Gestures;
  /**
   * The element the colour belongs to, naming the realm it resolves against.
   *
   * A `var()` or a named colour is read by `parseColor`'s engine probe, and a
   * probe in the wrong document answers about the wrong `--brand`: a canvas
   * frame's colour resolved against the overlay shell, where the custom property
   * is undefined, so the swatch painted the shell's inherited colour and the
   * next edit wrote that back into the frame. Optional because a row can edit a
   * colour that belongs to no element yet — a gradient stop being composed.
   */
  node?: Element | null;
  onChange: (next: string) => void;
  tip?: string;
  value: string;
}

export interface ColorRowHandle {
  destroy: () => void;
  element: HTMLElement;
  /** What a click on the bound hex slot does — open its picker. */
  onActivate: (open: () => void) => void;
  /** Show a design token in place of the hex. See `ControlHandle.setToken`. */
  setToken: (name: string | null) => void;
  setValue: (css: string) => void;
}

// -- Row ----------------------------------------------------------------------

/**
 * `[swatch][hex][alpha %]`, with the picker behind the swatch.
 *
 * Opacity folds into the colour's alpha rather than writing the `opacity`
 * property, which would fade the element's children too — a design tool's fill opacity
 * is the alpha of that one paint and `rgb(r g b / a)` is its exact equivalent.
 */
export function createColorRow(opts: ColorRowOptions): ColorRowHandle {
  let current = opts.value;
  let picker: PickerHandle | null = null;

  const swatch = el("button", {
    "aria-label": opts.tip ?? "Fill colour",
    class: cls("ctl-swatch"),
    "data-tip": opts.tip ?? "Fill colour",
    type: "button",
  });

  const hex = el("input", {
    "aria-label": "Hex",
    class: cls("ctl-input"),
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;

  /*
   * The alpha field is a real number field: 0–100, scrubbable from its own
   * suffix-side glyph slot, and unable to accept a letter. It used to be a bare
   * text input that took "banana" and reverted on blur.
   *
   * `unit: ""` because the value is a bare percentage of the *colour*, not a
   * CSS length — the `%` is a suffix in the chrome, not part of anything that
   * gets written. What lands in the source is the alpha channel of an
   * `rgb(r g b / a)`.
   */
  const alpha = createNumField(
    {
      fieldKey: "fill-alpha",
      label: "Opacity",
      max: 100,
      min: 0,
      step: 1,
      suffix: "%",
      unit: "",
    },
    "100",
    (css) => commitPct(Number.parseFloat(css)),
    opts.gestures
  );
  alpha.element.classList.add(cls("paint-pct"));

  function paintSwatch(css: string): void {
    const mixed = !isParseableColor(css, opts.node);
    swatch.toggleAttribute("data-mixed", mixed);
    // Two background layers: the colour over a checkerboard, so alpha is
    // legible without a wrapper element. A 40% fill used to read as an
    // ambiguous dark square against the panel.
    swatch.style.backgroundImage = mixed
      ? ""
      : `linear-gradient(${css}, ${css}), var(--${cls("checker")})`;
  }

  /** The token standing in for this paint, if any. See `setToken`. */
  let boundToken: string | null = null;
  /** What clicking the bound hex slot does. See `onActivate`. */
  let openBound: (() => void) | null = null;

  function reflect(css: string): void {
    current = css;
    // The swatch repaints either way: a token name says which colour was
    // chosen, not what it looks like.
    paintSwatch(css);
    if (boundToken !== null) {
      return;
    }
    if (isParseableColor(css, opts.node)) {
      hex.value = opaque(css, opts.node)
        .replace(LEADING_HASH, "")
        .toUpperCase();
      alpha.setValue(String(Math.round(alphaOf(css, opts.node) * 100)));
    } else {
      hex.value = "";
      hex.placeholder = MIXED;
      alpha.setValue("");
    }
  }

  function emit(css: string): void {
    reflect(css);
    opts.onChange(css);
  }

  /*
   * The typed value is committed as hex when the alpha allows it.
   *
   * This used to be a hardcoded `formatColor(…, "rgb")`, which made the row the
   * one control that performed the exact conversion the picker was fixed to stop
   * doing — see `emit`, which honours the mode button because "editing any
   * Tailwind 4 palette colour silently rewrote it as `rgb()` — a gamut and
   * readability downgrade". Someone typing six hex digits has said which
   * notation they want; writing back `rgb(…)` overrules them for no reason.
   *
   * `rgb()` is still the form when a partial alpha has to be carried, because
   * hex cannot express it without appending two digits the user did not type
   * into their source.
   *
   * Where that alpha comes from depends on what was typed. Four and eight digits
   * carry one; three and six do not, and for those the alpha stays where the
   * user last put it, in the `%` field beside this one. Reading `alphaOf(current)`
   * unconditionally — which is what this did — meant an eight-digit hex was
   * accepted and its alpha silently dropped, the same defect the popover's hex
   * field had.
   */
  function commitHex(): void {
    const raw = hex.value.trim().replace(LEADING_HASH, "");
    if (isHexColor(`#${raw}`)) {
      const rgb = parseColor(`#${raw}`);
      if (rgb) {
        const carriesAlpha = raw.length === 4 || raw.length === 8;
        const a = carriesAlpha ? rgb[3] : alphaOf(current, opts.node);
        const next = formatColor(
          [rgb[0], rgb[1], rgb[2], a],
          a >= 1 ? "hex" : "rgb"
        );
        emit(next);
        /*
         * The recents row gets the `rgb()` form even when the source gets hex.
         *
         * `pushRecentColor` dedupes on the raw string, and every other caller
         * pushes `formatColor(…, "rgb")` — so pushing `next` here would give the
         * same colour two swatches depending on whether it was typed into this
         * field or picked in the popover. What notation reaches the user's
         * source and what keys an in-memory palette are separate questions.
         */
        pushRecentColor(formatColor([rgb[0], rgb[1], rgb[2], a], "rgb"));
        return;
      }
    }
    reflect(current);
  }

  /*
   * The `%` field, through the one function that folds an alpha into a paint.
   *
   * This was `withAlpha`'s body written out again — parse, replace the fourth
   * channel, re-serialise — which made it the second definition of a rule that
   * already had a name and a docstring explaining why it exists (`opacity`
   * composites the element *and its children*, so a fill at 50% would fade the
   * text inside it; the alpha of that one paint is the exact equivalent).
   *
   * The `next === current` test is doing two jobs, deliberately. `withAlpha`
   * returns its input unchanged when the colour is unparseable, so a `Mixed` row
   * lands here — and so does an alpha that did not actually change. Both want
   * the same thing: put the field back to what the row is showing and record
   * nothing. Splitting them would need a second parse to tell them apart, for a
   * distinction with no different outcome.
   */
  function commitPct(n: number): void {
    if (Number.isNaN(n)) {
      reflect(current);
      return;
    }
    const next = withAlpha(current, n / 100, opts.node);
    if (next === current) {
      reflect(current);
      return;
    }
    emit(next);
  }

  bindField(hex, commitHex, () => reflect(current));

  hex.addEventListener("mousedown", (e) => {
    // Bound, the hex slot shows a token name and cannot be typed into — so a
    // click on it is free to mean the one thing it could usefully mean.
    if (boundToken !== null && openBound) {
      e.preventDefault();
      openBound();
    }
  });

  swatch.addEventListener("click", () => {
    if (boundToken !== null) {
      /*
       * A bound paint's colour is the token's.
       *
       * The swatch is the row's primary editing affordance, and leaving it live
       * while the hex and alpha were locked meant the one gesture that actually
       * changes the colour was the one gesture nothing stopped: the picker
       * opened, the drag wrote a new value, and the row went on displaying a
       * token name for a colour that no longer came from it. The badge beside
       * the row is how the binding is changed or removed.
       */
      return;
    }
    picker = openColorPicker({
      anchor: swatch,
      gestures: opts.gestures,
      node: opts.node,
      onChange: emit,
      onClose: () => {
        picker = null;
      },
      // A `Mixed` selection is "several values, one of which you are about to
      // impose", not a read-only state — so the picker opens, seeded white.
      value: isParseableColor(current, opts.node) ? current : "#FFFFFF",
    });
  });

  reflect(current);

  // On the wrapper, matching what `num-field` does for a field whose glyph is a
  // letter or absent: this one has no glyph at all, so without a tip the only
  // thing naming it was a six-character value that could be any colour channel.
  const hexWrap = el(
    "div",
    {
      class: `${cls("ctl-num")} ${cls("paint-hex")}`,
      "data-tip": "Hex value",
    },
    [hex]
  );
  const row = el("div", { class: cls("paint-row") }, [
    swatch,
    hexWrap,
    alpha.element,
  ]);

  return {
    destroy() {
      picker?.close();
      alpha.destroy();
    },
    element: row,
    /*
     * The token's name in the hex slot, and nothing else moves.
     *
     * The swatch keeps showing the colour — it is the one part of this row that
     * is *more* useful when a token is bound, because a name alone does not
     * tell you what colour it is. The alpha field goes with the hex: a bound
     * paint's opacity is the token's, and editing it here would silently fork
     * the value away from the token it claims to be.
     */
    onActivate(open) {
      openBound = open;
    },
    setToken(name) {
      boundToken = name;
      row.toggleAttribute("data-token", name !== null);
      hex.readOnly = name !== null;
      /*
       * The alpha field goes through `setToken` too, not just `readOnly`.
       *
       * `readOnly` stops typing and nothing else: `createNumField` gates its
       * arrow-stepping and its drag-scrub on its own bound state, and the scrub
       * grip is a `<span>` that never consulted `readOnly` at all. So the two
       * gestures the field exists for both still committed, forking the value
       * from the token the row claims to be — the exact thing this comment used
       * to say it prevented.
       *
       * Its displayed percentage is left alone: that is still a true fact about
       * the paint, and a name in its place would say less.
       */
      alpha.input.readOnly = name !== null;
      alpha.setLocked(name !== null);
      if (name === null) {
        reflect(current);
        return;
      }
      hex.value = name;
    },
    setValue(css) {
      reflect(css);
      picker?.setValue(css);
    },
  };
}

/** Descriptor-pipeline adapter, for `buildControl`'s `color-swatch` branch. */
export function createColorControl(
  descriptor: Descriptor,
  initial: string,
  onChange: OnChange,
  gestures?: Gestures,
  node?: Element | null
): ControlHandle {
  const row = createColorRow({
    gestures,
    node,
    onChange: (next) => onChange(descriptor.cssProperty, next),
    tip: descriptor.label,
    value: initial || descriptor.defaultValue,
  });
  return {
    destroy: row.destroy,
    element: row.element,
    onActivate: (open) => row.onActivate(open),
    properties: [descriptor.cssProperty],
    setToken: (name) => row.setToken(name),
    setValue(cssProperty, value) {
      if (cssProperty === descriptor.cssProperty) {
        row.setValue(value);
      }
    },
  };
}

// -- Picker -------------------------------------------------------------------

export interface PickerOptions {
  anchor: HTMLElement;
  gestures?: Gestures;
  /** The realm the seed colour resolves against. See `ColorRowOptions.node`. */
  node?: Element | null;
  onChange: (next: string) => void;
  onClose?: () => void;
  value: string;
}

export interface PickerHandle {
  close: () => void;
  setValue: (css: string) => void;
}

/**
 * HSVA is authoritative while the picker is open; the CSS string is its output.
 *
 * Deriving hue from RGB on every pointermove loses it exactly where the user is
 * most likely to be: at `S = 0` or `V = 0` every hue maps to the same triple, so
 * dragging into the black corner and back out returns you to red rather than to
 * the hue you were working in. Holding H separately is the only fix.
 */
export function openColorPicker(opts: PickerOptions): PickerHandle {
  const start = parseColor(opts.value, opts.node) ?? [255, 255, 255, 1];
  const [h0, s0, v0] = rgbToHsv(start[0], start[1], start[2]);
  const state: HSVA = { a: start[3], h: h0, s: s0, v: v0 };
  let mode: Mode = "hex";
  let dragging = false;

  const body = el("div", { class: cls("pop-color-body") });

  /*
   * The three drag surfaces are real sliders.
   *
   * They were `<div tabindex="-1">` with no role, no name, no value and no keydown
   * handler — so the only keyboard route to a colour was the R/G/B/H/S/L number fields,
   * and to alpha the opacity field. A screen reader was told nothing at all. `tabindex`
   * is 0 so they are reachable, and each carries the `aria-value*` triple that makes a
   * slider announceable; `syncAll` keeps `aria-valuenow` current.
   */
  // -- saturation / value ----------------------------------------------------
  const svKnob = el("i", { class: cls("pop-sv-knob") });
  // A tip as well as the name. These three surfaces are bare gradients: unlike
  // a select or a labelled field there is nothing on them that says what they
  // do, so the accessible name was the only description and only a screen
  // reader could reach it. The tips name the axis and the keyboard route,
  // which is the part that is genuinely undiscoverable.
  const sv = el(
    "div",
    {
      "aria-label": "Saturation and brightness",
      class: cls("pop-sv"),
      "data-tip": "Saturation and brightness",
      role: "application",
      tabindex: "0",
    },
    [svKnob]
  );

  // -- sliders ---------------------------------------------------------------
  const hueKnob = el("i", { class: cls("pop-slider-knob") });
  const hue = el(
    "div",
    {
      "aria-label": "Hue",
      "aria-valuemax": "360",
      "aria-valuemin": "0",
      class: `${cls("pop-slider")} ${cls("pop-slider-hue")}`,
      "data-tip": "Hue. Arrow keys to step",
      role: "slider",
      tabindex: "0",
    },
    [hueKnob]
  );
  const alphaKnob = el("i", { class: cls("pop-slider-knob") });
  const alphaFill = el("i", { class: cls("pop-slider-fill") });
  const alpha = el(
    "div",
    {
      "aria-label": "Opacity",
      "aria-valuemax": "100",
      "aria-valuemin": "0",
      class: `${cls("pop-slider")} ${cls("pop-slider-alpha")}`,
      "data-tip": "Opacity. Arrow keys to step",
      role: "slider",
      tabindex: "0",
    },
    [alphaFill, alphaKnob]
  );

  /**
   * Arrow keys on a slider, with ⇧ for a coarse step.
   *
   * `Keys` would otherwise see these keystrokes on a non-typing target and run the
   * canvas nudge bindings instead — which is the other half of why pressing → with the
   * picker open moved the element on canvas rather than changing the colour.
   */
  const bindArrows = (
    surface: HTMLElement,
    onStep: (delta: number, coarse: boolean) => void
  ): void => {
    surface.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      const delta = ARROW_DELTA[ev.key] ?? 0;
      if (delta === 0) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      onStep(delta, ev.shiftKey);
    });
  };

  /*
   * Wired here, not further down.
   *
   * These three calls originally sat below `emit`'s declaration — which is *after* this
   * function's `return`, so they were unreachable and the keyboard handlers were never
   * attached at all. `emit` and `state` are both hoisted/closed over, so this is the
   * earliest point at which the wiring is both reachable and complete.
   */
  bindArrows(hue, (delta, coarse) => {
    state.h = (state.h + delta * (coarse ? 10 : 1) + 360) % 360;
    emit();
  });
  bindArrows(alpha, (delta, coarse) => {
    state.a = clamp01(state.a + delta * (coarse ? 0.1 : 0.01));
    emit();
  });
  bindArrows(sv, (delta, coarse) => {
    state.s = clamp01(state.s + delta * (coarse ? 0.1 : 0.01));
    emit();
  });

  // -- fields ----------------------------------------------------------------
  const modeBtn = el(
    "button",
    {
      "aria-label": "Colour format",
      class: cls("pop-mode"),
      "data-tip": "Colour format",
      onClick: () => {
        const next = (MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length;
        mode = MODE_CYCLE[next];
        buildFields();
        syncFields();
      },
      type: "button",
    },
    [el("span", { text: "HEX" }), icon("caret-down", "xs")]
  );
  const fields = el("div", { class: cls("pop-fields") });
  /** The mode-dependent channel fields, rebuilt whenever the mode changes. */
  let channels: Field[] = [];
  const alphaField = numField("Opacity", "", "%", 100, (n) => {
    state.a = clamp01(n / 100);
    emit();
  });

  const eyedrop = supportsEyeDropper()
    ? el(
        "button",
        {
          "aria-label": "Pick colour from screen",
          class: cls("pop-eyedrop"),
          "data-tip": "Pick from screen",
          onClick: pickFromScreen,
          type: "button",
        },
        [icon("eyedropper", "sm")]
      )
    : null;

  // -- recents ---------------------------------------------------------------
  const recents = el("div", { class: cls("pop-recents") });
  const offRecents = onRecentColorsChange(renderRecents);

  body.append(
    sv,
    el("div", { class: cls("pop-sliders") }, [hue, alpha]),
    el("div", { class: cls("pop-row") }, [
      modeBtn,
      fields,
      alphaField.wrap,
      eyedrop,
    ]),
    recents
  );

  const handle: PopoverHandle = openPopover({
    // Right-aligned and unscrollable: the picker hangs off a 22px swatch near
    // the right edge of a dock, and a squashed S/V area is worse than a flip.
    align: "end",
    anchor: opts.anchor,
    className: "pop-color",
    content: body,
    onClose: () => {
      // A popover dismissed mid-drag would otherwise leave `history.open()`
      // unbalanced, and every later edit would fold into that one undo step.
      endDrag();
      offRecents();
      opts.onClose?.();
    },
    prefer: "below",
    scroll: false,
  });

  buildFields();
  renderRecents();
  syncAll();

  bindDrag(sv, (x, y) => {
    state.s = clamp01(x);
    state.v = clamp01(1 - y);
    emit();
  });
  bindDrag(hue, (x) => {
    state.h = clamp01(x) * 360;
    emit();
  });
  bindDrag(alpha, (x) => {
    state.a = clamp01(x);
    emit();
  });

  return {
    close: () => handle.close(),
    setValue(css) {
      const rgb = parseColor(css, opts.node);
      if (!rgb) {
        return;
      }
      // Only adopt the incoming value when it is genuinely different from what
      // this picker is already showing. The panel echoes our own emits back
      // through `syncControl`, and re-deriving HSV from them would snap the
      // knob out from under the pointer mid-drag.
      const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
      if (r === rgb[0] && g === rgb[1] && b === rgb[2] && state.a === rgb[3]) {
        return;
      }
      const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      state.h = s === 0 ? state.h : h;
      state.s = s;
      state.v = v;
      state.a = rgb[3];
      syncAll();
    },
  };

  // -- internals -------------------------------------------------------------

  function rgba(): RGBA {
    const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
    return [r, g, b, state.a];
  }

  function emit(): void {
    syncAll();
    /*
     * In the *selected* mode, not always `rgb`.
     *
     * The HEX / RGB / HSL button is labelled "Colour format" and only ever changed the
     * readout: `emit` was hard-coded to `rgb`, so switching to HEX and picking a colour
     * still wrote `rgb(r g b)` into the user's source. Combined with the engine probe
     * resolving `oklch()` through a computed `color`, editing any Tailwind 4 palette
     * colour silently rewrote it as `rgb()` — a gamut and readability downgrade
     * performed by a control that claimed to be about format.
     */
    opts.onChange(formatColor(rgba(), mode));
  }

  function syncAll(): void {
    const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
    const solid = `rgb(${r} ${g} ${b})`;
    sv.style.setProperty(`--${cls("hue")}`, `hsl(${state.h} 100% 50%)`);
    svKnob.style.left = `${state.s * 100}%`;
    svKnob.style.top = `${(1 - state.v) * 100}%`;
    svKnob.style.background = solid;
    // A 0-1 fraction, not a percentage: the stylesheet turns it into a `left`
    // across `100% - <knob>` so the dial stays inside its track at both ends.
    // The SV knob above keeps its percentages — it marks a point in an area
    // whose corners are real values, so centring it on one is correct.
    hueKnob.style.setProperty(`--${cls("knob")}`, String(state.h / 360));
    alphaKnob.style.setProperty(`--${cls("knob")}`, String(state.a));
    alphaFill.style.backgroundImage = `linear-gradient(to right, transparent, ${solid})`;
    // The announced value, kept in step with the knob it describes.
    hue.setAttribute("aria-valuenow", String(Math.round(state.h)));
    hue.setAttribute("aria-valuetext", `${Math.round(state.h)} degrees`);
    alpha.setAttribute("aria-valuenow", String(Math.round(state.a * 100)));
    alpha.setAttribute("aria-valuetext", `${Math.round(state.a * 100)}%`);
    syncFields();
  }

  /** The numeric fields change shape with the mode, so they are rebuilt. */
  function buildFields(): void {
    for (const f of channels) {
      f.destroy();
    }
    channels = [];
    fields.replaceChildren();
    (modeBtn.firstElementChild as HTMLElement).textContent = mode.toUpperCase();
    if (mode === "hex") {
      channels = [
        textField("Hex", (raw) => {
          const rgb = parseColor(`#${raw.replace(LEADING_HASH, "")}`);
          if (!rgb) {
            return false;
          }
          const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
          state.h = s === 0 ? state.h : h;
          state.s = s;
          state.v = v;
          /*
           * The alpha too. `parseColor` reads `#rrggbbaa` and this was the one
           * of the three places holding an `RGBA` that dropped the fourth
           * channel on the floor — `setValue` and the recents row both assign it
           * — so typing `FF000080` produced fully opaque red and the alpha
           * slider did not move.
           */
          state.a = rgb[3];
          emit();
          pushRecentColor(formatColor(rgba(), "rgb"));
          return true;
        }),
      ];
    } else {
      // Real bounds per channel: 8-bit for RGB, degrees for hue, percent for
      // saturation and lightness. They used to share one unbounded field, so
      // `R: 900` was accepted and quietly became 255 somewhere downstream.
      const labels = mode === "rgb" ? ["R", "G", "B"] : ["H", "S", "L"];
      const maxima = mode === "rgb" ? [255, 255, 255] : [360, 100, 100];
      channels = labels.map((label, i) =>
        numField(label, label, "", maxima[i], (n) => setChannel(i, n))
      );
    }
    for (const f of channels) {
      fields.append(f.wrap);
    }
  }

  function setChannel(index: number, n: number): void {
    if (mode === "rgb") {
      const next = rgba();
      next[index] = Math.max(0, Math.min(255, Math.round(n)));
      const [h, s, v] = rgbToHsv(next[0], next[1], next[2]);
      state.h = s === 0 ? state.h : h;
      state.s = s;
      state.v = v;
    } else {
      const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
      const [h, s, l] = rgbToHsl(r, g, b);
      const next: [number, number, number] = [h, s * 100, l * 100];
      next[index] = n;
      const [nh, ns, nv] = hslToHsv(next[0], next[1] / 100, next[2] / 100);
      state.h = nh;
      state.s = ns;
      state.v = nv;
    }
    emit();
  }

  function syncFields(): void {
    const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
    if (mode === "hex") {
      channels[0]?.set(
        formatColor([r, g, b, 1], "hex").replace(LEADING_HASH, "").toUpperCase()
      );
    } else {
      let values = [r, g, b];
      if (mode === "hsl") {
        const [h, s, l] = rgbToHsl(r, g, b);
        values = [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
      }
      for (const [i, f] of channels.entries()) {
        f.set(String(values[i]));
      }
    }
    alphaField.set(String(Math.round(state.a * 100)));
  }

  function renderRecents(): void {
    const all = recentColors();
    recents.replaceChildren();
    if (!all.length) {
      return;
    }
    recents.append(
      el("span", { class: cls("pop-recents-label"), text: "Recent" })
    );
    for (const color of all) {
      const dot = el("button", {
        "aria-label": color,
        class: cls("pop-recent"),
        "data-tip": color,
        onClick: () => {
          const rgb = parseColor(color, opts.node);
          if (!rgb) {
            return;
          }
          const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
          state.h = s === 0 ? state.h : h;
          state.s = s;
          state.v = v;
          state.a = rgb[3];
          emit();
        },
        type: "button",
      });
      dot.style.backgroundImage = `linear-gradient(${color}, ${color}), var(--${cls("checker")})`;
      recents.append(dot);
    }
  }

  async function pickFromScreen(): Promise<void> {
    try {
      const result = await new (
        window as unknown as { EyeDropper: new () => EyeDropperLike }
      ).EyeDropper().open();
      const rgb = parseColor(result.sRGBHex);
      if (!rgb) {
        return;
      }
      const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      state.h = s === 0 ? state.h : h;
      state.s = s;
      state.v = v;
      emit();
      pushRecentColor(formatColor(rgba(), "rgb"));
    } catch {
      // Dismissing the native eyedropper rejects. That is a cancel, not a fault.
    }
  }

  function startDrag(): void {
    if (dragging) {
      return;
    }
    dragging = true;
    opts.gestures?.begin?.();
  }

  function endDrag(): void {
    if (!dragging) {
      return;
    }
    dragging = false;
    opts.gestures?.end?.();
    pushRecentColor(formatColor(rgba(), "rgb"));
  }

  /**
   * Pointer capture, so the gesture survives leaving the element — dragging the
   * saturation knob past the edge of its box is the normal way to reach a
   * corner, and without capture the drag would simply stop there.
   */
  function bindDrag(
    surface: HTMLElement,
    onMove: (x: number, y: number) => void
  ): void {
    const at = (e: PointerEvent): void => {
      const box = surface.getBoundingClientRect();
      onMove(
        box.width ? (e.clientX - box.left) / box.width : 0,
        box.height ? (e.clientY - box.top) / box.height : 0
      );
    };
    surface.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      surface.setPointerCapture(e.pointerId);
      startDrag();
      at(e);
    });
    surface.addEventListener("pointermove", (e) => {
      if (surface.hasPointerCapture(e.pointerId)) {
        at(e);
      }
    });
    // All three, not just `pointerup`: a cancelled gesture and a lost capture
    // both have to close the history batch, or it stays open and swallows every
    // subsequent edit into one undo step.
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      surface.addEventListener(type, endDrag);
    }
  }
}

// -- Field helpers ------------------------------------------------------------

interface Field {
  destroy: () => void;
  input: HTMLInputElement;
  set: (value: string) => void;
  wrap: HTMLElement;
}

/**
 * A numeric channel field — R/G/B, H/S/L, alpha.
 *
 * These are bounded integers, so they get the shared numeric field with real
 * bounds: typing `300` into an R channel clamps to 255 and typing `f` into it
 * is refused outright, where the local implementation this replaced accepted
 * any string and reverted silently on blur.
 *
 * `glyph` is the one-character identity the field carries in place of a label
 * rail, matching the rest of the panel. Scrubbing is off: these live inside a
 * popover on top of a saturation square that is itself a drag surface, and a
 * second horizontal drag gesture 20px away from the first is a mis-grab waiting
 * to happen.
 */
function numField(
  label: string,
  glyph: string,
  suffix: string,
  max: number,
  commit: (n: number) => void
): Field {
  const handle = createNumField(
    {
      glyph,
      label,
      max,
      min: 0,
      scrub: false,
      step: 1,
      suffix,
      unit: "",
    },
    "0",
    (css) => {
      const n = Number.parseFloat(css);
      if (!Number.isNaN(n)) {
        commit(n);
      }
    }
  );
  return {
    destroy: handle.destroy,
    input: handle.input,
    set: handle.setValue,
    wrap: handle.element,
  };
}

/**
 * The hex field, which is not numeric.
 *
 * No glyph: six characters of value are self-evidently a colour, and an "H" in
 * front of them just reads as part of the number.
 */
function textField(label: string, commit: (raw: string) => boolean): Field {
  const { element, input } = createTextField({ label });
  bindField(
    input,
    () => {
      commit(input.value.trim());
    },
    () => input.blur()
  );
  return {
    destroy() {
      // Nothing bound outside the element.
    },
    input,
    set(value) {
      // Never overwrite a field the user is mid-way through typing into.
      if (document.activeElement !== input) {
        input.value = value;
      }
    },
    wrap: element,
  };
}

// -- Misc ---------------------------------------------------------------------

interface EyeDropperLike {
  open: () => Promise<{ sRGBHex: string }>;
}

/** Chromium-only and secure-context-only; hidden rather than disabled elsewhere. */
function supportsEyeDropper(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

function hslToHsv(h: number, s: number, l: number): [number, number, number] {
  const v = l + s * Math.min(l, 1 - l);
  return [h, v === 0 ? 0 : 2 * (1 - l / v), v];
}
