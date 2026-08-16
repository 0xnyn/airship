import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirshipApp, type Stage } from "./app";
import { ChromeLayer } from "./chrome-layer";
import { cls } from "./dom";
import { InlineResolver } from "./surface";

/*
 * Where things sit in the bottom bar.
 *
 * The bar is `left: 50%` with a `-50%` translate, so it is the *bar* that is
 * centred and any control's offset from the middle is (what precedes it − what
 * follows it) / 2. The two help buttons used to precede the mode toggle and
 * almost nothing followed it, which pushed Edit/View — the one control you aim
 * at without looking — well right of centre with a pair of glyphs sitting in the
 * middle instead.
 *
 * happy-dom does no layout, so what is asserted here is the *order*, which is
 * the input to that arithmetic. The pixels are a matter for the browser tier and
 * for looking at it.
 *
 * `localStorage` is stubbed for the reason `app.destroy.test.ts` gives: happy-dom
 * exposes a bare object, so the dock-geometry reads and writes in `mount` would
 * silently no-op and take a chunk of the mount path with them.
 */

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

function bar(): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.${cls("bar")}`);
  if (!found) {
    throw new Error("The bar is not mounted.");
  }
  return found;
}

/** Index of a bar child by the command it is wired to. */
function at(command: string): number {
  return [...bar().children].findIndex(
    (node) => node.getAttribute("data-key") === command
  );
}

beforeEach(() => {
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

describe("the bottom bar's order", () => {
  it("puts the two help surfaces last", () => {
    mount();

    const kids = [...bar().children];
    expect(kids.at(-2)?.getAttribute("data-key")).toBe("help.palette");
    expect(kids.at(-1)?.getAttribute("data-key")).toBe("help.shortcuts");
  });

  it("leaves the mode toggle with something on both sides of it", () => {
    // The whole point of moving them: a toggle with everything before it and
    // nothing after it cannot sit in the middle of a centred bar.
    mount();

    // By its content, not by a class: the surface switcher beside it is also a
    // `.seg-group`, and this case is about the Edit/View pair specifically.
    const toggle = [...bar().children].findIndex((node) =>
      [...node.querySelectorAll("button")].some(
        (btn) => btn.textContent?.trim() === "Edit"
      )
    );

    expect(toggle).toBeGreaterThan(0);
    expect(toggle).toBeLessThan(bar().children.length - 1);
  });

  it("keeps the palette ahead of the shortcuts sheet", () => {
    // ⌘K before ?, which is the order they are learned in and the order the
    // Help group lists them in the catalog.
    mount();

    expect(at("help.palette")).toBeLessThan(at("help.shortcuts"));
  });

  it("divides them from the mode toggle with a separator of their own", () => {
    // Not `bar-sep-tools`, which the inline overlay hides along with the stage
    // slot it divides — inline that slot is empty, so a shared separator would
    // leave the pair welded to the toggle.
    mount();

    const kids = [...bar().children];
    const sep = kids[at("help.palette") - 1];

    expect(sep.classList.contains(cls("bar-sep"))).toBe(true);
    expect(sep.classList.contains(cls("bar-sep-tools"))).toBe(false);
  });
});
