import type { Meta, StoryObj } from "@storybook/html-vite";
import { deviceGroups } from "./canvas/device-menu";
import { cls, el } from "./dom";
import { emptyState } from "./empty";
import { createMenu, type MenuHandle } from "./popover-host";
import { dock, plainStage } from "./stories/chrome";
import { noop } from "./stories/fixtures";
import { onStoryTeardown } from "./stories/lifecycle";
import { mountToastHost, type ToastTone, toast } from "./toast";

/*
 * The overlay's shared chrome: empty states, toasts and popover shells.
 *
 * Three things that appear on every surface and belong to none of them, which is
 * exactly why they are worth a catalogue entry. Each is a module singleton or a
 * one-of-a-kind component, so in the running editor you see one at a time, in
 * whatever context happened to raise it, and never side by side.
 */

const meta: Meta = {
  title: "Chrome/Shared",
};

export default meta;

/**
 * Wait for a node a story's own `requestAnimationFrame` is about to mount.
 *
 * A popover cannot be opened from `render`: `openPopover` places against a
 * measured rect and a detached anchor measures as all zeros, so every story here
 * opens on the next frame. `play` runs before that frame lands, so a `play` that
 * asserted on the menu directly would be asserting on nothing.
 *
 * Recursive rather than a polling loop, which is not a style choice: an `await`
 * inside a `for` is what `noAwaitInLoops` exists to catch, and the honest shape
 * for "resolve when this appears" is one promise rather than sixty.
 */
function waitFor<T extends Element>(
  root: Document,
  selector: string,
  frames = 60
): Promise<T | null> {
  return new Promise((resolve) => {
    let left = frames;
    const look = (): void => {
      const found = root.querySelector<T>(selector);
      if (found || left <= 0) {
        resolve(found);
        return;
      }
      left -= 1;
      requestAnimationFrame(look);
    };
    look();
  });
}

/**
 * The one empty state, at both sizes.
 *
 * `md` fills a dock; `sm` sits inside a section. The mark is the airship
 * monogram rather than a pictogram, and the reasoning in `empty.ts` is a
 * legibility argument worth checking against the render: two slabs and one
 * counter still resolve at any size an empty state would use, where the saucer
 * this replaced closed into a smudge below about 44px.
 *
 * Deliberately *not* used inside a section's row list. Those used to render a
 * "None" row on the reasoning that a placeholder stopped the section jumping
 * when the first fill was added; it also stated a value the element did not
 * have, and Filters — which stacks two lists — opened onto four lines of it.
 */
export const EmptyStates: StoryObj = {
  render: () =>
    plainStage(
      [
        dock(
          el("div", { class: cls("insp") }, [
            el("div", { class: cls("insp-body") }, [
              emptyState({
                body: "Hover the page to see what is selectable.",
                title: "Pick an element to start tweaking",
              }),
              emptyState({
                body: "Add one below, or edit a computed value.",
                size: "sm",
                title: "No overrides yet",
              }),
              emptyState({ size: "sm", title: "Nothing here yet" }),
            ]),
          ])
        ),
      ],
      {
        what: "The empty states, side by side. Each is a module singleton, so the running editor shows one at a time and never two.",
      }
    ),
};

/**
 * Both toast tones.
 *
 * A toast is `pointer-events: none` and gone in under three seconds, which is
 * why it sits *above* the popover layer rather than below: putting it on top can
 * never cost anyone a click, whereas a toast painted under an open colour picker
 * is unreadable at exactly the moment it is trying to tell you something.
 *
 * Only one can be up at a time — `toast()` replaces whatever is showing and
 * restarts its dwell — so the buttons here raise them one by one rather than
 * stacking, which is the honest demonstration.
 */
export const Toasts: StoryObj = {
  render: () => {
    const host = el("div", {
      style: "position: relative; min-height: 220px; width: 100%;",
    });
    mountToastHost(host);
    const raise = (label: string, tone: ToastTone) =>
      el("button", {
        class: cls("select"),
        onClick: () => toast(label, { tone }),
        text: `${label}  ·  ${tone}`,
        type: "button",
      });
    // Two tones, not three. `ToastTone` is `"error" | "neutral"` and there is no
    // success case, which is a decision rather than an omission: the overlay
    // confirms a successful edit by *showing the edit*, and a toast saying so
    // would be a second, weaker report of something already on screen.
    return plainStage(
      [
        el(
          "div",
          { style: "display: grid; gap: 10px; justify-items: start;" },
          [
            raise("Undo", "neutral"),
            raise("Nothing to undo", "neutral"),
            raise("This layer has no text to edit", "error"),
            host,
          ]
        ),
      ],
      {
        what: "Both tones and the coalescing counter, which is what stops a repeated failure stacking six identical toasts.",
      }
    );
  },
};

/**
 * A menu, open, with every row kind it supports.
 *
 * Headers and separators carry no `data-pop-item`, which is what keeps the
 * arrow-key roving on the rows you can actually choose. `pop-item-on` is the
 * selected value; `data-pop-active` is the keyboard cursor — two different
 * things that a single highlight would conflate.
 */
export const Menu: StoryObj = {
  render: () => {
    const anchor = el("button", {
      class: cls("select"),
      text: "Open menu",
      type: "button",
    });
    const menu = createMenu([
      { header: "Alignment" },
      { icon: "align-left", label: "Align left", on: true, run: noop },
      { icon: "align-h-center", label: "Align centre", run: noop },
      { icon: "align-right", label: "Align right", run: noop },
      { separator: true },
      { hint: "⌘⇧D", label: "Distribute horizontally", run: noop },
      { disabled: true, label: "Tidy up", run: noop },
    ]);
    // After the anchor is in the document: `openPopover` positions against a
    // measured rect, and a detached anchor measures as all zeros.
    requestAnimationFrame(() => menu.open(anchor));
    return plainStage([el("div", { style: "width: 220px;" }, [anchor])], {
      try: "arrow through it — `data-pop-on` is the selected value and `data-pop-active` is the keyboard cursor, deliberately two different marks",
      what: "A popover menu with headers, a separator, a checked item and a disabled one.",
    });
  },
};

/**
 * A grouped menu, and the two measurements that used to be wrong in it.
 *
 * The frame list's `⋯` menu is this shape: a block of verbs, then the twenty-two
 * device presets as three single-open groups. It shipped with two faults that no
 * unit test can see, because happy-dom does no layout — which is exactly why
 * this story exists and why its `play` is an assertion rather than a look.
 *
 * **It changed width when you opened a group.** A collapsed body was
 * `display: none`, so it contributed nothing to the shrink-to-fit box: about
 * 158px with everything shut, about 250 with one group open. `seedOpenGroup`
 * opens one at build time, so the menu painted wide and snapped narrow on the
 * first collapse — and since `placePopover` derives `left` from `offsetWidth`, a
 * width jump was a sideways jump too. `canvas.css.ts` answered the same problem
 * on its own device menu with a hand-measured `min-width` and a paragraph
 * apologising for it; the collapse was the thing that was wrong, and an `inert`
 * body that is still laid out needs no floor at all.
 *
 * **Its rows sat at three heights and two left edges.** A verb row carried a
 * 20px glyph and landed its label at 36px, a group head a 16px chevron at 30,
 * and a device row nothing at all — 30, 26 and 25 pixels tall respectively,
 * because a text-only row is sized by `line-height: normal`.
 */
export const GroupedMenu: StoryObj = {
  play: async ({ canvasElement }) => {
    const menu = await waitFor<HTMLElement>(
      canvasElement.ownerDocument,
      `.${cls("pop-menu")}`
    );
    if (!menu) {
      throw new Error("The grouped menu did not open.");
    }
    await document.fonts.ready;

    /*
     * Every state, not just the two ends. The failure was per-group — the widest
     * row differs between Phone ("iPhone 16 & 17 Pro Max" beside "440 × 956")
     * and Desktop ("MacBook Pro 16"") — so a check that only opened one group
     * would have passed on the broken build.
     */
    const heads = [
      ...menu.querySelectorAll<HTMLElement>(`.${cls("pop-group-head")}`),
    ];
    const widths = new Set([menu.offsetWidth]);
    for (const head of heads) {
      head.click();
      widths.add(menu.offsetWidth);
      head.click();
      widths.add(menu.offsetWidth);
    }
    if (widths.size !== 1) {
      throw new Error(
        `The menu resized as its groups were toggled: ${[...widths].join(", ")}px. ` +
          "A collapsed `.pop-group-body` must stay in layout — see `[inert]` in pop.css.ts."
      );
    }

    // One left edge for all three row families, with a group open so device
    // rows are being measured too. `:not(.ic)` because `icon()` returns a span
    // of its own, so the head's chevron is also a direct span child — without
    // it this measures the gutter the triangle hangs in rather than the label.
    heads[0]?.click();
    const lefts = new Set(
      [
        ...menu.querySelectorAll<HTMLElement>(
          `.${cls("pop-item-label")}, .${cls("pop-group-head")} > span:not(.${cls("ic")})`
        ),
      ].map((node) => Math.round(node.getBoundingClientRect().left))
    );
    if (lefts.size !== 1) {
      throw new Error(
        `Labels start at ${lefts.size} different edges: ${[...lefts].join(", ")}px. ` +
          "A verb, a group name and a device name all sit at 8px padding + a 16px glyph + a 6px gap."
      );
    }
  },
  render: () => {
    const anchor = el("button", {
      class: cls("select"),
      text: "Frame options",
      type: "button",
    });
    const menu: MenuHandle = createMenu([
      {
        command: "frame.bringForward",
        icon: "chev-up",
        label: "Bring forward",
        run: noop,
      },
      {
        command: "frame.sendBackward",
        icon: "chev-down",
        label: "Send backward",
        run: noop,
      },
      { separator: true },
      { icon: "rotation", label: "Rotate", run: noop },
      { icon: "rotate-ccw", label: "Reload", run: noop },
      { icon: "doc-plus", label: "Duplicate", run: noop },
      { icon: "trash", label: "Delete", run: noop },
      { separator: true },
      ...deviceGroups(noop),
    ]);
    // After the anchor is in the document, for the reason `Menu` above gives.
    requestAnimationFrame(() => menu.open(anchor));
    onStoryTeardown(() => menu.close());
    return plainStage([el("div", { style: "width: 220px;" }, [anchor])], {
      try: "open and shut each device group — the box must not change width, and every label must start on the same edge",
      what: "The frame list's row menu: verbs, then the device presets as single-open groups.",
    });
  },
};
