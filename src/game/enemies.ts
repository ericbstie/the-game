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
  WorldInit,
} from "../lobby/protocol";
import {
  ActivationQueue,
  type BuildState,
  mulberry32,
  pushOutOfSolids,
  removeStructure,
  type Structure,
  spendBullet,
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
import { clamp, DANGER_BAND_FRAC, PLAYER_RADIUS } from "./world";
import { DEFAULT_WORLD_SETTINGS, type WorldSettings } from "./worldSettings";

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
export const RANGED_DAMAGE = 3;
// Both the client's own gate and the server's admission floor (#103) — one number, so a held
// trigger can never pace itself into shots `admitAttack` refuses.
export const RANGED_CADENCE_MS = 250;

// The server's loose anti-teleport-aim tolerance: a reported swing origin this far from the
// player's last relayed position is rejected. Generous enough to survive relay lag (a player
// moves ≈52 u in one ~200 ms round-trip at 260 u/s), tight enough to reject teleport-aim.
export const ATTACK_POS_TOLERANCE = 500;

// AI: a peel-off aggro radius, and the leg an un-aggroed enemy walks before it turns.
export const AGGRO_RADIUS = 1_800; // a player this close pulls the nearest enemies off the line
// #125 removed the front-line hold edge, and nothing replaced it: no enemy stops at a radius any
// more, there is no safe centre, and nothing protects the respawn point. What an un-aggroed enemy
// does instead is wander — a straight leg on a heading drawn from the sim's own rng, re-rolled when
// the leg runs out, with no leash to the nest it came from.
//
// The leg is **provisional**: it is the persistence length of an undirected walk, so it alone sets
// how fast wanderers diffuse inward, and only a played match can judge it.
export const WANDER_LEG_MS = 3_000; // 546 u of walking at GRUNT_SPEED

// Nests — the static spawners scattered through the outer arena. The count, the band, the bias, the
// HP pair and the wanderer chance are all **provisional** (#123): only a played match can judge
// them, and a later change to one of them is a retune rather than a correction. The count and the
// bias are knobs now (`WorldSettings.nestCount`, `nestEdgeBias`); the rest are not, because nobody
// asked for them.
export const NEST_RADIUS = 48;
// The band they are placed in, as a radius from arena centre. Inner is two aggro radii, so the
// squad never spawns already inside a nest's notice; outer is the mid-band inset the ore gradient
// also reaches to, so a nest is never buried in the wall.
export const NEST_BAND_INNER = 2 * AGGRO_RADIUS; // 3,600 u
export function nestBandOuter(arena: Arena): number {
  return (Math.min(arena.width, arena.height) / 2) * (1 - DANGER_BAND_FRAC); // 14,352 u at 31,200
}
// The radial fraction is sampled as u ** (1 / nestEdgeBias) — the same curve and the same exponent
// the ore gradient uses (`WorldSettings.oreEdgeBias`), and deliberately a separate knob from it
// (`docs/adr/0005`) — which puts ~91% of the nests in the outer half of the band. The squad has to
// push outward to find most of them.
//
// HP and type both read off that same fraction, so distance is the only dial: an inner nest is
// cheap to clear and sends hunters; an outer one is a long fight that mostly leaks wanderers.
export const NEST_HP_INNER = 150;
export const NEST_HP_OUTER = 600;
export const WANDERER_CHANCE_OUTER = 0.9; // at the inner bound it is 0, and linear between
const SPAWN_JITTER = 300; // grunts spawn within this radius of their nest, so they don't stack

// Spawning (#124): every nest keeps its own timer, and three curves escalate what that timer fires.
// The curves and the concurrency cap are knobs (`WorldSettings.nestPeriod`, `waveSize`,
// `eliteShare`, `enemyCap`); the grace is not. All of them are **provisional** — only a played match
// can judge them, and a later change to one of them is a retune rather than a correction.
//
// Nothing spawns for the first minute: the squad gets one minute to hand-mine before the first wave
// (~60 Metal at HAND_MINE_RATE 1 — one miner, with 10 spare).
export const SPAWN_GRACE_MS = 60_000;
// The curves are anchored at the *end* of the grace, so the first wave a squad ever meets is a
// starting value: one grunt, no elite, and 60 s until the next. Anchoring them at 0:00 instead would
// make all three starting values unobservable — a wave of 1 and a 0% elite share would exist only
// during the minute in which no nest fires — so #111's "max rate at 10:00 / capped at 4:00 / capped
// at 6:00" annotations land one minute later here than they read there.
const ESCALATION_STEP_MS = 60_000; // "per minute", the step every curve below is quantised to

// Whole minutes of spawning elapsed: 0 for the grace and for the first minute after it, then one
// per minute. Quantised rather than continuous, so a wave fired a tick apart from another is fired
// on the same terms — the curves are a drumbeat, not a slope.
function escalation(elapsedMs: number): number {
  return Math.max(0, Math.floor((elapsedMs - SPAWN_GRACE_MS) / ESCALATION_STEP_MS));
}

// How long a nest waits between waves at this point in the match.
export function nestPeriodMs(
  elapsedMs: number,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): number {
  const { startMs, fallMs, floorMs } = settings.nestPeriod;
  return Math.max(floorMs, startMs - escalation(elapsedMs) * fallMs);
}

// How many enemies one nest's wave carries.
export function waveSize(
  elapsedMs: number,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): number {
  const { start, growth, max } = settings.waveSize;
  return Math.min(max, start + escalation(elapsedMs) * growth);
}

// The chance each enemy in a wave is an elite rather than a grunt — a share, drawn per enemy, so a
// wave of 5 at 30% is usually one or two elites rather than exactly 1.5.
//
// Whole percentage points divided at the end, not a repeated float addition: 0.05 accumulated six
// times is 0.30000000000000004, which is not 30%.
export function eliteShare(
  elapsedMs: number,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): number {
  const { ptsPerMin, max } = settings.eliteShare;
  return Math.min(max, (escalation(elapsedMs) * ptsPerMin) / 100);
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

// One live enemy. `target` is what it is currently chasing (ENGAGED), held until that target dies
// or leaves range. `biteMs` counts down to its next bite on a structure — driven by the injected
// `dtMs`, never a clock, so the sim stays deterministic.
//
// `hunt` is what a hunter nest's wave was sent after (#124): the player nearest the nest when the
// wave fired, committed to for this enemy's whole life and chased at any distance. It is a standing
// commitment rather than a lock — `target` still overrides it for anything inside AGGRO_RADIUS —
// which is why the two are separate fields. An enemy out of a wanderer nest has none.
//
// `wander` is the leg it is walking when nothing at all has its attention (#125): a heading in
// radians and what is left of the leg. Absent until it first wanders. Both fields are server-only
// and neither is announced — which is what keeps a nest's kind off the wire, since the only trace a
// wanderer nest leaves is that its wave walks its own way instead of at somebody (ADR 0004).
export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  biteMs: number;
  target?: EnemyTarget;
  hunt?: PlayerId;
  wander?: { rad: number; ms: number };
}

// What a nest sends. A hunter nest fires waves committed to a player at any distance (#124); a
// wanderer nest leaks enemies that roam free, unleashed from the nest and aimed at nobody (#125).
// Chosen once at world gen and fixed for the match, and deliberately invisible: the two look
// identical, so the only way to learn which a nest is, is to watch what comes out of it. That is
// why `RenderedNest` carries no kind — the render layer is never told.
export type NestKind = "hunter" | "wanderer";

// A spawner nest: static position/kind/maxHp, dynamic hp/alive. Killing one reduces the pressure
// around it; clearing all fifty is not expected (#111).
export interface Nest {
  id: string;
  pos: Vec2;
  hp: number;
  maxHp: number; // scaled by distance, so it is per-nest rather than one constant
  alive: boolean;
  kind: NestKind;
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
// `moves`, enemies spawned this tick, damaged enemies' new HP, killed ids, and damaged/silenced
// nests.
export interface EnemyEvents {
  moves: EnemyMove[];
  spawns: EnemySpawn[];
  hits: EnemyHit[];
  deaths: string[];
  nests: NestDelta[];
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
  // Unconditional, including for an already-unit vector, which float division can shift by an ULP.
  // A `len === 1` fast path would be exact-equality on untrusted input, guarding a difference of
  // 1e-16 world units that nothing downstream can observe — the security property is worth more
  // than the idempotence.
  return { x: report.dir.x / len, y: report.dir.y / len };
}

export interface EnemyState {
  arena: Arena;
  enemies: Map<string, Enemy>;
  nests: Nest[];
  elapsedMs: number; // match clock, driven by the injected `dtMs`; the three curves read off it
  // Each nest's countdown to its own next wave, by nest id. There is no global wave clock and no
  // wave index (#124): fifty nests on fifty phases, so nothing is synchronised but by coincidence.
  //
  // Here rather than on `Nest` because a `Nest` is derived from the world seed on both sides of the
  // wire (ADR 0004), and a timer is sim state the client has no business holding. Here rather than
  // in module scope because this module is pure.
  nestTimers: Map<string, number>;
  rng: () => number;
  // The knobs this sim runs on (#127), carried as data for the same reason the timers are: config in
  // module scope would be shared state, and two sims of two worlds could not run in one process.
  settings: WorldSettings;
  nextId: number;
}

// The fifty nests, scattered at random through the band and biased toward the wall.
//
// Derived from a seed rather than streamed (ADR 0004): `WorldInit.nestSeed` is the only thing that
// crosses the wire, and both sides expand it into a byte-identical layout exactly as they already do
// for the ore grid. `mulberry32` is what makes the two agree.
//
// Pure, and pointedly not fed by the sim's own `rng`: the layout a session gets is fixed by its
// world-init, so no amount of stepping can move a nest, and a reconnecting client rebuilding from
// the same world-init lands on the same fifty.
export function nestLayout(
  arena: Arena,
  seed: number,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): Nest[] {
  const rng = mulberry32(seed);
  const cx = arena.width / 2;
  const cy = arena.height / 2;
  const span = nestBandOuter(arena) - NEST_BAND_INNER;
  return Array.from({ length: settings.nestCount }, (_, k) => {
    const angle = rng() * 2 * Math.PI;
    // How far out this nest sits: 0 at the inner bound, 1 at the outer. One biased draw, and then
    // the only thing HP and type are read from — distance is the whole gradient.
    const outward = rng() ** (1 / settings.nestEdgeBias);
    const reach = NEST_BAND_INNER + outward * span;
    // Whole HP, so it rides the wire as one number rather than seventeen digits of float (#84).
    const hp = Math.round(NEST_HP_INNER + outward * (NEST_HP_OUTER - NEST_HP_INNER));
    return {
      id: `n${k}`,
      pos: { x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach },
      hp,
      maxHp: hp,
      alive: true,
      kind: rng() < outward * WANDERER_CHANCE_OUTER ? "wanderer" : "hunter",
    };
  });
}

// Snapshot the live sim for the reconnect keyframe: every current enemy and every nest's state.
// Positions are copied so the snapshot never aliases live state. The per-nest timers are absent
// deliberately — a client draws no countdown, and #124 left no global clock to draw one from.
export function snapshotEnemies(state: EnemyState): {
  enemies: EnemySnapshot[];
  nests: NestSnapshot[];
} {
  return {
    enemies: [...state.enemies.values()].map((e) => ({
      id: e.id,
      kind: e.kind,
      pos: { ...e.pos },
      hp: e.hp,
    })),
    nests: state.nests.map((n) => ({
      id: n.id,
      pos: { ...n.pos },
      hp: n.hp,
      alive: n.alive,
    })),
  };
}

// Seed the sim from the world: place the nests and arm each one's own timer. No enemies yet — the
// grace is enforced here rather than by a guard in the tick, by never arming a nest inside it: the
// first wave of the match lands at 1:00 at the earliest, and each nest is dealt its own phase
// through the first period so fifty of them do not fire together.
export function spawnEnemyState(
  world: WorldInit,
  rng: () => number = Math.random,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): EnemyState {
  const nests = nestLayout(world.arena, world.nestSeed, settings);
  return {
    arena: world.arena,
    enemies: new Map(),
    nests,
    elapsedMs: 0,
    nestTimers: new Map(
      nests.map((n) => [n.id, SPAWN_GRACE_MS + rng() * settings.nestPeriod.startMs]),
    ),
    rng,
    settings,
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
  const spawns = tickNests(state, players, dtMs, build);
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
    arena: state.arena,
    rng: state.rng,
    dtMs,
    damaged: new Set<string>(),
  };
  for (const enemy of state.enemies.values()) stepEnemy(enemy, context);

  const moves: EnemyMove[] = [];
  // Whole world units on the wire. 1 unit = 1 CSS px at the fixed M4 zoom, so the discarded
  // precision is strictly sub-pixel — and not even sub-pixel *motion*, since the client
  // interpolates between samples. `enemy.pos` itself keeps every bit (#84).
  for (const enemy of state.enemies.values())
    moves.push([enemy.id, Math.round(enemy.pos.x), Math.round(enemy.pos.y)]);
  return {
    state,
    events: { moves, spawns, hits, deaths, nests, aims, shots, ...reapStructures(context) },
  };
}

// Everything one enemy's step reads, plus the structures it chewed on. Bundled so `stepEnemy`
// keeps a single parameter as targeting grows.
interface StepContext {
  players: PlayerRef[];
  build: BuildState | null;
  arena: Arena; // the walls a wandering enemy is kept inside
  // The sim's own injected rng, threaded rather than reached for: a wander heading is the one thing
  // an enemy's step needs entropy for, and taking it from here is what keeps the module pure.
  rng: () => number;
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

// Advance the match clock and every live nest's own timer; a nest whose timer runs out fires a wave
// and re-arms on the period the curve gives at that moment. Real ticks are ~50 ms against a period
// floored at 10 s, so a nest fires at most once per step — and a `dtMs` big enough to owe two waves
// pays the second on the next tick rather than bursting, which is what keeps the cap the only thing
// that ever governs density.
function tickNests(
  state: EnemyState,
  players: PlayerRef[],
  dtMs: number,
  build: BuildState | null,
): EnemySpawn[] {
  state.elapsedMs += dtMs;
  const spawns: EnemySpawn[] = [];
  for (const nest of state.nests) {
    if (!nest.alive) continue; // silenced: it drops out of the drumbeat for good
    const due = (state.nestTimers.get(nest.id) ?? 0) - dtMs;
    const fires = due <= 0;
    state.nestTimers.set(
      nest.id,
      fires ? due + nestPeriodMs(state.elapsedMs, state.settings) : due,
    );
    if (fires) spawns.push(...fireNestWave(state, nest, players, build));
  }
  return spawns;
}

// One nest's wave: `waveSize` enemies at its own position, each one drawn against `eliteShare`, all
// up to the concurrency cap. A nest that would breach `enemyCap` holds its remainder.
//
// A hunter nest aims the whole wave at the player nearest the nest, at any distance — that is what
// keeps hunters the early threat when the edge bias has put almost every nest far from centre. A
// wanderer nest sends its wave after nobody. The nest's kind is read here and nowhere else, and it
// reaches the client only as what the wave then does (ADR 0004).
function fireNestWave(
  state: EnemyState,
  nest: Nest,
  players: PlayerRef[],
  build: BuildState | null,
): EnemySpawn[] {
  const size = waveSize(state.elapsedMs, state.settings);
  const share = eliteShare(state.elapsedMs, state.settings);
  const hunt =
    nest.kind === "hunter"
      ? nearestWithin(players, nest.pos, Number.POSITIVE_INFINITY)?.id
      : undefined;
  const spawns: EnemySpawn[] = [];
  for (let i = 0; i < size; i++) {
    if (state.enemies.size >= state.settings.enemyCap) break; // cap governor holds the remainder
    const kind: EnemyKind = state.rng() < share ? "elite" : "grunt";
    // A nest walled in is a legitimate strategy, so a wave that lands inside a footprint still
    // spawns — the overlapping enemy is simply pushed clear.
    const at = pushOutOfSolids(build, jitter(nest.pos, state.rng), enemyRadius(kind));
    spawns.push(addEnemy(state, kind, at, hunt));
  }
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
// A shot's aim, trimmed to what the line can show: three decimals on a unit vector is under half
// a world unit of lateral drift at RANGED_RANGE, and one unit is one CSS px.
//
// A copy, deliberately. `attack.dir` is the vector `nearestRayHit` resolves against, and rounding
// the authoritative input would be a gameplay change wearing a bandwidth ticket's clothes (#84).
function wireDir(dir: Vec2): Vec2 {
  return { x: Math.round(dir.x * 1000) / 1000, y: Math.round(dir.y * 1000) / 1000 };
}

function applyAttacks(
  state: EnemyState,
  attacks: Attack[],
  enemiesHit: Set<string>,
  nestsHit: Set<string>,
  shots: PeerShot[],
): void {
  for (const attack of attacks) {
    const hit = nearestRayHit(state, attack);
    const shot: PeerShot = { id: attack.by, dir: wireDir(attack.dir) };
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
// pair is snapshotted before it moves and diffed once the power budget has settled. It is written
// by the same pass that applies `TURRET_DAMAGE`, so it cannot outlive the damage by more than one
// tick. Nothing is remembered between ticks: every client gets the same delta, every tick.
//
// The ammo precondition below is deliberately *not* in that transition, and the client gates the
// train on the pool it already mirrors instead. Putting it here would mean an aim transition per
// engaged turret every time the pool crossed zero — which is every few ticks in exactly the scarce
// regime #102 designs for, on a field whose whole point is that it is sparse.
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
    // The last precondition, and the one that is squad-wide: a turret shoots the same bullets a
    // player does, and an empty pool holds its fire. Taken before the cadence is charged, so
    // holding fire costs the turret nothing and the first bullet forged is fired at once.
    if (!spendBullet(build.ammo)) continue;
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
//   HUNTING — un-aggroed, but out of a hunter nest and committed to a player → chase that player
//             at any distance, all the way in.
//   WANDER  — un-aggroed and committed to nobody → walk its own heading and turn every
//             WANDER_LEG_MS (#125).
//
// There is no state that stops at a radius. The old MARCH/HOLD pair advanced an un-aggroed enemy to
// 13,104 u and parked it, which left a guaranteed-empty circle around spawn; that circle is gone, so
// base defence is live from the first wave and the respawn point is protected by nothing.
function stepEnemy(enemy: Enemy, context: StepContext): void {
  enemy.biteMs = Math.max(0, enemy.biteMs - context.dtMs);
  const speed = enemySpeed(enemy.kind) * (context.dtMs / 1000);
  const engaged = acquire(enemy, context);
  // ENGAGED and HUNTING differ only in what `acquire` returned, never in how the step is taken.
  if (engaged) stepToward(enemy, engaged.pos, speed, context);
  else wander(enemy, speed, context);
}

// One step of an undirected walk: hold a heading for WANDER_LEG_MS, then draw another. The heading
// comes from the sim's injected rng and the leg is per-enemy state, so wandering introduces no
// ambient randomness and no module state — two sims of one world still step identically (M3).
//
// The walk is undirected, so it diffuses rather than advances: a wanderer covers ~546 u per leg but
// its net displacement grows with the square root of the legs, which is what keeps the early game
// open while wanderers accumulate near centre over a long match. And it is unleashed — nothing pulls
// it back toward its nest — so the only gradient in the arena is where the nests are.
//
// Clamped inside the walls, because an undirected walk that drew an outward heading near the
// perimeter would otherwise leave the arena for good.
function wander(enemy: Enemy, speed: number, context: StepContext): void {
  if (enemy.wander === undefined || enemy.wander.ms <= 0) {
    enemy.wander = { rad: context.rng() * 2 * Math.PI, ms: WANDER_LEG_MS };
  }
  enemy.wander.ms -= context.dtMs;
  const { arena } = context;
  const edge = enemyRadius(enemy.kind);
  const to = {
    x: clamp(enemy.pos.x + Math.cos(enemy.wander.rad) * speed, edge, arena.width - edge),
    y: clamp(enemy.pos.y + Math.sin(enemy.wander.rad) * speed, edge, arena.height - edge),
  };
  stepToward(enemy, to, speed, context);
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
//
// Everything inside AGGRO_RADIUS is settled before the hunt is consulted, which is how "committed
// to for life" and "still breaks off for anything on the way" hold at once: the hunt is what a
// hunter does when nothing nearer has its attention, and interrupting it never spends it.
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
  return hunted(enemy, context);
}

// Where this enemy's committed hunt is now — at any distance, with no aggro test. Null for anything
// out of a wanderer nest, and for a hunter whose player has died or disconnected: that one wanders
// like the rest until they are back, since a player keeps their id across a respawn.
function hunted(enemy: Enemy, context: StepContext): Engagement | null {
  if (enemy.hunt === undefined) return null;
  const player = context.players.find((p) => p.id === enemy.hunt);
  return player ? { pos: player.pos, radius: PLAYER_RADIUS } : null;
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
// There is no pathfinding: at a 500 enemy cap across a 31,200² arena — 2,080² tiles at TILE 15 — a
// nav-grid costs more than the behaviour is worth (#49). Doubling the cap in #125 did not weaken that
// reasoning, it strengthened it: the grid would be the same size and twice as many agents would query
// it every tick.
//
// The accepted price is that an enemy will chew a stray open-field wall rather than walk around its
// end, and #125 widened it — a wanderer meets walls anywhere on an undirected walk, where a marching
// enemy only met the ones between its nest and centre. That reads as ambient pressure on the base
// rather than as a bug, and it is the same property that makes walling a nest in a real strategy: the
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

// Add one enemy to the sim and return its spawn announcement (the client needs kind/hp before
// position deltas flow for it). `hunt` is server-only and deliberately not in the announcement.
function addEnemy(state: EnemyState, kind: EnemyKind, pos: Vec2, hunt?: PlayerId): EnemySpawn {
  const id = `e${state.nextId++}`;
  const hp = STATS[kind].hp;
  const enemy: Enemy = { id, kind, pos: { ...pos }, hp, biteMs: 0 };
  if (hunt !== undefined) enemy.hunt = hunt;
  state.enemies.set(id, enemy);
  return { id, kind, pos: { ...pos }, hp };
}
