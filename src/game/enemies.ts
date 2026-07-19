import type {
  Arena,
  EnemyKind,
  EnemyMove,
  EnemySpawn,
  PlayerId,
  Vec2,
  WorldInit,
} from "../lobby/protocol";

// The box world's dynamic side (Milestone 3): a pure, server-authoritative enemy simulation.
// `spawnEnemyState` seeds the initial enemies from the immutable world-init; `stepEnemies`
// advances every enemy one tick and reports what changed. Both are deterministic — no clock
// (time is the injected `dtMs`) and no ambient randomness (the only entropy is an injected
// `rng`) — so they unit-test fully and run identically wherever the tick lives.
//
// This module is the sole writer of enemy HP/position. It reads player positions read-only
// and never re-simulates the client-owned avatars (the M2 authority split holds).

export const GRUNT_HP = 30;
export const GRUNT_SPEED = 182; // world units/second (0.7× player) — out-runnable, kite to safety
export const GRUNT_RADIUS = 16;

// Danger-band geometry mirrors world.ts: enemies live in the outer ring near the walls.
const MONSTER_MARGIN_FRAC = 0.08;

export function enemyRadius(kind: EnemyKind): number {
  switch (kind) {
    case "grunt":
      return GRUNT_RADIUS;
  }
}

function enemySpeed(kind: EnemyKind): number {
  switch (kind) {
    case "grunt":
      return GRUNT_SPEED;
  }
}

// One live enemy. `target` is the player it is currently chasing (ENGAGED), kept for
// readability; it is recomputed each tick.
export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  target?: PlayerId;
}

// A read-only player position the sim chases. The sim never mutates these.
export interface PlayerRef {
  id: PlayerId;
  pos: Vec2;
}

// A validated attack the sim resolves against enemy HP. Accepted from #40 onward; the
// tracer accepts the parameter but resolves nothing yet.
export interface Attack {
  weapon: "melee" | "ranged";
  pos: Vec2;
  dir: Vec2;
}

// What changed this tick, shaped to fill a `game/map-delta` directly: every enemy's position
// in `moves`, plus newly-spawned enemies (announced once) and freshly-killed ids.
export interface EnemyEvents {
  moves: EnemyMove[];
  spawns: EnemySpawn[];
  deaths: string[];
}

export interface EnemyState {
  arena: Arena;
  enemies: Map<string, Enemy>;
  pending: EnemySpawn[]; // added-but-not-yet-announced enemies, drained into `spawns` next step
  rng: () => number;
  nextId: number;
}

// Seed the initial enemy set from the world. Tracer: a single grunt out in the danger band
// (east mid-band), so it visibly chases inward toward the center-spawned squad.
export function spawnEnemyState(world: WorldInit, rng: () => number = Math.random): EnemyState {
  const { arena } = world;
  const state: EnemyState = { arena, enemies: new Map(), pending: [], rng, nextId: 1 };
  const midBand = Math.min(arena.width, arena.height) * (0.5 - MONSTER_MARGIN_FRAC / 2);
  addEnemy(state, "grunt", { x: arena.width / 2 + midBand, y: arena.height / 2 });
  return state;
}

// Advance the whole sim one tick. Mutates `state` in place (one state per session, stepped at
// 20 Hz) and returns the same reference plus the events to broadcast. Deterministic in
// (state, players, attacks, dtMs). `attacks` is unused until melee (#40) lands.
export function stepEnemies(
  state: EnemyState,
  players: PlayerRef[],
  _attacks: Attack[],
  dtMs: number,
): { state: EnemyState; events: EnemyEvents } {
  const spawns = state.pending;
  state.pending = [];

  const dt = dtMs / 1000;
  for (const enemy of state.enemies.values()) chase(enemy, players, dt);

  const moves: EnemyMove[] = [];
  for (const enemy of state.enemies.values()) moves.push([enemy.id, enemy.pos.x, enemy.pos.y]);
  return { state, events: { moves, spawns, deaths: [] } };
}

// ENGAGED: step straight toward the nearest player, never overshooting it. With no players
// there is nothing to chase, so the enemy holds (MARCH/HOLD arrive in #43).
function chase(enemy: Enemy, players: PlayerRef[], dt: number): void {
  const target = nearest(players, enemy.pos);
  enemy.target = target?.id;
  if (!target) return;
  const dx = target.pos.x - enemy.pos.x;
  const dy = target.pos.y - enemy.pos.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const travel = Math.min(enemySpeed(enemy.kind) * dt, len);
  enemy.pos = { x: enemy.pos.x + (dx / len) * travel, y: enemy.pos.y + (dy / len) * travel };
}

function nearest(players: PlayerRef[], from: Vec2): PlayerRef | null {
  let best: PlayerRef | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function addEnemy(state: EnemyState, kind: EnemyKind, pos: Vec2): Enemy {
  const id = `e${state.nextId++}`;
  const hp = GRUNT_HP;
  const enemy: Enemy = { id, kind, pos: { ...pos }, hp };
  state.enemies.set(id, enemy);
  state.pending.push({ id, kind, pos: { ...pos }, hp });
  return enemy;
}
