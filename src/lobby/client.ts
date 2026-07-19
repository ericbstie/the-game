import { normalizeCode } from "./code";
import {
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  PROTOCOL_VERSION,
  type Self,
  type ServerMessage,
  WS_PATH,
} from "./protocol";
import { applyRoster } from "./roster";

export type LobbyStatus = "menu" | "connecting" | "lobby" | "reconnecting" | "released";

export interface LobbyState {
  status: LobbyStatus;
  code?: LobbyCode;
  self?: Self;
  snapshot?: LobbySnapshot;
  error?: string;
}

export interface LobbyClientOptions {
  wsUrl?: string; // base `/ws` URL; defaults to the page's same origin
}

const ERROR_TEXT: Record<LobbyErrorCode, string> = {
  "lobby-not-found": "Lobby not found — check the code and try again.",
  "lobby-full": "That lobby is full.",
  "slot-released": "Your spot was released. Rejoin to get a new seat.",
  invalid: "Something went wrong. Please try again.",
};

// Owns the lobby WebSocket and the local view of the Session. Exposes a
// subscribe/getState store so React can bind with useSyncExternalStore; the WS,
// command sends, and roster folding all live behind that seam.
export class LobbyClient {
  private state: LobbyState = { status: "menu" };
  private readonly listeners = new Set<() => void>();
  private readonly wsUrl: string;
  private ws?: WebSocket;
  private intent?: { kind: "host"; name: string } | { kind: "join"; code: LobbyCode; name: string };

  constructor(options: LobbyClientOptions = {}) {
    this.wsUrl = options.wsUrl ?? defaultWsUrl();
  }

  getState = (): LobbyState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  host(name: string): void {
    this.intent = { kind: "host", name };
    this.setState({ status: "connecting", error: undefined });
    this.connect();
  }

  join(code: string, name: string): void {
    this.intent = { kind: "join", code: normalizeCode(code), name };
    this.setState({ status: "connecting", error: undefined });
    this.connect();
  }

  leave(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: "lobby/leave" }));
    this.teardown();
    this.setState({
      status: "menu",
      code: undefined,
      self: undefined,
      snapshot: undefined,
      error: undefined,
    });
  }

  private connect(): void {
    const ws = new WebSocket(`${this.wsUrl}?v=${PROTOCOL_VERSION}`);
    this.ws = ws;
    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (ev) =>
      this.onMessage(JSON.parse(String((ev as MessageEvent).data))),
    );
    ws.addEventListener("error", () => this.onError());
  }

  private onOpen(): void {
    if (!this.intent) return;
    if (this.intent.kind === "host") {
      this.send({ type: "lobby/create", name: this.intent.name });
    } else {
      this.send({ type: "lobby/join", code: this.intent.code, name: this.intent.name });
    }
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "lobby/created":
      case "lobby/joined":
        this.setState({
          status: "lobby",
          code: msg.code,
          self: msg.you,
          snapshot: applyRoster(this.state.snapshot ?? null, msg) ?? undefined,
          error: undefined,
        });
        return;
      case "lobby/error":
        this.onServerError(msg.code);
        return;
      default:
        this.setState({ snapshot: applyRoster(this.state.snapshot ?? null, msg) ?? undefined });
    }
  }

  private onServerError(code: LobbyErrorCode): void {
    this.teardown();
    this.setState({
      status: code === "slot-released" ? "released" : "menu",
      error: ERROR_TEXT[code],
    });
  }

  private onError(): void {
    if (this.state.status === "connecting")
      this.setState({ status: "menu", error: "Could not reach the server." });
  }

  private send(msg: { type: string; [k: string]: unknown }): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
  }

  private setState(patch: Partial<LobbyState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}

function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${WS_PATH}`;
}
