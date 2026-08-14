/**
 * The composer's pending-change strip.
 *
 * Every direct-manipulation edit waiting to be sent gets its own chip with its
 * own ✕. This replaced a single filled-accent pill reading "3 style changes +
 * 1 move", whose ✕ discarded *everything* — so backing out one bad tweak meant
 * throwing away the other four and redoing them.
 *
 * The chips are deliberately quiet: a hover surface, a hairline border and
 * secondary text. They sit inches from the accent-filled Send button, and two
 * blue things side by side both claiming to be the important one is worse than
 * either. The selection chip keeps the accent, which makes it the one coloured
 * thing in the row — the hierarchy the strip actually wants.
 */
import { cls, el } from "../dom";
import { type IconName, icon } from "../icons";

/** One pending edit, as the composer shows it. */
export interface ChangeChip {
  icon: IconName;
  label: string;
  onRemove: () => void;
  /** Full text for the tooltip — `label` is truncated to fit the strip. */
  tip: string;
}

/**
 * Append one chip per change to `host`, plus a trailing "Discard all".
 *
 * Appends rather than clears: the host also carries the selection chip, which
 * the caller owns and has already placed.
 *
 * The bulk action only appears at two or more chips — with a single chip it
 * would be a second control that does exactly what the first one does.
 */
export function renderChangeChips(
  host: HTMLElement,
  chips: ChangeChip[],
  // Handed its own button so the caller can anchor a confirm menu on it —
  // this is the bulk path with no journal entry behind it.
  onDiscardAll?: (anchor: HTMLElement) => void
): void {
  for (const chip of chips) {
    host.append(
      el("span", { class: `${cls("sel-chip")} ${cls("tweak-chip")}` }, [
        icon(chip.icon, "sm"),
        el("span", { class: cls("chip-label"), text: chip.label }),
        el(
          "span",
          {
            "aria-label": `Drop ${chip.tip}`,
            class: cls("chip-x"),
            "data-tip": "Drop this change",
            onClick: chip.onRemove,
            role: "button",
            tabindex: "0",
          },
          [icon("close", "sm")]
        ),
      ])
    );
    // The tip goes on the chip itself so hovering anywhere on it explains the
    // change; the ✕ overrides it with what clicking will do.
    (host.lastElementChild as HTMLElement).dataset.tip = chip.tip;
  }

  if (onDiscardAll && chips.length > 1) {
    const all = el(
      "button",
      {
        class: `${cls("sel-chip")} ${cls("chip-all")}`,
        "data-tip": "Discard every pending change",
        type: "button",
      },
      [icon("close", "sm"), el("span", { text: "Discard all" })]
    );
    all.addEventListener("click", () => onDiscardAll(all));
    host.append(all);
  }
}

/** Shorten a CSS value so a chip stays a chip. */
export function shortValue(value: string, max = 14): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}
