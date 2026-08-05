import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { icon } from "../icons";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { noop } from "../stories/fixtures";
import { disclosure } from "./disclosure";

/*
 * The collapsible row, and the reason it is not `<details>`.
 *
 * `<details>/<summary>` is the obvious choice and is wrong here twice over. The
 * overlay injects into the host page with no shadow root, so host stylesheets
 * reach our nodes — and `<summary>` carries UA *behaviour* (`display:
 * list-item`, the disclosure marker) that resets like Tailwind's preflight
 * routinely override. Worse, a `<summary>` is an activation target: every nested
 * button toggles the disclosure unless it stops the event, which is exactly the
 * footgun for the action buttons a tool row wants to grow.
 *
 * A button plus a div reproduces the semantics — `aria-expanded`, keyboard
 * operation, screen-reader announcement — in a shape host CSS cannot surprise.
 * The `NotToggleable` story below is where the second half of that argument is
 * actually demonstrated rather than asserted.
 *
 * The other thing worth knowing: this primitive draws **no chevron**. A timeline
 * row's status dot is its affordance, so a glyph there would be a second one.
 * Anything that does need a chevron owns it and swaps it from `onToggle`, which
 * fires once at construction precisely so the glyph can be seeded without the
 * caller duplicating the initial state.
 */

const meta: Meta = {
  title: "Chat/Disclosure",
};

export default meta;

function docked(children: HTMLElement[], caption: Caption): HTMLElement {
  return plainStage(
    [
      dock(el("div", { class: cls("transcript") }, children), {
        label: "Agent",
      }),
    ],
    caption
  );
}

function body(text: string): HTMLElement {
  return el("div", { class: cls("tl-detail"), text });
}

/**
 * Open and closed, at the timeline's own defaults.
 *
 * No chevron on either, which is the point: in the timeline these sit under a
 * status dot that already says the row is a row.
 */
export const Row: StoryObj = {
  render: () => {
    const shut = disclosure({
      head: [el("span", { text: "Grep(hero) · 3 files · 11 matches" })],
      open: false,
    });
    shut.body.append(body("src/components/hero.tsx\nsrc/app.css\nsrc/nav.tsx"));

    const open = disclosure({
      head: [el("span", { text: "Read(src/components/hero.tsx) · 214 lines" })],
      open: true,
    });
    open.body.append(
      body('  12 |     <section className="hero">\n  13 |       <h1>…</h1>')
    );

    return docked([shut.root, open.root], {
      try: "tab to a header and press Enter — it is a real button with `aria-expanded`, not a styled div",
      what: "The primitive at its defaults: a header button, a hidden body, and no chevron of its own.",
    });
  },
};

/**
 * A caller that supplies its own chevron.
 *
 * The pattern both `collapsible()` and `fileDiff()` in `transcript.ts` use.
 * `onToggle` fires once at construction, which is what seeds the glyph — without
 * that the caller would have to write the initial state twice and keep the two
 * in step.
 */
export const WithChevron: StoryObj = {
  render: () => {
    const make = (label: string, open: boolean) => {
      const chev = el("span", { class: cls("disc-chev") });
      const d = disclosure({
        bodyClass: cls("disc-body"),
        class: cls("follow-disc"),
        head: [chev, el("span", { text: label })],
        headClass: cls("disc-head"),
        onToggle: (isOpen) =>
          chev.replaceChildren(icon(isOpen ? "chev-down" : "chev-right", "xs")),
        open,
      });
      d.body.append(
        body("Three suggestions the agent offered after the edit.")
      );
      return d.root;
    };
    return docked([make("3 suggestions", false), make("2 suggestions", true)], {
      what: "A disclosure outside the timeline, where a chevron is the only thing saying it opens.",
    });
  },
};

/**
 * `toggleable: false`, and the nested-button guarantee.
 *
 * Two claims in one story. The first row's header is a plain `<div>` with no
 * `aria-expanded` and nothing to press — the shape used when a row has a body
 * worth showing but nothing worth hiding.
 *
 * The second is the `<summary>` footgun the whole module exists to avoid: a
 * button *inside* the body must not toggle the disclosure on its way up. The
 * `play` clicks it and the row must stay open. With a `<summary>` this would
 * have collapsed, and the fix would have been a `stopPropagation` in every
 * caller rather than one in the primitive.
 */
export const NotToggleable: StoryObj = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>("[data-nested]")?.click();
  },
  render: () => {
    const plain = disclosure({
      head: [el("span", { text: "Bash(pnpm typecheck) · exit 2" })],
      open: true,
      toggleable: false,
    });
    plain.body.append(body("src/components/hero.tsx:14:9 - error TS2322"));

    const nested = disclosure({
      head: [el("span", { text: "Edit(src/components/hero.tsx) · +5 −1" })],
      open: true,
    });
    nested.body.append(
      body("The body can hold anything, including things you can press:"),
      el(
        "button",
        {
          class: cls("select"),
          "data-nested": "",
          onClick: noop,
          type: "button",
        },
        [el("span", { text: "A button inside the body" })]
      )
    );

    return docked([plain.root, nested.root], {
      try: "the button below has just been clicked by this story's `play` — the row it sits in must still be open",
      what: "A non-toggleable header, and the guarantee that a button inside a body does not collapse it.",
    });
  },
};
