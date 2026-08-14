import type { TokenRef } from "@airship/protocol";
import type { DesignToken } from "@airship/protocol/tokens";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls } from "../../dom";
import { closeOpenPopover } from "../../popover-host";
import { setRuntimeTokens } from "../../tokens/registry";
import { createTokenBadge, shortName } from "./token-field";

/*
 * The picker's one interaction rule.
 *
 * A row's action follows what the row *is*: the token already bound detaches,
 * and everything else applies — including a row that is lit only because the
 * value happens to equal the token's, which is how a coincidence is turned into
 * a real binding. Detach used to be a separate entry under a separator, which
 * left the bound row doing nothing at all.
 */

const SPACE_MD: DesignToken = {
  category: "spacing",
  kind: "css-var",
  name: "--pk-space-md",
  origin: "runtime",
  values: { "": "16px" },
};

const SPACE_LG: DesignToken = {
  category: "spacing",
  kind: "css-var",
  name: "--pk-space-lg",
  origin: "runtime",
  values: { "": "24px" },
};

function open(current?: TokenRef, node?: Element) {
  const onApply = vi.fn();
  const onUnlink = vi.fn();
  const badge = createTokenBadge({
    current,
    node,
    onApply,
    onUnlink,
    property: "padding-top",
  });
  if (!badge) {
    throw new Error("no badge: the registry has no tokens for this property");
  }
  document.body.append(badge);
  badge.click();
  return { badge, onApply, onUnlink };
}

/** The picker's rows, in order, as `[name, trailing hint]`. */
function rows(): { hint: string; name: string; node: HTMLElement }[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`.${cls("token-list")} button`),
  ].map((node) => ({
    hint: node.querySelector(`.${cls("pop-item-hint")}`)?.textContent ?? "",
    name: node.querySelector(`.${cls("token-name")}`)?.textContent ?? "",
    node,
  }));
}

beforeEach(() => {
  setRuntimeTokens({ framework: "custom", tokens: [SPACE_MD, SPACE_LG] });
});

afterEach(() => {
  // Close rather than wiping the body: `popover-host` caches its mount in a
  // module variable, so clearing `document.body` detaches the host while the
  // host still believes it is mounted, and every later popover renders into a
  // node nothing can query. Anchors left behind are harmless — only one
  // popover is ever open.
  closeOpenPopover("programmatic");
  setRuntimeTokens({ framework: "unknown", tokens: [] });
});

describe("the token picker", () => {
  it("lists every token in the property's category", () => {
    open();
    expect(rows().map((r) => r.name)).toEqual([
      "--pk-space-md",
      "--pk-space-lg",
    ]);
  });

  it("shows each token's value as the trailing hint", () => {
    open();
    expect(rows().map((r) => r.hint)).toEqual(["16px", "24px"]);
  });

  it("applies the token when a row is picked", () => {
    const { onApply, onUnlink } = open();
    rows()[1].node.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].name).toBe("--pk-space-lg");
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("keeps a token the element's cascade does not define", () => {
    /*
     * The guarantee this whole change rests on. A token can be genuinely part
     * of the design system and still be out of scope here — under a theme
     * class, in a media query that is not matching, on a component root the
     * selection is not inside. Hiding those would quietly remove real tokens,
     * so they are dimmed and sorted last instead.
     */
    const node = document.createElement("div");
    document.body.append(node);
    open(undefined, node);
    const all = rows();
    expect(all.map((r) => r.name)).toEqual(["--pk-space-md", "--pk-space-lg"]);
    // happy-dom resolves no custom properties, so both read as out of scope —
    // which is exactly the case that must not disappear.
    const marked = all.every((r) => r.node.dataset.outOfScope !== undefined);
    expect(marked).toBe(true);
    expect(all[0].node.dataset.tip).toContain("Not defined here");
  });

  it("still applies an out-of-scope token", () => {
    const node = document.createElement("div");
    document.body.append(node);
    const { onApply } = open(undefined, node);
    rows()[0].node.click();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("has no separate Detach entry", () => {
    // It was one; the bound row is the detach control now.
    open({
      exact: true,
      kind: "css-var",
      name: "--pk-space-md",
      via: "reference",
    });
    const labels = [
      ...document.querySelectorAll<HTMLElement>("[data-pop-item]"),
    ].map((n) => n.textContent);
    expect(labels.filter((l) => l?.startsWith("Detach"))).toHaveLength(0);
  });
});

describe("the bound row", () => {
  const bound: TokenRef = {
    exact: true,
    kind: "css-var",
    name: "--pk-space-md",
    via: "reference",
  };

  it("detaches instead of re-applying the binding it already has", () => {
    // The dead click this replaced: clicking the token already in force used to
    // write the same binding again, which recorded nothing.
    const { onApply, onUnlink } = open(bound);
    rows()[0].node.click();
    expect(onUnlink).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("says so, rather than relying on the convention being known", () => {
    open(bound);
    const [first] = rows();
    expect(first.hint).toBe("Detach");
    expect(first.node.dataset.tip).toContain("write a literal value");
  });

  it("leaves the other rows applying", () => {
    const { onApply, onUnlink } = open(bound);
    rows()[1].node.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onUnlink).not.toHaveBeenCalled();
  });
});

describe("a row lit by coincidence", () => {
  // `via: "value"` — the value equals the token's, but nothing names it. The
  // row is marked current, and clicking it is how you make the binding real.
  const coincidence: TokenRef = {
    exact: true,
    kind: "css-var",
    name: "--pk-space-md",
    via: "value",
  };

  it("applies rather than detaching", () => {
    const { onApply, onUnlink } = open(coincidence);
    rows()[0].node.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].name).toBe("--pk-space-md");
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("keeps showing its value, because there is nothing to detach", () => {
    open(coincidence);
    expect(rows()[0].hint).toBe("16px");
  });

  it("is still marked as the current value", () => {
    open(coincidence);
    expect(rows()[0].node.classList.contains(cls("pop-item-on"))).toBe(true);
  });
});

describe("the affordance itself", () => {
  it("does not render when the project declares no tokens for the property", () => {
    setRuntimeTokens({ framework: "unknown", tokens: [] });
    expect(
      createTokenBadge({
        onApply: vi.fn(),
        onUnlink: vi.fn(),
        property: "padding-top",
      })
    ).toBeNull();
  });

  it("marks the badge linked only for a real binding", () => {
    const linked = createTokenBadge({
      current: {
        exact: true,
        kind: "css-var",
        name: "--pk-space-md",
        via: "reference",
      },
      onApply: vi.fn(),
      onUnlink: vi.fn(),
      property: "padding-top",
    });
    const matched = createTokenBadge({
      current: {
        exact: true,
        kind: "css-var",
        name: "--pk-space-md",
        via: "value",
      },
      onApply: vi.fn(),
      onUnlink: vi.fn(),
      property: "padding-top",
    });
    expect(linked?.dataset.on).toBe("");
    expect(matched?.dataset.on).toBeUndefined();
  });

  it("drops the sigil from a token name and nothing else", () => {
    expect(shortName("--pk-space-md")).toBe("pk-space-md");
    expect(shortName(".pt-4")).toBe("pt-4");
    // The reason it stops there: a rule that strips the project's own prefix
    // cannot tell `--pk-space-md` from a token that simply has three segments,
    // so it would turn this one into `md`.
    expect(shortName("--space-md")).toBe("space-md");
  });
});
