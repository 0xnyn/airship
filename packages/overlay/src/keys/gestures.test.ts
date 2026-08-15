import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_GESTURES } from "./catalog";

/*
 * Keeping the gesture table honest, in both directions.
 *
 * Gestures cannot be `run()` callbacks — space-to-pan is a state between a
 * keydown and a keyup, a wheel is a stream — so unlike a command, nothing about
 * a gesture is checked by the compiler. The table is prose, and prose about
 * code rots.
 *
 * So it is checked by scanning, the way `tooltip.copy.test.ts` checks tooltip
 * copy and `scripts/check-css.mjs` checks the no-transition rule:
 *
 * - **Forward.** Every `impl` resolves — the file exists and the symbol is in
 *   it. A renamed handler fails here rather than leaving a row that describes
 *   nothing.
 * - **Backward.** Every file that registers a pointer or wheel listener is
 *   named by some row. This is the half that matters in a year: it catches the
 *   right-drag somebody adds and never documents, which is precisely how the
 *   input surface got into the state this table was written to fix.
 */

/** Product source only — no tests, no stories. */
const SKIP = /\.(test|stories)\.ts$/;

function srcRoot(): string {
  // Turbo runs vitest from either the package or the repo root.
  for (const base of ["src", join("packages", "overlay", "src")]) {
    if (existsSync(base)) {
      return base;
    }
  }
  throw new Error("Cannot find the overlay source tree from this cwd.");
}

const SRC = srcRoot();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") && !SKIP.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Files that legitimately listen for a pointer event and are not gestures.
 *
 * Each is a *mechanism* rather than something a user performs, which is the
 * line the table draws. Keep this list short and give every entry a reason —
 * an unexplained addition here is how a real gesture goes undocumented.
 */
const NOT_GESTURES: Readonly<Record<string, string>> = {
  "canvas/device-menu.ts":
    "stops a press in the size field from reading as picking the row it sits in",
  "chat/model-menu.ts":
    "same as device-menu: stops a press in the model field from reading as picking the row it sits in",
  "chat/transcript.ts":
    "latches the text selection before the button collapses it",
  "chrome-layer.ts": "hosts chrome; the listeners are its children's",
  "dnd/manager.ts": "the drag sensor itself, under every drag gesture",
  "edit-guard.ts":
    "swallows presses so the host app stays inert; the opposite of a gesture",
  "frame-agent.ts":
    "forwards a frame's events up to the shell, which is where they are handled",
  "inspector/controls/color-picker.ts":
    "dragging a slider inside an open control, not a canvas gesture",
  "inspector/controls/gradient-editor.ts":
    "same: a slider inside an open control",
  "inspector/reorder.ts": "the DOM-tree drag, driven by the dnd manager above",
  "inspector/text-edit.ts":
    "click-away from a live caret, which the browser owns",
  "keys/palette.ts":
    "a result row activating, which is a click and not a gesture",
  "popover-host.ts": "outside-press to close, which every popover has",
  "shell-app.ts":
    "routes a frame's forwarded wheel to the canvas; the gesture is the canvas's",
  "tooltip.ts": "hover to open a label",
};

/** A listener registration for something a user does with a pointer. */
const POINTER_LISTENER =
  /addEventListener\(\s*["'](wheel|pointerdown|mousedown|contextmenu|dblclick|auxclick|gesturestart|touchstart)["']/;

/** `path/to/file.ts#symbol`. */
const IMPL_SHAPE = /^[\w/-]+\.ts#\w+$/;

const files = sourceFiles(SRC);

describe("every declared gesture is real", () => {
  it("finds the source tree", () => {
    // A scan that matched nothing would make both directions pass vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it("resolves every `impl` to a file and a symbol", () => {
    const broken: string[] = [];
    for (const gesture of ALL_GESTURES) {
      const [rel, symbol] = gesture.impl.split("#");
      const path = join(SRC, ...rel.split("/"));
      if (!existsSync(path)) {
        broken.push(`${gesture.id}: no such file ${rel}`);
        continue;
      }
      const source = readFileSync(path, "utf8");
      if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
        broken.push(`${gesture.id}: ${rel} has no \`${symbol}\``);
      }
    }
    expect(broken).toEqual([]);
  });

  it("spells every `impl` as `path/to/file.ts#symbol`", () => {
    const malformed = ALL_GESTURES.filter((g) => !IMPL_SHAPE.test(g.impl)).map(
      (g) => `${g.id}: ${g.impl}`
    );
    expect(malformed).toEqual([]);
  });
});

describe("every real gesture is declared", () => {
  it("names every file that listens for a pointer gesture", () => {
    const declared = new Set(ALL_GESTURES.map((g) => g.impl.split("#")[0]));
    const undocumented: string[] = [];
    for (const path of files) {
      const rel = path
        .slice(SRC.length + 1)
        .split(sep)
        .join("/");
      if (declared.has(rel) || rel in NOT_GESTURES) {
        continue;
      }
      if (POINTER_LISTENER.test(readFileSync(path, "utf8"))) {
        undocumented.push(rel);
      }
    }
    // A file here is either a gesture nobody wrote down — add it to `GESTURES`
    // — or a mechanism, in which case add it to `NOT_GESTURES` with a reason.
    expect(undocumented).toEqual([]);
  });

  it("keeps the exemption list explained", () => {
    const unexplained = Object.entries(NOT_GESTURES)
      .filter(([, why]) => why.length < 20)
      .map(([file]) => file);
    expect(unexplained).toEqual([]);
  });
});
