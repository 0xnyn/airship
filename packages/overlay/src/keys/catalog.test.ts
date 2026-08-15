import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_COMMANDS,
  COMMAND_GROUPS,
  type Command,
  displayChord,
} from "./catalog";

/*
 * The contract the catalog has to keep.
 *
 * Four properties, and the reason each is a test rather than a convention:
 *
 * - **Unique ids and titles.** An id is what code refers to and a duplicate
 *   would silently shadow; a duplicate title makes the palette unreadable, and
 *   the palette is a list of titles.
 * - **No ambiguous chord.** Several pairs share one on purpose and are told
 *   apart by mutually exclusive guards — ⌫ is Delete element in edit mode and
 *   Delete frame in view mode. `canvas/frame-chrome.ts` argues that pairing in
 *   thirty lines of prose and says outright that registration order "is *not*
 *   the guarantee and must not become one". This is where that stops being
 *   prose.
 * - **Every declared command is bound.** The compiler catches an id that does
 *   not exist; nothing catches a command that exists and is bound nowhere,
 *   which is a row in the palette that cannot be run and a line in CONTROLS.md
 *   that is a lie.
 * - **No value imports.** `scripts/gen-controls.mjs` loads `catalog.ts` under
 *   plain Node, where an extensionless value import does not resolve. Type
 *   imports are erased before resolution and are free.
 */

const SKIP = /\.(test|stories)\.ts$/;

/** A chord typed into a menu row by hand, which `command:` should replace. */
const CHORD_HINT = /hint:\s*["'][^"']*[⌘⇧⌥⌃↩⌫]|hint:\s*["']Ctrl\+/;

/** A chord that is not in the registry's normal form. */
const NOT_NORMALISED = /\s/;

/** A value import — the one thing `catalog.ts` may not contain. */
const VALUE_IMPORT = /^import\s+(?!type\b)/;

function srcRoot(): string {
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

/** Modes overlap unless they name two different ones. `any` overlaps all. */
function modesOverlap(a: Command, b: Command): boolean {
  return a.mode === "any" || b.mode === "any" || a.mode === b.mode;
}

/** Same for surfaces, where `both` is the wildcard. */
function surfacesOverlap(a: Command, b: Command): boolean {
  return (
    a.surface === "both" || b.surface === "both" || a.surface === b.surface
  );
}

/**
 * Where a command sits when two answer to one chord.
 *
 * Mirrors `rankOf` in `registry.ts`. A scoped command only fires inside its own
 * element, and a modal one is declared to be in front — so neither can be
 * ambiguous against an ordinary binding, and only same-rank pairs are checked.
 */
function rank(spec: Command): string {
  if (spec.scoped) {
    return "scoped";
  }
  return spec.priority ?? "normal";
}

describe("the command table", () => {
  it("has a unique id for every command", () => {
    const seen = new Set<string>();
    const dupes = ALL_COMMANDS.filter((c) => {
      if (seen.has(c.id)) {
        return true;
      }
      seen.add(c.id);
      return false;
    }).map((c) => c.id);
    expect(dupes).toEqual([]);
  });

  it("has a unique title for every command", () => {
    const seen = new Set<string>();
    const dupes = ALL_COMMANDS.filter((c) => {
      if (seen.has(c.title)) {
        return true;
      }
      seen.add(c.title);
      return false;
    }).map((c) => `${c.id} (${c.title})`);
    expect(dupes).toEqual([]);
  });

  it("declares at least one chord for every command", () => {
    const silent = ALL_COMMANDS.filter((c) => c.keys.length === 0).map(
      (c) => c.id
    );
    expect(silent).toEqual([]);
  });

  it("puts every command in a group the panel renders", () => {
    const orphans = ALL_COMMANDS.filter(
      (c) => !COMMAND_GROUPS.includes(c.group)
    ).map((c) => `${c.id} → ${c.group}`);
    expect(orphans).toEqual([]);
  });

  it("keeps direction-dependent commands out of the palette", () => {
    // The palette invokes `run` with a synthetic event that carries no key, so
    // a command that reads its argument off the keystroke has nothing to act
    // on. Nudge is the case: one command, four arrows, and `run` derives the
    // axis from `e.key` — listed in the palette it rendered a row that did
    // nothing at all, which is the exact failure "only list what is runnable"
    // exists to prevent. `hidden` keeps it out of the palette and in the sheet.
    const directional = ALL_COMMANDS.filter((c) => c.display?.includes("←"));
    expect(directional.length).toBeGreaterThan(0);
    expect(directional.filter((c) => !c.hidden).map((c) => c.id)).toEqual([]);
  });

  it("gives no two commands an ambiguous chord", () => {
    const clashes: string[] = [];
    for (let i = 0; i < ALL_COMMANDS.length; i += 1) {
      for (let j = i + 1; j < ALL_COMMANDS.length; j += 1) {
        const a = ALL_COMMANDS[i];
        const b = ALL_COMMANDS[j];
        if (rank(a) !== rank(b)) {
          continue;
        }
        if (rank(a) === "scoped") {
          continue;
        }
        if (!(modesOverlap(a, b) && surfacesOverlap(a, b))) {
          continue;
        }
        const shared = a.keys.filter((k) => b.keys.includes(k));
        if (shared.length) {
          clashes.push(
            `${a.id} and ${b.id} both answer to ${shared.join(", ")}`
          );
        }
      }
    }
    // Two commands may share a chord only if their modes or surfaces are
    // disjoint, one of them is `scoped`, or one is `modal`. Anything else is a
    // coin flip decided by whichever constructor ran last.
    expect(clashes).toEqual([]);
  });

  it("writes every chord in the registry's own normal form", () => {
    // `mod` then `alt` then `shift` then the key, lowercase — the order
    // `chordOf` emits. A chord spelled any other way silently never matches.
    const malformed = ALL_COMMANDS.flatMap((c) =>
      c.keys
        .filter((k) => k !== k.toLowerCase() || NOT_NORMALISED.test(k))
        .map((k) => `${c.id}: ${k}`)
    );
    expect(malformed).toEqual([]);
  });
});

describe("the table and the code agree", () => {
  const sources = sourceFiles(SRC).filter(
    (p) => !p.endsWith(join("keys", "catalog.ts"))
  );
  const corpus = sources.map((p) => readFileSync(p, "utf8")).join("\n");

  it("binds every command it declares", () => {
    // Ids are dotted and quoted at the binding site, so a plain substring scan
    // has no false positives. The reverse direction is free: `Binding.id` is
    // `CommandId`, so an id that is not declared will not compile.
    const unbound = ALL_COMMANDS.filter(
      (c) => !corpus.includes(`"${c.id}"`)
    ).map((c) => c.id);
    expect(unbound).toEqual([]);
  });

  it("leaves no hand-written chord in a menu row", () => {
    // `MenuItem.hint` is for a size or a unit. A chord typed in there is a copy
    // of the registry that nothing keeps honest — five rows in
    // `canvas/frame-chrome.ts` carried Mac glyphs that Windows users saw
    // unchanged, and one in `chat/transcript.ts` advertised a key that ran a
    // different feature entirely. Use `command:` instead.
    const offenders = sources
      .filter((p) => CHORD_HINT.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("the catalog stays loadable by plain Node", () => {
  const source = readFileSync(join(SRC, "keys", "catalog.ts"), "utf8");

  it("has no value imports", () => {
    // `scripts/gen-controls.mjs` imports this module directly. Node's type
    // stripper erases `import type` before resolution, so those are free, but a
    // real import would need a file extension this repo does not write.
    const values = source.split("\n").filter((line) => VALUE_IMPORT.test(line));
    expect(values).toEqual([]);
  });

  it("still declares the table it is supposed to", () => {
    // A guard on the guard: a scan of an empty file passes everything.
    expect(ALL_COMMANDS.length).toBeGreaterThan(20);
  });
});

describe("rendering a chord", () => {
  it("spells the same chord differently per platform", () => {
    expect(displayChord("mod+shift+z", "mac")).toBe("⌘⇧Z");
    expect(displayChord("mod+shift+z", "pc")).toBe("Ctrl+Shift+Z");
  });

  it("takes the platform as an argument rather than probing", () => {
    // Node ≥21 defines `globalThis.navigator` with an undefined `platform`, so
    // a probe inside this function would have the docs generator emit the
    // Windows spelling for every reader of both columns.
    expect(displayChord("mod+k", "mac")).not.toBe(displayChord("mod+k", "pc"));
  });

  it("renders the keys people actually reach for", () => {
    expect(displayChord("shift+1", "mac")).toBe("⇧1");
    expect(displayChord("numpadadd", "mac")).toBe("+");
    expect(displayChord("arrowleft", "pc")).toBe("←");
    expect(displayChord("escape", "pc")).toBe("Esc");
  });
});
