import { describe, expect, test } from "bun:test";
import type { Tile } from "../lobby/protocol";
import {
  admitBuild,
  admitDemolish,
  admitMine,
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  type BuildableSpec,
  DEMOLISH_CADENCE_MS,
  DEMOLISH_HOLD_MS,
  demolishStructure,
  footprintCenter,
  footprintTiles,
  freshBuildGuard,
  freshBuildState,
  freshDemolishGuard,
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
  pushOutOfSolids,
  removeStructure,
  resolveHarvest,
  slidePos,
  solidAt,
  stepBuild,
  structureBlocking,
  structureCenter,
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
    expect(placementError("turret", bare, ore, rich(10_000), near(bare))).toBe("unknown-buildable");
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
