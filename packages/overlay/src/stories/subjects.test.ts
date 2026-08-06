import { describe, expect, it } from "vitest";
import { hasText } from "../inspector/descriptors";
import {
  hasBackgroundImage,
  isImage,
  isRasterImage,
  isSvgChild,
  isSvgRoot,
  isVideo,
} from "../inspector/element-kind";
import { buildSpecimenIn, type SubjectName } from "./subjects";

/*
 * Do the specimens reach the branches they claim to?
 *
 * `SpecimenSpec.covers` is prose, and prose does not fail. This is what makes it
 * answerable — and it exists because the two bugs it would have caught were both
 * live for a long time and both invisible from the outside:
 *
 *  - the gradient specimen resolved `.tiles`, the grid *container*, which paints
 *    nothing. `Inspector/Sections/Fill · Gradient` rendered an empty section, and
 *    an empty Fill section is a legitimate state for an element with no fill —
 *    so the panel was correctly reporting the wrong element.
 *  - the SVG-child specimen resolved the `<svg>` root, where `isSvgChild` is
 *    false by definition. Two stories claimed to demonstrate the most
 *    aggressively gated path in `renderSections`, and that path had no coverage
 *    anywhere in the catalogue.
 *
 * Only the *structural* predicates are asserted here. `hasFill`, `hasStroke` and
 * `hasBounds` read computed style, and happy-dom does not apply the specimen
 * stylesheet — those are the browser tier's job, which is the same division of
 * labour `test-support.ts` already documents.
 */

/** Build a specimen and hand back the node a story would be pointed at. */
function nodeFor(name: SubjectName): HTMLElement {
  const { node, page } = buildSpecimenIn(document, name);
  // Mounted, because `closest()` walks to the root and `hasText` reads children.
  document.body.append(page);
  return node;
}

describe("specimens", () => {
  it("marks exactly one subject each", () => {
    const names: SubjectName[] = [
      "badge",
      "button",
      "card",
      "hero",
      "icon",
      "image",
      "note",
      "paragraph",
      "path",
      "tile",
      "tiles",
      "title",
      "video",
    ];
    for (const name of names) {
      const { page } = buildSpecimenIn(document, name);
      expect(page.querySelectorAll("[data-subject]")).toHaveLength(1);
    }
  });

  it("puts the gradient specimen on a tile, not on the grid", () => {
    // The bug: `.tiles` is the container and has no background at all.
    expect(nodeFor("tile").classList.contains("tile")).toBe(true);
    expect(nodeFor("tiles").classList.contains("tiles")).toBe(true);
  });

  it("separates the SVG root from an SVG child", () => {
    const root = nodeFor("icon");
    const child = nodeFor("path");
    expect(isSvgRoot(root)).toBe(true);
    expect(isSvgChild(root)).toBe(false);
    expect(isSvgRoot(child)).toBe(false);
    // The branch that had no coverage while two stories claimed to be it.
    expect(isSvgChild(child)).toBe(true);
  });

  it("distinguishes the three routes into the Media section", () => {
    const image = nodeFor("image");
    expect(isImage(image)).toBe(true);
    expect(isRasterImage(image)).toBe(true);

    const video = nodeFor("video");
    expect(isVideo(video)).toBe(true);
    // The distinction the section gates `alt`/`loading`/`decoding` on.
    expect(isRasterImage(video)).toBe(false);

    // The non-media route: a gradient scrim over a `url()`, which the
    // whole-value version of this predicate reported as no image at all.
    expect(hasBackgroundImage(nodeFor("hero"))).toBe(true);
  });

  it("reaches hasText by both of its arms", () => {
    // The TEXTY tag set.
    expect(hasText(nodeFor("title"))).toBe(true);
    // The text-node scan, on a tag that is not in the set.
    const note = nodeFor("note");
    expect(note.tagName).toBe("DIV");
    expect(hasText(note)).toBe(true);
    // And a container of elements only, which is neither.
    expect(hasText(nodeFor("tiles"))).toBe(false);
  });

  it("declares siblings where a scope choice is the point", () => {
    // `scopeLevels` only offers a class when more than one element carries it,
    // so a specimen wanting a meaningful Scope row has to bring company.
    const card = buildSpecimenIn(document, "card");
    expect(card.page.querySelectorAll(".card").length).toBeGreaterThan(1);
    const button = buildSpecimenIn(document, "button");
    expect(button.page.querySelectorAll(".btn").length).toBeGreaterThan(1);
    const tile = buildSpecimenIn(document, "tile");
    expect(tile.page.querySelectorAll(".tile").length).toBeGreaterThan(1);
  });

  it("throws rather than guessing when a specimen marks nothing", () => {
    // The failure mode the marker replaced: a selector table that could drift
    // from the markup silently. This one cannot be wrong quietly.
    expect(() => buildSpecimenIn(document, "nope" as SubjectName)).toThrow();
  });
});
