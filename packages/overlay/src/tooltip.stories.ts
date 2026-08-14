import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "./dom";
import { type IconName, icon } from "./icons";
import { keys } from "./keys";
import { popoverHost } from "./popover-host";
import {
  type Caption,
  dock,
  inspectorBody,
  plainStage,
  section,
} from "./stories/chrome";
import { noop } from "./stories/fixtures";
import { onStoryTeardown } from "./stories/lifecycle";
import { Tooltips } from "./tooltip";

/*
 * The overlay's tooltips.
 *
 * Native `title` was doing this job and cannot: it opens after about a second,
 * cannot be styled, and — the reason this module exists — cannot show a keyboard
 * shortcut. A design tool's tooltips carry their own shortcut, and that is a
 * real part of why an app feels like someone cared rather than like a prototype.
 *
 * One delegated listener and one shared node, not a tooltip per control. Every
 * icon button in the editor would otherwise be an extra DOM node and an extra
 * pair of listeners for something shown a few hundred milliseconds at a time.
 *
 * Two placement rules make up most of the design, and both are about the
 * inspector specifically:
 *
 * **Above inside the panel body, below everywhere else.** The panel is the one
 * place in the editor where full-width controls stack six pixels apart, so a tip
 * placed below a row lands squarely on the next one — the control you are on
 * your way to. The rows above it are values you have already read.
 *
 * **Clamped to the dock before the viewport.** A tip on a caret at the right
 * edge of a 360px panel is inside the window and still outside the panel,
 * hanging past a rounded border with nothing under it. That reads as a bug
 * rather than as that control's label.
 *
 * Hovering is driven by dispatching a real `pointerover`, which is what the
 * delegated listener is bound to. No new test dependency — the same raw-event
 * idiom `select.stories.ts` already uses for its `.click()`.
 */

const meta: Meta = {
  title: "Chrome/Tooltips",
};

export default meta;

/** How long a pointer must rest before a tooltip opens, plus a frame. */
const DELAY = 450;

/**
 * Stand a `Tooltips` up, then hover a control and wait out the open delay.
 *
 * Both halves belong in `play` rather than in `render`, and the ordering is the
 * reason. `Tooltips` mounts into the popover host — the overlay root's *last*
 * child — and `preview.ts` calls `mountPopoverHost` only *after* `story()` has
 * returned, so during `render` there is no host to mount into. `play` runs after
 * the story is in the document, which is the first moment this can be built.
 *
 * The host and not the chrome layer, incidentally: the layer shares the root's
 * `z-index` but is appended before it, so it paints under the docks. Mounted
 * there, a tooltip anchored to any control inside a panel was drawn behind that
 * panel and never seen.
 */
function hover(canvasElement: HTMLElement, tip: string): Promise<void> {
  const host = popoverHost();
  if (!host) {
    throw new Error(
      "No popover host — `mountPopoverHost` did not run. See .storybook/preview.ts."
    );
  }
  const instance = new Tooltips(host);
  onStoryTeardown(() => instance.destroy());

  // Matched against `dataset` rather than through `[data-tip="…"]`, because a
  // real tip is not always a safe attribute selector: a font stack carries the
  // quotes around `"Segoe UI"`, which closes the selector's own string early and
  // throws. Reading the property back is the same lookup without the escaping.
  const target = [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-tip]"),
  ].find((node) => node.dataset.tip === tip);
  if (!target) {
    throw new Error(`No control in this story carries the tip ${tip}`);
  }
  target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  // `reject`, not a bare `throw`: an exception raised inside the timeout escapes
  // the promise entirely, so the story hangs to its 15s timeout and reports that
  // instead of the measurement that failed.
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        assertContained(host);
        resolve();
      } catch (error) {
        reject(error);
      }
    }, DELAY);
  });
}

/** The tip node, or a thrown explanation of why there isn't one. */
function openTip(): { key: HTMLElement | null; node: HTMLElement } {
  const host = popoverHost();
  const node = host?.querySelector<HTMLElement>(`.${cls("tip")}`);
  if (!node) {
    throw new Error("The tip did not open, so there is nothing to measure.");
  }
  return { key: node.querySelector(`.${cls("tip-key")}`), node };
}

/**
 * A tip that runs long stops at three lines rather than growing without bound.
 *
 * 11px type at `line-height: 1.5` is 16.5px a line, so three lines plus the 4px
 * padding and 1px border is around 59px. The unclamped alternative for a comment
 * body this size is fourteen lines and 240px of panel — which is the reason the
 * clamp is there, and the reason a bare `overflow: hidden` would not do.
 */
function assertClamped(): void {
  const { node } = openTip();
  const { height } = node.getBoundingClientRect();
  if (height > 80) {
    throw new Error(
      `The tip grew to ${Math.round(height)}px; three lines is about 59px, so the line clamp is not applying.`
    );
  }
}

/**
 * The chord sits beside the first line of a wrapped tip, not under it.
 *
 * `flex-wrap: nowrap` on the container is what holds it there and `baseline` is
 * what puts it on that first line specifically. Both are easy to lose to a
 * well-meaning `align-items: center`, and neither shows up in a width check.
 */
function assertChipOnFirstLine(): void {
  const { key, node } = openTip();
  if (!key) {
    throw new Error("No chord chip rendered, so `hintFor` found no binding.");
  }
  const box = node.getBoundingClientRect();
  const chip = key.getBoundingClientRect();
  if (chip.top - box.top > 12) {
    throw new Error(
      `The chord dropped ${Math.round(chip.top - box.top)}px below the tip's top edge, so it is no longer on the first line.`
    );
  }
}

/**
 * The tip's text must sit inside the tip's own background.
 *
 * The bug this whole module was reworked for, asserted where layout is real:
 * `white-space: nowrap` alongside a width cap and no overflow rule let the text
 * lay out at its full intrinsic width while the border, background and shadow
 * painted at the cap. From about 45 characters up the label hung outside its own
 * box, and roughly fifteen tips in the product were over that line.
 *
 * Checked in `hover`, so it runs for every story in this file rather than only
 * the two written about wrapping — and only under `test:browser`, since happy-dom
 * has no layout to measure. A pixel of tolerance for subpixel rounding.
 */
function assertContained(host: HTMLElement): void {
  const node = host.querySelector<HTMLElement>(`.${cls("tip")}`);
  const text = node?.querySelector<HTMLElement>(`.${cls("tip-text")}`);
  if (!(node && text)) {
    throw new Error("The tip did not open, so there is nothing to measure.");
  }
  const box = node.getBoundingClientRect();
  if (!box.width) {
    return;
  }
  // `scrollWidth` against `clientWidth`, not one rect against the other. The
  // rects agree even when this is broken: the span is a flex item, so it takes
  // the width the cap allows and the glyphs spill out of it without moving its
  // box. Overflowing *content* is the thing that was visible, so it is the thing
  // measured. Height is left alone — the line clamp overflows it on purpose.
  if (text.scrollWidth > text.clientWidth + 1) {
    throw new Error(
      `The tip's text runs outside its background: ${text.scrollWidth}px of text in a ${text.clientWidth}px box.`
    );
  }
  const inner = text.getBoundingClientRect();
  if (inner.right > box.right + 1 || inner.left < box.left - 1) {
    throw new Error(
      `The tip's text sits outside the tip: text ${Math.round(inner.left)}-${Math.round(inner.right)}, box ${Math.round(box.left)}-${Math.round(box.right)}.`
    );
  }
}

function tipButton(glyph: IconName, tip: string, extra = ""): HTMLElement {
  return el(
    "button",
    {
      "aria-label": tip,
      class: `${cls("action")} ${cls("action-icon")} ${extra}`.trim(),
      "data-tip": tip,
      onClick: noop,
      type: "button",
    },
    [icon(glyph, "sm")]
  );
}

/**
 * A rail of icon buttons, one of them hovered.
 *
 * The bottom bar's shape: chrome outside any panel, so the tip goes below, where
 * the space under the control is empty.
 */
export const Grid: StoryObj = {
  play: ({ canvasElement }) => hover(canvasElement, "Move"),
  render: () =>
    plainStage(
      [
        el("div", { class: cls("bar"), style: "display: flex; gap: 4px;" }, [
          tipButton("tool-move", "Move"),
          tipButton("tool-comment", "Comment"),
          tipButton("edit", "Edit"),
          tipButton("view", "View"),
        ]),
      ],
      {
        try: "hover along the row — after the first tip the rest open instantly, which is what makes scanning a toolbar feel responsive",
        what: "Toolbar chrome, outside any dock. The tip opens below, after a 400ms rest.",
      }
    ),
};

/**
 * A tip that carries its shortcut.
 *
 * The whole reason this module exists rather than a `title` attribute.
 * `keys.hintFor(label)` looks the binding up by its *label*, so the tip and the
 * keymap cannot drift: a shortcut that is rebound changes here with no edit, and
 * one that is removed stops being advertised.
 *
 * The binding is registered by the story and its disposer handed to the
 * lifecycle registry — `keys` is a module singleton, so a story that bound
 * without unbinding would leave a live shortcut in every story after it.
 */
export const WithShortcut: StoryObj = {
  play: ({ canvasElement }) => hover(canvasElement, "Undo"),
  render: () => {
    onStoryTeardown(keys.bind({ keys: "mod+z", label: "Undo", run: noop }));
    onStoryTeardown(
      keys.bind({ keys: "mod+shift+z", label: "Redo", run: noop })
    );
    return plainStage(
      [
        el("div", { class: cls("bar"), style: "display: flex; gap: 4px;" }, [
          // Both `rotate-ccw`, as the bottom bar builds them: there is no
          // redo glyph, and `.bar-redo` mirrors the undo one.
          tipButton("rotate-ccw", "Undo"),
          tipButton("rotate-ccw", "Redo", cls("bar-redo")),
          // No binding registered for this one, so `hintFor` returns null and
          // the tip is text alone — which is the common case and has to look
          // deliberate rather than truncated.
          tipButton("more", "More actions"),
        ]),
      ],
      {
        try: "compare Undo with More actions — the chord is looked up by label, so an unbound control shows text and nothing else",
        what: "A tooltip carrying its keyboard shortcut, which is the thing `title` cannot do.",
      }
    );
  },
};

/**
 * Inside the panel body, where the tip goes above.
 *
 * Full-width rows stack six pixels apart here, so a tip below a row would cover
 * the next one — the control you are moving towards, rather than the values you
 * have already read.
 */
export const InsidePanel: StoryObj = {
  play: ({ canvasElement }) => hover(canvasElement, "Independent corners"),
  render: () =>
    plainStage(
      [
        dock(
          inspectorBody([
            section(
              "Appearance",
              el("div", { style: "display: grid; gap: 6px;" }, [
                tipButton("corners-independent", "Independent corners"),
                tipButton("opacity", "Opacity"),
                tipButton("effect-drop-shadow", "Drop shadow"),
              ])
            ),
          ])
        ),
      ],
      {
        try: "compare with Grid above — same control, opposite side, decided by whether it sits in `.insp-body`",
        what: "A tip inside the inspector body, placed above so it does not land on the next row.",
      }
    ),
};

/*
 * The four shapes a tooltip's text actually takes. Only the first is copy that
 * anyone wrote — the rest are values read off the page, which is why the tip
 * wraps instead of ellipsing on one line: for these it *is* the untruncated view
 * of a field that already truncated.
 */

/** Authored copy, at the length the copy standard targets. */
const SHORT_TIP = "Clip anything outside this element";
/** A computed font stack, as the Text section shows it. Wraps at its commas. */
const STACK_TIP =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** A stylesheet URL, as the CSS tab shows it. No spaces anywhere to break at. */
const URL_TIP =
  "https://cdn.example.com/assets/design-system/v4/tokens.generated.css";
/** A review comment, which is whatever somebody typed into it. */
const BODY_TIP =
  "This card is the only surface in the flow that sets its own radius, and it disagrees with the two beside it. Either pull it back to the token or change all three together, but do not leave it as the odd one out — it reads as a mistake rather than as emphasis, and it is the first thing the eye lands on.";

/**
 * A control at the right edge of the narrowest dock.
 *
 * The clamp `bounds()` exists for. The tip is centred on its control, which puts
 * it past the panel's right border — inside the window, outside the panel, and
 * hanging over nothing. Clamping to the dock first and the viewport second is
 * what keeps it attached to the thing it names.
 *
 * The tip is a stylesheet URL rather than a label, and that is the point of the
 * case. This story's caption has always said "a long tip", but it used to hover
 * `Advanced stroke settings` — 24 characters, comfortably inside the cap — so it
 * never once exercised the path it was written to guard. `TIP_MAX_W` and
 * `MIN_DOCK_W` are twenty pixels apart, and this is the one place they meet.
 */
export const AtTheEdge: StoryObj = {
  play: ({ canvasElement }) => hover(canvasElement, URL_TIP),
  render: () =>
    plainStage(
      [
        dock(
          inspectorBody([
            section(
              "Stroke",
              el(
                "div",
                { style: "display: flex; justify-content: flex-end;" },
                [tipButton("settings", URL_TIP)]
              )
            ),
          ]),
          { narrow: true }
        ),
      ],
      {
        try: "the tip must stay inside the dock's rounded border — past it, a label reads as a rendering bug",
        what: "A tip wider than the panel, on a control flush with the right edge of a `MIN_DOCK_W` dock.",
      }
    ),
};

/**
 * Every length a tip can be, in one panel.
 *
 * This is the case the old CSS got wrong. It declared `white-space: nowrap`
 * beside a width cap and no overflow rule, so the text laid out at its full
 * intrinsic width while the border, background and shadow painted at the cap:
 * from about 45 characters up, every label sat outside its own box. Roughly
 * fifteen tooltips in the product were over that line.
 *
 * Hover each in turn. The first is one line; the second wraps at its commas; the
 * third has nothing to wrap at and leans on `overflow-wrap: anywhere`; the
 * fourth runs past three lines and is the only one that ends in an ellipsis.
 */
export const Wrapping: StoryObj = {
  play: ({ canvasElement }) =>
    hover(canvasElement, BODY_TIP).then(assertClamped),
  render: () =>
    plainStage(
      [
        dock(
          inspectorBody([
            section(
              "Appearance",
              el("div", { style: "display: grid; gap: 6px;" }, [
                tipButton("crop", SHORT_TIP),
                tipButton("style-text", STACK_TIP),
                tipButton("code", URL_TIP),
                tipButton("comment-message", BODY_TIP),
              ])
            ),
          ])
        ),
      ],
      {
        try: "compare the font stack with the URL — one wraps at its commas, one has no spaces at all, and both stay inside their own background",
        what: "The four text shapes a tip carries. Only the first is copy anyone wrote.",
      }
    ),
};

/**
 * A wrapped tip that also carries a chord.
 *
 * The chip is the one part of a tooltip that is unreadable if it breaks, so it
 * is `flex: 0 0 auto` and never wraps, and the text carries `min-width: 0` so the
 * text is what gives way instead. The container stays `flex-wrap: nowrap`, which
 * is what keeps the chip beside the first line rather than orphaning it onto a
 * line of its own under three lines of prose.
 */
export const WrappedWithShortcut: StoryObj = {
  play: ({ canvasElement }) =>
    hover(canvasElement, STACK_TIP).then(assertChipOnFirstLine),
  render: () => {
    // Bound by label, which is how `hintFor` finds it. The disposer goes to the
    // lifecycle registry: `keys` is a singleton, and a story that bound without
    // unbinding would leave a live shortcut in every story after it.
    onStoryTeardown(
      keys.bind({ keys: "mod+alt+f", label: STACK_TIP, run: noop })
    );
    return plainStage(
      [
        dock(
          inspectorBody([
            section(
              "Text",
              el("div", { style: "display: grid; gap: 6px;" }, [
                tipButton("style-text", STACK_TIP),
              ])
            ),
          ])
        ),
      ],
      {
        try: "the chord sits on the first line beside the text, not on a line of its own beneath it, and never breaks after the ⌘",
        what: "A tip that wraps *and* carries a shortcut — the two layout rules in the same box.",
      }
    );
  },
};
