import { cls, el } from "../dom";
import { DesignPanel } from "../inspector/panel";
import type { SectionContext } from "../inspector/sections/context";
import { harness, selectionOf } from "../inspector/test-support";
import type { Surface } from "../surface";
import { type Caption, markSelection, stage } from "./chrome";
import { withTokens } from "./fixtures";
import { pendingFrame, type SubjectName, subject } from "./subjects";

/*
 * Standing a `DesignPanel` up for a story, and rendering one section of it.
 *
 * This is the only file in the catalogue that reaches into `DesignPanel`'s
 * private members, and it is deliberately the only one. The idiom is the one
 * `panel-refresh.test.ts` already uses — `panel as unknown as Internals` — and
 * the guard below is what keeps it from being a landmine.
 *
 * ## Why a section story drives the real panel
 *
 * Every section is `render<Name>(ctx: SectionContext, node: Element)`, and
 * `SectionContext` has 23 members. The obvious two ways to supply one are both
 * worse than this:
 *
 * **A hand-written fake context** would be about 150 lines and would silently
 * diverge. `seed()` is `Mixed`-aware across a multi-selection; `gate()` reads the
 * pending edit *before* computed style, so a gate does not delete the row whose
 * own edit just failed to paint; `repaintScope()` has disposal semantics that
 * exist because sections were leaking controls on every repaint. A fake
 * reproduces the shapes and not the behaviour, and nothing tells you when it
 * stops matching.
 *
 * **Borrowing the real `ctx` and rendering the section into a bare div** looks
 * cheaper and misbehaves in six ways, all of them quiet. `ctx.rerender` is
 * `() => this.renderBody()`, which destroys every registered control and clears
 * the panel's own body — so the story's DOM survives with dead controls inside
 * it. Overriding `ctx.rerender` does not help, because `applyToken`, `setScope`,
 * `setState` and `reshapeIfNeeded` all call `renderBody()` directly. There would
 * be no `beginScanPass()` bracket, so `matchedRules` runs uncached and its 24ms
 * budget truncates at a different rule on each of the up-to-four calls one
 * section makes — leaving two consumers disagreeing about which rules matched.
 * `ctx.register` pushes into `panel.controls` with nothing ever clearing it, so
 * `reseed()` writes into detached DOM. `section()` keys collapse state on an id
 * that the panel's own body has already claimed. And `tokenCache` is only reset
 * inside `renderBodyInner`, so badges go stale across repaints.
 *
 * ## What this does instead
 *
 * `renderSections` is a TypeScript `private` — a plain prototype method, not a
 * `#private` field — and its entire body is sixteen
 * `this.bodyEl.append(render*(this.ctx, node))` calls. An instance property
 * shadows it. The section is then rendered by the *real* `renderBodyInner`, so
 * every hazard above is handled by the code that already handles it: the real
 * teardown runs, the real `beginScanPass()` try/finally wraps the pass,
 * `controls` and `tokenCache` are reset, scroll and caret are restored, and the
 * open popover is closed against its vanishing anchor.
 *
 * The cost is one cast against three private names, guarded at runtime so a
 * rename fails loudly at story load rather than rendering an empty dock.
 */

/** The private surface this module depends on. See the note above. */
interface PanelInternals {
  bodyEl: HTMLElement;
  ctx: SectionContext;
  renderSections: (node: Element) => void;
}

/**
 * The cast, in one place, checked.
 *
 * Without the guard this is a silent failure: shadowing a method that no longer
 * exists adds an unused property, `renderBodyInner` calls whatever `panel.ts`
 * renamed it to, and the story renders the *whole* panel while claiming to be
 * one section. Throwing here turns a refactor into a red story instead of a
 * quietly wrong one.
 */
function internals(panel: DesignPanel): PanelInternals {
  const inner = panel as unknown as Partial<PanelInternals>;
  if (typeof inner.renderSections !== "function") {
    throw new Error(
      "DesignPanel.renderSections is no longer a method — the section stories " +
        "shadow it to render one section at a time. See stories/story-panel.ts."
    );
  }
  if (!(inner.bodyEl instanceof HTMLElement)) {
    throw new Error("DesignPanel.bodyEl is no longer an element.");
  }
  return inner as PanelInternals;
}

/** One section renderer, as the sections all declare themselves. */
export type SectionRenderer = (
  ctx: SectionContext,
  node: Element
) => HTMLElement;

export interface SectionStoryOptions {
  /** What this story is for. Rendered above the stage. See `Caption`. */
  caption?: Caption;
  /** Put the subject in its own document. See `frameSubject`. */
  frame?: boolean;
  /** Render the dock at `MIN_DOCK_W`, the floor the splitter clamps to. */
  narrow?: boolean;
  /**
   * Seed the token registry before building.
   *
   * Replaces the two-line `render` body that five files had each written out —
   * `withTokens(); return sectionStory(…)` — which worked, but put an imperative
   * side effect in front of the thing the story is declaring. `preview.ts`
   * clears the registry before every story, so this is additive to nothing and
   * cannot leak forward.
   */
  tokens?: boolean;
  /** An explicit dock width, for a story that wants some third value. */
  width?: number;
}

/**
 * A story showing one section of the real panel, driven by a real element.
 *
 * The section renders inside the panel's own body, below the Scope and Align
 * rows that `renderBodyInner` always appends. Those stay: Scope and State govern
 * what every control below them writes to, so a section shown without them is
 * missing the context that decides what its edits mean.
 */
export function sectionStory(
  render: SectionRenderer,
  name: SubjectName,
  opts: SectionStoryOptions = {}
): HTMLElement {
  return build(name, opts, (node, surface) => {
    const panel = new DesignPanel(harness().deps);

    // Before `setSelection`, which is what triggers the first `renderBody`.
    const inner = internals(panel);
    inner.renderSections = (target: Element) => {
      inner.bodyEl.append(render(inner.ctx, target));
    };

    panel.setSelection(selectionOf(node, surface ? { surface } : {}));
    return panel;
  });
}

export interface PanelStoryOptions extends SectionStoryOptions {
  /** Extra nodes for a multi-selection, by selector within the subject page. */
  extra?: string[];
  /** Start on a tab other than Design. */
  tab?: "css" | "dom";
}

/**
 * The whole panel, as the right dock, beside the page it is inspecting.
 *
 * No shadowing here — this is `DesignPanel` doing exactly what it does in the
 * product, with `harness()` supplying the collaborators that would otherwise
 * need a socket, a stage and a live selection controller.
 */
export function panelStory(
  name: SubjectName,
  opts: PanelStoryOptions = {}
): HTMLElement {
  return build(name, opts, (node, surface, page) => {
    const panel = new DesignPanel(harness().deps);
    panel.setSelection(selectionOf(node, surface ? { surface } : {}));

    if (opts.extra?.length) {
      const extra = opts.extra
        .map((selector) => page.querySelector(selector))
        .filter((n): n is Element => n !== null);
      panel.setExtra(extra);
    }

    if (opts.tab) {
      selectTab(panel, opts.tab);
    }
    return panel;
  });
}

/** An empty panel — no selection, which is its own designed state. */
export function emptyPanelStory(caption?: Caption): HTMLElement {
  const panel = new DesignPanel(harness().deps);
  panel.setSelection(null);
  // Through `stage()` rather than a bare `dock()`, so the empty state is
  // captioned like everything else. There is no page pane, because the premise
  // of this story is that there is nothing selected to show one for.
  return stage(panel.element, { caption });
}

/**
 * Click a tab by its label.
 *
 * Through the DOM rather than by writing `panel.tab`, because the tab strip's
 * click handler is what re-renders the body — setting the field alone would
 * leave the panel showing the Design tab while claiming to be on CSS.
 */
function selectTab(panel: DesignPanel, tab: "css" | "dom"): void {
  const label = tab === "css" ? "css" : "dom";
  const buttons = [...panel.element.querySelectorAll<HTMLElement>("button")];
  const target = buttons.find(
    (b) => (b.textContent ?? "").trim().toLowerCase() === label
  );
  if (!target) {
    throw new Error(`No ${tab} tab in the panel's tab strip.`);
  }
  target.click();
}

/** Builds the panel once the subject exists. */
type MakePanel = (
  node: HTMLElement,
  surface: Surface | undefined,
  page: ParentNode
) => DesignPanel;

/**
 * Assemble a story, same-document or cross-realm.
 *
 * **Both paths seed after mount**, and the same-document one used to be
 * synchronous. That was a quiet lie about every number in the panel.
 *
 * The old order was: build the specimen, append it to `document.body` so it is
 * measurable, construct the panel — which seeds from the box it measures right
 * there — and only *then* hand the page to `stage()`, which re-parents it into
 * `.__airship-story-page`, a flex child several hundred pixels narrower with a
 * different font and its own padding. Everything geometric had already been
 * read: Position's X and Y, Size's Hug/Fill decision, the measured width in the
 * selection badge. The story then displayed those numbers beside a rendering of
 * the element at a different size, and `sections/layout.stories.ts` claimed in
 * its header to be "the only place the geometry sections are shown real
 * numbers".
 *
 * The frame path could never be synchronous, for a different reason with the
 * same shape: **moving an iframe in the DOM reloads it**, so writing the subject
 * before Storybook appends the story would leave a blank pane and a `Surface`
 * aimed at a document that no longer exists — silently, since the panel would go
 * on reading the now-empty page and reporting it correctly.
 *
 * So both wait one animation frame. Storybook's HTML renderer appends what
 * `render` returns synchronously, so by the first frame the story is in its
 * final place and the specimen is laid out where the reader can see it. The cost
 * is one frame of an empty `.insp` shell — a panel that is about to exist,
 * rather than a flash of the wrong thing.
 */
function build(
  name: SubjectName,
  opts: SectionStoryOptions,
  makePanel: MakePanel
): HTMLElement {
  if (opts.tokens) {
    withTokens();
  }
  const slot = el("div", { class: cls("insp") });
  const common = {
    caption: opts.caption,
    narrow: opts.narrow,
    width: opts.width,
  };

  if (!opts.frame) {
    const built = subject(name);
    const node = stage(slot, { ...common, page: built.page });
    node.prepend(markSelection(built.node));
    requestAnimationFrame(() => {
      slot.replaceWith(makePanel(built.node, undefined, built.page).element);
    });
    return node;
  }

  const { fill, frame } = pendingFrame();
  const node = stage(slot, { ...common, page: frame });
  requestAnimationFrame(() => {
    const built = fill(name);
    slot.replaceWith(makePanel(built.node, built.surface, built.page).element);
    // After `fill`, because the node does not exist until the frame is written.
    node.prepend(markSelection(built.node, built.surface));
  });
  return node;
}
