import type {
  Arena,
  Exit,
  Monster,
  MoveInput,
  PlayerId,
  Vec2,
  WorldSnapshot,
} from "../lobby/protocol";

// Server-authoritative box world (Milestone 2). A deep, pure module: it holds no
// timers and no transport — the hub drives it with `step(dtMs)` on a fixed tick and
// ships `snapshot()` to clients. Determinism (no clock, no ambient randomness) keeps
// it fully unit-testable; the only entropy, the exit's wall, is an injected `rng`.

export const ARENA: Arena = { width: 960, height: 600 };
export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 260; // world units / second
export const MONSTER_RADIUS = 16;

const SPAWN_RING = 44; // avatars fan out this far from center so they don't stack
const MONSTER_MARGIN = 90; // monsters ring the interior near the walls (danger at the edge)
const EXIT_LONG = 96;
const EXIT_THICK = 18;

export interface SpawnPlayer {
  id: PlayerId;
  slot: number;
  name: string;
}

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2;
  input: MoveInput;
}

const STILL: MoveInput = { up: false, down: false, left: false, right: false };

export interface WorldOptions {
  arena?: Arena;
  rng?: () => number; // defaults to Math.random; injected for deterministic exit placement
}

export class World {
  private readonly arena: Arena;
  private readonly avatars = new Map<PlayerId, AvatarRecord>();
  private readonly monsters: Monster[];
  private readonly exit: Exit;
  private tickCount = 0;

  constructor(players: SpawnPlayer[], options: WorldOptions = {}) {
    this.arena = options.arena ?? ARENA;
    for (const p of players) this.avatars.set(p.id, this.spawn(p));
    this.monsters = placeMonsters(this.arena);
    this.exit = placeExit(this.arena, options.rng ?? Math.random);
  }

  addAvatar(player: SpawnPlayer): void {
    if (!this.avatars.has(player.id)) this.avatars.set(player.id, this.spawn(player));
  }

  removeAvatar(id: PlayerId): void {
    this.avatars.delete(id);
  }

  setInput(id: PlayerId, move: MoveInput): void {
    const avatar = this.avatars.get(id);
    if (avatar) avatar.input = move;
  }

  // Advance the simulation by dtMs: integrate each avatar from its held input and clamp
  // it inside the walls. Server owns position — the client never asserts its own.
  step(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const a of this.avatars.values()) {
      let dx = (a.input.right ? 1 : 0) - (a.input.left ? 1 : 0);
      let dy = (a.input.down ? 1 : 0) - (a.input.up ? 1 : 0);
      if (dx === 0 && dy === 0) continue;
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      a.pos.x = clamp(
        a.pos.x + dx * PLAYER_SPEED * dt,
        PLAYER_RADIUS,
        this.arena.width - PLAYER_RADIUS,
      );
      a.pos.y = clamp(
        a.pos.y + dy * PLAYER_SPEED * dt,
        PLAYER_RADIUS,
        this.arena.height - PLAYER_RADIUS,
      );
    }
    this.tickCount++;
  }

  snapshot(): WorldSnapshot {
    return {
      arena: this.arena,
      players: [...this.avatars.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((a) => ({
          id: a.id,
          slot: a.slot,
          name: a.name,
          pos: { ...a.pos },
          radius: PLAYER_RADIUS,
        })),
      monsters: this.monsters.map((m) => ({ ...m, pos: { ...m.pos } })),
      exit: { ...this.exit },
      tick: this.tickCount,
    };
  }

  private spawn(player: SpawnPlayer): AvatarRecord {
    const angle = ((player.slot - 1) / 6) * Math.PI * 2;
    return {
      id: player.id,
      slot: player.slot,
      name: player.name,
      pos: {
        x: this.arena.width / 2 + Math.cos(angle) * SPAWN_RING,
        y: this.arena.height / 2 + Math.sin(angle) * SPAWN_RING,
      },
      input: STILL,
    };
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// A ring of static placeholder enemies near the walls. Dynamic behaviour is M3.
function placeMonsters(arena: Arena): Monster[] {
  const { width: w, height: h } = arena;
  const m = MONSTER_MARGIN;
  const spots: Vec2[] = [
    { x: m, y: m },
    { x: w / 2, y: m * 0.7 },
    { x: w - m, y: m },
    { x: w - m * 0.7, y: h / 2 },
    { x: w - m, y: h - m },
    { x: w / 2, y: h - m * 0.7 },
    { x: m, y: h - m },
    { x: m * 0.7, y: h / 2 },
  ];
  return spots.map((pos, i) => ({ id: `m${i + 1}`, pos, radius: MONSTER_RADIUS }));
}

// The escape door: a rectangle flush on one perimeter wall, its wall and offset chosen
// by rng so it hides somewhere different each session.
function placeExit(arena: Arena, rng: () => number): Exit {
  const wall = Math.floor(rng() * 4) % 4; // 0 top, 1 right, 2 bottom, 3 left
  const along = rng();
  if (wall === 0 || wall === 2) {
    const x = EXIT_THICK + along * (arena.width - 2 * EXIT_THICK - EXIT_LONG);
    return {
      x,
      y: wall === 0 ? 0 : arena.height - EXIT_THICK,
      width: EXIT_LONG,
      height: EXIT_THICK,
    };
  }
  const y = EXIT_THICK + along * (arena.height - 2 * EXIT_THICK - EXIT_LONG);
  return { x: wall === 1 ? arena.width - EXIT_THICK : 0, y, width: EXIT_THICK, height: EXIT_LONG };
}
