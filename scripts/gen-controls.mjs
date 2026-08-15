// Generates CONTROLS.md, and the short table inside README.md, from the
// overlay's command catalog.
//
// The catalog is the single source of truth for every shortcut and every
// pointer gesture — the runtime binds from it, the shortcuts panel and the ⌘K
// palette render from it, and this writes the documentation from the same
// table. Before it existed the only reference was a hand-written six-row table
// in README.md, and its copy in apps/cli/README.md had already drifted two rows
// out of date. That is the failure mode this removes: not "the docs are wrong",
// but "nothing could have told you".
//
// Usage:
//   node --experimental-strip-types scripts/gen-controls.mjs           # write
//   node --experimental-strip-types scripts/gen-controls.mjs --check   # verify
//
// The flag is required on Node 22.13–22.17 (the engines floor) and is an
// accepted no-op after, so passing it unconditionally is portable. It is what
// lets this .mjs `import` a .ts module directly; the only cost is that
// catalog.ts may contain no *value* imports, which keys/catalog.test.ts
// enforces. Type imports are erased before resolution and are free.
//
// Run before scripts/sync-readme.mjs — this writes into README.md, and that
// copies README.md.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// `new URL(..., import.meta.url)` throughout, and handed straight to `readFileSync`
// / `writeFileSync`, which take a file URL. Nothing here ever converts one to a
// path string, which is what sidesteps the `/C:/…` and percent-encoding traps
// packages/overlay/scripts/check-css.mjs documents.
const CATALOG = new URL(
  "../packages/overlay/src/keys/catalog.ts",
  import.meta.url
);
const CONTROLS = new URL("../CONTROLS.md", import.meta.url);
const README = new URL("../README.md", import.meta.url);

const START = "<!-- controls:start -->";
const END = "<!-- controls:end -->";

const BANNER =
  "<!-- Generated from packages/overlay/src/keys/catalog.ts by scripts/gen-controls.mjs. Do not edit. -->";

function die(message) {
  process.stderr.write(`gen-controls: ${message}\n`);
  process.exit(1);
}

/** A markdown table cell that will not break the table it is in. */
function cell(text) {
  return String(text).replace(/\|/g, "\\|");
}

/** Chords as a reader sees them, joined for one platform. */
function chordsFor(spec, displayChord, platform) {
  if (spec.display) {
    return spec.display;
  }
  return (spec.primary ?? spec.keys)
    .map((k) => displayChord(k, platform))
    .join(" or ");
}

/**
 * Where a command is available, in one phrase.
 *
 * Both halves matter and neither is obvious from the chord: a shortcut that
 * silently does nothing is the complaint this whole table answers, so the
 * reference has to say *when* rather than leaving you to find out.
 */
function scopeOf(spec) {
  // A scoped command's `where` beats both: it is live exactly while some
  // particular surface is up, which mode and surface cannot say.
  if (spec.where) {
    return spec.where;
  }
  const where = spec.surface === "both" ? "" : `${spec.surface} only`;
  const when = spec.mode === "any" ? "" : `${spec.mode} mode`;
  return [when, where].filter(Boolean).join(", ") || "anywhere";
}

/** The full reference: every command, every gesture, both platforms. */
export function renderControls({
  commands,
  gestures,
  notes,
  groups,
  displayChord,
}) {
  const out = [
    BANNER,
    "",
    "# Controls",
    "",
    "Every keyboard shortcut and pointer gesture in the Airship editor.",
    "",
    "Press `?` in the editor for the same list with whatever is live right now",
    "highlighted, or `⌘K` to search the commands and run one.",
    "",
    "A shortcut never fires while you are typing, with one exception: a field's",
    "own `⌘↵`. On Safari the browser keeps `⌘+` and `⌘-` for its own zoom, so",
    "the editor also answers to a plain `+` and `-`.",
    "",
  ];

  for (const group of groups) {
    const rows = commands.filter((c) => c.group === group);
    if (!rows.length) {
      continue;
    }
    out.push(`## ${group}`, "");
    out.push("| Command | macOS | Windows / Linux | Where | |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const spec of rows) {
      out.push(
        `| ${cell(spec.title)} | ${cell(chordsFor(spec, displayChord, "mac"))} | ${cell(
          chordsFor(spec, displayChord, "pc")
        )} | ${cell(scopeOf(spec))} | ${cell(spec.doc)} |`
      );
    }
    out.push("");
  }

  // Two input columns, like the command tables above. Only two gestures differ
  // between platforms, but both of those carry a modifier glyph — so a single
  // column was Mac-only exactly where it mattered.
  out.push("## Mouse and trackpad", "");
  out.push("| Gesture | macOS | Windows / Linux | Where | |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const spec of gestures) {
    out.push(
      `| ${cell(spec.title)} | ${cell(spec.input)} | ${cell(
        spec.inputPc ?? spec.input
      )} | ${cell(scopeOf(spec))} | ${cell(spec.doc)} |`
    );
  }
  out.push("");

  out.push("## In any field", "");
  for (const note of notes) {
    out.push(`- ${note}`);
  }
  out.push("");

  return out.join("\n");
}

/**
 * The short table for README.md — the `essential` subset only.
 *
 * A README is read once, by someone deciding whether to try this. The full
 * forty-row reference belongs behind a link.
 */
export function renderEssentials({ commands, gestures, displayChord }) {
  const out = ["| | macOS | Windows / Linux |", "| --- | --- | --- |"];
  for (const spec of gestures.filter((g) => g.essential)) {
    out.push(
      `| ${cell(spec.title.toLowerCase())} | ${cell(spec.input)} | ${cell(
        spec.inputPc ?? spec.input
      )} |`
    );
  }
  for (const spec of commands.filter((c) => c.essential)) {
    out.push(
      `| ${cell(spec.title.toLowerCase())} | ${cell(
        chordsFor(spec, displayChord, "mac")
      )} | ${cell(chordsFor(spec, displayChord, "pc"))} |`
    );
  }
  out.push("");
  out.push(
    "Press `?` in the editor for all of them, or see [CONTROLS.md](./CONTROLS.md)."
  );
  return out.join("\n");
}

/** Swap the text between the two markers, keeping everything around it. */
function replaceBlock(source, block) {
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    die(
      `README.md is missing the ${START} / ${END} markers that say where the controls table goes.`
    );
  }
  return `${source.slice(0, from + START.length)}\n${block}\n${source.slice(to)}`;
}

async function main() {
  const catalog = await import(CATALOG.href);
  const shared = {
    commands: catalog.ALL_COMMANDS,
    displayChord: catalog.displayChord,
    gestures: catalog.ALL_GESTURES,
    groups: catalog.COMMAND_GROUPS,
    notes: catalog.NOTES,
  };
  const controls = renderControls(shared);
  const readme = replaceBlock(
    readFileSync(README, "utf8"),
    renderEssentials(shared)
  );

  const check = process.argv.includes("--check");
  const stale = [];
  // `\r\n` normalised on both sides: the repo is checked out with native line
  // endings on Windows and this comparison is about content.
  const same = (a, b) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

  if (check) {
    let current = "";
    try {
      current = readFileSync(CONTROLS, "utf8");
    } catch {
      die("CONTROLS.md is missing — run `make controls`.");
    }
    if (!same(current, controls)) {
      stale.push("CONTROLS.md");
    }
    if (!same(readFileSync(README, "utf8"), readme)) {
      stale.push("README.md");
    }
    if (stale.length) {
      die(
        `${stale.join(" and ")} ${stale.length > 1 ? "are" : "is"} stale — run \`make controls\` and commit the result.`
      );
    }
    process.stdout.write("CONTROLS.md and README.md are up to date\n");
    return;
  }

  writeFileSync(CONTROLS, controls);
  writeFileSync(README, readme);
  process.stdout.write(
    `wrote CONTROLS.md — ${shared.commands.length} commands, ${shared.gestures.length} gestures\n`
  );
}

// Exported for keys/controls-doc.test.ts, which renders from the same functions
// and byte-compares against the committed file — so there is one renderer, and
// the drift gate holds even where this script cannot run.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
