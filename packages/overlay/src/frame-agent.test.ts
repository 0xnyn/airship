import { describe, expect, it } from "vitest";
import { type FrameHost, findHost } from "./frame-agent";

/*
 * The host walk — the fix for the orphaned nested agent (#17).
 *
 * A frame agent used to reach exactly one hop up (`window.parent`), which for
 * a document nested inside another app document — Storybook's preview inside
 * its manager — is a window that exposes no shell hooks, so the agent
 * registered with nobody and every forwarded event vanished. `findHost` walks
 * upward past such windows to the first one carrying the ready hook. Pure
 * function over fake window chains, so every shape is enumerable.
 */

type FakeWindow = Window & FrameHost;

const ready = () => {
  // The walk only checks that a function is present.
};

/** A window whose parent is `parent`, or itself when omitted (a top window). */
function fakeWin(
  overrides: Partial<FrameHost> = {},
  parent?: Window
): FakeWindow {
  const win = { ...overrides } as FakeWindow;
  (win as { parent: Window }).parent = parent ?? win;
  return win;
}

describe("findHost", () => {
  it("finds a shell one hop up", () => {
    const shell = fakeWin({ __airshipOnFrameReady: ready });
    const frame = fakeWin({}, shell);

    expect(findHost(frame)).toBe(shell);
  });

  it("walks past an app document that exposes no hooks", () => {
    // shell → manager (plain app document) → nested preview.
    const shell = fakeWin({ __airshipOnFrameReady: ready });
    const manager = fakeWin({}, shell);
    const nested = fakeWin({}, manager);

    expect(findHost(nested)).toBe(shell);
  });

  it("answers null from a top window with no shell anywhere", () => {
    expect(findHost(fakeWin())).toBeNull();
  });

  it("stops at a cross-origin hop", () => {
    const nested = {} as FakeWindow;
    Object.defineProperty(nested, "parent", {
      get() {
        throw new DOMException("cross-origin");
      },
    });

    expect(findHost(nested)).toBeNull();
  });

  it("stops when reading the hook itself throws", () => {
    const hostile = {} as FakeWindow;
    Object.defineProperty(hostile, "__airshipOnFrameReady", {
      get() {
        throw new DOMException("cross-origin");
      },
    });
    const nested = fakeWin({}, hostile);

    expect(findHost(nested)).toBeNull();
  });

  it("gives up past the depth cap rather than walking forever", () => {
    const shell = fakeWin({ __airshipOnFrameReady: ready });
    let current: Window = shell;
    for (let i = 0; i < 5; i += 1) {
      current = fakeWin({}, current);
    }

    expect(findHost(current)).toBeNull();
  });

  it("ignores a hook that is not a function", () => {
    const decoy = fakeWin({
      __airshipOnFrameReady:
        "yes" as unknown as FrameHost["__airshipOnFrameReady"],
    });
    const nested = fakeWin({}, decoy);

    expect(findHost(nested)).toBeNull();
  });
});
