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

/** Frame ids sorted by the `z-index` they were given — see `applyOrder`. */
function stacked(): string[] {
  return Array.from(world.children)
    .map((node) => ({
      id: node.getAttribute("data-frame") ?? "?",
      z: Number((node as HTMLElement).style.zIndex),
    }))
    .sort((a, b) => a.z - b.z)
    .map((entry) => entry.id);
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

/*
 * `reorder` — the frame list's drag-to-restack.
 *
 * The DOM assertions here are the interesting ones and they are deliberately
 * *negative*: reorder must leave the document untouched. Moving an `iframe`
 * between parents (or between siblings) tears down its browsing context and
 * reloads it, so the obvious implementation — splice the array, then
 * `.before()` the element the way `restoreRemoved` does — would reboot the app
 * inside any frame you dragged, losing its route and scroll position. Paint
 * order is published as `z-index` instead, which is what `stacked()` reads.
 */
describe("FrameManager.destroy", () => {
  it("takes its global down with it", () => {
    // The hook is a closure over the manager, hung off `window` by the
    // constructor. Left behind, it keeps a destroyed manager and every frame it
    // ever built reachable — and points the next frame that loads at an array
    // that has just been emptied.
    const host = window as unknown as { __airshipOnFrameReady?: unknown };
    add("one");
    expect(typeof host.__airshipOnFrameReady).toBe("function");

    frames.destroy();
    expect(host.__airshipOnFrameReady).toBeUndefined();
  });

  it("leaves a newer manager's hook alone", () => {
    // Construction order is the trap: a second manager has already overwritten
    // the global, so a late `destroy` on the first must not take the live one
    // down with it.
    const host = window as unknown as { __airshipOnFrameReady?: unknown };
    const older = frames;
    const newer = manager();
    const live = host.__airshipOnFrameReady;

    older.destroy();
    expect(host.__airshipOnFrameReady).toBe(live);

    frames = newer;
  });
});

describe("FrameManager.reorder", () => {
  it("moves the frame in the array and restacks without touching the DOM", () => {
    add("one");
    add("two");
    add("three");

    frames.reorder("f3", 0);

    expect(order()).toEqual(["f3", "f1", "f2"]);
    // The bug this exists to prevent: no element moved, so no iframe reloaded.
    expect(painted()).toEqual(["f1", "f2", "f3"]);
    // …and paint order still agrees with the array, via z-index.
    expect(stacked()).toEqual(["f3", "f1", "f2"]);
  });

  it("moves a frame later in the list", () => {
    add("one");
    add("two");
    add("three");

    frames.reorder("f1", 2);

    expect(order()).toEqual(["f2", "f3", "f1"]);
    expect(stacked()).toEqual(["f2", "f3", "f1"]);
  });

  it("clamps an overshooting drag to the ends of the list", () => {
    add("one");
    add("two");
    add("three");

    frames.reorder("f1", 99);
    expect(order()).toEqual(["f2", "f3", "f1"]);

    frames.reorder("f1", -4);
    expect(order()).toEqual(["f1", "f2", "f3"]);
  });

  it("does nothing for an unknown id or a move to the same slot", () => {
    add("one");
    add("two");
    let changes = 0;
    // `onChanged` is what re-renders the canvas and persists the layout; a
    // no-op reorder that still fired it would save on every settled drag.
    frames = new FrameManager({
      onChanged: () => {
        changes += 1;
      },
      pathname: "/",
      storageKey: "__airship-test:frames",
      world,
    });
    add("a");
    add("b");
    changes = 0;

    frames.reorder("nope", 0);
    frames.reorder(frames.all[0].id, 0);

    expect(changes).toBe(0);
    expect(order()).toEqual(["f1", "f2"]);
  });

  it("keeps z-index in step as frames come and go", () => {
    add("one");
    add("two");
    add("three");
    const removed = frames.remove("f2");

    expect(stacked()).toEqual(["f1", "f3"]);

    expect(removed && frames.restoreRemoved(removed)).toBe(true);
    expect(stacked()).toEqual(["f1", "f2", "f3"]);
  });
});
