import type { ElementContext } from "@airship/protocol";
import { contextOf } from "../inspector/test-support";
import type { Surface } from "../surface";

/*
 * The elements the inspector inspects.
 *
 * These are the actual subject of every section and panel story. The inspector
 * is a *view of a node* — it reads computed style, walks the stylesheets that
 * matched, measures the box — so a story that shows the panel without saying
 * what it is pointed at is showing an opinion with no premise.
 *
 * They are *real DOM in a real browser*, which is the whole reason this exists
 * alongside the happy-dom suite. `getBoundingClientRect` returns a measured box
 * with no `sizeOf()` patch; `getComputedStyle` resolves shorthands, percentages
 * and inherited values properly; and the stylesheet below is parsed by a real
 * CSS parser, so the nesting, `@layer` and `@supports` that happy-dom drops
 * entirely are genuinely there for `matchedRules` to walk.
 *
 * ## One specimen per story, not one page for all of them
 *
 * This module used to build a single two-card demo page and hand out nodes from
 * it by selector. Every panel and section story rendered that whole page beside
 * the dock, so forty-one stories were the same picture with a few rows different
 * several hundred pixels to the right — and since nothing marked which node the
 * panel was pointed at, telling them apart meant reading the values and working
 * backwards.
 *
 * It also went quietly wrong three times, which is the more serious charge. The
 * `SELECTOR` map was a second place to state which element a story was about,
 * and it drifted from the prose: `grid` resolved `.tiles`, the *container*, so
 * the story captioned "a tile painted with a gradient" pointed at an element
 * with no background at all and rendered an empty Fill section, and the one
 * captioned "a tile with a translucent border" was byte-identical to the story
 * named `None` three lines above it. `icon` resolved the `<svg>` root, so the
 * two stories claiming to demonstrate `isSvgChild` — the most aggressively gated
 * path in `renderSections` — demonstrated the opposite branch, and that path had
 * no coverage anywhere.
 *
 * Both classes of bug are gone by construction now: a specimen carries its own
 * subject as a `[data-subject]` marker in the markup, so the element a story
 * points at is stated once, in the same string as the element itself.
 *
 * ## The constraint that shapes the stylesheet
 *
 * **The rules must stay bare class selectors.** `scopeLevels` only offers a
 * class scope when the matched selector is a single bare class (`SIMPLE_CLASS`
 * in `inspector/cascade.ts`) *and* more than one element in the document carries
 * it. Scoping this sheet under `.specimen` — the obvious way to keep specimens
 * from bleeding into each other — would turn every rule into a descendant
 * selector, `SIMPLE_CLASS` would reject all of them, and the Scope row would
 * silently collapse to "This element" on every story in the catalogue. There is
 * nothing to bleed into anyway: one specimen renders at a time.
 *
 * The second half of that rule is why `SpecimenSpec.siblings` exists. A scope is
 * only meaningful when the class is shared, so a specimen that wants the Scope
 * row to mean something *declares* the element it shares with, rather than
 * happening to have one because it was cropped out of a bigger page.
 */

/**
 * The specimen stylesheet.
 *
 * Deliberately written the way a real app's is, not the way a fixture usually
 * is: cascade layers, native nesting, a `:hover` rule, a media query, an
 * `@supports` block and shared classes that several elements match. Every one of
 * those is a branch in `inspector/css-rules.ts`'s walker, and `test-support.ts`
 * has to fake all of them with a synthetic CSSOM because happy-dom parses none.
 *
 * One sheet for all thirteen specimens rather than one each. The at-rules are
 * properties of the *sheet*, so sharing it keeps every specimen exercising all
 * of them; splitting it would make `@layer` ordering and the `scopeLevels`
 * element counts depend on which sheet happened to be injected. A specimen
 * carrying rules for classes it does not use is what a real app's stylesheet
 * does anyway, and it exercises the walker's non-match filtering, which is work
 * it genuinely has to do.
 */
export const PAGE_CSS = `
@layer base, components;

@layer base {
  .specimen { color: #111; font: 400 14px/1.5 system-ui, sans-serif; }
  a { color: #0d6efd; }
}

@layer components {
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 24px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08);
    max-width: 420px;

    & .card-title {
      margin: 0;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    & .card-body { margin: 0; color: #555; }
  }

  .card--wide { max-width: 640px; }

  .note {
    padding: 12px 16px;
    border-radius: 8px;
    background: #f4f6f8;
    color: #444;
    max-width: 420px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border: 0;
    border-radius: 8px;
    background: #0d6efd;
    color: #fff;
    font: 600 14px system-ui, sans-serif;
    cursor: pointer;
    transition: filter .15s ease;

    &:hover { filter: brightness(1.08); }
    &:active { filter: brightness(0.94); }
  }

  .btn--ghost { background: #6c757d; }

  .badge {
    position: absolute;
    top: -8px;
    right: -8px;
    display: grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: #dc3545;
    color: #fff;
    font: 700 11px system-ui, sans-serif;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(80px, 1fr));
    grid-auto-rows: 72px;
    gap: 12px;
    max-width: 420px;
  }
  .tile {
    border-radius: 8px;
    background: linear-gradient(160deg, #e9f2ff, #cfe2ff);
    border: 1px solid rgba(13, 110, 253, 0.2);
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 8px;
    justify-content: flex-end;
    width: 420px;
    height: 200px;
    padding: 24px;
    border-radius: 12px;
    color: #fff;
    background-size: cover;
    background-position: center;
  }

  .shot {
    border-radius: 8px;
    background: #cfe2ff;
    object-fit: cover;
  }

  .clip {
    border-radius: 8px;
    background: #212529;
    object-fit: contain;
  }

  .chev { color: #fff; }

  .stack { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
}

/* A media query and a feature query, both of which the walker reports as
   provenance with their condition text. Neither changes what any story is about;
   they are here so the branch that renders a conditional rule is always live. */
@media (max-width: 600px) {
  .card { padding: 16px; }
}

@supports (display: grid) {
  .tiles { grid-auto-rows: 72px; }
}
`;

/**
 * A 1×1 transparent GIF.
 *
 * A data URI rather than a file, because the Media section reads `naturalWidth`
 * and an image that has not loaded reports zero — which would make the section's
 * intrinsic-size row read as broken rather than as empty. Inline data loads
 * synchronously enough to be measured.
 */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

/**
 * The chevron, with the marker on whichever node a specimen is about — or on
 * neither, for the specimens where the graphic is scenery.
 *
 * `"none"` is load-bearing rather than tidy. The button specimen is *about the
 * button*, and it embeds this graphic; marking the `<svg>` as well gave that
 * specimen two `[data-subject]` nodes, and `buildSpecimenIn` takes the first
 * match — so it resolved correctly only because the button happens to come first
 * in document order. `subjects.test.ts` asserts exactly one marker per specimen
 * for this reason.
 */
function chevron(subjectOn: "none" | "path" | "svg"): string {
  return `
    <svg class="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
         ${subjectOn === "svg" ? "data-subject" : ""}>
      <path d="M2 8h12M9 3l5 5-5 5" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            ${subjectOn === "path" ? "data-subject" : ""}/>
    </svg>`;
}

/** One `.tile` of six, with the marker on the nth. */
function tileGrid(subjectIndex: number | null): string {
  const cells = Array.from({ length: 6 }, (_, i) =>
    i === subjectIndex
      ? '<div class="tile" data-subject></div>'
      : '<div class="tile"></div>'
  ).join("");
  return `<div class="tiles"${subjectIndex === null ? " data-subject" : ""}>${cells}</div>`;
}

/** One self-contained fragment with exactly one inspected node. */
export interface SpecimenSpec {
  /**
   * Which branches this specimen exists to reach.
   *
   * Prose, and load-bearing rather than decorative: it is what a reviewer checks
   * the set against when `shapeKey` grows a term or `renderSections` grows a
   * gate. A branch nothing claims is a branch with no story.
   */
  covers: string;
  /** A noun phrase for a caption: "a pricing card", "the arrow inside a button". */
  label: string;
  /** The fragment. Exactly one node carries `data-subject`. */
  markup: string;
  /**
   * Markup rendered alongside, inside the same wrapper.
   *
   * How a specimen *declares* its scope choice instead of inheriting one by
   * accident. See the note at the top about `scopeLevels` and shared classes.
   */
  siblings?: string;
  /**
   * The parent's layout, which decides `isFlexChild` — a `shapeKey` term, and
   * what makes Size offer Hug/Fill rather than Fixed.
   *
   * `stack` is a wrapping flex row, `block` an ordinary block container, and
   * `none` puts the markup straight into the page with no wrapper at all, for
   * the specimens that bring their own.
   */
  wrap?: "block" | "none" | "stack";
}

/*
 * The catalogue.
 *
 * `satisfies` rather than a `Record<SubjectName, …>` annotation, so `SubjectName`
 * can be derived from the keys below and a story naming a specimen that does not
 * exist is a type error rather than a runtime throw.
 */
const SPECIMENS = {
  /** The absolutely-positioned case, which is what Constraints exists for. */
  badge: {
    covers:
      "position:absolute → the Constraints section · display:grid on a tiny box · negative insets on two edges",
    label: "a notification badge",
    markup: `
      <article class="card" style="position: relative;">
        <h3 class="card-title">Inbox</h3>
        <p class="card-body">Three unread.</p>
        <span class="badge" data-subject>3</span>
      </article>`,
    wrap: "stack",
  },

  /** A button: inline-flex, no border at all, and real interactive states. */
  button: {
    covers:
      "display:inline-flex · hasStroke:false (border:0), so Stroke is at its emptiest · `:hover` and `:active` rules, so the State picker has something to offer · a shared class with two members",
    label: "a button",
    markup: `
      <button class="btn" type="button" data-subject>
        ${chevron("none")}
        Get started
      </button>`,
    siblings: `
      <button class="btn btn--ghost" type="button">Learn more</button>`,
    wrap: "stack",
  },
  /** The fullest ordinary case: a flex box with a fill, a border and a bound. */
  card: {
    covers:
      "display:flex · a wrapping flex parent · isFlexChild · hasFill · hasStroke · hasBounds (max-width) · a shared class with two members, so Scope has a real choice",
    label: "a card",
    markup: `
      <article class="card" data-subject>
        <h3 class="card-title">Weekly digest</h3>
        <p class="card-body">Every Monday, the five things that changed.</p>
      </article>`,
    // The `.card--wide` half of the pair is what makes the Scope row meaningful:
    // an edit here can be written to this element or to `.card`, and the second
    // option only exists because a second element shares the class.
    siblings: `
      <article class="card card--wide">
        <h3 class="card-title">Release notes</h3>
        <p class="card-body">What shipped, and what it means for your project.</p>
      </article>`,
    wrap: "stack",
  },

  /**
   * A hero with a darkened photograph behind it.
   *
   * Reaches Media by the route that is not a media element: `hasBackgroundImage`
   * over a *two-layer* background, a gradient scrim over a `url()`. That exact
   * shape is the one the predicate had to be rewritten for — a whole-value test
   * reported no background image the moment any layer was a gradient — and it
   * had no story.
   */
  hero: {
    covers:
      "hasBackgroundImage across a two-layer background (gradient scrim over url()) → Media on an element that is not a media element",
    label: "a hero panel",
    markup: `
      <section class="hero" data-subject
               style="background-image: linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.15)), url(${PIXEL});">
        <h3 class="card-title" style="color: #fff;">Ship on Fridays</h3>
      </section>`,
    wrap: "block",
  },

  /** The `<svg>` element, which lays out like any other box. */
  icon: {
    covers:
      "isSvgRoot → the Vector section *plus* the box sections, because an <svg> has a box like anything else",
    label: "an icon",
    markup: `
      <button class="btn" type="button">
        ${chevron("svg")}
        Get started
      </button>`,
    wrap: "stack",
  },

  /** A raster image — the only kind that owns `alt`, `loading` and `decoding`. */
  image: {
    covers:
      "isImage and isRasterImage → Media, with the three <img>-only attrs",
    label: "an image",
    markup: `
      <img class="shot" src="${PIXEL}" width="180" height="110" alt="A placeholder"
           loading="lazy" decoding="async" data-subject>`,
    wrap: "stack",
  },

  /**
   * Text on a tag that is not in `TEXTY`.
   *
   * `hasText` has two arms — the tag set, and a scan for a non-empty text child —
   * and `title` only reaches the first. A `<div>` with words in it is the far
   * more common shape in a real app, and it is the arm that would silently stop
   * working if the scan were dropped.
   */
  /**
   * Four edges that disagree, which the Stroke section used to hide.
   *
   * Every read in that section asked `border-top-*` and answered for the whole
   * box, so this element displayed as a uniform red 1px border — and the first
   * edit imposed red on all four. Inline styles rather than a class, because
   * what is under test is per-edge disagreement and a stylesheet rule would let
   * a shorthand creep back in.
   */
  mixedBorder: {
    covers:
      "four differing border colours and widths on one element · the Mixed sentinel on a hand-built colour row · hasStroke",
    label: "a box with four different edges",
    markup: `<div data-subject style="padding:24px;border-style:solid;border-top-color:#e11d48;border-right-color:#0d9488;border-bottom-color:#2563eb;border-left-color:#ca8a04;border-top-width:1px;border-right-width:4px;border-bottom-width:1px;border-left-width:4px">Four edges, four colours.</div>`,
    wrap: "block",
  },

  note: {
    covers: "hasText via the text-node scan rather than the TEXTY tag set",
    label: "a note",
    markup: `<div class="note" data-subject>Frames report their own innerWidth.</div>`,
    wrap: "block",
  },

  /** Prose, for the stories that are about setting type. */
  paragraph: {
    covers:
      "hasText · an inherited colour the element does not declare · hasFill:false, so the Fill section is at its emptiest",
    label: "a paragraph",
    markup: `
      <article class="card">
        <h3 class="card-title">Weekly digest</h3>
        <p class="card-body" data-subject>Every Monday, the five things that
        changed — what shipped, what broke, and what is worth a second look
        before the week gets away from you.</p>
      </article>`,
    wrap: "stack",
  },

  /**
   * A shape inside an SVG — the most aggressively gated node in the panel.
   *
   * `isSvgChild` suppresses Position, Constraints, Auto layout, Spacing, Text,
   * Fill and Stroke outright, because a `<path>` has no box, no padding and no
   * text flow. Two stories claimed to be this case and pointed at the `<svg>`
   * root instead, where the predicate is false by definition — so the branch was
   * uncovered while appearing twice in the sidebar.
   */
  path: {
    covers:
      "isSvgChild → seven sections suppressed at once, leaving Vector and Appearance",
    label: "the arrow inside a button",
    markup: `
      <button class="btn" type="button">
        ${chevron("path")}
        Get started
      </button>`,
    wrap: "stack",
  },

  /**
   * A grid *item* with a gradient and a translucent border.
   *
   * The specimen two stories always meant and never got. Fill's gradient story
   * and Stroke's alpha story both asked for `grid`, which resolved the container
   * — no background, no border — so one rendered an empty section and the other
   * was indistinguishable from the story for an element with no border at all.
   */
  tile: {
    covers:
      "a gradient fill, so the Fill swatch shows a ramp and opens the gradient editor · a translucent border, so Stroke's alpha row has something to say · a grid item · six elements sharing one class",
    label: "one tile of six",
    markup: tileGrid(0),
    wrap: "block",
  },

  /** A grid container that paints nothing itself. */
  tiles: {
    covers:
      "display:grid on a block child, so isFlexChild is false while display is neither flex nor inline · hasText, hasFill and hasStroke all false at once",
    label: "a tile grid",
    markup: tileGrid(null),
    wrap: "block",
  },

  /** A heading: `hasText` through the tag, and a nested rule as provenance. */
  title: {
    covers:
      "hasText via the TEXTY tag set · a nested rule (`.card { & .card-title }`) as the matched provenance",
    label: "a card heading",
    markup: `
      <article class="card">
        <h3 class="card-title" data-subject>Weekly digest</h3>
        <p class="card-body">Every Monday, the five things that changed.</p>
      </article>`,
    wrap: "stack",
  },

  /**
   * A video, which is media without being an image.
   *
   * `isMedia` is true and `isRasterImage` is false, so Media renders `object-fit`
   * and `object-position` and withholds `alt`/`loading`/`decoding` — attributes a
   * `<video>` does not have and that writing to it would silently do nothing.
   * Nothing covered this before.
   */
  video: {
    covers: "isVideo → Media without the three <img>-only attrs",
    label: "a video",
    markup: `
      <video class="clip" width="180" height="110" muted playsinline
             poster="${PIXEL}" data-subject></video>`,
    wrap: "stack",
  },
} satisfies Record<string, SpecimenSpec>;

/** Every specimen, by the name a story asks for. */
export type SubjectName = keyof typeof SPECIMENS;

/**
 * The same table, widened.
 *
 * `satisfies` checks each entry against `SpecimenSpec` while keeping the keys
 * literal, which is what makes `SubjectName` a closed union and a misspelled
 * specimen a compile error. The cost is that it also keeps each *value* at its
 * own literal type, so an entry with no `siblings` has no such property to read.
 * One widened alias fixes that without giving up either half.
 */
const SPECS: Record<SubjectName, SpecimenSpec> = SPECIMENS;

/** The spec behind a name — for captions, and for asserting coverage. */
export function specimen(name: SubjectName): SpecimenSpec {
  return SPECS[name];
}

/** The built fragment, plus the node a story is pointed at. */
export interface Subject {
  /** The element the inspector selects. */
  node: HTMLElement;
  /** The whole fragment, for the story's page pane. */
  page: HTMLElement;
}

/**
 * Build a specimen in a given document.
 *
 * Parameterised by `Document` because the cross-realm path needs the same
 * fragment inside an iframe, and building it in the shell to serialise and
 * re-parse it — which is what this module used to do — is a round trip that buys
 * nothing and loses anything that is not expressible as HTML.
 *
 * Returned **detached**. The caller mounts it, and everything that measures runs
 * afterwards; see the note in `story-panel.ts` about seeding after mount.
 *
 * `data-subject` rides on the inspected element and is invisible to everything
 * the panel renders: `contextOf` reports classes, tag and text; the DOM tab
 * labels through `elementLabel`; the CSS pane lists declarations; and Media
 * reads `alt`, `loading` and `decoding` by name.
 */
export function buildSpecimenIn(doc: Document, name: SubjectName): Subject {
  const spec = SPECS[name];
  const page = doc.createElement("div");
  page.className = "specimen";

  const wrap = spec.wrap ?? "stack";
  const body = spec.markup + (spec.siblings ?? "");
  page.innerHTML =
    `<style>${PAGE_CSS}</style>` +
    (wrap === "none" ? body : `<div class="${wrap}">${body}</div>`);

  const node = page.querySelector<HTMLElement>("[data-subject]");
  if (!node) {
    throw new Error(
      `Specimen "${name}" declares no [data-subject] node — the marker is how a ` +
        "story says which element it is about. See stories/subjects.ts."
    );
  }
  return { node, page };
}

/** One specimen in the story's own document. */
export function subject(name: SubjectName): Subject {
  return buildSpecimenIn(document, name);
}

// ---------------------------------------------------------------------------
// The cross-realm case
// ---------------------------------------------------------------------------

/** A subject in its own document, plus the `Surface` that describes it. */
export interface FrameSubject extends Subject {
  surface: Surface;
}

/**
 * An empty frame, and the function that fills it once it has been mounted.
 *
 * Two steps rather than one, and the reason is a browser rule with teeth:
 * **moving an iframe in the DOM reloads it.** A frame written to while it is
 * still detached — or while it sits somewhere other than where the story will
 * finally put it — is wiped the moment Storybook appends the story to the
 * canvas, and what is left is a blank white pane and a `Surface` pointing at a
 * document that no longer exists. Nothing throws; the panel simply reads an
 * empty page and reports it accurately.
 *
 * So `frame` goes into the story's DOM first, and `fill` runs after Storybook
 * has mounted it.
 */
export interface PendingFrame {
  fill: (name: SubjectName) => FrameSubject;
  frame: HTMLIFrameElement;
}

/**
 * The same specimens, in their own document, with a `Surface` pointed at them.
 *
 * This exists for one specific and non-obvious reason. `stubSurface()` in
 * `test-support.ts` returns `doc: document` — which under happy-dom is a clean
 * empty document, and in Storybook is the *preview iframe*, carrying Storybook's
 * own stylesheets. `matchedRules` walks `doc.styleSheets`, and `isOwnSheet` skips
 * the overlay's sheet but knows nothing about Storybook's. So a CSS-pane story on
 * a same-document subject would list Storybook's reset as the element's
 * provenance, which is worse than useless: it is a plausible wrong answer.
 *
 * Putting the subject in its own document fixes it exactly, and does so by being
 * more faithful rather than less — this is the production topology. In canvas
 * mode the app runs in frame iframes while the overlay runs in the shell, which
 * is why `realm.ts` exists at all. The panel resolves `getComputedStyle` against
 * the node's own window and duck-types its `instanceof` checks, so it handles
 * this natively.
 */
export function pendingFrame(): PendingFrame {
  const frame = document.createElement("iframe");
  // Named, because the a11y pass checks `frame-title` and an unnamed frame is a
  // real finding rather than a harness artefact — the canvas frames want one too.
  frame.title = "The page being inspected";
  frame.style.cssText =
    "width: 100%; height: 100%; min-height: 420px; border: 0; background: #fff;";

  const fill = (name: SubjectName): FrameSubject => {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!(doc && win)) {
      throw new Error("iframe has no document — was it mounted first?");
    }
    // `document.write` rather than `srcdoc`: srcdoc loads asynchronously, and
    // the caller needs the subject measurable in the same tick it is handed
    // back so the panel can seed from a real box.
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();

    const built = buildSpecimenIn(doc, name);
    doc.body.style.margin = "0";
    doc.body.style.padding = "24px";
    doc.body.append(built.page);

    return { ...built, surface: frameSurface(frame, doc, win) };
  };

  return { fill, frame };
}

/**
 * A `Surface` over one frame.
 *
 * Only the members the panel actually reaches for are real; the rest answer
 * honestly for a static, unzoomed frame. This mirrors `stubSurface()`'s approach
 * and its rationale — implement what is used, and let the type document the
 * rest — but differs in the one member that matters here, `doc`.
 */
function frameSurface(
  frame: HTMLIFrameElement,
  doc: Document,
  win: Window
): Surface {
  const offset = () => frame.getBoundingClientRect();
  return {
    bounds: () => {
      const r = offset();
      return { height: r.height, left: r.left, top: r.top, width: r.width };
    },
    doc,
    elementAtScreen: (point) => {
      const r = offset();
      return doc.elementFromPoint(point.x - r.left, point.y - r.top);
    },
    extract: (target: Element) =>
      Promise.resolve({
        context: contextOf(target) as ElementContext,
        source: null,
      }),
    id: "story-frame",
    isLive: true,
    // 1:1 — the canvas zoom is a separate concern and none of these stories
    // exercise it. A scaled frame would need `toScreen`/`toLocal` to multiply.
    scale: 1,
    scanTokens: () => ({ framework: "unknown", tokens: [] }),
    toLocal: (point) => {
      const r = offset();
      return { x: point.x - r.left, y: point.y - r.top };
    },
    toScreen: (rect) => {
      const r = offset();
      return { ...rect, left: rect.left + r.left, top: rect.top + r.top };
    },
    win,
  };
}
