import { describe, expect, it } from "vitest";
import type { Rect } from "./canvas/space";
import { marksFor } from "./guide-overlay";
import { css as chromeCss } from "./styles/chrome.css";

const box: Rect = { height: 40, left: 100, top: 200, width: 80 };

describe("marksFor", () => {
  it("marks both ends of an edge match", () => {
    // A vertical guide marks the top and bottom of what it lined up with.
    expect(marksFor(box, "x", false)).toEqual([200, 240]);
    // A horizontal one marks the left and right.
    expect(marksFor(box, "y", false)).toEqual([100, 180]);
  });

  it("marks only the middle of a centre match", () => {
    // One X instead of two is the entire signal that centres aligned rather
    // than edges — on a symmetric element the line alone looks identical.
    expect(marksFor(box, "x", true)).toEqual([220]);
    expect(marksFor(box, "y", true)).toEqual([140]);
  });
});

describe("chrome stylesheet", () => {
  it("draws the X mark with the palette's error colour", () => {
    // The mark is an inline SVG in a data URI, so its colour cannot be a
    // `var()` and has to be encoded in. This is the guard against it being
    // typed out as a literal and then drifting away from the token.
    expect(chromeCss).toContain("data:image/svg+xml");
    expect(chromeCss).toContain(encodeURIComponent("#FF4D4F"));
  });

  it("keeps every canvas outline at a hairline with no radius", () => {
    for (const rule of ["hover-box", "sel-box", "extra-box"]) {
      const block = blockFor(chromeCss, rule);
      expect(block).toContain("border: 1px solid");
      expect(block).not.toContain("border-radius");
    }
  });

  it("declares no transition on chrome that is re-positioned", () => {
    // Also enforced at build time by `scripts/check-css.mjs`; this catches it
    // in the test run, where the failure is easier to read.
    expect(blockFor(chromeCss, "hover-box")).not.toContain("transition");
    expect(blockFor(chromeCss, "sel-box")).not.toContain("transition");
  });
});

/**
 * The declaration block of the first rule whose selector mentions `name`.
 *
 * Throws rather than asserting when the rule is missing: a helper that fails an
 * assertion outside a test body reports against whichever test happened to call
 * it, which is exactly the wrong place to be looking.
 */
function blockFor(css: string, name: string): string {
  const at = css.indexOf(`-${name} {`);
  if (at === -1) {
    throw new Error(`no rule for .${name} in the chrome stylesheet`);
  }
  return css.slice(at, css.indexOf("}", at));
}
