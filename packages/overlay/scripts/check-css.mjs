/*
 * Guard the CSS template literals in `src/styles/*.css.ts`.
 *
 * Those files are one big backtick string each, so an unescaped backtick inside
 * a CSS comment — the natural way to write `position: relative` in prose —
 * silently terminates the literal and turns the rest of the stylesheet into
 * TypeScript. `tsc` does catch it, but it reports a parse error thirty rules
 * downstream of the cause and reads as a compiler bug. This names it.
 *
 * The scan starts at `export const css = \`` and walks the literal properly,
 * stepping over `${ ... }` interpolations (which may themselves contain nested
 * template literals) so only backticks in *CSS* text are reported.
 *
 * It also enforces one design rule that cannot be expressed in the type system:
 * canvas chrome does not animate. See `NO_TRANSITION`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../src/styles/", import.meta.url).pathname;
const START = /export const css\s*=\s*`/;
const problems = [];

/**
 * Stylesheets that may not declare a `transition`, and why.
 *
 * The hover and selection outlines are re-positioned on every pointer move, by
 * writing a measured rect straight into `left`/`top`/`width`/`height`. A
 * transition on those properties interpolates between one element's box and the
 * next, so the outline visibly trails the cursor and lags behind whatever it is
 * supposed to be tracking. It does not read as easing; it reads as the overlay
 * being slow.
 *
 * This is not obvious from the rule that causes it — the offending declaration
 * was a plausible-looking `transition: all .05s ease` that survived a long time
 * — and it is exactly the sort of thing a well-meaning motion pass would put
 * back. Hence a build check rather than a comment.
 *
 * Chrome that is *shown and hidden* rather than moved may still fade; list it in
 * `allow` with the reason, and keep that list short.
 */
const NO_TRANSITION = [{ allow: ["snap-label"], file: "chrome.css.ts" }];

/** A `transition` / `transition-property` declaration starting a value. */
const TRANSITION_DECL = /(^|[;\s])transition(-[a-z]+)?\s*:/;

/** Walk one template literal from just after its opening backtick. */
function scan(source, from, file) {
  let depth = 0; // `${ ... }` nesting
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "$" && source[i + 1] === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (c === "`") {
      if (depth > 0) {
        // A nested literal inside an interpolation — skip to its end.
        i = scan(source, i + 1, file).end;
        continue;
      }
      return { closed: true, end: i };
    }
  }
  problems.push(`${file}: template literal is never closed`);
  return { closed: false, end: source.length };
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".css.ts"))) {
  const source = readFileSync(join(DIR, file), "utf8");
  const start = START.exec(source);
  if (!start) {
    continue;
  }
  const open = start.index + start[0].length;
  const { end } = scan(source, open, file);

  // Anything after the literal should be whitespace and a semicolon. If the
  // literal closed early, real CSS is sitting out here as broken TypeScript.
  const tail = source.slice(end + 1).trim();
  if (tail && tail !== ";") {
    const line = source.slice(0, end).split("\n").length;
    problems.push(
      `${file}: the CSS literal closes at line ${line}, but the file continues.\n` +
        "    Almost always an unescaped backtick in a comment — escape it (\\`) " +
        "or drop the quotes."
    );
  }

  const body = source.slice(open, end);
  const opens = (body.match(/{/g) ?? []).length;
  const closes = (body.match(/}/g) ?? []).length;
  // `${...}` contributes one of each, so they cancel.
  if (opens !== closes) {
    problems.push(
      `${file}: unbalanced braces (${opens} open, ${closes} close)`
    );
  }

  checkNoTransition(file, body);
}

/** Report `transition` declarations in a stylesheet that may not have them. */
function checkNoTransition(file, body) {
  const rule = NO_TRANSITION.find((r) => r.file === file);
  if (!rule) {
    return;
  }
  // Split on `}` so each chunk holds one rule's selector and its declarations,
  // which is enough to tell an allowed selector from a forbidden one.
  for (const chunk of body.split("}")) {
    if (!TRANSITION_DECL.test(chunk)) {
      continue;
    }
    if (rule.allow.some((name) => chunk.includes(name))) {
      continue;
    }
    const selector = chunk.split("{")[0].trim().split("\n").pop().trim();
    problems.push(
      `${file}: \`transition\` on \`${selector}\`.\n` +
        "    Canvas chrome is re-positioned on every pointer move, so a " +
        "transition makes the outline trail the cursor.\n" +
        "    If this element is faded rather than moved, add its class to " +
        "NO_TRANSITION's `allow` list with a reason."
    );
  }
}

if (problems.length) {
  console.error(`check-css: ${problems.length} problem(s)\n`);
  for (const p of problems) {
    console.error(`  ${p}`);
  }
  process.exit(1);
}
console.log("check-css: ok");
