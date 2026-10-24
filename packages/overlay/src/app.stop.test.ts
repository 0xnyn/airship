import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirshipApp, type Stage } from "./app";
import { ChromeLayer } from "./chrome-layer";
import { cls } from "./dom";
import { keys } from "./keys/registry";
import { InlineResolver } from "./surface";

/*
 * Send, while a turn is running, has to become Stop.
 *
 * The daemon has supported cancelling a job since `{ type: "cancel", jobId }` landed in the
 * protocol (`server/src/index.ts`'s `case "cancel": jobs.get(parsed.jobId)?.abort?.abort()`), and
 * `keepVisual` even explains that a cancelled turn keeps its pending deltas queued "so Send tries
 * again rather than starting from nothing" — cancelling was designed in from the start. What never
 * existed was a way to *ask* for it: the composer's Send button just disabled itself the moment a
 * turn began (`beginJob`) and stayed that way until `job:done`. This file pins the fix — the
 * button now stays live and flips to Stop, wired to that same cancel message, instead of going
 * inert for however long the agent takes.
 */

function stubStage(): Stage {
  const layer = new ChromeLayer();
  return {
    destroy() {
      // Nothing to release beyond what `AirshipApp.destroy` already does.
    },
    layer,
    mount() {
      layer.mount(document.body);
    },
    onLayoutChange() {
      // Nothing moves under a stage with no content.
    },
    resolver: new InlineResolver(),
    swallowPresses: true,
  };
}

function stubStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: () => null,
      length: 0,
      removeItem: (k: string) => store.delete(k),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
}

/** A WebSocket stand-in that is "open" from the moment it is constructed (so `AirshipSocket.send`
 * actually forwards), records every message sent through it, and lets a test push a server event
 * straight at the app the way a real frame would. */
class FakeSocket {
  static readonly OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: unknown[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    sockets.push(this);
  }
  addEventListener(
    kind: string,
    handler: (ev: { data: string }) => void
  ): void {
    if (kind === "message") {
      this.onmessage = handler;
    }
  }
  close(): void {
    this.onclose?.();
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  emit(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const apps: AirshipApp[] = [];
let sockets: FakeSocket[] = [];

function mount(): { app: AirshipApp; socket: FakeSocket } {
  const stage = stubStage();
  const app = new AirshipApp(
    { mode: "inline", wsPath: "/__airship/ws" },
    stage
  );
  app.mount();
  apps.push(app);
  return { app, socket: sockets.at(-1) as FakeSocket };
}

function sendBtn(): HTMLButtonElement {
  const btn = document.querySelector(`.${cls("send")}`);
  if (!btn) {
    throw new Error("sendBtn: composer has not been mounted");
  }
  return btn as HTMLButtonElement;
}

function typeAndSubmit(text: string): void {
  const input = document.querySelector(
    `.${cls("input")}`
  ) as HTMLTextAreaElement;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  sendBtn().dispatchEvent(new Event("click", { bubbles: true }));
}

beforeEach(() => {
  stubStorage();
  sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.destroy();
  }
  keys.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("stopping an in-progress chat response", () => {
  it("turns Send into Stop once a turn is running, and Stop cancels the running job by id", () => {
    const { socket } = mount();

    typeAndSubmit("add a footer");
    expect(socket.sent).toEqual([{ request: expect.anything(), type: "edit" }]);

    // The turn is running but the daemon has not answered `job:created` yet. The button is
    // already Stop, because the user's intent does not depend on the daemon's bookkeeping.
    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().getAttribute("aria-label")).toBe("Stop");

    socket.emit({
      job: { createdAt: Date.now(), jobId: "job-1", status: "running" },
      type: "job:created",
    });

    sendBtn().dispatchEvent(new Event("click", { bubbles: true }));

    // Exactly one more message went out, and it is the cancel — not a second edit.
    expect(socket.sent).toEqual([
      { request: expect.anything(), type: "edit" },
      { jobId: "job-1", type: "cancel" },
    ]);
  });

  it("holds a Stop pressed before the job has an id, and sends it when one lands", () => {
    // The window between Send and `job:created` is usually milliseconds, but behind another
    // tab's edit on the daemon's serial chain it is as long as that edit takes — and a Stop
    // that silently did nothing there would read as a broken button.
    const { socket } = mount();

    typeAndSubmit("add a footer");
    sendBtn().dispatchEvent(new Event("click", { bubbles: true }));
    sendBtn().dispatchEvent(new Event("click", { bubbles: true }));
    // Nothing to address it to yet, so nothing went out.
    expect(socket.sent).toHaveLength(1);

    socket.emit({
      job: { createdAt: Date.now(), jobId: "job-3", status: "running" },
      type: "job:created",
    });

    // One cancel, however many times Stop was pressed while waiting.
    expect(socket.sent.slice(1)).toEqual([{ jobId: "job-3", type: "cancel" }]);
  });

  it("forgets a held Stop once the turn it was meant for is over", () => {
    const { socket } = mount();

    typeAndSubmit("add a footer");
    sendBtn().dispatchEvent(new Event("click", { bubbles: true }));
    // The daemon never created the job — the socket dropped, say — and the reconnect's
    // `hello` reports nothing running, which releases the turn.
    socket.emit({ defaultAgent: "claude", jobs: [], type: "hello" });
    expect(sendBtn().getAttribute("aria-label")).toBe("Send");

    typeAndSubmit("try again");
    socket.emit({
      job: { createdAt: Date.now(), jobId: "job-4", status: "running" },
      type: "job:created",
    });

    // The stale Stop must not cancel the new turn.
    expect(
      socket.sent.filter((m) => (m as { type: string }).type === "cancel")
    ).toEqual([]);
  });

  it("reverts to Send once the job ends, ready to submit the next turn", () => {
    const { socket } = mount();

    typeAndSubmit("add a footer");
    socket.emit({
      job: { createdAt: Date.now(), jobId: "job-2", status: "running" },
      type: "job:created",
    });
    expect(sendBtn().getAttribute("aria-label")).toBe("Stop");

    socket.emit({
      bundle: {
        basedOn: null,
        jobId: "job-2",
        parentJobId: null,
        status: "done",
        summary: "",
      },
      jobId: "job-2",
      type: "job:done",
    });

    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().getAttribute("aria-label")).toBe("Send");

    typeAndSubmit("one more change");
    expect(socket.sent.at(-1)).toEqual({
      request: expect.anything(),
      type: "edit",
    });
  });
});
