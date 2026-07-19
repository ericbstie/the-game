import type {
  Arena,
  Avatar,
  Exit,
  Monster,
  MoveInput,
  PlayerId,
  Vec2,
  WorldInit,
  WorldSnapshot,
} from "../lobby/protocol";
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

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2; // the owner's live local position, or a peer's spawn fallback before any sample
  buffer: PosSample[]; // a peer's arrival-stamped samples (empty for the owner)
  lastSeq: number; // highest applied seq; guards apply-if-newer
}

export class ClientWorld {
  readonly arena: Arena;
  private readonly exit: Exit;
  private readonly monsters: Monster[];
  private readonly avatars = new Map<PlayerId, AvatarRecord>();

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
    avatar.buffer.push({ t: arrivalMs, pos: { x: pos.x, y: pos.y } });
    const cutoff = arrivalMs - BUFFER_MS;
    while (avatar.buffer.length > 1 && avatar.buffer[0].t < cutoff) avatar.buffer.shift();
  }

  removePeer(id: PlayerId): void {
    this.avatars.delete(id);
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
      exit: this.exit,
    };
  }

  private render(a: AvatarRecord, renderTime: number): Avatar {
    const pos = a.id === this.selfId ? a.pos : (interpolateAt(a.buffer, renderTime) ?? a.pos);
    return { id: a.id, slot: a.slot, name: a.name, pos: { ...pos }, radius: PLAYER_RADIUS };
  }
}
