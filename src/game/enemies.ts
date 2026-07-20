import type {
  Arena,
  EnemyHit,
  EnemyKind,
  EnemyMove,
  EnemySnapshot,
  EnemySpawn,
  NestDelta,
  NestSnapshot,
  PlayerId,
  Vec2,
  WaveDelta,
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

// Grunt — weak and numerous, out-runnable (kite to safety). Elite — an occasional focus-fire
// sponge, nearly un-outrunnable (must be fought).
export const GRUNT_HP = 30;
export const GRUNT_SPEED = 182; // world units/second (0.7× player)
export const GRUNT_RADIUS = 16;
export const ELITE_HP = 200;
export const ELITE_SPEED = 234; // 0.9× player — nearly un-outrunnable
export const ELITE_RADIUS = 24;

// Contact damage: an enemy touching a player deals `contactDamage` on its own `contactCadenceMs`.
interface EnemyStats {
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  contactCadenceMs: number;
}
const STATS: Record<EnemyKind, EnemyStats> = {
  grunt: {
    hp: GRUNT_HP,
    speed: GRUNT_SPEED,
    radius: GRUNT_RADIUS,
    contactDamage: 6,
    contactCadenceMs: 500,
  },
  elite: {
    hp: ELITE_HP,
    speed: ELITE_SPEED,
    radius: ELITE_RADIUS,
    contactDamage: 20,
    contactCadenceMs: 800,
  },
};

export function enemyContactDamage(kind: EnemyKind): number {
  return STATS[kind].contactDamage;
}

export function enemyContactCadenceMs(kind: EnemyKind): number {
  return STATS[kind].contactCadenceMs;
}

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

// AI: a peel-off aggro radius and the front-line hold edge (the danger/safe boundary).
export const AGGRO_RADIUS = 1_800; // a player this close pulls the nearest enemies off the line
const HOLD_EDGE_FRAC = 0.5 - 0.08; // band inner edge = 13,104 u from center at 31,200

// Nests — the static spawners ringing the danger band. One per 45° sector.
export const NEST_COUNT = 8;
export const SECTORS = 8; // the arena is tiled into eight 45° wedges, one per nest
export const NEST_HP = 600; // a focused squad silences a nest in ~15–25 s
export const NEST_RADIUS = 48;
const SPAWN_JITTER = 300; // grunts spawn within this radius of their nest, so they don't stack

// Waves — the ~30 s escalating drumbeat. Wave w spawns 2+w grunts per still-active nest.
export const WAVE_PERIOD_MS = 30_000; // first wave at 0:30, then every 30 s
export const WAVE_TELEGRAPH_MS = 3_000; // nest-pulse prep window before a wave (visuals deferred)
export const ENEMY_CAP = 240; // hard concurrency governor; a nest holds its remainder at the cap

// Danger-band geometry mirrors world.ts: nests and enemies live in the outer ring near the walls.
const DANGER_BAND_FRAC = 0.08;

function weaponCadence(weapon: Weapon): number {
  return weapon === "melee" ? MELEE_CADENCE_MS : RANGED_CADENCE_MS;
}

// A point's bearing from arena center, in degrees normalized to [0, 360).
export function angleOf(pos: Vec2, arena: Arena): number {
  const deg = (Math.atan2(pos.y - arena.height / 2, pos.x - arena.width / 2) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Which 45° sector (0..7) a point falls in. Half-open and centered on the nest bearings, so a
// point on a boundary lands deterministically in the higher sector and `sectorOf(nest_k) === k`.
export function sectorOf(pos: Vec2, arena: Arena): number {
  const span = 360 / SECTORS;
  return Math.floor(((angleOf(pos, arena) + span / 2) % 360) / span);
}

export function enemyRadius(kind: EnemyKind): number {
  return STATS[kind].radius;
}

function enemySpeed(kind: EnemyKind): number {
  return STATS[kind].speed;
}

// One live enemy. `sector` is the 45° wedge it was spawned into (inherited from its nest);
// `target` is the player it is currently chasing (ENGAGED), recomputed each tick.
export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  sector: number;
  target?: PlayerId;
}

// A spawner nest: static position/sector, dynamic hp/alive. Killing it silences its sector (#44).
export interface Nest {
  id: string;
  pos: Vec2;
  hp: number;
  alive: boolean;
  sector: number;
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

// What changed this tick, shaped to fill a `game/map-delta` directly: every enemy's position in
// `moves`, enemies spawned this tick, damaged enemies' new HP, killed ids, damaged/silenced
// nests, and — when a wave fires — the wave clock.
export interface EnemyEvents {
  moves: EnemyMove[];
  spawns: EnemySpawn[];
  hits: EnemyHit[];
  deaths: string[];
  nests: NestDelta[];
  wave: WaveDelta | null;
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
  nests: Nest[];
  waveIndex: number; // waves fired so far (0 before the first)
  msUntilWave: number; // countdown to the next wave; the first lands at 0:30
  rng: () => number;
  nextId: number;
}

// The eight nests, one per 45° sector, seated in the danger band. Position is a pure function
// of the arena — the ray at k·45° projected onto the mid-band square — so the client derives
// the same layout without it ever riding the wire. Invariant: `sectorOf(nest_k) === k`.
export function nestLayout(arena: Arena): Nest[] {
  const cx = arena.width / 2;
  const cy = arena.height / 2;
  const half = (Math.min(arena.width, arena.height) / 2) * (1 - DANGER_BAND_FRAC); // mid-band inset
  const span = (2 * Math.PI) / NEST_COUNT;
  return Array.from({ length: NEST_COUNT }, (_, k) => {
    const angle = k * span;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const t = half / Math.max(Math.abs(cos), Math.abs(sin)); // project the ray onto the square
    return {
      id: `n${k}`,
      pos: { x: cx + t * cos, y: cy + t * sin },
      hp: NEST_HP,
      alive: true,
      sector: k,
    };
  });
}

// Snapshot the live sim for the reconnect keyframe: every current enemy, every nest's state, and
// the wave clock. Positions are copied so the snapshot never aliases live state.
export function snapshotEnemies(state: EnemyState): {
  enemies: EnemySnapshot[];
  nests: NestSnapshot[];
  wave: WaveDelta;
} {
  return {
    enemies: [...state.enemies.values()].map((e) => ({
      id: e.id,
      kind: e.kind,
      pos: { ...e.pos },
      hp: e.hp,
      sector: e.sector,
    })),
    nests: state.nests.map((n) => ({
      id: n.id,
      pos: { ...n.pos },
      hp: n.hp,
      alive: n.alive,
      sector: n.sector,
    })),
    wave: { index: state.waveIndex, clockMs: state.msUntilWave },
  };
}

// Seed the sim from the world: place the nests and arm the wave clock. No enemies yet — the
// first wave spawns them from the nests at 0:30.
export function spawnEnemyState(world: WorldInit, rng: () => number = Math.random): EnemyState {
  return {
    arena: world.arena,
    enemies: new Map(),
    nests: nestLayout(world.arena),
    waveIndex: 0,
    msUntilWave: WAVE_PERIOD_MS,
    rng,
    nextId: 1,
  };
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
  const { spawns, wave } = tickWaves(state, dtMs);
  const { hits, deaths, nests } = resolveAttacks(state, attacks);

  const dt = dtMs / 1000;
  const center = { x: state.arena.width / 2, y: state.arena.height / 2 };
  const holdEdge = Math.min(state.arena.width, state.arena.height) * HOLD_EDGE_FRAC;
  for (const enemy of state.enemies.values()) stepEnemy(enemy, players, center, holdEdge, dt);

  const moves: EnemyMove[] = [];
  for (const enemy of state.enemies.values()) moves.push([enemy.id, enemy.pos.x, enemy.pos.y]);
  return { state, events: { moves, spawns, hits, deaths, nests, wave } };
}

// Advance the wave clock; when it reaches zero, fire the next wave and re-arm it. Real ticks are
// ~50 ms so at most one wave fires per step; the clock is driven by the injected `dtMs`.
function tickWaves(
  state: EnemyState,
  dtMs: number,
): { spawns: EnemySpawn[]; wave: WaveDelta | null } {
  state.msUntilWave -= dtMs;
  if (state.msUntilWave > 0) return { spawns: [], wave: null };
  state.msUntilWave += WAVE_PERIOD_MS;
  const spawns = spawnWave(state);
  return { spawns, wave: { index: state.waveIndex, clockMs: state.msUntilWave } };
}

// Every still-active nest emits `2 + w` grunts into its own sector, plus `max(0, w−2)` elites
// spread across distinct nests (none before wave 3), all up to the concurrency cap. A nest that
// would breach ENEMY_CAP holds its remainder rather than spawning it.
function spawnWave(state: EnemyState): EnemySpawn[] {
  state.waveIndex += 1;
  const w = state.waveIndex;
  const active = state.nests.filter((n) => n.alive);
  const spawns: EnemySpawn[] = [];
  const emit = (kind: EnemyKind, nest: Nest): boolean => {
    if (state.enemies.size >= ENEMY_CAP) return false; // cap governor holds the remainder
    spawns.push(addEnemy(state, kind, jitter(nest.pos, state.rng), nest.sector));
    return true;
  };
  for (const nest of active) {
    for (let i = 0; i < 2 + w; i++) if (!emit("grunt", nest)) return spawns; // grunts(w) = 2 + w
  }
  const elites = Math.max(0, w - 2); // elites(w), none before wave 3
  for (let i = 0; i < elites && i < active.length; i++) emit("elite", active[i]);
  return spawns;
}

// A spawn point scattered within SPAWN_JITTER of the nest so a wave doesn't stack on one point.
function jitter(pos: Vec2, rng: () => number): Vec2 {
  return {
    x: pos.x + (rng() * 2 - 1) * SPAWN_JITTER,
    y: pos.y + (rng() * 2 - 1) * SPAWN_JITTER,
  };
}

// Apply every admitted attack to enemy and nest HP — this sim is the sole writer. Melee cleaves
// every enemy/nest in its wedge; ranged strikes the single nearest target (enemy or nest) along
// its ray. Damage accumulates across attacks; an enemy hit then killed reports only its death.
function resolveAttacks(
  state: EnemyState,
  attacks: Attack[],
): { hits: EnemyHit[]; deaths: string[]; nests: NestDelta[] } {
  const enemiesHit = new Set<string>();
  const nestsHit = new Set<string>();
  for (const attack of attacks) {
    const damage = attack.weapon === "melee" ? MELEE_DAMAGE : RANGED_DAMAGE;
    if (attack.weapon === "melee") {
      for (const enemy of state.enemies.values()) {
        if (enemy.hp > 0 && inMeleeWedge(attack, enemy.pos, enemyRadius(enemy.kind))) {
          enemy.hp -= damage;
          enemiesHit.add(enemy.id);
        }
      }
      for (const nest of state.nests) {
        if (nest.alive && inMeleeWedge(attack, nest.pos, NEST_RADIUS)) {
          nest.hp -= damage;
          nestsHit.add(nest.id);
        }
      }
    } else {
      const hit = nearestRayHit(state, attack);
      if (hit?.enemy) {
        hit.enemy.hp -= damage;
        enemiesHit.add(hit.enemy.id);
      } else if (hit?.nest) {
        hit.nest.hp -= damage;
        nestsHit.add(hit.nest.id);
      }
    }
  }

  const hits: EnemyHit[] = [];
  const deaths: string[] = [];
  for (const id of enemiesHit) {
    const enemy = state.enemies.get(id);
    if (!enemy) continue;
    if (enemy.hp <= 0) {
      state.enemies.delete(id);
      deaths.push(id);
    } else {
      hits.push({ id, hp: enemy.hp });
    }
  }

  const nests: NestDelta[] = [];
  for (const id of nestsHit) {
    const nest = state.nests.find((n) => n.id === id);
    if (!nest) continue;
    if (nest.hp <= 0) {
      nest.hp = 0;
      nest.alive = false; // silenced: it drops out of every future wave's `active` set
    }
    nests.push({ id: nest.id, hp: nest.hp, alive: nest.alive });
  }
  return { hits, deaths, nests };
}

// Is a circle at `pos` (of the given radius) inside the melee cleave wedge? Within reach of the
// origin and inside the arc around `dir`. A degenerate zero-length aim skips the arc test.
function inMeleeWedge(attack: Attack, pos: Vec2, radius: number): boolean {
  const dx = pos.x - attack.pos.x;
  const dy = pos.y - attack.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist > MELEE_RANGE + radius) return false;
  const dirLen = Math.hypot(attack.dir.x, attack.dir.y);
  if (dist === 0 || dirLen === 0) return true;
  const cos = (attack.dir.x * dx + attack.dir.y * dy) / (dirLen * dist);
  return Math.acos(clampUnit(cos)) <= (MELEE_ARC / 2) * (Math.PI / 180);
}

// The single nearest target a hitscan ray reaches — an enemy or a nest, whichever is closer
// along the ray — within range and inside the ray's half-width (plus the target's radius). A
// degenerate zero-length aim hits nothing.
function nearestRayHit(state: EnemyState, attack: Attack): { enemy?: Enemy; nest?: Nest } | null {
  const dirLen = Math.hypot(attack.dir.x, attack.dir.y);
  if (dirLen === 0) return null;
  const ux = attack.dir.x / dirLen;
  const uy = attack.dir.y / dirLen;
  // Distance along the ray to a target at `pos`, or null if it's behind, out of range, or off-line.
  const alongIfHit = (pos: Vec2, radius: number): number | null => {
    const rx = pos.x - attack.pos.x;
    const ry = pos.y - attack.pos.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > RANGED_RANGE) return null;
    const perp = Math.hypot(rx - along * ux, ry - along * uy);
    return perp <= RANGED_HALFWIDTH + radius ? along : null;
  };
  let best: { along: number; enemy?: Enemy; nest?: Nest } | null = null;
  for (const enemy of state.enemies.values()) {
    if (enemy.hp <= 0) continue;
    const along = alongIfHit(enemy.pos, enemyRadius(enemy.kind));
    if (along !== null && (best === null || along < best.along)) best = { along, enemy };
  }
  for (const nest of state.nests) {
    if (!nest.alive) continue;
    const along = alongIfHit(nest.pos, NEST_RADIUS);
    if (along !== null && (best === null || along < best.along)) best = { along, nest };
  }
  return best === null ? null : { enemy: best.enemy, nest: best.nest };
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

// One enemy's pure geometric step — one of three states:
//   ENGAGED — a player within AGGRO_RADIUS → chase the nearest, never overshooting it.
//   MARCH   — un-aggroed and still outside the hold edge → advance toward center, stopping
//             exactly at the edge (so it never floods the safe center).
//   HOLD    — un-aggroed and at/inside the hold edge → stop. A wave forms a front line here.
function stepEnemy(
  enemy: Enemy,
  players: PlayerRef[],
  center: Vec2,
  holdEdge: number,
  dt: number,
): void {
  const speed = enemySpeed(enemy.kind) * dt;
  const target = nearestWithin(players, enemy.pos, AGGRO_RADIUS);
  if (target) {
    enemy.target = target.id;
    stepToward(enemy, target.pos, speed); // ENGAGED
    return;
  }
  enemy.target = undefined;
  const distFromCenter = Math.hypot(center.x - enemy.pos.x, center.y - enemy.pos.y);
  if (distFromCenter <= holdEdge) return; // HOLD
  stepToward(enemy, center, Math.min(speed, distFromCenter - holdEdge)); // MARCH, capped at the edge
}

// Move the enemy toward `to` by up to `maxTravel`, never past it.
function stepToward(enemy: Enemy, to: Vec2, maxTravel: number): void {
  const dx = to.x - enemy.pos.x;
  const dy = to.y - enemy.pos.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || maxTravel <= 0) return;
  const t = Math.min(maxTravel, len);
  enemy.pos = { x: enemy.pos.x + (dx / len) * t, y: enemy.pos.y + (dy / len) * t };
}

// The nearest player, but only if within `radius` — otherwise the enemy is un-aggroed.
function nearestWithin(players: PlayerRef[], from: Vec2, radius: number): PlayerRef | null {
  let best: PlayerRef | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best && bestDist <= radius ? best : null;
}

// Add one enemy to the sim and return its spawn announcement (the client needs kind/hp/sector
// before position deltas flow for it).
function addEnemy(state: EnemyState, kind: EnemyKind, pos: Vec2, sector: number): EnemySpawn {
  const id = `e${state.nextId++}`;
  const hp = STATS[kind].hp;
  state.enemies.set(id, { id, kind, pos: { ...pos }, hp, sector });
  return { id, kind, pos: { ...pos }, hp, sector };
}
