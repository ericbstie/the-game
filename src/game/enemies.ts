import type {
  Arena,
  EnemyHit,
  EnemyKind,
  EnemyMove,
  EnemySnapshot,
  EnemySpawn,
  NestDelta,
  NestSnapshot,
  PeerShot,
  PlayerId,
  StructureHit,
  TurretAim,
  Vec2,
  WaveDelta,
  WorldInit,
} from "../lobby/protocol";
import {
  ActivationQueue,
  type BuildState,
  pushOutOfSolids,
  removeStructure,
  type Structure,
  structureBlocking,
  structureCenter,
  structureRadius,
  TURRET_ACTIVE_DRAW,
  TURRET_CADENCE_MS,
  TURRET_DAMAGE,
  TURRET_IDLE_DRAW,
  TURRET_RANGE,
  type TurretRuntime,
} from "./build";
import { DANGER_BAND_FRAC, PLAYER_RADIUS } from "./world";

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

// The player's one weapon (M4 retired M3's melee/ranged pair so right-click could become
// hand-mining): a hitscan ray — no projectile entity, no per-tick wire state. Reach + DPS.
export const RANGED_RANGE = 700; // how far the ray reaches from the origin
export const RANGED_HALFWIDTH = 24; // the ray's half-thickness; an enemy within it is on-line
export const RANGED_DAMAGE = 1;
export const RANGED_CADENCE_MS = 180;

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
export const ENEMY_CAP = 240; // hard concurrency governor; a nest holds its remainder at the cap

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

// What an enemy has locked on to. Players and structures share the same aggro radius, but a
// player always outranks a structure — the squad is the threat, the base is the consolation.
export type EnemyTarget = { kind: "player"; id: PlayerId } | { kind: "structure"; id: string };

// One live enemy. `sector` is the 45° wedge it was spawned into (inherited from its nest);
// `target` is what it is currently chasing (ENGAGED), held until that target dies or leaves
// range. `biteMs` counts down to its next bite on a structure — driven by the injected `dtMs`,
// never a clock, so the sim stays deterministic.
export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  sector: number;
  biteMs: number;
  target?: EnemyTarget;
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

// A server-validated shot the sim resolves against enemy HP. `pos` is the shot origin,
// `dir` a unit aim vector, `by` the player the sim attributes the resulting line to. The hub
// admits it (cadence/range/seq) before it reaches the sim.
export interface Attack {
  pos: Vec2;
  dir: Vec2;
  by: PlayerId;
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
  // Structures chewed on this tick, and the ids of any that fell. Sparse, mirroring hits/deaths.
  structHits: StructureHit[];
  removals: string[];
  // What was depicted this tick: turrets whose aim changed, and the squad's shots as resolved.
  aims: TurretAim[];
  shots: PeerShot[];
}

// Per-player attack admission state (server-side). `seq` guards apply-if-newer; `lastAt`
// rate-limits the weapon.
export interface AttackGuard {
  seq: number;
  lastAt: number;
}

export function freshGuard(): AttackGuard {
  return { seq: -1, lastAt: Number.NEGATIVE_INFINITY };
}

// Decide whether to accept a reported attack, returning the aim to use or null if it is refused,
// and mutating `guard` as a side effect (the `admitBuild`/`admitDemolish` idiom). Pure in its
// inputs (real time is the injected `now`), so the hub's anti-cheat is unit-tested without a
// clock. Enemy HP is shared, so the cadence rate-limit is the real anti-nuke; the range-check
// resists teleport-aim; the seq drops stale/duplicate reports (the `game/pos` idiom).
//
// The aim is normalized here rather than trusted. `asVec2` only rejects non-finite numbers, so a
// hostile client can report `{x: 1e300, y: 0}` or a zero vector — and this vector is rebroadcast
// to the whole squad as `PeerShot.dir`, where it would blow up or NaN out every other client's
// canvas path. Normalizing at admission is what makes the protocol's "unit aim vector" true.
export function admitAttack(
  guard: AttackGuard,
  report: { pos: Vec2; dir: Vec2; seq: number },
  lastPos: Vec2 | null,
  now: number,
): Vec2 | null {
  if (report.seq <= guard.seq) return null; // stale or duplicate
  guard.seq = report.seq;
  if (now - guard.lastAt < RANGED_CADENCE_MS) return null; // too soon
  if (
    lastPos &&
    Math.hypot(report.pos.x - lastPos.x, report.pos.y - lastPos.y) > ATTACK_POS_TOLERANCE
  ) {
    return null; // teleport-aim
  }
  // Charged before the aim is judged, so a degenerate vector costs its cadence like any other shot
  // rather than buying an immediate retry.
  guard.lastAt = now;
  const len = Math.hypot(report.dir.x, report.dir.y);
  if (len === 0 || !Number.isFinite(len)) return null; // points nowhere, or overflowed
  return { x: report.dir.x / len, y: report.dir.y / len };
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
// (state, players, attacks, build, dtMs). Attacks resolve first (so a killed enemy neither moves
// nor appears in `moves` this tick), then survivors chase and chew.
export function stepEnemies(
  state: EnemyState,
  players: PlayerRef[],
  attacks: Attack[],
  dtMs: number,
  build: BuildState | null = null,
): { state: EnemyState; events: EnemyEvents } {
  const { spawns, wave } = tickWaves(state, dtMs, build);
  // Player shots and turret fire land in the same damage pass, so a target struck by both this
  // tick reports once. The sim stays the sole writer of enemy and nest HP either way.
  const enemiesHit = new Set<string>();
  const nestsHit = new Set<string>();
  const shots: PeerShot[] = [];
  const aims: TurretAim[] = [];
  applyAttacks(state, attacks, enemiesHit, nestsHit, shots);
  stepTurrets(state, build, dtMs, enemiesHit, nestsHit, aims);
  const { hits, deaths, nests } = reapDamage(state, enemiesHit, nestsHit);

  const context: StepContext = {
    players,
    build,
    center: { x: state.arena.width / 2, y: state.arena.height / 2 },
    holdEdge: Math.min(state.arena.width, state.arena.height) * HOLD_EDGE_FRAC,
    dtMs,
    damaged: new Set<string>(),
  };
  for (const enemy of state.enemies.values()) stepEnemy(enemy, context);

  const moves: EnemyMove[] = [];
  for (const enemy of state.enemies.values()) moves.push([enemy.id, enemy.pos.x, enemy.pos.y]);
  return {
    state,
    events: { moves, spawns, hits, deaths, nests, wave, aims, shots, ...reapStructures(context) },
  };
}

// Everything one enemy's step reads, plus the structures it chewed on. Bundled so `stepEnemy`
// keeps a single parameter as targeting grows.
interface StepContext {
  players: PlayerRef[];
  build: BuildState | null;
  center: Vec2;
  holdEdge: number;
  dtMs: number;
  damaged: Set<string>; // structure ids bitten this tick, resolved into hits/removals at the end
}

// Turn this tick's structure damage into wire events. A structure at 0 HP is simply removed —
// nothing explodes, and there is no repair (demolish and rebuild is the only restoration).
function reapStructures(context: StepContext): { structHits: StructureHit[]; removals: string[] } {
  const structHits: StructureHit[] = [];
  const removals: string[] = [];
  const build = context.build;
  if (!build) return { structHits, removals };
  for (const id of context.damaged) {
    const structure = build.structures.get(id);
    if (!structure) continue;
    if (structure.hp <= 0) {
      removeStructure(build, id);
      removals.push(id);
    } else {
      structHits.push({ id, hp: structure.hp });
    }
  }
  return { structHits, removals };
}

// Advance the wave clock; when it reaches zero, fire the next wave and re-arm it. Real ticks are
// ~50 ms so at most one wave fires per step; the clock is driven by the injected `dtMs`.
function tickWaves(
  state: EnemyState,
  dtMs: number,
  build: BuildState | null,
): { spawns: EnemySpawn[]; wave: WaveDelta | null } {
  state.msUntilWave -= dtMs;
  if (state.msUntilWave > 0) return { spawns: [], wave: null };
  state.msUntilWave += WAVE_PERIOD_MS;
  const spawns = spawnWave(state, build);
  return { spawns, wave: { index: state.waveIndex, clockMs: state.msUntilWave } };
}

// Every still-active nest emits `2 + w` grunts into its own sector, plus `max(0, w−2)` elites
// spread across distinct nests (none before wave 3), all up to the concurrency cap. A nest that
// would breach ENEMY_CAP holds its remainder rather than spawning it.
function spawnWave(state: EnemyState, build: BuildState | null): EnemySpawn[] {
  state.waveIndex += 1;
  const w = state.waveIndex;
  const active = state.nests.filter((n) => n.alive);
  const spawns: EnemySpawn[] = [];
  const emit = (kind: EnemyKind, nest: Nest): boolean => {
    if (state.enemies.size >= ENEMY_CAP) return false; // cap governor holds the remainder
    // A nest walled in is a legitimate strategy, so a wave that lands inside a footprint still
    // spawns — the overlapping enemy is simply pushed clear.
    const at = pushOutOfSolids(build, jitter(nest.pos, state.rng), enemyRadius(kind));
    spawns.push(addEnemy(state, kind, at, nest.sector));
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

// Apply every admitted shot to enemy and nest HP — this sim is the sole writer. A shot strikes
// the single nearest target (enemy or nest) along its ray.
//
// The `PeerShot` that depicts the shot is emitted here, beside the HP it wrote, rather than when
// the hub admitted the report. That is what makes the authority invariant structural instead of a
// rule to remember: a refused attack never reaches `pendingAttacks`, never reaches this loop, and
// so has no path to the wire.
function applyAttacks(
  state: EnemyState,
  attacks: Attack[],
  enemiesHit: Set<string>,
  nestsHit: Set<string>,
  shots: PeerShot[],
): void {
  for (const attack of attacks) {
    const hit = nearestRayHit(state, attack);
    const shot: PeerShot = { id: attack.by, dir: attack.dir };
    if (hit?.enemy) {
      hit.enemy.hp -= RANGED_DAMAGE;
      enemiesHit.add(hit.enemy.id);
      shot.hit = hit.enemy.id;
    } else if (hit?.nest) {
      hit.nest.hp -= RANGED_DAMAGE;
      nestsHit.add(hit.nest.id);
      shot.hit = hit.nest.id;
    }
    shots.push(shot);
  }
}

// Advance every turret one tick: hold or re-acquire a target, settle the power budget, and let
// the turrets that won power fire on their own cadence.
//
// A turret strikes the nearest thing in range — enemy or nest, whichever is closer, with no
// lowest-HP or elite priority. Hitscan straight through walls and structures: turrets need no
// line of sight and no firing lane, so there is deliberately no ray-vs-structure test here.
// Nests are legitimate targets, so a forward turret line sieges one unattended.
//
// What the client draws is streamed from here as a transition: each turret's `(targetId, powered)`
// pair is snapshotted before it moves and diffed once the power budget has settled. The line then
// exists exactly while this function's own firing precondition holds — it is written by the same
// pass that applies `TURRET_DAMAGE`, so it cannot outlive the damage by more than one tick.
// Nothing is remembered between ticks: every client gets the same delta, every tick.
function stepTurrets(
  state: EnemyState,
  build: BuildState | null,
  dtMs: number,
  enemiesHit: Set<string>,
  nestsHit: Set<string>,
  aims: TurretAim[],
): void {
  if (!build) return;
  const turrets = [...build.structures.values()].filter((s) => s.turret !== undefined);
  if (turrets.length === 0) {
    build.power.consumption = 0;
    return;
  }
  const before = new Map(turrets.map((t) => [t.id, aimKey(t.turret as TurretRuntime)]));

  // Every standing turret draws idle, simply for existing. That is committed before anything
  // gets to activate, which is what makes over-building starve the grid rather than break it.
  let committed = turrets.length * TURRET_IDLE_DRAW;
  const wants: Structure[] = []; // turrets with a target but no power, in the order they asked
  const engaged = new Map<string, TurretTarget>();

  for (const turret of turrets) {
    const runtime = turret.turret as TurretRuntime;
    runtime.cooldownMs = Math.max(0, runtime.cooldownMs - dtMs);
    const from = structureCenter(turret);
    // Sticky power is tied to the target: losing it is the one thing that releases the slot.
    const held = heldTarget(state, runtime.targetId, from);
    if (!held) {
      runtime.powered = false;
      runtime.targetId = null;
    }
    const target = held ?? nearestTarget(state, from, TURRET_RANGE);
    if (!target) continue; // nothing to shoot: it stands there drawing idle
    runtime.targetId = target.enemy?.id ?? target.nest?.id ?? null;
    engaged.set(turret.id, target);
    // An already-firing turret keeps its reservation and is never re-queued — that is what stops
    // the budget flickering between two turrets tick after tick.
    if (runtime.powered) committed += TURRET_ACTIVE_DRAW;
    else wants.push(turret);
  }

  const queue = new ActivationQueue(build.power.generation, committed);
  for (const turret of wants) queue.request(turret);
  queue.drain();
  // Over-building is legal, so the reported draw is clamped at the ceiling: the consequence is
  // that nothing has headroom left to activate, not a number that reads as broken.
  build.power.consumption = Math.min(queue.committed, build.power.generation);

  for (const turret of turrets) {
    const runtime = turret.turret as TurretRuntime;
    if (aimKey(runtime) !== before.get(turret.id)) {
      aims.push([turret.id, runtime.targetId, runtime.powered ? 1 : 0]);
    }
    const target = engaged.get(turret.id);
    if (!runtime.powered || !target || runtime.cooldownMs > 0) continue;
    runtime.cooldownMs = TURRET_CADENCE_MS;
    if (target.enemy) {
      target.enemy.hp -= TURRET_DAMAGE;
      enemiesHit.add(target.enemy.id);
    } else if (target.nest) {
      target.nest.hp -= TURRET_DAMAGE;
      nestsHit.add(target.nest.id);
    }
  }
}

// A turret's aim collapsed to one comparable value, so the diff is an equality test rather than
// two. Only `targetId` and `powered` are in it: the cooldown never rides the wire — the client
// generates its own pulse train from `TURRET_CADENCE_MS`.
function aimKey(runtime: TurretRuntime): string {
  return `${runtime.targetId}|${runtime.powered}`;
}

type TurretTarget = { enemy?: Enemy; nest?: Nest };

// A turret's held target, still alive and still in range — or null, which releases its power.
function heldTarget(state: EnemyState, id: string | null, from: Vec2): TurretTarget | null {
  if (id === null) return null;
  const inRange = (pos: Vec2) => Math.hypot(pos.x - from.x, pos.y - from.y) <= TURRET_RANGE;
  const enemy = state.enemies.get(id);
  if (enemy) return enemy.hp > 0 && inRange(enemy.pos) ? { enemy } : null;
  const nest = state.nests.find((n) => n.id === id);
  if (nest) return nest.alive && inRange(nest.pos) ? { nest } : null;
  return null;
}

// The nearest live enemy or standing nest within `range` of a point, by centre distance.
function nearestTarget(
  state: EnemyState,
  from: Vec2,
  range: number,
): { enemy?: Enemy; nest?: Nest } | null {
  let bestDist = range;
  let bestEnemy: Enemy | undefined;
  let bestNest: Nest | undefined;
  for (const enemy of state.enemies.values()) {
    if (enemy.hp <= 0) continue;
    const dist = Math.hypot(enemy.pos.x - from.x, enemy.pos.y - from.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestEnemy = enemy;
      bestNest = undefined;
    }
  }
  for (const nest of state.nests) {
    if (!nest.alive) continue;
    const dist = Math.hypot(nest.pos.x - from.x, nest.pos.y - from.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestNest = nest;
      bestEnemy = undefined;
    }
  }
  if (!bestEnemy && !bestNest) return null;
  return { enemy: bestEnemy, nest: bestNest };
}

// Turn this tick's accumulated damage into wire events. An enemy hit and then killed reports
// only its death.
function reapDamage(
  state: EnemyState,
  enemiesHit: Set<string>,
  nestsHit: Set<string>,
): { hits: EnemyHit[]; deaths: string[]; nests: NestDelta[] } {
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

// One enemy's pure geometric step — one of three states:
//   ENGAGED — a player or structure within AGGRO_RADIUS → chase it, never overshooting; chew on
//             it once in contact.
//   MARCH   — un-aggroed and still outside the hold edge → advance toward center, stopping
//             exactly at the edge (so it never floods the safe center).
//   HOLD    — un-aggroed and at/inside the hold edge → stop. A wave forms a front line here.
function stepEnemy(enemy: Enemy, context: StepContext): void {
  enemy.biteMs = Math.max(0, enemy.biteMs - context.dtMs);
  const speed = enemySpeed(enemy.kind) * (context.dtMs / 1000);
  const engaged = acquire(enemy, context);
  if (engaged) {
    stepToward(enemy, engaged.pos, speed, context); // ENGAGED
    return;
  }
  const { center, holdEdge } = context;
  const distFromCenter = Math.hypot(center.x - enemy.pos.x, center.y - enemy.pos.y);
  if (distFromCenter <= holdEdge) return; // HOLD
  // MARCH, capped at the edge so it never floods the safe centre.
  stepToward(enemy, center, Math.min(speed, distFromCenter - holdEdge), context);
}

interface Engagement {
  pos: Vec2;
  radius: number;
  structure?: Structure;
}

// Decide what this enemy is chasing, and set `enemy.target` to match.
//
// Lock and commit: a held target is kept until it dies or leaves AGGRO_RADIUS — an enemy chasing
// you will not swap to a closer teammate. The one override is priority: a player in range always
// beats a structure, so walking into a wave pulls it off your miner.
function acquire(enemy: Enemy, context: StepContext): Engagement | null {
  const held = resolveTarget(enemy.target, enemy.pos, context);
  if (held && enemy.target?.kind === "player") return held;

  const player = nearestWithin(context.players, enemy.pos, AGGRO_RADIUS);
  if (player) {
    enemy.target = { kind: "player", id: player.id };
    return { pos: player.pos, radius: PLAYER_RADIUS };
  }
  if (held) return held; // still locked on its structure; no player has shown up to outrank it

  const structure = nearestStructureWithin(context.build, enemy.pos, AGGRO_RADIUS);
  if (structure) {
    enemy.target = { kind: "structure", id: structure.id };
    return { pos: structureCenter(structure), radius: structureRadius(structure), structure };
  }
  enemy.target = undefined;
  return null;
}

// Where a held target is now, or null if it has died, disconnected, or left the aggro radius —
// the only two things that break a lock.
function resolveTarget(
  target: EnemyTarget | undefined,
  from: Vec2,
  context: StepContext,
): Engagement | null {
  if (!target) return null;
  const engagement = (): Engagement | null => {
    if (target.kind === "player") {
      const player = context.players.find((p) => p.id === target.id);
      return player ? { pos: player.pos, radius: PLAYER_RADIUS } : null;
    }
    const structure = context.build?.structures.get(target.id);
    if (!structure) return null;
    return { pos: structureCenter(structure), radius: structureRadius(structure), structure };
  };
  const held = engagement();
  if (!held) return null;
  const dist = Math.hypot(held.pos.x - from.x, held.pos.y - from.y);
  return dist <= AGGRO_RADIUS ? held : null;
}

// Chew on the structure in front of this enemy, on its own per-kind contact cadence. The sim is
// the sole writer of structure HP, exactly as it is for enemy and nest HP.
function bite(enemy: Enemy, structure: Structure, context: StepContext): void {
  if (enemy.biteMs > 0) return;
  structure.hp -= enemyContactDamage(enemy.kind);
  enemy.biteMs = enemyContactCadenceMs(enemy.kind);
  context.damaged.add(structure.id);
}

// The nearest structure within `radius`, or null. An enemy diverts to any structure it detects —
// this is not limited to ones standing in its path.
function nearestStructureWithin(
  build: BuildState | null,
  from: Vec2,
  radius: number,
): Structure | null {
  if (!build) return null;
  let best: Structure | null = null;
  let bestDist = radius;
  for (const s of build.structures.values()) {
    const c = structureCenter(s);
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// Move the enemy toward `to` by up to `maxTravel`, never past it — unless a structure is in the
// way, in which case it stops and bashes that structure instead.
//
// There is no pathfinding: at ENEMY_CAP 240 across a 31,200² arena a nav-grid costs more than the
// behaviour is worth (#49). The accepted price is that an enemy will chew a stray open-field wall
// rather than walk around its end. It is also what makes walling a nest in a real strategy — the
// enemies inside attack the wall.
function stepToward(enemy: Enemy, to: Vec2, maxTravel: number, context: StepContext): void {
  const dx = to.x - enemy.pos.x;
  const dy = to.y - enemy.pos.y;
  const len = Math.hypot(dx, dy);
  const travel = len === 0 ? 0 : Math.min(Math.max(maxTravel, 0), len);
  // Probing from the enemy's own position when it cannot travel is deliberate: one already
  // pressed against a structure keeps chewing rather than needing room to move first.
  const next =
    travel === 0
      ? enemy.pos
      : { x: enemy.pos.x + (dx / len) * travel, y: enemy.pos.y + (dy / len) * travel };
  const blocker = structureBlocking(context.build, next, enemyRadius(enemy.kind));
  if (blocker) bite(enemy, blocker, context);
  else enemy.pos = next;
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
  state.enemies.set(id, { id, kind, pos: { ...pos }, hp, sector, biteMs: 0 });
  return { id, kind, pos: { ...pos }, hp, sector };
}
