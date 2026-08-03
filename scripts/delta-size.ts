import {
  BUILDABLES,
  type BuildableSpec,
  freshBuildState,
  mulberry32,
  placeStructure,
  TURRET_CADENCE_MS,
  tileOf,
} from "../src/game/build";
import {
  PROJECTILE_FLIGHT_MS,
  PROJECTILE_SPEED,
  RANGED_CADENCE_MS,
  spawnEnemyState,
  stepEnemies,
} from "../src/game/enemies";
import { generateWorld } from "../src/game/world";
import { DEFAULT_WORLD_SETTINGS } from "../src/game/worldSettings";
import type { EnemyMove, MapDelta, ProjectileSpawn, Vec2, WorldInit } from "../src/lobby/protocol";

// Measure `game/map-delta` at the caps the game actually supports, and show what the wire costs
// with and without the display-precision trim of #84.
//
//   bun run delta:size
//   bun run delta:size --json     # the same figures, for a diff
//
// The delta is assembled here exactly as `LobbyHub.tick` assembles it — every optional array
// rides only when non-empty — and it is fed by a real `stepEnemies` tick over a real sim driven
// to the enemy cap, not by a hand-written fixture. The baseline this produces is written down in
// `docs/map-delta-budget.md`. It exists as a command and not only as a number because a budget
// nobody can re-measure is a budget that rots.

const TICK_MS = 50; // the 20 Hz sim tick
const TICKS_PER_SECOND = 1000 / TICK_MS;
const PLAYERS = 6; // the design's full squad
const TURRETS = 30;
// The pool the ammo field is measured at. Nothing about that field varies but its digits — it is
// `,"ammo":N` and no more — so this is a well-supplied squad rather than an achievable ceiling.
const AMMO_POOL = 999;
// And the depth the queue field is measured at (#102 stage 3). Same shape, same reasoning: three
// digits of a squad dumping its bank into bullets, which is the widest this realistically gets.
const FORGE_QUEUE = 999;
// How many ticks of firing the measured tick is taken after. A shot is in the air for
// `PROJECTILE_RANGE / PROJECTILE_SPEED` (389 ms, ~8 ticks) since #80, so a tick measured cold
// carries only the shots fired on it and none of the ones still flying — which is not a steady
// state and not what a client actually receives. Long enough for the flights to fill up, with room
// to spare.
const WARMUP_TICKS = 30;
// How often each player's trigger comes round, in ticks. `RANGED_CADENCE_MS` is the floor
// `admitAttack` enforces, so a squad on auto-fire is exactly this and never faster.
const FIRE_EVERY = RANGED_CADENCE_MS / TICK_MS;
// The most shots that can be in the air at once. Derived from constants the game already fixes
// rather than budgeted, in the idiom `scripts/burst-ink.ts` uses for its own concurrent count:
// every shooter's rate times the longest a shot can be flying. A shot that *connects* is spent
// early, so this is the sky a squad that misses everything puts up — and the measured tick below
// carries far fewer, because at `enemyCap` almost every shot meets something at once.
const IN_FLIGHT_CEILING = Math.ceil(
  ((PLAYERS * 1000) / RANGED_CADENCE_MS + (TURRETS * 1000) / TURRET_CADENCE_MS) *
    (PROJECTILE_FLIGHT_MS / 1000),
);

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const deflated = (value: unknown): number =>
  Bun.deflateSync(Buffer.from(JSON.stringify(value), "utf8")).length;

export interface Reading {
  enemies: number;
  turrets: number;
  players: number;
  inFlight: number; // shots in the air on the measured tick (#80)
  raw: number; // bytes on the wire, uncompressed
  compressed: number; // the same delta through deflate
}

export interface Report {
  trimmed: Reading; // what ships today
  full: Reading; // the same tick at float64 coordinates and full-precision aim
  // The same tick with one sparse economy field riding, so the cost of each can be read off
  // against `trimmed`, which carries neither. Their cost is invisible on a settled tick by
  // construction: the bank rides only when whole Metal crosses and ammo only when a bullet is
  // forged or spent, so a benchmark of the steady state can never show either one.
  bankTick: Reading;
  ammoTick: Reading;
  queuedTick: Reading;
  // The same tick with every shot in the air streamed as a position, the way `moves` streams an
  // enemy — the alternative #80 had to remake #74's turret-wire decision against. What ships is
  // `trimmed`, which sends a launch and a `spent` and lets the client fly the rest itself.
  streamed: Reading;
  streamedBare: Reading; // the same shape with no shots in it, so one shot's cost is a difference
  inFlightCeiling: number; // the most that can ever be in the air, from the cadences
  bankMetal: number; // what the bank held when `bankTick` was taken
  ammoBullets: number; // and what the pool held for `ammoTick`
  queuedBullets: number; // and how deep the forge queue was for `queuedTick`
  deflateMsPerTick: number; // CPU to compress one tick's delta, once
}

// What compression actually costs, which is the half of the trade bytes alone cannot show. One
// deflate per tick per client, so this multiplied by 20 and by the squad size is the server's
// standing CPU bill for turning it on.
function timeDeflate(delta: MapDelta, samples = 400): number {
  const payload = Buffer.from(JSON.stringify(delta), "utf8");
  for (let i = 0; i < 50; i++) Bun.deflateSync(payload); // warm up
  const started = Bun.nanoseconds();
  for (let i = 0; i < samples; i++) Bun.deflateSync(payload);
  return (Bun.nanoseconds() - started) / samples / 1e6;
}

// One worst-case tick: the sim at the enemy cap with a full squad, a turret line engaged, and every
// player firing. Returns the delta the hub would broadcast, plus the same delta rebuilt at full
// float64 precision so the two can be compared byte for byte.
export function worstCaseTick(): {
  trimmed: MapDelta;
  full: MapDelta;
  bankTick: MapDelta;
  ammoTick: MapDelta;
  queuedTick: MapDelta;
  streamed: MapDelta;
  streamedBare: MapDelta;
  enemies: number;
  inFlight: number;
} {
  const roster = Array.from({ length: PLAYERS }, (_, i) => ({
    id: `p${i + 1}`,
    slot: i + 1,
    name: `P${i + 1}`,
  }));
  const world: WorldInit = generateWorld(roster, { rng: mulberry32(7) });
  const state = spawnEnemyState(world, mulberry32(11));
  const build = freshBuildState(world.arena);
  build.bank.metal = 1_000_000;
  build.ammo.bullets = AMMO_POOL;
  build.ammo.queued = FORGE_QUEUE;

  // A turret line, placed clear of the arena centre so the waves that converge on the squad engage it.
  const spec = BUILDABLES.turret as BuildableSpec;
  const origin = { x: world.arena.width / 2, y: world.arena.height / 2 };
  for (let i = 0; i < TURRETS; i++) {
    const at: Vec2 = { x: origin.x + 400 + i * 120, y: origin.y };
    placeStructure(build, "turret", tileOf(at), spec);
  }

  // Drive waves until the cap governor is holding the remainder. Every nest fires on its own timer
  // after a minute of grace (#124), so this is a few virtual minutes — and virtual only: no clock is
  // read anywhere in the sim.
  const squad = Array.from({ length: PLAYERS }, (_, i) => ({
    id: `p${i + 1}`,
    pos: { x: origin.x + 200 + i * 40, y: origin.y + 200 },
  }));
  for (let i = 0; i < 20_000 && state.enemies.size < DEFAULT_WORLD_SETTINGS.enemyCap; i++) {
    stepEnemies(state, squad, [], TICK_MS, build);
  }

  const shots = squad.map((p) => ({
    pos: p.pos,
    dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    by: p.id,
  }));

  // Fill the sky before measuring. A shot lives ~8 ticks in the air (#80), so a tick taken cold
  // carries the launches fired on it and nothing that was already flying — which is not the steady
  // state a client receives twenty times a second. The squad fires on `RANGED_CADENCE_MS` and the
  // turrets on their own; the pool is topped back up each tick because this measures the wire, not
  // the economy.
  for (let i = 0; i < WARMUP_TICKS; i++) {
    build.ammo.bullets = AMMO_POOL;
    stepEnemies(state, squad, i % FIRE_EVERY === 0 ? shots : [], TICK_MS, build);
  }

  // The measured tick: every player fires, so the launches are at their per-tick maximum on top of
  // a sky already full. Turret `aims` ride as transitions rather than per tick (#74), so a settled
  // tick carries none — which is the honest thing to budget against.
  build.ammo.bullets = AMMO_POOL;
  const { events } = stepEnemies(state, squad, shots, TICK_MS, build);

  // Assembled exactly as `LobbyHub.tick` does it: `moves` always rides, everything else only
  // when non-empty.
  const assemble = (
    moves: MapDelta["moves"],
    launched: ProjectileSpawn[],
    economy: Pick<MapDelta, "bank" | "ammo" | "queued"> = {},
  ): MapDelta => {
    const delta: MapDelta = { tick: 12_345, moves, ...economy };
    if (events.spawns.length > 0) delta.spawns = events.spawns;
    if (events.hits.length > 0) delta.hits = events.hits;
    if (events.deaths.length > 0) delta.deaths = events.deaths;
    if (events.bursts.length > 0) delta.bursts = events.bursts;
    if (events.nests.length > 0) delta.nests = events.nests;
    if (events.structHits.length > 0) delta.structHits = events.structHits;
    if (events.aims.length > 0) delta.aims = events.aims;
    if (launched.length > 0) delta.projectiles = launched;
    if (events.spent.length > 0) delta.spent = events.spent;
    return delta;
  };

  // The pre-#84 wire: the sim's own float64 positions, and the launch unrounded. Read back off the
  // live projectiles rather than reconstructed — `flyProjectiles` runs before anything launches, so
  // a shot named in this tick's `projectiles` is still sitting on its exact origin, on its exact
  // heading.
  const fullMoves = [...state.enemies.values()].map((e) => [e.id, e.pos.x, e.pos.y] as EnemyMove);
  const fullProjectiles = events.projectiles.map(([id]) => {
    const shot = state.projectiles.get(id);
    if (!shot) throw new Error(`a shot launched this tick is already gone: ${id}`);
    return [id, shot.pos.x, shot.pos.y, shot.dir.x, shot.dir.y] as ProjectileSpawn;
  });

  // The alternative this ticket had to remake #74's decision against: every shot in the air as a
  // position, every tick, exactly the way `moves` carries an enemy. It costs no launch event and no
  // `spent` — the client would be told where each bullet is and would need nothing else — so it is
  // measured with both of those taken back off.
  const flying = [...state.projectiles.values()].map(
    (shot) => [shot.id, Math.round(shot.pos.x), Math.round(shot.pos.y)] as EnemyMove,
  );
  const streamed = assemble([...events.moves, ...flying], []);
  streamed.spent = undefined;
  // The same shape with the shots taken back out, so the difference between the two is exactly what
  // one streamed bullet costs — which is what prices the ceiling the sim cannot be driven to.
  const streamedBare = assemble(events.moves, []);
  streamedBare.spent = undefined;

  return {
    trimmed: assemble(events.moves, events.projectiles),
    full: assemble(fullMoves, fullProjectiles),
    bankTick: assemble(events.moves, events.projectiles, { bank: { metal: build.bank.metal } }),
    ammoTick: assemble(events.moves, events.projectiles, { ammo: build.ammo.bullets }),
    queuedTick: assemble(events.moves, events.projectiles, { queued: build.ammo.queued }),
    streamed,
    streamedBare,
    enemies: state.enemies.size,
    inFlight: state.projectiles.size,
  };
}

export function measure(): Report {
  const {
    trimmed,
    full,
    bankTick,
    ammoTick,
    queuedTick,
    streamed,
    streamedBare,
    enemies,
    inFlight,
  } = worstCaseTick();
  const reading = (delta: MapDelta): Reading => ({
    enemies,
    turrets: TURRETS,
    players: PLAYERS,
    inFlight,
    raw: bytes(delta),
    compressed: deflated(delta),
  });
  return {
    trimmed: reading(trimmed),
    full: reading(full),
    bankTick: reading(bankTick),
    ammoTick: reading(ammoTick),
    queuedTick: reading(queuedTick),
    streamed: reading(streamed),
    streamedBare: reading(streamedBare),
    inFlightCeiling: IN_FLIGHT_CEILING,
    bankMetal: bankTick.bank?.metal ?? 0,
    ammoBullets: ammoTick.ammo ?? 0,
    queuedBullets: queuedTick.queued ?? 0,
    deflateMsPerTick: timeDeflate(trimmed),
  };
}

const kib = (perTick: number) => (perTick * TICKS_PER_SECOND) / 1024;
// What one bullet costs when its position is streamed, read off the difference between the same
// tick with and without them rather than counted off a JSON shape.
const perStreamedShot = (r: Report) =>
  (r.streamed.raw - r.streamedBare.raw) / Math.max(1, r.streamed.inFlight);
// And what the shape would cost at the most shots the cadences can put in the air at once. The sim
// cannot be driven there — at `enemyCap` almost every shot connects on its first tick — so it is
// the measured per-shot cost against a derived count, which is how this page prices everything it
// cannot stage.
const ceilingRaw = (r: Report) =>
  Math.round(r.streamedBare.raw + perStreamedShot(r) * r.inFlightCeiling);
const pct = (from: number, to: number) => ((to - from) / from) * 100;

export function format(report: Report): string {
  const { full, trimmed, bankTick, ammoTick, queuedTick } = report;
  const row = (label: string, b: number) =>
    `  ${label.padEnd(30)}${`${b.toLocaleString()} B`.padStart(12)}${`${kib(b).toFixed(1)} KiB/s`.padStart(14)}`;
  // Against `trimmed`, which carries neither field — so this is what the field itself costs.
  const extra = (label: string, r: Reading) =>
    `  ${label.padEnd(30)}${`+${r.raw - trimmed.raw} B`.padStart(12)}${`+${r.compressed - trimmed.compressed} B deflate`.padStart(20)}`;
  return [
    `game/map-delta at the caps the game supports`,
    `  ${trimmed.enemies} enemies (cap ${DEFAULT_WORLD_SETTINGS.enemyCap}), ${trimmed.players} players, ${trimmed.turrets} turrets, ${TICKS_PER_SECOND} Hz`,
    `  ${trimmed.inFlight} shots in the air at ${PROJECTILE_SPEED} u/s (#80)`,
    ``,
    `per tick, and per client:`,
    row("float64 coords, raw", full.raw),
    row("trimmed coords, raw", trimmed.raw),
    row("float64 coords, deflate", full.compressed),
    row("trimmed coords, deflate", trimmed.compressed),
    ``,
    `  trimming coordinates      ${pct(full.raw, trimmed.raw).toFixed(1)}%`,
    `  deflate, on trimmed       ${pct(trimmed.raw, trimmed.compressed).toFixed(1)}%`,
    `  both, against the old raw ${pct(full.raw, trimmed.compressed).toFixed(1)}%`,
    ``,
    `what a shot costs the wire, against streaming every one of them per tick (#80):`,
    `  ${trimmed.raw - report.streamedBare.raw} B raw / ` +
      `${trimmed.compressed - report.streamedBare.compressed} B deflate — what the launch and` +
      ` \`spent\` fields cost this tick, against the same tick with no shot on it at all`,
    ``,
    row("derived — launch + spent, what ships", trimmed.raw),
    row(`streamed — a position each, at ${trimmed.inFlight}`, report.streamed.raw),
    row("derived, deflate", trimmed.compressed),
    row(`streamed, deflate, at ${trimmed.inFlight}`, report.streamed.compressed),
    `  streaming, against deriving  ${pct(trimmed.raw, report.streamed.raw).toFixed(1)}% raw,` +
      ` ${pct(trimmed.compressed, report.streamed.compressed).toFixed(1)}% deflate`,
    ``,
    `  one streamed shot           ${perStreamedShot(report).toFixed(1)} B raw` +
      ` — deriving costs nothing per shot in the air, only per shot fired`,
    `  at ${report.inFlightCeiling} in the air, the ceiling the cadences allow:`,
    row("  streamed, raw", ceilingRaw(report)),
    `  which is ${pct(trimmed.raw, ceilingRaw(report)).toFixed(1)}% against what ships`,
    ``,
    `what a sparse economy field costs on the tick it moves — a settled tick carries neither:`,
    extra(`bank, at ${report.bankMetal.toLocaleString()} Metal`, bankTick),
    extra(`ammo, at ${report.ammoBullets.toLocaleString()} bullets`, ammoTick),
    extra(`queued, at ${report.queuedBullets.toLocaleString()} ordered`, queuedTick),
    ``,
    `what deflate costs, which bytes alone cannot show:`,
    `  ${report.deflateMsPerTick.toFixed(3)} ms per tick per client`,
    `  ${(report.deflateMsPerTick * TICKS_PER_SECOND).toFixed(1)} ms/s for one client` +
      ` — ${((report.deflateMsPerTick * TICKS_PER_SECOND) / 10).toFixed(1)}% of one core`,
    `  ${(report.deflateMsPerTick * TICKS_PER_SECOND * trimmed.players).toFixed(1)} ms/s for a squad of ${trimmed.players}` +
      ` — ${((report.deflateMsPerTick * TICKS_PER_SECOND * trimmed.players) / 10).toFixed(1)}% of one core`,
  ].join("\n");
}

if (import.meta.main) {
  const report = measure();
  console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : format(report));
}
