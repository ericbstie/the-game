import { describe, expect, test } from "bun:test";
import type { Tile } from "../lobby/protocol";
import {
  admitBuild,
  admitDemolish,
  admitMine,
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  BULLET_COST,
  type BuildableSpec,
  type BuildState,
  buildCost,
  creditMetal,
  DEMOLISH_CADENCE_MS,
  DEMOLISH_HOLD_MS,
  demolishStructure,
  drainForge,
  enqueueForge,
  FORGE_MS,
  footprintCenter,
  footprintTiles,
  freshBuildGuard,
  freshBuildState,
  freshDemolishGuard,
  freshMineGuard,
  GENERATOR_OUTPUT,
  generateOre,
  HAND_MINE_RATE,
  INTERACT_REACH,
  MAX_ARENA_SIDE,
  MINE_CADENCE_MS,
  MINE_WINDOW_MAX_MS,
  MINER_TRICKLE,
  metalRate,
  mulberry32,
  oreAt,
  placementError,
  placeStructure,
  pushOutOfSolids,
  removeStructure,
  resolveHarvest,
  slidePos,
  snapshotAims,
  solidAt,
  spendBullet,
  stepBuild,
  structureBlocking,
  structureCenter,
  TILE,
  tileKey,
  tileOf,
  tileOrigin,
  tilesBetween,
} from "./build";
import { ARENA } from "./world";

const SEED = 12_345;

// How far a tile sits from arena center, as a fraction of the half-extent, in the max-norm
// the square arena (and the ore gradient) is measured in. 0 = center, 1 = wall.
function edgeFrac(tile: Tile, arena = ARENA): number {
  const half = Math.min(arena.width, arena.height) / 2;
  const o = tileOrigin(tile);
  return Math.max(Math.abs(o.x - arena.width / 2), Math.abs(o.y - arena.height / 2)) / half;
}

describe("the tile grid", () => {
  test("one tile is 15 world units, tiling the arena into 2,080 squares a side", () => {
    expect(TILE).toBe(15);
    expect(ARENA.width / TILE).toBe(2080);
  });

  test("tileOf floors a world position onto its tile, and tileOrigin returns that corner", () => {
    expect(tileOf({ x: 0, y: 0 })).toEqual({ tx: 0, ty: 0 });
    expect(tileOf({ x: 14.9, y: 15 })).toEqual({ tx: 0, ty: 1 });
    expect(tileOrigin({ tx: 3, ty: 4 })).toEqual({ x: 45, y: 60 });
  });

  test("tileKey is unique per tile across the whole arena", () => {
    expect(tileKey({ tx: 1, ty: 0 })).not.toBe(tileKey({ tx: 0, ty: 1 }));
    expect(tileKey({ tx: 2079, ty: 2079 })).toBe(tileKey({ tx: 2079, ty: 2079 }));
    expect(Number.isSafeInteger(tileKey({ tx: 2079, ty: 2079 }))).toBe(true);
  });

  // The world settings let a host size the arena, and the packing is what stops being valid first
  // (ADR 0006). Written down as the limit rather than as a comment, so #129's control can offer up to
  // it without a second copy of `TILE`: an arena this wide reaches a last tile whose key is still its
  // own, and one tile past it the far end of a column lands on the start of the next one.
  test("MAX_ARENA_SIDE stops at the last tile index the packed key keeps distinct", () => {
    const last = Math.floor(MAX_ARENA_SIDE / TILE) - 1;
    expect(tileKey({ tx: 0, ty: last })).not.toBe(tileKey({ tx: 1, ty: 0 }));
    expect(tileKey({ tx: 0, ty: last + 1 })).toBe(tileKey({ tx: 1, ty: 0 }));
    expect(Number.isSafeInteger(tileKey({ tx: last, ty: last }))).toBe(true);
  });
});

// #104: a drag places across every tile the cursor crosses, and a pointer sampled at 60 Hz jumps
// several tiles between samples. This is what turns two samples back into the path between them.
describe("tilesBetween", () => {
  const steps = (path: Tile[], from: Tile) =>
    path.map((t, i) => {
      const prev = path[i - 1] ?? from;
      return Math.abs(t.tx - prev.tx) + Math.abs(t.ty - prev.ty);
    });

  test("a sample that has not left its tile adds nothing, so the first tile is placed once", () => {
    expect(tilesBetween({ tx: 7, ty: 3 }, { tx: 7, ty: 3 })).toEqual([]);
  });

  test("fills a straight run, excluding where it starts and including where it ends", () => {
    expect(tilesBetween({ tx: 4, ty: 9 }, { tx: 7, ty: 9 })).toEqual([
      { tx: 5, ty: 9 },
      { tx: 6, ty: 9 },
      { tx: 7, ty: 9 },
    ]);
  });

  test("a pointer that jumped twenty tiles in one sample yields all twenty, in order", () => {
    const path = tilesBetween({ tx: 0, ty: 0 }, { tx: 20, ty: 0 });
    expect(path).toEqual(Array.from({ length: 20 }, (_, i) => ({ tx: i + 1, ty: 0 })));
  });

  test("a diagonal run is a connected staircase — never a step a wall could be walked through", () => {
    const from = { tx: 0, ty: 0 };
    const path = tilesBetween(from, { tx: 6, ty: 4 });
    expect(path.at(-1)).toEqual({ tx: 6, ty: 4 });
    expect(steps(path, from).filter((step) => step !== 1)).toEqual([]);
  });

  test("every direction is connected and lands exactly on its end", () => {
    const from = { tx: 30, ty: 30 };
    for (const to of [
      { tx: 25, ty: 22 },
      { tx: 41, ty: 27 },
      { tx: 30, ty: 18 },
      { tx: 12, ty: 30 },
      { tx: 31, ty: 44 },
    ]) {
      const path = tilesBetween(from, to);
      expect(path.at(-1)).toEqual(to);
      expect(steps(path, from).filter((step) => step !== 1)).toEqual([]);
    }
  });
});

describe("mulberry32", () => {
  // A golden stream, not a property. The server and every browser derive the ore grid from one
  // `oreSeed` and never send it, so an edit that drops a `>>> 0` or an `imul` would still look
  // like a fine PRNG while silently desyncing the map. These literals are what fails first.
  test("yields a known sequence from a known seed", () => {
    const rng = mulberry32(1);
    expect(Array.from({ length: 8 }, rng)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635,
    ]);
  });
});

describe("generateOre", () => {
  test("the same seed yields a byte-identical grid on both sides", () => {
    const a = generateOre(ARENA, SEED);
    const b = generateOre(ARENA, SEED);
    expect(a.size).toBe(b.size);
    for (const [key, kind] of a) expect(b.get(key)).toBe(kind);
  });

  test("a different seed yields a different grid", () => {
    const a = generateOre(ARENA, SEED);
    const b = generateOre(ARENA, SEED + 1);
    let same = 0;
    for (const [key, kind] of a) if (b.get(key) === kind) same++;
    expect(same).toBeLessThan(a.size / 2);
  });

  test("both ore kinds are present, and power ore is the sparser of the two", () => {
    const grid = generateOre(ARENA, SEED);
    let metal = 0;
    let power = 0;
    for (const kind of grid.values()) kind === "metal" ? metal++ : power++;
    expect(metal).toBeGreaterThan(0);
    expect(power).toBeGreaterThan(0);
    expect(power).toBeLessThan(metal / 4);
  });

  test("the grid stays cheap — a few thousand tiles, not the 2,080² the arena could hold", () => {
    const grid = generateOre(ARENA, SEED);
    expect(grid.size).toBeGreaterThan(3_000);
    expect(grid.size).toBeLessThan(15_000);
  });

  test("density follows the center→edge gradient — richer toward the wall", () => {
    const grid = generateOre(ARENA, SEED);
    let inner = 0;
    let outer = 0;
    for (const key of grid.keys()) edgeFrac(untileKey(key)) < 0.5 ? inner++ : outer++;
    // The outer band is 3× the area of the inner one, so a flat distribution would give 3:1;
    // the gradient must beat that.
    expect(outer).toBeGreaterThan(inner * 4);
  });

  test("metal ore is still present near center, so the squad can bootstrap", () => {
    const grid = generateOre(ARENA, SEED);
    const nearby = [...grid.entries()].filter(
      ([key, kind]) => kind === "metal" && edgeFrac(untileKey(key)) < 0.1,
    );
    expect(nearby.length).toBeGreaterThan(0);
  });

  test("every tile is inside the arena", () => {
    const grid = generateOre(ARENA, SEED);
    const max = ARENA.width / TILE - 1;
    for (const key of grid.keys()) {
      const { tx, ty } = untileKey(key);
      expect(tx).toBeGreaterThanOrEqual(0);
      expect(ty).toBeGreaterThanOrEqual(0);
      expect(tx).toBeLessThanOrEqual(max);
      expect(ty).toBeLessThanOrEqual(max);
    }
  });

  test("oreAt reads a placed tile and returns null off the patches", () => {
    const grid = generateOre(ARENA, SEED);
    const [key, kind] = [...grid.entries()][0];
    expect(oreAt(grid, untileKey(key))).toBe(kind);
    expect(oreAt(grid, { tx: -1, ty: -1 })).toBeNull();
  });
});

// Reverse of tileKey; test-only, so the production key stays a cheap packed number.
function untileKey(key: number): Tile {
  return { tx: Math.floor(key / 65_536), ty: key % 65_536 };
}

describe("admitMine", () => {
  const grid = generateOre(ARENA, SEED);
  const metalTile = [...grid.entries()].find(([, kind]) => kind === "metal")?.[0] as number;
  const powerTile = [...grid.entries()].find(([, kind]) => kind === "power")?.[0] as number;
  const metal = untileKey(metalTile);
  const power = untileKey(powerTile);
  const atTile = (tile: Tile) => tileOrigin(tile);

  test("grants metal proportional to the elapsed time, at the hand-mine rate", () => {
    const guard = freshMineGuard();
    admitMine(guard, { tile: metal, seq: 1 }, atTile(metal), grid, 1_000); // starts the clock
    const granted = admitMine(guard, { tile: metal, seq: 2 }, atTile(metal), grid, 1_200);
    expect(granted).toBeCloseTo(HAND_MINE_RATE * 0.2, 6);
  });

  test("a full second of holding banks exactly the hand-mine rate, however often it reports", () => {
    const total = (stepMs: number) => {
      const guard = freshMineGuard();
      let metalMined = 0;
      for (let t = 0; t <= 1_000; t += stepMs) {
        metalMined += admitMine(guard, { tile: metal, seq: t + 1 }, atTile(metal), grid, t);
      }
      return metalMined;
    };
    expect(total(100)).toBeCloseTo(HAND_MINE_RATE, 6);
    expect(total(20)).toBeCloseTo(HAND_MINE_RATE, 6); // a spammer earns no more than an honest client
  });

  test("rejects a tile that is not metal ore", () => {
    const guard = freshMineGuard();
    const bare = { tx: 0, ty: 0 };
    expect(admitMine(guard, { tile: bare, seq: 1 }, atTile(bare), grid, 1_000)).toBe(0);
  });

  test("rejects power ore — energy has nowhere to be stored", () => {
    const guard = freshMineGuard();
    expect(admitMine(guard, { tile: power, seq: 1 }, atTile(power), grid, 1_000)).toBe(0);
  });

  test("rejects a tile beyond the server's loose reach", () => {
    const guard = freshMineGuard();
    const far = { x: tileOrigin(metal).x + INTERACT_REACH + 100, y: tileOrigin(metal).y };
    expect(admitMine(guard, { tile: metal, seq: 1 }, far, grid, 1_000)).toBe(0);
  });

  test("rejects a stale or duplicate seq", () => {
    const guard = freshMineGuard();
    admitMine(guard, { tile: metal, seq: 5 }, atTile(metal), grid, 1_000);
    expect(admitMine(guard, { tile: metal, seq: 5 }, atTile(metal), grid, 2_000)).toBe(0);
    expect(admitMine(guard, { tile: metal, seq: 4 }, atTile(metal), grid, 2_000)).toBe(0);
  });

  test("rejects a repeat that arrives before the cadence floor", () => {
    const guard = freshMineGuard();
    admitMine(guard, { tile: metal, seq: 1 }, atTile(metal), grid, 1_000);
    const tooSoon = admitMine(
      guard,
      { tile: metal, seq: 2 },
      atTile(metal),
      grid,
      1_000 + MINE_CADENCE_MS - 1,
    );
    expect(tooSoon).toBe(0);
  });

  test("a rejected too-soon request does not cost the player its accrual", () => {
    const guard = freshMineGuard();
    admitMine(guard, { tile: metal, seq: 1 }, atTile(metal), grid, 1_000);
    admitMine(guard, { tile: metal, seq: 2 }, atTile(metal), grid, 1_010); // dropped
    const granted = admitMine(guard, { tile: metal, seq: 3 }, atTile(metal), grid, 1_200);
    expect(granted).toBeCloseTo(HAND_MINE_RATE * 0.2, 6);
  });

  test("caps a burst after a long pause, so idling banks nothing", () => {
    const guard = freshMineGuard();
    admitMine(guard, { tile: metal, seq: 1 }, atTile(metal), grid, 1_000);
    const afterPause = admitMine(guard, { tile: metal, seq: 2 }, atTile(metal), grid, 60_000);
    expect(afterPause).toBeCloseTo((MINE_WINDOW_MAX_MS / 1000) * HAND_MINE_RATE, 6);
  });

  // #109 drops the hand rate to 1: through `creditMetal` that is one whole Metal banked per
  // second held, so a ten-second dig is worth exactly ten — a fifth of a miner.
  test("mines one metal a second, so a ten-second hold banks ten whole Metal", () => {
    expect(HAND_MINE_RATE).toBe(1);
    const guard = freshMineGuard();
    const build = freshBuildState(ARENA);
    for (let t = 0; t <= 10_000; t += MINE_CADENCE_MS) {
      creditMetal(build, admitMine(guard, { tile: metal, seq: t + 1 }, atTile(metal), grid, t));
    }
    expect(build.bank.metal).toBe(10);
  });
});

// #96: income is structural rather than manual. Hand-mining used to be twice a miner; it is now
// half of one. Both sides of the comparison are run through the real paths and the same
// `creditMetal`, so what is asserted is the ratio the bank is actually paid over one held stretch —
// not two constants divided by each other.
describe("#96: a standing miner out-earns a hand-miner two to one", () => {
  const ore = generateOre(ARENA, SEED);
  const metal = untileKey([...ore.entries()].find(([, kind]) => kind === "metal")?.[0] as number);
  const HELD_MS = 10_000;
  const TICK_MS = 50; // the sim's own 20 Hz tick

  // One player holding the button for the whole stretch, reporting at the honest cadence.
  function byHand(): number {
    const guard = freshMineGuard();
    const build = freshBuildState(ARENA);
    for (let t = 0; t <= HELD_MS; t += MINE_CADENCE_MS) {
      creditMetal(build, admitMine(guard, { tile: metal, seq: t + 1 }, tileOrigin(metal), ore, t));
    }
    return build.bank.metal;
  }

  // One miner standing on the same ore for the same stretch. Measured as a delta so the Metal it
  // cost to put up is not counted as income.
  function byMiner(): number {
    const build = freshBuildState(ARENA);
    const spec = BUILDABLES.miner as BuildableSpec;
    build.bank.metal = spec.cost;
    placeStructure(build, "miner", metal, spec);
    const before = build.bank.metal;
    for (let t = 0; t < HELD_MS; t += TICK_MS) stepBuild(build, TICK_MS);
    return build.bank.metal - before;
  }

  test("over the same ten seconds, the miner banks exactly twice what the digging does", () => {
    const hand = byHand();
    expect(hand).toBeGreaterThan(0);
    expect(byMiner()).toBe(2 * hand);
  });
});

describe("the buildable registry", () => {
  test("the bar has four slots in a fixed order, so 1–4 always mean the same thing", () => {
    expect(BUILD_SLOTS).toEqual(["miner", "wall", "turret", "generator"]);
  });

  test("the miner is a 2×2 that only sits on metal ore", () => {
    expect(BUILDABLES.miner).toEqual({ footprint: 2, cost: 50, hp: 200, requires: "metal" });
  });

  test("footprintTiles covers exactly the square from the top-left tile", () => {
    expect(footprintTiles({ tx: 3, ty: 4 }, 2)).toEqual([
      { tx: 3, ty: 4 },
      { tx: 4, ty: 4 },
      { tx: 3, ty: 5 },
      { tx: 4, ty: 5 },
    ]);
    expect(footprintTiles({ tx: 0, ty: 0 }, 5)).toHaveLength(25);
  });
});

describe("#101: a turret costs more Metal for each turret already standing", () => {
  const ore = generateOre(ARENA, SEED);
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const rich = (metal: number) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = metal;
    return build;
  };
  // A turret needs no ore, so a row of bare tiles two apart stands any number of them up.
  const stand = (build: BuildState, count: number) =>
    Array.from({ length: count }, (_, i) =>
      placeStructure(build, "turret", { tx: 2 * i, ty: 0 }, TURRET),
    );
  const NEXT_TILE = { tx: 200, ty: 0 }; // clear of every turret `stand` puts down
  const squad = (standing: number) => {
    const build = rich(1_000_000);
    stand(build, standing);
    return build;
  };

  // The author's table, and the whole of the rounding rule: 60 × 1.3³ is 131.82, which rounds to
  // 132 and would floor to 131, so the table itself says which rounding this is.
  const PRICES: ReadonlyArray<readonly [number, number]> = [
    [0, 60],
    [1, 78],
    [2, 101],
    [3, 132],
    [4, 171],
    [5, 223],
    [8, 489],
    [10, 827],
  ];

  test("prices the next turret at base 60 × 1.3 per standing turret, rounded whole", () => {
    for (const [standing, cost] of PRICES) {
      expect([standing, buildCost("turret", squad(standing))]).toEqual([standing, cost]);
    }
  });

  test("admission refuses one Metal below that price and admits at exactly it", () => {
    for (const [standing, cost] of PRICES) {
      const build = squad(standing);
      build.bank.metal = cost - 1;
      expect(placementError("turret", NEXT_TILE, ore, build, null)).toBe("unaffordable");
      build.bank.metal = cost;
      expect(placementError("turret", NEXT_TILE, ore, build, null)).toBeNull();
    }
  });

  test("placing debits that same price, leaving a bank that could just afford it empty", () => {
    for (const [standing, cost] of PRICES) {
      const build = squad(standing);
      build.bank.metal = cost;
      placeStructure(build, "turret", NEXT_TILE, TURRET);
      expect([standing, build.bank.metal]).toEqual([standing, 0]);
    }
  });

  test("demolishing a turret drops the next one's price by exactly one step", () => {
    const build = squad(5);
    expect(buildCost("turret", build)).toBe(223);
    const [first] = [...build.structures.values()];
    demolishStructure(build, first);
    expect(buildCost("turret", build)).toBe(171); // the n = 4 price
  });

  test("a turret lost from the map drops it the same way, whoever took it", () => {
    const build = squad(3);
    const [first] = [...build.structures.values()];
    removeStructure(build, first.id); // the sim's own path when an enemy chews one down
    expect(buildCost("turret", build)).toBe(101); // the n = 2 price
  });

  test("counts the squad's turrets, not one player's — every placer walks the same curve", () => {
    const build = rich(1_000_000);
    const alice = freshBuildGuard();
    const bob = freshBuildGuard();
    const prices: number[] = [];
    for (let i = 0; i < 4; i++) {
      const guard = i % 2 === 0 ? alice : bob; // the two take turns
      prices.push(buildCost("turret", build));
      const tile = { tx: 2 * i, ty: 0 };
      const spec = admitBuild(
        guard,
        { kind: "turret", tile, seq: i },
        null,
        ore,
        build,
        i * BUILD_CADENCE_MS,
      );
      placeStructure(build, "turret", tile, spec as BuildableSpec);
    }
    expect(prices).toEqual([60, 78, 101, 132]);
  });

  test("leaves every other buildable at a flat price, however many turrets stand", () => {
    for (const [standing] of PRICES) {
      const build = squad(standing);
      expect([standing, buildCost("miner", build)]).toEqual([standing, 50]);
      expect([standing, buildCost("wall", build)]).toEqual([standing, 10]);
      expect([standing, buildCost("generator", build)]).toEqual([standing, 150]);
    }
  });

  test("only turrets count — a standing wall does not move the turret's price", () => {
    const build = rich(1_000_000);
    placeStructure(build, "wall", { tx: 300, ty: 0 }, BUILDABLES.wall as BuildableSpec);
    expect(buildCost("turret", build)).toBe(60);
  });
});

describe("placementError — the one rule the ghost and the server both read", () => {
  const ore = generateOre(ARENA, SEED);
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const powerTile = (() => {
    for (const [key, kind] of ore) if (kind === "power") return untileKey(key);
    throw new Error("no power ore");
  })();
  const bare = { tx: 0, ty: 0 };
  const rich = (metal: number) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = metal;
    return build;
  };
  const near = (tile: Tile) => footprintCenter(tile, 2);

  test("a funded miner on metal ore within reach is placeable", () => {
    expect(placementError("miner", metalTile, ore, rich(50), near(metalTile))).toBeNull();
  });

  test("an empty bank blocks it", () => {
    expect(placementError("miner", metalTile, ore, rich(49), near(metalTile))).toBe("unaffordable");
  });

  test("bare ground and power ore both fail the miner's ore requirement", () => {
    expect(placementError("miner", bare, ore, rich(50), near(bare))).toBe("wrong-ore");
    expect(placementError("miner", powerTile, ore, rich(50), near(powerTile))).toBe("wrong-ore");
  });

  test("any one tile under the footprint being metal ore is enough", () => {
    // Anchor the 2×2 up-left of a metal tile: only its bottom-right corner is on the ore.
    const straddle = { tx: metalTile.tx - 1, ty: metalTile.ty - 1 };
    expect(placementError("miner", straddle, ore, rich(50), near(straddle))).toBeNull();
  });

  test("an occupied footprint is blocked, and freeing it makes the same tile legal again", () => {
    const build = rich(500);
    const placed = placeStructure(build, "miner", metalTile, BUILDABLES.miner as BuildableSpec);
    expect(placementError("miner", metalTile, ore, build, near(metalTile))).toBe("blocked");
    // Overlapping by one corner still collides — occupancy is per tile, not per anchor.
    const overlap = { tx: metalTile.tx + 1, ty: metalTile.ty + 1 };
    expect(placementError("miner", overlap, ore, build, near(overlap))).toBe("blocked");
    removeStructure(build, placed.id);
    expect(placementError("miner", metalTile, ore, build, near(metalTile))).toBeNull();
  });

  test("a footprint hanging off the arena edge is refused", () => {
    const maxTile = ARENA.width / TILE - 1;
    const edge = { tx: maxTile, ty: maxTile }; // a 2×2 anchored here runs one tile past the wall
    expect(placementError("miner", edge, ore, rich(50), near(edge))).toBe("out-of-bounds");
  });

  test("a tile beyond the loose reach is refused", () => {
    const far = { x: footprintCenter(metalTile, 2).x + INTERACT_REACH + 1, y: 0 };
    expect(placementError("miner", metalTile, ore, rich(50), far)).toBe("out-of-reach");
  });

  test("every bar slot is registered, so none renders inert", () => {
    for (const kind of BUILD_SLOTS) expect(BUILDABLES[kind]).toBeDefined();
  });

  test("a kind with no registry entry can never place", () => {
    const bogus = "trebuchet" as unknown as (typeof BUILD_SLOTS)[number];
    expect(placementError(bogus, bare, ore, rich(10_000), near(bare))).toBe("unknown-buildable");
  });

  test("a wall needs no ore — every tile in the arena is buildable", () => {
    expect(placementError("wall", bare, ore, rich(10), near(bare))).toBeNull();
    expect(placementError("wall", metalTile, ore, rich(10), near(metalTile))).toBeNull();
  });
});

describe("placing and stepping structures", () => {
  const ore = generateOre(ARENA, SEED);
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const spec = BUILDABLES.miner as BuildableSpec;

  test("placing debits the bank exactly once and seeds the structure at full HP", () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 130;
    const miner = placeStructure(build, "miner", metalTile, spec);
    expect(build.bank.metal).toBe(80);
    expect(miner.hp).toBe(spec.hp);
    expect(build.structures.size).toBe(1);
    expect(build.occupancy.size).toBe(4); // a 2×2 claims four tiles
  });

  test("a miner trickles Metal into the bank across ticks, and two miners trickle twice as fast", () => {
    const one = freshBuildState(ARENA);
    one.bank.metal = 50;
    placeStructure(one, "miner", metalTile, spec);
    for (let i = 0; i < 20; i++) stepBuild(one, 50); // one second at 20 Hz
    expect(one.bank.metal).toBeCloseTo(MINER_TRICKLE, 6);

    const two = freshBuildState(ARENA);
    two.bank.metal = 100;
    placeStructure(two, "miner", metalTile, spec);
    placeStructure(two, "miner", { tx: metalTile.tx + 2, ty: metalTile.ty }, spec);
    for (let i = 0; i < 20; i++) stepBuild(two, 50);
    expect(two.bank.metal).toBeCloseTo(2 * MINER_TRICKLE, 6);
  });

  test("an empty grid banks nothing", () => {
    const build = freshBuildState(ARENA);
    stepBuild(build, 1_000);
    expect(build.bank.metal).toBe(0);
  });

  test("a destroyed miner stops trickling", () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 50;
    const miner = placeStructure(build, "miner", metalTile, spec);
    removeStructure(build, miner.id);
    stepBuild(build, 1_000);
    expect(build.bank.metal).toBe(0);
  });

  // #105: the rate the HUD shows on hover. It is the same arithmetic `stepBuild` accumulates, named
  // so the readout cannot drift from what the bank is actually being paid.
  test("metalRate is the standing miners' trickle, and nothing else's", () => {
    const build = freshBuildState(ARENA);
    expect(metalRate(build)).toBe(0);
    build.bank.metal = 500;
    placeStructure(build, "miner", metalTile, spec);
    expect(metalRate(build)).toBe(MINER_TRICKLE);
    const second = placeStructure(build, "miner", { tx: metalTile.tx + 2, ty: metalTile.ty }, spec);
    expect(metalRate(build)).toBe(2 * MINER_TRICKLE);
    // A wall banks nothing, so it must not move the reading.
    placeStructure(
      build,
      "wall",
      { tx: metalTile.tx, ty: metalTile.ty + 2 },
      BUILDABLES.wall as BuildableSpec,
    );
    expect(metalRate(build)).toBe(2 * MINER_TRICKLE);
    removeStructure(build, second.id);
    expect(metalRate(build)).toBe(MINER_TRICKLE);
  });

  test("and it is exactly what one second of stepBuild pays in", () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 200;
    placeStructure(build, "miner", metalTile, spec);
    placeStructure(build, "miner", { tx: metalTile.tx + 2, ty: metalTile.ty }, spec);
    const before = build.bank.metal;
    for (let i = 0; i < 20; i++) stepBuild(build, 50);
    expect(build.bank.metal - before).toBeCloseTo(metalRate(build), 6);
  });
});

// #102: the bank holds whole Metal and nothing else, so a 4.9999 balance cannot exist and a cost
// boundary is decided by an integer comparison. The sub-unit remainder is carried by the accumulator
// rather than dropped, and the whole-Metal crossing that falls out of it is the beat #99 floats a
// `+1` on and #109 arms its pin from.
describe("the bank is whole Metal", () => {
  const ore = generateOre(ARENA, SEED);
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const MINER = BUILDABLES.miner as BuildableSpec;
  const WALL = BUILDABLES.wall as BuildableSpec;

  // Three miners at 20 Hz is the case a plain floating-point accumulator gets wrong: 0.6 a tick
  // sums to 119.99999999999973 over ten seconds, banking 119 where the squad earned 120.
  const threeMiners = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 3 * MINER.cost;
    for (let i = 0; i < 3; i++) {
      placeStructure(build, "miner", { tx: metalTile.tx + 2 * i, ty: metalTile.ty }, MINER);
    }
    return build;
  };

  test("a fresh bank starts empty and whole", () => {
    expect(freshBuildState(ARENA).bank.metal).toBe(0);
  });

  test("no partial tick can leave a fraction in the bank", () => {
    const build = threeMiners();
    for (const dtMs of [7, 13, 1, 50, 3, 111, 29, 50, 50, 17]) {
      stepBuild(build, dtMs);
      expect(Number.isInteger(build.bank.metal)).toBe(true);
    }
  });

  test("three miners bank exactly ten seconds of their rate — the remainder carries", () => {
    const build = threeMiners();
    build.bank.metal = 0;
    for (let i = 0; i < 200; i++) stepBuild(build, 50); // ten seconds at 20 Hz
    expect(build.bank.metal).toBe(10 * metalRate(build));
  });

  test("accrual does not drift over a long match", () => {
    const build = threeMiners();
    build.bank.metal = 0;
    for (let i = 0; i < 6_000; i++) stepBuild(build, 50); // five minutes at 20 Hz
    expect(build.bank.metal).toBe(300 * metalRate(build));
  });

  test("a credit under one Metal banks nothing yet loses nothing", () => {
    const build = freshBuildState(ARENA);
    expect(creditMetal(build, 0.4)).toBe(0);
    expect(build.bank.metal).toBe(0);
    expect(creditMetal(build, 0.6)).toBe(1);
    expect(build.bank.metal).toBe(1);
  });

  // The amount T17's 1 metal/s hand-mining pays in per 100 ms report.
  test("two hundred fractional credits bank their exact total", () => {
    const build = freshBuildState(ARENA);
    let crossings = 0;
    for (let i = 0; i < 200; i++) crossings += creditMetal(build, 0.1);
    expect(build.bank.metal).toBe(20);
    expect(crossings).toBe(20);
  });

  test("creditMetal reports the whole Metal it banked, so a crossing is observable", () => {
    const build = freshBuildState(ARENA);
    expect(creditMetal(build, 2.5)).toBe(2);
    expect(creditMetal(build, 2.5)).toBe(3); // the carried .5 completes the third
    expect(build.bank.metal).toBe(5);
  });

  // The tick count is derived from the trickle rather than fixed, so a retune of MINER_TRICKLE
  // cannot leave this asserting a sequence the rate no longer produces.
  test("stepBuild reports the whole Metal that crossed on that tick, not the rate", () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = MINER.cost;
    placeStructure(build, "miner", metalTile, MINER);
    const TICK_MS = 50;
    const ticks = Math.ceil(1_000 / (MINER_TRICKLE * TICK_MS)); // ticks one miner takes per Metal
    const crossings = [];
    for (let i = 0; i < ticks; i++) crossings.push(stepBuild(build, TICK_MS));
    expect(crossings).toEqual([...new Array(ticks - 1).fill(0), 1]);
  });

  test("an idle grid reports no crossing", () => {
    expect(stepBuild(freshBuildState(ARENA), 1_000)).toBe(0);
  });

  // The point of the whole change: affordability is an integer comparison, so there is no balance
  // that displays as 10 but refuses a 10-Metal wall.
  test("a cost boundary reached by accrual is exact", () => {
    const build = freshBuildState(ARENA);
    const bare = { tx: 0, ty: 0 };
    for (let i = 0; i < 99; i++) creditMetal(build, 0.1); // 9.9 Metal earned
    expect(build.bank.metal).toBe(WALL.cost - 1);
    expect(placementError("wall", bare, ore, build, null)).toBe("unaffordable");
    creditMetal(build, 0.1);
    expect(build.bank.metal).toBe(WALL.cost);
    expect(placementError("wall", bare, ore, build, null)).toBeNull();
  });

  // Spending and refunding move whole Metal only, so neither may disturb the remainder a miner has
  // part-earned: a demolish must not reset the progress toward the next Metal, nor round it away.
  test("spending and refunding leave the pending remainder untouched", () => {
    const build = threeMiners();
    build.bank.metal = 0;
    const ticks = 37; // deliberately not a whole second, so a remainder is outstanding throughout
    for (let i = 0; i < ticks; i++) stepBuild(build, 50);
    const earned = ticks * 50 * metalRate(build); // thousandths, by the rate rather than the code
    expect(build.bank.metal).toBe(Math.floor(earned / 1_000));
    expect(build.metalThousandths).toBe(earned % 1_000);
    expect(build.metalThousandths).toBeGreaterThan(0);

    const wall = placeStructure(build, "wall", { tx: metalTile.tx, ty: metalTile.ty + 4 }, WALL);
    expect(build.bank.metal).toBe(Math.floor(earned / 1_000) - WALL.cost);
    expect(build.metalThousandths).toBe(earned % 1_000);

    const refund = demolishStructure(build, wall);
    expect(build.bank.metal).toBe(Math.floor(earned / 1_000) - WALL.cost + refund);
    expect(build.metalThousandths).toBe(earned % 1_000);
  });
});

describe("admitBuild", () => {
  const ore = generateOre(ARENA, SEED);
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const funded = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000;
    return build;
  };
  const from = footprintCenter(metalTile, 2);

  test("admits a legal placement and returns its spec", () => {
    const guard = freshBuildGuard();
    const spec = admitBuild(
      guard,
      { kind: "miner", tile: metalTile, seq: 1 },
      from,
      ore,
      funded(),
      0,
    );
    expect(spec).toEqual(BUILDABLES.miner as BuildableSpec);
  });

  test("drops a stale or duplicate seq", () => {
    const guard = freshBuildGuard();
    const build = funded();
    admitBuild(guard, { kind: "miner", tile: metalTile, seq: 5 }, from, ore, build, 0);
    const replay = admitBuild(
      guard,
      { kind: "miner", tile: metalTile, seq: 5 },
      from,
      ore,
      build,
      10_000,
    );
    expect(replay).toBeNull();
  });

  test("rate-limits a too-soon second placement", () => {
    const guard = freshBuildGuard();
    const build = funded();
    admitBuild(guard, { kind: "miner", tile: metalTile, seq: 1 }, from, ore, build, 1_000);
    const soon = { tx: metalTile.tx + 5, ty: metalTile.ty };
    expect(
      admitBuild(
        guard,
        { kind: "miner", tile: soon, seq: 2 },
        footprintCenter(soon, 2),
        ore,
        build,
        1_000 + BUILD_CADENCE_MS - 1,
      ),
    ).toBeNull();
  });

  test("refuses unaffordable, wrong-ore and out-of-reach placements", () => {
    const broke = freshBuildState(ARENA);
    expect(
      admitBuild(
        freshBuildGuard(),
        { kind: "miner", tile: metalTile, seq: 1 },
        from,
        ore,
        broke,
        0,
      ),
    ).toBeNull();
    const bare = { tx: 0, ty: 0 };
    expect(
      admitBuild(
        freshBuildGuard(),
        { kind: "miner", tile: bare, seq: 1 },
        footprintCenter(bare, 2),
        ore,
        funded(),
        0,
      ),
    ).toBeNull();
    expect(
      admitBuild(
        freshBuildGuard(),
        { kind: "miner", tile: metalTile, seq: 1 },
        { x: from.x + INTERACT_REACH + 1, y: from.y },
        ore,
        funded(),
        0,
      ),
    ).toBeNull();
  });
});

describe("solidity — the one occupancy test both sides read", () => {
  const WALL = BUILDABLES.wall as BuildableSpec;
  const walled = (tile: Tile) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000;
    placeStructure(build, "wall", tile, WALL);
    return build;
  };
  const anchor = { tx: 100, ty: 100 };
  const RADIUS = 14; // PLAYER_RADIUS

  test("the wall is a 2×2 placeable anywhere, cheap and tough", () => {
    expect(WALL).toEqual({ footprint: 2, cost: 10, hp: 400, requires: null });
  });

  test("solidAt is true for every tile under the footprint and false just outside it", () => {
    const build = walled(anchor);
    for (const t of footprintTiles(anchor, 2)) expect(solidAt(build, t)).toBe(true);
    expect(solidAt(build, { tx: anchor.tx + 2, ty: anchor.ty })).toBe(false);
    expect(solidAt(build, { tx: anchor.tx - 1, ty: anchor.ty })).toBe(false);
  });

  test("a circle walking into the wall is stopped outside it", () => {
    const build = walled(anchor);
    const centre = footprintCenter(anchor, 2);
    const from = { x: centre.x - 200, y: centre.y };
    const into = { x: centre.x, y: centre.y }; // straight into the middle of the footprint
    const landed = slidePos(build, from, into, RADIUS);
    expect(landed.x).toBe(from.x); // the x move was refused
    expect(structureBlocking(build, landed, RADIUS)).toBeNull();
  });

  test("you slide along a wall rather than sticking to it", () => {
    const build = walled(anchor);
    const centre = footprintCenter(anchor, 2);
    // Pressed against the wall's left face, moving down-right: x is refused, y goes through.
    const from = { x: centre.x - TILE - RADIUS, y: centre.y };
    const landed = slidePos(build, from, { x: from.x + 10, y: from.y + 10 }, RADIUS);
    expect(landed.x).toBe(from.x);
    expect(landed.y).toBe(from.y + 10);
  });

  test("walled in on three sides, you still escape along the fourth — never hard-trapped", () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000;
    // A pocket open to the west: walls north, east and south of the gap at `anchor`.
    placeStructure(build, "wall", { tx: anchor.tx, ty: anchor.ty - 2 }, WALL);
    placeStructure(build, "wall", { tx: anchor.tx + 2, ty: anchor.ty }, WALL);
    placeStructure(build, "wall", { tx: anchor.tx, ty: anchor.ty + 2 }, WALL);
    const inside = footprintCenter(anchor, 2);
    expect(structureBlocking(build, inside, RADIUS)).toBeNull(); // the pocket itself is free

    const west = slidePos(build, inside, { x: inside.x - 10, y: inside.y }, RADIUS);
    expect(west.x).toBe(inside.x - 10); // the open side lets you out
  });

  test("pushOutOfSolids shoves a spawn clear of the footprint it landed in", () => {
    const build = walled(anchor);
    const centre = footprintCenter(anchor, 2);
    const pushed = pushOutOfSolids(build, { x: centre.x + 1, y: centre.y }, 16);
    expect(structureBlocking(build, pushed, 16)).toBeNull();
  });

  test("pushOutOfSolids leaves a position that was never inside anything alone", () => {
    const build = walled(anchor);
    const clear = { x: footprintCenter(anchor, 2).x + 500, y: footprintCenter(anchor, 2).y };
    expect(pushOutOfSolids(build, clear, 16)).toEqual(clear);
  });

  test("an empty grid never blocks and never slides", () => {
    const build = freshBuildState(ARENA);
    const to = { x: 500, y: 500 };
    expect(slidePos(build, { x: 400, y: 400 }, to, RADIUS)).toEqual(to);
    expect(structureBlocking(build, to, RADIUS)).toBeNull();
    expect(structureBlocking(null, to, RADIUS)).toBeNull();
  });
});

describe("demolish", () => {
  const ore = generateOre(ARENA, SEED);
  const MINER = BUILDABLES.miner as BuildableSpec;
  const WALL = BUILDABLES.wall as BuildableSpec;
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const funded = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000;
    return build;
  };

  test("the tile resolver picks the structure over the ore under it", () => {
    const build = funded();
    const miner = placeStructure(build, "miner", metalTile, MINER);
    // Ore-first would make a miner undemolishable, since one sits on metal ore by definition.
    expect(resolveHarvest(metalTile, ore, build)).toEqual({ kind: "demolish", id: miner.id });
    removeStructure(build, miner.id);
    expect(resolveHarvest(metalTile, ore, build)).toEqual({ kind: "mine", tile: metalTile });
  });

  test("bare ground under the cursor resolves to nothing at all", () => {
    expect(resolveHarvest({ tx: 0, ty: 0 }, ore, funded())).toBeNull();
  });

  test("the refund is exactly floor(cost × 20%)", () => {
    const build = funded();
    const miner = placeStructure(build, "miner", metalTile, MINER); // 1000 − 50
    expect(demolishStructure(build, miner)).toBe(Math.floor(MINER.cost * 0.2));
    expect(build.bank.metal).toBe(1_000 - MINER.cost + Math.floor(MINER.cost * 0.2));
  });

  test("a cheap building can refund nothing — the rounding is down", () => {
    const build = funded();
    const wall = placeStructure(build, "wall", { tx: 500, ty: 500 }, WALL); // cost 10 → 2
    expect(demolishStructure(build, wall)).toBe(2);
  });

  test("the tiles free immediately, so a rebuild on the footprint is legal at once", () => {
    const build = funded();
    const miner = placeStructure(build, "miner", metalTile, MINER);
    expect(placementError("miner", metalTile, ore, build, null)).toBe("blocked");
    demolishStructure(build, miner);
    expect(placementError("miner", metalTile, ore, build, null)).toBeNull();
    expect(build.occupancy.size).toBe(0);
  });

  test("admitDemolish accepts any player, not just whoever placed it", () => {
    const build = funded();
    const miner = placeStructure(build, "miner", metalTile, MINER);
    const stranger = freshDemolishGuard(); // a guard that has never seen this structure
    const at = structureCenter(miner);
    expect(admitDemolish(stranger, { id: miner.id, seq: 1 }, at, build, 1_000)).toBe(miner);
  });

  test("a duplicate demolish neither double-refunds nor errors", () => {
    const build = funded();
    const miner = placeStructure(build, "miner", metalTile, MINER);
    const guard = freshDemolishGuard();
    const at = structureCenter(miner);
    const first = admitDemolish(guard, { id: miner.id, seq: 1 }, at, build, 1_000);
    demolishStructure(build, first as NonNullable<typeof first>);
    const banked = build.bank.metal;
    expect(admitDemolish(guard, { id: miner.id, seq: 2 }, at, build, 2_000)).toBeNull();
    expect(build.bank.metal).toBe(banked);
  });

  test("rejects a stale seq, a too-soon repeat, and an out-of-reach structure", () => {
    const build = funded();
    const a = placeStructure(build, "miner", metalTile, MINER);
    const b = placeStructure(build, "wall", { tx: 500, ty: 500 }, WALL);
    const guard = freshDemolishGuard();
    admitDemolish(guard, { id: a.id, seq: 5 }, structureCenter(a), build, 1_000);
    expect(admitDemolish(guard, { id: a.id, seq: 5 }, structureCenter(a), build, 9_000)).toBeNull();
    expect(
      admitDemolish(
        guard,
        { id: b.id, seq: 6 },
        structureCenter(b),
        build,
        1_000 + DEMOLISH_CADENCE_MS - 1,
      ),
    ).toBeNull();
    const far = { x: structureCenter(a).x + INTERACT_REACH + 1, y: structureCenter(a).y };
    expect(admitDemolish(freshDemolishGuard(), { id: a.id, seq: 1 }, far, build, 1_000)).toBeNull();
  });

  test("a single click cannot destroy anything — demolish is a hold", () => {
    expect(DEMOLISH_HOLD_MS).toBeGreaterThan(MINE_CADENCE_MS);
  });
});

describe("the generator and the energy ceiling", () => {
  const ore = generateOre(ARENA, SEED);
  const GENERATOR = BUILDABLES.generator as BuildableSpec;
  const powerTile = (() => {
    for (const [key, kind] of ore) if (kind === "power") return untileKey(key);
    throw new Error("no power ore");
  })();
  const metalTile = (() => {
    for (const [key, kind] of ore) if (kind === "metal") return untileKey(key);
    throw new Error("no metal ore");
  })();
  const funded = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 10_000;
    return build;
  };

  test("the generator is a 5×5 that only sits on power ore", () => {
    expect(GENERATOR).toEqual({ footprint: 5, cost: 150, hp: 300, requires: "power" });
  });

  test("each standing generator raises the ceiling by exactly its output", () => {
    const build = funded();
    expect(build.power.generation).toBe(0);
    placeStructure(build, "generator", powerTile, GENERATOR);
    stepBuild(build, 50);
    expect(build.power.generation).toBe(GENERATOR_OUTPUT);
    placeStructure(build, "generator", { tx: powerTile.tx + 5, ty: powerTile.ty }, GENERATOR);
    stepBuild(build, 50);
    expect(build.power.generation).toBe(2 * GENERATOR_OUTPUT);
  });

  test("the ceiling drops the same tick a generator is destroyed — no reserve carries over", () => {
    const build = funded();
    const gen = placeStructure(build, "generator", powerTile, GENERATOR);
    stepBuild(build, 50);
    expect(build.power.generation).toBe(GENERATOR_OUTPUT);
    removeStructure(build, gen.id); // destroyed by a wave
    stepBuild(build, 50);
    expect(build.power.generation).toBe(0);
  });

  test("demolishing a generator lowers the ceiling too", () => {
    const build = funded();
    const gen = placeStructure(build, "generator", powerTile, GENERATOR);
    stepBuild(build, 50);
    demolishStructure(build, gen);
    stepBuild(build, 50);
    expect(build.power.generation).toBe(0);
  });

  test("a generator is refused on metal ore and on bare ground", () => {
    const build = funded();
    expect(placementError("generator", metalTile, ore, build, null)).toBe("wrong-ore");
    expect(placementError("generator", { tx: 0, ty: 0 }, ore, build, null)).toBe("wrong-ore");
  });

  test("a 5×5 straddling the edge of a patch is accepted — any one tile is enough", () => {
    const build = funded();
    // Anchor so only the bottom-right tile of the 5×5 lands on the known power tile.
    const straddle = { tx: powerTile.tx - 4, ty: powerTile.ty - 4 };
    expect(placementError("generator", straddle, ore, build, null)).toBeNull();
  });

  test("a 5×5 claims 25 tiles of occupancy", () => {
    const build = funded();
    placeStructure(build, "generator", powerTile, GENERATOR);
    expect(build.occupancy.size).toBe(25);
  });

  test("energy is never stored — consumption stays at zero until something draws", () => {
    const build = funded();
    placeStructure(build, "generator", powerTile, GENERATOR);
    for (let i = 0; i < 100; i++) stepBuild(build, 50);
    expect(build.power.generation).toBe(GENERATOR_OUTPUT); // a rate, not an accumulating bank
    expect(build.power.consumption).toBe(0);
  });

  test("power ore still cannot be hand-mined — there is nowhere to put it", () => {
    expect(admitMine(freshMineGuard(), { tile: powerTile, seq: 1 }, null, ore, 1_000)).toBe(0);
  });
});

describe("M5-I5: the reconnect keyframe carries the engaged turrets' aims", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const funded = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 100_000;
    return build;
  };

  test("a turret with nothing to shoot is omitted — a fresh client mints it un-aimed anyway", () => {
    const build = funded();
    placeStructure(build, "turret", { tx: 100, ty: 100 }, TURRET);
    placeStructure(build, "wall", { tx: 110, ty: 110 }, BUILDABLES.wall as BuildableSpec);
    expect(snapshotAims(build)).toEqual([]);
  });

  test("an engaged turret carries its target and whether it won power", () => {
    const build = funded();
    const turret = placeStructure(build, "turret", { tx: 100, ty: 100 }, TURRET);
    const starved = placeStructure(build, "turret", { tx: 110, ty: 110 }, TURRET);
    Object.assign(turret.turret ?? {}, { targetId: "e7", powered: true });
    Object.assign(starved.turret ?? {}, { targetId: "n2", powered: false });
    expect(snapshotAims(build)).toEqual([
      [turret.id, "e7", 1],
      [starved.id, "n2", 0],
    ]);
  });
});

// #102 stage 2: the squad's ammo pool and the forge queue behind it. Metal is charged the moment a
// bullet is ordered and nothing is ever given back, so every test here checks the bank as well as
// the pool.
describe("#102: bullets are forged from Metal, one at a time", () => {
  const TICK = 50; // the sim's own 20 Hz tick, which is what drives the forge
  const funded = (metal: number): BuildState => {
    const build = freshBuildState(ARENA);
    creditMetal(build, metal);
    return build;
  };
  const runForge = (build: BuildState, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += TICK) stepBuild(build, TICK);
  };

  test("a fresh squad has no bullets and nothing on the forge", () => {
    const build = freshBuildState(ARENA);
    expect(build.ammo).toEqual({ bullets: 0, queued: 0, forgeMs: 0 });
  });

  test("the Metal leaves the bank at enqueue, before any bullet exists", () => {
    const build = funded(12);
    expect(enqueueForge(build)).toBe(true);
    expect(build.bank.metal).toBe(12 - BULLET_COST);
    expect(build.ammo.bullets).toBe(0);
    expect(build.ammo.queued).toBe(1);
  });

  test("ordering at exactly the price succeeds; one Metal short refuses and charges nothing", () => {
    const exact = funded(BULLET_COST);
    expect(enqueueForge(exact)).toBe(true);
    expect(exact.bank.metal).toBe(0);

    const short = funded(BULLET_COST - 1);
    expect(enqueueForge(short)).toBe(false);
    expect(short.bank.metal).toBe(BULLET_COST - 1);
    expect(short.ammo.queued).toBe(0);
  });

  test("a bullet lands after a full forge and not a tick before", () => {
    const build = funded(BULLET_COST);
    enqueueForge(build);
    runForge(build, FORGE_MS - TICK);
    expect(build.ammo.bullets).toBe(0);
    stepBuild(build, TICK);
    expect(build.ammo.bullets).toBe(1);
    expect(build.ammo.queued).toBe(0);
  });

  test("three ordered bullets land a forge apart, not together", () => {
    const build = funded(3 * BULLET_COST);
    for (let i = 0; i < 3; i++) enqueueForge(build);
    expect(build.bank.metal).toBe(0); // all three paid for up front

    runForge(build, FORGE_MS);
    expect(build.ammo.bullets).toBe(1);
    runForge(build, FORGE_MS);
    expect(build.ammo.bullets).toBe(2);
    runForge(build, FORGE_MS);
    expect(build.ammo.bullets).toBe(3);
    expect(build.ammo.queued).toBe(0);
  });

  test("the forge carries its overflow rather than losing it to a long tick", () => {
    const build = funded(2 * BULLET_COST);
    enqueueForge(build);
    enqueueForge(build);
    stepBuild(build, FORGE_MS + FORGE_MS / 2);
    expect(build.ammo.bullets).toBe(1); // and half of the second is already behind it
    stepBuild(build, FORGE_MS / 2);
    expect(build.ammo.bullets).toBe(2);
  });

  // An idle forge has exactly one representation, which is what lets anything reading this state
  // tell "nothing is being made" from "a bullet is nearly done" without a second field.
  test("an emptied forge leaves no clock behind", () => {
    const build = funded(BULLET_COST);
    enqueueForge(build);
    runForge(build, FORGE_MS * 3); // long since finished, and left running
    expect(build.ammo).toEqual({ bullets: 1, queued: 0, forgeMs: 0 });
  });

  test("draining the forge loses what was queued and refunds nothing", () => {
    const build = funded(3 * BULLET_COST);
    for (let i = 0; i < 3; i++) enqueueForge(build);
    drainForge(build.ammo);
    expect(build.ammo.queued).toBe(0);
    expect(build.bank.metal).toBe(0); // the Metal went at enqueue and there is no way back
    runForge(build, FORGE_MS * 3);
    expect(build.ammo.bullets).toBe(0);
  });

  test("a bullet already forged survives the drain — only the queue is thrown away", () => {
    const build = funded(2 * BULLET_COST);
    enqueueForge(build);
    runForge(build, FORGE_MS);
    enqueueForge(build);
    drainForge(build.ammo);
    expect(build.ammo.bullets).toBe(1);
  });

  test("spending takes exactly one bullet, and an empty pool refuses", () => {
    const build = funded(BULLET_COST);
    enqueueForge(build);
    runForge(build, FORGE_MS);
    expect(spendBullet(build.ammo)).toBe(true);
    expect(build.ammo.bullets).toBe(0);
    expect(spendBullet(build.ammo)).toBe(false);
    expect(build.ammo.bullets).toBe(0); // refusing never runs the pool negative
  });
});
