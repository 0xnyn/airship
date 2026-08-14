/**
 * Where an SVG paint edit must land.
 *
 * The fixture shapes mirror what icon libraries really emit: a lucide-style
 * chevron (`stroke="currentColor" fill="none" stroke-width="2"` on the path),
 * a heroicons-solid-style glyph (`fill="currentColor"`), and a multi-shape
 * illustration with literal paints. The wiring test at the bottom drives the
 * rendered section through a recording context, because the routing decision
 * lives in `renderVector`'s write closure — asserting on `planVector` alone
 * would not catch the closure writing to the wrong place.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { SectionContext } from "./sections/context";
import { renderVector } from "./sections/vector";
import { planVector, vectorSeed, vectorShapeKey } from "./svg-paint";

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

function svg(inner: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg viewBox="0 0 24 24">${inner}</svg>`;
  document.body.append(host);
  return host.firstElementChild as SVGSVGElement;
}

const CHEVRON = `<path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

describe("planVector", () => {
  it("routes a currentColor stroke through the root's color", () => {
    const root = svg(CHEVRON);
    expect(planVector(root, "stroke").kind).toBe("color");
  });

  it("fans a literal paint to the shapes that declare it", () => {
    const root = svg(`<path fill="#f00"/><rect fill="#0f0"/>`);
    const plan = planVector(root, "fill");
    expect(plan.kind).toBe("fan");
    if (plan.kind === "fan") {
      expect(plan.owners).toHaveLength(2);
    }
  });

  it("mixed owners fall to fan, currentColor ones included", () => {
    // Converting the currentColor one to a literal is the accepted trade for
    // a mixed icon — `color` would repaint only half of it.
    const root = svg(`<path fill="currentColor"/><rect fill="#0f0"/>`);
    expect(planVector(root, "fill").kind).toBe("fan");
  });

  it("writes to self when no shape declares the property", () => {
    const root = svg(`<path d="M0 0h24v24H0z"/>`);
    expect(planVector(root, "fill").kind).toBe("self");
  });

  it("never routes a non-paint property through color", () => {
    // `stroke-width: currentColor` is not a thing; only fill/stroke resolve it.
    const root = svg(`<path stroke-width="2"/>`);
    expect(planVector(root, "stroke-width").kind).toBe("fan");
  });

  it("reads inline style as a declaration too", () => {
    const root = svg(`<path style="fill: #f00"/>`);
    expect(planVector(root, "fill").kind).toBe("fan");
  });

  it("treats a non-root as self — the cascade argument holds on the shape", () => {
    const root = svg(CHEVRON);
    const path = root.querySelector("path") as Element;
    expect(planVector(path, "stroke").kind).toBe("self");
  });
});

describe("vectorSeed", () => {
  it("reads the owner, not the root", () => {
    // The quiet half of the bug: `fill`'s initial value is black, so reading
    // the root showed a black swatch for an icon whose paint says otherwise.
    const root = svg(`<path style="fill: rgb(255, 0, 0)"/>`);
    expect(vectorSeed(root, "fill")).toBe("rgb(255, 0, 0)");
  });

  it("reads the root when nothing shadows it", () => {
    const root = svg(`<path d="M0 0"/>`);
    (root as unknown as { style: CSSStyleDeclaration }).style.setProperty(
      "fill",
      "rgb(0, 128, 0)"
    );
    expect(vectorSeed(root, "fill")).toBe("rgb(0, 128, 0)");
  });
});

describe("vectorShapeKey", () => {
  it("changes when a child's paint flips between editable and not", () => {
    const root = svg(`<path style="fill: rgb(255, 0, 0)"/>`);
    const before = vectorShapeKey(root);
    const path = root.querySelector("path") as SVGElement;
    path.style.setProperty("fill", "url(#grad)");
    expect(vectorShapeKey(root)).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The section's write routing, end to end through the rendered rows.
// ---------------------------------------------------------------------------

interface Recorded {
  batches: number;
  changes: [string, string][];
  colorRows: Map<string, (next: string) => void>;
  flashes: Element[];
  /** What each row handed `colorRow` as its bindable properties, by tip. */
  properties: Map<string, readonly string[]>;
  records: [Element, string, string][];
  /** Every `writeOn`: the nodes it targeted, the declaration, and its opts. */
  writes: {
    nodes: readonly Element[];
    opts?: { standIn?: boolean };
    property: string;
    value: string;
  }[];
}

/** A SectionContext that records writes and captures each colour row's commit. */
function recordingCtx(): { ctx: SectionContext; got: Recorded } {
  const got: Recorded = {
    batches: 0,
    changes: [],
    colorRows: new Map(),
    flashes: [],
    properties: new Map(),
    records: [],
    writes: [],
  };
  const stub = document.createElement("div");
  const ctx = {
    batch: (run: () => void) => {
      got.batches += 1;
      run();
    },
    colorRow: (
      _value: string,
      tip: string,
      onChange: (next: string) => void,
      _node?: Element,
      properties: readonly string[] = []
    ) => {
      got.colorRows.set(tip, onChange);
      // Captured because this is what buys the row its token badge, and the
      // badge writes through the panel rather than through the row's own
      // commit — so a row can be correctly routed and its badge not be.
      got.properties.set(tip, properties);
      return stub.cloneNode() as HTMLElement;
    },
    fieldCell: () => stub.cloneNode() as HTMLElement,
    flash: (node: Element) => {
      got.flashes.push(node);
    },
    gestures: {},
    onChange: (property: string, value: string) => {
      got.changes.push([property, value]);
    },
    recordOn: (node: Element, property: string, value: string) => {
      got.records.push([node, property, value]);
    },
    register: () => undefined,
    section: (_id: string, _label: string, body: HTMLElement) => body,
    writeOn: (
      nodes: readonly Element[],
      property: string,
      value: string,
      opts?: { standIn?: boolean }
    ) => {
      got.writes.push({ nodes, opts, property, value });
      // Mirrors `panel.write`: one batch, one `recordOn` per node. The records
      // are what the older assertions below read.
      got.batches += 1;
      for (const node of nodes) {
        got.records.push([node, property, value]);
      }
    },
  } as unknown as SectionContext;
  return { ctx, got };
}

describe("renderVector write routing", () => {
  it("writes color on the svg for a currentColor stroke", () => {
    const root = svg(CHEVRON);
    const { ctx, got } = recordingCtx();
    renderVector(ctx, root);
    const stroke = got.colorRows.get("Stroke");
    expect(stroke).toBeDefined();
    stroke?.("rgb(255, 0, 0)");
    // The write landed on `color`, on the selection — never on `stroke`,
    // which the path's own presentation attribute would shadow. (The row's
    // no-width implication may also fire here: happy-dom cannot compute an
    // attribute-declared stroke-width, and that write correctly fans.)
    expect(got.changes.some(([p]) => p === "color")).toBe(true);
    expect(got.changes.some(([p]) => p === "stroke")).toBe(false);
    expect(got.records.filter(([, p]) => p === "stroke")).toHaveLength(0);
  });

  it("fans a literal fill to each declaring shape in one batch", () => {
    const root = svg(
      `<path style="fill: rgb(255, 0, 0)"/><rect style="fill: rgb(255, 0, 0)"/>`
    );
    const { ctx, got } = recordingCtx();
    renderVector(ctx, root);
    got.colorRows.get("Fill")?.("rgb(0, 0, 255)");
    expect(got.batches).toBe(1);
    expect(got.records).toHaveLength(2);
    expect(got.records.every(([, p]) => p === "fill")).toBe(true);
    // The flash is the affordance for a write landing off-selection.
    expect(got.flashes).toHaveLength(2);
    expect(got.changes).toHaveLength(0);
  });

  it("writes the property on the selection when nothing shadows it", () => {
    const root = svg(`<path d="M0 0"/>`);
    const { ctx, got } = recordingCtx();
    renderVector(ctx, root);
    got.colorRows.get("Fill")?.("rgb(0, 0, 255)");
    expect(got.changes).toEqual([["fill", "rgb(0, 0, 255)"]]);
    expect(got.records).toHaveLength(0);
  });
});

/*
 * The four ways this section used to claim something it did not do.
 *
 * The routing above decides where a paint edit lands. Four separate things then
 * ignored that answer: the token badge wrote to the root every child shadows,
 * the owner scan produced a plan derived from a partial view, the fanned write
 * never told the composer it happened, and it recorded itself as a plain
 * resting-state instance edit even under a scope or a forced state.
 */

/** Shapes that each declare their own literal paint, so the plan is a fan. */
function manyShapes(count: number, paint = "currentColor"): SVGSVGElement {
  const shapes = Array.from(
    { length: count },
    () => `<path fill="${paint}"/>`
  ).join("");
  return svg(shapes);
}

describe("the token badge follows the plan", () => {
  it("offers `color` on a currentColor icon, not the paint property", () => {
    /*
     * The bug: the row's own commit correctly wrote `color` on the root while
     * the badge beside it wrote `fill` there — a declaration the path's own
     * `fill="currentColor"` shadows. The token was recorded and the chip
     * appeared; nothing repainted.
     */
    const { ctx, got } = recordingCtx();
    renderVector(ctx, svg(CHEVRON));
    expect(got.properties.get("Stroke")).toEqual(["color"]);
  });

  it("offers the property itself when nothing shadows the root", () => {
    const { ctx, got } = recordingCtx();
    renderVector(ctx, svg(`<path d="M0 0"/>`));
    expect(got.properties.get("Fill")).toEqual(["fill"]);
  });

  it("offers nothing on a fan, rather than a binding it cannot honour", () => {
    // No property stands for "this value on each of N shapes", and the shapes a
    // fan writes to often live in node_modules.
    const { ctx, got } = recordingCtx();
    renderVector(
      ctx,
      svg(
        `<path style="fill: rgb(255,0,0)"/><rect style="fill: rgb(0,255,0)"/>`
      )
    );
    expect(got.properties.get("Fill")).toEqual([]);
  });
});

describe("a truncated owner scan", () => {
  it("never routes through color, because it cannot prove allCurrent", () => {
    /*
     * The sharp edge. `allCurrent` used to be quantified over the truncated
     * list, so a literal-paint shape past the cap yielded `color` — one
     * declaration on the root, and every shape past the cap never repainting.
     * A wrong route, not a short one.
     */
    const plan = planVector(manyShapes(250), "fill");
    expect(plan.kind).toBe("fan");
    expect(plan.truncated).toBe(true);
  });

  it("still routes through color when the scan is complete", () => {
    const plan = planVector(manyShapes(3), "fill");
    expect(plan.kind).toBe("color");
    expect(plan.truncated).toBe(false);
  });

  it("caps owners rather than the walk, so document order cannot decide", () => {
    /*
     * The cap used to be `Math.min(all.length, OWNER_CAP)` over
     * `querySelectorAll("*")` — a cap on *document order*, so a `<defs>` block
     * and a few nested `<g>`s could spend the budget before the first shape.
     * Here 40 non-declaring wrappers precede the shapes; both are still found.
     */
    const filler = "<g></g>".repeat(40);
    const root = svg(`${filler}<path fill="#f00"/><rect fill="#f00"/>`);
    const plan = planVector(root, "fill");
    expect(plan.truncated).toBe(false);
    expect(plan.kind).toBe("fan");
    if (plan.kind === "fan") {
      expect(plan.owners).toHaveLength(2);
    }
  });

  it("shows a read-only note instead of a control that would under-write", () => {
    const { ctx, got } = recordingCtx();
    renderVector(ctx, manyShapes(250));
    // No colour row at all — a swatch here would show a colour the
    // illustration does not have and edit only what was scanned.
    expect(got.colorRows.has("Fill")).toBe(false);
  });
});

describe("the fanned write", () => {
  it("goes through writeOn, so the composer is told", () => {
    /*
     * It was a hand-rolled `batch` + `recordOn` loop, which is only the
     * recording half: no `drawOutline`, no `notifyChanged`, no `refreshCss`. A
     * fanned paint edit sat in the change set with no chip until something
     * unrelated fired a notify.
     */
    const { ctx, got } = recordingCtx();
    renderVector(
      ctx,
      svg(
        `<path style="fill: rgb(255,0,0)"/><rect style="fill: rgb(255,0,0)"/>`
      )
    );
    got.colorRows.get("Fill")?.("rgb(0, 0, 255)");
    expect(got.writes).toHaveLength(1);
    expect(got.writes[0].property).toBe("fill");
    expect(got.writes[0].nodes).toHaveLength(2);
  });

  it("stands in for the selection, keeping its scope and forced state", () => {
    /*
     * `recordOn` gives a node outside the selection no target at all, which is
     * right for the alignment row's flex parent and wrong here: these shapes
     * are where *this* selection's paint had to land. Without the flag,
     * painting a `.icon`-scoped or `:hover`-forced icon recorded a plain
     * resting-state instance edit on each shape.
     */
    const { ctx, got } = recordingCtx();
    renderVector(
      ctx,
      svg(
        `<path style="fill: rgb(255,0,0)"/><rect style="fill: rgb(255,0,0)"/>`
      )
    );
    got.colorRows.get("Fill")?.("rgb(0, 0, 255)");
    expect(got.writes[0].opts?.standIn).toBe(true);
  });
});
