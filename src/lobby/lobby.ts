import {
  type Attack,
  type AttackGuard,
  admitAttack,
  type EnemyState,
  freshGuard,
  spawnEnemyState,
  stepEnemies,
} from "../game/enemies";
import { generateWorld } from "../game/world";
import { generateCode, normalizeCode } from "./code";
import {
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  MAX_PLAYERS,
  type MapDelta,
  NAME_MAX,
  type PlayerId,
  type PlayerToken,
  type Presence,
  type PublicPlayer,
  parseClientMessage,
  type ServerMessage,
  type Vec2,
  type Weapon,
  type WorldInit,
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
  tickMs?: number; // enemy-sim tick period; default 50ms (~20 Hz). Overridable for fast tests.
  firstWaveMs?: number; // override the initial wave countdown (default: the sim's 30s). Test knob.
}

const DEFAULT_GRACE_MS = 45_000;
const DEFAULT_TICK_MS = 50; // ~20 Hz enemy/combat simulation
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
  worldInit?: WorldInit; // generated once at start; re-sent verbatim on reconnect
  positions: Map<PlayerId, { pos: Vec2; seq: number }>; // last-known relayed position per player
  sim?: EnemyState; // server-authoritative enemy simulation, live only in-game
  simTimer?: ReturnType<typeof setInterval>; // the 20 Hz tick driving `sim`; cleared on teardown
  tickNo: number; // monotonic map-delta tick counter (apply-if-newer on clients)
  attackGuards: Map<PlayerId, AttackGuard>; // per-player cadence/seq admission state
  pendingAttacks: Attack[]; // admitted attacks awaiting the next tick's resolution
}

// Server-authoritative hub over every Session. Owns the whole
// create/join/leave/disconnect/reconnect/grace/takeover lifecycle so the transport
// stays a dumb pipe. Time-based effects (grace expiry) run on real timers whose
// duration is configurable, keeping tests fast and deterministic.
export class LobbyHub {
  private readonly sessions = new Map<LobbyCode, SessionRecord>();
  private readonly sockets = new Map<string, { code: LobbyCode; playerId: PlayerId }>();
  private readonly graceMs: number;
  private readonly tickMs: number;
  private readonly firstWaveMs?: number;
  private disposed = false;

  constructor(
    private readonly transport: Transport,
    config: LobbyConfig = {},
  ) {
    this.graceMs = config.graceMs ?? DEFAULT_GRACE_MS;
    this.tickMs = config.tickMs ?? DEFAULT_TICK_MS;
    this.firstWaveMs = config.firstWaveMs;
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
      case "game/start":
        this.startGame(socketId);
        return;
      case "game/pos":
        this.gamePos(socketId, msg.pos, msg.seq);
        return;
      case "game/attack":
        this.gameAttack(socketId, msg.weapon, msg.pos, msg.dir, msg.seq);
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
    // No avatar to freeze: the client owns its position now, so a dropped player simply
    // stops streaming and peers hold its last-known position until grace resolves.
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
      if (session.simTimer) clearInterval(session.simTimer); // stop the enemy tick
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
      positions: new Map(),
      tickNo: 0,
      attackGuards: new Map(),
      pendingAttacks: [],
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
    // One socket carries one identity for its lifetime. A second create/join on an
    // already-bound socket is a protocol violation — rejecting it prevents rebinding
    // the socket to a new player and orphaning the first (a permanent slot leak).
    if (this.sockets.has(socketId)) {
      this.error(socketId, "invalid");
      return;
    }
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
    // A brand-new joiner mid-match isn't a supported M2 player (the Squad is fixed at
    // Start), but hand them the world so they at least see it rather than a dead screen.
    this.sendWorldState(session, socketId);
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
      // Unbind the old socket BEFORE closing it, so its close callback (whether Bun
      // delivers it sync or async) finds no binding and can't arm a phantom grace.
      const superseded = player.socketId;
      this.sockets.delete(superseded);
      this.transport.send(superseded, { type: "lobby/superseded" });
      this.transport.close(superseded, SUPERSEDE_CODE, "superseded");
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
    // Rebuild the reconnecter's world: the immutable init plus everyone's last-known
    // position, so their client lands back in the match where the squad actually is.
    this.sendWorldState(session, socketId);
    if (cameBack) {
      this.broadcast(
        session,
        { type: "lobby/presence-changed", id: player.id, presence: player.presence, rev },
        socketId,
      );
    }
  }

  // Host-only: flip the Session into a match, generate the shared world once from the
  // current Squad, and hand every client its immutable world-init. The server does not
  // simulate avatars — it becomes a relay; clients own and stream their own positions.
  private startGame(socketId: string): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (session.host !== player.id) return; // only the host starts the match
    if (session.phase === "in-game") return; // already started — idempotent

    session.phase = "in-game";
    session.worldInit = generateWorld(
      [...session.players.values()].map((p) => ({ id: p.id, slot: p.slot, name: p.name })),
    );
    this.broadcast(session, { type: "game/world-init", init: session.worldInit });

    // The world is now dynamic: arm the server-authoritative enemy sim and stream its deltas.
    session.sim = spawnEnemyState(session.worldInit);
    if (this.firstWaveMs !== undefined) session.sim.msUntilWave = this.firstWaveMs;
    const timer = setInterval(() => this.tick(session), this.tickMs);
    timer.unref?.();
    session.simTimer = timer;
  }

  // One enemy-sim tick: resolve the admitted attacks queued since the last tick and step the
  // sim against the squad's last-known positions (read-only), then broadcast what changed.
  // `moves` is always present; spawn/hit/death arrays ride only when non-empty.
  private tick(session: SessionRecord): void {
    if (!session.sim) return;
    const players = [...session.positions].map(([id, sample]) => ({ id, pos: sample.pos }));
    const attacks = session.pendingAttacks;
    session.pendingAttacks = [];
    const { events } = stepEnemies(session.sim, players, attacks, this.tickMs);
    const delta: MapDelta = { tick: ++session.tickNo, moves: events.moves };
    if (events.spawns.length > 0) delta.spawns = events.spawns;
    if (events.hits.length > 0) delta.hits = events.hits;
    if (events.deaths.length > 0) delta.deaths = events.deaths;
    if (events.wave) delta.wave = events.wave;
    this.broadcast(session, { type: "game/map-delta", ...delta });
  }

  // A reported attack: admit it (cadence + loose range + seq, all server-side) and queue the
  // valid ones for the next tick. The client never writes enemy HP — the sim resolves it.
  private gameAttack(socketId: string, weapon: Weapon, pos: Vec2, dir: Vec2, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!session.sim) return; // no combat before the match starts
    let guard = session.attackGuards.get(player.id);
    if (!guard) {
      guard = freshGuard();
      session.attackGuards.set(player.id, guard);
    }
    const lastPos = session.positions.get(player.id)?.pos ?? null;
    if (admitAttack(guard, { weapon, pos, seq }, lastPos, Date.now())) {
      session.pendingAttacks.push({ weapon, pos, dir });
    }
  }

  // Relay a client's own position to the rest of the squad, dropping a stale/out-of-order
  // frame by its per-player seq and retaining the newest as the reconnect source-of-truth.
  private gamePos(socketId: string, pos: Vec2, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!session.worldInit) return; // positions before the match starts are meaningless
    const last = session.positions.get(player.id);
    if (last && seq <= last.seq) return; // stale or duplicate — drop it
    session.positions.set(player.id, { pos, seq });
    this.broadcast(session, { type: "game/peer-pos", id: player.id, pos, seq }, socketId);
  }

  // Hand one socket the immutable world plus a burst of every player's last-known position,
  // so a (re)joining client rebuilds the world locally and lands where the squad is.
  private sendWorldState(session: SessionRecord, socketId: string): void {
    if (!session.worldInit) return;
    this.transport.send(socketId, { type: "game/world-init", init: session.worldInit });
    for (const [id, sample] of session.positions) {
      this.transport.send(socketId, {
        type: "game/peer-pos",
        id,
        pos: sample.pos,
        seq: sample.seq,
      });
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
    session.positions.delete(player.id);
    session.attackGuards.delete(player.id);
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
      if (session.simTimer) clearInterval(session.simTimer); // stop the enemy tick before teardown
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
