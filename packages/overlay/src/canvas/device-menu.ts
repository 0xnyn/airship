/**
 * "Which viewport?", as menu content.
 *
 * Four surfaces ask that question — the bar's `+`, the bar's dimensions button,
 * the frame list's `+`, and a row's `⋯` — and until now the answer was written
 * twice: `frame-chrome.ts` built an accordion of `<button>`s against its own
 * world-anchored menu, while `frames-panel.ts` pushed the same presets into
 * `createMenu` as a flat header plus twenty-two rows. Two lists over one set of
 * devices, one of them structured and one of them a scroll.
 *
 * This is the half that can be shared: the *entries*, not the menu. The bar's
 * menus place themselves against canvas geometry and re-anchor on every pan, so
 * they cannot be `createMenu` clients (see the note in `popover-host.ts`) — but
 * the custom-size form has nothing to do with placement, and the group structure
 * is just `PRESET_GROUPS` shaped for one consumer or the other.
 */

import { cls, el } from "../dom";
import type { MenuGroup } from "../popover-host";
import {
  type DevicePreset,
  type Frame,
  framePreset,
  groupOfPreset,
  PRESET_GROUPS,
} from "./frames";

/** Below this a "frame" is not a viewport, it is a mistake. */
const MIN_SIDE = 120;

/**
 * The device list as collapsible `createMenu` groups.
 *
 * `open` is seeded from the frame's own device rather than left to fall back to
 * the first group, so opening the menu on a tablet shows you tablets. Passing no
 * frame — the add-frame case, where there is no current device — takes the
 * fallback, which is what `seedOpenGroup` does with an all-false set.
 *
 * The buckets come from `PRESET_GROUPS` rather than the flat `PRESETS` for the
 * reason that list gives: the groups are the source of truth, so a menu built
 * from them cannot drift out of step with the one on the canvas.
 */
export function deviceGroups(
  pick: (preset: DevicePreset) => void,
  current: Frame | null = null
): MenuGroup[] {
  const currentId = current ? (framePreset(current)?.id ?? null) : null;
  const openId = current ? (groupOfPreset(current.presetId)?.id ?? null) : null;
  return PRESET_GROUPS.map((group) => ({
    group: group.id,
    items: group.presets.map((preset) => ({
      hint: `${preset.width} × ${preset.height}`,
      label: preset.label,
      on: preset.id === currentId,
      run: () => pick(preset),
    })),
    label: group.label,
    open: group.id === openId,
  }));
}

/**
 * The width × height escape hatch from the preset list.
 *
 * `close` is a parameter rather than a call to some menu's own closer because
 * the two callers close differently — the bar's menu is a `hidden` class it owns
 * itself, the panel's is a popover on the host's stack — and the form has no
 * business knowing which.
 *
 * Both `Enter` and `Escape` are handled on the field, not left to the menu.
 * `Keys` skips every binding without `allowWhileTyping` while a field has focus,
 * so with this one focused the menu's own Escape never runs and the only way out
 * would be the mouse. `keys/registry.ts` prescribes exactly this — field-local commit and
 * cancel — and `renameFrame` already does it.
 */
export function customSizeRow(
  apply: (width: number, height: number) => void,
  close: () => void,
  start: { height: number; width: number } = { height: 800, width: 1280 }
): HTMLElement {
  const num = (placeholder: string, value: number): HTMLInputElement =>
    el("input", {
      class: cls("fc-menu-num"),
      min: String(MIN_SIDE),
      placeholder,
      type: "number",
      value: String(Math.round(value)),
    }) as HTMLInputElement;
  const w = num("W", start.width);
  const h = num("H", start.height);
  const commit = (): void => {
    const width = Number.parseInt(w.value, 10);
    const height = Number.parseInt(h.value, 10);
    if (width >= MIN_SIDE && height >= MIN_SIDE) {
      apply(width, height);
      close();
    }
  };
  for (const input of [w, h]) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    // A press in the field is not a choice, and the row it sits in is inside a
    // menu that closes on one.
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
  }
  return el("div", { class: cls("fc-menu-custom") }, [
    w,
    el("span", { class: cls("fc-menu-dim"), text: "×" }),
    h,
    el("button", {
      class: cls("fc-menu-go"),
      onClick: (e: Event) => {
        e.stopPropagation();
        commit();
      },
      text: "Set",
      type: "button",
    }),
  ]);
}
