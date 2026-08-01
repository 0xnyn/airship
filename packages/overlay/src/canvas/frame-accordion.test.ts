import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChromeLayer } from "../chrome-layer";
import { cls } from "../dom";
import { mountToastHost } from "../toast";
import { FrameChrome } from "./frame-chrome";
import { FrameManager } from "./frames";
import { CanvasViewport } from "./viewport";

/*
 * The device menu's accordion — Phone / Tablet / Desktop, one open at a time.
 *
 * Stands the real `FrameChrome` up, on the same terms and for the same reason as
 * `frame-chrome.test.ts`: what is being checked is the wiring between
 * `menuGroup`, `syncGroups` and the rows, none of which is visible from the
 * model alone. `placePopover` needs layout that happy-dom does not do, so
 * nothing here asserts geometry — every assertion is on class or attribute.
 */

let layer: ChromeLayer;
let viewport: CanvasViewport;
let frames: FrameManager;
let chrome: FrameChrome;
let host: HTMLElement;

/**
 * The bottom bar's dimensions button — what opens the device list.
 *
 * This used to be the size badge on a frame's own title bar, which opened a
 * per-frame menu. That menu is gone: every verb it carried is a button in the
 * bar's frame group, and the device list it led to is this one box. The
 * accordion under test is unchanged — only the door onto it moved.
 */
function dimsBtn(): HTMLElement {
  const node = host.querySelector<HTMLElement>(
    `.${cls("fbar-frame")} [aria-label="Frame dimensions"]`
  );
  if (!node) {
    throw new Error("no dimensions button");
  }
  return node;
}

/** A group's disclosure header, by group id. */
function head(group: string, root: ParentNode = host): HTMLElement {
  const node = root.querySelector<HTMLElement>(
    `[data-group="${group}"] .${cls("fc-dgroup-head")}`
  );
  if (!node) {
    throw new Error(`no ${group} group`);
  }
  return node;
}

function isOpen(group: string, root: ParentNode = host): boolean {
  return head(group, root).getAttribute("aria-expanded") === "true";
}

/** Which groups are expanded, in document order. */
function openGroups(root: ParentNode = host): string[] {
  return ["phone", "tablet", "desktop"].filter((g) => isOpen(g, root));
}

/** The device row for a preset id, within the bar's dimensions menu. */
function row(presetId: string): HTMLElement {
  const node = host.querySelector<HTMLElement>(
    `.${cls("fbar-frame")} .${cls("fc-menu")} [data-preset="${presetId}"]`
  );
  if (!node) {
    throw new Error(`no row for ${presetId}`);
  }
  return node;
}

function marked(presetId: string): boolean {
  return row(presetId).classList.contains(cls("fc-menu-on"));
}

/**
 * Select the frame under test and open the device list on it.
 *
 * One click now, not two: the list used to be the second pane of a menu whose
 * first pane held the verbs, and the bar group is that first pane.
 */
function openDevicePane(): void {
  frames.setActive(frames.all.at(-1)?.id ?? null);
  dimsBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function click(node: HTMLElement): void {
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  mountToastHost(document.body);
  layer = new ChromeLayer();
  layer.mount(document.body);
  viewport = new CanvasViewport({
    getContentRects: () => [],
    getSelectionRect: () => null,
    onChange: () => undefined,
    storageKey: "__airship-test:viewport",
  });
  frames = new FrameManager({
    onChanged: () => chrome.render(),
    pathname: "/",
    storageKey: "__airship-test:accordion",
    world: viewport.world,
  });
  chrome = new FrameChrome({
    frames,
    inCanvas: () => true,
    layer,
    onChanged: () => undefined,
    viewport,
  });
  host = document.createElement("div");
  document.body.append(host);
  chrome.mountFrameTools(host);
  chrome.mount(document.createElement("div"));
  chrome.setEditing(false);
  frames.setEditing(false);
});

afterEach(() => {
  chrome.destroy();
  frames.destroy();
  viewport.destroy();
});

describe("the device accordion", () => {
  it("opens on the group holding the frame's own device", () => {
    frames.add({ presetId: "ipad-pro-11" });
    openDevicePane();
    expect(openGroups()).toEqual(["tablet"]);
  });

  it("never opens with every group shut", () => {
    // The list must never present three headers and nothing to read.
    frames.add({ presetId: "iphone-16" });
    openDevicePane();
    expect(openGroups()).toHaveLength(1);
  });

  it("falls back to the first group for a custom size", () => {
    frames.add({ height: 611, name: "Odd", width: 517 });
    openDevicePane();
    expect(openGroups()).toEqual(["phone"]);
  });

  it("expands one group at a time", () => {
    frames.add({ presetId: "iphone-16" });
    openDevicePane();
    expect(openGroups()).toEqual(["phone"]);

    click(head("desktop"));
    expect(openGroups()).toEqual(["desktop"]);

    click(head("tablet"));
    expect(openGroups()).toEqual(["tablet"]);
  });

  it("collapses the open group when its own header is clicked", () => {
    frames.add({ presetId: "iphone-16" });
    openDevicePane();
    click(head("phone"));
    expect(openGroups()).toEqual([]);
  });

  it("hides the rows of a collapsed group but keeps them addressable", () => {
    frames.add({ presetId: "iphone-16" });
    openDevicePane();
    const body = row("iphone-16").parentElement;
    expect(body?.classList.contains(cls("hidden"))).toBe(false);

    click(head("desktop"));
    expect(body?.classList.contains(cls("hidden"))).toBe(true);
    // Still in the DOM — which is what lets `syncMenuState` re-derive its mark.
    expect(row("iphone-16").isConnected).toBe(true);
  });

  it("re-seeds the open group on every re-open, not just the first", () => {
    const frame = frames.add({ presetId: "iphone-16" });
    openDevicePane();
    click(head("desktop"));
    expect(openGroups()).toEqual(["desktop"]);

    // Close, change the device, re-open: the accordion must follow the frame
    // rather than remember where it was left.
    click(dimsBtn());
    frames.applyPreset(frame?.id ?? "", "surface-pro-8");
    openDevicePane();
    expect(openGroups()).toEqual(["tablet"]);
  });
});

describe("the current-device mark", () => {
  it("marks the frame's own device, not the first of that size", () => {
    // The regression this whole change exists for: iPhone 16 and
    // iPhone 14 & 15 Pro are both 393 × 852.
    const frame = frames.add({ presetId: "iphone-16" });
    frames.applyPreset(frame?.id ?? "", "iphone-14-pro");
    openDevicePane();
    expect(marked("iphone-14-pro")).toBe(true);
    expect(marked("iphone-16")).toBe(false);
  });

  it("marks Wireframes over Desktop at the same 1440 × 1024", () => {
    const frame = frames.add({ presetId: "desktop" });
    frames.applyPreset(frame?.id ?? "", "wireframe");
    openDevicePane();
    expect(marked("wireframe")).toBe(true);
    expect(marked("desktop")).toBe(false);
  });

  it("survives a round trip through a custom size and back", () => {
    const frame = frames.add({ presetId: "iphone-14-pro" });
    frames.resize(frame?.id ?? "", 500, 700);
    frames.resize(frame?.id ?? "", 393, 852);
    openDevicePane();
    expect(marked("iphone-14-pro")).toBe(true);
  });

  it("gives the preference up when another device claims the size", () => {
    // The other half of the stickiness: dormant is not immortal. Resizing onto a
    // size some device does have must move the mark there.
    const frame = frames.add({ presetId: "iphone-14-pro" });
    frames.resize(frame?.id ?? "", 1440, 1024);
    openDevicePane();
    expect(marked("desktop")).toBe(true);
    expect(marked("iphone-14-pro")).toBe(false);
  });

  it("survives a rotation", () => {
    const frame = frames.add({ presetId: "iphone-14-pro" });
    frames.rotate(frame?.id ?? "");
    openDevicePane();
    expect(marked("iphone-14-pro")).toBe(true);
  });

  it("is re-derived on a group that was shut when the device changed", () => {
    // The ordering bug `syncGroups`-before-`syncMenuState` exists to prevent: a
    // mark set while its group was collapsed must be right when it re-opens.
    const frame = frames.add({ presetId: "iphone-16" });
    openDevicePane();
    click(head("tablet"));
    frames.applyPreset(frame?.id ?? "", "ipad-mini");
    click(head("phone"));
    expect(marked("iphone-16")).toBe(false);
  });
});
