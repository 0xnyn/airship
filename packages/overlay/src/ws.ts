import type { ClientMessage, ServerEvent } from "@airship/protocol";

type Listener = (event: ServerEvent) => void;

/** Auto-reconnecting client for the Airship control socket. */
export class AirshipSocket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  connect(): void {
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
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
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
