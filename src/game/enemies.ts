import type {
  Arena,
  EnemyHit,
  EnemyKind,
  EnemyMove,
  EnemySpawn,
  PlayerId,
  Vec2,
  Weapon,
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

// Player weapons (M3 minimal model). Melee is a cleave wedge; ranged (#41) is a hitscan ray.
export const MELEE_RANGE = 70; // reach of the swing, measured origin → enemy edge
export const MELEE_ARC = 120; // total wedge angle in degrees; half of this each side of `dir`
export const MELEE_DAMAGE = 3;
export const MELEE_CADENCE_MS = 400; // server-enforced min gap between melee swings (anti-nuke)

// Ranged — a hitscan ray (no projectile entity, no per-tick wire state). Reach + DPS.
export const RANGED_RANGE = 700; // how far the ray reaches from the origin
export const RANGED_HALFWIDTH = 24; // the ray's half-thickness; an enemy within it is on-line
export const RANGED_DAMAGE = 1;
export const RANGED_CADENCE_MS = 180; // ranged fires faster than melee

// The server's loose anti-teleport-aim tolerance: a reported swing origin this far from the
// player's last relayed position is rejected. Generous enough to survive relay lag (a player
// moves ≈52 u in one ~200 ms round-trip at 260 u/s), tight enough to reject teleport-aim.
export const ATTACK_POS_TOLERANCE = 500;

// Danger-band geometry mirrors world.ts: enemies live in the outer ring near the walls.
const MONSTER_MARGIN_FRAC = 0.08;

function weaponCadence(weapon: Weapon): number {
  return weapon === "melee" ? MELEE_CADENCE_MS : RANGED_CADENCE_MS;
}

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

// A server-validated attack the sim resolves against enemy HP. `pos` is the swing origin,
// `dir` a unit aim vector. The hub admits it (cadence/range/seq) before it reaches the sim.
export interface Attack {
  weapon: Weapon;
  pos: Vec2;
  dir: Vec2;
}

// What changed this tick, shaped to fill a `game/map-delta` directly: every enemy's position
// in `moves`, newly-spawned enemies (announced once), damaged enemies' new HP, and killed ids.
export interface EnemyEvents {
  moves: EnemyMove[];
  spawns: EnemySpawn[];
  hits: EnemyHit[];
  deaths: string[];
}

// Per-player attack admission state (server-side). `seq` guards apply-if-newer; the two
// timestamps rate-limit each weapon independently.
export interface AttackGuard {
  seq: number;
  meleeAt: number;
  rangedAt: number;
}

export function freshGuard(): AttackGuard {
  return { seq: -1, meleeAt: Number.NEGATIVE_INFINITY, rangedAt: Number.NEGATIVE_INFINITY };
}

// Decide whether to accept a reported attack, mutating `guard` as a side effect. Pure in its
// inputs (real time is the injected `now`), so the hub's anti-cheat is unit-tested without a
// clock. Enemy HP is shared, so the cadence rate-limit is the real anti-nuke; the range-check
// resists teleport-aim; the seq drops stale/duplicate reports (the `game/pos` idiom).
export function admitAttack(
  guard: AttackGuard,
  report: { weapon: Weapon; pos: Vec2; seq: number },
  lastPos: Vec2 | null,
  now: number,
): boolean {
  if (report.seq <= guard.seq) return false; // stale or duplicate
  guard.seq = report.seq;
  const lastAt = report.weapon === "melee" ? guard.meleeAt : guard.rangedAt;
  if (now - lastAt < weaponCadence(report.weapon)) return false; // too soon
  if (
    lastPos &&
    Math.hypot(report.pos.x - lastPos.x, report.pos.y - lastPos.y) > ATTACK_POS_TOLERANCE
  ) {
    return false; // teleport-aim
  }
  if (report.weapon === "melee") guard.meleeAt = now;
  else guard.rangedAt = now;
  return true;
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
// (state, players, attacks, dtMs). Attacks resolve first (so a killed enemy neither moves nor
// appears in `moves` this tick), then survivors chase.
export function stepEnemies(
  state: EnemyState,
  players: PlayerRef[],
  attacks: Attack[],
  dtMs: number,
): { state: EnemyState; events: EnemyEvents } {
  const spawns = state.pending;
  state.pending = [];

  const { hits, deaths } = resolveAttacks(state, attacks);

  const dt = dtMs / 1000;
  for (const enemy of state.enemies.values()) chase(enemy, players, dt);

  const moves: EnemyMove[] = [];
  for (const enemy of state.enemies.values()) moves.push([enemy.id, enemy.pos.x, enemy.pos.y]);
  return { state, events: { moves, spawns, hits, deaths } };
}

// Apply every admitted attack to enemy HP — this sim is the sole writer. Damage accumulates
// across attacks in the tick; an enemy hit then killed reports only its death, not a hit.
function resolveAttacks(
  state: EnemyState,
  attacks: Attack[],
): { hits: EnemyHit[]; deaths: string[] } {
  const damaged = new Set<string>();
  for (const attack of attacks) {
    const struck =
      attack.weapon === "melee" ? meleeTargets(state, attack) : rangedTargets(state, attack);
    const damage = attack.weapon === "melee" ? MELEE_DAMAGE : RANGED_DAMAGE;
    for (const enemy of struck) {
      enemy.hp -= damage;
      damaged.add(enemy.id);
    }
  }
  const hits: EnemyHit[] = [];
  const deaths: string[] = [];
  for (const id of damaged) {
    const enemy = state.enemies.get(id);
    if (!enemy) continue;
    if (enemy.hp <= 0) {
      state.enemies.delete(id);
      deaths.push(id);
    } else {
      hits.push({ id, hp: enemy.hp });
    }
  }
  return { hits, deaths };
}

// Enemies caught in the melee cleave: within reach of the origin and inside the arc around
// `dir`. Hits every enemy in the wedge (swarm cleave). A degenerate zero-length aim skips the
// arc test and hits everything in reach.
function meleeTargets(state: EnemyState, attack: Attack): Enemy[] {
  const halfArc = (MELEE_ARC / 2) * (Math.PI / 180);
  const dirLen = Math.hypot(attack.dir.x, attack.dir.y);
  const struck: Enemy[] = [];
  for (const enemy of state.enemies.values()) {
    if (enemy.hp <= 0) continue;
    const dx = enemy.pos.x - attack.pos.x;
    const dy = enemy.pos.y - attack.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MELEE_RANGE + enemyRadius(enemy.kind)) continue;
    if (dist > 0 && dirLen > 0) {
      const cos = (attack.dir.x * dx + attack.dir.y * dy) / (dirLen * dist);
      if (Math.acos(clampUnit(cos)) > halfArc) continue; // outside the wedge
    }
    struck.push(enemy);
  }
  return struck;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

// The single nearest enemy struck by a hitscan ray from the origin along `dir`: within range
// along the ray and inside its half-width (plus the enemy's radius). Unlike melee's cleave,
// ranged hits only the first enemy the ray reaches. A degenerate zero-length aim hits nothing.
function rangedTargets(state: EnemyState, attack: Attack): Enemy[] {
  const dirLen = Math.hypot(attack.dir.x, attack.dir.y);
  if (dirLen === 0) return [];
  const ux = attack.dir.x / dirLen;
  const uy = attack.dir.y / dirLen;
  let nearest: Enemy | null = null;
  let nearestT = Number.POSITIVE_INFINITY;
  for (const enemy of state.enemies.values()) {
    if (enemy.hp <= 0) continue;
    const rx = enemy.pos.x - attack.pos.x;
    const ry = enemy.pos.y - attack.pos.y;
    const along = rx * ux + ry * uy; // distance along the ray to the enemy's closest point
    if (along < 0 || along > RANGED_RANGE) continue; // behind the shooter or out of reach
    const perp = Math.hypot(rx - along * ux, ry - along * uy);
    if (perp > RANGED_HALFWIDTH + enemyRadius(enemy.kind)) continue; // off the ray line
    if (along < nearestT) {
      nearestT = along;
      nearest = enemy;
    }
  }
  return nearest ? [nearest] : [];
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
