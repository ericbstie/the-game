import type {
  Arena,
  Avatar,
  EnemyKind,
  EnemySnapshot,
  Exit,
  MapDelta,
  MoveInput,
  NestSnapshot,
  PlayerId,
  RenderedEnemy,
  RenderedNest,
  Vec2,
  WorldInit,
  WorldSnapshot,
} from "../lobby/protocol";
import {
  enemyContactCadenceMs,
  enemyContactDamage,
  enemyRadius,
  NEST_RADIUS,
  type Nest,
  nestLayout,
} from "./enemies";
import { interpolateAt, type PosSample } from "./interpolate";
import { PLAYER_MAX_HP, PLAYER_RADIUS, stepPos } from "./world";

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
export const ENEMY_RENDER_DELAY_MS = 50; // enemies render this far behind their 20 Hz stream
export const RESPAWN_DELAY_MS = 3000; // dead this long, then the client snaps back to center

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2; // the owner's live local position, or a peer's spawn fallback before any sample
  buffer: PosSample[]; // a peer's arrival-stamped samples (empty for the owner)
  lastSeq: number; // highest applied seq; guards apply-if-newer
  hp: number; // a peer's last relayed HP (render hint); the owner's HP lives in `selfHp`
  healthSeq: number; // highest applied peer-health seq; guards apply-if-newer
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
}

export class ClientWorld {
  readonly arena: Arena;
  private readonly exit: Exit;
  private readonly nests: Nest[]; // static layout derived from the arena; hp/alive track the stream
  private readonly avatars = new Map<PlayerId, AvatarRecord>();
  private readonly enemies = new Map<string, EnemyRecord>();
  private lastTick = -1; // highest applied map-delta tick; guards apply-if-newer
  private selfHp = PLAYER_MAX_HP; // client-authoritative: the owner judges its own contact damage

  constructor(
    init: WorldInit,
    private readonly selfId: PlayerId,
  ) {
    this.arena = init.arena;
    this.exit = init.exit;
    this.nests = nestLayout(init.arena);
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
      });
    }
  }

  // Advance only the owner's Avatar — peers never move from local input.
  stepSelf(dtMs: number, input: MoveInput): void {
    const self = this.avatars.get(this.selfId);
    if (self) self.pos = stepPos(self.pos, input, dtMs, this.arena);
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
      if (!this.enemies.has(s.id)) {
        this.enemies.set(s.id, {
          id: s.id,
          kind: s.kind,
          hp: s.hp,
          pos: { ...s.pos },
          buffer: [],
          lastContactAt: Number.NEGATIVE_INFINITY,
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
  // RENDER_DELAY_MS behind `now` from their buffers.
  snapshot(now: number): WorldSnapshot {
    const renderTime = now - RENDER_DELAY_MS;
    return {
      arena: this.arena,
      players: [...this.avatars.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((a) => this.render(a, renderTime)),
      enemies: this.renderEnemies(now),
      nests: this.nests.map(renderNest),
      exit: this.exit,
    };
  }

  private render(a: AvatarRecord, renderTime: number): Avatar {
    const isSelf = a.id === this.selfId;
    const pos = isSelf ? a.pos : (interpolateAt(a.buffer, renderTime) ?? a.pos);
    const hp = isSelf ? this.selfHp : a.hp;
    return { id: a.id, slot: a.slot, name: a.name, pos: { ...pos }, radius: PLAYER_RADIUS, hp };
  }

  private renderEnemies(now: number): RenderedEnemy[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return [...this.enemies.values()].map((e) => ({
      id: e.id,
      kind: e.kind,
      hp: e.hp,
      radius: enemyRadius(e.kind),
      pos: interpolateAt(e.buffer, renderTime) ?? { ...e.pos },
    }));
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
