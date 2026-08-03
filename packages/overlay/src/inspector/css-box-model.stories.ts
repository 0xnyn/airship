import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { type Caption, inspectorBody, section, stage } from "../stories/chrome";
import { noop } from "../stories/fixtures";
import { type SubjectName, subject } from "../stories/subjects";
import { createBoxModelDiagram } from "./css-box-model";

/*
 * The CSS tab's box-model diagram.
 *
 * Four nested rings — margin, border, padding, content — each side of each ring
 * an editable field. Reachable in the product only by selecting something,
 * switching to the CSS tab and scrolling, which is three steps too many for a
 * control with this many states.
 *
 * **The numbers come from computed style, not from `getBoundingClientRect`.**
 * That is the one thing to understand about this view. A measured box is in
 * *screen* pixels, so on the canvas at 40% zoom a 16px padding would read as
 * 6.4 — and the number you are about to edit is 16 whatever the viewport is
 * doing. Every value here is asked of the cascade rather than of the layout.
 *
 * **The twelve cells are the panel's own number field.** They were a second,
 * far weaker implementation for a while: no keystroke filter, no bounds, no
 * scrub, and a `normalize` whose fallback was `return raw` — so `abc`, `1.2.3px`
 * and an unclamped negative padding all went into the change set and on to the
 * agent, while the Design tab's padding control refused every one of them. Two
 * views of one property disagreeing about what a valid value is was the clearest
 * symptom that the panel had two field implementations.
 *
 * Both refusals below get a `play`, because neither is visible in a picture: a
 * border width that silently fails to paint looks exactly like one that painted,
 * and a rejected value looks like a value that was never typed.
 */

const meta: Meta = {
  title: "Inspector/CSS/Box model",
};

export default meta;

/** The diagram over a real specimen, synced once the specimen is measurable. */
function diagram(
  name: SubjectName | null,
  caption: Caption,
  onChange = noop
): HTMLElement {
  const view = createBoxModelDiagram({
    gestures: { begin: noop, end: noop },
    getNode: () => node,
    onChange,
  });

  let node: Element | null = null;
  let page: HTMLElement | undefined;
  if (name) {
    ({ node, page } = subject(name));
  }

  // After mount, for the reason `story-panel.ts` gives at length: a specimen
  // measured on `document.body` and then re-parented into the page pane has
  // been read in a container the reader never sees. Computed style is less
  // sensitive to this than a measured box, but inherited and percentage values
  // are not, and one code path is easier to trust than two.
  requestAnimationFrame(() => view.sync(node));

  return stage(inspectorBody([section("Box model", view.element)]), {
    caption,
    page,
  });
}

/**
 * A padded, bordered, margined element.
 *
 * The ordinary case, and the one to read the ring order off: margin outside,
 * then border, then padding, then the content box with its own size label.
 */
export const Diagram: StoryObj = {
  render: () =>
    diagram("card", {
      try: "compare a padding number here with the same one in the Design tab's Spacing section — they are the same value read the same way",
      what: "All four rings with something in each. The numbers are computed style, so they do not change with canvas zoom.",
    }),
};

/**
 * Zeroes, which render as an em dash.
 *
 * A grid of twelve `0`s is noise: the eye has to read every cell to find the one
 * that is not zero. "—" says "nothing here" at a glance, and the distinction it
 * draws is between *no value* and *a value that happens to be zero* — which for
 * this diagram are the same thing, because a zero margin and an absent one lay
 * out identically.
 */
export const Zeroes: StoryObj = {
  render: () =>
    diagram("tiles", {
      what: "An element with almost nothing set. Empty sides read as “—” rather than as a wall of zeroes.",
    }),
};

/** No selection at all — `sync(null)`, which is its own state rather than a blank. */
export const NoSelection: StoryObj = {
  render: () =>
    diagram(null, {
      what: "`sync(null)`: the rings stay, the values empty out. The diagram is the shape of the idea, not of one element.",
    }),
};

/**
 * `margin: 0 auto`, which is how a box is centred.
 *
 * The only view in the panel that shows it. `auto` is not a length, so it
 * reaches the field through `keywordsFor(property)` — asked of the property
 * rather than assumed, because `auto` is legal on a margin and meaningless on a
 * border width.
 */
export const AutoMargin: StoryObj = {
  render: () => {
    const built = subject("card");
    built.node.style.margin = "0 auto";
    built.node.style.maxWidth = "320px";

    const view = createBoxModelDiagram({
      gestures: { begin: noop, end: noop },
      getNode: () => built.node,
      onChange: noop,
    });
    requestAnimationFrame(() => view.sync(built.node));

    return stage(inspectorBody([section("Box model", view.element)]), {
      caption: {
        what: "`margin: 0 auto` on the left and right. The only place in the panel where a centred box says so.",
      },
      page: built.page,
    });
  },
};

/**
 * A width typed into a side with no style, which must also write `solid`.
 *
 * A border width only paints if the side has a style, and leaving that to the
 * user is a trap: the value is queued, previewed as though it worked, shipped to
 * the agent, and renders nothing with nothing saying why.
 *
 * The test used to be `parseFloat(value) > 0`, which is `NaN` for every keyword —
 * so `thin`, a perfectly legal `border-width`, slipped straight through it. Any
 * value that is not an explicit nothing needs the style now, keyword or number
 * alike, and this story types a keyword for exactly that reason.
 *
 * The `play` asserts both writes happened, and that they happened inside one
 * gesture bracket — so undo takes them back together rather than leaving a width
 * with no style behind.
 */
export const BorderPairing: StoryObj = {
  play: ({ canvasElement }) => {
    const field = canvasElement.querySelector<HTMLInputElement>(
      `.${cls("css-bm-border")} input`
    );
    if (!field) {
      throw new Error("No border field in the diagram.");
    }
    // `createNumField` commits on blur (and on Enter), never on `change` —
    // it is not a native form control and does not listen for one.
    field.focus();
    field.value = "thin";
    field.blur();

    const written = writes.map((w) => w.property);
    if (!written.some((p) => p.endsWith("-style"))) {
      throw new Error(
        `Typing a border width wrote ${JSON.stringify(written)} — no paired ` +
          "`border-*-style`, so this border would never paint. See `write` in css-box-model.ts."
      );
    }
    if (!(brackets.begun && brackets.ended)) {
      throw new Error(
        "The paired writes were not bracketed, so undo would separate them."
      );
    }
  },
  render: () => {
    writes.length = 0;
    brackets.begun = false;
    brackets.ended = false;

    const built = subject("button"); // `border: 0`, so no side has a style
    const view = createBoxModelDiagram({
      gestures: {
        begin: () => {
          brackets.begun = true;
        },
        end: () => {
          brackets.ended = true;
        },
      },
      getNode: () => built.node,
      onChange: (property, value) => writes.push({ property, value }),
    });
    requestAnimationFrame(() => view.sync(built.node));

    return stage(inspectorBody([section("Box model", view.element)]), {
      caption: {
        try: "this story types `thin` into a border side — a keyword, which the old numeric test let through unpaired",
        what: "A border width written onto a side with no style. `border-*-style: solid` has to ride along, in one undo step.",
      },
      page: built.page,
    });
  },
};

/** Recording seams for the two `play` stories above and below. */
const writes: { property: string; value: string }[] = [];
const brackets = { begun: false, ended: false };

/**
 * `50%` typed into a border width, and refused.
 *
 * A border width is a `<line-width>`, and there is no such thing as a percentage
 * one. Every other cell in this diagram is a `<length-percentage>` and takes the
 * full unit list, so the difference is per-*property* rather than per-control —
 * which is why the units are filtered where the cell is built rather than in the
 * field.
 *
 * It matters because the field's whole contract is that a value it accepts is
 * one the browser will accept for that property. `[...LENGTH_UNITS]` includes
 * `%`, so before the filter `50%` was accepted here, previewed as though it had
 * worked, and sent to the agent — for a declaration the browser simply drops.
 *
 * There is no unit menu to open: units are typed, and the refusal happens at
 * commit. The `play` types the same value into a margin and a border cell and
 * asserts the two disagree.
 */
export const PercentRefused: StoryObj = {
  play: ({ canvasElement }) => {
    const type = (ring: string): string => {
      const field = canvasElement.querySelector<HTMLInputElement>(
        `.${cls(`css-bm-${ring}`)} input`
      );
      if (!field) {
        throw new Error(`No ${ring} field in the diagram.`);
      }
      field.focus();
      field.value = "50%";
      field.blur();
      // Blur commits, and `display()` rewrites the input with what the field
      // actually accepted — so reading it back is reading the verdict.
      return field.value;
    };

    const margin = type("margin");
    const border = type("border");
    if (!margin.includes("%")) {
      throw new Error(
        `A margin should accept 50%, but the field settled on "${margin}".`
      );
    }
    if (border.includes("%")) {
      throw new Error(
        `A border width accepted "${border}" — % is not a <line-width>, so the ` +
          "browser drops the declaration. See the units filter in css-box-model.ts."
      );
    }
  },
  render: () =>
    diagram("card", {
      try: "this story types `50%` into a margin and into a border — the margin keeps it, the border does not",
      what: "The unit vocabulary is asked of the property, not fixed by the control.",
    }),
};
