/**
 * The CSS pane — the inspector's "why does it look like this" view.
 *
 * Four blocks, in the order the question is usually asked:
 *
 *  1. the box model, because most layout questions are about a gap;
 *  2. `element.style { … }`, the session's own overrides, editable;
 *  3. the stylesheet rules that match, strongest first, with the losers struck
 *     through — the provenance the computed list can never give;
 *  4. every computed property, grouped and filterable.
 *
 * (3) is the expensive one and is collapsed on first open, scanning only when
 * expanded: an unpurged Tailwind build can carry six figures of rules, and
 * nobody should pay for that to look at a padding.
 */
import type { Change } from "../../change-set";
import { clear, cls, el } from "../../dom";
import { emptyState } from "../../empty";
import { icon } from "../../icons";
import { computedStyle, isHtmlElement } from "../../realm";
import { createBoxModelDiagram } from "../css-box-model";
import {
  COMPUTED_GROUPS,
  type ComputedGroupId,
  defaultsFor,
  groupOf,
} from "../css-groups";
import { type MatchedResult, matchedRules } from "../css-rules";
import { propertyNames } from "../style-model";
import type { SectionContext } from "./context";

/** What the CSS pane needs beyond the shared section seam. */
export interface CssPaneDeps {
  /** Every tracked declaration for the node, disabled ones included. */
  changesFor: (node: Element) => Change[];
  /** Drop one override — reverts its preview and re-renders. */
  deleteDecl: (node: Element, property: string) => void;
  /** Latched filter text, so it survives the panel's clear-and-rebuild. */
  getFilter: () => string;
  /** Latched "non-default only". */
  getTerse: () => boolean;
  setFilter: (value: string) => void;
  setTerse: (value: boolean) => void;
  /** Enable/disable one override (DevTools' checkbox). */
  toggleDecl: (node: Element, property: string, disabled: boolean) => void;
}

export function renderCssPane(
  ctx: SectionContext,
  deps: CssPaneDeps,
  node: Element
): HTMLElement {
  const root = el("div", { class: cls("css-pane") });

  // Read once per render and share: the probe forces a reflow, and the computed
  // declaration is a live object that would otherwise be re-resolved per row.
  const defaults = defaultsFor(node);
  const cs = computedStyle(node);

  const boxModel = createBoxModelDiagram({
    gestures: ctx.gestures,
    getNode: () => node,
    onChange: ctx.onChange,
  });
  boxModel.sync(node);
  /*
   * Registered so the panel tears it down and re-seeds it.
   *
   * Its twelve cells are real number fields now rather than bare inputs, which
   * means they hold gesture brackets and dnd-kit registrations — and a control
   * rebuilt without being destroyed leaves both behind. Registering also means
   * an undo re-seeds the diagram along with everything else, instead of leaving
   * it showing the values from before.
   */
  ctx.register({
    destroy: boxModel.destroy,
    element: boxModel.element,
    setValue: () => boxModel.sync(node),
  });

  root.append(
    boxModel.element,
    renderOverrides(ctx, deps, node),
    renderMatched(ctx, node),
    renderComputed(ctx, deps, node, cs, defaults)
  );
  /*
   * Nothing else here is registered, deliberately — see `DesignPanel.refresh`.
   *
   * The `element.style` list, the computed rows and their `inline`/`default`
   * origin badges are all derived from state a per-control `setValue` cannot
   * express: which declarations are pending, and which rules override which. So
   * this pane opts out of re-seeding entirely and the panel rebuilds it instead,
   * which is also cheaper than seeding several hundred computed rows one at a time.
   */
  return root;
}

// ---------------------------------------------------------------------------
// element.style { … } — the session's own overrides
// ---------------------------------------------------------------------------

function renderOverrides(
  ctx: SectionContext,
  deps: CssPaneDeps,
  node: Element
): HTMLElement {
  const changes = deps.changesFor(node);
  const list = el("div", { class: cls("css-list") });
  if (changes.length === 0) {
    // `sm`, and the add-row still follows: this block sits directly above the
    // affordance it describes, so it has to leave room for it rather than fill
    // the pane. The three ways in used to be one comma-spliced sentence; the
    // add-row below is now the only one spelled out, because it is the only one
    // that is not visible from here.
    list.append(
      emptyState({
        body: "Add one below, or edit a computed value.",
        size: "sm",
        title: "No overrides yet",
      })
    );
  }
  for (const c of changes) {
    list.append(
      declRow(ctx, deps, node, c.property, c.to, Boolean(c.disabled))
    );
  }
  list.append(addRow(ctx));

  // A section rather than a bare `element.style { … }` block: it is the one
  // part of this pane you edit, it grows a row per override, and it was the
  // only thing here you could not fold away. The braces go with the block —
  // a heading and a `{` are the same statement made twice.
  return ctx.section("css:overrides", "element.style", list);
}

/**
 * Will the browser accept this declaration?
 *
 * The CSS pane is the panel's expert surface: any property, any value, no
 * descriptor to consult. `css-length.ts` cannot help here — it knows lengths,
 * and this row might be a `grid-template-areas` — so the check has to be the
 * engine's own. Three write paths in this file had no check at all, and every
 * string typed into them became a declaration in the change set and a line in
 * the agent's prompt.
 *
 * Advisory rather than authoritative, deliberately. `CSS.supports` is absent in
 * some environments and a permanent `true` in others, so a false answer is
 * trustworthy and a missing one must not block an edit — the alternative would
 * be a pane that refuses everything wherever the API is stubbed. The panel's
 * own fields do not rely on this; they have a real grammar.
 */
function isSupportedDeclaration(property: string, value: string): boolean {
  if (typeof globalThis.CSS?.supports !== "function") {
    return true;
  }
  try {
    return globalThis.CSS.supports(property, value);
  } catch {
    // Throws on a malformed property name in some engines, which is itself the
    // answer.
    return false;
  }
}

/**
 * Normalise a typed property name.
 *
 * CSS property idents are case-insensitive, so lower-casing is right for them — and
 * **wrong for custom properties**, which are case-sensitive. `--brandColor` was recorded
 * as `--brandcolor`, which no `var(--brandColor)` reference resolves, and the agent was
 * instructed to write that wrong name into the source.
 */
function normalizeProperty(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

/** One editable `property: value` with a disable checkbox and a delete. */
function declRow(
  ctx: SectionContext,
  deps: CssPaneDeps,
  node: Element,
  property: string,
  value: string,
  disabled: boolean
): HTMLElement {
  // Tracks an in-place property rename without a re-render.
  let key = property;

  const cb = el("input", {
    class: cls("css-cb"),
    "data-tip": "Enable / disable",
    type: "checkbox",
  }) as HTMLInputElement;
  cb.checked = !disabled;
  cb.addEventListener("change", () => deps.toggleDecl(node, key, !cb.checked));

  const prop = el("input", {
    class: cls("css-prop"),
    spellcheck: "false",
    type: "text",
    value: property,
  }) as HTMLInputElement;
  const val = el("input", {
    class: cls("css-val"),
    spellcheck: "false",
    type: "text",
    value,
  }) as HTMLInputElement;

  /** Put the row back to what the change set holds. */
  const revert = (): void => {
    prop.value = key;
    val.value = value;
  };

  let skipBlur = false;
  const commit = (): void => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    const p = normalizeProperty(prop.value);
    const v = val.value.trim();
    if (!(p && v)) {
      deps.deleteDecl(node, key);
      return;
    }
    /*
     * Nothing was edited. Blur fires either way, and re-recording an unchanged
     * declaration writes a fresh inline preview and a journal entry for an edit
     * that never happened.
     *
     * Compared against the change set rather than against `value`, which is the
     * render-time argument and was never updated after a commit. That made the
     * guard lie in one direction: seeded `red`, typed `blue` (recorded), typed
     * `red` again — and `v === value` was true, so the edit was dropped and the
     * set went on holding `blue` while the input read `red`. The element stayed
     * blue and the panel disagreed with the payload.
     */
    const current = deps.changesFor(node).find((c) => c.property === p)?.to;
    if (p === key && v === (current ?? value)) {
      return;
    }
    if (!isSupportedDeclaration(p, v)) {
      // Put the row back rather than queueing a declaration the browser has
      // already refused. This pane is the panel's expert surface — any
      // property, any value — which is exactly why the one check it can make is
      // worth making.
      revert();
      return;
    }
    if (p !== key) {
      deps.deleteDecl(node, key);
      key = p;
    }
    ctx.onChange(p, v);
  };
  for (const input of [prop, val]) {
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      const { key: pressed } = e as KeyboardEvent;
      if (pressed === "Enter") {
        // Blur commits, here as everywhere else in the panel.
        input.blur();
      } else if (pressed === "Escape") {
        // Every other field family reverts on Escape; this one had no handler
        // at all, so it fell through to the key registry and closed whatever
        // was open instead of undoing the typing.
        e.stopPropagation();
        revert();
        skipBlur = true;
        input.blur();
      }
    });
  }

  const del = el(
    "button",
    {
      class: cls("css-del"),
      "data-tip": "Remove declaration",
      onClick: () => deps.deleteDecl(node, key),
      type: "button",
    },
    [icon("minus", "sm")]
  );

  return el(
    "div",
    {
      class: `${cls("css-decl")} ${disabled ? cls("css-off") : ""}`,
      /*
       * Keys the panel's focus latch, so adding or deleting a neighbouring
       * declaration no longer drops the caret out of this one.
       *
       * `key` rather than `property` only for accuracy about intent — they are
       * equal at build time. A rename does not need the attribute updated in
       * place, because it goes through `deleteDecl` and `ctx.onChange`, and both
       * now rebuild the pane: this row is replaced by one built with the new name.
       */
      "data-field": `css:${key}`,
    },
    [cb, prop, el("span", { class: cls("css-colon"), text: ":" }), val, del]
  );
}

function addRow(ctx: SectionContext): HTMLElement {
  const prop = el("input", {
    class: cls("css-prop"),
    placeholder: "property",
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;
  const val = el("input", {
    class: cls("css-val"),
    placeholder: "value",
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;

  const commit = (): void => {
    const p = normalizeProperty(prop.value);
    const v = val.value.trim();
    if (!(p && v)) {
      return;
    }
    if (!isSupportedDeclaration(p, v)) {
      // Left in place rather than cleared: a rejected declaration is almost
      // always a typo in one of two fields, and clearing them both would make
      // the user retype the half that was right.
      return;
    }
    ctx.onChange(p, v);
    /*
     * Cleared, so the row is ready for the next declaration.
     *
     * It was not, and only `val` committed — so tabbing out of `val` added the
     * declaration, and every later blur of that same row re-added the one still
     * sitting in it.
     */
    prop.value = "";
    val.value = "";
  };
  for (const input of [prop, val]) {
    input.addEventListener("blur", commit);
  }
  val.addEventListener("keydown", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "Enter") {
      commit();
      prop.focus();
    } else if (key === "Escape") {
      e.stopPropagation();
      prop.value = "";
      val.value = "";
      val.blur();
    }
  });
  prop.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      val.focus();
    }
  });

  return el(
    "div",
    {
      class: `${cls("css-decl")} ${cls("css-add")}`,
      "data-field": "css:__add",
    },
    [
      el("span", { class: cls("css-cb-spacer") }),
      prop,
      el("span", { class: cls("css-colon"), text: ":" }),
      val,
      el("span", { class: cls("css-del-spacer") }, [icon("plus", "sm")]),
    ]
  );
}

// ---------------------------------------------------------------------------
// Matched rules
// ---------------------------------------------------------------------------

function renderMatched(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("css-rules") });
  let scanned = false;

  const scan = (): void => {
    const result = matchedRules(node);
    clear(body);
    body.append(...matchedContent(node, result, scan));
  };

  return ctx.section("css:matched", "Matched CSS rules", body, {
    onToggle: (open) => {
      // Scan on the first expand only. Re-opening a section the user already
      // looked at reuses what is on screen; the explicit rescan button below
      // is how you ask for fresh data.
      if (open && !scanned) {
        scanned = true;
        scan();
      }
    },
    startCollapsed: true,
  });
}

function matchedContent(
  // Kept so the signature stays honest about what it inspects.
  _node: Element,
  result: MatchedResult,
  rescan: () => void
): HTMLElement[] {
  const out: HTMLElement[] = [];

  out.push(
    el("div", { class: cls("css-scan") }, [
      el("span", {
        text: result.truncated
          ? `Scanned ${result.examined} rules (stopped early)`
          : `${result.rules.length} matching of ${result.examined} rules · ${result.scanMs}ms`,
      }),
      el(
        "button",
        {
          class: cls("css-rescan"),
          "data-tip": "Re-scan stylesheets",
          onClick: rescan,
          type: "button",
        },
        [icon("rotate-ccw", "xs")]
      ),
    ])
  );

  if (result.rules.length === 0) {
    // Not an error, and worth saying why: on a Tailwind or CSS-in-JS page this
    // is the *normal* answer for most elements, and a bare "no rules" reads as
    // a failed lookup.
    out.push(
      emptyState({
        body: "Its styles are inline, or utility classes.",
        size: "sm",
        title: "No stylesheet rules match",
      })
    );
  }

  for (const rule of result.rules) {
    const decls = el("div", { class: cls("css-list") });
    for (const d of rule.decls) {
      decls.append(
        el(
          "div",
          {
            class: `${cls("css-decl")} ${cls("css-ro")} ${d.overridden ? cls("css-struck") : ""}`,
          },
          [
            el("span", { class: cls("css-cb-spacer") }),
            el("span", { class: cls("css-prop-ro"), text: d.property }),
            el("span", { class: cls("css-colon"), text: ":" }),
            el("span", {
              class: cls("css-val-ro"),
              text: d.important ? `${d.value} !important` : d.value,
            }),
          ]
        )
      );
    }
    out.push(
      el("div", { class: cls("css-rule") }, [
        el("div", { class: cls("css-rule-head") }, [
          el("span", {
            class: cls("css-selector"),
            "data-tip": rule.selector,
            text: `${rule.matchedSelector} {`,
          }),
          el("span", {
            class: cls("css-origin"),
            "data-tip": rule.href ?? "inline <style> element",
            text: rule.origin,
          }),
        ]),
        ...(rule.conditions.length
          ? [
              el("div", {
                class: cls("css-cond"),
                text: rule.conditions.join(" · "),
              }),
            ]
          : []),
        decls,
        el("div", { class: cls("css-head"), text: "}" }),
      ])
    );
  }

  out.push(
    el("div", {
      class: cls("css-scan-note"),
      text: "State rules (:hover, :focus) and ::before/::after are not included.",
    })
  );
  return out;
}

// ---------------------------------------------------------------------------
// Computed, grouped
// ---------------------------------------------------------------------------

function renderComputed(
  ctx: SectionContext,
  deps: CssPaneDeps,
  node: Element,
  cs: CSSStyleDeclaration,
  defaults: Map<string, string>
): HTMLElement {
  const wrap = el("div", { class: cls("css-block") });

  const filter = el("input", {
    class: cls("css-filter"),
    placeholder: "Filter computed styles…",
    spellcheck: "false",
    type: "text",
    value: deps.getFilter(),
  }) as HTMLInputElement;

  const groups = el("div", { class: cls("css-groups") });

  /** Rows for everything matching the filter, bucketed by computed group. */
  const bucketRows = (
    q: string,
    terse: boolean
  ): Map<ComputedGroupId, HTMLElement> => {
    const buckets = new Map<ComputedGroupId, HTMLElement>();
    for (const property of propertyNames(cs)) {
      if (q && !property.includes(q)) {
        continue;
      }
      const value = cs.getPropertyValue(property).trim();
      if (terse && defaults.get(property) === value) {
        continue;
      }
      const id = groupOf(property);
      let list = buckets.get(id);
      if (!list) {
        list = el("div", {
          class: `${cls("css-list")} ${cls("css-computed")}`,
        });
        buckets.set(id, list);
      }
      list.append(computedRow(ctx, node, property, value, defaults));
    }
    return buckets;
  };

  const paint = (): void => {
    clear(groups);
    const q = deps.getFilter().trim().toLowerCase();
    const terse = deps.getTerse();
    const buckets = bucketRows(q, terse);

    if (buckets.size === 0) {
      groups.append(
        el("div", {
          class: cls("insp-hint"),
          text: q
            ? "No matching properties."
            : "Nothing set beyond the defaults.",
        })
      );
      return;
    }
    for (const group of COMPUTED_GROUPS) {
      const list = buckets.get(group.id);
      if (!list) {
        continue;
      }
      groups.append(
        ctx.section(`css:computed:${group.id}`, group.label, list, {
          // A filter or the terse switch is an explicit request to see what
          // matched, so the groups open; browsing the full list starts folded.
          startCollapsed: !(q || terse),
        })
      );
    }
  };

  filter.addEventListener("input", () => {
    deps.setFilter(filter.value);
    paint();
  });

  const terseBtn = ctx.headerAction(
    deps.getTerse() ? "eye-off" : "eye",
    deps.getTerse()
      ? "Showing only what differs from default"
      : "Show only non-default values",
    () => {
      deps.setTerse(!deps.getTerse());
      terseBtn.replaceChildren(icon(deps.getTerse() ? "eye-off" : "eye", "xs"));
      terseBtn.dataset.tip = deps.getTerse()
        ? "Showing only what differs from default"
        : "Show only non-default values";
      paint();
    }
  );

  // No "Computed" label beside the box: the placeholder already says what the
  // filter filters, and the groups below it are the computed list.
  wrap.append(
    el("div", { class: cls("css-sub-head") }, [filter, terseBtn]),
    groups
  );
  paint();
  return wrap;
}

/**
 * A computed property with an editable value; committing seeds an override.
 *
 * The badge says where the value came from. `default` is measured against a
 * bare element of the same tag in the same place (see `defaultsFor`), so it
 * covers inherited values too — an unstyled `color` reads as default rather
 * than as something this element asked for.
 */
function computedRow(
  ctx: SectionContext,
  node: Element,
  property: string,
  value: string,
  defaults: Map<string, string>
): HTMLElement {
  const val = el("input", {
    class: cls("css-val"),
    spellcheck: "false",
    type: "text",
    value,
  }) as HTMLInputElement;

  let skipBlur = false;
  const commit = (): void => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    const v = val.value.trim();
    if (!v || v === value || !isSupportedDeclaration(property, v)) {
      val.value = value;
      return;
    }
    ctx.onChange(property, v);
  };
  val.addEventListener("blur", commit);
  val.addEventListener("keydown", (e) => {
    const { key } = e as KeyboardEvent;
    if (key === "Enter") {
      val.blur();
    } else if (key === "Escape") {
      // This row had no Escape handler at all — the only field family in the
      // panel without one, so the only place typing could not be taken back.
      e.stopPropagation();
      val.value = value;
      skipBlur = true;
      val.blur();
    }
  });

  const inline =
    isHtmlElement(node) &&
    node.style.getPropertyValue(property).trim().length > 0;
  let origin = "css";
  if (inline) {
    origin = "inline";
  } else if (defaults.get(property) === value) {
    origin = "default";
  }

  return el(
    "div",
    {
      class: `${cls("css-decl")} ${cls("css-ro")}`,
      "data-field": `css:computed:${property}`,
    },
    [
      el("span", {
        class: `${cls("css-badge")} ${cls(`css-badge-${origin}`)}`,
        "data-tip": BADGE_TIP[origin],
      }),
      el("span", {
        class: cls("css-prop-ro"),
        "data-tip": property,
        text: property,
      }),
      el("span", { class: cls("css-colon"), text: ":" }),
      val,
      el("span", { class: cls("css-del-spacer") }),
    ]
  );
}

const BADGE_TIP: Record<string, string> = {
  css: "Set by a stylesheet rule",
  default: "The value an unstyled element here would have (incl. inherited)",
  inline: "Set inline on the element",
};
