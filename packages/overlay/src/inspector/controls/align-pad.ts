import { cls, el } from "../../dom";
import type { ControlHandle, OnChange } from "./types";

/**
 * The 3×3 auto-layout alignment pad.
 *
 * One click writes **both** `justify-content` and `align-items` — that is the
 * whole point of the control, and it is why this is not two segmented groups.
 * They land as two separate `onChange` calls, so the change set records two
 * deltas and the agent sees exactly the two properties a developer would write.
 *
 * Which axis a click means flips with the flex direction, so the pad reads its
 * direction live rather than being rebuilt: in a row, the column index is the
 * main axis (`justify-content`) and the row index is the cross axis; in a
 * column they swap.
 *
 * The preview "ink" in each cell is drawn with CSS pseudo-elements rather than
 * nine more SVGs — nine icons would cost ~8 KB to say something three
 * positioned bars say better.
 */
const POSITIONS = ["flex-start", "center", "flex-end"] as const;

export interface AlignPadState {
  align: string;
  justify: string;
}

export function createAlignPad(
  getDirection: () => "row" | "column",
  initial: AlignPadState,
  onChange: OnChange
): ControlHandle {
  const cells: { btn: HTMLElement; col: number; row: number }[] = [];
  const state: AlignPadState = { ...initial };

  /** Grid coordinates for the current justify/align pair, or null if neither
   * is one of the three simple positions (e.g. `space-between`). */
  function coords(): { col: number; row: number } | null {
    const j = POSITIONS.indexOf(state.justify as (typeof POSITIONS)[number]);
    const a = POSITIONS.indexOf(state.align as (typeof POSITIONS)[number]);
    if (j === -1 || a === -1) {
      return null;
    }
    return getDirection() === "column"
      ? { col: a, row: j }
      : { col: j, row: a };
  }

  function sync(): void {
    const at = coords();
    for (const { btn, col, row } of cells) {
      const on = at !== null && at.col === col && at.row === row;
      btn.classList.toggle(cls("pad-on"), on);
      btn.setAttribute("aria-pressed", String(on));
    }
    pad.dataset.dir = getDirection();
    // `space-between` owns the main axis, so the pad's main axis is inert.
    pad.dataset.spread = String(state.justify === "space-between");
  }

  const pad = el("div", {
    "aria-label": "Alignment",
    class: cls("pad"),
    role: "group",
  });

  /*
   * Each cell names the result it produces, not the properties it writes.
   *
   * The naming is stable across `flex-direction`, even though which CSS property
   * takes which index is not: a cell's column is always the horizontal position
   * on screen and its row always the vertical one, because the pad is a picture
   * of the outcome. Nine silent buttons whose only clue was a 20px preview was
   * the least explicable control in the panel.
   */
  const VERTICAL = ["top", "middle", "bottom"] as const;
  const HORIZONTAL = ["left", "centre", "right"] as const;

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const label = `Align ${VERTICAL[row]} ${HORIZONTAL[col]}`;
      const btn = el("button", {
        "aria-label": label,
        class: cls("pad-cell"),
        "data-tip": label,
        onClick: () => {
          const column = getDirection() === "column";
          state.justify = POSITIONS[column ? row : col];
          state.align = POSITIONS[column ? col : row];
          sync();
          onChange("justify-content", state.justify);
          onChange("align-items", state.align);
        },
        type: "button",
      });
      btn.dataset.col = String(col);
      btn.dataset.row = String(row);
      // Three bars of differing lengths, so which edge they are hugging is
      // legible at 20px. Two (the pseudo-element trick) reads as a tick mark.
      btn.append(
        el("span", { class: cls("pad-ink") }, [el("i"), el("i"), el("i")])
      );
      cells.push({ btn, col, row });
      pad.append(btn);
    }
  }

  const spread = el(
    "button",
    {
      "aria-label": "Space between",
      class: cls("pad-spread"),
      "data-tip": "Space between",
      onClick: () => {
        const on = state.justify !== "space-between";
        state.justify = on ? "space-between" : "flex-start";
        sync();
        onChange("justify-content", state.justify);
      },
      type: "button",
    },
    [el("span"), el("span"), el("span")]
  );

  const wrap = el("div", { class: cls("pad-wrap") }, [pad, spread]);
  sync();

  return {
    element: wrap,
    // `flex-direction` is in the list without being mirrored into state: the
    // pad reads the direction through its getter, and hearing about the change
    // is what tells it to re-run `sync()` and swap which axis its columns mean.
    properties: ["justify-content", "align-items", "flex-direction"],
    setValue(cssProperty, value) {
      if (cssProperty === "justify-content") {
        state.justify = value;
      } else if (cssProperty === "align-items") {
        state.align = value;
      } else if (cssProperty !== "flex-direction") {
        return;
      }
      sync();
    },
  };
}
