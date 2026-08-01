import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Frame, FrameManager, MAX_FRAMES } from "./frames";

/*
 * `remove` and `restoreRemoved` — the delete/undo pair behind the canvas's
 * frame verbs.
 *
 * A `FrameManager` is cheap to stand up here: it needs a `world` element and a
 * storage key, and it never touches an iframe's `src` unless `mount` or
 * `updateMounts` is called, neither of which these tests do. `frameScreenRect`
 * is only reached through `frameAt`/`updateMounts`, which happy-dom cannot
 * answer for anyway — so paint order is asserted structurally, against the array
 * and the DOM, which is where the bug it guards actually lives.
 */

let world: HTMLElement;
let frames: FrameManager;

function manager(): FrameManager {
  world = document.createElement("div");
  document.body.append(world);
  return new FrameManager({
    pathname: "/",
    storageKey: "__airship-test:frames",
    world,
  });
}

/** Frame ids in array order — the order `frameAt` resolves hits against. */
function order(): string[] {
  return frames.all.map((f) => f.id);
}

/** Frame ids in DOM order — the order the browser paints them in. */
function painted(): string[] {
  return Array.from(world.children).map(
    (node) => node.getAttribute("data-frame") ?? "?"
  );
}

function add(name: string): Frame {
  const frame = frames.add({ name });
  if (!frame) {
    throw new Error(`add refused: ${name}`);
  }
  return frame;
}

beforeEach(() => {
  // No `onChanged`, so `save` is never reached and `localStorage` stays out of
  // it entirely — `restore` is only called from `CanvasStage`, not from here.
  frames = manager();
});

afterEach(() => {
  frames.destroy();
  world.remove();
});

describe("FrameManager.remove", () => {
  it("hands back where the frame sat and whether it was selected", () => {
    add("one");
    const middle = add("two");
    add("three");
    frames.setActive(middle.id);

    const removed = frames.remove(middle.id);

    expect(removed).not.toBeNull();
    expect(removed?.index).toBe(1);
    expect(removed?.wasActive).toBe(true);
    expect(removed?.stored.name).toBe("two");
    expect(removed?.stored.id).toBe(middle.id);
    expect(frames.active).toBeNull();
    expect(order()).toEqual(["f1", "f3"]);
  });

  it("reports an unselected frame as such", () => {
    const first = add("one");
    const second = add("two");
    frames.setActive(second.id);

    expect(frames.remove(first.id)?.wasActive).toBe(false);
    // Removing something else must not disturb the selection.
    expect(frames.active?.id).toBe(second.id);
  });

  it("returns null for an id that is not there", () => {
    expect(frames.remove("nope")).toBeNull();
  });
});

describe("FrameManager.restoreRemoved", () => {
  it("puts the frame back at its index in the array and in the DOM", () => {
    add("one");
    const middle = add("two");
    add("three");
    const removed = frames.remove(middle.id);

    expect(removed).not.toBeNull();
    expect(painted()).toEqual(["f1", "f3"]);

    expect(removed && frames.restoreRemoved(removed)).toBe(true);

    // Both, and this is the point: `build` appends, so a restore that only
    // spliced the array would paint the frame on top of the one it belongs
    // under, and `frameAt` would then select it where it is not visible.
    expect(order()).toEqual(["f1", "f2", "f3"]);
    expect(painted()).toEqual(["f1", "f2", "f3"]);
  });

  it("restores the geometry and name verbatim", () => {
    const frame = frames.add({ height: 640, name: "Kiosk", width: 900 });
    const removed = frame && frames.remove(frame.id);
    expect(removed && frames.restoreRemoved(removed)).toBe(true);

    const back = frames.byId(frame?.id ?? "");
    expect(back?.name).toBe("Kiosk");
    expect(back?.width).toBe(900);
    expect(back?.height).toBe(640);
    expect(back?.x).toBe(frame?.x);
    expect(back?.y).toBe(frame?.y);
  });

  it("re-selects the frame only if it was selected when it went", () => {
    const first = add("one");
    const second = add("two");
    frames.setActive(first.id);

    const removedFirst = frames.remove(first.id);
    expect(removedFirst && frames.restoreRemoved(removedFirst)).toBe(true);
    expect(frames.active?.id).toBe(first.id);

    frames.setActive(null);
    const removedSecond = frames.remove(second.id);
    expect(removedSecond && frames.restoreRemoved(removedSecond)).toBe(true);
    expect(frames.active).toBeNull();
  });

  it("refuses when the cap has been reached since the delete", () => {
    for (let i = 0; i < MAX_FRAMES; i += 1) {
      add(`f${i}`);
    }
    const removed = frames.remove(frames.all[0].id);
    expect(removed).not.toBeNull();
    // Delete one, add one, then undo: there is no room to put it back.
    expect(frames.add({ name: "filler" })).not.toBeNull();
    expect(removed && frames.restoreRemoved(removed)).toBe(false);
    expect(frames.all).toHaveLength(MAX_FRAMES);
  });

  it("refuses a second restore of the same snapshot", () => {
    const frame = add("one");
    const removed = frames.remove(frame.id);
    expect(removed && frames.restoreRemoved(removed)).toBe(true);
    expect(removed && frames.restoreRemoved(removed)).toBe(false);
    expect(frames.all).toHaveLength(1);
  });

  it("leaves `seq` alone, so a restored id can never be reissued", () => {
    add("one");
    const second = add("two");
    const removed = frames.remove(second.id);
    expect(removed && frames.restoreRemoved(removed)).toBe(true);

    const next = add("three");
    expect(next.id).not.toBe(second.id);
    expect(order()).toEqual(["f1", "f2", "f3"]);
  });
});
