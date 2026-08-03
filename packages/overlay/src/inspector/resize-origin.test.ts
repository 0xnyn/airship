import { describe, expect, it } from "vitest";
import type { Anchor } from "./constraints";
import { type EdgeShift, type OriginStart, originDecls } from "./resize-origin";

/**
 * `originDecls` is pure arithmetic over a latched reading, so the tests build
 * that reading directly rather than going through `readOrigin` — which is the
 * only part that touches the DOM.
 */
function start(over: {
  h?: Anchor;
  hFar?: number;
  hNear?: number;
  positioned?: boolean;
  translate?: { x: number; y: number };
  v?: Anchor;
  vFar?: number;
  vNear?: number;
}): OriginStart {
  return {
    h: {
      anchor: over.h ?? "start",
      far: over.hFar ?? 0,
      near: over.hNear ?? 0,
    },
    positioned: over.positioned ?? true,
    translate: over.translate ?? { x: 0, y: 0 },
    v: {
      anchor: over.v ?? "start",
      far: over.vFar ?? 0,
      near: over.vNear ?? 0,
    },
  };
}

/** Only the named edges moved. */
function shift(over: Partial<EdgeShift>): EdgeShift {
  return { bottom: 0, left: 0, right: 0, top: 0, ...over };
}

describe("originDecls — anchored by the near side", () => {
  it("moves `left` with a west drag so the east edge holds", () => {
    // Grew 20px westward: the left edge travelled 20px left.
    const out = originDecls(start({ hNear: 100 }), shift({ left: -20 }));
    expect(out.decls).toEqual({ left: "80px" });
    expect(out.skipWidth).toBe(false);
  });

  it("writes nothing for an east drag — the width write already moves it", () => {
    expect(
      originDecls(start({ hNear: 100 }), shift({ right: 20 })).decls
    ).toEqual({});
  });

  it("handles both axes of a corner drag independently", () => {
    const out = originDecls(
      start({ hNear: 40, vNear: 60 }),
      shift({ left: -10, top: -5 })
    );
    expect(out.decls).toEqual({ left: "30px", top: "55px" });
  });
});

describe("originDecls — anchored by the far side", () => {
  it("writes nothing for a west drag: the pinned right edge already holds", () => {
    expect(
      originDecls(start({ h: "end", hFar: 30 }), shift({ left: -20 })).decls
    ).toEqual({});
  });

  it("moves `right` with an east drag so the west edge holds", () => {
    // Right edge travelled 20px right, so the inset from the right shrinks.
    const out = originDecls(
      start({ h: "end", hFar: 30 }),
      shift({ right: 20 })
    );
    expect(out.decls).toEqual({ right: "10px" });
  });
});

describe("originDecls — pinned to both edges", () => {
  it("resizes via the dragged inset and suppresses the size write", () => {
    const out = originDecls(
      start({ h: "stretch", hFar: 20, hNear: 10 }),
      shift({ left: -15 })
    );
    // Over-constraining the box would make the browser drop `right`, silently
    // unpinning an element the user explicitly stretched.
    expect(out.decls).toEqual({ left: "-5px" });
    expect(out.skipWidth).toBe(true);
    expect(out.skipHeight).toBe(false);
  });

  it("uses the far inset when the far edge is the one dragged", () => {
    const out = originDecls(
      start({ h: "stretch", hFar: 20, hNear: 10 }),
      shift({ right: 12 })
    );
    expect(out.decls).toEqual({ right: "8px" });
    expect(out.skipWidth).toBe(true);
  });
});

describe("originDecls — anchors with no unambiguous far edge", () => {
  it("leaves a centred element to resize about its centre", () => {
    const out = originDecls(
      start({ h: "center", hNear: 50 }),
      shift({ left: -20 })
    );
    expect(out.decls).toEqual({});
    expect(out.skipWidth).toBe(false);
  });

  it("leaves a percentage-scaled element's constraint intact", () => {
    // Writing a px inset here would quietly convert the % pin to a fixed offset.
    expect(
      originDecls(start({ h: "scale", hNear: 10 }), shift({ left: -20 })).decls
    ).toEqual({});
  });
});

describe("originDecls — in normal flow", () => {
  it("offsets `translate` on a west drag", () => {
    const out = originDecls(
      start({ positioned: false, translate: { x: 4, y: 0 } }),
      shift({ left: -20 })
    );
    expect(out.decls).toEqual({ translate: "-16px 0px" });
  });

  it("offsets the vertical component on a north drag", () => {
    const out = originDecls(
      start({ positioned: false, translate: { x: 3, y: 7 } }),
      shift({ top: -10 })
    );
    expect(out.decls).toEqual({ translate: "3px -3px" });
  });

  it("carries both components when a corner drag moves both edges", () => {
    const out = originDecls(
      start({ positioned: false }),
      shift({ left: -10, top: -20 })
    );
    expect(out.decls).toEqual({ translate: "-10px -20px" });
  });

  it("writes nothing for a south-east drag", () => {
    expect(
      originDecls(start({ positioned: false }), shift({ bottom: 9, right: 9 }))
        .decls
    ).toEqual({});
  });
});
