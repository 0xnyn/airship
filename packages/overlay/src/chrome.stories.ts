import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "./dom";
import { emptyState } from "./empty";
import { createMenu } from "./popover-host";
import { dock, plainStage } from "./stories/chrome";
import { noop } from "./stories/fixtures";
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
