import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { WorldInit } from "../lobby/protocol";
import { generateOre, mulberry32, type OreGrid, TILE, tileFromKey } from "./build";
import {
  type EnemyState,
  eliteShare,
  nestLayout,
  nestPeriodMs,
  SPAWN_GRACE_MS,
  spawnEnemyState,
  stepEnemies,
  waveSize,
} from "./enemies";
import { ARENA, generateWorld } from "./world";
import { DEFAULT_WORLD_SETTINGS, type WorldSettings } from "./worldSettings";

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, slot: i + 1, name: `P${i + 1}` }));

// One knob moved off the defaults, so what any assertion below observes is attributable to it.
const settings = (knobs: Partial<WorldSettings>): WorldSettings => ({
  ...DEFAULT_WORLD_SETTINGS,
  ...knobs,
});

describe("DEFAULT_WORLD_SETTINGS", () => {
  // The whole object in one assertion: the config's only promise at this stage is that it *is*
  // today's world, so a default that drifts from the value the game shipped with is the failure.
  test("carries today's world, knob for knob", () => {
    expect(DEFAULT_WORLD_SETTINGS).toEqual({
      arena: { width: 31_200, height: 31_200 },
      metalPatches: 140,
      powerPatches: 40,
      oreEdgeBias: 3.5,
      nestCount: 50,
      nestEdgeBias: 3.5,
      enemyCap: 500,
      nestPeriod: { startMs: 60_000, fallMs: 5_000, floorMs: 10_000 },
      waveSize: { start: 1, growth: 1, max: 5 },
      eliteShare: { ptsPerMin: 5, max: 0.3 },
    });
  });
});

// The ticket's second box: every knob in it reaches world generation or the sim, one assertion
// each. A knob nothing reads is the failure mode this whole stage exists to rule out.
describe("every knob reaches the world it configures", () => {
  test("arena sizes the box the world is generated in", () => {
    const arena = { width: 4_000, height: 6_000 };
    const init = generateWorld(players(2), { settings: settings({ arena }) });
    expect(init.arena).toEqual(arena);
    for (const s of init.spawns) {
      expect(Math.hypot(s.pos.x - arena.width / 2, s.pos.y - arena.height / 2)).toBeLessThan(50);
    }
    expect(init.exit.x).toBeLessThanOrEqual(arena.width);
    expect(init.exit.y).toBeLessThanOrEqual(arena.height);
  });

  test("metalPatches and powerPatches set how much of each ore the arena is seeded with", () => {
    const kinds = (s: WorldSettings) => {
      const grid = generateOre(ARENA, ORE_SEED, s);
      const tally = { metal: 0, power: 0 };
      for (const kind of grid.values()) tally[kind]++;
      return tally;
    };
    expect(kinds(settings({ metalPatches: 0 })).metal).toBe(0);
    expect(kinds(settings({ powerPatches: 0 })).power).toBe(0);
    expect(kinds(settings({ metalPatches: 20 })).metal).toBeLessThan(
      kinds(DEFAULT_WORLD_SETTINGS).metal,
    );
  });

  test("oreEdgeBias sets how far out the ore piles up", () => {
    expect(
      meanOutwardness(generateOre(ARENA, ORE_SEED, settings({ oreEdgeBias: 1 }))),
    ).toBeLessThan(meanOutwardness(generateOre(ARENA, ORE_SEED, DEFAULT_WORLD_SETTINGS)));
  });

  test("nestCount sets how many nests the layout places, and how many the sim arms", () => {
    expect(nestLayout(ARENA, NEST_SEED, settings({ nestCount: 3 }))).toHaveLength(3);
    const sim = spawnEnemyState(world(), () => 0.5, settings({ nestCount: 3 }));
    expect(sim.nests).toHaveLength(3);
    expect(sim.nestTimers.size).toBe(3);
  });

  test("nestEdgeBias sets how far out the nests sit", () => {
    const outward = (s: WorldSettings) => {
      const nests = nestLayout(ARENA, NEST_SEED, s);
      const half = ARENA.width / 2;
      return (
        nests.reduce((sum, n) => sum + Math.hypot(n.pos.x - half, n.pos.y - half), 0) / nests.length
      );
    };
    expect(outward(settings({ nestEdgeBias: 1 }))).toBeLessThan(outward(DEFAULT_WORLD_SETTINGS));
  });

  test("enemyCap governs how many enemies the sim will hold at once", () => {
    const sim = spawnEnemyState(world(), mulberry32(3), settings({ enemyCap: 7 }));
    for (const nest of sim.nests) sim.nestTimers.set(nest.id, 0);
    sim.elapsedMs = 10 * 60_000;
    for (let i = 0; i < 200; i++) stepEnemies(sim, [], [], 50);
    expect(sim.enemies.size).toBe(7);
  });

  test("nestPeriod sets the interval a nest re-arms on", () => {
    const s = settings({ nestPeriod: { startMs: 8_000, fallMs: 1_000, floorMs: 3_000 } });
    expect(nestPeriodMs(0, s)).toBe(8_000);
    expect(nestPeriodMs(SPAWN_GRACE_MS + 2 * 60_000, s)).toBe(6_000);
    expect(nestPeriodMs(SPAWN_GRACE_MS + 90 * 60_000, s)).toBe(3_000);

    const sim = oneNest(s);
    sim.nestTimers.set(sim.nests[0].id, 0);
    stepEnemies(sim, [], [], 50);
    expect(sim.nestTimers.get(sim.nests[0].id)).toBe(8_000 - 50);
  });

  test("waveSize sets how many enemies a nest's wave carries", () => {
    const s = settings({ waveSize: { start: 3, growth: 4, max: 9 } });
    expect(waveSize(0, s)).toBe(3);
    expect(waveSize(SPAWN_GRACE_MS + 60_000, s)).toBe(7);
    expect(waveSize(SPAWN_GRACE_MS + 90 * 60_000, s)).toBe(9);

    const sim = oneNest(s);
    sim.nestTimers.set(sim.nests[0].id, 0);
    expect(stepEnemies(sim, [], [], 50).events.spawns).toHaveLength(3);
  });

  test("eliteShare sets how much of a wave is elites", () => {
    const s = settings({ eliteShare: { ptsPerMin: 20, max: 0.8 } });
    expect(eliteShare(0, s)).toBe(0);
    expect(eliteShare(SPAWN_GRACE_MS + 60_000, s)).toBeCloseTo(0.2, 10);
    expect(eliteShare(SPAWN_GRACE_MS + 90 * 60_000, s)).toBe(0.8);

    const sim = oneNest(s, { elapsedMs: SPAWN_GRACE_MS + 60_000 });
    sim.nestTimers.set(sim.nests[0].id, 0);
    // The sim's rng is 0.1, under a 0.2 share and over the default's 0.05: this wave is elites
    // only because the knob reached `fireNestWave`. Asserted as a set, so how many enemies the
    // wave carries stays the wave-size knob's business.
    const kinds = stepEnemies(sim, [], [], 50).events.spawns.map((e) => e.kind);
    expect(new Set(kinds)).toEqual(new Set(["elite"]));
  });
});

// The ticket's third box. `enemies.ts` is pure by design (M3), and #124's interleaved test already
// catches a module-level timer or id source — but it steps two sims of the *same* world, so it
// cannot see a config parked in module scope. This can: two sims of two different worlds, stepped
// alternately, each keeping its own knobs.
test("two sims of two different worlds keep their own settings, interleaved", () => {
  const one = oneNest(settings({ waveSize: { start: 1, growth: 0, max: 1 } }));
  const four = oneNest(settings({ waveSize: { start: 4, growth: 0, max: 4 } }));
  for (let tick = 0; tick < 20; tick++) {
    for (const sim of [one, four]) sim.nestTimers.set(sim.nests[0].id, 0);
    expect(stepEnemies(one, [], [], 50).events.spawns).toHaveLength(1);
    expect(stepEnemies(four, [], [], 50).events.spawns).toHaveLength(4);
  }
});

// The ticket's first box, and the only one that can fail silently in a squad: ore never crosses the
// wire and the nest layout is derived from a seed on both sides (ADR 0004), so a config that shifted
// either generator's rng consumption by a single draw would leave one player mining a tile another
// cannot see, with no field to compare.
//
// Argument does not prove that. Every figure below was captured from the code as it stood before the
// config existed (`dc60c83`), and the digests are over the whole grid, the whole layout and the whole
// spawn stream — so any change to what a given seed expands into fails here rather than in a match.
describe("defaults reproduce the world as it stood before the config", () => {
  test("generateWorld hands out the same init", () => {
    expect(generateWorld(players(3), { rng: mulberry32(1) })).toEqual({
      arena: { width: 31_200, height: 31_200 },
      exit: { x: 180.257664446719, y: 31_102, width: 936, height: 98 },
      spawns: [
        { id: "p1", slot: 1, name: "P1", pos: { x: 15_644, y: 15_600 } },
        { id: "p2", slot: 2, name: "P2", pos: { x: 15_622, y: 15_638.105117766516 } },
        { id: "p3", slot: 3, name: "P3", pos: { x: 15_578, y: 15_638.105117766516 } },
      ],
      oreSeed: 2_265_367_787,
      nestSeed: 4_213_581_821,
    });
    const other = generateWorld(players(3), { rng: mulberry32(4_242) });
    expect(other.exit).toEqual({ x: 8_475.2090737205, y: 31_102, width: 936, height: 98 });
    expect([other.oreSeed, other.nestSeed]).toEqual([3_999_632_104, 2_178_503_905]);
  });

  test("generateOre expands a seed into the same grid, tile for tile", () => {
    expect(fingerprintOre(generateOre(ARENA, 2_265_367_787))).toEqual([8_322, "ca14c7390e2b046d"]);
    expect(fingerprintOre(generateOre(ARENA, 3_999_632_104))).toEqual([8_150, "6f6b0b06ed83f743"]);
  });

  test("nestLayout expands a seed into the same fifty nests", () => {
    expect(digest(nestLayout(ARENA, 4_213_581_821))).toBe("35091745fba50013");
    expect(digest(nestLayout(ARENA, 2_178_503_905))).toBe("ec74e6c856a21d53");
  });

  test("the sim spawns the same waves, at the same places, over five minutes", () => {
    const world = generateWorld(players(3), { rng: mulberry32(4_242) });
    const sim = spawnEnemyState(world, mulberry32(11));
    const squad = [{ id: "p1", pos: { x: ARENA.width / 2, y: ARENA.height / 2 } }];
    const trace: string[] = [];
    for (let tick = 0; tick < 6_000; tick++) {
      for (const s of stepEnemies(sim, squad, [], 50).events.spawns) {
        trace.push(`${tick}|${s.id}|${s.kind}|${s.pos.x}|${s.pos.y}`);
      }
    }
    expect([trace.length, digest(trace)]).toEqual([500, "e35aaf749a4930b6"]);
    expect(digest([...sim.enemies.values()])).toBe("33a2492a688d851b");
  });
});

// The decision recorded in `docs/adr/0005`, asserted rather than trusted: the ore gradient and the
// nest gradient hold the same 3.5 today and are still two knobs, so retuning either one leaves the
// other's world exactly where it was.
describe("ore and nest distribution are two knobs", () => {
  test("retuning the ore bias moves no nest", () => {
    expect(nestLayout(ARENA, NEST_SEED, settings({ oreEdgeBias: 1 }))).toEqual(
      nestLayout(ARENA, NEST_SEED, DEFAULT_WORLD_SETTINGS),
    );
  });

  test("retuning the nest bias moves no ore", () => {
    expect(generateOre(ARENA, ORE_SEED, settings({ nestEdgeBias: 1 }))).toEqual(
      generateOre(ARENA, ORE_SEED, DEFAULT_WORLD_SETTINGS),
    );
  });
});

const ORE_SEED = 4_242;
const NEST_SEED = 909;

const world = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [],
  oreSeed: ORE_SEED,
  nestSeed: NEST_SEED,
});

// One nest, past the grace, with an rng of 0.1 — under any elite share these tests set and over the
// default's, so what a wave is made of is attributable to the knob rather than to the draw.
const oneNest = (s: WorldSettings, over: Partial<EnemyState> = {}): EnemyState => {
  const sim = spawnEnemyState(world(), () => 0.1, settings({ ...s, nestCount: 1 }));
  return Object.assign(sim, { elapsedMs: SPAWN_GRACE_MS }, over);
};

// A whole grid or layout in one comparable value, so a golden expectation is a line rather than
// thousands. Truncated to 64 bits: this guards against an accidental change, not a forged one.
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

// Keys are sorted so the fingerprint is over the grid's content and not over the insertion order a
// retune of patch placement would shuffle.
function fingerprintOre(grid: OreGrid): [number, string] {
  const tiles = [...grid.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`);
  return [grid.size, digest(tiles)];
}

// How far from centre a grid's tiles sit on average, as a fraction of the arena half-extent.
function meanOutwardness(grid: OreGrid): number {
  const half = ARENA.width / 2;
  let sum = 0;
  for (const key of grid.keys()) {
    const { tx, ty } = tileFromKey(key);
    sum += Math.max(Math.abs(tx * TILE - half), Math.abs(ty * TILE - half)) / half;
  }
  return sum / grid.size;
}
