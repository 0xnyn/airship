import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cls } from "./dom";
import { mountToastHost, toast } from "./toast";

/*
 * The actionable toast, and the coalescing rule it forced.
 *
 * `toast.ts` is a module singleton with one persistent node, so these tests
 * mount one host and never tear it down — re-mounting is what the module is
 * written to make unnecessary, and `mountToastHost` is idempotent by design
 * (`host ??=`). The host is re-appended to a fresh body each time instead, which
 * is exactly what a second `AirshipApp.mount` would do.
 *
 * Fake timers throughout: every path here is `DWELL`, `ACTION_DWELL` or `FADE`,
 * and none of them is worth waiting six real seconds for.
 */

/** Must match `FADE` in `toast.ts`. */
const FADE = 140;
/** Must match `DWELL` in `toast.ts`. */
const DWELL = 2600;
/** Must match `ACTION_DWELL` in `toast.ts`. */
const ACTION_DWELL = 6000;

function box(): HTMLElement {
  const node = document.querySelector<HTMLElement>(`.${cls("toast")}`);
  if (!node) {
    throw new Error("no toast");
  }
  return node;
}

function actionBtn(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.${cls("toast-action")}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  mountToastHost(document.body);
  // Whatever a previous test left up must be gone before this one measures.
  vi.advanceTimersByTime(ACTION_DWELL + FADE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toast", () => {
  it("renders a plain receipt with no button", () => {
    toast("Reloaded Desktop");
    expect(box().textContent).toBe("Reloaded Desktop");
    expect(actionBtn()).toBeNull();
  });

  it("renders the action as a real button carrying its label", () => {
    toast("Deleted Desktop", {
      action: { label: "Undo", run: () => undefined },
    });
    const button = actionBtn();
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    // `type` matters: a bare button inside anything form-like submits it.
    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe("Undo");
  });

  it("runs the action once, however many times it is clicked", () => {
    const run = vi.fn();
    toast("Deleted Desktop", { action: { label: "Undo", run } });
    const button = actionBtn();
    button?.click();
    button?.click();
    button?.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a click that lands during the fade-out", () => {
    const run = vi.fn();
    toast("Deleted Desktop", { action: { label: "Undo", run } });
    const button = actionBtn();
    // The dwell expires and the node starts leaving, but for `FADE` more
    // milliseconds it is still on screen and still clickable.
    vi.advanceTimersByTime(ACTION_DWELL);
    vi.advanceTimersByTime(FADE);
    button?.click();
    expect(run).not.toHaveBeenCalled();
  });

  it("outlives a plain receipt's dwell", () => {
    toast("Deleted Desktop", {
      action: { label: "Undo", run: () => undefined },
    });
    vi.advanceTimersByTime(DWELL + FADE);
    // A plain toast would have been torn down by now.
    expect(actionBtn()).not.toBeNull();
    vi.advanceTimersByTime(ACTION_DWELL);
    expect(actionBtn()).toBeNull();
  });

  it("still coalesces two identical plain messages", () => {
    toast("Nudged");
    toast("Nudged");
    expect(box().querySelector(`.${cls("toast-count")}`)?.textContent).toBe(
      "×2"
    );
  });

  it("never coalesces two identical actionable messages", () => {
    const first = vi.fn();
    const second = vi.fn();
    toast("Deleted Desktop", { action: { label: "Undo", run: first } });
    toast("Deleted Desktop", { action: { label: "Undo", run: second } });

    // No tally: the second toast replaced the first rather than counting it.
    expect(box().querySelector(`.${cls("toast-count")}`)).toBeNull();
    // And the surviving button belongs to the second delete, not the first.
    actionBtn()?.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not fold an actionable message into a plain one already up", () => {
    toast("Deleted Desktop");
    toast("Deleted Desktop", {
      action: { label: "Undo", run: () => undefined },
    });
    expect(box().querySelector(`.${cls("toast-count")}`)).toBeNull();
    expect(actionBtn()).not.toBeNull();
  });

  it("leaves a toast raised by the action itself standing", () => {
    toast("Deleted Desktop", {
      action: {
        label: "Undo",
        run: () => toast("Frame limit reached (8)", { tone: "error" }),
      },
    });
    actionBtn()?.click();
    // The fade the click armed must not tear down the message that replaced it.
    vi.advanceTimersByTime(FADE);
    expect(box().textContent).toContain("Frame limit reached (8)");
    expect(box().classList.contains(cls("toast-error"))).toBe(true);
  });
});
