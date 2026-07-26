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
const BOUNDARY_INSET = 0.22;
const JAG_STEPS = 4;
const JAG_DEPTH = 0.5; // of the inset

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

  ctx.save();
  clipToPatch(ctx, size, inset, open, cx, cy);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * size, dy * size);
      paintCell(ctx, mod(cx + dx, CELLS), mod(cy + dy, CELLS), size);
      ctx.restore();
    }
  }
  ctx.restore();
}

// The tile's keep-region, as a path. Each side is either flush (interior) or a jagged pull-back
// (boundary). Corners are taken from whichever of the two meeting sides is more inset, so the path
// closes without a notch.
function clipToPatch(
  ctx: CanvasRenderingContext2D,
  size: number,
  inset: number,
  open: TileVariant["open"],
  cx: number,
  cy: number,
): void {
  const n = open.north ? inset : 0;
  const e = open.east ? inset : 0;
  const s = open.south ? inset : 0;
  const w = open.west ? inset : 0;

  ctx.beginPath();
  ctx.moveTo(w, n);
  side(ctx, w, n, size - e, n, open.north, inset, cx, cy, 0);
  side(ctx, size - e, n, size - e, size - s, open.east, inset, cx, cy, 1);
  side(ctx, size - e, size - s, w, size - s, open.south, inset, cx, cy, 2);
  side(ctx, w, size - s, w, n, open.west, inset, cx, cy, 3);
  ctx.closePath();
  ctx.clip();
}

// One side of the keep-region. Flush sides are a straight line — they are interior, and a straight
// line there is exactly right, because the neighbour's own side meets it. A boundary side steps
// inward and outward along its length so the patch edge is irregular at a finer scale than the
// tile.
function side(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  boundary: boolean,
  inset: number,
  cx: number,
  cy: number,
  salt: number,
): void {
  if (!boundary) {
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
    const depth = (cellNoise(cx, cy, salt * JAG_STEPS + i) - 0.5) * 2 * inset * JAG_DEPTH;
    ctx.lineTo(fromX + dx * t + (inX / length) * depth, fromY + dy * t + (inY / length) * depth);
  }
}
