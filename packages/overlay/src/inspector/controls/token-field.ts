/**
 * The token affordance on a control: a badge that says whether the value comes
 * from the design system, and a picker for choosing a different one.
 *
 * The badge is deliberately quiet when there is nothing to say. It renders at
 * all only when the project actually declares tokens for that property, so an
 * app with no design system sees the inspector it always had rather than a row
 * of dead icons.
 */
import type { TokenRef } from "@airship/protocol";
import { type DesignToken, looksLikeColor } from "@airship/protocol/tokens";
import { cls, el } from "../../dom";
import { icon } from "../../icons";
import { openPopover } from "../../popover-host";
import { hasTokensFor, tokensForPicker } from "../../tokens/match";
import { tokenValue } from "../../tokens/registry";

export interface TokenBadgeOptions {
  /** The token currently providing this value, if any. */
  current?: TokenRef;
  /**
   * The element being edited, for deciding which tokens resolve *here*.
   *
   * Only ever orders and annotates the list — see `tokensForPicker`. A token
   * that is out of scope on this element is still a real token and still
   * applies correctly.
   */
  node?: Element;
  /** The user chose a token from the list. */
  onApply: (token: DesignToken) => void;
  /** The user detached the value from its token. */
  onUnlink: () => void;
  property: string;
}

/**
 * A token badge for one property, or `null` when the project has no tokens that
 * could apply to it.
 */
export function createTokenBadge(opts: TokenBadgeOptions): HTMLElement | null {
  if (!hasTokensFor(opts.property)) {
    return null;
  }
  // Lit only for a real binding. A value that merely equals a token's is worth
  // a tooltip, not a claim.
  const linked = opts.current?.via === "reference";
  const badge = el("button", {
    // Shape from `row-icon`, the panel's one ghost icon button; `token-badge`
    // adds only the linked/near colours.
    class: `${cls("row-icon")} ${cls("token-badge")}`,
    "data-tip": describe(opts.current, opts.property),
    type: "button",
  });
  if (linked) {
    badge.dataset.on = "";
  }
  if (opts.current && !opts.current.exact) {
    // A near match is a suggestion, not a fact, and must not look like one.
    badge.dataset.near = "";
  }
  /*
   * One glyph, and the icon set's own glyph for this.
   *
   * This was `libraries` plus a `caret-down`, on a box widened to hold both.
   * The caret was added because a bare glyph "read as a status light rather
   * than a control" — true, but the glyph was the problem, not the absence of a
   * caret. `libraries` is the set's *sidebar-left/libraries* mark: two book
   * spines, a noun about a panel, which is why it reads as decoration on a
   * field. `var-apply` is *Apply variable*, and `editor-icons` files it under a
   * block commented "Design tokens / variables. The token badge and picker are
   * the client" — it was generated for this control and never wired up.
   *
   * A verb needs no caret to say it does something, which is how the eye, the
   * minus, the overflow "more" and the aspect lock all get by. Dropping it also
   * returns the badge to the 20px square `row-icon` gives it, and hands back
   * the 17px it was taking from the field it annotates.
   */
  badge.append(icon("var-apply", "xs"));
  bindPicker(badge, opts);
  return badge;
}

/** The picker, opened from whichever affordance the control is wearing. */
function bindPicker(trigger: HTMLElement, opts: TokenBadgeOptions): void {
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openTokenPicker(trigger, opts);
  });
}

/**
 * A token name as a field shows it: the sigil dropped, nothing else.
 *
 * `--pk-space-md` → `pk-space-md`, `.pt-4` → `pt-4`. The `--` and the `.` are
 * syntax rather than name, and in a 90px field they are two characters of pure
 * punctuation.
 *
 * Deliberately *not* clever about the design system's own prefix. Stripping a
 * leading `--pk-` reads better, and there is no way to tell it apart from a
 * token that simply has three segments: the same rule that turns
 * `--pk-space-md` into `space-md` turns `--space-md` into `md`. Three honest
 * characters beat a name that is occasionally gutted, and the full name is in
 * the tooltip either way.
 */
export function shortName(name: string): string {
  return name.replace(LEADING_SIGIL, "");
}

const LEADING_SIGIL = /^(--|\.)/;

/**
 * What the badge claims, in the three cases it can be in.
 *
 * These read differently on purpose. "Using X" is a fact about the source;
 * "Matches X" is a fact about the number and says nothing about how it got
 * there; "Closest is X" is a question. The badge used to phrase all three as
 * the first, which is what made a hardcoded value look bound to a token nobody
 * had chosen.
 */
function describe(current: TokenRef | undefined, property: string): string {
  if (!current) {
    return `Use a design token for ${property}`;
  }
  if (!current.exact) {
    return `Closest: ${current.name} (${current.actual})`;
  }
  return current.via === "reference"
    ? `Using ${current.name}. Click to change`
    : `Matches ${current.name}. Click to bind`;
}

/**
 * The picker: a search field over every token in the property's category.
 *
 * Scoped to the category rather than listing everything, which is what stops a
 * colour picker offering the spacing scale. That filtering happens upstream in
 * `tokensFor`; this only has to present the result.
 *
 * Tokens that do not resolve on this element sort last and say so, rather than
 * being hidden — see `tokensForPicker` for why that distinction matters.
 */
function openTokenPicker(anchor: HTMLElement, opts: TokenBadgeOptions): void {
  const all = tokensForPicker(opts.property, opts.node);
  const content = el("div", { class: cls("token-pick") });

  const search = el("input", {
    "aria-label": `Search tokens for ${opts.property}`,
    class: cls("token-search"),
    placeholder: "Search tokens",
    spellcheck: "false",
    type: "text",
  }) as HTMLInputElement;
  // `pop-menu` is the list shape — padding, scrolling, and the item metrics its
  // rows inherit. This used to be a private set of rows that agreed with the
  // real menus on none of it, so a token picker opened beside a select read as
  // a different product.
  const list = el("div", {
    // `scroll-y` here as well as on the shell: `.pop-menu`'s own `overflow-y`
    // is what a token list actually scrolls in (see pop.css), so the shell's
    // treatment never reaches it.
    class: `${cls("pop-menu")} ${cls("token-list")} ${cls("scroll-y")}`,
    role: "menu",
  });

  content.append(el("div", { class: cls("token-head") }, [search]), list);

  const handle = openPopover({
    anchor,
    // The stem, not `cls(...)` — the host prefixes it (popover-host.ts:126).
    className: "pop-token",
    content,
    roving: true,
  });

  /** The host's keyboard cursor, which only it normally writes. */
  const clearActive = (): void => {
    for (const node of content.querySelectorAll<HTMLElement>(
      "[data-pop-active]"
    )) {
      node.removeAttribute("data-pop-active");
      node.tabIndex = -1;
    }
  };
  const setActive = (node: HTMLElement): void => {
    clearActive();
    node.setAttribute("data-pop-active", "");
    node.tabIndex = 0;
  };

  const render = (query: string): void => {
    const needle = query.trim().toLowerCase();
    const shown = needle
      ? all.filter(
          ({ token }) =>
            token.name.toLowerCase().includes(needle) ||
            tokenValue(token, opts.property).toLowerCase().includes(needle)
        )
      : all;
    list.replaceChildren(
      ...shown.map((entry) => row(entry, opts, handle.close))
    );
    if (shown.length === 0) {
      list.append(
        el("div", { class: cls("token-empty"), text: "No matching tokens" })
      );
    }
    // The rows this cursor pointed at are gone.
    clearActive();
    // The popover was placed while this list was still empty, and placement
    // bakes in a max-height measured at that moment. Without this the shell
    // stays the height of the search field and every row spills out of it.
    handle.reposition();
  };

  search.addEventListener("input", () => render(search.value));
  /*
   * Keydown only — deliberately **not** `bindField`.
   *
   * `bindField` commits on blur, and this field's commit is "activate the first
   * result". The search box holds focus the whole time the picker is open, so
   * every click anywhere inside it blurred the field first and fired that
   * commit: clicking a token applied whichever one happened to be at the top of
   * the list, and clicking Detach applied a token instead of detaching, which
   * made that row look like it did nothing at all. A search box is not a value
   * field — there is nothing to commit when it loses focus.
   */
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // The fast path for someone who knows the name.
      list.querySelector<HTMLElement>("[data-pop-item]")?.click();
      return;
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      // Escape inside a field means "undo my typing" before it means "close" —
      // the same rule `bindField` documents. A second press, with the query
      // already empty, closes.
      if (search.value) {
        search.value = "";
        render("");
      } else {
        handle.close("escape");
      }
      return;
    }
    /*
     * Arrows have to be handled here to get *out* of the field.
     *
     * The host's roving cursor is bound through the key registry, which skips
     * any binding without `allowWhileTyping` while a text field has focus — and
     * this field holds focus for as long as the picker is open. So ↓ and ↑ did
     * nothing at all: the list was reachable by mouse only. Moving focus onto a
     * row makes it no longer a typing target, and the registry's roving takes
     * over from there.
     */
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = Array.from(
        content.querySelectorAll<HTMLElement>("[data-pop-item]")
      );
      const target = e.key === "ArrowDown" ? rows[0] : rows.at(-1);
      if (target) {
        e.preventDefault();
        setActive(target);
        target.focus();
      }
    }
  });

  render("");
  search.focus();
  // `openPopover` seeds the roving cursor at index 0 before this list has any
  // rows, so it landed on Detach and left it looking permanently highlighted.
  clearActive();
}

function row(
  entry: { inScope: boolean; token: DesignToken },
  opts: TokenBadgeOptions,
  close: () => void
): HTMLElement {
  const { inScope, token } = entry;
  const value = tokenValue(token, opts.property);
  const current = token.name === opts.current?.name;
  /*
   * The bound row is the detach control, and every other row applies.
   *
   * Detach used to be a separate entry under a separator, which left the lit
   * row doing nothing at all: clicking the token already in force re-applied
   * the same binding and wrote no change. So the menu had a dead row and an
   * extra one, for a single idea.
   *
   * Only where `via === "reference"`, which is the same condition the separate
   * row rendered under. A row lit because the value merely *equals* the token's
   * is not bound to anything — clicking it is how you turn that coincidence
   * into a real binding, which is a genuinely useful thing to be able to do and
   * exactly what its tooltip offers.
   */
  const bound = current && opts.current?.via === "reference";
  const item = el("button", {
    class: cls("pop-item"),
    "data-pop-item": "",
    role: "menuitem",
    type: "button",
  });
  if (current) {
    // `pop-item-on` is the menu's own "this is the current value" mark, and is
    // deliberately not the same thing as the roving keyboard cursor.
    item.classList.add(cls("pop-item-on"));
  }
  // Name on the left, value right-aligned in the dimmed mono the menus already
  // use for hints — a token's value is exactly that kind of trailing detail.
  const main = el("span", { class: cls("pop-item-main") });
  if (looksLikeColor(value)) {
    const swatch = el("span", { class: cls("token-swatch") });
    swatch.style.background = value;
    main.append(swatch);
  }
  main.append(el("span", { class: cls("token-name"), text: token.name }));
  /*
   * The bound row trades its value for the word "Detach".
   *
   * A toggle that only announces itself by going dim on click is not an
   * affordance — and this one has a consequence worth naming, because detaching
   * is a positive instruction to the agent ("write the literal, do not
   * substitute a token") rather than the mere absence of one. The value is the
   * least useful hint to lose here: on the bound row it is already the number
   * the field is showing.
   */
  item.append(
    main,
    el("span", {
      class: cls("pop-item-hint"),
      text: bound ? "Detach" : value,
    })
  );
  /*
   * Out of scope: dimmed and said out loud, never hidden.
   *
   * The custom property is not in this element's cascade, so `var()` will not
   * resolve *here* — but it is still a real token. It may live under a theme
   * class, or in a media query that is not matching, or on a component root the
   * selection is not inside. Applying it works regardless, because the preview
   * carries the token's own value as the `var()` fallback; what it will not do
   * is pick up a later redefinition of that property.
   */
  if (!inScope) {
    item.dataset.outOfScope = "";
  }
  const where = `${token.file ?? ""}${token.file && token.line ? `:${token.line}` : ""}`;
  const tip = bound
    ? `Stop using ${token.name} here and write a literal value`
    : [inScope ? "" : "Not defined here", where].filter(Boolean).join(" · ");
  if (tip) {
    item.dataset.tip = tip;
  }
  item.addEventListener("click", () => {
    // Close first either way: both paths rebuild the panel body, which removes
    // the badge this popover is anchored to.
    close();
    if (bound) {
      opts.onUnlink();
      return;
    }
    opts.onApply(token);
  });
  return item;
}
