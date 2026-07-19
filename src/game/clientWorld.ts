import type {
  Arena,
  Avatar,
  EnemyKind,
  Exit,
  MapDelta,
  Monster,
  MoveInput,
  PlayerId,
  RenderedEnemy,
  Vec2,
  WorldInit,
  WorldSnapshot,
} from "../lobby/protocol";
import { enemyRadius } from "./enemies";
import { interpolateAt, type PosSample } from "./interpolate";
import { PLAYER_RADIUS, stepPos } from "./world";

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

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2; // the owner's live local position, or a peer's spawn fallback before any sample
  buffer: PosSample[]; // a peer's arrival-stamped samples (empty for the owner)
  lastSeq: number; // highest applied seq; guards apply-if-newer
}

// A server-owned enemy the client renders. Its position is buffered and interpolated exactly
// like a peer; kind and hp arrive once via a spawn and update via events.
interface EnemyRecord {
  id: string;
  kind: EnemyKind;
  hp: number;
  pos: Vec2; // spawn fallback until the first move sample buffers
  buffer: PosSample[];
}

export class ClientWorld {
  readonly arena: Arena;
  private readonly exit: Exit;
  private readonly monsters: Monster[];
  private readonly avatars = new Map<PlayerId, AvatarRecord>();
  private readonly enemies = new Map<string, EnemyRecord>();
  private lastTick = -1; // highest applied map-delta tick; guards apply-if-newer

  constructor(
    init: WorldInit,
    private readonly selfId: PlayerId,
  ) {
    this.arena = init.arena;
    this.exit = init.exit;
    this.monsters = init.monsters;
    for (const s of init.spawns) {
      this.avatars.set(s.id, {
        id: s.id,
        slot: s.slot,
        name: s.name,
        pos: { ...s.pos },
        buffer: [],
        lastSeq: -1,
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

  // Apply one enemy/combat tick, dropping a stale/out-of-order delta by its monotonic tick.
  // Spawns create a render record before their positions flow; moves buffer each enemy's
  // position for the same delayed interpolation peers use; deaths remove it. Mutates in place —
  // the render loop reads this every frame, so no React re-render at the ~20 Hz tick rate.
  applyMapDelta(delta: MapDelta, now: number): void {
    if (delta.tick <= this.lastTick) return;
    this.lastTick = delta.tick;
    for (const s of delta.spawns ?? []) {
      if (!this.enemies.has(s.id)) {
        this.enemies.set(s.id, { id: s.id, kind: s.kind, hp: s.hp, pos: { ...s.pos }, buffer: [] });
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
      monsters: this.monsters,
      enemies: this.renderEnemies(now),
      exit: this.exit,
    };
  }

  private render(a: AvatarRecord, renderTime: number): Avatar {
    const pos = a.id === this.selfId ? a.pos : (interpolateAt(a.buffer, renderTime) ?? a.pos);
    return { id: a.id, slot: a.slot, name: a.name, pos: { ...pos }, radius: PLAYER_RADIUS };
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
