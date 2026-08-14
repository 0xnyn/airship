/**
 * The job chip's two gates.
 *
 * The chip is hidden by two different owners — the *mode* (`syncBar`, over the
 * whole `viewOnlyBar`) and `awaiting` (`syncJobChip`) — and written to one
 * element they clobber each other. The direction that matters is the one that
 * nearly shipped: starting a job in edit mode would have stripped the `hidden`
 * that the mode had just written, putting a view-mode control into the edit
 * bar.
 *
 * Asserted structurally rather than through `AirshipApp`, which would want a
 * socket, a dnd-kit manager and a `DesignPanel` to check where a class lands.
 * The invariant is "one element per owner", and that is a shape.
 */

import { describe, expect, it } from "vitest";
import { PREFIX } from "./dom";
import { overlayCss } from "./styles/index";

/** Top-level, so it is not recompiled on every assertion. */
const CONTENTS = /display:\s*contents/;

describe("bar hosts", () => {
  it("gives every double-gated bar control a host of its own", () => {
    // `display: contents` is what lets the wrapper exist without earning a flex
    // gap of its own — and `.hidden`'s `display: none !important` still beats
    // it, which is the whole mechanism.
    const css = overlayCss();
    for (const host of ["bar-frame-tools", "bar-apply-host", "bar-job-host"]) {
      expect(css).toContain(`.${PREFIX}-${host}`);
    }
    const rule = css
      .split("\n")
      .find((line) => line.includes(`${PREFIX}-bar-job-host`));
    expect(rule).toBeDefined();
    expect(css.slice(css.indexOf(`${PREFIX}-bar-job-host`))).toMatch(CONTENTS);
  });
});
