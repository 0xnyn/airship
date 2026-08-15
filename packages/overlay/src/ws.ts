import type { ClientMessage, ServerEvent } from "@airship/protocol";

type Listener = (event: ServerEvent) => void;

/** Auto-reconnecting client for the Airship control socket. */
export class AirshipSocket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  /** The pending reconnect, so teardown can cancel one mid-flight. */
  private retry = 0;
  /** Torn down. Stops the reconnect loop, which is otherwise unstoppable. */
  private dead = false;

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  connect(): void {
    if (this.dead) {
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}${this.path}`);
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as ServerEvent;
        for (const l of this.listeners) {
          l(event);
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.dead) {
        return;
      }
      this.retry = window.setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }

  /**
   * Stop reconnecting and let go of every listener.
   *
   * Without this the reconnect loop is unstoppable by construction: `onclose`
   * schedules the next attempt, so closing the socket is what *causes* it to
   * come back. An overlay torn down and rebuilt in the same page — which
   * `?__airship=inline` does on every HMR cycle — therefore left a live socket
   * per cycle, each one holding a listener closed over a dead app and each one
   * reconnecting to the daemon forever. `AirshipApp.destroy` releases the key
   * bindings and the DOM; this is the third thing it has to release.
   *
   * The flag is checked in `connect` as well as in `onclose`, because a retry
   * already in flight when this runs would otherwise open one last socket.
   */
  destroy(): void {
    this.dead = true;
    clearTimeout(this.retry);
    this.retry = 0;
    this.listeners.clear();
    // `onclose` is still wired and will fire; the flag above is what makes it
    // a no-op rather than the start of the next attempt.
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Whether a `send` would actually reach the daemon.
   *
   * `send` drops silently when the socket is down, which is right for
   * fire-and-forget traffic but not for the prompt preview: a dropped request
   * and a slow one look identical from the pane, and it would sit on stale text
   * presenting it as live.
   */
  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
