import { buildCss, design } from "@airship/editor-tokens";
import { describe, expect, it } from "vitest";
import { overlayCss } from "./index";

const VAR_USE = /var\(\s*(--ap-[a-z0-9-]+)/gi;
const VAR_DECL = /^\s*(--ap-[a-z0-9-]+)\s*:/gm;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

function declared(): Set<string> {
  const out = new Set<string>();
  for (const match of buildCss().matchAll(VAR_DECL)) {
    out.add(match[1]);
  }
  return out;
}

/**
 * Comments are stripped first.
 *
 * These stylesheets carry a lot of prose, and that prose names token families as
 * `var(--ap-motion-*)` — a real reference in a sentence, not a declaration. Left
 * in, the wildcard reads as a token called `--ap-motion-` that nothing emits,
 * and the check fails on its own documentation.
 */
function used(css: string): Set<string> {
  const out = new Set<string>();
  for (const match of css.replace(CSS_COMMENT, "").matchAll(VAR_USE)) {
    out.add(match[1]);
  }
  return out;
}

describe("overlay stylesheet", () => {
  it("only references tokens the palette actually emits", () => {
    // An undefined custom property is not a fallback to the initial value — the
    // whole declaration is invalid at computed-value time and is dropped, with
    // no error anywhere. A typo'd token is therefore a rule that silently stops
    // existing, which is a great deal harder to notice than a build failure.
    const available = declared();
    const missing = [...used(overlayCss())].filter(
      (name) => !available.has(name)
    );
    expect(missing).toEqual([]);
  });

  it("carries the motion vocabulary the modules are written against", () => {
    const available = declared();
    for (const name of [
      "--ap-motion-dur-micro",
      "--ap-motion-dur-base",
      "--ap-motion-ease",
      "--ap-motion-ease-out",
      "--ap-box-padding",
      "--ap-box-margin",
      "--ap-box-gap",
    ]) {
      expect(available.has(name)).toBe(true);
    }
  });

  it("uses the size tokens it emits, or does not emit them", () => {
    /*
     * The inverse of the check above, and the one that would have caught the
     * icon-sizing drift.
     *
     * `--ap-icon-size-*` was emitted for a long time and referenced by exactly
     * zero rules: icon size is applied as SVG `width`/`height` attributes, so
     * the real scale lived in a hand-copied literal in `icons.ts` that happened
     * to agree with the tokens. Editing `EDITOR.md` moved the variables and
     * changed nothing on screen — the two could drift apart silently, and a
     * "single source of truth" that nothing reads is worse than none, because
     * it reads as though it is being obeyed.
     *
     * `icons.ts` now imports `design.iconSize` directly, which is why the group
     * is allowed here rather than asserted-on: its consumer is JavaScript, and
     * a CSS test cannot see it. Everything else in the size families has to be
     * live in the stylesheet or be deleted.
     */
    const SIZE_FAMILIES = ["space", "radius", "font-size", "control"];
    const live = used(overlayCss());
    // Per family, not per token: a scale is allowed steps nobody has reached
    // for yet — `radius-pill` and `space-section` are real parts of a complete
    // ramp. A whole family with no references is the thing that means someone
    // is sizing from somewhere else.
    const dead = SIZE_FAMILIES.filter((family) => {
      const members = [...declared()].filter((name) =>
        name.startsWith(`--ap-${family}-`)
      );
      return members.length > 0 && !members.some((name) => live.has(name));
    });
    expect(dead).toEqual([]);
  });

  it("keeps the icon scale and the icon-size tokens the same numbers", () => {
    // `icons.ts` reads `design.iconSize`, so this cannot drift by construction
    // — but it is the assertion that says so, and the thing that fails loudly
    // if anyone reintroduces a local copy of the scale.
    const css = buildCss();
    for (const [name, px] of Object.entries(design.iconSize)) {
      expect(css).toContain(`--ap-icon-size-${name}: ${px}px;`);
    }
  });

  it("honours reduced motion, once, at the end", () => {
    const css = overlayCss();
    const at = css.indexOf("prefers-reduced-motion");
    expect(at).toBeGreaterThan(-1);
    // Exactly one block: the policy is centralised in `motion.css.ts`
    // specifically so it cannot drift into a hand-kept list of selectors.
    expect(css.indexOf("prefers-reduced-motion", at + 1)).toBe(-1);
    // And last, so it outranks the modules it overrides on order alone.
    expect(css.slice(at)).not.toContain("transition:");
  });
});
