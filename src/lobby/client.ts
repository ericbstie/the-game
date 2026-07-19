import { normalizeCode } from "./code";
import {
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  type PlayerToken,
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
  retryMs?: number; // reconnect cadence while a dropped socket is within its grace window
}

const DEFAULT_RETRY_MS = 2000;

const ERROR_TEXT: Record<LobbyErrorCode, string> = {
  "lobby-not-found": "Lobby not found — check the code and try again.",
  "lobby-full": "That lobby is full.",
  "slot-released": "Your spot was released. Rejoin to get a new seat.",
  invalid: "Something went wrong. Please try again.",
};

type Intent =
  | { kind: "host"; name: string }
  | { kind: "join"; code: LobbyCode; name: string; token?: PlayerToken };

// Owns the lobby WebSocket and the local view of the Session. Exposes a
// subscribe/getState store so React can bind with useSyncExternalStore. On an
// unexpected drop it holds the identity (client-persisted token), shows
// "Reconnecting…", and re-presents the token on a fixed cadence to reclaim the same
// slot within the server's grace window (INV-4).
export class LobbyClient {
  private state: LobbyState = { status: "menu" };
  private readonly listeners = new Set<() => void>();
  private readonly wsUrl: string;
  private readonly retryMs: number;
  private ws?: WebSocket;
  private intent?: Intent;
  private identity?: { code: LobbyCode; token: PlayerToken; name: string };
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(options: LobbyClientOptions = {}) {
    this.wsUrl = options.wsUrl ?? defaultWsUrl();
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
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
    this.clearReconnect();
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "lobby/leave" }));
    this.teardown();
    this.forgetIdentity();
    this.setState({
      status: "menu",
      code: undefined,
      self: undefined,
      snapshot: undefined,
      error: undefined,
    });
  }

  // Stop all activity and release the socket — for React unmount and test teardown.
  // Unlike leave() it sends nothing and keeps the persisted token for a later rejoin.
  dispose(): void {
    this.clearReconnect();
    this.teardown();
    this.listeners.clear();
  }

  private connect(): void {
    const ws = new WebSocket(`${this.wsUrl}?v=${PROTOCOL_VERSION}`);
    this.ws = ws;
    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (ev) =>
      this.onMessage(JSON.parse(String((ev as MessageEvent).data))),
    );
    ws.addEventListener("close", () => this.onDisconnect(ws));
    ws.addEventListener("error", () => this.onDisconnect(ws));
  }

  private onOpen(): void {
    if (!this.intent) return;
    if (this.intent.kind === "host") {
      this.send({ type: "lobby/create", name: this.intent.name });
    } else {
      this.send({
        type: "lobby/join",
        code: this.intent.code,
        name: this.intent.name,
        token: this.intent.token,
      });
    }
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "lobby/created":
      case "lobby/joined":
        this.identity = { code: msg.code, token: msg.you.token, name: this.intent?.name ?? "" };
        persistToken(msg.code, msg.you.token);
        this.clearReconnect();
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
      case "lobby/superseded":
        // Taken over by another device: stop here rather than fight for the slot.
        this.clearReconnect();
        this.teardown();
        this.forgetIdentity();
        this.setState({ status: "menu", error: "This lobby was opened on another device." });
        return;
      default:
        this.setState({ snapshot: applyRoster(this.state.snapshot ?? null, msg) ?? undefined });
    }
  }

  private onServerError(code: LobbyErrorCode): void {
    this.clearReconnect();
    this.teardown();
    if (code === "slot-released") {
      this.forgetIdentity();
      this.setState({
        status: "released",
        code: undefined,
        self: undefined,
        snapshot: undefined,
        error: ERROR_TEXT[code],
      });
    } else {
      this.setState({ status: "menu", error: ERROR_TEXT[code] });
    }
  }

  // Fired for the CURRENT socket only. A deliberate close nulls `this.ws` first, so a
  // stale event is ignored. An unexpected drop while seated starts the reconnect loop.
  private onDisconnect(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = undefined;
    if (this.identity) {
      if (this.state.status !== "reconnecting") this.setState({ status: "reconnecting" });
      this.scheduleReconnect();
    } else {
      this.setState({ status: "menu", error: "Could not reach the server." });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectNow();
    }, this.retryMs);
    this.reconnectTimer.unref?.();
  }

  private reconnectNow(): void {
    if (!this.identity) return;
    this.intent = {
      kind: "join",
      code: this.identity.code,
      name: this.identity.name,
      token: this.identity.token,
    };
    this.connect();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private send(msg: { type: string; [k: string]: unknown }): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
  }

  private forgetIdentity(): void {
    if (this.identity) forgetToken(this.identity.code);
    this.identity = undefined;
  }

  private setState(patch: Partial<LobbyState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}

// Persist the secret token keyed by lobby code so it survives a reload (INV-4).
// localStorage may be unavailable (SSR, privacy mode); persistence is best-effort.
function tokenKey(code: LobbyCode): string {
  return `lobby:token:${code}`;
}

function persistToken(code: LobbyCode, token: PlayerToken): void {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {}
}

function forgetToken(code: LobbyCode): void {
  try {
    localStorage.removeItem(tokenKey(code));
  } catch {}
}

function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${WS_PATH}`;
}
