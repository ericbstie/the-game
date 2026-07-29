// The contract for a sprite drawn once per tile across a field — ore today, anything else tiled
// later. It exists because such a sprite has two requirements that pull in opposite directions
// (#87), and one number cannot satisfy both:
//
//   1. **Inside a patch, ink must cross tile seams.** Otherwise every mark is boxed in its own
//      cell and a white lattice appears on the grid pitch. Measured at 8.08x before this landed:
//      a tile-centre column carried eight times the ink of a column on a tile boundary.
//   2. **At a patch boundary, ink must not reach the edge.** Otherwise the deposit ends in hard
//      axis-aligned steps and the field reads as made of squares.
//
// A sprite is handed `(name, facing, frame)` and nothing else, so it cannot tell an interior edge
// from a boundary one — it must pick one behaviour for all four and be wrong on one of them.
//
// The fix is to put both facts in the variant index: **which cell of the repeating grid this tile
// is** and **which of its four neighbours hold the same thing**. Packed rather than added as a
// third argument to `draw`, so the shape every other sprite module is written against is
// unchanged — only a tiled sprite ever unpacks it.

// How many tiles the variant grid repeats over. A tile's cell is its *position* modulo this, not a
// hash of its position, which is what lets a tile derive its neighbours' cells and draw a mark that
// straddles a seam identically from both sides. A hash cannot: it is measurably uniform but tells a
// tile nothing about who it sits next to.
//
// Twelve is the smallest period past `METAL_PATCH_MAX` (80 tiles, ~11 across), so no patch the
// generator can grow contains the same cell twice.
export const CELLS = 12;

export const NORTH = 1;
export const EAST = 2;
export const SOUTH = 4;
export const WEST = 8;
export const MASKS = 16;

// What a tiled sprite declares as its `facings`.
export const TILED_FACINGS = MASKS * CELLS * CELLS;

// How far ink is held back from an edge with nothing beyond it, as a share of the tile. Enough to
// read as a margin at 15 px; the jag below is what stops that margin being a straight line.
export const BOUNDARY_INSET = 0.22;
const JAG_STEPS = 4;
const JAG_DEPTH = 0.5; // of the inset

// The weight of the rim, in tile units, after the clip has taken the outer half of it (#106). The
// tile is 15 units, so this is a line a seventh of a tile thick — provisional, and the thing to
// change first if a patch reads too heavy or too faint against the grass beside it.
const BORDER_WEIGHT = 1.9;
const BORDER_INK = "#000";

export interface TileVariant {
  cx: number;
  cy: number;
  open: { north: boolean; east: boolean; south: boolean; west: boolean };
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function packTile(mask: number, cx: number, cy: number): number {
  return mask * CELLS * CELLS + mod(cx, CELLS) * CELLS + mod(cy, CELLS);
}

export function unpackTile(variant: number): TileVariant {
  const v = mod(variant, TILED_FACINGS);
  const mask = Math.floor(v / (CELLS * CELLS));
  const cell = v % (CELLS * CELLS);
  return {
    cx: Math.floor(cell / CELLS),
    cy: cell % CELLS,
    // A bit set means the neighbour is there, so the edge is interior. "Open" is the negation:
    // nothing beyond it, and the patch ends here.
    open: {
      north: (mask & NORTH) === 0,
      east: (mask & EAST) === 0,
      south: (mask & SOUTH) === 0,
      west: (mask & WEST) === 0,
    },
  };
}

// A small deterministic value for a cell, so the boundary jag is stable per variant rather than
// shimmering between bakes.
function cellNoise(cx: number, cy: number, salt: number): number {
  const mixed = Math.imul((cx * 73_856_093) ^ (cy * 19_349_663) ^ (salt * 83_492_791), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 4_294_967_296;
}

// Draw one tile of a field. `paintCell` is called nine times — once for this cell and once for
// each of its eight neighbours, translated into place — and everything is clipped to this tile's
// box. That is what makes ink continuous across an interior seam: a mark near a boundary is
// generated identically by both tiles, and each keeps its own half.
//
// The clip is the patch silhouette. On an interior edge it runs flush to the box, so a mark
// crosses. On a boundary edge it pulls back and **jags**, so the deposit ends on an irregular line
// rather than on the tile grid.
export function drawTiled(
  ctx: CanvasRenderingContext2D,
  size: number,
  variant: number,
  paintCell: (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void,
): void {
  const { cx, cy, open } = unpackTile(variant);
  const inset = size * BOUNDARY_INSET;
  const sides = sidesOf(size, inset, open);

  ctx.save();
  clipToPatch(ctx, sides, inset, cx, cy);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * size, dy * size);
      paintCell(ctx, mod(cx + dx, CELLS), mod(cy + dy, CELLS), size);
      ctx.restore();
    }
  }
  strokeBoundary(ctx, sides, inset, cx, cy);
  ctx.restore();
}

interface Side {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  boundary: boolean; // nothing beyond it: the patch ends here
  salt: number;
}

// The four sides of the tile's keep-region, walked clockwise from the north-west corner. Corners are
// taken from whichever of the two meeting sides is more inset, so the walk closes without a notch —
// and so a boundary side that meets an interior one runs all the way to the tile box edge, where the
// tile across that seam picks the same line up from its own edge.
function sidesOf(size: number, inset: number, open: TileVariant["open"]): Side[] {
  const n = open.north ? inset : 0;
  const e = open.east ? inset : 0;
  const s = open.south ? inset : 0;
  const w = open.west ? inset : 0;
  return [
    { fromX: w, fromY: n, toX: size - e, toY: n, boundary: open.north, salt: 0 },
    { fromX: size - e, fromY: n, toX: size - e, toY: size - s, boundary: open.east, salt: 1 },
    { fromX: size - e, fromY: size - s, toX: w, toY: size - s, boundary: open.south, salt: 2 },
    { fromX: w, fromY: size - s, toX: w, toY: n, boundary: open.west, salt: 3 },
  ];
}

// The tile's keep-region, as a path. Each side is either flush (interior) or a jagged pull-back
// (boundary).
function clipToPatch(
  ctx: CanvasRenderingContext2D,
  sides: readonly Side[],
  inset: number,
  cx: number,
  cy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(sides[0].fromX, sides[0].fromY);
  for (const side of sides) walk(ctx, side, inset, cx, cy);
  ctx.closePath();
  ctx.clip();
}

// The rim of the deposit: the same jagged line the ink stops on, laid down again as weight (#106).
//
// **Only the boundary sides.** A tile with ore on every side draws nothing here — a border on an
// interior side would box the tile and put back the grid #87's neighbour occupancy exists to
// remove, so a filled 3×3 patch carries one outline rather than nine.
//
// Stroked with the keep-region still clipped, at twice the weight it is meant to read at: the outer
// half is cut away, which lands the rim's outside edge exactly on the line the ink already ends on
// and leaves the boundary as ragged as it was. Round caps close the corner where two boundary sides
// meet, and the overshoot past a corner falls outside the clip.
function strokeBoundary(
  ctx: CanvasRenderingContext2D,
  sides: readonly Side[],
  inset: number,
  cx: number,
  cy: number,
): void {
  const rim = sides.filter((side) => side.boundary);
  if (rim.length === 0) return;
  ctx.beginPath();
  for (const side of rim) {
    ctx.moveTo(side.fromX, side.fromY);
    walk(ctx, side, inset, cx, cy);
  }
  ctx.strokeStyle = BORDER_INK;
  ctx.lineWidth = BORDER_WEIGHT * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

// One side of the keep-region. Flush sides are a straight line — they are interior, and a straight
// line there is exactly right, because the neighbour's own side meets it. A boundary side steps
// inward and outward along its length so the patch edge is irregular at a finer scale than the
// tile.
//
// **The far corner is never displaced.** It is where the next side starts, and — when the side runs
// to the tile box edge — where the tile across that seam starts its own. A jittered corner steps the
// rim at every seam, which is the grid again, one scale up.
function walk(
  ctx: CanvasRenderingContext2D,
  side: Side,
  inset: number,
  cx: number,
  cy: number,
): void {
  const { fromX, fromY, toX, toY } = side;
  if (!side.boundary) {
    ctx.lineTo(toX, toY);
    return;
  }
  // Inward is the perpendicular pointing into the tile, which for a clockwise walk is the
  // direction the side would move to shrink the region.
  const dx = toX - fromX;
  const dy = toY - fromY;
  const inX = -dy;
  const inY = dx;
  const length = Math.hypot(dx, dy) || 1;
  for (let i = 1; i <= JAG_STEPS; i++) {
    const t = i / JAG_STEPS;
    const depth =
      i === JAG_STEPS
        ? 0
        : (cellNoise(cx, cy, side.salt * JAG_STEPS + i) - 0.5) * 2 * inset * JAG_DEPTH;
    ctx.lineTo(fromX + dx * t + (inX / length) * depth, fromY + dy * t + (inY / length) * depth);
  }
}
