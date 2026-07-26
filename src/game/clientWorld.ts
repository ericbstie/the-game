import type {
  Arena,
  Avatar,
  Bank,
  EnemyKind,
  EnemySnapshot,
  Exit,
  MapDelta,
  MoveInput,
  NestSnapshot,
  PeerShot,
  PlayerId,
  Power,
  RenderedEnemy,
  RenderedNest,
  StructureSpawn,
  TurretAim,
  Vec2,
  WorldInit,
  WorldSnapshot,
} from "../lobby/protocol";
import {
  type BuildState,
  freshBuildState,
  generateOre,
  insertStructure,
  type OreGrid,
  removeStructure,
  slidePos,
} from "./build";
import {
  enemyContactCadenceMs,
  enemyContactDamage,
  enemyRadius,
  NEST_RADIUS,
  type Nest,
  nestLayout,
} from "./enemies";
import { freshGait, type Gait, updateFacing } from "./facing";
import { interpolateAt, type PosSample } from "./interpolate";
import { type Body, PLAYER_MAX_HP, PLAYER_RADIUS, pushOutOfBodies, stepPos } from "./world";

// The client's local view of the shared world (Milestone 2 refinement). Built once from
// `game/world-init`, then driven two ways:
//   - The owner's Avatar is integrated locally every frame (`stepSelf`) — instant, never
//     buffered, so input has zero network lag.
//   - Every peer's Avatar is rendered from a short buffer of relayed samples, RENDER_DELAY_MS
//     behind real time (`applyPeer` + `snapshot(now)`), so ~20 Hz updates read as smooth
//     motion instead of a staircase.
// The server no longer simulates avatars — this is where motion lives on the receiving end.

export const RENDER_DELAY_MS = 100; // render peers this far behind real time to smooth the relay
export const BUFFER_MS = 500; // keep this much peer history; older samples are pruned
// How long a squadmate's shot is kept before it is pruned. A memory bound, not the line's
// lifetime — the render layer owns that (#74 §5) and passes it to `peerShots`, which is what stops
// anything drawing for the full window. Must stay clear of any lifetime a caller might ask for.
export const SHOT_RETENTION_MS = 250;
export const ENEMY_RENDER_DELAY_MS = 50; // enemies render this far behind their 20 Hz stream
// Dead this long, then the client snaps back to center. With a stopwatch for a score and a base
// to defend, the long walk back from centre is the penalty — at 3 s (M3) dying was free.
export const RESPAWN_DELAY_MS = 20_000;

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2; // the owner's live local position, or a peer's spawn fallback before any sample
  buffer: PosSample[]; // a peer's arrival-stamped samples (empty for the owner)
  lastSeq: number; // highest applied seq; guards apply-if-newer
  hp: number; // a peer's last relayed HP (render hint); the owner's HP lives in `selfHp`
  healthSeq: number; // highest applied peer-health seq; guards apply-if-newer
  gait: Gait; // 8-way facing + walk frame, derived here from the rendered position
}

// A server-owned enemy the client renders. Its position is buffered and interpolated exactly
// like a peer; kind and hp arrive once via a spawn and update via events. `lastContactAt` is
// the client-local time this enemy last dealt the owner contact damage (per-enemy cadence).
interface EnemyRecord {
  id: string;
  kind: EnemyKind;
  hp: number;
  pos: Vec2; // spawn fallback until the first move sample buffers
  buffer: PosSample[];
  lastContactAt: number;
  gait: Gait; // dies with the record, so 240 enemies a wave cost nothing to track
}

// A squadmate's shot as the client holds it: the wire event plus the client-clock instant it
// landed. How long the line then stays up is the render layer's call — no duration ever rides the
// wire and the server holds no line state.
export interface ShotEvent {
  shot: PeerShot;
  at: number;
}

export class ClientWorld {
  readonly arena: Arena;
  readonly ore: OreGrid; // derived from the world's seed, byte-identical to the server's copy
  private readonly exit: Exit;
  private readonly nests: Nest[]; // static layout derived from the arena; hp/alive track the stream
  private readonly avatars = new Map<PlayerId, AvatarRecord>();
  private readonly enemies = new Map<string, EnemyRecord>();
  private readonly shots: ShotEvent[] = []; // squadmates' shots; the render layer ages them itself
  readonly build: BuildState; // server-owned; mirrored here so the ghost tests placement locally
  private lastTick = -1; // highest applied map-delta tick; guards apply-if-newer
  private selfHp: number; // client-authoritative: the owner judges its own contact damage

  // `initialHp` carries the owner's HP across a reconnect rebuild (a fresh world defaults to full).
  // Without it, a mid-match reconnect would reset to full and the report loop could relay that heal
  // before the server's peer-health burst reseeds the real value.
  constructor(
    init: WorldInit,
    private readonly selfId: PlayerId,
    initialHp: number = PLAYER_MAX_HP,
  ) {
    this.selfHp = initialHp;
    this.arena = init.arena;
    this.exit = init.exit;
    this.nests = nestLayout(init.arena);
    this.ore = generateOre(init.arena, init.oreSeed);
    this.build = freshBuildState(init.arena);
    for (const s of init.spawns) {
      this.avatars.set(s.id, {
        id: s.id,
        slot: s.slot,
        name: s.name,
        pos: { ...s.pos },
        buffer: [],
        lastSeq: -1,
        hp: PLAYER_MAX_HP,
        healthSeq: -1,
        gait: freshGait(s.id, s.pos),
      });
    }
  }

  // Advance only the owner's Avatar — peers never move from local input. Three stages, in order:
  // integrate the held input, clamp against structures (`slidePos` resolves the axes separately,
  // so you slide along a wall instead of sticking and a corner is never a hard trap), then get
  // shoved out of any enemy you pressed into.
  //
  // Enemy collision resolves here, on the owner's avatar against the *rendered* enemy stream —
  // the same client-authoritative stance M3 takes for contact damage ("if it touched me on my
  // screen, it hit me"), so the server needs no player-blocking step. Peers are deliberately
  // excluded: they render ~100 ms behind, so blocking against them would be contested.
  stepSelf(dtMs: number, input: MoveInput, now: number): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    const stepped = stepPos(self.pos, input, dtMs, this.arena);
    const slid = slidePos(this.build, self.pos, stepped, PLAYER_RADIUS);
    const pushed = pushOutOfBodies(slid, PLAYER_RADIUS, this.enemyBodies(now), this.arena);
    // Re-clamp: a shove must not push you through a wall you were standing against.
    self.pos = slidePos(this.build, slid, pushed, PLAYER_RADIUS);
  }

  // Every enemy as the owner currently sees it — the interpolated stream, not the raw samples.
  private enemyBodies(now: number): Body[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return [...this.enemies.values()].map((e) => ({
      pos: interpolateAt(e.buffer, renderTime) ?? e.pos,
      radius: enemyRadius(e.kind),
    }));
  }

  // Apply a relayed position, dropping a stale/duplicate frame by its per-peer seq. The
  // owner's own frames (only ever a reconnect burst) seed its live position instantly; a
  // peer's frames are buffered by arrival time for interpolation. Unknown ids are ignored —
  // M2 supports reconnect, not a brand-new mid-match joiner.
  applyPeer(id: PlayerId, pos: Vec2, seq: number, arrivalMs: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar || seq <= avatar.lastSeq) return;
    avatar.lastSeq = seq;
    if (id === this.selfId) {
      avatar.pos = { x: pos.x, y: pos.y };
      return;
    }
    this.pushSample(avatar.buffer, pos, arrivalMs);
  }

  // Apply a relayed HP, dropping a stale/duplicate frame by its per-peer seq. A peer's HP is a
  // render hint (a corpse draws distinctly); the owner's own frame (a reconnect burst) reseeds
  // its authoritative local HP.
  applyPeerHealth(id: PlayerId, hp: number, seq: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar || seq <= avatar.healthSeq) return;
    avatar.healthSeq = seq;
    avatar.hp = hp;
    if (id === this.selfId) this.selfHp = hp;
  }

  // Advance the owner's health one frame: any enemy in contact with the owner's TRUE position
  // (checked against the enemy's rendered position) deals its contact damage on its own cadence.
  // "If it touched me on my screen, it hit me." A dead owner takes no further damage.
  updateHealth(now: number): void {
    if (this.selfHp <= 0) return;
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    for (const enemy of this.enemies.values()) {
      const pos = interpolateAt(enemy.buffer, renderTime) ?? enemy.pos;
      const touching =
        Math.hypot(pos.x - self.pos.x, pos.y - self.pos.y) <=
        PLAYER_RADIUS + enemyRadius(enemy.kind);
      if (!touching) continue;
      if (now - enemy.lastContactAt >= enemyContactCadenceMs(enemy.kind)) {
        this.selfHp = Math.max(0, this.selfHp - enemyContactDamage(enemy.kind));
        enemy.lastContactAt = now;
      }
    }
  }

  hp(): number {
    return this.selfHp;
  }

  isDead(): boolean {
    return this.selfHp <= 0;
  }

  // Respawn the owner: snap back to arena center at full HP. The caller resumes streaming and
  // reports the new HP. Center is safe (the front line holds far out), so no contact re-triggers.
  reviveSelf(): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    self.pos = { x: this.arena.width / 2, y: this.arena.height / 2 };
    this.selfHp = PLAYER_MAX_HP;
  }

  // Apply one enemy/combat tick, dropping a stale/out-of-order delta by its monotonic tick.
  // Spawns create a render record before their positions flow; moves buffer each enemy's
  // position for the same delayed interpolation peers use; deaths remove it. Mutates in place —
  // the render loop reads this every frame, so no React re-render at the ~20 Hz tick rate.
  applyMapDelta(delta: MapDelta, now: number): void {
    if (delta.tick <= this.lastTick) return;
    this.lastTick = delta.tick;
    for (const s of delta.spawns ?? []) {
      // A duplicate spawn must not reset the record, because the record now carries derived
      // facing state. That is only safe because `addEnemy` never recycles an id (`enemies.ts`
      // increments `nextId` for the life of the session) — if allocation ever stops being
      // monotonic, a repeat id is a different enemy and this guard has to reseed the gait.
      if (!this.enemies.has(s.id)) {
        this.enemies.set(s.id, {
          id: s.id,
          kind: s.kind,
          hp: s.hp,
          pos: { ...s.pos },
          buffer: [],
          lastContactAt: Number.NEGATIVE_INFINITY,
          gait: freshGait(s.id, s.pos),
        });
      }
    }
    for (const [id, x, y] of delta.moves) {
      const enemy = this.enemies.get(id);
      if (enemy) this.pushSample(enemy.buffer, { x, y }, now);
    }
    for (const hit of delta.hits ?? []) {
      const enemy = this.enemies.get(hit.id);
      if (enemy) enemy.hp = hit.hp;
    }
    for (const id of delta.deaths ?? []) this.enemies.delete(id);
    for (const nd of delta.nests ?? []) {
      const nest = this.nests.find((n) => n.id === nd.id);
      if (nest) {
        nest.hp = nd.hp;
        nest.alive = nd.alive;
      }
    }
    if (delta.bank) this.build.bank.metal = delta.bank.metal;
    if (delta.power) this.build.power = { ...delta.power };
    for (const b of delta.builds ?? []) {
      if (!this.build.structures.has(b.id)) insertStructure(this.build, { ...b });
    }
    for (const h of delta.structHits ?? []) {
      const structure = this.build.structures.get(h.id);
      if (structure) structure.hp = h.hp;
    }
    // After `builds`: a turret placed this tick can already be holding a target in the same delta.
    this.applyAims(delta.aims ?? []);
    for (const id of delta.removals ?? []) removeStructure(this.build, id);
    // The delta goes to the whole squad, shooter included, but an owner's line is drawn locally at
    // fire time from its own live position — buffering the round-trip too would double it, a tick
    // late and from the wrong origin.
    for (const shot of delta.shots ?? []) {
      if (shot.id !== this.selfId) this.shots.push({ shot, at: now });
    }
    // Pruned every tick rather than only on arrival, so a squad that stops firing does not leave
    // stale events sitting in the buffer.
    const cutoff = now - SHOT_RETENTION_MS;
    while (this.shots.length > 0 && this.shots[0].at < cutoff) this.shots.shift();
  }

  // Adopt streamed turret aims. Only turrets carry a runtime, and an id for a structure this
  // client has never seen is ignored — the same unknown-id guard `moves` already applies.
  private applyAims(aims: TurretAim[]): void {
    for (const [id, target, powered] of aims) {
      const turret = this.build.structures.get(id)?.turret;
      if (!turret) continue;
      turret.targetId = target;
      turret.powered = powered === 1;
    }
  }

  // Where a shot line ends, or null if it must not be drawn at all.
  //
  // This is the authority guard: a line may only depict damage the server applied, and a target id
  // outlives its target by one tick in two places — a turret still names the enemy it just killed
  // until it re-targets, and a killing `PeerShot` rides the same delta as the death it caused.
  // Resolving against live state closes both windows to zero, with nothing added to the wire.
  // Enemies resolve on the delayed interpolation they render on, so the line lands on the sprite.
  shotTargetPos(id: string, now: number): Vec2 | null {
    const enemy = this.enemies.get(id);
    if (enemy) return interpolateAt(enemy.buffer, now - ENEMY_RENDER_DELAY_MS) ?? { ...enemy.pos };
    const nest = this.nests.find((n) => n.id === id);
    return nest?.alive ? { ...nest.pos } : null;
  }

  // The squad's shots from the last `maxAgeMs`, oldest first.
  //
  // The caller passes its own line lifetime rather than reading the buffer whole, so a line can
  // never outlive it by borrowing the retention window — which is longer on purpose, and is a
  // memory bound rather than a statement about how long anything is drawn (#74 §5).
  peerShots(now: number, maxAgeMs: number): ShotEvent[] {
    const from = now - maxAgeMs;
    return this.shots.filter((s) => s.at >= from);
  }

  // Rebuild the economy from the reconnect keyframe: the bank and every building the squad has
  // standing. The ore grid needs nothing — it was derived from the seed when this world was built.
  initBuild(msg: {
    bank: Bank;
    power: Power;
    structures: StructureSpawn[];
    aims: TurretAim[];
  }): void {
    for (const id of [...this.build.structures.keys()]) removeStructure(this.build, id);
    for (const s of msg.structures) insertStructure(this.build, { ...s });
    this.build.bank.metal = msg.bank.metal;
    this.build.power = { ...msg.power };
    // Rebuilding a turret mints it un-aimed, so the keyframe's aims are what restore the lines and
    // the lightning a reconnecter would otherwise never be told about.
    this.applyAims(msg.aims);
  }

  // The shared Metal readout. The server sends whole Metal, so this needs no rounding of its own.
  metal(): number {
    return this.build.bank.metal;
  }

  // The live energy rate: what the grid can generate, and what is drawing against it.
  power(): Power {
    return this.build.power;
  }

  // Rebuild live enemy/nest state from the reconnect keyframe — world-init only carries the
  // initial static set, so a mid-match (re)joiner needs this to see enemies that moved/died/
  // spawned and nests that were silenced. Seeds `lastTick` so the first live delta isn't dropped.
  initEnemies(msg: { tick: number; enemies: EnemySnapshot[]; nests: NestSnapshot[] }): void {
    this.enemies.clear();
    for (const e of msg.enemies) {
      this.enemies.set(e.id, {
        id: e.id,
        kind: e.kind,
        hp: e.hp,
        pos: { ...e.pos },
        buffer: [],
        lastContactAt: Number.NEGATIVE_INFINITY,
        gait: freshGait(e.id, e.pos),
      });
    }
    for (const ns of msg.nests) {
      const nest = this.nests.find((n) => n.id === ns.id);
      if (nest) {
        nest.hp = ns.hp;
        nest.alive = ns.alive;
      }
    }
    this.lastTick = msg.tick;
  }

  removePeer(id: PlayerId): void {
    this.avatars.delete(id);
  }

  // Append an arrival-stamped sample and prune history older than the buffer window.
  private pushSample(buffer: PosSample[], pos: Vec2, t: number): void {
    buffer.push({ t, pos: { x: pos.x, y: pos.y } });
    const cutoff = t - BUFFER_MS;
    while (buffer.length > 1 && buffer[0].t < cutoff) buffer.shift();
  }

  selfPos(): Vec2 | null {
    const self = this.avatars.get(this.selfId);
    return self ? { ...self.pos } : null;
  }

  // Assemble the render model. The owner is drawn at its live position; peers are sampled
  // RENDER_DELAY_MS behind `now` from their buffers. Each entity's facing and walk frame are
  // advanced here, where its rendered position has just been computed — so this is a command as
  // much as a query. Calling it twice with the *same* `now` is a no-op; calling it twice with
  // different `now` in one frame splits the EMA step and biases the speed ~1% low. The render
  // loop is the single caller, once per frame; a second consumer wants `advance`/`snapshot`
  // split apart rather than caller discipline.
  snapshot(now: number): WorldSnapshot {
    return {
      arena: this.arena,
      players: [...this.avatars.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((a) => this.render(a, now)),
      enemies: this.renderEnemies(now),
      nests: this.nests.map(renderNest),
      exit: this.exit,
      ore: this.ore,
      structures: [...this.build.structures.values()],
    };
  }

  // The owner's facing is derived from its position like everyone else's, deliberately, and not
  // from its `MoveInput`: pressing into a wall would then read as movement here and as a held
  // facing on every other screen.
  private render(a: AvatarRecord, now: number): Avatar {
    const isSelf = a.id === this.selfId;
    const pos = isSelf ? a.pos : (interpolateAt(a.buffer, now - RENDER_DELAY_MS) ?? a.pos);
    const hp = isSelf ? this.selfHp : a.hp;
    updateFacing(a.gait, pos, now);
    return {
      id: a.id,
      slot: a.slot,
      name: a.name,
      pos: { ...pos },
      radius: PLAYER_RADIUS,
      hp,
      facing: a.gait.facing,
      frame: a.gait.frame,
    };
  }

  private renderEnemies(now: number): RenderedEnemy[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return [...this.enemies.values()].map((e) => {
      const pos = interpolateAt(e.buffer, renderTime) ?? { ...e.pos };
      updateFacing(e.gait, pos, now);
      return {
        id: e.id,
        kind: e.kind,
        hp: e.hp,
        radius: enemyRadius(e.kind),
        pos,
        facing: e.gait.facing,
        frame: e.gait.frame,
      };
    });
  }
}

function renderNest(n: Nest): RenderedNest {
  return {
    id: n.id,
    pos: { ...n.pos },
    radius: NEST_RADIUS,
    hp: n.hp,
    alive: n.alive,
    sector: n.sector,
  };
}
