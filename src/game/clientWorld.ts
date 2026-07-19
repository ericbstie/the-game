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
import { PLAYER_RADIUS, stepPos } from "./world";

// The client's local view of the shared world (Milestone 2 refinement). Built once from
// `game/world-init`, then driven two ways: the owner's Avatar is integrated locally every
// frame (`stepSelf`) for zero-lag input, while every peer's Avatar is moved by relayed
// positions (`applyPeer`, apply-if-newer per peer seq). `snapshot()` assembles the render
// model. The server no longer simulates avatars — this is where motion lives on the wire's
// receiving end.

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2;
  lastSeq: number; // highest applied peer-pos seq; guards apply-if-newer
}

export class ClientWorld {
  private readonly arena: Arena;
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
        lastSeq: -1,
      });
    }
  }

  // Advance only the owner's Avatar — peers never move from local input.
  stepSelf(dtMs: number, input: MoveInput): void {
    const self = this.avatars.get(this.selfId);
    if (self) self.pos = stepPos(self.pos, input, dtMs, this.arena);
  }

  // Apply a relayed position, dropping a stale/duplicate frame by its per-peer seq. Also
  // seeds the owner's Avatar from a reconnect burst (before local sim resumes); an unknown
  // id is ignored — M2 supports reconnect, not a brand-new mid-match joiner.
  applyPeer(id: PlayerId, pos: Vec2, seq: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar || seq <= avatar.lastSeq) return;
    avatar.pos = { x: pos.x, y: pos.y };
    avatar.lastSeq = seq;
  }

  removePeer(id: PlayerId): void {
    this.avatars.delete(id);
  }

  selfPos(): Vec2 | null {
    const self = this.avatars.get(this.selfId);
    return self ? { ...self.pos } : null;
  }

  snapshot(): WorldSnapshot {
    return {
      arena: this.arena,
      players: [...this.avatars.values()].sort((a, b) => a.slot - b.slot).map(toAvatar),
      monsters: this.monsters,
      exit: this.exit,
    };
  }
}

function toAvatar(a: AvatarRecord): Avatar {
  return { id: a.id, slot: a.slot, name: a.name, pos: { ...a.pos }, radius: PLAYER_RADIUS };
}
