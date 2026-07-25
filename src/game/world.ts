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
export const PLAYER_MAX_HP = 100; // client-authoritative; the client judges its own contact damage

// Avatar-scale constants are absolute — they track player/door size, not arena size.
const SPAWN_RING = 44; // avatars fan out this far from center so they don't stack
const EXIT_THICK = 98; // door depth ≈ 3.5× player diameter, readable against the huge wall

// The door length is a fraction of the arena, so it scales with the box instead of vanishing.
const EXIT_LONG_FRAC = 0.03; // door length along its wall ≈ 936 u at 31,200

// The outer ring where the danger lives: nests sit in it and ore thickens toward it. Shared
// geometry, so the enemy sim and the ore generator agree on where "the edge" begins.
export const DANGER_BAND_FRAC = 0.08;

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
  const rng = options.rng ?? Math.random;
  return {
    arena,
    exit: placeExit(arena, rng),
    spawns: players.map((p) => spawn(p, arena)),
    // Only the seed travels: every client expands it into the same ore grid locally, so the
    // ~7k ore tiles never touch the wire and never grow the reconnect keyframe.
    oreSeed: Math.floor(rng() * 0x1_0000_0000),
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

// A circle the avatar cannot stand inside — an enemy, as the owner's client renders it.
export interface Body {
  pos: Vec2;
  radius: number;
}

// Push the avatar clear of every body it overlaps, accumulating one displacement per body.
//
// Soft-push, not a hard stop: pressing into a grunt slows you and shoves you back out rather
// than blocking the move outright. Accumulating is what prevents a hard trap — surrounded on
// three sides, the three pushes sum to a vector pointing out the fourth.
export function pushOutOfBodies(pos: Vec2, radius: number, bodies: Body[], arena: Arena): Vec2 {
  let { x, y } = pos;
  for (const body of bodies) {
    const dx = x - body.pos.x;
    const dy = y - body.pos.y;
    const dist = Math.hypot(dx, dy);
    const apart = radius + body.radius;
    if (dist >= apart) continue;
    // Dead-centre overlap has no direction to push along; break the tie deterministically so
    // two clients never disagree about which way you popped out.
    if (dist === 0) {
      x += apart;
      continue;
    }
    const push = apart - dist;
    x += (dx / dist) * push;
    y += (dy / dist) * push;
  }
  return {
    x: clamp(x, PLAYER_RADIUS, arena.width - PLAYER_RADIUS),
    y: clamp(y, PLAYER_RADIUS, arena.height - PLAYER_RADIUS),
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
