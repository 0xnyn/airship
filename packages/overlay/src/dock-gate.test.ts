/**
 * Which docks exist in which mode.
 *
 * Three booleans, and every one of them was a bug waiting to happen.
 *
 * `open` is the *user's* state and the mode is laid over it, never written into
 * it. Collapsing the inspector on the way into view mode would have been a line
 * shorter and would have quietly discarded whether it had been open — so a
 * round trip through view mode is asserted directly, because that is the part
 * that is easy to get wrong and impossible to notice until someone complains
 * that their panel keeps closing.
 *
 * `modeScoped` is what keeps the inline overlay out of it. Edit and view mean
 * different things on the two stages: on the canvas, view mode has a frame list
 * and a map to put in the place of the two element-scoped panels, so giving
 * them up is a trade. Inline has neither, so the same rule would take the
 * inspector away and put nothing there.
 *
 * Tested as a free function rather than through `AirshipApp`, which would mean
 * a socket, a dnd-kit manager, a `DesignPanel` and a live document to check
 * three booleans.
 */

import { describe, expect, it } from "vitest";
import { dockVisible } from "./app";

/** The canvas: view mode swaps the panels, so the gate is live. */
function canvas(side: "left" | "right", open: boolean, editing: boolean) {
  return dockVisible({ editing, modeScoped: true, open, side });
}

/** Inline: nothing to swap in, so the gate must never fire. */
function inline(side: "left" | "right", open: boolean, editing: boolean) {
  return dockVisible({ editing, modeScoped: false, open, side });
}

describe("dockVisible on the canvas", () => {
  it("shows both panels while editing", () => {
    expect(canvas("left", true, true)).toBe(true);
    expect(canvas("right", true, true)).toBe(true);
  });

  it("takes the inspector away in view mode", () => {
    // It is scoped to an element selection, and view mode has none by
    // construction — so it was offering controls that could not do anything.
    expect(canvas("right", true, false)).toBe(false);
  });

  it("keeps the left dock in view mode, because it has something else to show", () => {
    expect(canvas("left", true, false)).toBe(true);
  });

  it("never overrides a panel the user closed", () => {
    for (const editing of [true, false]) {
      expect(canvas("left", false, editing)).toBe(false);
      expect(canvas("right", false, editing)).toBe(false);
    }
  });

  it("gives the inspector back exactly as it was found", () => {
    // The round trip, both ways. The mode is a second term over `open`, never a
    // write to it, so this holds without the app remembering anything.
    const wasOpen = true;
    expect(canvas("right", wasOpen, false)).toBe(false);
    expect(canvas("right", wasOpen, true)).toBe(wasOpen);

    const wasClosed = false;
    expect(canvas("right", wasClosed, false)).toBe(false);
    expect(canvas("right", wasClosed, true)).toBe(wasClosed);
  });
});

describe("dockVisible inline", () => {
  it("is the open flag and nothing else, in either mode", () => {
    for (const side of ["left", "right"] as const) {
      for (const editing of [true, false]) {
        expect(inline(side, true, editing)).toBe(true);
        expect(inline(side, false, editing)).toBe(false);
      }
    }
  });
});
