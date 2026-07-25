import { describe, expect, test } from "bun:test";
import type { Tile } from "../lobby/protocol";
import {
  admitBuild,
  admitMine,
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  type BuildableSpec,
  footprintCenter,
  footprintTiles,
  freshBuildGuard,
  freshBuildState,
  freshMineGuard,
  generateOre,
  HAND_MINE_RATE,
  INTERACT_REACH,
  MINE_CADENCE_MS,
  MINE_WINDOW_MAX_MS,
  MINER_TRICKLE,
  oreAt,
  placementError,
  placeStructure,
  removeStructure,
  stepBuild,
  TILE,
  tileKey,
  tileOf,
  tileOrigin,
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

  test("an unshipped buildable never places, so its bar slot is inert", () => {
    expect(placementError("wall", bare, ore, rich(10_000), near(bare))).toBe("unknown-buildable");
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
