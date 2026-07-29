import { describe, expect, test } from "bun:test";
import {
  BOUNDARY_INSET,
  CELLS,
  drawTiled,
  EAST,
  NORTH,
  packTile,
  SOUTH,
  TILED_FACINGS,
  unpackTile,
  WEST,
} from "./tiled";

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

// happy-dom returns null from `getContext('2d')`, so the border is exercised against a recorder.
// That is not a compromise here: what the border rule is about is *which* points get stroked and
// under what state, and that is exactly what a recorder can see. Whether the result reads as ink is
// the reviewer's (ADR 0002).
interface Op {
  fn: string;
  args: number[];
}
function spyCtx() {
  const ops: Op[] = [];
  const record =
    (fn: string) =>
    (...args: number[]) => {
      ops.push({ fn, args });
    };
  const ctx = {
    ops,
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    clip: record("clip"),
    stroke: record("stroke"),
    fill: record("fill"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { ops: Op[] };
}

type Point = [number, number];

// The polylines a path was *stroked* from, in the order they were laid down. A path that ends in
// `clip` is the tile's keep-region and is dropped: only what was stroked is the border.
function strokedPolylines(ops: Op[]): Point[][] {
  const drawn: Point[][] = [];
  let path: Point[][] = [];
  for (const op of ops) {
    if (op.fn === "beginPath") path = [];
    else if (op.fn === "moveTo") path.push([[op.args[0], op.args[1]]]);
    else if (op.fn === "lineTo" && path.length)
      path[path.length - 1].push([op.args[0], op.args[1]]);
    else if (op.fn === "clip") path = [];
    else if (op.fn === "stroke") {
      drawn.push(...path);
      path = [];
    }
  }
  return drawn;
}

const SIZE = 15; // TILE, the box both ore tiles draw in
const nothing = () => {};

// The border a tile draws, in the coordinates of a patch laid out on the tile grid. The tile's cell
// and where it is laid out are the same thing in the game (`drawOre` packs a tile's own coordinate),
// so they default to each other; a test that only wants the shape passes 0,0 as the placement.
function borderOf(mask: number, tx: number, ty: number, ox = tx, oy = ty): Point[][] {
  const ctx = spyCtx();
  drawTiled(ctx, SIZE, packTile(mask, tx, ty), nothing);
  return strokedPolylines(ctx.ops).map((line) =>
    line.map(([x, y]): Point => [x + ox * SIZE, y + oy * SIZE]),
  );
}

const key = ([x, y]: Point) => `${x.toFixed(6)},${y.toFixed(6)}`;

// #106 asks for a thick border around an ore *patch*. #87 asks for a patch that is seamless inside
// and ragged at its edge, and a border drawn per tile would box every interior tile and turn that
// seam back into a grid. These are the same requirement seen twice: the border belongs to the four
// bits of neighbour occupancy the variant already carries, and to nothing else.
describe("the border a tiled sprite draws", () => {
  test("a tile with every neighbour present draws none at all", () => {
    const ctx = spyCtx();
    drawTiled(ctx, SIZE, packTile(NORTH | EAST | SOUTH | WEST, 3, 4), nothing);
    expect(ctx.ops.filter((op) => op.fn === "stroke")).toEqual([]);
  });

  test("a lone tile with no neighbours is bordered on all four sides", () => {
    expect(borderOf(0, 0, 0)).toHaveLength(4);
  });

  // Where the side's neighbour is present the border runs to the tile box edge, because the tile
  // across that seam continues the same line from its own edge. Anywhere else it would step.
  test("a boundary side runs corner to corner along the inset, so the next tile continues it", () => {
    const inset = SIZE * BOUNDARY_INSET;
    const [north] = borderOf(EAST | SOUTH | WEST, 0, 0);
    expect(north[0]).toEqual([0, inset]);
    expect(north[north.length - 1]).toEqual([SIZE, inset]);

    const [east] = borderOf(NORTH | SOUTH | WEST, 0, 0);
    expect(east[0]).toEqual([SIZE - inset, 0]);
    expect(east[east.length - 1]).toEqual([SIZE - inset, SIZE]);
  });

  test("wanders off the inset between those corners, so the edge is ragged at a finer scale", () => {
    const inset = SIZE * BOUNDARY_INSET;
    // Cell 5,6 rather than 0,0: the jag is deterministic per cell, and a cell whose noise happens to
    // sit near zero would pass this without a jag existing. Its own tile, so the comparison is in
    // the same coordinates the border came back in.
    const [north] = borderOf(EAST | SOUTH | WEST, 5, 6, 0, 0);
    expect(north.slice(1, -1).some(([, y]) => Math.abs(y - inset) > 0.1)).toBe(true);
  });

  // The verify box, literally: a filled 3×3 patch has one outline, not nine. Twelve sides — two
  // from each corner tile, one from each edge tile, none from the middle — chained end to end into
  // a single closed loop.
  test("a filled 3×3 patch draws one outline and not nine", () => {
    const held = (tx: number, ty: number) => tx >= 0 && tx < 3 && ty >= 0 && ty < 3;
    const lines: Point[][] = [];
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const mask =
          (held(tx, ty - 1) ? NORTH : 0) +
          (held(tx + 1, ty) ? EAST : 0) +
          (held(tx, ty + 1) ? SOUTH : 0) +
          (held(tx - 1, ty) ? WEST : 0);
        const border = borderOf(mask, tx, ty);
        if (tx === 1 && ty === 1) expect(border).toEqual([]);
        lines.push(...border);
      }
    }
    expect(lines).toHaveLength(12);

    // Every end meets exactly one other end, and following them visits all twelve — which is one
    // closed loop. Nine boxed tiles would be nine loops of four, and a border that stepped at a
    // seam would leave ends unmatched.
    const ends = new Map<string, number[]>();
    lines.forEach((line, i) => {
      for (const end of [line[0], line[line.length - 1]]) {
        ends.set(key(end), [...(ends.get(key(end)) ?? []), i]);
      }
    });
    expect([...ends.values()].every((meeting) => meeting.length === 2)).toBe(true);

    const seen = new Set<number>([0]);
    const frontier = [0];
    while (frontier.length) {
      const line = lines[frontier.pop() as number];
      for (const end of [line[0], line[line.length - 1]]) {
        for (const next of ends.get(key(end)) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            frontier.push(next);
          }
        }
      }
    }
    expect(seen.size).toBe(12);
  });

  // The border is the rim of the deposit rather than a line beside it: stroked under the tile's own
  // keep-region, so the outer half of the weight is cut away and no ink can reach past where the
  // patch ends. Drawn after the restore it would cross the boundary the clip exists to hold.
  test("is stroked inside the tile's keep-region", () => {
    const ctx = spyCtx();
    drawTiled(ctx, SIZE, packTile(0, 3, 4), nothing);
    const fns = ctx.ops.map((op) => op.fn);
    expect(fns.indexOf("stroke")).toBeGreaterThan(fns.indexOf("clip"));
    expect(fns.lastIndexOf("restore")).toBeGreaterThan(fns.indexOf("stroke"));
  });
});
