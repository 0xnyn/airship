import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { Descriptor, Group } from "./inspector/descriptors";
// biome-ignore lint/performance/noNamespaceImport: the point is to see exports nobody listed here
import * as descriptors from "./inspector/descriptors";
import { ALL_COMMANDS } from "./keys/catalog";
import { LABEL_MAX_CHARS } from "./styles/const";

/*
 * The tooltip copy standard, enforced.
 *
 * Three rules, and each of them was broken in the tree before this file existed.
 *
 * **Length.** A tip is a label, not a paragraph. `TIP_MAX_W` is 260px and
 * `--ap-font-size-body` is 11px, so one line holds about 44 characters; the
 * longest tip in the product was 87 and wrapped to three.
 *
 * **No em dash.** Roughly thirty tips were built as `X — Y`, where the `Y` was
 * usually explaining something the control beside it already showed. The ban is
 * on U+2014 only: U+2013 is the right glyph for `lines 12–18` and stays.
 *
 * **No keyboard marks in the prose.** A tooltip is two spans: `.tip-text` and,
 * when the control names a command, a `.tip-key` chip rendered from the
 * catalog. Those marks belong in the chip. Two tips spelled them into the
 * sentence instead — `"Drag, or ↑↓ to restack"` and `"Zoom to fit (⇧1)"`.
 *
 * Scanned from source rather than asserted against a list, because the point is
 * to catch the tip somebody adds next year, not the ones fixed today.
 *
 * ## What used to be here
 *
 * Two more cases and two hand-maintained lists, `CHORD_LABELS` and `CHORD_TIPS`.
 * The chip was once resolved by comparing a tooltip's own *text* against a
 * binding's `label`, so rewording a tooltip silently dropped its shortcut —
 * nothing threw, nothing rendered wrong, the chip was just gone — and the lists
 * existed to freeze both spellings against that. They were a stopgap and they
 * leaked: `CHORD_LABELS` never listed "Delete frame", "Put the Hand down",
 * "Deselect", "Zoom to 100%", "Zoom to selection" or any popover label, and
 * `CHORD_TIPS` covered two of thirteen, because most controls build their tip
 * through a variable a scan cannot see.
 *
 * A control now names its command with `data-key`, which is a `CommandId`. The
 * compiler checks it, `keys/catalog.test.ts` checks that every declared command
 * is really bound, and the copy is free to change without anybody's permission.
 */

/** One line at `TIP_MAX_W`, in characters. See the note on the constant. */
const TIP_MAX_CHARS = 44;

const EM_DASH = "—";

/**
 * Marks that belong in the shortcut chip, not in the sentence.
 *
 * `keys/catalog.ts`'s `DISPLAY_MAC` and `DISPLAY_PC` maps, minus `←` and `→`. Those two are the exception on
 * purpose: the change chips build `from → to` readouts, where the arrow is
 * notation rather than a key, and banning it would fail seven honest tips to
 * catch none. The vertical pair has no such second life.
 *
 * The middot is not here either, for the same reason. It reads as a key mark in
 * `"Drag to move · double-click to rename"` — two sentences wearing punctuation
 * from another system, since fixed to a comma — but in `"Button · moved in the
 * tree"` it separates a subject from its detail, which is what a middot is for.
 * No scan can tell those apart, so this rule does not try.
 */
const KEY_MARKS = /[↑↓⌘⇧⌥⌫⌦↩⏎␣]/u;

/** Everything a comment can hold except the line breaks that keep it aligned. */
const NON_NEWLINE = /[^\n]/g;

/**
 * Somewhere a tooltip's text is written, up to and including the assignment.
 *
 * Several shapes, because `data-tip` is only the last step. Plenty of controls
 * build the string first — `const tip = …`, a `tip:` on a `ChangeChip`, a write
 * to `dataset.tip` — and those are where the longest and most-interpolated copy
 * in the product lives, so scanning only the attribute would miss exactly the
 * cases worth catching. `[^=]` on the last alternative keeps `===` out.
 *
 * `note` is in here for `align.ts`'s `AlignPlan.note`, whose only consumer is the
 * tip built in `sections/align-row.ts`. The join site's own literal is just `". "`,
 * so without this the note itself — the half that actually carries the words — is
 * invisible to both the length and the dash check.
 *
 * The `*_NOTE` alternative used to be left out. The reasoning was that a regex
 * loose enough to catch `MODE_NOTE` and `PAINT_NOTE` would match every
 * `NOTE`-suffixed constant in the tree, and that auditing two lines by hand was
 * the better trade. The hand audit is what failed: a third constant,
 * `TRUNCATED_NOTE` in `vector.ts`, was added later carrying an em dash and this
 * file could not see it.
 *
 * Requiring SCREAMING_SNAKE and an `=` is what makes it affordable — it matches
 * a module constant declaring copy and not a `note` property, a `noteworthy`
 * identifier, or anything lowercase. The lookbehind alternative still handles
 * the `note:` object keys.
 *
 * The `\b` guard is what stops `"data-tip":` matching twice, and a `tip: string`
 * in an interface costs nothing: it has no string literal after it to collect.
 */
const TIP_SITE =
  /"data-tip"\s*:|\.dataset\.tip\s*=(?!=)|\b[A-Z][A-Z0-9_]*_(?:NOTE|TIP)\s*=(?!=)|(?<![-\w.])(?:tip|note)\s*[:=](?![=:])/g;

/*
 * Resolved from the working directory, not from `import.meta.url`.
 *
 * These cases run under happy-dom, where `import.meta.url` is an http URL and
 * `fileURLToPath` rejects it outright. Vitest's root is the package, but turbo
 * can run it from the repo root, so both are tried — and the "finds the tips"
 * case below is what catches a path that resolved to nothing.
 */
const SRC = [
  join(process.cwd(), "src"),
  join(process.cwd(), "packages/overlay/src"),
  process.cwd(),
].find((dir) => existsSync(join(dir, "tooltip.ts"))) as string;

/** One authored string found in a `data-tip`, and where it was written. */
interface Tip {
  file: string;
  line: number;
  text: string;
}

/**
 * Ships to a user's page, so the copy standard governs it.
 *
 * `tsup.config.ts` builds `hook.ts` and `index.ts` and nothing reaches the
 * catalogue from either, so `*.stories.ts` and the `stories/` harness beside
 * them are development furniture. Their fixtures are deliberately unlike product
 * copy — mock page markup, caption prose, specimen strings written *to* be
 * overlong — and holding them to a 44-character tooltip rule would either
 * fail honestly for no reason or push someone to weaken the rule.
 */
function isProductSource(name: string, path: string): boolean {
  return (
    name.endsWith(".ts") &&
    !(
      name.endsWith(".test.ts") ||
      name.endsWith(".stories.ts") ||
      path.includes(`${sep}stories${sep}`)
    )
  );
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, found);
    } else if (isProductSource(entry.name, path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Collect the literal text inside one `'…'`, `"…"` or `` `…` ``, from its quote.
 *
 * Returns the text and the index just past the closing quote. For a template,
 * only the chunks *outside* `${ … }` are text — an interpolation contributes
 * nothing to review, and the braces may themselves contain nested templates.
 */
function readString(src: string, open: number): { end: number; text: string } {
  const quote = src[open];
  let text = "";
  let i = open + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { end: i + 1, text };
    }
    if (quote === "`" && ch === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") {
          depth += 1;
        } else if (src[i] === "}") {
          depth -= 1;
        } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
          i = readString(src, i).end - 1;
        }
        i += 1;
      }
      continue;
    }
    text += ch;
    i += 1;
  }
  return { end: i, text };
}

/**
 * Collect every string literal in the expression starting at `from`.
 *
 * Walks to the end of the expression rather than the end of the line: the real
 * call sites are ternaries spanning three or four lines (`sections/size.ts`,
 * `sections/stroke.ts`, `paint.ts`), and a line-wise regex sees only the first
 * branch. Ends at a comma or semicolon outside any bracket, or at the brace that
 * closes the object literal the attribute was declared in.
 */
function readExpression(src: string, from: number): string[] {
  const literals: string[] = [];
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      const { end, text } = readString(src, i);
      literals.push(text);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        return literals;
      }
      depth -= 1;
    } else if (depth === 0 && (ch === "," || ch === ";")) {
      return literals;
    }
    i += 1;
  }
  return literals;
}

/**
 * Blank every comment, keeping the file the same length.
 *
 * Without this the scan reads prose. The module comment in `tooltip.ts` explains
 * the feature by writing `data-tip="Undo"` in a sentence, which matches a tip
 * site and sends `readExpression` off through the rest of the file collecting
 * code as copy. Same length in, same length out, and newlines survive inside
 * block comments, so the reported line numbers stay true.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      const { end } = readString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      const block = src[i + 1] === "*";
      const close = block ? src.indexOf("*/", i + 2) : src.indexOf("\n", i);
      const stop = close === -1 ? src.length : close + (block ? 2 : 0);
      out += src.slice(i, stop).replace(NON_NEWLINE, " ");
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Every authored tooltip string in the overlay.
 *
 * A tip whose value is a bare identifier — `"data-tip": color`, `dataset.tip =
 * chip.tip` — contributes nothing and is skipped. That is correct rather than a
 * gap: those are exactly the ones carrying a font stack, a stylesheet URL or a
 * comment body, which have no length bound anybody can enforce and are why the
 * tip wraps in the first place.
 */
function tooltipCopy(): Tip[] {
  const tips: Tip[] = [];
  for (const path of sourceFiles(SRC)) {
    const src = stripComments(readFileSync(path, "utf8"));
    const file = path.slice(SRC.length);
    for (const match of src.matchAll(TIP_SITE)) {
      const at = match.index as number;
      const line = src.slice(0, at).split("\n").length;
      for (const text of readExpression(src, at + match[0].length)) {
        if (text.trim()) {
          tips.push({ file, line, text });
        }
      }
    }
  }
  return tips;
}

/** `file:line "text"`, so a failure reads as a worklist. */
const show = (t: Tip): string =>
  `${t.file}:${t.line} ${JSON.stringify(t.text)}`;

const tips = tooltipCopy();

describe("tooltip copy", () => {
  it("finds the tips to check", () => {
    // A scanner that silently matched nothing would make every case below pass.
    expect(tips.length).toBeGreaterThan(50);
  });

  it("keeps every tip to one line", () => {
    const tooLong = tips
      .filter((t) => t.text.length > TIP_MAX_CHARS)
      .map(show)
      .sort((a, b) => a.localeCompare(b));
    expect(tooLong).toEqual([]);
  });

  it("uses no em dashes", () => {
    const dashed = tips
      .filter((t) => t.text.includes(EM_DASH))
      .map(show)
      .sort((a, b) => a.localeCompare(b));
    expect(dashed).toEqual([]);
  });

  it("keeps keyboard marks out of the prose", () => {
    const glyphed = tips
      .filter((t) => KEY_MARKS.test(t.text))
      .map(show)
      .sort((a, b) => a.localeCompare(b));
    expect(glyphed).toEqual([]);
  });
});

/*
 * The label standard, enforced the same way.
 *
 * A rail label is not a tip and does not get the tip's budget. `TIP_MAX_CHARS`
 * is 44 because a tooltip is a floating box that sizes to its text;
 * `LABEL_MAX_CHARS` is 14 because the rail is a fixed column that neither
 * ellipsises nor clips, so the fifteenth character has nowhere to go but a
 * second line — which takes the row's height, and the control's, with it.
 *
 * The rule predates this case by a long way: `descriptors.ts` wrote it out in
 * prose, named the longest label then shipping, and was wrong about that within
 * a few commits. Three labels had passed 14 and one had reached 24, wrapping to
 * three lines in a group that was itself indented twice over. Prose cannot hold
 * a budget, which is the whole argument for this file.
 *
 * Read from the module rather than scanned out of it. Every descriptor is an
 * exported object or an exported factory, so importing them gets the real
 * `span`/`fieldIcon`/`fieldLabel` values that decide whether a label reaches a
 * rail at all — a regex would have to reimplement `fieldCell`'s routing and
 * would drift from it.
 */

/** Both axes and both orientations, so the factory descriptors are covered. */
const FACTORY_DESCRIPTORS: Descriptor[] = [
  descriptors.GRID_GAP("row"),
  descriptors.GRID_GAP("column"),
  descriptors.LAYOUT_GAP(true),
  descriptors.LAYOUT_GAP(false),
];

function isDescriptor(value: unknown): value is Descriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Descriptor).label === "string" &&
    typeof (value as Descriptor).cssProperty === "string" &&
    typeof (value as Descriptor).controlType === "string"
  );
}

function isGroup(value: unknown): value is Group {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Group).descriptors)
  );
}

/** Every descriptor the module exports, however it is packaged. */
function allDescriptors(): Descriptor[] {
  const found = [...FACTORY_DESCRIPTORS];
  for (const value of Object.values(descriptors)) {
    if (isDescriptor(value)) {
      found.push(value);
    } else if (isGroup(value)) {
      found.push(...value.descriptors);
    } else if (Array.isArray(value)) {
      // Through `unknown[]`: the exported arrays are not all descriptors —
      // `STROKE_SIDES` is a table of icons — so the element type is a union
      // the predicate has to narrow rather than one it can just accept.
      found.push(...(value as unknown[]).filter(isDescriptor));
    }
  }
  return found;
}

/**
 * Does this descriptor's label reach the 68px rail?
 *
 * `fieldCell` gives a descriptor a bare grid cell — no rail, label demoted to
 * an `aria-label` and a tip — when it carries its own `fieldIcon` or
 * `fieldLabel` *and* is not full width. Anything else falls through to
 * `labelled()`. Those glyph cells are exempt on purpose: several run past 20
 * characters and are correct, because the budget they answer to is the tip's.
 */
function onRail(d: Descriptor): boolean {
  return d.span === "full" || !(d.fieldIcon || d.fieldLabel);
}

/** Somewhere a rail label is written as a literal at the call site. */
const LABELLED_SITE = /\blabelled\(\s*(?=["'`])/g;

/** `file:line "text"`, matching `show` above. */
interface RailLabel {
  file: string;
  line: number;
  text: string;
}

function literalRailLabels(): RailLabel[] {
  const labels: RailLabel[] = [];
  for (const path of sourceFiles(SRC)) {
    const src = stripComments(readFileSync(path, "utf8"));
    const file = path.slice(SRC.length);
    for (const match of src.matchAll(LABELLED_SITE)) {
      const at = (match.index as number) + match[0].length;
      const { text } = readString(src, at);
      if (text.trim()) {
        labels.push({
          file,
          line: src.slice(0, at).split("\n").length,
          text,
        });
      }
    }
  }
  return labels;
}

describe("label copy", () => {
  const railed = allDescriptors().filter(onRail);
  const literals = literalRailLabels();

  it("finds the labels to check", () => {
    // Same guard as the tips: a scanner matching nothing passes everything.
    // The literal floor is low because most call sites pass a variable — a
    // descriptor's `label`, or one from a local table. Those reach the rail
    // too, and `rail-label.test.ts` is what holds them, by reading the rows the
    // panel actually renders rather than the source that wrote them.
    expect(railed.length).toBeGreaterThan(10);
    expect(literals.length).toBeGreaterThan(8);
  });

  it("keeps every descriptor label inside the rail", () => {
    const tooLong = railed
      .filter((d) => d.label.length > LABEL_MAX_CHARS)
      .map((d) => `${d.key} ${JSON.stringify(d.label)}`)
      .sort((a, b) => a.localeCompare(b));
    expect(tooLong).toEqual([]);
  });

  it("keeps every literal row label inside the rail", () => {
    const tooLong = literals
      .filter((l) => l.text.length > LABEL_MAX_CHARS)
      .map((l) => `${l.file}:${l.line} ${JSON.stringify(l.text)}`)
      .sort((a, b) => a.localeCompare(b));
    expect(tooLong).toEqual([]);
  });

  it("uses no em dashes in a label", () => {
    const dashed = [
      ...railed.map((d) => d.label),
      ...literals.map((l) => l.text),
    ]
      .filter((text) => text.includes(EM_DASH))
      .sort((a, b) => a.localeCompare(b));
    expect(dashed).toEqual([]);
  });
});

/*
 * A control whose tip names a command must name the command too.
 *
 * The chip used to be resolved from the tooltip's own *text*, matched against
 * the binding's label. When it moved to `data-key`, the controls that were never
 * migrated kept their bare `data-tip` and silently stopped rendering a chip —
 * Undo, Redo, Send, Hand tool and Add a frame, five of the most-used keys in the
 * product, advertised nowhere.
 *
 * Nothing failed, because the old guard was a hand-written list of spellings and
 * the new one only checks the ids that *are* declared. This checks the other
 * direction: a `data-tip` that spells a command's own title, with no `data-key`
 * beside it, is a control that should have gone through `tip()`.
 */
describe("shortcut chips", () => {
  /** Every `"data-tip": "literal"` written by hand, i.e. not built by `tip()`. */
  const BARE_TIP = /"data-tip"\s*:\s*"([^"]+)"/g;

  const titles = new Map(
    ALL_COMMANDS.map((c) => [c.title.toLowerCase(), c.id] as const)
  );

  const bare: { file: string; id: string; line: number; text: string }[] = [];
  for (const path of sourceFiles(SRC)) {
    // `tip()` itself writes the pair, and is the one site allowed to.
    if (path.endsWith(join("keys", "registry.ts"))) {
      continue;
    }
    const src = stripComments(readFileSync(path, "utf8"));
    for (const match of src.matchAll(BARE_TIP)) {
      const id = titles.get(match[1].toLowerCase());
      if (id) {
        bare.push({
          file: path.slice(SRC.length),
          id,
          line: src.slice(0, match.index as number).split("\n").length,
          text: match[1],
        });
      }
    }
  }

  it("finds the controls to check", () => {
    // The scan has to see the catalog and the sources, or the case below is
    // vacuous — which is exactly how the original regression got through.
    expect(titles.size).toBeGreaterThan(30);
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it("routes every command-titled tip through tip()", () => {
    const missing = bare
      .map((b) => `${b.file}:${b.line} "${b.text}" → tip(…, "${b.id}")`)
      .sort((a, b) => a.localeCompare(b));

    expect(missing).toEqual([]);
  });
});
