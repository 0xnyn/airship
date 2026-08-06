import type { Preview } from "@storybook/html-vite";
import { PREFIX } from "../src/dom";
import { closeOpenPopover, mountPopoverHost } from "../src/popover-host";
import { setCaptionsEnabled } from "../src/stories/captions";
import { runStoryTeardown } from "../src/stories/lifecycle";
import { overlayCss } from "../src/styles";
import { setRuntimeTokens, setStaticTokens } from "../src/tokens/registry";

/*
 * What every story needs around it before it can be looked at honestly.
 *
 * Each of the four things below is a *silent* failure if skipped: nothing
 * throws, the story renders, and what you are looking at is wrong. That is the
 * whole reason they are here rather than in each story.
 */

/**
 * The overlay stylesheet, as one tag, re-written in place.
 *
 * Deliberately not `injectStyles()`. That function guards on a module-level
 * `injected` flag, and Vite resets module state on HMR — so editing any
 * `styles/*.css.ts` clears the flag and appends a *second*
 * `<style id="__airship-styles">`. New rules would win on order, but rules you
 * had just *deleted* would keep applying from the stale tag, which is the
 * failure mode most likely to waste an afternoon during a CSS pass.
 *
 * The id is load-bearing beyond identifying the tag: `isOwnSheet`
 * (`inspector/css-rules.ts`) matches on exactly this string, and it is what
 * stops the overlay's own three thousand rules being reported to the CSS pane as
 * the inspected page's provenance.
 */
function syncStyles(): void {
  const id = `${PREFIX}-styles`;
  const tag = document.getElementById(id) ?? document.createElement("style");
  tag.id = id;
  const css = overlayCss();
  if (tag.textContent !== css) {
    tag.textContent = css;
  }
  if (!tag.isConnected) {
    document.head.append(tag);
  }
}

/**
 * A registry with nothing in it.
 *
 * `setStaticTokens`/`setRuntimeTokens` write module singletons, so one token
 * story would otherwise leave a design-token badge on every field of every story
 * rendered after it — and, worse, in whichever order Storybook happened to visit
 * them. Stories that want tokens seed them themselves.
 */
function resetTokens(): void {
  const empty = { framework: "unknown", tokens: [] } as const;
  setStaticTokens(empty);
  setRuntimeTokens(empty);
}

/**
 * Fill in the caption's title from Storybook's own metadata.
 *
 * The strip renders an empty title slot and this stamps it, rather than each
 * story writing its own name into its caption. Two reasons, and the second is
 * the real one: it removes ~150 restatements of a name Storybook already knows,
 * and it makes the heading structurally incapable of disagreeing with the
 * sidebar entry that got you there.
 *
 * `title.split("/").at(-1)` because the full path is already the breadcrumb
 * above the canvas — repeating "Inspector/Sections/" inside the frame spends a
 * line on something the reader can see.
 */
function stampTitle(root: HTMLElement, title: string, name: string): void {
  const slot = root.querySelector<HTMLElement>("[data-story-title]");
  if (slot) {
    slot.textContent = `${title.split("/").at(-1) ?? title} · ${name}`;
  }
}

const preview: Preview = {
  decorators: [
    (story, context) => {
      /*
       * Teardown at entry rather than on unmount.
       *
       * A popover left open by the previous story is anchored to a control that
       * no longer exists, and Storybook's unmount hook is not somewhere to rely
       * on for a module singleton. Closing here is idempotent and runs even when
       * the previous story crashed.
       *
       * `runStoryTeardown` is the same contract for the stories that bind
       * outside their own DOM — a canvas viewport listening on `window`, a
       * `Tooltips` instance on `document`, a `ResizeObserver` held by a
       * selection marker. See `stories/lifecycle.ts`.
       */
      closeOpenPopover();
      runStoryTeardown();
      syncStyles();
      resetTokens();

      // Before `story()`: `stage()` reads this while it builds, and it is called
      // from inside `render`, which Storybook hands no context.
      setCaptionsEnabled(context.globals.captions !== "off");

      /*
       * `#__airship-root`, and it has to be exactly that.
       *
       * The design tokens are emitted scoped rather than on `:root` — see the
       * `VARS` block in `styles/index.ts`, which exists so the editor's palette
       * cannot leak into the app being edited. A `var(--ap-*)` referenced outside
       * that selector list is invalid-at-computed-value-time, and the browser
       * drops the whole declaration without a word. Rendering a control outside
       * this element does not produce an unstyled control; it produces a
       * differently-broken one.
       */
      const root = document.createElement("div");
      root.id = `${PREFIX}-root`;
      root.append(story() as Node);

      /*
       * Re-parent the popover host into *this* root, every render.
       *
       * `mountPopoverHost` reuses a cached module-level node and `append`s it,
       * which moves it. Called once, the host would stay in the first story's
       * subtree and be detached from the document from the second story onward.
       * Left to heal itself, `openPopover` mounts it on `document.body` — outside
       * the token scope above, so every menu, colour picker and gradient editor
       * would open unstyled.
       *
       * Last child of the root, matching `AirshipApp.mount`.
       */
      mountPopoverHost(root);

      // After the story has built its DOM, because the slot is inside it.
      stampTitle(root, context.title, context.name);

      return root;
    },
  ],

  globalTypes: {
    captions: {
      description: "The explanatory strip above each story",
      toolbar: {
        icon: "info",
        items: [
          { title: "Captions on", value: "on" },
          { title: "Captions off", value: "off" },
        ],
        title: "Captions",
      },
    },
  },

  /*
   * Dark by default, because the editor has no light mode.
   *
   * Three of the border tokens are `rgba(255,255,255,0.06…0.12)`. On a white
   * canvas they are invisible, so a hairline that was never drawn looks exactly
   * like one that was — which is the single easiest way for a Storybook to lie
   * about this particular UI.
   */
  initialGlobals: { backgrounds: { value: "editor" }, captions: "on" },

  parameters: {
    /*
     * Report every axe violation; do not fail on one. Yet.
     *
     * `"error"` is where this should end up and is one word away. It is not the
     * setting today because turning it on lights up 114 of 157 stories, and a
     * suite that is permanently red is a suite people learn to ignore — which
     * would cost more than the check is worth.
     *
     * The findings are real, and they are not 421 problems. Nearly all of them
     * are four, and every one of the four is in the *product*, not the harness:
     *
     *  - `aria-command-name` (241) — the drag-to-scrub grips. dnd-kit stamps
     *    `aria-roledescription="draggable"` on `.ctl-glyph` and gives it no
     *    accessible name. Injected by the library, not hand-written here.
     *  - `aria-allowed-attr` (55) and `button-name` (28) — `.sect-head` is a
     *    `<div>` carrying `aria-expanded`, and several icon buttons name
     *    themselves with `data-tip` (the overlay's own tooltip) rather than
     *    `aria-label`. `select.ts` already made exactly this correction for the
     *    select trigger and wrote down why; the rest have not had it yet.
     *  - `nested-interactive` (49) — the scrub grip is focusable and sits inside
     *    the field that owns the `<input>`.
     *
     * The remainder is `color-contrast` (44, mostly `.insp-src`) and
     * `scrollable-region-focusable` (4) on the panel body.
     *
     * ## Read the rate, not the total
     *
     * The catalogue went from 96 stories to 157, so the total was always going
     * to rise; what matters is that the *set of rules* is unchanged and the rate
     * fell slightly — about 2.7 findings per story, from 2.9. Anything that adds
     * a rule category is a regression however small its count, because the value
     * of this list is being able to say "the a11y report is these four known
     * problems" and have it stay true.
     *
     * That bar caught a real regression during the caption work, which is the
     * argument for measuring rather than reasoning. The strip was designed with
     * no background of its own, on the theory that the backgrounds addon owns the
     * ground; axe resolves contrast against the nearest *painted* ancestor,
     * found the document's white instead, and reported all four caption lines on
     * every story — 189 new `color-contrast` findings, on a report that had
     * three. Painting the strip fixed it. To re-measure: flip this to `"error"`,
     * run `make test-browser`, and count the rule names in the output.
     *
     * The one change that would move the total meaningfully is making
     * `.sect-head` a `<button aria-expanded>` in `inspector/panel.ts`, which
     * clears most of `aria-allowed-attr` and `button-name` at once. That is a
     * product change rather than a Storybook one, and doing it in
     * `stories/chrome.ts`'s copy alone would make the harness disagree with the
     * thing it is a copy of.
     *
     * `inspector/a11y.test.ts` continues to assert the hand-wired parts —
     * `role="group"` on segmented groups, `aria-pressed` per cell,
     * `aria-haspopup="menu"` on selects — as hard failures under happy-dom.
     */
    a11y: { test: "todo" },

    backgrounds: {
      options: {
        // `canvas` is the substrate the frames sit on in canvas mode; `page` is
        // the white the docks float over, for the stories that show a subject
        // element as the user's own app would render it.
        canvas: { name: "Canvas", value: "#1e1e1e" },
        editor: { name: "Editor", value: "#242424" },
        page: { name: "Page", value: "#ffffff" },
      },
    },

    /*
     * Autodocs off, and not as a matter of taste.
     *
     * A docs page renders every story in a file onto one document. That means N
     * elements all carrying `id="__airship-root"`, N `DesignPanel` instances each
     * running a full stylesheet scan on mount, and N calls to `mountPopoverHost`
     * moving the one singleton host between them. The last one wins and the rest
     * are quietly broken.
     */
    docs: { autodocs: false },
  },

  tags: [],
};

export default preview;
