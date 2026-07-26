import { describe, expect, test } from "bun:test";
import { CELLS, EAST, NORTH, packTile, SOUTH, TILED_FACINGS, unpackTile, WEST } from "./tiled";

describe("the tiled variant packs a cell and a neighbour mask into one index", () => {
  test("round-trips every combination", () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let cx = 0; cx < CELLS; cx++) {
        for (let cy = 0; cy < CELLS; cy++) {
          const { cx: gotX, cy: gotY, open } = unpackTile(packTile(mask, cx, cy));
          expect({ cx: gotX, cy: gotY }).toEqual({ cx, cy });
          expect(open.north).toBe((mask & NORTH) === 0);
          expect(open.east).toBe((mask & EAST) === 0);
          expect(open.south).toBe((mask & SOUTH) === 0);
          expect(open.west).toBe((mask & WEST) === 0);
        }
      }
    }
  });

  test("every combination is a distinct index, so nothing collides in the cache", () => {
    const seen = new Set<number>();
    for (let mask = 0; mask < 16; mask++)
      for (let cx = 0; cx < CELLS; cx++)
        for (let cy = 0; cy < CELLS; cy++) seen.add(packTile(mask, cx, cy));
    expect(seen.size).toBe(TILED_FACINGS);
  });

  test("the index stays inside what a sprite declares", () => {
    for (let mask = 0; mask < 16; mask++) {
      expect(packTile(mask, CELLS - 1, CELLS - 1)).toBeLessThan(TILED_FACINGS);
    }
  });

  // `drawOre` walks raw tile coordinates, which run to 2,080 and are negative just off the arena.
  test("takes a raw tile coordinate, not a pre-reduced one", () => {
    expect(packTile(0, 74, 73)).toBe(packTile(0, 74 % CELLS, 73 % CELLS));
    expect(unpackTile(packTile(0, -1, -1))).toMatchObject({ cx: CELLS - 1, cy: CELLS - 1 });
  });

  // The cache wraps a facing it is handed, so an index past the end must land somewhere sane
  // rather than reading off the sheet.
  test("wraps an out-of-range variant", () => {
    expect(unpackTile(TILED_FACINGS + 5)).toEqual(unpackTile(5));
  });

  // A set bit means the neighbour is present, so that edge is *interior*. Getting this backwards
  // would hold ink back exactly where it needs to cross and vice versa.
  test("a full mask is a buried tile with no open edge; an empty one is a lone tile", () => {
    const buried = unpackTile(packTile(15, 3, 4)).open;
    expect([buried.north, buried.east, buried.south, buried.west]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const lone = unpackTile(packTile(0, 3, 4)).open;
    expect([lone.north, lone.east, lone.south, lone.west]).toEqual([true, true, true, true]);
  });
});
