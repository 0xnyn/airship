/**
 * How tall a panel is allowed to be, and what "no height" means.
 *
 * Tested as a free function rather than through `AirshipApp`, for the reason
 * `dock-gate.test.ts` gives about its own: standing up a socket, a dnd-kit
 * manager and a live document to check a clamp is a test of the mount path.
 *
 * The interesting case is not the clamp, it is the **0 sentinel**. A docked
 * panel is anchored `top` and `bottom` and fills its edge until a drag pins it,
 * so `size[side].h` of 0 means *unpinned* — and `clampHeight`'s floor is
 * `MIN_DOCK_H`, which would turn a stored 0 into 200 on the way back in. That
 * was harmless for as long as docked mode ignored the number; the moment
 * `.dock-h` started reading it, a round trip through `localStorage` would have
 * silently pinned every panel in every install to a fifth of the window. Hence
 * the guard in `restoreSizes`, and hence this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirshipApp, clampHeight, type Stage } from "./app";
import { ChromeLayer } from "./chrome-layer";
import { cls, PREFIX } from "./dom";
import { MIN_DOCK_H } from "./styles/const";
import { InlineResolver } from "./surface";

/** The dock's inset from the viewport edge — `--ap-space-md`. */
const INSET = 20;

/** A stage with nothing in it, which is all `mount` requires. */
function stubStage(): Stage {
  const layer = new ChromeLayer();
  return {
    destroy() {
      // Nothing to take down.
    },
    layer,
    mount() {
      layer.mount(document.body);
    },
    onLayoutChange() {
      // Nothing moves under a stage with no content.
    },
    resolver: new InlineResolver(),
    swallowPresses: true,
  };
}

function stubStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: () => null,
      length: 0,
      removeItem: (k: string) => store.delete(k),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
}

const apps: AirshipApp[] = [];

function mount(): AirshipApp {
  const app = new AirshipApp(
    { mode: "inline", wsPath: "/__airship/ws" },
    stubStage()
  );
  app.mount();
  apps.push(app);
  return app;
}

const seed = (key: string, value: unknown): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

beforeEach(() => {
  // happy-dom reports 768 by default; pinned here so the arithmetic below is
  // about the clamp rather than about the environment.
  window.innerHeight = 900;
  vi.useFakeTimers();
  stubStorage();
  vi.stubGlobal(
    "WebSocket",
    class {
      onclose: (() => void) | null = null;
      addEventListener() {
        // Never opens; nothing here is about what the socket carries.
      }
      close() {
        this.onclose?.();
      }
      send() {
        // Nothing to send.
      }
    }
  );
});

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.destroy();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("clampHeight", () => {
  it("keeps a panel taller than a header", () => {
    expect(clampHeight(10)).toBe(MIN_DOCK_H);
    expect(clampHeight(0)).toBe(MIN_DOCK_H);
  });

  it("keeps it inside the room below its top edge", () => {
    // The window less the top offset and the bottom inset — not the whole
    // window, which is what it used to be and which let a docked panel be
    // clamped to a height that ran its foot past the edge it sits on.
    expect(clampHeight(5000)).toBe(900 - INSET - INSET);
    expect(clampHeight(5000, 300)).toBe(900 - 300 - INSET);
  });

  it("leaves a height that already fits alone", () => {
    expect(clampHeight(420)).toBe(420);
  });

  it("never returns less than the floor, however little room there is", () => {
    // A panel dragged to the bottom of a short window has negative room. The
    // floor has to win, or the clamp inverts and `Math.min` picks the wrong end.
    expect(clampHeight(400, 890)).toBe(MIN_DOCK_H);
  });

  it("has no ceiling of its own, unlike the width clamp", () => {
    // `clampWidth` caps at half the viewport, which is right for a side column's
    // width and nonsense for its height: a docked panel wants the whole edge.
    window.innerHeight = 2000;
    expect(clampHeight(1800)).toBe(1800);
  });
});

/*
 * The store, exercised through the real thing.
 *
 * `restoreSizes` is private, so this mounts an app to reach it — the cost the
 * `dockVisible` docstring warns about, paid on purpose here because a *copy* of
 * the guard is exactly what this file must not be. The one edit it exists to
 * prevent is somebody rewriting the sentinel line as
 * `clampHeight(Number(s.h) || 0)`, and a reimplementation of that line in the
 * test cannot fail when the source changes.
 */

const KEY = `${PREFIX}-dock-size`;
const LEGACY_KEY = `${PREFIX}-dock-widths`;

/** Whether a docked panel came back pinned, read off the DOM it drives. */
function pinned(side: "left" | "right"): boolean {
  const el = document.querySelector<HTMLElement>(`.${cls(`dock-${side}`)}`);
  if (!el) {
    throw new Error(`No ${side} dock.`);
  }
  return el.classList.contains(cls("dock-h"));
}

describe("restoring the persisted size", () => {
  it("brings the unpinned sentinel back as unpinned", () => {
    // The regression: `clampHeight`'s floor is `MIN_DOCK_H`, so a stored 0 run
    // through it comes back as 200 — and every docked panel in every install
    // silently pins itself to a fifth of the window on the first reload.
    seed(KEY, { left: { h: 0, w: 340 }, right: { h: 0, w: 360 } });
    mount();

    expect(pinned("left")).toBe(false);
    expect(pinned("right")).toBe(false);
  });

  it("brings a real stored height back pinned, and unclamped", () => {
    // Unclamped in the *store*: clamping on read would make a smaller window
    // permanent, which is the one-way trip `clampPlacements` refuses to take
    // with the floating height. `applyPlacement` clamps what is painted.
    seed(KEY, { left: { h: 5000, w: 340 }, right: { h: 300, w: 360 } });
    mount();

    expect(pinned("left")).toBe(true);
    expect(pinned("right")).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue(`--${PREFIX}-right-h`)
    ).toBe("300px");
  });

  it("migrates the old width-only store rather than dropping it", () => {
    // The previous key held a bare number per side. Losing it would reset every
    // existing install's panel widths on upgrade, which is a rude way to ship a
    // rename.
    seed(LEGACY_KEY, { left: 300, right: 400 });
    mount();

    expect(
      document.documentElement.style.getPropertyValue(`--${PREFIX}-left-w`)
    ).toBe("300px");
    expect(pinned("left")).toBe(false);
  });

  it("survives a store that is not the shape it expects", () => {
    seed(KEY, { left: { h: "nonsense", w: null }, right: 12 });

    expect(() => mount()).not.toThrow();
    expect(pinned("left")).toBe(false);
  });

  it("round-trips what it wrote", () => {
    seed(KEY, { left: { h: 420, w: 300 }, right: { h: 0, w: 360 } });
    mount();
    const written = localStorage.getItem(KEY);

    document.body.replaceChildren();
    for (const app of apps.splice(0)) {
      app.destroy();
    }
    localStorage.setItem(KEY, written ?? "");
    mount();

    expect(pinned("left")).toBe(true);
    expect(pinned("right")).toBe(false);
  });
});
