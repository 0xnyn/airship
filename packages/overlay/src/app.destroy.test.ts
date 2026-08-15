import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirshipApp, claimBoot, publishDestroy, type Stage } from "./app";
import { ChromeLayer } from "./chrome-layer";
import { PREFIX } from "./dom";
import { keys, PLATFORM } from "./keys/registry";
import { InlineResolver } from "./surface";

/*
 * Taking the overlay back down.
 *
 * There was no teardown at all until this file's subject existed, which is
 * survivable exactly as long as an overlay is never rebuilt in a page — and
 * `?__airship=inline` rebuilds one on every HMR cycle. What each cycle left
 * behind was a second full set of capture-phase key bindings, every one
 * `preventDefault`-ing for a `when()` that closed over a dead panel. The
 * symptom is not a crash; it is ⌘Z quietly doing nothing, and the more times
 * you save the file the worse it gets.
 *
 * `localStorage` is stubbed per-case: happy-dom exposes a bare object, so the
 * dock-geometry reads and writes in `mount` would otherwise silently no-op and
 * take a chunk of the mount path with them.
 */

/** A stage with nothing in it, which is all `mount` requires. */
function stubStage(): Stage & { destroyed: number } {
  const layer = new ChromeLayer();
  return {
    destroy() {
      this.destroyed += 1;
    },
    destroyed: 0,
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

/**
 * `mod` is ⌘ on a Mac and Ctrl elsewhere — one of them, not both.
 *
 * Setting both was the shortcut here and in `keys/registry.test.ts`, on the
 * grounds that "either branch matches". It also produces a keystroke no keyboard
 * can send, and `chordOf` now refuses one carrying the modifier its platform
 * does not use — so both-at-once is precisely the thing that must *not* fire.
 */
function press(key: string, opts: { mod?: boolean } = {}): KeyboardEvent {
  const mod = opts.mod ?? false;
  const onMac = PLATFORM === "mac";
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: mod && !onMac,
    key,
    metaKey: mod && onMac,
  });
  document.body.dispatchEvent(e);
  return e;
}

const apps: AirshipApp[] = [];
/** Every socket the stub handed out this case. */
const sockets: { closed: boolean }[] = [];

function mount(): { app: AirshipApp; stage: ReturnType<typeof stubStage> } {
  const stage = stubStage();
  const app = new AirshipApp(
    { mode: "inline", wsPath: "/__airship/ws" },
    stage
  );
  app.mount();
  apps.push(app);
  return { app, stage };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubStorage();
  sockets.length = 0;
  vi.stubGlobal(
    "WebSocket",
    class {
      closed = false;
      onclose: (() => void) | null = null;
      constructor() {
        sockets.push(this);
      }
      addEventListener() {
        // Never opens; nothing here is about what the socket carries.
      }
      close() {
        this.closed = true;
        // A real socket fires this, and firing it is what used to schedule the
        // next reconnect. The case below is about that not happening.
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
  keys.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirshipApp.destroy", () => {
  it("takes the overlay root out of the page", () => {
    const { app } = mount();
    expect(document.querySelector(`#${PREFIX}-root`)).not.toBeNull();

    app.destroy();

    expect(document.querySelector(`#${PREFIX}-root`)).toBeNull();
  });

  it("stops answering keystrokes", () => {
    const { app } = mount();
    // Bound by `bindEditorKeys`, and live because `mount` lands in edit mode.
    expect(press("z", { mod: true }).defaultPrevented).toBe(true);

    app.destroy();

    expect(press("z", { mod: true }).defaultPrevented).toBe(false);
  });

  it("hands the stage its own teardown", () => {
    const { app, stage } = mount();

    app.destroy();

    expect(stage.destroyed).toBe(1);
  });

  it("closes the socket and stops it reconnecting", () => {
    // The reconnect loop is self-sustaining: `onclose` schedules the next
    // attempt, so closing the socket is what *causes* it to come back. Before
    // `AirshipSocket.destroy` existed, every torn-down overlay left one live
    // socket per HMR cycle, each holding a listener closed over a dead app.
    const { app } = mount();
    expect(sockets).toHaveLength(1);

    app.destroy();
    vi.advanceTimersByTime(5000);

    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(1);
  });

  it("leaves nothing behind for a second mount to double up on", () => {
    // The HMR shape, and the reason any of this exists: one keystroke must run
    // one command, however many overlays this page has been through.
    const first = mount();
    first.app.destroy();
    mount();

    const e = press("z", { mod: true });

    expect(e.defaultPrevented).toBe(true);
    expect(keys.conflicts()).toEqual([]);
  });
});

/*
 * The claim is what decides whether any of the above ever runs in production.
 *
 * It used to be `window.__airshipBooted`, which cannot tell a second `boot()`
 * from this bundle apart from a bundle the dev server swapped in — the flag
 * survives the swap for the same reason the teardown hook does. So the incoming
 * bundle was turned away one line *before* `__airshipDestroy?.()`, and every
 * `destroy` in this file was unreachable outside this file.
 */
describe("boot claim", () => {
  const hook = (): (() => void) | undefined =>
    (window as unknown as { __airshipDestroy?: () => void }).__airshipDestroy;

  afterEach(() => {
    // Release whatever the case left held: the flag is module state, so it
    // outlives the case that set it.
    hook()?.();
    (window as unknown as { __airshipDestroy?: () => void }).__airshipDestroy =
      undefined;
  });

  it("turns away a second boot from the same bundle", () => {
    expect(claimBoot()).toBe(true);
    // Every real boot publishes immediately after claiming, and the `afterEach`
    // above needs the hook to hand the claim back.
    publishDestroy(() => undefined);

    expect(claimBoot()).toBe(false);
  });

  it("frees the claim when the published teardown runs", () => {
    // What an incoming bundle triggers on its way in. Running it has to leave
    // the page claimable, or the replacement is turned away and the swap leaves
    // two overlays where the whole mechanism exists to leave one.
    const down = vi.fn();
    expect(claimBoot()).toBe(true);
    publishDestroy(down);

    hook()?.();

    expect(down).toHaveBeenCalledTimes(1);
    expect(claimBoot()).toBe(true);
  });

  it("does not tear down the overlay it just built", () => {
    // The refused claim must be inert. An early `return` that still ran the
    // hook would take down the live overlay on a stray second `boot()`.
    const down = vi.fn();
    claimBoot();
    publishDestroy(down);

    expect(claimBoot()).toBe(false);
    expect(down).not.toHaveBeenCalled();
  });
});
