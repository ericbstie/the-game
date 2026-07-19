import type { Arena, Exit, MoveInput, PlayerId, Spawn, Vec2, WorldInit } from "../lobby/protocol";

// The box world's shared shape and motion, as pure functions. `generateWorld` builds the
// immutable world-init the server hands to every client once; `stepPos` integrates a
// single Avatar one frame. Both are deterministic (no clock, no ambient randomness — the
// only entropy, the exit's wall, is an injected `rng`) so they unit-test fully and run
// identically on the server (generation) and the client (per-frame self-sim).

// One giant box: ~2 minutes to walk end-to-end at PLAYER_SPEED (≈120 s edge-to-edge,
// ≈60 s center → perimeter). You spawn dead center and push outward toward the danger.
export const ARENA: Arena = { width: 31_200, height: 31_200 };
export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 260; // world units / second

// Avatar-scale constants are absolute — they track player/door size, not arena size.
const SPAWN_RING = 44; // avatars fan out this far from center so they don't stack
const EXIT_THICK = 98; // door depth ≈ 3.5× player diameter, readable against the huge wall

// The door length is a fraction of the arena, so it scales with the box instead of vanishing.
const EXIT_LONG_FRAC = 0.03; // door length along its wall ≈ 936 u at 31,200

export interface SpawnPlayer {
  id: PlayerId;
  slot: number;
  name: string;
}

export interface WorldOptions {
  arena?: Arena;
  rng?: () => number; // defaults to Math.random; injected for deterministic exit placement
}

export function generateWorld(players: SpawnPlayer[], options: WorldOptions = {}): WorldInit {
  const arena = options.arena ?? ARENA;
  return {
    arena,
    exit: placeExit(arena, options.rng ?? Math.random),
    spawns: players.map((p) => spawn(p, arena)),
  };
}

// Integrate one Avatar by dtMs from its held input, clamped inside the walls. Pure — it
// returns a fresh Vec2 and never mutates its argument.
export function stepPos(pos: Vec2, input: MoveInput, dtMs: number, arena: Arena): Vec2 {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return { x: pos.x, y: pos.y };
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  const dt = dtMs / 1000;
  return {
    x: clamp(pos.x + dx * PLAYER_SPEED * dt, PLAYER_RADIUS, arena.width - PLAYER_RADIUS),
    y: clamp(pos.y + dy * PLAYER_SPEED * dt, PLAYER_RADIUS, arena.height - PLAYER_RADIUS),
  };
}

function spawn(player: SpawnPlayer, arena: Arena): Spawn {
  const angle = ((player.slot - 1) / 6) * Math.PI * 2;
  return {
    id: player.id,
    slot: player.slot,
    name: player.name,
    pos: {
      x: arena.width / 2 + Math.cos(angle) * SPAWN_RING,
      y: arena.height / 2 + Math.sin(angle) * SPAWN_RING,
    },
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// The escape door: a rectangle flush on one perimeter wall, its wall and offset chosen
// by rng so it hides somewhere different each session.
function placeExit(arena: Arena, rng: () => number): Exit {
  const wall = Math.floor(rng() * 4) % 4; // 0 top, 1 right, 2 bottom, 3 left
  const along = rng();
  if (wall === 0 || wall === 2) {
    const long = EXIT_LONG_FRAC * arena.width;
    const x = EXIT_THICK + along * (arena.width - 2 * EXIT_THICK - long);
    return { x, y: wall === 0 ? 0 : arena.height - EXIT_THICK, width: long, height: EXIT_THICK };
  }
  const long = EXIT_LONG_FRAC * arena.height;
  const y = EXIT_THICK + along * (arena.height - 2 * EXIT_THICK - long);
  return { x: wall === 1 ? arena.width - EXIT_THICK : 0, y, width: EXIT_THICK, height: long };
}
