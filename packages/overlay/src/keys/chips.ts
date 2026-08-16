/**
 * A chord, as chips — one per key you press.
 *
 * Shared by the palette and the `?` sheet, which is a change of mind worth
 * writing down. `help.css.ts` argues the two surfaces should not share a skin,
 * because the sheet is a document and a palette is a control and making them
 * look alike would make the sheet read as operable. That still holds for the
 * rows. It never held for the keys: "⌘⇧Z" is the same fact on both, and it was
 * being rendered two different ways — bordered chips on the sheet, and a run of
 * unspaced 10px mono on the palette, which is three glyphs a reader has to
 * already know the set to take apart.
 *
 * One chip per key rather than one per chord, and the grouping is what makes a
 * two-chord row readable: Redo answers to ⌘⇧Z *and* ⌘Y, and flattened to five
 * chips in a row there is nothing to say where the first chord stops. Each chord
 * gets its own group with a tight internal gap and a wide one between groups, so
 * the shape does the separating and no "or" has to be written.
 */
import { cls, el } from "../dom";

/**
 * `[["⌘", "⇧", "Z"], ["⌘", "Y"]]` → the chip block for a row.
 *
 * Takes parts rather than an id so both call sites can decide for themselves how
 * many chords a row shows — the palette shows the first, the sheet shows all of
 * them — without this module knowing about either.
 */
export function chordChips(chords: string[][]): HTMLElement {
  return el(
    "span",
    { class: cls("keys") },
    chords.map((keys) =>
      el(
        "span",
        { class: cls("chord") },
        keys.map((key) => el("kbd", { class: cls("key"), text: key }))
      )
    )
  );
}
