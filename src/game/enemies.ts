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
  ProjectileSpawn,
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

// Bloodling (#140) — the third kind, and the only one that cannot be kited: it runs at you and goes
// off when it arrives. Every figure below is **provisional** — only a played match can judge one,
// and a later change to any of them is a retune rather than a correction — but each is derived off
// a number the game already fixes rather than picked out of the air.
//
// Half a grunt's HP: five shots at RANGED_DAMAGE where a grunt takes ten. That is the price of the
// speed, and it is what makes a wave of them a shooting problem rather than a wall of HP.
export const BLOODLING_HP = GRUNT_HP / 2;
export const BLOODLING_SPEED = 286; // 1.1× player — the one thing in the game you cannot outrun
export const BLOODLING_RADIUS = GRUNT_RADIUS; // a squat body, in the grunt's own box
// How near a player it gets before it goes off. Twice the distance it would have to close to bite
// one (PLAYER_RADIUS + BLOODLING_RADIUS), so it bursts a body's length short of touching you
// rather than arriving and chewing.
export const BLAST_TRIGGER = 2 * (PLAYER_RADIUS + BLOODLING_RADIUS);
// How far the blast reaches. Twice the fuse, and it has to be more than the fuse by *some* margin:
// this sim triggers on the position the hub relayed while the client judges the damage on its own
// true one (it owns its health), and a player sprinting for 200 ms covers 52 u between the two. At
// twice the fuse the margin is 60 u, and the burst is a threat to anyone standing near whoever set
// it off rather than to that player alone.
export const BLAST_RADIUS = 2 * BLAST_TRIGGER;
// What the blast takes off a player inside it. Twice the elite's bite — the largest single blow in
// the game until now — which is two fifths of PLAYER_MAX_HP: three of them kill you from full, and
// none of them alone does.
export const BLAST_DAMAGE = 40;
// The share of a nest's wave that comes out as bloodlings. Drawn off the same roll as the elite
// share and from the far end of it, so the two are independent bands of one uniform draw and a
// wave still costs exactly one number per enemy (which is what keeps this sim's rng sequence, and
// every test pinned to it, where it was). A third of `eliteShare.max`, and flat rather than
// escalating, because nothing asked for a fourth curve.
export const BLOODLING_SHARE = 0.1;

// Spiderman (#137) — the fourth kind, and the only one that does not come at you down the straight
// line: every step it takes is offset at an angle from that line, and when it is near enough it
// throws cobweb all round itself. Every figure below is **provisional** except `WEB_SLOW_MS`, which
// the ask states — only a played match can judge one, and a later change is a retune rather than a
// correction — and each is derived off a number the game already fixes rather than picked freely.

// How far off the straight line to its target each dash runs, and **the one knob the movement
// has**: the speed below follows from it.
//
// One fixed side and never the other. Alternating sides is precisely the zig-zag path the ask rules
// out, a side drawn per dash would cost the sim's rng a draw it does not otherwise take, and a
// facing index carries no memory of which way the last dash leaned — so the drawing commits to one
// lean too (`sprite/spiderman.ts`) and this is the sign that agrees with it.
export const DASH_ANGLE = (35 * Math.PI) / 180;
// Its dash speed, and the only speed it has: this kind never walks. Derived rather than chosen, off
// the one number the slant makes interesting — a dash spends `cos(DASH_ANGLE)` of itself on closing
// and the rest on going round you, so this is the speed at which it *arrives* at the elite's
// ELITE_SPEED. Fast on the ground, no faster at reaching you, which is the whole trade.
export const SPIDERMAN_SPEED = Math.round(ELITE_SPEED / Math.cos(DASH_ANGLE)); // 286
// Half again a grunt's HP: fifteen shots at RANGED_DAMAGE where a grunt takes ten. It has to survive
// its own approach, unlike a bloodling, because it is still there afterwards.
export const SPIDERMAN_HP = GRUNT_HP * 1.5;
export const SPIDERMAN_RADIUS = GRUNT_RADIUS; // a grunt's box, which is what the drawing is composed in
// How near a player it comes before it throws. Four times the distance it would have to close to
// bite one (PLAYER_RADIUS + SPIDERMAN_RADIUS), so the web is a thing thrown at you rather than
// another way of chewing on you.
export const WEB_TRIGGER = 4 * (PLAYER_RADIUS + SPIDERMAN_RADIUS);
// How far the web reaches, which has to exceed the trigger by *some* margin for the reason
// `BLAST_RADIUS` records: this sim throws on the position the hub relayed while the client judges
// the catch on its own true one (it owns its health), and a player sprinting for 200 ms covers 52 u
// between the two. The margin is 60 u — the same absolute allowance the blast leaves, because relay
// drift is a distance and not a proportion — which also makes a burst a threat to anyone standing
// near whoever set it off rather than to that player alone.
export const WEB_RADIUS = WEB_TRIGGER + 60;
// What one burst takes off a player caught in it. Well under the elite's bite, because unlike a
// blast this one repeats: the thing that threw it is still alive.
export const WEB_DAMAGE = 10;
// What is left of a caught player's speed while the web holds them.
export const WEB_SLOW = 0.5;
// How long it holds them. **Not provisional** — the ask fixes it at 0.3 s.
export const WEB_SLOW_MS = 300;
// How long before it can throw again. It is what keeps a spiderman standing next to you from being
// a permanent slow, so the feature is not defined without one.
export const WEB_CADENCE_MS = 1_500;
// The share of a nest's wave that comes out as spidermen, drawn off the same roll as the elite and
// bloodling shares and from the band directly under the bloodlings' — so the three are bands of one
// uniform draw and a wave still costs the sim exactly one number per enemy.
export const SPIDERMAN_SHARE = 0.1;

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
  // A bloodling's blow is `BLAST_DAMAGE`, and a player never sees these two: the fuse fires a body's
  // length before contact. They are what it chews a *structure* with, which the ask says nothing
  // about — so it takes the grunt's rate rather than a number of its own.
  bloodling: {
    hp: BLOODLING_HP,
    speed: BLOODLING_SPEED,
    radius: BLOODLING_RADIUS,
    contactDamage: 6,
    contactCadenceMs: 500,
  },
  // Its blow is `WEB_DAMAGE`, thrown from `WEB_TRIGGER` away. The ask says nothing about what it
  // does once it is actually touching you or chewing a wall, so those take the grunt's rate rather
  // than a number of their own.
  spiderman: {
    hp: SPIDERMAN_HP,
    speed: SPIDERMAN_SPEED,
    radius: SPIDERMAN_RADIUS,
    contactDamage: 6,
    contactCadenceMs: 500,
  },
};

// The fastest anything in the arena moves. Read off the table rather than named, so a new kind
// cannot be added without the shot sweep allowing for it (`flyProjectiles`).
const FASTEST_ENEMY = Math.max(...Object.values(STATS).map((s) => s.speed));

export function enemyContactDamage(kind: EnemyKind): number {
  return STATS[kind].contactDamage;
}

export function enemyContactCadenceMs(kind: EnemyKind): number {
  return STATS[kind].contactCadenceMs;
}

// The player's one weapon (M4 retired M3's melee/ranged pair so right-click could become
// hand-mining). #80 took the hitscan ray off it: a shot is a body that travels, and the damage
// lands on the tick it arrives rather than on the tick the hub admitted it.
export const RANGED_RANGE = 700; // how far a shot reaches from the origin before it is spent
export const RANGED_HALFWIDTH = 24; // the shot's half-thickness; a body within it is on-line
// What one connect takes off. **Unchanged by #80, and measured rather than assumed**: a shot can
// miss now, but a player's target is nearly always *closing on them*, and nothing in the arena can
// outrun a shot along the line it is running down. About 99 shots in 100 connect
// (`docs/adr/0007-a-projectile-is-derived-from-its-launch.md`), so ten connects still cost about
// ten bullets and there is nothing here to compensate for. What changed is the wording: this is a
// claim about *connects*, and how many shots those cost is the player's aim.
export const RANGED_DAMAGE = 3;
// Both the client's own gate and the server's admission floor (#103) — one number, so a held
// trigger can never pace itself into shots `admitAttack` refuses.
//
// Unchanged by #80 for the reason above, and for one of its own: at a 99% hit rate there is nothing
// for a faster trigger to make up, and a faster one would only spend the squad's Metal quicker.
export const RANGED_CADENCE_MS = 250;

// The server's loose anti-teleport-aim tolerance: a reported swing origin this far from the
// player's last relayed position is rejected. Generous enough to survive relay lag (a player
// moves ≈52 u in one ~200 ms round-trip at 260 u/s), tight enough to reject teleport-aim.
//
// Since #80 it is the second line rather than the first: a shot leaves the position the hub
// already relays for that player (`lobby.ts`'s `gameAttack`), so a reported origin is an
// admission input and never a coordinate anything is computed from. Kept because a report that
// disagrees with the stream by half a screen is a client saying something untrue about itself, and
// this is the one place that is cheap to notice.
export const ATTACK_POS_TOLERANCE = 500;

// --- Shots in flight -------------------------------------------------------------------------
// #80. A shot is a body the sim carries across ticks, and it can miss: the target it was aimed at
// has moved by the time it arrives, so the far half of the weapon's reach has to be led.
//
// **The whole flight is here, and nothing about it is client-writable.** A `game/attack` carries a
// heading and nothing else the flight reads: the origin is the position the hub already relays for
// that player, the speed and the reach are the two constants below, and where a shot has got to is
// this module's arithmetic against positions this module owns. There is no field a forged client
// could move to shorten a flight, extend a reach, or force a hit.

// How fast a shot travels, in world units per second. **Provisional** — only a played match can
// judge it, and a later change is a retune rather than a correction — but it is picked off two
// speeds the arena already fixes rather than out of the air.
//
// It is the one number that decides how much leading the game asks for. A target crossing the
// shot's line escapes when it clears `RANGED_HALFWIDTH` plus its own radius before the shot
// arrives, which for an elite (`ELITE_SPEED`, `ELITE_RADIUS`) is 48 u — reached at a range of
// 48 × PROJECTILE_SPEED / ELITE_SPEED, or 369 u here. So the near half of the 700 u reach is
// point-and-click and the far half has to be led, which is what the ask means by "you lead your
// shots". A full-reach shot is 389 ms in the air: ~23 frames at 60 Hz, and plainly a thing that
// travels rather than a line that appears.
export const PROJECTILE_SPEED = 1_800;

// The furthest any shot in the game reaches, and how long that takes. Neither rides the wire —
// both sides compile against them, which is what lets a client derive a whole flight from one
// launch (ADR 0007). The client needs the *bound* rather than the per-weapon reach, because
// nothing on the wire says which weapon fired a shot and nothing it draws differs.
export const PROJECTILE_RANGE = Math.max(RANGED_RANGE, TURRET_RANGE);
export const PROJECTILE_FLIGHT_MS = (PROJECTILE_RANGE / PROJECTILE_SPEED) * 1_000;

// One shot in flight. `left` is what remains of its reach and `damage` what it takes off whatever
// it strikes, so a player's shot and a turret's differ in the only two ways they differ and the
// flight itself never has to ask which fired it.
export interface Projectile {
  id: string;
  pos: Vec2;
  dir: Vec2; // unit; normalized at admission, or derived from the turret's bearing
  left: number;
  damage: number;
}

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
// The narrowest side that band still opens outward at — 7,827 u today (#153). The inner bound is
// absolute where the outer one scales, so a small enough box turns the band inside out: `nestLayout`
// draws a negative span and lays the nests *inward* of the inner bound, HP and wanderer share running
// backwards with them, until below 2 × `NEST_BAND_INNER` the innermost of them land past the
// perimeter — where an avatar clamped inside the walls cannot reach them and they go on firing waves
// for the rest of the match.
//
// Derived from the two constants that decide it rather than written down, and rounded up to the whole
// unit a control can print. Like `MAX_ARENA_SIDE` in `build.ts`, it is recorded beside the geometry it
// is a fact about and offered as the lobby's floor rather than enforced in the settings parser (ADR
// 0006): `worldSettings.ts` deliberately names nothing in the enemy sim, and importing `AGGRO_RADIUS`
// there is a module cycle. A smaller box is degenerate *identically* on both sides, so it desyncs
// nobody — it is simply not a world worth offering.
export const MIN_ARENA_SIDE = Math.ceil((2 * NEST_BAND_INNER) / (1 - DANGER_BAND_FRAC));
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
//
// `webMs` counts down to a spiderman's next cobweb burst (#137), on the same injected `dtMs` the
// bite cadence runs on. Absent until it first throws, and server-only like the two above: what the
// client is told is that a burst happened, never how long until the next one.
export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  biteMs: number;
  target?: EnemyTarget;
  hunt?: PlayerId;
  wander?: { rad: number; ms: number };
  webMs?: number;
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
//
// `prev` is the sample `pos` replaced — the two together are the only heading the sim has, and what
// it leads a chase by (#131). Absent for a player the hub has heard from exactly once.
export interface PlayerRef {
  id: PlayerId;
  pos: Vec2;
  prev?: Vec2;
}

// A server-validated shot the sim launches a projectile for. `pos` is the origin the hub holds
// for that player — never the one the report carried (#80) — `dir` a unit aim vector, and `by` the
// player it is attributed to. The hub admits it (cadence/range/seq) and pays its bullet before it
// reaches the sim.
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
  // The spidermen that threw cobweb this tick (#137). Ids and nothing else — where the web landed
  // is the position that enemy is already being streamed at, and a client resolves it off its own
  // interpolated buffer exactly as it resolves a death's.
  bursts: string[];
  // What was depicted this tick: turrets whose aim changed, the shots put in the air, and the
  // shots taken out of it. `projectiles` and `spent` are the whole of a shot's wire life — the
  // flight between them is derived on both sides (ADR 0007).
  aims: TurretAim[];
  projectiles: ProjectileSpawn[];
  spent: string[];
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
// hostile client can report `{x: 1e300, y: 0}` or a zero vector — and since #80 this vector is what
// the sim integrates the shot along and what rides the wire as `ProjectileSpawn`'s heading, so a
// non-unit one flies the bullet at a speed of the shooter's choosing on every client in the squad.
// Normalizing at admission is what makes the protocol's "unit aim vector" true.
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
  // Every shot currently in the air (#80). Server-only state, exactly as a wanderer's leg is: the
  // client holds its own copy of each flight, derived from the launch it was streamed, and neither
  // side ever compares them.
  projectiles: Map<string, Projectile>;
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
  // Shot ids are minted from their own counter and their own prefix, so nothing has to reason
  // about whether an id on the wire names a body or a bullet.
  nextShotId: number;
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
    projectiles: new Map(),
    nests,
    elapsedMs: 0,
    nestTimers: new Map(
      nests.map((n) => [n.id, SPAWN_GRACE_MS + rng() * settings.nestPeriod.startMs]),
    ),
    rng,
    settings,
    nextId: 1,
    nextShotId: 1,
  };
}

// Advance the whole sim one tick. Mutates `state` in place (one state per session, stepped at
// 20 Hz) and returns the same reference plus the events to broadcast. Deterministic in
// (state, players, attacks, build, dtMs).
//
// The order is what makes a shot a thing that travels rather than a thing that resolves. Shots
// already in the air land **first**, so a target killed by one neither moves nor appears in
// `moves` this tick and the turrets below never fire at it; only then are this tick's shots put in
// the air, and only then do the survivors chase and chew. A shot therefore spends at least one
// whole tick in flight, including the point-blank one — there is no distance at which the weapon
// is still hitscan.
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
  const projectiles: ProjectileSpawn[] = [];
  const spent: string[] = [];
  const aims: TurretAim[] = [];
  flyProjectiles(state, dtMs, enemiesHit, nestsHit, spent);
  fireAttacks(state, attacks, projectiles);
  stepTurrets(state, build, dtMs, aims, projectiles);
  const { hits, deaths, nests } = reapDamage(state, enemiesHit, nestsHit);

  const context: StepContext = {
    players,
    build,
    arena: state.arena,
    rng: state.rng,
    dtMs,
    damaged: new Set<string>(),
    blasts: new Set<string>(),
    bursts: new Set<string>(),
  };
  for (const enemy of state.enemies.values()) stepEnemy(enemy, context);
  // A bloodling that reached a player is taken off the field here, before `moves` is built, so it
  // is reported once — as a death — exactly as an enemy killed by a shot is. Its own kind is the
  // only thing that kills it this way, and the blast it deals is not this module's to apply: the
  // client owns its health and judges the blow at its own true position (`lobby.ts:743`).
  for (const id of context.blasts) {
    state.enemies.delete(id);
    deaths.push(id);
  }

  const moves: EnemyMove[] = [];
  // Whole world units on the wire. 1 unit = 1 CSS px at the fixed M4 zoom, so the discarded
  // precision is strictly sub-pixel — and not even sub-pixel *motion*, since the client
  // interpolates between samples. `enemy.pos` itself keeps every bit (#84).
  for (const enemy of state.enemies.values())
    moves.push([enemy.id, Math.round(enemy.pos.x), Math.round(enemy.pos.y)]);
  return {
    state,
    events: {
      moves,
      spawns,
      hits,
      deaths,
      nests,
      aims,
      projectiles,
      spent,
      // A spiderman survives its own burst, so — unlike a bloodling's blast, which rides the death
      // the client is already streamed — nothing else on the wire can carry this and it is its own
      // event. What it is not is a body: the web leaves nothing behind and outlives nothing.
      bursts: [...context.bursts],
      ...reapStructures(context),
    },
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
  blasts: Set<string>; // bloodlings that went off this tick, resolved into deaths at the end
  bursts: Set<string>; // spidermen that threw cobweb this tick, announced as themselves
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
    // One draw decides the kind, read as four bands: the elite share at the bottom, the bloodling
    // share at the top, the spiderman share directly under it, and a grunt for everything between
    // them. One number per enemy however many kinds there are, so a wave costs the sim's rng exactly
    // what it always has.
    const roll = state.rng();
    const kind: EnemyKind =
      roll < share
        ? "elite"
        : roll >= 1 - BLOODLING_SHARE
          ? "bloodling"
          : roll >= 1 - BLOODLING_SHARE - SPIDERMAN_SHARE
            ? "spiderman"
            : "grunt";
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

// A shot's aim, trimmed to what a drawing can show: three decimals on a unit vector is under half
// a world unit of lateral drift at RANGED_RANGE, and one unit is one CSS px.
//
// Serialisation only. The `Projectile` keeps the exact vector it was launched on — rounding the
// heading the sim integrates would be a gameplay change wearing a bandwidth ticket's clothes
// (#84) — and the client integrates the rounded one, which after a whole 700 u flight is under
// half a unit apart from it.
function wireAxis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Put one shot in the air and announce it. The single place a `Projectile` is created, and the
// single place a `ProjectileSpawn` is: a shot exists on the wire because it exists in the sim,
// which is what closes #85 for a projectile the same way it was closed for a line — a refused
// attack never reaches `pendingAttacks`, never reaches `fireAttacks`, and has no path here.
function launch(
  state: EnemyState,
  from: Vec2,
  dir: Vec2,
  reach: number,
  damage: number,
): ProjectileSpawn {
  const id = `s${state.nextShotId++}`;
  state.projectiles.set(id, { id, pos: { ...from }, dir: { ...dir }, left: reach, damage });
  return [id, Math.round(from.x), Math.round(from.y), wireAxis(dir.x), wireAxis(dir.y)];
}

// This tick's admitted attacks, put in the air. No damage is applied here at all: an admitted
// attack buys a body in flight, and what that body reaches is decided on a later tick by
// `flyProjectiles`.
function fireAttacks(state: EnemyState, attacks: Attack[], out: ProjectileSpawn[]): void {
  for (const attack of attacks) {
    out.push(launch(state, attack.pos, attack.dir, RANGED_RANGE, RANGED_DAMAGE));
  }
}

// Advance every shot in the air by one tick and apply what it reached — this sim is the sole
// writer of enemy and nest HP, and this is now the only pass in it that writes either from a shot.
//
// Each shot is resolved against the **segment it swept this tick**, not the point it landed on: at
// PROJECTILE_SPEED a shot crosses 90 u in a 50 ms tick and a grunt is 32 u across, so a point test
// would step clean over most of what the game asks the player to shoot at. A shot that reaches
// something stops at the closest approach to it, which is where the blow lands and where the
// client's own copy of the flight ends.
//
// A shot passes through walls, exactly as the hitscan ray it replaces did: there is no line of
// sight in this game and no firing lane, and nothing asked for one.
function flyProjectiles(
  state: EnemyState,
  dtMs: number,
  enemiesHit: Set<string>,
  nestsHit: Set<string>,
  spent: string[],
): void {
  const travel = (PROJECTILE_SPEED * dtMs) / 1000;
  // How far past the swept segment a body is still caught. **The bodies move between ticks too**,
  // and towards the shot as often as not: a grunt closing head-on shortens the gap by its own
  // step as well as by the shot's, so one that sat a few units past this tick's far end can be
  // *behind* the near end of the next tick's without either sweep ever containing it. At
  // `FASTEST_ENEMY` that seam swallowed about a tenth of every head-on shot in the game.
  //
  // The allowance is exactly one step of the fastest thing that could be closing, which is what
  // makes the seam provably empty rather than merely narrow: a body can only leave the far end by
  // more than the sweep advances if it moved faster than that. What it costs is that a body up to
  // one of its own steps beyond the sweep is struck a tick early, by a shot that was going to
  // reach it regardless — nothing can outrun a shot along its own line at a quarter of its speed.
  const slack = (FASTEST_ENEMY * dtMs) / 1000;
  for (const shot of state.projectiles.values()) {
    // Clamped to what is left of the reach, so the last tick of a flight is a short one and a shot
    // covers exactly its range rather than a whole number of ticks' worth.
    const reach = Math.min(travel, shot.left);
    const struck = nearestHitAlong(state, shot.pos, shot.dir, reach, slack);
    if (struck?.enemy) {
      struck.enemy.hp -= shot.damage;
      enemiesHit.add(struck.enemy.id);
    } else if (struck?.nest) {
      struck.nest.hp -= shot.damage;
      nestsHit.add(struck.nest.id);
    }
    const flown = struck ? struck.at : reach;
    shot.pos = { x: shot.pos.x + shot.dir.x * flown, y: shot.pos.y + shot.dir.y * flown };
    shot.left -= flown;
    if (struck || shot.left <= 0) {
      state.projectiles.delete(shot.id);
      spent.push(shot.id);
    }
  }
}

// Advance every turret one tick: hold or re-acquire a target, settle the power budget, and let
// the turrets that won power fire on their own cadence.
//
// A turret shoots at the nearest thing in range — enemy or nest, whichever is closer, with no
// lowest-HP or elite priority — and since #80 it shoots *at* it rather than hitting it: the shot
// is a projectile like a player's, launched on the bearing to where that target stands this tick,
// and it misses on exactly the same terms. A turret does not lead, so its miss is the plain
// geometric one; leading was not asked for and giving it would make a turret a better shot than
// the squad.
//
// It fires straight through walls and structures, exactly as its hitscan ray did: turrets need no
// line of sight and no firing lane, so there is deliberately no shot-vs-structure test anywhere.
// Nests are legitimate targets, so a forward turret line sieges one unattended.
//
// The `(targetId, powered)` transition streamed from here is no longer what draws a turret's fire
// — every shot is its own event now — but it is still what draws the **unpowered lightning**, so
// it stays exactly as #74 shaped it. Each turret's pair is snapshotted before it moves and diffed
// once the power budget has settled; nothing is remembered between ticks.
//
// The ammo precondition below is deliberately *not* in that transition. It never needed to be, and
// since #80 it could not be: a shot the pool refused is a shot with no `ProjectileSpawn`, so the
// client is told by the absence of the event rather than by the state.
function stepTurrets(
  state: EnemyState,
  build: BuildState | null,
  dtMs: number,
  aims: TurretAim[],
  projectiles: ProjectileSpawn[],
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
    // Power is the whole price of a shot, and the gate above is the whole of it (#155). A turret
    // takes nothing from the squad's ammo pool and nothing from the bank, so an empty pool does
    // not hold its fire and a miss costs time rather than Metal.
    runtime.cooldownMs = TURRET_CADENCE_MS;
    const at = target.enemy?.pos ?? target.nest?.pos;
    if (!at) continue;
    const from = structureCenter(turret);
    projectiles.push(launch(state, from, bearing(from, at), TURRET_RANGE, TURRET_DAMAGE));
  }
}

// The unit heading from one point to another, or due east if the two coincide. A turret standing
// exactly on what it is shooting at has no bearing to fire on, and a shot down its own barrel
// reaches that target on its first tick whichever way it was pointed.
function bearing(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
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

// The single nearest thing a segment from `from`, `reach` long on the unit heading `dir`, sweeps
// past — an enemy or a nest, whichever comes first — inside `RANGED_HALFWIDTH` plus that thing's
// own radius, and up to `slack` past the far end. `at` is how far the shot travels to reach it,
// which is never more than `reach`: the allowance widens what is *caught*, never what is covered.
//
// A degenerate zero-length heading sweeps nothing: `along` is 0 for every candidate and `perp`
// their whole distance, so only something already on top of the muzzle could match.
function nearestHitAlong(
  state: EnemyState,
  from: Vec2,
  dir: Vec2,
  reach: number,
  slack: number,
): { enemy?: Enemy; nest?: Nest; at: number } | null {
  // Distance along the segment to a body at `pos`, or null if it is behind the near end, past the
  // far end and the allowance, or off to one side.
  const alongIfHit = (pos: Vec2, radius: number): number | null => {
    const rx = pos.x - from.x;
    const ry = pos.y - from.y;
    const along = rx * dir.x + ry * dir.y;
    if (along < 0 || along > reach + slack) return null;
    const perp = Math.hypot(rx - along * dir.x, ry - along * dir.y);
    return perp <= RANGED_HALFWIDTH + radius ? Math.min(along, reach) : null;
  };
  let best: { at: number; enemy?: Enemy; nest?: Nest } | null = null;
  for (const enemy of state.enemies.values()) {
    if (enemy.hp <= 0) continue;
    const at = alongIfHit(enemy.pos, enemyRadius(enemy.kind));
    if (at !== null && (best === null || at < best.at)) best = { at, enemy };
  }
  for (const nest of state.nests) {
    if (!nest.alive) continue;
    const at = alongIfHit(nest.pos, NEST_RADIUS);
    if (at !== null && (best === null || at < best.at)) best = { at, nest };
  }
  return best;
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
  if (engaged) stepToward(enemy, dashPoint(enemy, engaged.lead, speed), speed, context);
  else wander(enemy, speed, context);
  if (enemy.kind === "bloodling") fuse(enemy, context);
  if (enemy.kind === "spiderman") throwWeb(enemy, context);
}

// Where this enemy actually steers, which for every kind but one is the point it is chasing.
//
// A spiderman comes at you on the slant (#137): its heading is the bearing to that point turned by
// `DASH_ANGLE`, and the destination handed back is one step along it. Turned every tick and not once
// per leg, which is what makes "each dash is offset at an angle from the straight line to the
// player" true at every instant rather than only at the instant a leg began.
//
// Always the same way round, so the path is one converging curve and never a weave — the ask rules
// out a zig-zag, and a zig-zag is exactly what a side that alternates draws. It still closes: a step
// of `speed` shortens the gap by `speed × cos(DASH_ANGLE)`, and the sign is the one whose curve
// agrees with the lean the sprite is drawn with.
//
// A point handed back rather than a position written, so the dash goes through `stepToward` like
// every other movement in this module and a spiderman bashes a wall in its way exactly as a grunt
// does. Called from the engaged path alone — see `wander` for why an undirected walk stays straight.
function dashPoint(enemy: Enemy, lead: Vec2, speed: number): Vec2 {
  if (enemy.kind !== "spiderman") return lead;
  const dx = lead.x - enemy.pos.x;
  const dy = lead.y - enemy.pos.y;
  if (dx === 0 && dy === 0) return lead; // standing on it: no line to be offset from
  const heading = Math.atan2(dy, dx) - DASH_ANGLE;
  return { x: enemy.pos.x + Math.cos(heading) * speed, y: enemy.pos.y + Math.sin(heading) * speed };
}

// A spiderman's cobweb (#137): a player within `WEB_TRIGGER` and it throws, all round itself, then
// waits out `WEB_CADENCE_MS` before it can throw again.
//
// Judged after the step for the reason a bloodling's fuse is, and on a *player* for the same one: it
// is thrown at the squad, so a base standing next to one is not webbed. Deliberately not read off
// `acquire` either — that answers what this enemy is *chasing*, and a burst is not a target: it goes
// off all round the creature, so anyone near enough is caught.
//
// What it does to whoever is caught is not this module's to apply. The client owns its health and
// judges the blow at its own true position (`lobby.ts`), and it owns its movement too — so the slow
// is applied by that player's own client off the burst it is told about, on exactly the terms the
// blast's damage already lands on.
function throwWeb(enemy: Enemy, context: StepContext): void {
  enemy.webMs = Math.max(0, (enemy.webMs ?? 0) - context.dtMs);
  if (enemy.webMs > 0) return;
  if (!nearestWithin(context.players, enemy.pos, WEB_TRIGGER)) return;
  enemy.webMs = WEB_CADENCE_MS;
  context.bursts.add(enemy.id);
}

// A bloodling's proximity fuse (#140): a player this close and it goes off, wherever it was headed.
//
// Judged after the step, so one that closes the last of the gap this tick bursts on arrival rather
// than a tick later — and on a *player*, never on a structure, so a squad's base is safe from
// something that will kill them for standing next to it.
//
// Deliberately not read off `acquire`: that answers what the enemy is *chasing*, and lock-and-commit
// means a bloodling chasing you across the arena will run straight past your teammate. A fuse is not
// a target — anyone near enough sets it off. It is the body it is measured against and never the
// lead point navigation steers at, on #131's own reasoning: a phantom point ahead of a sprinting
// player is not a place anybody is standing.
function fuse(enemy: Enemy, context: StepContext): void {
  if (nearestWithin(context.players, enemy.pos, BLAST_TRIGGER)) context.blasts.add(enemy.id);
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
  // Straight down the drawn heading, spiderman included: the slant is defined against the line to
  // the *player*, and a wanderer has no player. Slanting here would also fight the clamp above,
  // which keeps `wander.rad` inside the walls and would then be walked off by `DASH_ANGLE`.
  stepToward(enemy, to, speed, context);
}

// What an enemy is engaged with: where it is, and where the enemy steers for it. The two differ
// only for a moving player (#131) — `pos` is the body, which aggro and the lock are judged on, and
// `lead` is the phantom point ahead of it that navigation aims at.
interface Engagement {
  pos: Vec2;
  lead: Vec2;
  radius: number;
  structure?: Structure;
}

// The lead point, and the one place it is worked out. An enemy steers at where the player is going
// rather than where they are: `prev` and `pos` are the last two samples the hub accepted, so their
// difference is the heading, and the lead sits half the current gap along it.
//
// Half of *this* gap and no more is what makes the rule self-cancelling: the chase point is never
// more than 30° off the straight line to the player (sin θ = ½), so an enemy always closes at ≥ 86%
// of its speed, and the lead shrinks to nothing at contact.
//
// A player standing still reports the same point twice, so the delta is exactly zero and the lead
// collapses onto the raw position — as it does for a player the hub has only one sample of.
//
// Clamped into the arena rather than capped in length: a hunter chasing from across the box leads by
// thousands of units, and a point out past the wall would steer it at a corner nobody can stand in.
// The bound is the player's own — a lead is a place the player could be, so it is bounded exactly
// where `stepPos` bounds them.
function engagePlayer(player: PlayerRef, from: Vec2, arena: Arena): Engagement {
  const prev = player.prev ?? player.pos;
  const dx = player.pos.x - prev.x;
  const dy = player.pos.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { pos: player.pos, lead: player.pos, radius: PLAYER_RADIUS };
  const reach = Math.hypot(player.pos.x - from.x, player.pos.y - from.y) / 2;
  return {
    pos: player.pos,
    lead: {
      x: clamp(player.pos.x + (dx / len) * reach, PLAYER_RADIUS, arena.width - PLAYER_RADIUS),
      y: clamp(player.pos.y + (dy / len) * reach, PLAYER_RADIUS, arena.height - PLAYER_RADIUS),
    },
    radius: PLAYER_RADIUS,
  };
}

// A structure does not move, so there is nothing to lead: the enemy steers at it.
function engageStructure(structure: Structure): Engagement {
  const pos = structureCenter(structure);
  return { pos, lead: pos, radius: structureRadius(structure), structure };
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
    return engagePlayer(player, enemy.pos, context.arena);
  }
  if (held) return held; // still locked on its structure; no player has shown up to outrank it

  const structure = nearestStructureWithin(context.build, enemy.pos, AGGRO_RADIUS);
  if (structure) {
    enemy.target = { kind: "structure", id: structure.id };
    return engageStructure(structure);
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
  return player ? engagePlayer(player, enemy.pos, context.arena) : null;
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
      return player ? engagePlayer(player, from, context.arena) : null;
    }
    const structure = context.build?.structures.get(target.id);
    if (!structure) return null;
    return engageStructure(structure);
  };
  const held = engagement();
  if (!held) return null;
  // The body, never the lead: a phantom point that wandered out of range would break a lock on a
  // player standing right next to the enemy (#131).
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
