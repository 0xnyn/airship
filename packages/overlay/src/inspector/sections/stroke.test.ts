/**
 * The Stroke section, on the four edges it speaks for.
 *
 * Nothing tested `renderStroke` at all, and it had six defects of one shape: it
 * claimed things it did not do. Every *read* asked `border-top-*` and answered
 * for the whole box — so `.header { border-bottom: 1px solid #eee }`, the
 * canonical divider, showed as an unstroked element, and four differing edge
 * colours showed as the top one. Three *writes* used the `border-style`
 * shorthand while the file's own header claimed it never did, and one of those
 * was live: `hasStroke` reads the longhands through `ctx.gate`, which does no
 * shorthand expansion, so once *Add stroke* had written a pending `solid` the
 * shorthand `none` could never win and the eye stopped working.
 *
 * The section is driven through a recording context rather than the full panel,
 * for the reason `svg-paint.test.ts` gives: what matters is which properties
 * the closures write, and a stub is the only way to see them.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { SectionContext } from "./context";
import { renderStroke } from "./stroke";

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

interface ColorRow {
  onChange: (next: string) => void;
  properties: readonly string[];
  /** The re-seed escape hatch. Absent is the bug this file was written for. */
  read?: () => string;
  value: string;
}

interface Recorded {
  changes: [string, string][];
  colorRow: ColorRow | null;
  reseeds: number;
}

/** A SectionContext that records writes and captures the colour row's wiring. */
function recordingCtx(): { ctx: SectionContext; got: Recorded } {
  const got: Recorded = { changes: [], colorRow: null, reseeds: 0 };
  const stub = document.createElement("div");
  const ctx = {
    colorRow: (
      value: string,
      _tip: string,
      onChange: (next: string) => void,
      _node?: Element,
      properties: readonly string[] = [],
      read?: () => string
    ) => {
      got.colorRow = { onChange, properties, read, value };
      return stub.cloneNode() as HTMLElement;
    },
    // The real gate is "pending edit, then computed style". Computed alone is
    // enough here: happy-dom applies inline styles, and no test below has a
    // pending edit the DOM has not already taken.
    gate: (node: Element) => (property: string) =>
      getComputedStyle(node).getPropertyValue(property),
    gestures: {},
    headerAction: () => stub.cloneNode() as HTMLElement,
    onChange: (property: string, value: string) => {
      got.changes.push([property, value]);
    },
    register: () => undefined,
    repaintScope: () => (paint: () => void) => paint(),
    reseed: () => {
      got.reseeds += 1;
    },
    section: (_id: string, _label: string, body: HTMLElement) => body,
    tokenSlot: () => null,
  } as unknown as SectionContext;
  return { ctx, got };
}

/** An element with a border, written per-edge so nothing is a shorthand. */
function bordered(edges: Partial<Record<string, string>>): HTMLElement {
  const node = document.createElement("div");
  for (const side of ["top", "right", "bottom", "left"]) {
    node.style.setProperty(`border-${side}-style`, "solid");
    node.style.setProperty(`border-${side}-width`, "1px");
    node.style.setProperty(
      `border-${side}-color`,
      edges[side] ?? "rgb(0, 0, 0)"
    );
  }
  document.body.append(node);
  return node;
}

/** Click a button by its accessible name. */
function press(root: HTMLElement, label: string): void {
  const button = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) {
    throw new Error(`no "${label}" button`);
  }
  button.click();
}

describe("the colour row speaks for four edges", () => {
  it("shows the shared colour when they agree", () => {
    const { ctx, got } = recordingCtx();
    renderStroke(ctx, bordered({}));
    expect(got.colorRow?.value).toBe("rgb(0, 0, 0)");
  });

  it("shows Mixed when they do not", () => {
    // Was: the top edge's colour, imposed on the other three by the first edit.
    const { ctx, got } = recordingCtx();
    renderStroke(
      ctx,
      bordered({ bottom: "rgb(0, 0, 255)", top: "rgb(255, 0, 0)" })
    );
    expect(got.colorRow?.value).toBe("Mixed");
  });

  it("does not call one colour Mixed for being spelled two ways", () => {
    /*
     * The reason this compares with `sameColor` rather than `===`. Once an edit
     * is pending, `applyPreview` has written the picker's modern
     * `rgb(r g b / a)` into the inline style of the edges just written while
     * the rest still read back the engine's legacy form. String equality calls
     * that a disagreement and shows `Mixed` on a box the user just made uniform.
     */
    const node = bordered({});
    node.style.setProperty("border-top-color", "rgb(0 0 0 / 1)");
    const { ctx, got } = recordingCtx();
    renderStroke(ctx, node);
    expect(got.colorRow?.value).not.toBe("Mixed");
  });

  it("imposes a picked colour on all four edges", () => {
    const { ctx, got } = recordingCtx();
    renderStroke(ctx, bordered({ top: "rgb(255, 0, 0)" }));
    got.colorRow?.onChange("rgb(0, 255, 0)");
    expect(got.changes).toEqual([
      ["border-top-color", "rgb(0, 255, 0)"],
      ["border-right-color", "rgb(0, 255, 0)"],
      ["border-bottom-color", "rgb(0, 255, 0)"],
      ["border-left-color", "rgb(0, 255, 0)"],
    ]);
  });
});

describe("the re-seed escape hatch", () => {
  it("is supplied, or the fix dies on the first refresh", () => {
    /*
     * The row registers four properties, and without a `read` the re-seed pass
     * pushes the raw value of each in turn — so `border-left-color` wins and a
     * `Mixed` row silently settles on the left edge after one undo. The
     * assertion is on the wiring because that is where the bug lived.
     */
    const { ctx, got } = recordingCtx();
    renderStroke(
      ctx,
      bordered({ bottom: "rgb(0, 0, 255)", top: "rgb(255, 0, 0)" })
    );
    expect(got.colorRow?.properties).toHaveLength(4);
    expect(got.colorRow?.read).toBeTypeOf("function");
  });

  it("re-derives the same value the seed did", () => {
    // `vector.ts` states the invariant: the seed and the re-seed `read` have to
    // agree, or the next refresh contradicts the render.
    const { ctx, got } = recordingCtx();
    renderStroke(
      ctx,
      bordered({ bottom: "rgb(0, 0, 255)", top: "rgb(255, 0, 0)" })
    );
    expect(got.colorRow?.read?.()).toBe(got.colorRow?.value);
  });
});

describe("every write is a longhand", () => {
  it("hides the stroke with four longhands, not the shorthand", () => {
    /*
     * The known bug. `hasStroke` reads per-edge `border-<edge>-style` through
     * `ctx.gate`, a per-property lookup with no shorthand expansion — so after
     * *Add stroke* had written the longhands once, a pending `solid` on them
     * shadowed the shorthand `none` forever and the eye was a no-op.
     */
    const { ctx, got } = recordingCtx();
    const body = renderStroke(ctx, bordered({}));
    press(body, "Hide stroke");
    expect(got.changes).toEqual([
      ["border-top-style", "none"],
      ["border-right-style", "none"],
      ["border-bottom-style", "none"],
      ["border-left-style", "none"],
    ]);
    expect(got.changes.some(([p]) => p === "border-style")).toBe(false);
  });

  it("removes the stroke with longhands, as it always did", () => {
    // The control this one was already modelled on.
    const { ctx, got } = recordingCtx();
    const body = renderStroke(ctx, bordered({}));
    press(body, "Remove stroke");
    expect(got.changes.map(([p]) => p)).toEqual([
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style",
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
    ]);
    expect(got.changes.some(([p]) => p === "border-style")).toBe(false);
    expect(got.changes.some(([p]) => p === "border-width")).toBe(false);
  });
});
