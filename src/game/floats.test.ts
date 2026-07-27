import { describe, expect, test } from "bun:test";
import type { BuildableKind, Tile } from "../lobby/protocol";
import {
  BUILDABLES,
  type BuildableSpec,
  freshBuildState,
  MINER_TRICKLE,
  mulberry32,
  placeStructure,
  removeStructure,
  stepBuild,
  TILE,
} from "./build";
import type { Camera, Viewport } from "./camera";
import { FLOAT_MS, freshMetalFloats, type MetalFloat, stepMetalFloats } from "./floats";
import { ARENA } from "./world";

const camera: Camera = { x: 1_000, y: 1_000 };
const viewport: Viewport = { width: 800, height: 600 };

// A 60 Hz frame in whole milliseconds — the clock `GameScreen` injects is `Date.now()`, which never
// hands out a fraction. Three frames make 50 ms exactly, so a run of these lands on a whole second
// without the schedule being made up of a rate that divides it.
const FRAME_MS = [16, 17, 17];

function standing(kind: BuildableKind, id: string, tile: Tile) {
  return { id, kind, tile };
}

// A miner near the camera's top-left, spaced so several fit on screen without overlapping.
function visibleMiner(id: string, index = 0) {
  return standing("miner", id, { tx: 68 + index * 4, ty: 70 });
}

// Drive `stepMetalFloats` for `ms` of client clock at 60 Hz and return every float it emitted —
// identity, not value, because two floats off the same miner are otherwise indistinguishable.
function run(
  structures: ReturnType<typeof standing>[],
  ms: number,
  state = freshMetalFloats(),
  at: Camera = camera,
): MetalFloat[] {
  const emitted = new Set<MetalFloat>();
  let now = 0;
  stepMetalFloats(state, structures, at, viewport, now); // starts the clock; accrues nothing
  for (let i = 0; now < ms; i++) {
    now += FRAME_MS[i % FRAME_MS.length];
    for (const f of stepMetalFloats(state, structures, at, viewport, now)) emitted.add(f);
  }
  return [...emitted];
}

// Drive the bank and the floats over one schedule, so the cosmetic can be held against the economy
// it describes. Both sides see the same standing miners and the same milliseconds; the bank is the
// reference, exactly as #99 asks.
function lockstep() {
  const build = freshBuildState(ARENA);
  build.bank.metal = 100_000; // funded up front: this is about income, not affordability
  const floats = freshMetalFloats();
  let now = 0;
  let banked = 0;
  let floated = 0;
  // The float clock is started before anything is banked, or the bank would collect a frame of
  // income the floats were never shown and every total below would sit one step apart.
  stepMetalFloats(floats, [], camera, viewport, now);
  return {
    place: (tile: Tile) => placeStructure(build, "miner", tile, BUILDABLES.miner as BuildableSpec),
    destroy: (id: string) => removeStructure(build, id),
    step(dtMs: number) {
      banked += stepBuild(build, dtMs);
      now += dtMs;
      const live = stepMetalFloats(floats, [...build.structures.values()], camera, viewport, now);
      // Everything emitted this step carries this instant, and `now` only moves forward, so no
      // float already in the air can be counted a second time.
      floated += live.filter((f) => f.at === now).length;
    },
    totals: () => ({ banked, floated }),
  };
}

describe("a miner floating its Metal", () => {
  test("floats one number per whole Metal, so one miner beats MINER_TRICKLE times a second", () => {
    expect(run([visibleMiner("b1")], 1_000).length).toBe(MINER_TRICKLE);
  });

  test("ten miners float ten times that, each on its own beat", () => {
    const miners = Array.from({ length: 10 }, (_, i) => visibleMiner(`b${i}`, i));
    expect(run(miners, 1_000).length).toBe(10 * MINER_TRICKLE);
  });

  test("each number rises from the miner that earned it, not from a shared point", () => {
    const two = [visibleMiner("b1", 0), visibleMiner("b2", 3)];
    const origins = new Set(run(two, 1_000).map((f) => `${f.pos.x},${f.pos.y}`));
    const expected = new Set(
      two.map((m) => {
        const half = ((BUILDABLES.miner as BuildableSpec).footprint * TILE) / 2;
        return `${m.tile.tx * TILE + half},${m.tile.ty * TILE}`;
      }),
    );
    expect(origins).toEqual(expected);
  });

  // The cosmetic and the economy have to agree: three miners over the same five seconds, banked by
  // `stepBuild` on one side and floated on the other, off the identical frame schedule.
  test("the whole floated total is the Metal those same miners bank", () => {
    const tiles = Array.from({ length: 3 }, (_, i) => ({ tx: 68 + i * 4, ty: 70 }));
    const build = freshBuildState(ARENA);
    build.bank.metal = tiles.length * (BUILDABLES.miner as BuildableSpec).cost;
    for (const tile of tiles) {
      placeStructure(build, "miner", tile, BUILDABLES.miner as BuildableSpec);
    }
    const SECONDS = 5;
    const frames = (SECONDS * 1_000) / FRAME_MS.reduce((a, b) => a + b, 0);
    let banked = 0;
    for (let i = 0; i < frames * FRAME_MS.length; i++) {
      banked += stepBuild(build, FRAME_MS[i % FRAME_MS.length]);
    }

    const floated = run(
      tiles.map((tile, i) => standing("miner", `b${i}`, tile)),
      SECONDS * 1_000,
    ).length;
    expect(floated).toBe(banked);
    expect(banked).toBe(SECONDS * tiles.length * MINER_TRICKLE);
  });

  // The bank pools every producer into one accumulator that outlives all of them, so a destroyed
  // miner's part-earned fraction is delayed, never lost. Per-miner accrual has to match that or it
  // sheds a fraction on every death — and miners die constantly.
  test("a miner destroyed mid-fraction floats what it had part-earned rather than losing it", () => {
    const sim = lockstep();
    const doomed = sim.place({ tx: 68, ty: 70 });
    sim.place({ tx: 72, ty: 70 });
    for (let i = 0; i < 5; i++) sim.step(50); // 250 ms: each miner is half way to its next Metal
    sim.destroy(doomed.id);
    // Settle. With one miner left, every outstanding thousandth — its own and the orphan it
    // inherits — funnels through a single accumulator, exactly as the bank's does, so the two
    // totals have to land on the same number. A fraction dropped on the death shows up as a gap.
    for (let i = 0; i < 40; i++) sim.step(50);
    const { banked, floated } = sim.totals();
    expect(floated).toBe(banked);
    expect(banked).toBeGreaterThan(0);
  });

  // The gap the design does allow, pinned so it cannot quietly become drift: a standing miner may be
  // holding a Metal it has not completed, so the running totals sit apart — by no more than one per
  // miner, and never growing with how long or how hard the churn runs.
  test("builds, deaths and irregular frames leave the totals reconciled, never drifting apart", () => {
    const TILES = Array.from({ length: 8 }, (_, i) => ({ tx: 68 + i * 4, ty: 70 }));
    const DTS = [16, 17, 33, 11, 25, 17, 9, 50, 21, 17]; // whole ms, irregular, under the step cap
    const churn = (steps: number) => {
      const sim = lockstep();
      const rng = mulberry32(2_026);
      const free = [...TILES];
      const alive = new Map<string, Tile>();
      let deaths = 0;
      let maxGap = 0;
      for (let i = 0; i < steps; i++) {
        if (free.length > 0 && rng() < 0.03) {
          const tile = free.pop() as Tile;
          alive.set(sim.place(tile).id, tile);
        }
        if (alive.size > 0 && rng() < 0.02) {
          const [id, tile] = [...alive][Math.floor(rng() * alive.size)];
          sim.destroy(id);
          alive.delete(id);
          free.push(tile);
          deaths++;
        }
        sim.step(DTS[i % DTS.length]);
        const { banked, floated } = sim.totals();
        maxGap = Math.max(maxGap, banked - floated);
      }
      // Collapse to one miner and let it run: every remainder the churn left standing or orphaned
      // then funnels through a single accumulator, which is the only state in which the two totals
      // are comparable exactly.
      for (const id of alive.keys()) sim.destroy(id);
      sim.step(20); // the step whose prune hands every outstanding remainder to the pool
      sim.place(TILES[0]);
      for (let i = 0; i < 400; i++) sim.step(DTS[i % DTS.length]);
      return { deaths, maxGap, ...sim.totals() };
    };

    const short = churn(2_000);
    const long = churn(8_000);
    expect(long.deaths).toBeGreaterThan(4 * short.deaths); // the long run is the far harder churn
    expect(short.floated).toBe(short.banked);
    expect(long.floated).toBe(long.banked);
    // On this schedule — deaths one at a time, a step between each, so a survivor drains the pool
    // every step — the gap stays small; it is not a bound that holds for a simultaneous wipe. What
    // is asserted is the shape of the original bug: four times the deaths must not widen it, where
    // a fraction discarded per death would compound with every one of them.
    expect(short.maxGap).toBeLessThanOrEqual(TILES.length);
    expect(long.maxGap).toBeLessThanOrEqual(short.maxGap);
  });

  // The one case where the outstanding amount is *not* bounded by the miners standing: a line wiped
  // out in a single tick leaves the pool holding a fraction for each of them with nothing alive to
  // drain it. Still nothing lost — frozen until something is rebuilt, and then all of it lands.
  test("a squad wiped out in one tick holds its remainders until a miner is rebuilt", () => {
    const sim = lockstep();
    const ids = Array.from({ length: 16 }, (_, i) =>
      sim.place({ tx: 68 + (i % 4) * 3, ty: 68 + Math.floor(i / 4) * 3 }),
    ).map((m) => m.id);
    for (let i = 0; i < 20; i++) sim.step(17); // every accrual left mid-fraction
    for (const id of ids) sim.destroy(id);
    sim.step(17); // the prune that pools all sixteen remainders at once
    const wiped = sim.totals();
    expect(wiped.banked - wiped.floated).toBeGreaterThan(1); // more outstanding than any one miner
    for (let i = 0; i < 5; i++) sim.step(17);
    expect(sim.totals()).toEqual(wiped); // nothing standing, so the gap cannot move either way
    sim.place({ tx: 68, ty: 68 });
    for (let i = 0; i < 400; i++) sim.step(17);
    const settled = sim.totals();
    expect(settled.floated).toBe(settled.banked); // every pooled fraction landed in the end
  });

  test("only a miner on screen floats anything", () => {
    const offScreen = standing("miner", "b9", { tx: 2_000, ty: 2_000 });
    expect(run([offScreen], 1_000).length).toBe(0);
    expect(run([offScreen, visibleMiner("b1")], 1_000).length).toBe(MINER_TRICKLE);
  });

  test("nothing else the squad builds floats a number", () => {
    const others = [
      standing("wall", "b1", { tx: 68, ty: 70 }),
      standing("turret", "b2", { tx: 72, ty: 70 }),
      standing("generator", "b3", { tx: 76, ty: 70 }),
    ];
    expect(run(others, 2_000).length).toBe(0);
  });

  test("a miner destroyed mid-float strands no number in the air", () => {
    const state = freshMetalFloats();
    const miner = visibleMiner("b1");
    run([miner], 1_000, state);
    expect(stepMetalFloats(state, [miner], camera, viewport, 1_000).length).toBeGreaterThan(0);
    expect(stepMetalFloats(state, [], camera, viewport, 1_001)).toEqual([]);
  });

  test("a number is gone once its life is up", () => {
    const state = freshMetalFloats();
    const miner = visibleMiner("b1");
    run([miner], 1_000, state);
    const live = stepMetalFloats(state, [miner], camera, viewport, 1_000);
    expect(live.length).toBeGreaterThan(0);
    const oldest = Math.min(...live.map((f) => f.at));
    expect(
      stepMetalFloats(state, [miner], camera, viewport, oldest + FLOAT_MS).some(
        (f) => f.at === oldest,
      ),
    ).toBe(false);
  });
});
