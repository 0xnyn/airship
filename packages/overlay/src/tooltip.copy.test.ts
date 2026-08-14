import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

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
 * when `keys.hintFor` finds a binding, a `.tip-key` chip built from `keys.ts`'s
 * `DISPLAY` map. Those marks belong in the chip. Two tips spelled them into the
 * sentence instead — `"Drag, or ↑↓ to restack"`, and `"Zoom to fit (⇧1)"`, which
 * also stopped the real chip resolving, because `hintFor` matches the whole tip
 * against a binding's label and no binding is called "Zoom to fit (⇧1)".
 *
 * **Shortcut chips.** `Tooltips.show` resolves a chord with `keys.hintFor(text)`
 * and `keys.hintFor` matches the binding whose *label* equals that string. So a
 * tooltip reworded from "Undo" to "Undo the last change" silently loses its ⌘Z —
 * nothing throws, nothing renders wrong, the chip is just gone. That is the one
 * failure in here that no amount of reading the diff would catch.
 *
 * Scanned from source rather than asserted against a list, because the point is
 * to catch the tip somebody adds next year, not the ones fixed today.
 */

/** One line at `TIP_MAX_W`, in characters. See the note on the constant. */
const TIP_MAX_CHARS = 44;

const EM_DASH = "—";

/**
 * Marks that belong in the shortcut chip, not in the sentence.
 *
 * `keys.ts`'s `DISPLAY` map, minus `←` and `→`. Those two are the exception on
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

/**
 * Binding labels a tooltip can name, and so must keep spelling exactly.
 *
 * The chip is resolved by string equality between the tip and the binding's
 * `label`, so renaming *either* side alone drops it. These are the labels bound
 * in `app.ts`, `tools.ts` and `canvas/viewport.ts` that a control also advertises
 * as its tip. Renaming one is fine; renaming it here, at the `keys.bind`, and at
 * the control in the same commit is the whole requirement.
 */
const CHORD_LABELS = [
  "Undo",
  "Redo",
  "Delete",
  "Duplicate",
  "Edit text",
  "Add a frame",
  "Hand tool",
  "Send",
  "Move",
  "Inspect",
  "Zoom in",
  "Zoom out",
  "Zoom to fit",
];

/**
 * The subset written out at a `data-tip` site, where this file can see them.
 *
 * Most controls get their tip through a variable — `iconButton(name, label)`,
 * `TOOLS.map(t => t.label)`, `spec.label` — so the string never appears next to
 * `data-tip` in the source and a scan cannot check it. These two do appear, and
 * they are the ones a copy pass is most likely to reach for and "improve".
 */
const CHORD_TIPS = ["Hand tool", "Send"];

/** Everything a comment can hold except the line breaks that keep it aligned. */
const NON_NEWLINE = /[^\n]/g;

/** A `label: "…"` literal, wherever it is declared. */
const LABEL_LITERAL = /label:\s*"([^"]+)"/g;

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
 * Still outside its reach: `MODE_NOTE` in `descriptors.ts` and `PAINT_NOTE` in
 * `vector.ts`, two module constants whose names the lookbehind deliberately
 * excludes. Both are interpolated into tips and both are compliant today; a
 * regex loose enough to catch them also matches every `NOTE`-suffixed constant
 * in the tree, which is a worse trade than auditing two lines by hand.
 *
 * The `\b` guard is what stops `"data-tip":` matching twice, and a `tip: string`
 * in an interface costs nothing: it has no string literal after it to collect.
 */
const TIP_SITE =
  /"data-tip"\s*:|\.dataset\.tip\s*=(?!=)|(?<![-\w.])(?:tip|note)\s*[:=](?![=:])/g;

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

  it("leaves the tips that name a keybinding alone", () => {
    const present = new Set(tips.map((t) => t.text));
    const lost = CHORD_TIPS.filter((label) => !present.has(label));
    expect(lost).toEqual([]);
  });

  it("keeps the keymap spelling those tips the same way", () => {
    // The other half of the same contract. `hintFor` compares the tip to the
    // binding's `label`, so renaming the binding drops the chip just as surely
    // as renaming the tip — and from the keymap side the tooltip looks
    // untouched, which is why this is worth its own case.
    const declared = new Set<string>();
    for (const path of sourceFiles(SRC)) {
      for (const [, label] of readFileSync(path, "utf8").matchAll(
        LABEL_LITERAL
      )) {
        declared.add(label as string);
      }
    }
    const lost = CHORD_LABELS.filter((label) => !declared.has(label));
    expect(lost).toEqual([]);
  });
});
