import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { plainStage } from "../stories/chrome";
import { MAX_FRAMES, PRESET_GROUPS, PRESETS } from "./frames";

/*
 * The device presets — the sizes a frame can be.
 *
 * Sizes, not device emulation. A frame is a real same-origin iframe at a real
 * viewport, so a 393px frame reports `innerWidth === 393` to the app inside it
 * at any zoom; nothing here spoofs a user agent or a pixel ratio. The list is
 * therefore a list of *widths worth designing at*, and reviewing it as a set is
 * the only way to tell whether it still is one.
 *
 * `PRESET_GROUPS` is the source of truth and `PRESETS` is its flattening, not
 * the other way round — so "every preset is in exactly one bucket" is true by
 * construction rather than by convention. Within a group the order is
 * newest first, and that is load-bearing rather than cosmetic: four sizes here
 * belong to two devices each (402 × 874, 393 × 852, 430 × 932, 1440 × 1024), and
 * newest-first means `matchPreset`'s fallback names the current device, which is
 * the right guess when there is nothing to prefer.
 *
 * ## These are diagrams, and they say so
 *
 * Nothing here renders a real component. The rectangles are drawn by this file
 * out of two divs and an inline style, and that is legitimate for what these
 * stories are — a reading of a *table*, laid out to scale so the set can be
 * judged as shapes rather than as a list of numbers.
 *
 * It was not legitimate for the story that used to sit at the bottom of this
 * file. `FullBoard` drew eight of these same grey rectangles under the heading
 * "At MAX_FRAMES", wrapped in `cls("canvas-viewport")` so it would pick up the
 * canvas background, and was as close as the catalogue came to showing the
 * canvas at all. A drawing of a board is not a board: it cannot show a frame's
 * title bar, its grips, what happens to chrome at 20% zoom, or that the
 * furniture is drawn in screen space over a scaling world — which is the entire
 * design of `frame-chrome.ts`. It is gone, and `Canvas/Canvas` stands up the
 * real `FrameChrome` over a real `CanvasViewport` instead.
 */

const meta: Meta = {
  title: "Canvas/Device presets",
};

export default meta;

const SCALE = 0.12;

/** One preset drawn to scale, so the set can be compared as shapes. */
function thumb(preset: {
  height: number;
  label: string;
  width: number;
}): HTMLElement {
  return el(
    "div",
    { style: "display: grid; gap: 6px; justify-items: center;" },
    [
      el("div", {
        style: `width: ${Math.round(preset.width * SCALE)}px;
                height: ${Math.round(preset.height * SCALE)}px;
                background: var(--ap-surface-panel);
                border: 1px solid var(--ap-border-strong);
                border-radius: 3px;`,
      }),
      el("div", {
        style:
          "font: 400 10px var(--ap-font-sans); color: var(--ap-text-secondary); text-align: center;",
        text: preset.label,
      }),
      el("div", {
        style:
          "font: 400 9px var(--ap-font-mono); color: var(--ap-text-tertiary);",
        text: `${preset.width}×${preset.height}`,
      }),
    ]
  );
}

function heading(label: string, note: string): HTMLElement {
  return el("div", { style: "margin: 24px 0 4px;" }, [
    el("span", {
      style: `font: 600 12px var(--ap-font-sans); letter-spacing: .06em;
              text-transform: uppercase; color: var(--ap-text-secondary);`,
      text: label,
    }),
    el("span", {
      style: `font: 400 10px var(--ap-font-mono);
              color: var(--ap-text-tertiary); margin-left: 10px;`,
      text: note,
    }),
  ]);
}

/**
 * Every preset, grouped, drawn to scale.
 *
 * At 12% the phones are about 48px wide and the desktops about 170px, which is
 * roughly the ratio they occupy on the canvas at fit-zoom — so this is also a
 * fair picture of what a mixed board looks like before you open one.
 */
export const Catalogue: StoryObj = {
  render: () =>
    plainStage(
      [
        el(
          "div",
          { style: "width: 100%;" },
          PRESET_GROUPS.flatMap((group) => [
            heading(group.label, `${group.presets.length} presets`),
            el(
              "div",
              {
                style: `display: flex; flex-wrap: wrap; gap: 20px;
                      align-items: flex-end; padding: 8px 0;`,
              },
              group.presets.map(thumb)
            ),
          ])
        ),
      ],
      {
        what: "The preset table drawn to scale — a diagram of the list, not a render of the canvas. At 12% the ratios match what a mixed board looks like at fit-zoom.",
      }
    ),
};

/**
 * The sizes that collide.
 *
 * Four widths×heights are shared by two devices each. Grouping them is what
 * makes `matchPreset`'s newest-first rule legible: given only `402 × 874` there
 * is no way to know which device the user meant, so the list order decides, and
 * it decides in favour of the newer name.
 */
export const Duplicates: StoryObj = {
  render: () => {
    const bySize = new Map<string, string[]>();
    for (const preset of PRESETS) {
      const key = `${preset.width}×${preset.height}`;
      bySize.set(key, [...(bySize.get(key) ?? []), preset.label]);
    }
    const collisions = [...bySize.entries()].filter(([, l]) => l.length > 1);
    return plainStage(
      [
        el(
          "div",
          { style: "display: grid; gap: 8px;" },
          collisions.map(([size, labels]) =>
            el(
              "div",
              {
                style: `display: grid; grid-template-columns: 110px 1fr; gap: 14px;
                      font: 400 11px var(--ap-font-mono);`,
              },
              [
                el("span", { style: "color: var(--ap-blue-400);", text: size }),
                el("span", {
                  style: "color: var(--ap-text-secondary);",
                  text: labels.join("  →  "),
                }),
              ]
            )
          )
        ),
      ],
      {
        what: "The four sizes two devices each claim. Given only `402 × 874` there is nothing to prefer, so list order decides — and it decides for the newer name.",
      }
    );
  },
};

/*
 * `FullBoard` used to live here, and `Canvas/Canvas · AtTheCap` replaces it with
 * `MAX_FRAMES` real frames on a real viewport. See the note at the top.
 */
