import {
  BUILDABLES,
  type BuildableSpec,
  freshBuildState,
  placeStructure,
  tileOf,
} from "../src/game/build";
import { ENEMY_CAP, spawnEnemyState, stepEnemies } from "../src/game/enemies";
import { generateWorld } from "../src/game/world";
import type { MapDelta, Vec2, WorldInit } from "../src/lobby/protocol";

// Measure `game/map-delta` at the caps the game actually supports, and show what the wire costs
// with and without the display-precision trim of #84.
//
//   bun run delta:size
//   bun run delta:size --json     # the same figures, for a diff
//
// The delta is assembled here exactly as `LobbyHub.tick` assembles it — every optional array
// rides only when non-empty — and it is fed by a real `stepEnemies` tick over a real sim driven
// to ENEMY_CAP, not by a hand-written fixture. The baseline this produces is written down in
// `docs/map-delta-budget.md`. It exists as a command and not only as a number because a budget
// nobody can re-measure is a budget that rots.

const TICK_MS = 50; // the 20 Hz sim tick
const TICKS_PER_SECOND = 1000 / TICK_MS;
const PLAYERS = 6; // the design's full squad
const TURRETS = 30;

// A deterministic rng, so two runs of this script measure the same world.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const deflated = (value: unknown): number =>
  Bun.deflateSync(Buffer.from(JSON.stringify(value), "utf8")).length;

export interface Reading {
  enemies: number;
  turrets: number;
  players: number;
  raw: number; // bytes on the wire, uncompressed
  compressed: number; // the same delta through deflate
}

export interface Report {
  trimmed: Reading; // what ships today
  full: Reading; // the same tick at float64 coordinates and full-precision aim
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

// One worst-case tick: the sim at ENEMY_CAP with a full squad, a turret line engaged, and every
// player firing. Returns the delta the hub would broadcast, plus the same delta rebuilt at full
// float64 precision so the two can be compared byte for byte.
export function worstCaseTick(): { trimmed: MapDelta; full: MapDelta; enemies: number } {
  const roster = Array.from({ length: PLAYERS }, (_, i) => ({
    id: `p${i + 1}`,
    slot: i + 1,
    name: `P${i + 1}`,
  }));
  const world: WorldInit = generateWorld(roster, { rng: mulberry32(7) });
  const state = spawnEnemyState(world, mulberry32(11));
  const build = freshBuildState(world.arena);
  build.bank.metal = 1_000_000;

  // A turret line, placed clear of the arena centre so the wave marching inward engages it.
  const spec = BUILDABLES.turret as BuildableSpec;
  const origin = { x: world.arena.width / 2, y: world.arena.height / 2 };
  for (let i = 0; i < TURRETS; i++) {
    const at: Vec2 = { x: origin.x + 400 + i * 120, y: origin.y };
    placeStructure(build, "turret", tileOf(at), spec);
  }

  // Drive waves until the cap governor is holding the remainder. Waves fire every 30 s, so this
  // is virtual time only — no clock is read anywhere in the sim.
  const squad = Array.from({ length: PLAYERS }, (_, i) => ({
    id: `p${i + 1}`,
    pos: { x: origin.x + 200 + i * 40, y: origin.y + 200 },
  }));
  for (let i = 0; i < 4_000 && state.enemies.size < ENEMY_CAP; i++) {
    stepEnemies(state, squad, [], TICK_MS, build);
  }

  // The measured tick: every player fires, so `shots` is at its per-tick maximum. Turret `aims`
  // ride as transitions rather than per tick (#74), so a settled tick carries none — which is the
  // honest thing to budget against, since this is the cost paid 20 times a second.
  const shots = squad.map((p) => ({
    pos: p.pos,
    dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    by: p.id,
  }));
  const { events } = stepEnemies(state, squad, shots, TICK_MS, build);

  // Assembled exactly as `LobbyHub.tick` does it: `moves` always rides, everything else only
  // when non-empty.
  const assemble = (moves: MapDelta["moves"], peerShots: MapDelta["shots"]): MapDelta => {
    const delta: MapDelta = { tick: 12_345, moves };
    if (events.spawns.length > 0) delta.spawns = events.spawns;
    if (events.hits.length > 0) delta.hits = events.hits;
    if (events.deaths.length > 0) delta.deaths = events.deaths;
    if (events.nests.length > 0) delta.nests = events.nests;
    if (events.structHits.length > 0) delta.structHits = events.structHits;
    if (events.aims.length > 0) delta.aims = events.aims;
    if (peerShots && peerShots.length > 0) delta.shots = peerShots;
    return delta;
  };

  // The pre-#84 wire: the sim's own float64 positions, and the aim vector unrounded.
  const fullMoves = [...state.enemies.values()].map(
    (e) => [e.id, e.pos.x, e.pos.y] as MapDelta["moves"][number],
  );
  const fullShots = events.shots.map((s, i) => ({ ...s, dir: shots[i].dir }));

  return {
    trimmed: assemble(events.moves, events.shots),
    full: assemble(fullMoves, fullShots),
    enemies: state.enemies.size,
  };
}

export function measure(): Report {
  const { trimmed, full, enemies } = worstCaseTick();
  const reading = (delta: MapDelta): Reading => ({
    enemies,
    turrets: TURRETS,
    players: PLAYERS,
    raw: bytes(delta),
    compressed: deflated(delta),
  });
  return {
    trimmed: reading(trimmed),
    full: reading(full),
    deflateMsPerTick: timeDeflate(trimmed),
  };
}

const kib = (perTick: number) => (perTick * TICKS_PER_SECOND) / 1024;
const pct = (from: number, to: number) => ((to - from) / from) * 100;

export function format(report: Report): string {
  const { full, trimmed } = report;
  const row = (label: string, b: number) =>
    `  ${label.padEnd(30)}${`${b.toLocaleString()} B`.padStart(12)}${`${kib(b).toFixed(1)} KiB/s`.padStart(14)}`;
  return [
    `game/map-delta at the caps the game supports`,
    `  ${trimmed.enemies} enemies (ENEMY_CAP ${ENEMY_CAP}), ${trimmed.players} players, ${trimmed.turrets} turrets, ${TICKS_PER_SECOND} Hz`,
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
