import {
  admitBuild,
  admitDemolish,
  admitMine,
  type BuildGuard,
  type BuildState,
  creditMetal,
  type DemolishGuard,
  demolishStructure,
  drainForge,
  enqueueForge,
  freshBuildGuard,
  freshBuildState,
  freshDemolishGuard,
  freshMineGuard,
  generateOre,
  type MineGuard,
  type OreGrid,
  placeStructure,
  snapshotAims,
  snapshotStructures,
  spendBullet,
  stepBuild,
} from "../game/build";
import {
  type Attack,
  type AttackGuard,
  admitAttack,
  type EnemyState,
  freshGuard,
  type PlayerRef,
  snapshotEnemies,
  spawnEnemyState,
  stepEnemies,
} from "../game/enemies";
import { generateWorld, insideExit, PLAYER_MAX_HP, revealsExit } from "../game/world";
import { generateCode, normalizeCode } from "./code";
import {
  type BuildableKind,
  type Exit,
  type GameEnemyInit,
  type LobbyCode,
  type LobbyErrorCode,
  type LobbySnapshot,
  MAX_PLAYERS,
  type MapDelta,
  type MatchOutcome,
  NAME_MAX,
  type Phase,
  type PlayerId,
  type PlayerToken,
  type Power,
  type Presence,
  type PublicPlayer,
  parseClientMessage,
  type ServerMessage,
  type StructureSpawn,
  type Tile,
  type Vec2,
  type WorldInit,
} from "./protocol";

// The only thing the domain needs from the outside world: address a socket by id to
// push a message or hang it up. The Bun adapter (server.ts) implements this over real
// sockets; tests implement it over a capture buffer.
export interface Transport {
  send(socketId: string, msg: ServerMessage): void;
  close(socketId: string, code: number, reason?: string): void;
}

// A cancellable repeating job. Returned by `Scheduler.every`, and the only handle the hub keeps
// on its tick — so what drives the tick and how it is stopped travel together.
export interface Cancellable {
  cancel(): void;
}

// The interval driver behind the enemy tick. A real match uses the platform timer; a test can
// pass a manual one and step the sim itself, so a tick assertion never races the CPU it runs on.
export interface Scheduler {
  every(periodMs: number, fn: () => void): Cancellable;
}

const platformScheduler: Scheduler = {
  every(periodMs, fn) {
    const timer = setInterval(fn, periodMs);
    timer.unref?.(); // a lingering tick must never hold the process open
    return { cancel: () => clearInterval(timer) };
  },
};

export interface LobbyConfig {
  graceMs?: number; // slot held + greyed this long after a drop; default 45s
  tickMs?: number; // enemy-sim tick period; default 50ms (~20 Hz). Overridable for fast tests.
  // Drives the enemy tick. Defaults to the platform timer. A test asserting on tick *output*
  // should pass a manual one — sleeping on a real interval races whatever else the CPU is
  // doing, and reds under load. Test knob.
  scheduler?: Scheduler;
  firstWaveMs?: number; // override the initial wave countdown (default: the sim's 30s). Test knob.
  startingMetal?: number; // seed the shared bank at match start (default 0). Test knob.
  // Seed the squad's bullets at match start (default 0 — a real squad forges every one it fires).
  // A combat test that is about the weapon rather than the economy takes its ammo from here rather
  // than spending a virtual second at the forge for each shot. Test knob.
  startingAmmo?: number;
  // The sim's only source of entropy — spawn jitter. Defaults to `Math.random`, so a real match
  // scatters each wave differently. A test that asserts on anything downstream of a spawn position
  // should pass a fixed one, or the assertion is against a different world every run. Test knob.
  rng?: () => number;
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
  phase: Phase;
  host: PlayerId;
  rev: number;
  players: Map<PlayerId, PlayerRecord>;
  graceTimers: Map<PlayerId, ReturnType<typeof setTimeout>>;
  worldInit?: WorldInit; // generated once at start; re-sent verbatim on reconnect
  positions: Map<PlayerId, { pos: Vec2; seq: number }>; // last-known relayed position per player
  health: Map<PlayerId, { hp: number; seq: number }>; // last-reported HP per player (aggro-gating + fan-out)
  sim?: EnemyState; // server-authoritative enemy simulation, live only in-game
  simTimer?: Cancellable; // the 20 Hz tick driving `sim`; cancelled on teardown
  tickNo: number; // monotonic map-delta tick counter (apply-if-newer on clients)
  attackGuards: Map<PlayerId, AttackGuard>; // per-player cadence/seq admission state
  pendingAttacks: Attack[]; // admitted attacks awaiting the next tick's resolution
  ore?: OreGrid; // derived from worldInit.oreSeed at start; identical to every client's copy
  build?: BuildState; // the squad's economy — bank and buildings, written only by this hub
  sentMetal: number; // the last whole-Metal figure broadcast; the bank rides only when it moves
  sentAmmo: number; // the last bullet count broadcast; ammo rides on the same terms as the bank
  sentQueued: number; // the last queue depth broadcast; likewise sparse, never a per-tick field
  sentPower: Power; // the last power figures broadcast; power rides only when they move
  pendingBuilds: StructureSpawn[]; // placements admitted since the last tick, awaiting broadcast
  mineGuards: Map<PlayerId, MineGuard>; // per-player hand-mine cadence/seq/accrual state
  buildGuards: Map<PlayerId, BuildGuard>; // per-player placement cadence/seq state
  demolishGuards: Map<PlayerId, DemolishGuard>; // per-player demolish cadence/seq state
  pendingRemovals: string[]; // demolished ids awaiting broadcast, merged with the sim's own
  exitRevealed: boolean; // latched the tick anyone first came within EXIT_REVEAL_RADIUS of the door
  startedAt?: number; // wall clock at game/start; elapsed time from it is the match's score
  result?: { outcome: MatchOutcome; elapsedMs: number }; // set once, at match end; re-sent on rejoin
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
  private readonly scheduler: Scheduler;
  private readonly startingMetal: number;
  private readonly startingAmmo: number;
  private readonly rng?: () => number;
  private disposed = false;

  constructor(
    private readonly transport: Transport,
    config: LobbyConfig = {},
  ) {
    this.graceMs = config.graceMs ?? DEFAULT_GRACE_MS;
    this.tickMs = config.tickMs ?? DEFAULT_TICK_MS;
    this.firstWaveMs = config.firstWaveMs;
    this.scheduler = config.scheduler ?? platformScheduler;
    this.startingMetal = config.startingMetal ?? 0;
    this.startingAmmo = config.startingAmmo ?? 0;
    this.rng = config.rng;
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
        this.gameAttack(socketId, msg.pos, msg.dir, msg.seq);
        return;
      case "game/health":
        this.gameHealth(socketId, msg.hp, msg.seq);
        return;
      case "game/mine":
        this.gameMine(socketId, msg.tile, msg.seq);
        return;
      case "game/build":
        this.gameBuild(socketId, msg.kind, msg.tile, msg.seq);
        return;
      case "game/demolish":
        this.gameDemolish(socketId, msg.id, msg.seq);
        return;
      case "game/forge":
        this.gameForge(socketId);
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

    // The badge cannot sit on an absent player. Starting the match is gated on `session.host`,
    // so a host held through the grace window is a lobby nobody can start — for 45s, on the
    // most ordinary way to leave a lobby: closing the tab.
    if (session.host === player.id) this.reassignHost(session);
  }

  // Clear all pending timers so a stopped server leaves nothing running.
  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values()) {
      for (const timer of session.graceTimers.values()) clearTimeout(timer);
      session.graceTimers.clear();
      session.simTimer?.cancel(); // stop the enemy tick
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
      health: new Map(),
      tickNo: 0,
      attackGuards: new Map(),
      pendingAttacks: [],
      sentMetal: 0,
      sentAmmo: 0,
      sentQueued: 0,
      sentPower: { generation: 0, consumption: 0 },
      pendingBuilds: [],
      mineGuards: new Map(),
      buildGuards: new Map(),
      demolishGuards: new Map(),
      pendingRemovals: [],
      exitRevealed: false,
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
    if (session.phase !== "lobby") return; // already started, or already over

    session.phase = "in-game";
    session.startedAt = Date.now(); // the stopwatch: elapsed time from here is the score
    session.worldInit = generateWorld(
      [...session.players.values()].map((p) => ({ id: p.id, slot: p.slot, name: p.name })),
    );
    this.broadcast(session, { type: "game/world-init", init: session.worldInit });

    // The ore never rides the wire — the server expands the same seed every client does, so
    // its admission checks read a grid byte-identical to the one under the player's cursor.
    session.ore = generateOre(session.worldInit.arena, session.worldInit.oreSeed);
    session.build = freshBuildState(session.worldInit.arena);
    // Seeded through the same door every other Metal comes in by, so the bank is whole because of
    // how it is written rather than because every caller happened to pass a round number.
    creditMetal(session.build, this.startingMetal);
    session.sentMetal = session.build.bank.metal;
    session.build.ammo.bullets = this.startingAmmo;
    session.sentAmmo = session.build.ammo.bullets;
    // Deliberately kept though it is provably `0 = 0` today — `freshBuildState` ran two lines up
    // and there is no `startingQueued` knob for the queue the way there is for the pool. It reads
    // the truth off the state rather than assuming it, so the mirror cannot desync if one appears.
    session.sentQueued = session.build.ammo.queued;

    // The world is now dynamic: arm the server-authoritative enemy sim and stream its deltas.
    session.sim = spawnEnemyState(session.worldInit, this.rng);
    if (this.firstWaveMs !== undefined) session.sim.msUntilWave = this.firstWaveMs;
    session.simTimer = this.scheduler.every(this.tickMs, () => this.tick(session));
  }

  // Is this session mid-match? Every in-game command is gated on it, so a frame still in flight
  // when the match ends cannot mutate a world nobody is simulating any more.
  private inPlay(session: SessionRecord): boolean {
    return session.phase === "in-game" && session.sim !== undefined;
  }

  // One enemy-sim tick: resolve the admitted attacks queued since the last tick and step the
  // sim against the squad's last-known positions (read-only), then broadcast what changed.
  // `moves` is always present; spawn/hit/death arrays ride only when non-empty.
  private tick(session: SessionRecord): void {
    if (!session.sim) return;
    // Dead and disconnected players both drop from aggro; only the present and living are chased.
    const players = livePlayers(session.positions, session.health, connectedIds(session));
    const attacks = session.pendingAttacks;
    session.pendingAttacks = [];
    // The economy settles first: miners trickle and the energy ceiling is recomputed before the
    // turrets inside `stepEnemies` draw against it, so the budget is never a tick stale.
    if (session.build) stepBuild(session.build, this.tickMs);
    const { events } = stepEnemies(
      session.sim,
      players,
      attacks,
      this.tickMs,
      session.build ?? null,
    );
    const delta: MapDelta = { tick: ++session.tickNo, moves: events.moves };
    if (events.spawns.length > 0) delta.spawns = events.spawns;
    if (events.hits.length > 0) delta.hits = events.hits;
    if (events.deaths.length > 0) delta.deaths = events.deaths;
    if (events.nests.length > 0) delta.nests = events.nests;
    if (events.structHits.length > 0) delta.structHits = events.structHits;
    if (events.aims.length > 0) delta.aims = events.aims;
    if (events.shots.length > 0) delta.shots = events.shots;
    const removals = [...events.removals, ...session.pendingRemovals];
    session.pendingRemovals = [];
    if (removals.length > 0) delta.removals = removals;
    if (events.wave) delta.wave = events.wave;
    if (session.build) {
      // The bank is whole Metal, and the remainder never leaves the server, so it rides only when
      // the figure actually moves — a sparse event, not a per-tick field.
      const metal = session.build.bank.metal;
      if (metal !== session.sentMetal) {
        session.sentMetal = metal;
        delta.bank = { metal };
      }
      // Same terms as the bank: a count that only moves when a bullet is forged or fired, so it
      // stays off the settled tick entirely.
      const bullets = session.build.ammo.bullets;
      if (bullets !== session.sentAmmo) {
        session.sentAmmo = bullets;
        delta.ammo = bullets;
      }
      // The queue's depth, on the same terms again. `forgeMs` beside it deliberately never rides:
      // it moves every tick, which would cost the settled tick a field to say nothing new.
      const queued = session.build.ammo.queued;
      if (queued !== session.sentQueued) {
        session.sentQueued = queued;
        delta.queued = queued;
      }
      const power = session.build.power;
      if (
        power.generation !== session.sentPower.generation ||
        power.consumption !== session.sentPower.consumption
      ) {
        session.sentPower = { ...power };
        delta.power = { ...power };
      }
    }
    if (session.pendingBuilds.length > 0) {
      delta.builds = session.pendingBuilds;
      session.pendingBuilds = [];
    }
    // Finding the door is a discovery, not a condition: it is only looked for while it is still
    // hidden, and setting the latch and putting it on the wire are the same statement — which is
    // what makes it ride exactly one tick of a match and never a second. Once latched, no position
    // is read for it again, so the finder may then die, drop, or leave the session entirely.
    if (session.worldInit && !session.exitRevealed && exitFound(session, session.worldInit.exit)) {
      session.exitRevealed = true;
      delta.exitRevealed = true;
    }
    this.broadcast(session, { type: "game/map-delta", ...delta });

    if (session.worldInit && squadEscaped(session, session.worldInit.exit)) {
      this.endMatch(session, "escaped");
    } else if (squadWiped(session)) {
      this.endMatch(session, "wiped");
    }
  }

  // End the match once and tear the tick down. The phase guard is what makes it exactly once:
  // the escape predicate is evaluated every tick, and the tick that fires it is the last one.
  private endMatch(session: SessionRecord, outcome: MatchOutcome): void {
    if (session.phase !== "in-game") return;
    session.phase = outcome;
    session.simTimer?.cancel();
    session.simTimer = undefined;
    // The forge stops with the match and hands back nothing: the Metal for everything still in the
    // queue was spent when it was ordered, and there has never been a path that returns it.
    if (session.build) drainForge(session.build.ammo);
    // Retained, not recomputed: the score is frozen at the moment the match ended, so a player
    // who rejoins afterwards is told the same time everyone else saw.
    session.result = { outcome, elapsedMs: Date.now() - (session.startedAt ?? Date.now()) };
    this.broadcast(session, { type: "game/match-end", ...session.result });
  }

  // A reported attack: admit it (cadence + loose range + seq, all server-side) and queue the
  // valid ones for the next tick. The client never writes enemy HP — the sim resolves it.
  private gameAttack(socketId: string, pos: Vec2, dir: Vec2, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session)) return; // no combat before the match starts or after it ends
    // A corpse does not shoot. Nothing else was checking: a dead player has not moved, so
    // `admitAttack`'s anti-teleport position check passes and the shot would be applied and
    // drawn. The client gates this too, but the client is a courtesy and this is the rule (#85).
    if (!isAlive(session, player.id)) return;
    let guard = session.attackGuards.get(player.id);
    if (!guard) {
      guard = freshGuard();
      session.attackGuards.set(player.id, guard);
    }
    const lastPos = session.positions.get(player.id)?.pos ?? null;
    // Nothing is broadcast here. The line that depicts this shot is emitted a tick later by the
    // sim, beside the HP it writes — so a refused attack has no path to the wire at all (#74 §4).
    // The aim that rides on is the normalized one admission returned, never the reported vector.
    const aim = admitAttack(guard, { pos, dir, seq }, lastPos, Date.now());
    if (!aim) return;
    // A shot costs a bullet from the squad's pool (#102). Taken after admission, so a shot the
    // cadence already refused never spends one — and a shot refused here reaches neither
    // `pendingAttacks` nor the sim, which is what keeps it off the wire entirely.
    if (!session.build || !spendBullet(session.build.ammo)) return;
    session.pendingAttacks.push({ pos, dir: aim, by: player.id });
  }

  // An order for a bullet: charge the shared bank now and queue the forging. Deliberately no seq
  // and no cadence — the request carries no state that could arrive stale, and two of them are two
  // bullets, which is a thing a player is allowed to want. Nothing records who ordered it, so the
  // queue is the squad's and keeps running through that player's death and disconnect.
  private gameForge(socketId: string): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session) || !session.build) return; // only during a match
    enqueueForge(session.build);
  }

  // A reported hand-mine: admit it (ore kind + loose reach + seq + cadence) and credit the
  // shared bank here. The bank is server-owned — a client only ever asks.
  private gameMine(socketId: string, tile: Tile, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session) || !session.ore || !session.build) return; // only during a match
    let guard = session.mineGuards.get(player.id);
    if (!guard) {
      guard = freshMineGuard();
      session.mineGuards.set(player.id, guard);
    }
    const lastPos = session.positions.get(player.id)?.pos ?? null;
    const earned = admitMine(guard, { tile, seq }, lastPos, session.ore, Date.now());
    creditMetal(session.build, earned);
  }

  // A reported placement: re-run the same rule the client's ghost used, then debit the bank and
  // mint the structure here. The client proposes; the server places.
  private gameBuild(socketId: string, kind: BuildableKind, tile: Tile, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session) || !session.ore || !session.build) return; // only during a match
    let guard = session.buildGuards.get(player.id);
    if (!guard) {
      guard = freshBuildGuard();
      session.buildGuards.set(player.id, guard);
    }
    const lastPos = session.positions.get(player.id)?.pos ?? null;
    const spec = admitBuild(
      guard,
      { kind, tile, seq },
      lastPos,
      session.ore,
      session.build,
      Date.now(),
    );
    if (!spec) return;
    const placed = placeStructure(session.build, kind, tile, spec);
    session.pendingBuilds.push({
      id: placed.id,
      kind: placed.kind,
      tile: placed.tile,
      hp: placed.hp,
    });
  }

  // A reported demolish. Communal by design — no ownership check — and the refund is credited
  // here, so the client never writes the bank.
  private gameDemolish(socketId: string, id: string, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session) || !session.build) return; // only during a match
    let guard = session.demolishGuards.get(player.id);
    if (!guard) {
      guard = freshDemolishGuard();
      session.demolishGuards.set(player.id, guard);
    }
    const lastPos = session.positions.get(player.id)?.pos ?? null;
    const structure = admitDemolish(guard, { id, seq }, lastPos, session.build, Date.now());
    if (!structure) return;
    demolishStructure(session.build, structure);
    session.pendingRemovals.push(structure.id);
  }

  // Store and relay a client's reported HP (it owns its health; the server never computes it),
  // dropping a stale/out-of-order frame by its per-player seq. Retained for aggro-gating and
  // the reconnect burst.
  private gameHealth(socketId: string, hp: number, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session)) return; // health outside a live match is meaningless
    const last = session.health.get(player.id);
    if (last && seq <= last.seq) return; // stale or duplicate — drop it
    // HP is client-authoritative, but clamp the untrusted value so a stray report can't poison
    // aggro-gating (livePlayers) or a peer's rendered HP bar.
    const clamped = Math.max(0, Math.min(PLAYER_MAX_HP, hp));
    session.health.set(player.id, { hp: clamped, seq });
    this.broadcast(
      session,
      { type: "game/peer-health", id: player.id, hp: clamped, seq },
      socketId,
    );
  }

  // Relay a client's own position to the rest of the squad, dropping a stale/out-of-order
  // frame by its per-player seq and retaining the newest as the reconnect source-of-truth.
  private gamePos(socketId: string, pos: Vec2, seq: number): void {
    const bind = this.sockets.get(socketId);
    if (!bind) return;
    const session = this.sessions.get(bind.code);
    const player = session?.players.get(bind.playerId);
    if (!session || !player || player.socketId !== socketId) return;
    if (!this.inPlay(session) || !session.worldInit) return; // only during a match
    const last = session.positions.get(player.id);
    if (last && seq <= last.seq) return; // stale or duplicate — drop it
    session.positions.set(player.id, { pos, seq });
    this.broadcast(session, { type: "game/peer-pos", id: player.id, pos, seq }, socketId);
  }

  // Hand one socket the immutable world plus a burst that brings it fully current: every player's
  // last-known position, the live enemy/nest/wave keyframe (world-init is immutable and can't
  // rebuild a world whose enemies moved/died/spawned), and every player's last HP — including the
  // reconnecter's own, so their client restores it.
  private sendWorldState(session: SessionRecord, socketId: string): void {
    if (!session.worldInit) return;
    // A finished match has no live world to rebuild — hand back the result, or a reconnecter
    // would land in a box whose sim stopped ticking with no way to reach the end screen.
    if (session.result) {
      this.transport.send(socketId, { type: "game/match-end", ...session.result });
      return;
    }
    this.transport.send(socketId, { type: "game/world-init", init: session.worldInit });
    for (const [id, sample] of session.positions) {
      this.transport.send(socketId, {
        type: "game/peer-pos",
        id,
        pos: sample.pos,
        seq: sample.seq,
      });
    }
    if (session.sim) {
      const snap = snapshotEnemies(session.sim);
      const keyframe: GameEnemyInit = { type: "game/enemy-init", tick: session.tickNo, ...snap };
      // The delta that announced the door rode one tick, possibly before this socket existed. The
      // keyframe is the only other place it can be told, so a reconnecter is not the one player in
      // a squad that has found the door who cannot see it.
      if (session.exitRevealed) keyframe.exitRevealed = true;
      this.transport.send(socketId, keyframe);
    }
    if (session.build) {
      // The economy keyframe. Ore is derived from the seed, so only the bank and the placed
      // buildings need rebuilding — bounded by what the squad owns, not by how long it has played.
      // Sent after `game/enemy-init` deliberately: its aims name enemy ids, so this order is what
      // makes the keyframe self-consistent on arrival. Nothing breaks if it is not — the client
      // resolves those ids lazily, at draw time — so this is a kept invariant, not a dependency.
      this.transport.send(socketId, {
        type: "game/build-init",
        tick: session.tickNo,
        bank: { metal: session.build.bank.metal },
        ammo: session.build.ammo.bullets,
        queued: session.build.ammo.queued,
        power: { ...session.build.power },
        structures: snapshotStructures(session.build),
        aims: snapshotAims(session.build),
      });
    }
    for (const [id, sample] of session.health) {
      this.transport.send(socketId, {
        type: "game/peer-health",
        id,
        hp: sample.hp,
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
    session.health.delete(player.id);
    session.attackGuards.delete(player.id);
    session.mineGuards.delete(player.id);
    session.buildGuards.delete(player.id);
    session.demolishGuards.delete(player.id);
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
      session.simTimer?.cancel(); // stop the enemy tick before teardown
      this.sessions.delete(session.code);
      return;
    }

    if (session.host === player.id) this.reassignHost(session);
  }

  // Hand the badge to the lowest connected slot and tell the squad. A no-op when the current
  // host is still the best candidate — a solo player keeps it through their own grace window,
  // so reconnecting alone resumes a lobby rather than finding it hostless.
  private reassignHost(session: SessionRecord): void {
    const next = this.nextHost(session);
    if (next.id === session.host) return;
    session.host = next.id;
    this.broadcast(session, {
      type: "lobby/host-changed",
      host: session.host,
      rev: ++session.rev,
    });
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

// Has the whole squad escaped? A simultaneity check, not a per-player check-in: every connected
// player must be alive AND standing in the door in this same instant.
//
// A downed player blocks it — they have to respawn and walk back, which is what "no one left
// behind" means. A disconnected (in-grace) player does not block: the squad cannot be held
// hostage by someone else's dropped socket.
function squadEscaped(session: SessionRecord, exit: Exit): boolean {
  const squad = connectedPlayers(session);
  if (squad.length === 0) return false; // an empty box escapes nothing
  return squad.every((p) => {
    if (!isAlive(session, p.id)) return false;
    const pos = session.positions.get(p.id)?.pos;
    return pos !== undefined && insideExit(pos, exit);
  });
}

// Has the squad been wiped? Every connected player dead at the same instant, evaluated on the
// same tick as the escape and against the same notion of alive.
//
// No grace period and no last-stand timer: a player counting down to respawn reported 0 HP when
// they died and has not reported otherwise, so they are dead for this purpose. An in-grace player
// is not connected, so they cannot keep the match alive either — but a session with nobody
// connected at all is simply paused, not lost.
function squadWiped(session: SessionRecord): boolean {
  const squad = connectedPlayers(session);
  return squad.length > 0 && squad.every((p) => !isAlive(session, p.id));
}

// Has anyone found the door? Any player's last-known position within `EXIT_REVEAL_RADIUS` of it.
//
// Deliberately unfiltered, where `squadEscaped` reads only the connected: that is a simultaneity
// check about who is standing in the door right now, and this is a fact about the match. Someone
// who walked up to the door and dropped a moment later still found it, and their held position is
// the only record of it — refusing to read it would lose a discovery that genuinely happened.
function exitFound(session: SessionRecord, exit: Exit): boolean {
  return [...session.positions.values()].some((sample) => revealsExit(sample.pos, exit));
}

function connectedPlayers(session: SessionRecord): PlayerRecord[] {
  return [...session.players.values()].filter((p) => p.presence.status === "connected");
}

function connectedIds(session: SessionRecord): ReadonlySet<PlayerId> {
  return new Set(connectedPlayers(session).map((p) => p.id));
}

// A player who has never reported HP counts as alive, so a fresh match never reads as a wipe.
function isAlive(session: SessionRecord, id: PlayerId): boolean {
  return (session.health.get(id)?.hp ?? PLAYER_MAX_HP) > 0;
}

// The players fed to the enemy sim: everyone present, with a known position, minus the dead. A
// player who has never reported HP defaults to alive; one at 0 HP is dropped so enemies stop
// chasing a corpse.
//
// `connected` is the gate that keeps a disconnected player out. Their position deliberately
// survives the whole grace window — peers hold it as a stand-in and the reconnect burst replays
// it — but it is a stale sample, not a body, and an enemy chasing it is chasing nobody. Dropping
// them here also breaks any existing lock, because `resolveTarget` cannot find a player who is
// not in this list.
export function livePlayers(
  positions: Map<PlayerId, { pos: Vec2; seq: number }>,
  health: Map<PlayerId, { hp: number; seq: number }>,
  connected: ReadonlySet<PlayerId>,
): PlayerRef[] {
  const alive: PlayerRef[] = [];
  for (const [id, sample] of positions) {
    if (!connected.has(id)) continue;
    if ((health.get(id)?.hp ?? PLAYER_MAX_HP) > 0) alive.push({ id, pos: sample.pos });
  }
  return alive;
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
