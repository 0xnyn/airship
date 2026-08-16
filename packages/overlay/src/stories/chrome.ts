import { hide, place, placeLabel } from "../chrome-layer";
import { cls, el, elementLabel, PREFIX } from "../dom";
import { icon } from "../icons";
import { MIN_DOCK_W } from "../styles/const";
import { localRect, type Surface } from "../surface";
import { captionsEnabled } from "./captions";
import { onStoryTeardown } from "./lifecycle";

/*
 * The dock a story renders inside.
 *
 * This exists because the inspector does not size itself and never has.
 * `.__airship-insp` is `flex: 1 1 auto` with no width of its own
 * (`styles/inspector.css.ts`); the 360px comes from
 * `.__airship-dock-right { width: var(--__airship-right-w, 360px) }` in
 * `styles/docks.css.ts`, one level up. A control dropped into a bare `<div>` is
 * therefore rendered at whatever width the viewport happens to be, and
 * `.__airship-grid` — `repeat(auto-fill, minmax(max(72px, (100% - 8px) / 2), 1fr))`
 * — resolves to four or five columns instead of two.
 *
 * That is not a cosmetic difference. Every judgement anyone would come to
 * Storybook to make about this UI is a judgement about density in a 360px
 * column: whether two fields fit on a row, whether a label elides, whether the
 * glyph and the value crowd each other. A story at 1200px is a picture of a
 * panel that does not exist.
 *
 * So: real classes, real nesting, real width. Nothing here restyles the
 * overlay. The single exception is `HARNESS_CSS` below, which is about the page
 * the dock is on rather than the dock.
 */

/**
 * The one piece of CSS this harness owns.
 *
 * `.__airship-dock` is `position: fixed` with `top`/`bottom` insets and a
 * `z-index` of 2147483600, because in the product it floats over the user's
 * running app. In a story that is wrong twice over: it escapes the story's own
 * canvas, and it makes the dock as tall as the viewport regardless of how much
 * is in it, so eight rows of controls sit in a column of grey.
 *
 * Neutralising it here, rather than adding a story-only class to `docks.css.ts`,
 * keeps the product stylesheet describing the product. The rules are scoped to
 * `[data-story-dock]`, which nothing in the overlay ever sets.
 */
const HARNESS_CSS = `
/* The outer column: caption above, stage below. The page-height and the padding
   live here rather than on the stage, because the stage is a *row* and a caption
   inside it would lay out as a third column beside the page and the dock. */
.${PREFIX}-story-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 24px;
  box-sizing: border-box;
}
.${PREFIX}-story-stage {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  flex: 1 1 auto;
  /* Without this a tall page pane cannot shrink and pushes the row past the
     shell, which puts the dock's own scrollbar outside the window. */
  min-height: 0;
}
[data-story-dock] {
  position: relative;
  inset: auto;
  z-index: auto;
  max-height: calc(100vh - 48px);
  flex: 0 0 auto;
}
/* The page pane: what the user's own app looks like under the dock. Deliberately
   plain — anything decorative here competes with the thing being reviewed. */
.${PREFIX}-story-page {
  flex: 1 1 auto;
  align-self: stretch;
  background: #fff;
  border-radius: 6px;
  padding: 32px;
  min-height: 320px;
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #111;
  overflow: auto;
}

/* --- The caption strip -------------------------------------------------- */

/*
 * Marginalia *about* the editor, which must never be mistaken for part of it.
 *
 * Hence \`system-ui\` rather than \`var(--ap-font-sans)\`: set in Inter at the
 * editor's own tokens, a two-line block above a panel reads as a panel header,
 * and the catalogue would be annotating itself in the voice of the thing it is
 * annotating. A different typeface is the cheapest possible signal that this
 * text is not shipping to anyone.
 *
 * Three more choices here are load-bearing rather than cosmetic:
 *
 * **\`<p>\` only, never a heading.** \`<h2>\`/\`<h3>\` would light up axe's
 * \`heading-order\` and \`empty-heading\` — two rule *categories* the overlay's
 * current findings do not contain. Adding instances to a category already being
 * tracked costs nothing; adding a category costs the ability to say "the a11y
 * report is these four known problems".
 *
 * **It paints its own background**, and that is a correction rather than a
 * preference. The first version deliberately painted none, reasoning that the
 * backgrounds addon owns the ground and a strip with three possible grounds
 * behind it would need three sets of values. That was wrong in a way only
 * measurement caught: axe resolves a contrast pair by walking up for the nearest
 * *painted* ancestor, and the addon's ground is not one — so it compared this
 * text against the document's white and reported every caption line as failing.
 * About a hundred and ninety new \`color-contrast\` findings, on a report that
 * had three.
 *
 * Painting it makes the pair self-contained: one ground, one set of colours, the
 * same reading under every background the addon offers. Every value below clears
 * 8:1 against it, so the strip has room to be restyled without anyone having to
 * re-run axe to find out whether it still passes.
 */
.${PREFIX}-story-caption {
  max-width: 62ch;
  margin: 0 0 20px;
  padding: 10px 14px;
  border-left: 2px solid #3d3d3d;
  border-radius: 0 4px 4px 0;
  background: #1c1c1c;
  font: 400 12px/1.55 system-ui, -apple-system, sans-serif;
  color: #b8b8b8;
}
.${PREFIX}-story-caption-eyebrow {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.${PREFIX}-story-caption-title {
  margin: 2px 0 0;
  font-weight: 600;
  color: #e8e8e8;
}
.${PREFIX}-story-caption-what { margin: 6px 0 0; }
.${PREFIX}-story-caption-try { margin: 4px 0 0; color: #9ec9e8; }
`;

/** Install the harness stylesheet once per document. */
function harnessStyles(): void {
  const id = `${PREFIX}-story-css`;
  if (document.getElementById(id)) {
    return;
  }
  const tag = document.createElement("style");
  tag.id = id;
  tag.textContent = HARNESS_CSS;
  document.head.append(tag);
}

/**
 * The dock header, as `AirshipApp.buildRightDock` builds it.
 *
 * Included rather than skipped because it is the top 32px of every screenshot
 * anyone will take of this panel, and because it is what establishes that the
 * thing below it is a dock and not a floating fragment.
 */
function dockHead(label: string): HTMLElement {
  return el("div", { class: cls("head") }, [
    el("div", { class: cls("brand") }, [
      icon("settings", "sm"),
      el("span", { class: cls("brand-name"), text: label }),
    ]),
  ]);
}

export interface DockOptions {
  /**
   * Pin the dock's height, the way a bottom-edge drag does.
   *
   * Omitted, the dock keeps its `top`/`bottom` anchors and fills the stage —
   * which is the product's default and what every story before this one showed.
   * Passing a number applies `.dock-h`, so the story sees exactly what a user
   * who has dragged the bottom edge sees.
   */
  height?: number;
  /** Header label. Defaults to "Design", matching the right dock. */
  label?: string;
  /**
   * Render at `MIN_DOCK_W`, the floor the splitter clamps to.
   *
   * A named flag rather than `width: 280`, which is what six story files used to
   * say. The number is interesting exactly once — in `styles/const.ts`, where it
   * is defined — and a story restating it is a story that will still say 280
   * after somebody changes the floor to 260.
   */
  narrow?: boolean;
  /**
   * Render the two resize splitters.
   *
   * Off by default: they are invisible until hovered and they sit on the dock's
   * edges, so in a story about a *control* they are two dead strips over the
   * thing being looked at. On for the story that is about them.
   */
  splitters?: boolean;
  /**
   * Override the dock width outright. The default is the product's own 360px.
   * Prefer `narrow` for the common case; this is for a story that wants some
   * third width and has a reason.
   */
  width?: number;
}

/** Resolve the two width options to the pixel value `dock()` should apply. */
function dockWidth(opts: DockOptions): number | undefined {
  if (opts.width !== undefined) {
    return opts.width;
  }
  return opts.narrow ? MIN_DOCK_W : undefined;
}

/**
 * A right dock containing `body`, at the real width.
 *
 * `body` is whatever plays the part of `DesignPanel.element` — either the panel
 * itself (`panelStory`) or the `.insp` scaffold from `inspectorBody` below.
 */
export function dock(body: HTMLElement, opts: DockOptions = {}): HTMLElement {
  harnessStyles();
  const node = el(
    "div",
    {
      class: `${cls("dock")} ${cls("dock-right")}${
        opts.height === undefined ? "" : ` ${cls("dock-h")}`
      }`,
      "data-story-dock": "",
    },
    [
      dockHead(opts.label ?? "Design"),
      body,
      // Inert copies, not `AirshipApp.buildSplitter`'s: that registers a dnd-kit
      // `Draggable` against the module-singleton manager, which a story has no
      // business adding entities to and no teardown for. What is worth showing
      // here is the strip and its hairline; the gesture belongs to the app.
      ...(opts.splitters
        ? [
            el("div", {
              class: `${cls("splitter")} ${cls("splitter-right")}`,
              "data-tip": "Drag to resize, double-click to reset",
            }),
            el("div", {
              class: `${cls("splitter")} ${cls("splitter-bottom")}`,
              "data-tip": "Drag to resize, double-click to reset",
            }),
          ]
        : []),
    ]
  );
  const width = dockWidth(opts);
  if (width !== undefined) {
    node.style.setProperty(`--${PREFIX}-right-w`, `${width}px`);
  }
  if (opts.height !== undefined) {
    node.style.setProperty(`--${PREFIX}-right-h`, `${opts.height}px`);
  }
  return node;
}

/**
 * The inspector scaffold, without a `DesignPanel`.
 *
 * `.insp` → `.insp-body` is the chain that gives the body its scroll and its
 * column direction; sections and controls below it inherit both. For the control
 * stories, which have no panel to build it for them.
 */
export function inspectorBody(children: HTMLElement[]): HTMLElement {
  return el("div", { class: cls("insp") }, [
    el("div", { class: cls("insp-body") }, children),
  ]);
}

/**
 * One collapsible section shell, matching `DesignPanel.section`'s markup.
 *
 * A static copy: the panel's own version carries collapse state keyed on an id,
 * and a control story has no panel to hold that state. The classes and the
 * nesting are the same, so the padding and the dividers are the ones the product
 * draws. Section *stories* use the real thing — see `stories/story-panel.ts`.
 */
export function section(label: string, body: HTMLElement): HTMLElement {
  return el("div", { class: cls("sect") }, [
    el("div", { "aria-expanded": "true", class: cls("sect-head") }, [
      el("span", { class: cls("sect-title"), text: label }),
    ]),
    el("div", { class: cls("sect-body") }, [body]),
  ]);
}

/**
 * The two-column field grid.
 *
 * The reason the width above matters. Pass `span: "full"` controls as-is — they
 * carry `.span2` themselves — and half-width ones in pairs, which is how they
 * appear in the panel.
 */
export function grid(children: HTMLElement[]): HTMLElement {
  return el("div", { class: cls("grid") }, children);
}

/*
 * A labelled full-width row is `labelled()` from `inspector/sections/row.ts`.
 * Stories import it straight from there rather than through this module: the
 * sections build their word-labelled rows with it, a second copy here would be
 * one `.span2` away from drifting, and re-exporting it would make this file a
 * barrel for no gain.
 */

// ---------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------

/**
 * What a story says about itself, in the canvas.
 *
 * Every file in this catalogue carries a long comment explaining what its
 * stories are for and why they are shaped the way they are, and until now
 * Storybook displayed none of it: autodocs is off for reasons `preview.ts` sets
 * out, and there is no other surface a `@storybook/html-vite` story can put
 * prose on. So a reader arriving at "Inspector/Sections/Stroke · Translucent"
 * got a panel, an element, and no way to know what they were supposed to notice.
 *
 * The rule for writing one, which matters more than the API: **a caption quotes
 * the docstring's thesis, it does not summarise it.** The reasoning stays in the
 * source comment where it has room to be an argument. This is the sentence
 * somebody reads before deciding whether to keep looking.
 */
export interface Caption {
  /**
   * One line: what to poke, for the stories where poking is the point.
   *
   * Omitted rather than invented when a story is a picture and nothing more —
   * "try: look at it" trains people to stop reading the field.
   */
  try?: string;
  /** One line: what this story demonstrates. */
  what: string;
}

/**
 * The strip itself.
 *
 * The title slot is left *empty* on purpose. `preview.ts` fills it after the
 * story renders, from Storybook's own `context.title` and `context.name`, so the
 * heading and the sidebar entry cannot disagree. Writing it at the call site
 * would mean 150 story names restated in 150 captions, each one rename away from
 * lying about which story you are looking at.
 */
function captionStrip(caption: Caption): HTMLElement {
  return el("div", { class: cls("story-caption") }, [
    el("p", { class: cls("story-caption-eyebrow"), text: "Story" }),
    el("p", { class: cls("story-caption-title"), "data-story-title": "" }),
    el("p", { class: cls("story-caption-what"), text: caption.what }),
    ...(caption.try
      ? [
          el("p", {
            class: cls("story-caption-try"),
            text: `Try: ${caption.try}`,
          }),
        ]
      : []),
  ]);
}

// ---------------------------------------------------------------------------
// The selection marker
// ---------------------------------------------------------------------------

/**
 * The product's own selection outline and identity badge, over a story's
 * subject.
 *
 * The inspector is a view *of a node*, and until this existed the page pane
 * never said which node — so forty-one stories showed the same page and left the
 * reader to infer the subject from the values in the dock, which is exactly
 * backwards. Now the difference between `Fill · Solid` and `Fill · Gradient` is
 * visible at a glance, in the pane, where it happens.
 *
 * Deliberately **not** a `SelectionController`. That class is fifteen hundred
 * lines over nine collaborators with eight dnd-kit draggables bound to it, and
 * what a story needs from it is the *picture*. The picture is two nodes on a
 * chrome layer positioned by `place()` and `placeLabel()` — the same two class
 * names, the same two functions and the same label format the controller itself
 * uses, so the story and the product cannot drift apart on geometry or styling
 * without a compiler error.
 *
 * The eight resize handles are the one thing left out, and that is a decision
 * rather than an omission: nothing in a story can be dragged, and drawing grips
 * advertises a gesture that is not there.
 */
export function markSelection(node: Element, surface?: Surface): HTMLElement {
  harnessStyles();
  const layer = el("div", { class: cls("chrome-layer") });
  const box = el("div", { class: `${cls("layer")} ${cls("sel-box")}` });
  const label = el("div", { class: `${cls("layer")} ${cls("box-label")}` });
  layer.append(box, label);

  const draw = (): void => {
    if (!node.isConnected) {
      hide(box);
      hide(label);
      return;
    }
    // The element's own box, then converted — same as `drawOutline`. A framed
    // subject reports coordinates inside its own document, and `toScreen` is the
    // production conversion; a same-document subject is already in screen space,
    // which is what makes one code path cover both realms.
    const local = localRect(node);
    const screen = surface ? surface.toScreen(local) : local;
    place(box, screen);
    // The element's own size, not its on-screen size — the width you are about
    // to edit is 200px whatever the frame is doing.
    label.textContent = `${elementLabel(node)} · ${Math.round(local.width)}×${Math.round(local.height)}`;
    placeLabel(label, screen, surface?.bounds()?.top ?? 0);
  };

  /*
   * Three passes, because the subject's box is not final when this is called.
   *
   * The first frame is after Storybook has appended the story and the browser
   * has laid it out. `loadingdone` is the one that matters most: the specimens
   * are set in system-ui and Inter, and a badge reading 420×61 before the
   * webfont lands and 420×64 after would be reporting a measurement of the
   * fallback. An event rather than `document.fonts.ready` because it fires for
   * every later load too, and because it is disposable — a promise resolving
   * into a story that has been unmounted has nothing to hold on to. The observer
   * then covers the rest: an image decoding, a frame loading, the dock dragged
   * narrower.
   */
  requestAnimationFrame(draw);
  document.fonts.addEventListener("loadingdone", draw);
  const observer = new ResizeObserver(draw);
  observer.observe(node);
  onStoryTeardown(() => {
    observer.disconnect();
    document.fonts.removeEventListener("loadingdone", draw);
  });

  return layer;
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface StageOptions extends DockOptions {
  /** What this story is for. See `Caption`. */
  caption?: Caption;
  /**
   * Content for the page pane beside the dock — the user's app, as the inspector
   * sees it. Omit for a dock on its own.
   */
  page?: HTMLElement;
}

/**
 * The dock, on a ground, optionally beside the page it is inspecting.
 *
 * This is the top-level wrapper every story returns. The two-pane form is the
 * honest picture for anything driven by a real element: the inspector is a view
 * of something, and a story that shows the panel without the node it describes
 * hides half of what it is doing.
 */
export function stage(body: HTMLElement, opts: StageOptions = {}): HTMLElement {
  harnessStyles();
  const row = el("div", { class: cls("story-stage") }, [dock(body, opts)]);
  if (opts.page) {
    row.prepend(el("div", { class: cls("story-page") }, [opts.page]));
  }
  return shell(opts.caption, row);
}

/**
 * A bare stage for the stories that are not dock-shaped — toasts, popover
 * shells, canvas chrome. Same ground and padding, no dock.
 */
export function plainStage(
  children: HTMLElement[],
  caption?: Caption
): HTMLElement {
  harnessStyles();
  return shell(caption, el("div", { class: cls("story-stage") }, children));
}

/**
 * The outer column: caption, then stage.
 *
 * A selection marker gets prepended to what this returns, ahead of the caption,
 * and that ordering is the point. `.chrome-layer` and `.dock` both declare the
 * same `z-index`, so DOM order breaks the tie — which is precisely how the
 * product arranges it (see the note at the top of `chrome-layer.ts`: the root is
 * appended *after* the layer so the docks draw over it). First child means the
 * outline runs under the dock rather than over it, as it does in the app. It
 * also means Storybook's unmount takes the layer away with the story.
 */
function shell(caption: Caption | undefined, row: HTMLElement): HTMLElement {
  const children =
    caption && captionsEnabled() ? [captionStrip(caption), row] : [row];
  return el("div", { class: cls("story-shell") }, children);
}
