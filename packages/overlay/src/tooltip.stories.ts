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

  canvasElement
    .querySelector(`[data-tip="${tip}"]`)
    ?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  return new Promise((resolve) => setTimeout(resolve, DELAY));
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

/**
 * A control at the right edge of the narrowest dock.
 *
 * The clamp `bounds()` exists for. The tip is centred on its control, which puts
 * it past the panel's right border — inside the window, outside the panel, and
 * hanging over nothing. Clamping to the dock first and the viewport second is
 * what keeps it attached to the thing it names.
 */
export const AtTheEdge: StoryObj = {
  play: ({ canvasElement }) => hover(canvasElement, "Advanced stroke settings"),
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
                [tipButton("settings", "Advanced stroke settings")]
              )
            ),
          ]),
          { narrow: true }
        ),
      ],
      {
        try: "the tip must stay inside the dock's rounded border — past it, a label reads as a rendering bug",
        what: "A long tip on a control flush with the right edge of a `MIN_DOCK_W` panel.",
      }
    ),
};
