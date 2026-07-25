import { describe, expect, test } from "bun:test";
import type { Tile } from "../lobby/protocol";
import {
  admitMine,
  freshMineGuard,
  generateOre,
  HAND_MINE_RATE,
  MINE_CADENCE_MS,
  MINE_REACH,
  MINE_WINDOW_MAX_MS,
  oreAt,
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
    const far = { x: tileOrigin(metal).x + MINE_REACH + 100, y: tileOrigin(metal).y };
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
