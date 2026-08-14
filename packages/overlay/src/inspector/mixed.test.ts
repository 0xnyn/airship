/**
 * The disagreement sentinel, and the fold that produces it.
 *
 * `MIXED` was declared twice — `panel.ts` and `controls/color-picker.ts` each
 * had a private `const MIXED = "Mixed"`, the second commented "mirrors
 * `panel.ts`'s own sentinel" — and `sections/stroke.ts` was about to add a
 * third. `agreed` exists because that section needed the same fold four times
 * over: what do these edges say, and do they say it together.
 *
 * The comparator parameter is the load-bearing part. `panel.seed` folds with
 * `===`, which is right for the keywords and lengths it handles and wrong for
 * colours, because the values being compared do not all come from the same
 * place once an edit is pending.
 */
import { describe, expect, it } from "vitest";
import { sameColor } from "./css-value";
import { agreed, MIXED } from "./mixed";

describe("agreed", () => {
  it("gives the shared value when everything agrees", () => {
    expect(agreed(["8px", "8px", "8px"], "0px")).toBe("8px");
  });

  it("gives the sentinel when anything disagrees", () => {
    expect(agreed(["8px", "8px", "4px"], "0px")).toBe(MIXED);
  });

  it("treats an empty value as the fallback on both sides of the compare", () => {
    // Four longhands read off an element that declares none come back as empty
    // strings; they agree, and what they agree on is the fallback.
    expect(agreed(["", "", ""], "0px")).toBe("0px");
    expect(agreed(["0px", "", "0px"], "0px")).toBe("0px");
  });

  it("returns the fallback for nothing to compare", () => {
    expect(agreed([], "0px")).toBe("0px");
  });

  it("does not call one colour Mixed for being spelled two ways", () => {
    /*
     * The reason the comparator is a parameter. `getComputedStyle` hands back
     * the legacy comma form while `formatColor` writes the modern space one, so
     * a box the user just made uniform reads as four values under `===`.
     */
    const spellings = ["rgb(0, 170, 255)", "rgb(0 170 255)", "#0af"];
    expect(agreed(spellings, "#000000")).toBe(MIXED);
    expect(agreed(spellings, "#000000", sameColor)).toBe("rgb(0, 170, 255)");
  });

  it("still separates colours that genuinely differ", () => {
    expect(
      agreed(["rgb(0, 170, 255)", "rgb(0, 170, 254)"], "#000000", sameColor)
    ).toBe(MIXED);
  });

  it("reports the first value, not a normalised one", () => {
    // Whatever comes back is handed to a control as its seed, so it has to be a
    // value that control can render — not a canonical form invented here.
    expect(agreed(["#0af", "rgb(0 170 255)"], "#000000", sameColor)).toBe(
      "#0af"
    );
  });
});
