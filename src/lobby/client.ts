import { ClientWorld } from "../game/clientWorld";
import { normalizeCode } from "./code";
import {
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  type PlayerToken,
  PROTOCOL_VERSION,
  type Self,
  type ServerMessage,
  type Vec2,
  type Weapon,
  WS_PATH,
} from "./protocol";
import { applyRoster } from "./roster";

export type LobbyStatus = "menu" | "connecting" | "lobby" | "reconnecting" | "released";

export interface LobbyState {
  status: LobbyStatus;
  code?: LobbyCode;
  self?: Self;
  snapshot?: LobbySnapshot;
  world?: ClientWorld; // the live local world once the match starts; mutated in place
  error?: string;
}

export interface LobbyClientOptions {
  wsUrl?: string; // base `/ws` URL; defaults to the page's same origin
  retryMs?: number; // reconnect cadence while a dropped socket is within its grace window
  reconnectWindowMs?: number; // total time to keep retrying before giving up (server unreachable)
}

const DEFAULT_RETRY_MS = 2000;
// Bounds the retry loop when the server is unreachable (no slot-released ever arrives).
// Longer than the server's 45s grace so a recoverable drop always resolves first.
const DEFAULT_RECONNECT_WINDOW_MS = 60_000;

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
  private readonly reconnectWindowMs: number;
  private ws?: WebSocket;
  private intent?: Intent;
  private identity?: { code: LobbyCode; token: PlayerToken; name: string };
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectUntil?: number; // wall-clock deadline for the current reconnect loop
  private posSeq = 0; // monotonic across the client's whole life, so it survives reconnect
  private attackSeq = 0; // monotonic attack sequence, independent of posSeq
  private healthSeq = 0; // monotonic health sequence, independent of the others

  constructor(options: LobbyClientOptions = {}) {
    this.wsUrl = options.wsUrl ?? defaultWsUrl();
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.reconnectWindowMs = options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS;
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

  // Host-only in practice (the server rejects a non-host); begins the match.
  start(): void {
    this.send({ type: "game/start" });
  }

  // Stream the client's own integrated position. `seq` is monotonic across the client's
  // life (never reset on reconnect) so the server and peers accept it in order. A no-op
  // while the socket is down (reconnecting).
  sendPos(pos: Vec2): void {
    this.send({ type: "game/pos", pos, seq: ++this.posSeq });
  }

  // Report a swing/shot. The server validates (cadence/range/seq) and applies the damage —
  // the client never writes enemy HP. `seq` is monotonic, like sendPos.
  sendAttack(weapon: Weapon, pos: Vec2, dir: Vec2): void {
    this.send({ type: "game/attack", weapon, pos, dir, seq: ++this.attackSeq });
  }

  // Report the client's own HP (it owns it). `hp <= 0` declares death. The server stores and
  // relays it; it never computes health. `seq` is monotonic, like sendPos.
  sendHealth(hp: number): void {
    this.send({ type: "game/health", hp, seq: ++this.healthSeq });
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
      world: undefined,
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
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String((ev as MessageEvent).data));
      } catch {
        return; // ignore a malformed frame rather than throw in the listener
      }
      this.onMessage(msg);
    });
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
        this.reconnectUntil = undefined;
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
        this.setState({
          status: "menu",
          code: undefined,
          self: undefined,
          snapshot: undefined,
          world: undefined,
          error: "This lobby was opened on another device.",
        });
        return;
      case "game/world-init": {
        // Build (or, on reconnect, rebuild) the local world. Flipping the phase here lands
        // a (re)connecter in the match rather than the lobby roster.
        if (!this.state.self) return; // no identity yet — cannot own an avatar
        const world = new ClientWorld(msg.init, this.state.self.id);
        const snapshot = this.state.snapshot
          ? { ...this.state.snapshot, phase: "in-game" as const }
          : this.state.snapshot;
        this.setState({ world, snapshot });
        return;
      }
      case "game/peer-pos":
        // Mutate the live world in place: the render loop reads it every frame, so no
        // React re-render is wanted at the ~20 Hz relay rate. Stamp arrival time locally —
        // interpolation runs on the client clock, so no server clock sync is needed.
        this.state.world?.applyPeer(msg.id, msg.pos, msg.seq, Date.now());
        return;
      case "game/map-delta":
        // Mutate the live world in place — the render loop reads it every frame, so no React
        // re-render at the ~20 Hz tick rate. Arrival time is stamped locally (client clock).
        this.state.world?.applyMapDelta(msg, Date.now());
        return;
      case "game/peer-health":
        this.state.world?.applyPeerHealth(msg.id, msg.hp, msg.seq);
        return;
      case "game/enemy-init":
        this.state.world?.initEnemies(msg);
        return;
      case "lobby/player-left":
        this.state.world?.removePeer(msg.id);
        this.setState({ snapshot: applyRoster(this.state.snapshot ?? null, msg) ?? undefined });
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
        world: undefined,
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
      if (this.state.status !== "reconnecting") {
        this.reconnectUntil = Date.now() + this.reconnectWindowMs;
        this.setState({ status: "reconnecting" });
      }
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
    // Give up once the retry window elapses — a reachable server would have sent a
    // reclaim or slot-released by now, so this only fires when the server is gone.
    if (this.reconnectUntil !== undefined && Date.now() > this.reconnectUntil) {
      this.reconnectUntil = undefined;
      this.teardown();
      this.forgetIdentity();
      this.setState({ status: "menu", error: "Lost connection to the lobby." });
      return;
    }
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
