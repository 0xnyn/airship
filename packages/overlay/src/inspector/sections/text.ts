import { cls, el } from "../../dom";
import { type IconName, icon } from "../../icons";
import { createMenu, type MenuEntry } from "../../popover-host";
import { computedStyle, ownerDocument } from "../../realm";
import { tokensFor, tokensForPicker } from "../../tokens/match";
import { tokenValue } from "../../tokens/registry";
import { createTextField } from "../controls/num-field";
import { createSegmented } from "../controls/segmented";
import { shortName } from "../controls/token-field";
import {
  FONT_OPTICAL_SIZING,
  FONT_STRETCH,
  FONT_VARIANT,
  type Group,
  TEXT_CASE,
  VERTICAL_ALIGN,
} from "../descriptors";
import { firstFamily, replaceFirstFamily } from "../font-stack";
import { readValue } from "../style-model";
import type { SectionContext, TokenSlot } from "./context";
import { labelled } from "./row";

const RUN_OF_WHITESPACE = /\s+/;

/**
 * The parts of the Text panel that do not fit the descriptor pipeline:
 * a font-family combobox, the style toggles, vertical alignment, and the
 * "more" popover for case, decoration and truncation.
 */
function renderTextExtras(ctx: SectionContext, node: Element): HTMLElement {
  const wrap = el("div", { class: cls("text-extras") });

  /*
   * Font family: free text over the stack, with a picker beside it.
   *
   * Free text rather than a closed list, because a combobox that refuses an
   * unlisted family would be worse than a plain field. What it edits is the
   * *first* family — the one people mean by "the font" — and the fallbacks
   * behind it survive, which they did not: the field committed its own contents
   * as the whole declaration, so opening this section on
   * `"Inter", "Inter Fallback", system-ui, sans-serif` and tabbing away wrote
   * `font-family: Inter` and dropped every fallback the author had chosen.
   */
  /*
   * `stack` and `bound` are re-read, not captured once.
   *
   * They used to be `const`s taken at build time, and every path below closed over
   * them — which broke the moment one of those paths *changed* them. Picking a
   * literal family from the caret menu writes the family and detaches the token, so
   * `bound` becomes stale non-null: the field stayed `readOnly`, `commitFamily` kept
   * early-returning, and the field kept its bound tint. The user had detached the
   * token and still could not type a family until something forced a rebuild.
   */
  let stack = readValue(node, "font-family");
  const familySlot = ctx.tokenSlot(node, ["font-family"]);
  let bound = familySlot?.label ?? null;
  const family = el("input", {
    "aria-label": "Font family",
    class: cls("ctl-input"),
    type: "text",
    value: bound ?? firstFamily(stack),
  }) as HTMLInputElement;
  family.readOnly = bound !== null;

  /** Reflect the element's current family, and whether a token still provides it. */
  const reflectFamily = (): void => {
    stack = readValue(node, "font-family");
    bound = familySlot?.label ?? null;
    family.readOnly = bound !== null;
    if (document.activeElement !== family) {
      family.value = bound ?? firstFamily(stack);
    }
  };

  /**
   * Put a literal family at the head of the stack.
   *
   * Detaching is part of the write and has to come *after* it: `unlink` records
   * the value the element currently has, so it has to see the new one. Writing
   * it the other way round pins the token's own family as the literal and then
   * ignores the choice.
   */
  const chooseFamily = (name: string): void => {
    const next = replaceFirstFamily(stack, name);
    if (!next || next === stack) {
      return;
    }
    ctx.onChange("font-family", next);
    if (bound !== null) {
      familySlot?.unlink();
    }
    // The write and the detach both changed what this field should say about
    // itself, so re-read rather than leaving the build-time answers standing.
    reflectFamily();
  };

  const commitFamily = (): void => {
    if (bound !== null) {
      // The field is showing a token name, not a family. Blur fires whether or
      // not anything was typed, and this used to write that name straight
      // through as a literal `font-family: pk-font-sans`.
      return;
    }
    chooseFamily(family.value);
  };
  let skipBlur = false;
  family.addEventListener("blur", () => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    commitFamily();
  });
  family.addEventListener("keydown", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "Enter") {
      // Blur commits, as everywhere else in the panel.
      family.blur();
    } else if (key === "Escape") {
      e.stopPropagation();
      family.value = bound ?? firstFamily(stack);
      // `blur()` would otherwise commit the value Escape just discarded — the
      // guard `createNumField` and the CSS pane's rows already carry.
      skipBlur = true;
      family.blur();
    }
  });
  // Registered so an undo, or an agent edit, is reflected here. Without it a font
  // change reverted on the page and left the old family on screen — and the next
  // blur of this field re-committed it.
  ctx.register({
    element: family,
    properties: ["font-family"],
    resync: reflectFamily,
    setValue: () => undefined,
    virtual: true,
  });

  /*
   * One list, because "which font?" is one question.
   *
   * This field used to carry two pickers side by side: this caret, listing the
   * families the page can actually render, and a token badge beside it listing
   * the design system's. Two carets, two lists, and no way to tell from the row
   * which one held the answer you wanted. They are one menu now — the tokens
   * under a heading of their own, the families under another — and the badge is
   * gone from this field alone. Nothing is lost by that: a bound field already
   * says so by showing the token's name in the tinted field, which is the same
   * signal every other bound control gives.
   *
   * Still the panel's own menu rather than a native `<datalist>`. A datalist
   * popup is the one list in the panel the panel does not draw: it takes no max
   * height and none of the menu metrics, which is why it grew and shrank as you
   * scrolled while every other dropdown stayed put. `createMenu` goes through
   * `placePopover`, which caps it to the room available and scrolls inside that.
   */
  const pick = el(
    "button",
    {
      "aria-label": "Choose a font family",
      // `ctl-glyph` for the slot, `ctl-glyph-action` for being a button in it —
      // the same pair the fill layer's gradient trigger wears. Without the
      // second one this inherited the number field's `ew-resize`, so the panel's
      // only in-field dropdown showed a scrub cursor.
      //
      // No `data-tip`. The field it sits in already carries one naming the whole
      // stack, and a second tip on a 16px caret at the panel's right edge is
      // what a caret already means.
      class: `${cls("ctl-glyph")} ${cls("ctl-glyph-action")}`,
      type: "button",
    },
    [icon("caret-down", "xs")]
  );
  // Opens when bound too. It used to return early, so a bound field kept a
  // caret that did nothing — and the only way to change or detach the token was
  // the badge that is no longer there.
  pick.addEventListener("click", () => {
    createMenu(
      fontMenuEntries({
        bound,
        node,
        onPick: (name) => {
          family.value = name;
          chooseFamily(name);
        },
        slot: familySlot,
        stack,
      })
    ).open(pick, "below");
  });

  const familyField = el(
    "div",
    {
      // No `span2`: its only rule is `.grid > .span2`, and this field is not in
      // the grid. No label rail either, which is the deliberate half of the
      // decision — a glyph field in this panel never carries one (font size,
      // line height and letter spacing are all full-bleed cells with their
      // glyph as their name), and the rail is what a *named* choice gets. The
      // three rows below are named choices and take it; this one is a field.
      class: cls("ctl-num"),
      "data-tip": stack || "Font family",
    },
    [
      el("span", { class: `${cls("ctl-glyph")} ${cls("ctl-glyph-static")}` }, [
        icon("style-text", "sm"),
      ]),
      family,
      pick,
    ]
  );
  if (bound !== null) {
    familyField.toggleAttribute("data-token", true);
  }
  // No badge beside it. `font-family` is a token category of its own and this
  // field is bespoke, so it got the badge the descriptor pipeline could not
  // reach it with — and ended up the one row in the panel with two pickers for
  // one property. The tokens are in the field's own menu now; the tint above is
  // what says a token is in force.
  wrap.append(familyField);

  // Style toggles. Independent booleans, so a segmented group would be wrong
  // — these are four switches that can all be on at once.
  const styles = el("div", { class: cls("ctl-seg") });
  styles.dataset.variant = "icon";

  /**
   * One icon toggle that repaints itself; `write` gets the new state.
   *
   * `derive` is what makes it honest across a re-seed. The state used to be a
   * closure `let`, set once at build and flipped on click — and these buttons
   * were never registered, so an undo (which re-seeds rather than rebuilds,
   * because `font-weight` does not change the panel's shape) put the property
   * back and left Bold lit over a `400`. Registering it means the panel can ask
   * the DOM again, and `derive` is how the button answers.
   */
  const toggle = (
    glyph: IconName,
    label: string,
    properties: readonly string[],
    derive: () => boolean,
    write: (on: boolean) => void
  ): HTMLElement => {
    const paint = (on: boolean): void => {
      btn.classList.toggle(cls("ctl-seg-on"), on);
      btn.setAttribute("aria-pressed", String(on));
    };
    // Toggling bold used to rebuild the whole panel to flip one button's
    // class — which also reset the body's scroll position, so the control you
    // just pressed could jump out of view.
    const btn: HTMLElement = el(
      "button",
      {
        "aria-label": label,
        "aria-pressed": String(derive()),
        class: cls("ctl-seg-btn"),
        "data-tip": label,
        onClick: () => {
          const next = !derive();
          write(next);
          paint(next);
        },
        type: "button",
      },
      [icon(glyph, "sm")]
    );
    paint(derive());
    ctx.register({
      element: btn,
      properties,
      setValue: () => paint(derive()),
    });
    styles.append(btn);
    return btn;
  };

  // No Bold toggle. It wrote `font-weight: 700 | 400` over the top of the
  // Weight control in the grid above, which is the same property with a wider
  // range — so the two disagreed the moment anything was set to 500, and
  // pressing Bold on a 300 silently threw the 300 away. Weight is one control
  // now, and it can say "Bold".
  toggle(
    "text-italic",
    "Italic",
    ["font-style"],
    () => readValue(node, "font-style").includes("italic"),
    (on) => ctx.onChange("font-style", on ? "italic" : "normal")
  );

  /*
   * Underline and strikethrough share one property and must compose.
   *
   * `text-decoration-line` holds a *set* — `underline line-through` is legal
   * and common. The old pair wrote the whole value, so turning on one silently
   * cleared the other, and strikethrough was buried in the overflow menu where
   * the conflict was invisible. Both are surfaced here, as a design tool has them, and
   * the set is edited as a set.
   */
  /** The set as the DOM currently has it — re-read, never cached. */
  const decorations = (): Set<string> => {
    const set = new Set(
      readValue(node, "text-decoration-line")
        .split(RUN_OF_WHITESPACE)
        .filter(Boolean)
    );
    set.delete("none");
    return set;
  };
  const writeDecoration = (value: string, on: boolean): void => {
    const set = decorations();
    if (on) {
      set.add(value);
    } else {
      set.delete(value);
    }
    ctx.onChange(
      "text-decoration-line",
      set.size ? [...set].join(" ") : "none"
    );
  };
  toggle(
    "text-underline",
    "Underline",
    ["text-decoration-line"],
    () => decorations().has("underline"),
    (on) => writeDecoration("underline", on)
  );
  toggle(
    "text-strike",
    "Strikethrough",
    ["text-decoration-line"],
    () => decorations().has("line-through"),
    (on) => writeDecoration("line-through", on)
  );

  // Vertical alignment only means something inside a flex parent. A row of
  // three buttons that silently do nothing is worse than no row at all, so it
  // is gated rather than always shown.
  const parent = node.parentElement;
  const parentFlex =
    parent && ["flex", "inline-flex"].includes(computedStyle(parent).display);
  wrap.append(labelled("Style", styles));
  if (parentFlex) {
    /*
     * `align-self` on the node, not `align-items` on the parent.
     *
     * Vertical align on a text layer is per-layer, and the CSS that means the
     * same thing is `align-self` — which `align.ts:213` already uses for exactly this.
     * Writing `align-items` moved *every* sibling: select the middle label in a row of
     * three, click "Align bottom", and all three dropped.
     *
     * Seeded from the node's own `align-self`, falling back to the parent's
     * `align-items`, because that is what the element is actually doing when it sets
     * nothing itself.
     */
    const own = readValue(node, "align-self");
    const effective =
      own && own !== "auto" ? own : computedStyle(parent).alignItems;
    const vertical = createSegmented(
      VERTICAL_ALIGN,
      effective,
      (_property, value) => {
        ctx.onChange("align-self", value);
        ctx.redrawOutline();
      }
    );
    ctx.register(vertical);
    /*
     * Its own line, not the style toggles'.
     *
     * These shared one, and both groups stretched to fill it, so three
     * independent booleans about the type and one three-way choice about the
     * *parent's* alignment met edge to edge as an undifferentiated strip of
     * cells. They are not one decision and they do not even write the same
     * element. Two rows of one group each is a row taller and reads.
     *
     * Both groups fill their row now, which is what made the shared line
     * unreadable — but each one is on a row with its own name on the rail, and
     * a name is the thing that was missing. "Style" and "Vertical" cannot run
     * together the way two unlabelled strips of cells could.
     */
    wrap.append(labelled(VERTICAL_ALIGN.label, vertical.element));
  }

  // Case, on the same line as the overflow button. A design tool has this as a
  // visible control rather than a menu item, and rightly — it is a property of
  // the type, not an occasional command, and as four menu entries you could
  // not see which one was in force without opening the menu.
  const caseGroup = createSegmented(
    TEXT_CASE,
    readValue(node, "text-transform") || "none",
    ctx.onChange
  );
  ctx.register(caseGroup);

  /*
   * What is genuinely left for the overflow menu: the two commands that set
   * *several* properties at once and have no meaningful "off" to show.
   */
  const more = el(
    "button",
    {
      "aria-label": "More text options",
      class: cls("row-icon"),
      "data-tip": "More text options",
      type: "button",
    },
    [icon("more", "sm")]
  );
  const menu = createMenu([
    {
      label: "Truncate to one line",
      run: () => {
        // Three properties that only work together; offering them separately
        // is how people end up with `text-overflow: ellipsis` and no clue why
        // nothing is elided.
        ctx.onChange("overflow", "hidden");
        ctx.onChange("text-overflow", "ellipsis");
        ctx.onChange("white-space", "nowrap");
      },
    },
    {
      label: "Wrap normally",
      run: () => {
        ctx.onChange("overflow", "visible");
        ctx.onChange("text-overflow", "clip");
        ctx.onChange("white-space", "normal");
      },
    },
    {
      label: "Indent first line",
      run: () => ctx.onChange("text-indent", "1.5em"),
    },
    {
      label: "No indent",
      run: () => ctx.onChange("text-indent", "0"),
    },
  ]);
  more.addEventListener("click", () => menu.open(more, "below"));
  // The menu button rides the Case row rather than the section header: it is
  // about the type, not about the section, and the row it sits on is the one
  // whose group it narrows. A trailing affordance eating into its own row is
  // what `fieldCell` already does with a token badge.
  wrap.append(labelled(TEXT_CASE.label, caseGroup.element, more));

  return wrap;
}

export function renderText(
  ctx: SectionContext,
  node: Element,
  group: Group
): HTMLElement {
  const body = el("div", { class: cls("sect-body") });

  // Two-column grid. Glyph-fielded controls are cells with no label of their
  // own; the few that genuinely need a word (Weight, Align) declare
  // `span: "full"` and keep a labelled row.
  const grid = el("div", { class: cls("grid") });
  for (const descriptor of group.descriptors) {
    if (descriptor.visible && !descriptor.visible(node)) {
      continue;
    }
    grid.append(ctx.fieldCell(descriptor, node));
  }
  body.append(grid);
  if (group.id === "typography") {
    body.append(renderTextExtras(ctx, node));
  }
  body.append(renderAdvancedType(ctx, node));
  return ctx.section(group.id, group.label, body);
}

/**
 * The axes a variable font is chosen *for*, behind a collapsed sub-section.
 *
 * The section had a weight select and nothing else — no width, no optical sizing, no
 * numeral variants, and no way to reach a font's own axes at all except by typing into
 * the CSS pane. Collapsed by default because most type is not variable, and a section
 * that opens onto six rows nobody needs is how a panel stops being scannable.
 *
 * The two `*-settings` properties stay free text: their grammar is `"wght" 450, "opsz" 32`,
 * the axis tags are per-font, and a closed control would have to either guess a font's axes
 * or refuse the ones it does not know.
 */
function renderAdvancedType(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });
  const grid = el("div", { class: cls("grid") });
  grid.append(ctx.fieldCell(FONT_STRETCH, node));
  body.append(grid);
  for (const descriptor of [FONT_OPTICAL_SIZING, FONT_VARIANT]) {
    body.append(ctx.fieldCell(descriptor, node));
  }
  for (const [property, label, placeholder] of [
    ["font-variation-settings", "Variation axes", '"wght" 450, "opsz" 32'],
    ["font-feature-settings", "Feature settings", '"ss01" 1, "liga" 0'],
  ] as const) {
    body.append(freeformType(ctx, node, property, label, placeholder));
  }
  return ctx.section("text:advanced", "Advanced type", body, {
    startCollapsed: true,
  });
}

/** A free-text declaration, reflected on refresh and revertible with Escape. */
function freeformType(
  ctx: SectionContext,
  node: Element,
  property: string,
  label: string,
  placeholder: string
): HTMLElement {
  const field = createTextField({ label, placeholder });
  const normal = (value: string): string =>
    value === "normal" ? "" : value.trim();
  const reflect = (): void => {
    field.input.value = normal(readValue(node, property));
  };
  reflect();
  let skipBlur = false;
  const commit = (): void => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    const value = field.input.value.trim();
    if (value === normal(readValue(node, property))) {
      return;
    }
    // `normal` is the initial value, and is what an emptied field means.
    ctx.onChange(property, value || "normal");
  };
  field.input.addEventListener("blur", commit);
  field.input.addEventListener("keydown", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "Enter") {
      field.input.blur();
    } else if (key === "Escape") {
      e.stopPropagation();
      reflect();
      skipBlur = true;
      field.input.blur();
    }
  });
  ctx.register({
    element: field.element,
    resync: reflect,
    setValue: () => undefined,
    virtual: true,
  });
  return labelled(label, field.element);
}

export interface FontMenuOptions {
  /** The bound token's short name, or null when the value is a literal. */
  bound: string | null;
  node: Element;
  /** A literal family was chosen. */
  onPick: (name: string) => void;
  slot: TokenSlot | null;
  /** The whole `font-family` declaration, for spotting the current family. */
  stack: string;
}

/**
 * The font list, as data: the design system's families, then the page's.
 *
 * Built here rather than inline so it is one pure function of a node and a
 * binding — a menu described as entries can be asserted without a panel around
 * it, and this one carries the interaction rule that is easiest to get wrong.
 *
 * That rule: **the bound row detaches.** It is the convention the token picker
 * already set, and the reason neither list has a separate Detach entry —
 * clicking the token already in force used to re-apply the binding it had, and
 * record nothing at all.
 */
export function fontMenuEntries(opts: FontMenuOptions): MenuEntry[] {
  const entries: MenuEntry[] = [];
  // The same guard the family list uses, for the same reason: applying one of
  // these binds `font-family` to it, so a token that could not possibly be a
  // font has no business being offered here either.
  const tokens = (
    opts.slot ? tokensForPicker("font-family", opts.node) : []
  ).filter(({ token }) =>
    plausibleFamily(firstFamily(tokenValue(token, "font-family")))
  );
  if (tokens.length) {
    entries.push({ header: "Design system" });
    for (const { inScope, token } of tokens) {
      const name = shortName(token.name);
      const isBound = opts.bound === name;
      const preview = firstFamily(tokenValue(token, "font-family"));
      entries.push({
        // Out of scope is a fact about this element, not about the token: it
        // still applies, and `tokensForPicker` has already sorted it last. The
        // badge's own list says so with a dimmed row; a menu has one channel,
        // so it says it in words.
        hint: isBound
          ? "Detach"
          : `${preview}${inScope ? "" : " (not on this element)"}`,
        label: name,
        on: isBound,
        run: () => (isBound ? opts.slot?.unlink() : opts.slot?.apply(token)),
      });
    }
    entries.push({ separator: true }, { header: "Fonts" });
  }
  const current = firstFamily(opts.stack);
  for (const name of availableFonts(opts.node)) {
    entries.push({
      label: name,
      // Never lit while a token is in force: the value comes from the row
      // above, and marking a family current as well would claim two sources.
      on: opts.bound === null && name.toLowerCase() === current.toLowerCase(),
      run: () => opts.onPick(name),
    });
  }
  return entries;
}

/** A web-safe floor, for a page that has loaded nothing and declares nothing. */
const WEB_SAFE_FAMILIES = [
  "system-ui",
  "-apple-system",
  "Helvetica",
  "Arial",
  "Georgia",
  "Times New Roman",
  "ui-monospace",
  "monospace",
];

const SURROUNDING_QUOTES = /^["']|["']$/g;

/**
 * Families worth offering, best evidence first.
 *
 * 1. **The project's own.** Every `font-family` token's leading family — the
 *    fonts the design system has actually chosen. These were missing entirely:
 *    the list was `document.fonts` plus a hardcoded floor, so a project whose
 *    whole typography is `--font-sans` and `--font-mono` saw neither of them.
 *    The token's *value* is a whole stack, and what belongs in a list of
 *    families is its first entry. The token itself is offered separately, in
 *    the same menu under its own heading — and the two are different writes,
 *    not a duplicate: picking "Inter" here sets a literal family, picking
 *    `pk-font-sans` above binds the property to the design system.
 * 2. **What the page has loaded.** `document.fonts` in the node's own realm — a
 *    frame loads its own fonts, and offering the shell's would be wrong.
 * 3. **The web-safe floor**, so the list is never empty.
 *
 * Insertion-ordered rather than alphabetical, so the project's fonts sit at the
 * top where they are worth looking.
 */
/**
 * Could this string be a font family, at all?
 *
 * Belt and braces over the classifier, which is where the real fix lives. This
 * list is the one place in the panel where a misclassified token turns into a
 * write: picking a row calls `onPick`, which puts the string straight into
 * `font-family`. A shadow token that reached this category served up
 * `0 8px 32px rgba(0` as a family name, and choosing it wrote exactly that.
 *
 * So the rule here is not "is this a good font" but "could a browser possibly
 * resolve this" — no parens, no digit-led words, no lengths. A wrongly rejected
 * family costs one row in a list; a wrongly accepted one costs someone's CSS.
 */
const NOT_A_FAMILY = /[(){};:]|^[\d.-]|\d(px|r?em|%|v[hw]|ch|ex)\b/i;

function plausibleFamily(name: string): boolean {
  return name.length > 0 && name.length < 64 && !NOT_A_FAMILY.test(name);
}

function availableFonts(node: Element): string[] {
  const names = new Set<string>();
  for (const token of tokensFor("font-family")) {
    const first = firstFamily(tokenValue(token, "font-family"));
    if (first && plausibleFamily(first)) {
      names.add(first);
    }
  }
  const fonts = ownerDocument(node)?.fonts;
  if (fonts) {
    for (const face of fonts) {
      const family = face.family.replace(SURROUNDING_QUOTES, "").trim();
      if (family && plausibleFamily(family)) {
        names.add(family);
      }
    }
  }
  for (const family of WEB_SAFE_FAMILIES) {
    names.add(family);
  }
  return [...names];
}
