import { describe, expect, test } from "bun:test";
import wall, { packWall, WALL_FACINGS, WALL_TILES, wallAt, wallBit } from "./wall";

// The wall is the one sprite with a geometric contract worth pinning in `bun test`. Everything it
// draws is an axis-aligned fill on integer edges — the review measured zero anti-aliasing at dpr 1
// and dpr 2 — so replaying its fills into a grid reproduces a bake exactly, and "is this corner
// white?" is a question with an answer here rather than only in a screenshot.
//
// Looking is still the review (ADR 0002). What this covers is the two defects #90 measured, which
// are *absences*: a corner no face reaches, and a face withheld from a side only half covered.
// Neither shows up in a call log, and both are invisible on a single tile.

const INK = "#000";
const SIZE = wall.size;

// Every fill the sprite makes, replayed into a `size × size` grid. Ink is 1, paper 0.
function raster(facing: number): (x: number, y: number) => boolean {
  const pixels = new Uint8Array(SIZE * SIZE);
  let style = INK;
  const ctx = {
    get fillStyle(): string {
      return style;
    },
    set fillStyle(value: string) {
      style = value;
    },
    fillRect(x: number, y: number, width: number, height: number): void {
      const value = style === INK ? 1 : 0;
      for (let py = Math.max(0, y); py < Math.min(SIZE, y + height); py++) {
        for (let px = Math.max(0, x); px < Math.min(SIZE, x + width); px++) {
          pixels[py * SIZE + px] = value;
        }
      }
    },
  };
  wall.draw(ctx as unknown as CanvasRenderingContext2D, SIZE, facing, 0);
  return (x, y) => pixels[y * SIZE + x] === 1;
}

const mask = (...tiles: readonly (readonly [number, number])[]) =>
  tiles.reduce((m, [dx, dy]) => m | (1 << wallBit(dx, dy)), 0);

const inkIn = (
  ink: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  let count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink(x, y)) count++;
  return count;
};

describe("the wall's neighbourhood mask", () => {
  test("carries the twelve tiles around the footprint and nothing else", () => {
    const every = WALL_FACINGS - 1;
    for (let dy = -1; dy <= WALL_TILES; dy++) {
      for (let dx = -1; dx <= WALL_TILES; dx++) {
        const own = dx >= 0 && dx < WALL_TILES && dy >= 0 && dy < WALL_TILES;
        expect(wallBit(dx, dy) >= 0).toBe(!own);
        expect(wallAt(every, dx, dy)).toBe(true);
        expect(wallAt(0, dx, dy)).toBe(own); // the footprint is wall whatever the mask says
      }
    }
  });

  test("round-trips every tile it packs, one bit each", () => {
    for (let dy = -1; dy <= WALL_TILES; dy++) {
      for (let dx = -1; dx <= WALL_TILES; dx++) {
        if (wallBit(dx, dy) < 0) continue;
        const one = packWall((x, y) => x === dx && y === dy);
        expect(one).toBeLessThan(WALL_FACINGS);
        expect(wallAt(one, dx, dy)).toBe(true);
        expect(packWall(() => false)).toBe(0);
        expect(packWall(() => true)).toBe(WALL_FACINGS - 1);
      }
    }
  });
});

describe("the wall sprite", () => {
  test("outlines every edge of a wall standing on its own", () => {
    const ink = raster(0);
    for (let i = 0; i < SIZE; i++) {
      expect(ink(i, 0)).toBe(true);
      expect(ink(i, SIZE - 1)).toBe(true);
      expect(ink(0, i)).toBe(true);
      expect(ink(SIZE - 1, i)).toBe(true);
    }
  });

  test("puts no mark on any edge of a wall buried in a mass", () => {
    const ink = raster(WALL_FACINGS - 1);
    // Not "no ink at all": the top surface's own slab joints run right across the box, which is
    // what makes two tops merge. What must not be there is a contour along a shared edge.
    expect(inkIn(ink, 0, 0, SIZE, 1)).toBeLessThan(SIZE);
    expect(ink(0, 0)).toBe(false);
    expect(ink(SIZE - 1, SIZE - 1)).toBe(false);
  });

  // #90 §1 — measured on a ring: the west flank's black stopped short of the north run's south
  // face and left a 5×8 white bite at the inner corner. Every enclosure has four of them.
  test("closes the inner corner where two neighbours meet with an open angle", () => {
    const corner = mask([2, 0], [2, 1], [0, 2], [1, 2]); // neighbours east and south, nothing between
    expect(inkIn(raster(corner), 25, 22, 30, 30)).toBe(40); // the whole 5×8, solid
  });

  test("leaves that corner as top surface when the angle is filled", () => {
    const solid = mask([2, 0], [2, 1], [0, 2], [1, 2], [2, 2]); // a 2×2 block of walls
    const ink = raster(solid);
    expect(inkIn(ink, 25, 22, 30, 30)).toBeLessThan(40);
    expect(ink(29, 22)).toBe(false);
    expect(ink(25, 29)).toBe(false);
  });

  test("closes an inner corner on each of the four diagonals", () => {
    for (const [dx, dy] of [
      [-1, -1],
      [2, -1],
      [-1, 2],
      [2, 2],
    ] as const) {
      // Both tiles flanking the diagonal are wall and the diagonal itself is not: a concave corner
      // in the mass, wherever it falls on the box.
      const facing = mask([dx, dy < 0 ? 0 : WALL_TILES - 1], [dx < 0 ? 0 : WALL_TILES - 1, dy]);
      const x = dx < 0 ? 0 : SIZE - 1;
      const y = dy < 0 ? 0 : SIZE - 1;
      expect(raster(facing)(x, y)).toBe(true);
    }
  });

  // #90 §2 — measured on two walls one tile out of step: 15 CSS px of a genuinely exposed side
  // drew nothing at all, because a per-side bit had resolved the half-overlap to "covered".
  test("keeps a contour on the exposed half of a side a neighbour covers half of", () => {
    const half = mask([2, 1], [2, 2]); // a neighbour along the south tile of the east side only
    const ink = raster(half);
    for (let y = 0; y < SIZE / WALL_TILES; y++) expect(ink(SIZE - 1, y)).toBe(true);
    // And still nothing along the half that really is interior — bar the corner where the two
    // masses turn, which is an inner corner like any other.
    for (let y = 18; y < 22; y++) expect(ink(SIZE - 1, y)).toBe(false);
  });

  test("withholds the whole face from a side covered on both tiles", () => {
    const ink = raster(mask([2, 0], [2, 1]));
    // Clear of the near and far bands, and of the top's own bed joints at 12 and 27 — which do run
    // out to the edge, because a joint is what has to cross a seam for two tops to merge.
    for (const y of [5, 20]) expect(ink(SIZE - 1, y)).toBe(false);
    for (const y of [5, 20]) expect(raster(0)(SIZE - 1, y)).toBe(true);
  });
});
