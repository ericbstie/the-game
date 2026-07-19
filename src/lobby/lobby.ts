import { generateCode, normalizeCode } from "./code";
import {
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  MAX_PLAYERS,
  NAME_MAX,
  type PlayerId,
  type PlayerToken,
  type Presence,
  type PublicPlayer,
  parseClientMessage,
  type ServerMessage,
} from "./protocol";

// The only thing the domain needs from the outside world: address a socket by id to
// push a message or hang it up. The Bun adapter (server.ts) implements this over real
// sockets; tests implement it over a capture buffer.
export interface Transport {
  send(socketId: string, msg: ServerMessage): void;
  close(socketId: string, code: number, reason?: string): void;
}

export interface LobbyConfig {
  graceMs?: number; // slot held + greyed this long after a drop; default 45s
}

const DEFAULT_GRACE_MS = 45_000;
const SUPERSEDE_CODE = 4000;

interface PlayerRecord {
  id: PlayerId;
  token: PlayerToken;
  name: string;
  slot: number;
  presence: Presence;
  socketId?: string; // the socket currently owning this slot, if connected
}

interface SessionRecord {
  code: LobbyCode;
  maxPlayers: number;
  phase: "lobby" | "in-game";
  host: PlayerId;
  rev: number;
  players: Map<PlayerId, PlayerRecord>;
  graceTimers: Map<PlayerId, ReturnType<typeof setTimeout>>;
}

// Server-authoritative hub over every Session. Owns the whole
// create/join/leave/disconnect/reconnect/grace/takeover lifecycle so the transport
// stays a dumb pipe. Time-based effects (grace expiry) run on real timers whose
// duration is configurable, keeping tests fast and deterministic.
export class LobbyHub {
  private readonly sessions = new Map<LobbyCode, SessionRecord>();
  private readonly sockets = new Map<string, { code: LobbyCode; playerId: PlayerId }>();
  private readonly graceMs: number;
  private disposed = false;

  constructor(
    private readonly transport: Transport,
    config: LobbyConfig = {},
  ) {
    this.graceMs = config.graceMs ?? DEFAULT_GRACE_MS;
  }

  handleMessage(socketId: string, raw: string): void {
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.error(socketId, "invalid");
      return;
    }
    switch (msg.type) {
      case "lobby/create":
        this.create(socketId, msg.name, msg.maxPlayers);
        return;
      case "lobby/join":
        this.join(socketId, msg.code, msg.name, msg.token);
        return;
      case "lobby/leave":
        this.leave(socketId);
        return;
    }
  }

  // A dropped socket (no explicit leave): hold the slot and start the grace clock.
  handleClose(socketId: string): void {
    if (this.disposed) return;
    const bind = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return; // stale (superseded) socket

    player.socketId = undefined;
    player.presence = { status: "disconnected", graceExpiresAt: Date.now() + this.graceMs };
    this.broadcast(session, {
      type: "lobby/presence-changed",
      id: player.id,
      presence: player.presence,
      rev: ++session.rev,
    });
    const timer = setTimeout(() => this.expireGrace(session.code, player.id), this.graceMs);
    timer.unref?.();
    session.graceTimers.set(player.id, timer);
  }

  // Clear all pending timers so a stopped server leaves nothing running.
  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values()) {
      for (const timer of session.graceTimers.values()) clearTimeout(timer);
      session.graceTimers.clear();
    }
  }

  private create(socketId: string, rawName: string, maxPlayers: number | undefined): void {
    if (this.sockets.has(socketId)) {
      this.error(socketId, "invalid");
      return;
    }
    const name = resolveName(rawName, 1);
    if (name === null) {
      this.error(socketId, "invalid");
      return;
    }

    const code = generateCode((c) => this.sessions.has(c));
    const player: PlayerRecord = {
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      name,
      slot: 1,
      presence: { status: "connected" },
      socketId,
    };
    const session: SessionRecord = {
      code,
      maxPlayers: clampMax(maxPlayers),
      phase: "lobby",
      host: player.id,
      rev: 0,
      players: new Map([[player.id, player]]),
      graceTimers: new Map(),
    };
    this.sessions.set(code, session);
    this.sockets.set(socketId, { code, playerId: player.id });
    this.transport.send(socketId, {
      type: "lobby/created",
      code,
      you: selfOf(player),
      snapshot: snapshotOf(session),
    });
  }

  private join(
    socketId: string,
    rawCode: string,
    rawName: string,
    token: PlayerToken | undefined,
  ): void {
    const session = this.sessions.get(normalizeCode(rawCode));
    if (!session) {
      this.error(socketId, "lobby-not-found");
      return;
    }

    if (token !== undefined) {
      const owner = [...session.players.values()].find((p) => p.token === token);
      // A presented token the session no longer knows = the slot was already released.
      if (!owner) {
        this.error(socketId, "slot-released");
        return;
      }
      this.reclaim(socketId, session, owner);
      return;
    }

    const slot = this.nextOpenSlot(session);
    if (slot === null) {
      this.error(socketId, "lobby-full");
      return;
    }
    const name = resolveName(rawName, slot);
    if (name === null) {
      this.error(socketId, "invalid");
      return;
    }

    const player: PlayerRecord = {
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      name,
      slot,
      presence: { status: "connected" },
      socketId,
    };
    session.players.set(player.id, player);
    this.sockets.set(socketId, { code: session.code, playerId: player.id });
    const rev = ++session.rev;
    this.transport.send(socketId, {
      type: "lobby/joined",
      code: session.code,
      you: selfOf(player),
      snapshot: snapshotOf(session),
      reclaimed: false,
      tookOver: false,
    });
    this.broadcast(
      session,
      { type: "lobby/player-joined", player: publicOf(player), rev },
      socketId,
    );
  }

  // Reconnect (same token) reclaims the held slot; a second live socket with the same
  // token is a takeover — newest wins, the older is superseded and closed.
  private reclaim(socketId: string, session: SessionRecord, player: PlayerRecord): void {
    let tookOver = false;
    if (player.socketId !== undefined && player.socketId !== socketId) {
      this.transport.send(player.socketId, { type: "lobby/superseded" });
      this.transport.close(player.socketId, SUPERSEDE_CODE, "superseded");
      this.sockets.delete(player.socketId);
      tookOver = true;
    }
    const timer = session.graceTimers.get(player.id);
    if (timer) {
      clearTimeout(timer);
      session.graceTimers.delete(player.id);
    }

    const cameBack = player.presence.status !== "connected";
    player.presence = { status: "connected" };
    player.socketId = socketId;
    this.sockets.set(socketId, { code: session.code, playerId: player.id });

    const rev = cameBack ? ++session.rev : session.rev;
    this.transport.send(socketId, {
      type: "lobby/joined",
      code: session.code,
      you: selfOf(player),
      snapshot: snapshotOf(session),
      reclaimed: true,
      tookOver,
    });
    if (cameBack) {
      this.broadcast(
        session,
        { type: "lobby/presence-changed", id: player.id, presence: player.presence, rev },
        socketId,
      );
    }
  }

  private leave(socketId: string): void {
    const bind = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    player.socketId = undefined;
    this.removePlayer(session, player, "left");
  }

  private expireGrace(code: LobbyCode, playerId: PlayerId): void {
    const session = this.sessions.get(code);
    const player = session?.players.get(playerId);
    if (!session || !player || player.presence.status !== "disconnected") return;
    session.graceTimers.delete(playerId);
    this.removePlayer(session, player, "grace-expired");
  }

  private removePlayer(
    session: SessionRecord,
    player: PlayerRecord,
    reason: "left" | "grace-expired",
  ): void {
    session.players.delete(player.id);
    const timer = session.graceTimers.get(player.id);
    if (timer) {
      clearTimeout(timer);
      session.graceTimers.delete(player.id);
    }
    this.broadcast(session, {
      type: "lobby/player-left",
      id: player.id,
      slot: player.slot,
      reason,
      rev: ++session.rev,
    });

    // Empty session (zero connected, none in grace) is destroyed and its code freed.
    if (session.players.size === 0) {
      this.sessions.delete(session.code);
      return;
    }

    if (session.host === player.id) {
      session.host = this.nextHost(session).id;
      this.broadcast(session, {
        type: "lobby/host-changed",
        host: session.host,
        rev: ++session.rev,
      });
    }
  }

  private nextOpenSlot(session: SessionRecord): number | null {
    const taken = new Set([...session.players.values()].map((p) => p.slot));
    for (let slot = 1; slot <= session.maxPlayers; slot++) if (!taken.has(slot)) return slot;
    return null;
  }

  // The lowest occupied slot, preferring a connected player so the host badge does not
  // land on a greyed (in-grace) seat; falls back to the lowest slot if all are in grace.
  private nextHost(session: SessionRecord): PlayerRecord {
    const players = [...session.players.values()];
    const connected = players.filter((p) => p.presence.status === "connected");
    const pool = connected.length > 0 ? connected : players;
    return pool.reduce((lowest, p) => (p.slot < lowest.slot ? p : lowest));
  }

  private broadcast(session: SessionRecord, msg: ServerMessage, exceptSocketId?: string): void {
    for (const p of session.players.values()) {
      if (p.socketId && p.socketId !== exceptSocketId) this.transport.send(p.socketId, msg);
    }
  }

  private error(socketId: string, code: LobbyErrorCode): void {
    this.transport.send(socketId, { type: "lobby/error", code });
  }
}

function selfOf(p: PlayerRecord) {
  return { id: p.id, token: p.token, slot: p.slot };
}

function publicOf(p: PlayerRecord): PublicPlayer {
  return { id: p.id, name: p.name, slot: p.slot, presence: p.presence };
}

function snapshotOf(session: SessionRecord): LobbySnapshot {
  return {
    code: session.code,
    phase: session.phase,
    maxPlayers: session.maxPlayers,
    host: session.host,
    players: [...session.players.values()].sort((a, b) => a.slot - b.slot).map(publicOf),
    rev: session.rev,
  };
}

// Trimmed and required; empty falls back to `Player N` (N = slot). Over-long is
// rejected as invalid (null) rather than silently truncated.
function resolveName(raw: string, slot: number): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return `Player ${slot}`;
  if (trimmed.length > NAME_MAX) return null;
  return trimmed;
}

function clampMax(maxPlayers: number | undefined): number {
  if (maxPlayers === undefined) return MAX_PLAYERS;
  return Math.max(2, Math.min(MAX_PLAYERS, maxPlayers));
}
