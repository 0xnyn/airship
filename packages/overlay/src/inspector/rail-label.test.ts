import { beforeEach, describe, expect, it } from "vitest";
import { cls } from "../dom";
import { closeOpenPopover } from "../popover-host";
import { LABEL_MAX_CHARS } from "../styles/const";
import { DesignPanel } from "./panel";
import {
  harness,
  mount,
  resetDocument,
  selectionOf,
  sizeOf,
} from "./test-support";

/*
 * Every rail label the panel actually renders, held to the rail's budget.
 *
 * `tooltip.copy.test.ts` reads the two places a label is *written* — a
 * descriptor's `label`, and the literal at a `labelled()` call site. Between
 * them they miss the third: the sections that build rows from a local table and
 * pass the label through as a variable. `sections/media.ts`, `sections/fill.ts`
 * and `sections/vector.ts` all do this, and so did Advanced type, which is
 * where "Feature settings" — sixteen characters into a fourteen-character
 * rail — lived without either scanner being able to see it.
 *
 * Reading the rendered DOM catches all three at once and cannot drift from
 * `fieldCell`'s routing, because it *is* that routing: whatever ends up in a
 * `.row-label` is on the rail by definition, however it got there.
 *
 * happy-dom does no layout, so this asserts the character budget rather than a
 * measured width. That is the same trade `LABEL_MAX_CHARS` itself makes, and
 * the reason the constant is derived once and written down: the real check —
 * that nothing wraps at `MIN_DOCK_W` — needs a browser, and lives in Storybook.
 */

/**
 * The element kinds that between them reach every section.
 *
 * A section renders only for a node it applies to — `gates.ts` hides a Fill row
 * on an unstyled div, the vector sections need an SVG shape, and the grid
 * branch of Layout needs `display: grid`. One div would exercise about half the
 * rails in the panel and report a clean pass for the rest.
 */
const SUBJECTS: { style?: string; tag: string; text?: string }[] = [
  { style: "position: absolute; top: 4px; left: 8px", tag: "div" },
  { style: "display: flex; gap: 8px; padding: 4px", tag: "div" },
  { style: "display: grid; grid-template-columns: 1fr 1fr", tag: "div" },
  {
    style:
      "background: #ff0000; border: 1px solid #00ff00; border-radius: 4px; box-shadow: 0 1px 2px #000; filter: blur(1px); opacity: .5",
    tag: "div",
  },
  { style: "font: 700 14px/1.4 Inter; color: #123456", tag: "p", text: "Hi" },
  { style: "min-width: 10px; max-width: 90px", tag: "span", text: "Hi" },
  { tag: "img" },
  { tag: "video" },
  { tag: "svg" },
  { tag: "button", text: "Go" },
];

/**
 * Every `.row-label` one subject can produce, popovers included.
 *
 * Read off `document` rather than `panel.element`, and after every header
 * action has been pressed. The advanced clusters — Advanced type, stroke
 * settings — are `.pop-form` popovers now, mounted on the popover host rather
 * than inside the panel, so a panel-only query would have quietly stopped
 * seeing exactly the labels that were worst.
 *
 * Pressing every action is blunt, and deliberately so: some open a popover,
 * some add a row, one opens a menu. None of that matters to a label sweep, and
 * a list of which buttons are worth pressing is a list that goes stale.
 */
function railLabels(subject: (typeof SUBJECTS)[number]): string[] {
  const h = harness();
  const panel = new DesignPanel(h.deps);
  const node = mount(subject.tag, {
    style: subject.style,
    text: subject.text,
  });
  sizeOf(node, { height: 40, width: 100 });
  panel.setSelection(selectionOf(node));
  // Both roots: the harness never attaches `panel.element` to the document,
  // and the popover host mounts on `document.body` — so neither query alone
  // sees the whole panel.
  const read = (): string[] =>
    [
      ...panel.element.querySelectorAll(`.${cls("row-label")}`),
      ...document.querySelectorAll(`.${cls("row-label")}`),
    ]
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);

  const found = read();
  // One at a time, reading between each. Opening a second popover closes the
  // first — `openPopover` closes everything above its anchor's level — so
  // clicking every action and then reading once would only ever see the last
  // popover's rows, and would report a clean sweep for all the others.
  for (const action of panel.element.querySelectorAll<HTMLElement>(
    `.${cls("sect-act")}`
  )) {
    action.click();
    found.push(...read());
    closeOpenPopover();
  }
  return found;
}

/*
 * Swept once, asserted twice.
 *
 * Ten panels, each rebuilt and then had every header action pressed, is real
 * work — around ten seconds of it. Running the sweep per `it` doubled that and
 * put the file over vitest's five-second default, which is a slow test
 * masquerading as a broken one. The two cases ask different questions of the
 * same evidence, so the evidence is gathered once.
 *
 * `beforeEach(resetDocument)` still runs between them; only the collected
 * strings outlive it, and strings are all either case reads.
 */
/**
 * Longer than the default, because the sweep is genuinely long.
 *
 * Ten `DesignPanel` builds and every header action on each — around sixty
 * popover opens, each with its own mount and teardown. It runs in about a
 * second and a half alone and closer to seven alongside the other sixty-nine
 * files, which is over vitest's five-second default and reports as a timeout
 * rather than as the slow-but-working case it is. Raised deliberately, and
 * sized to leave room on a loaded machine rather than to just clear the bar.
 */
const SWEEP_TIMEOUT = 30_000;

let swept: string[] | null = null;
function allRailLabels(): string[] {
  if (!swept) {
    resetDocument();
    swept = SUBJECTS.flatMap(railLabels);
  }
  return swept;
}

describe("rail labels", () => {
  beforeEach(resetDocument);

  it(
    "renders enough rails to be worth checking",
    () => {
      // A harness that threw and swallowed it, or a selector that stopped
      // matching, would make the budget case below pass on an empty list.
      expect(new Set(allRailLabels()).size).toBeGreaterThan(15);
    },
    SWEEP_TIMEOUT
  );

  it(
    "keeps every rendered label inside the rail",
    () => {
      const tooLong = new Set<string>();
      for (const label of allRailLabels()) {
        if (label.length > LABEL_MAX_CHARS) {
          tooLong.add(`${label} (${label.length})`);
        }
      }
      expect([...tooLong].sort((a, b) => a.localeCompare(b))).toEqual([]);
    },
    SWEEP_TIMEOUT
  );
});
