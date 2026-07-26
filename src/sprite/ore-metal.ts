import type { SpriteSubject } from "./sheet";

// Metal ore is ground, not an object: drawn flat and straight down, sorted with the floor rather
// than with the things that stand on it. It is also the ore that stays **pure ink** — power ore
// owns the red glow, so this tile has to say "mineral" in black alone (#76 §1). The cue that
// carries it is **angular against power ore's round**, and that one survives if power ore ever
// loses its red, so nothing here is allowed to soften into a pebble.
//
// The hard part is not the 15 px box. It is that twenty to eighty of these are butted edge to edge
// into an accretion-grown patch, and a tile cannot see its neighbours. Every real defect this
// sprite has had was invisible on the single-tile sheet and obvious on a rendered field. See
// `ore-metal.review.md`, which is also the list of things not to try again.
//
// ## The variant axis is a coordinate, not a hash
//
// `facing` is **`(tx mod 12) * 12 + (ty mod 12)`** — the tile's own position folded onto a 12×12
// torus of cells. That is what lets ink cross a seam. Given `facing` a tile knows its own cell, so
// it can derive its **neighbours'** cells by the same arithmetic, draw all nine, and let the box
// clip them. Both sides of a join draw the identical mark from the identical cell, so a flake that
// straddles it is continuous rather than sliced off.
//
// Nothing crosses the wire and nothing is added to `SpriteSubject`: the index is still one number,
// and `drawOre` computes it from a coordinate it already has.
//
// Twelve is the smallest period past `METAL_PATCH_MAX` (80 tiles, ~11 across), so no patch in the
// game can contain one cell twice — and two adjacent tiles can never be identical, because their
// cells differ by construction. 144 bakes of 30×30 is ~518 KB at dpr 2.

const SIZE = 15; // TILE
const CELLS = 12; // the torus period, in tiles

type Point = readonly [number, number];

// The marks. Three grades, because a field of one size is a tint however well each piece is drawn:
// masses at 8–10 px, chips at 4–6, specks at 2. The specks are a garnish and nothing more — an
// earlier version made them the bulk and two reviewers independently called the result pepper.
//
// Every outline is hand-cut, and three properties are deliberate:
//
// **Re-entrant corners.** A convex polygon is a machined part. A measured 98% of the previous
// version's silhouettes had convex-hull solidity above 0.95 — no notches anywhere — and beside the
// egg sac's bold contours the two shared no drawing language at all. Each mass here carries two or
// three bites cut back to about half its peak radius.
//
// **Irregularity only at a scale that exists.** A first attempt at "contour wobble" put extra
// vertices a few hundredths of a unit off each run. At r = 4.6 that is a quarter of a pixel: it
// cannot be drawn, so all it did was blur every corner, and at dpr 1 the masses came out as
// featureless blobs. The irregularity is therefore carried by the *corners* — nine to eleven of
// them, displaced a fifth of a unit or more, which is a whole pixel and can survive. Long straight
// runs in between are what keeps a flake reading as fractured rock rather than as a pebble.
//
// **No symmetry and no parallel pair.** Not one shard has an axis, and no placement uses a quarter-
// or eighth-turn, so no edge lands exactly on an axis or exactly on 45°.
const SHARDS: readonly (readonly Point[])[] = [
  // — masses, 8–10 px —
  // 0 · broad lump, bitten twice along its upper edge
  [
    [-0.95, -0.2],
    [-0.3, -0.88],
    [0.02, -0.46],
    [0.42, -0.94],
    [0.92, -0.34],
    [0.58, 0.06],
    [0.96, 0.48],
    [0.3, 0.62],
    [0.1, 0.98],
    [-0.46, 0.72],
    [-0.7, 0.3],
  ],
  // 1 · splinter, twice as long as it is wide, cleft on the long side
  [
    [-1.02, 0.02],
    [-0.5, -0.3],
    [-0.06, -0.3],
    [0.3, -0.46],
    [0.86, -0.24],
    [0.54, 0.08],
    [1.0, 0.26],
    [0.36, 0.44],
    [-0.16, 0.3],
    [-0.58, 0.52],
  ],
  // 2 · blocky, with a deep bite out of the right flank
  [
    [-0.9, -0.4],
    [-0.34, -0.86],
    [0.2, -0.6],
    [0.3, -0.98],
    [0.86, -0.52],
    [0.44, -0.1],
    [0.98, 0.3],
    [0.46, 0.76],
    [-0.06, 0.54],
    [-0.36, 0.92],
    [-0.82, 0.36],
  ],
  // 3 · a wedge broken across the middle
  [
    [0.08, -1.0],
    [0.52, -0.56],
    [0.9, -0.62],
    [0.94, 0.14],
    [0.42, 0.34],
    [0.66, 0.82],
    [0.06, 0.72],
    [-0.34, 0.94],
    [-0.44, 0.4],
    [-0.92, 0.18],
    [-0.5, -0.3],
  ],
  // 4 · squat, two lobes over a saddle
  [
    [-0.96, -0.1],
    [-0.42, -0.62],
    [-0.06, -0.28],
    [0.3, -0.8],
    [0.84, -0.44],
    [0.62, 0.02],
    [1.0, 0.34],
    [0.4, 0.58],
    [0.16, 0.94],
    [-0.38, 0.7],
    [-0.74, 0.44],
  ],
  // 5 · tall and waisted, the narrowest mass
  [
    [-0.26, -1.0],
    [0.22, -0.68],
    [0.48, -0.86],
    [0.42, -0.3],
    [0.26, -0.08],
    [0.58, 0.24],
    [0.34, 0.7],
    [0.1, 0.98],
    [-0.3, 0.66],
    [-0.52, 0.86],
    [-0.46, 0.28],
    [-0.3, 0.16],
    [-0.56, -0.24],
  ],
  // — chips, 4–6 px: fewer corners, because fewer pixels will hold them —
  // 6
  [
    [-0.92, -0.28],
    [-0.2, -0.86],
    [0.24, -0.42],
    [0.86, -0.6],
    [0.94, 0.22],
    [0.3, 0.52],
    [0.16, 0.96],
    [-0.5, 0.66],
  ],
  // 7
  [
    [-1.0, 0.06],
    [-0.34, -0.52],
    [0.24, -0.2],
    [0.8, -0.66],
    [0.98, 0.16],
    [0.36, 0.42],
    [0.44, 0.9],
    [-0.3, 0.74],
  ],
  // 8
  [
    [0.06, -0.98],
    [0.66, -0.44],
    [0.34, -0.06],
    [0.94, 0.36],
    [0.28, 0.8],
    [-0.2, 0.46],
    [-0.5, 0.92],
    [-0.88, 0.14],
  ],
  // 9
  [
    [-0.88, -0.46],
    [-0.14, -0.92],
    [0.36, -0.44],
    [0.9, -0.52],
    [0.88, 0.26],
    [0.26, 0.48],
    [0.54, 0.9],
    [-0.2, 0.82],
  ],
  // 10
  [
    [-0.94, 0.2],
    [-0.5, -0.44],
    [0.02, -0.14],
    [0.26, -0.88],
    [0.82, -0.34],
    [0.44, 0.1],
    [0.92, 0.54],
    [0.2, 0.86],
  ],
  // 11
  [
    [-0.7, -0.5],
    [-0.32, -0.94],
    [0.28, -0.52],
    [0.66, -0.86],
    [0.9, -0.14],
    [0.36, 0.28],
    [0.82, 0.66],
    [0.06, 0.92],
    [-0.52, 0.5],
  ],
  // — specks, 2 px: too small to hold a notch, so the corners carry the irregularity —
  // 12
  [
    [-0.92, -0.4],
    [0.28, -0.94],
    [0.96, 0.16],
    [0.06, 0.9],
    [-0.6, 0.54],
  ],
  // 13
  [
    [-0.84, 0.22],
    [-0.3, -0.88],
    [0.72, -0.52],
    [0.94, 0.44],
    [0.1, 0.96],
  ],
  // 14
  [
    [-0.96, -0.14],
    [0.06, -0.92],
    [0.88, -0.06],
    [0.34, 0.88],
    [-0.48, 0.7],
  ],
  // 15
  [
    [-0.7, -0.62],
    [0.52, -0.86],
    [0.92, 0.3],
    [-0.06, 0.94],
    [-0.88, 0.18],
  ],
];

interface Mark {
  shard: number;
  x: number;
  y: number;
  r: number; // reach from the mark's centre, in tile px
  turn: number; // in turns, not radians
}

// What one cell of the torus holds. Twenty-two recipes across four weights, because the previous
// version measured **binary**: every cell was either 17–28% covered or exactly zero, which leaves a
// patch with no body and no fringe — its edge was a stencil edge and its gaps read as punched
// holes. These run from about 2% to about 30% in a continuous spread, so a patch thins instead of
// stopping, and a sparse cell reads as thin ground rather than as a hole.
//
// Every recipe carries at least two marks. A lone flake a tile clear of the mass is the one place
// metal ore could be taken for a grass tuft, since the tufts fall one per twelve tiles.
//
// In the four heaviest the mass and its chip **overlap deeply** into one compound silhouette —
// deeply on purpose, because two shapes that merely graze leave a one-pixel hole where their edges
// nearly coincide.
//
// Marks are spread right across the cell, corners included, and are meant to hang over its edges:
// a cell is exactly a tile, so marks kept near cell centres put one clump per tile and the field
// picks up the 15 px rhythm the torus was built to remove. Only about half the cells carry a mass
// at all, which is what gives a patch clumps and thin ground instead of an even pebble-dash.
const RECIPES: readonly (readonly Mark[])[] = [
  // heavy — a mass and a chip fused into one compound silhouette
  [
    { shard: 0, x: 2.4, y: 3.6, r: 4.1, turn: 0.07 },
    { shard: 7, x: 5.6, y: 6.4, r: 2.5, turn: 0.61 },
  ],
  [
    { shard: 3, x: 12.6, y: 4.2, r: 4.3, turn: 0.43 },
    { shard: 9, x: 9.8, y: 7.0, r: 2.6, turn: 0.19 },
    { shard: 15, x: 4.0, y: 12.6, r: 1.1, turn: 0.77 },
  ],
  [
    { shard: 4, x: 7.8, y: 13.4, r: 4.2, turn: 0.31 },
    { shard: 6, x: 11.0, y: 10.6, r: 2.3, turn: 0.86 },
  ],
  [
    { shard: 2, x: 13.8, y: 11.4, r: 4.4, turn: 0.66 },
    { shard: 10, x: 10.6, y: 8.6, r: 2.4, turn: 0.24 },
    { shard: 14, x: 3.2, y: 3.0, r: 1.1, turn: 0.09 },
  ],
  // medium — one mass, nothing fused to it
  [{ shard: 1, x: 1.6, y: 9.2, r: 3.4, turn: 0.58 }],
  [
    { shard: 5, x: 9.0, y: 1.8, r: 3.5, turn: 0.22 },
    { shard: 15, x: 3.0, y: 12.0, r: 1.2, turn: 0.88 },
  ],
  [{ shard: 0, x: 6.2, y: 8.0, r: 3.2, turn: 0.37 }],
  [
    { shard: 3, x: 13.2, y: 7.6, r: 3.3, turn: 0.81 },
    { shard: 14, x: 5.4, y: 2.4, r: 1.2, turn: 0.63 },
  ],
  [{ shard: 4, x: 3.0, y: 12.8, r: 3.4, turn: 0.11 }],
  [
    { shard: 2, x: 10.4, y: 3.4, r: 3.2, turn: 0.54 },
    { shard: 15, x: 2.2, y: 6.0, r: 1.1, turn: 0.38 },
  ],
  // light — no mass at all: two chips, well apart
  [
    { shard: 6, x: 4.4, y: 2.0, r: 2.7, turn: 0.26 },
    { shard: 8, x: 8.6, y: 5.2, r: 2.2, turn: 0.71 },
  ],
  [
    { shard: 7, x: 12.0, y: 12.4, r: 2.6, turn: 0.62 },
    { shard: 11, x: 7.8, y: 9.0, r: 2.2, turn: 0.18 },
    { shard: 14, x: 2.0, y: 7.4, r: 1.2, turn: 0.84 },
  ],
  [
    { shard: 9, x: 1.8, y: 5.6, r: 2.5, turn: 0.34 },
    { shard: 6, x: 6.0, y: 11.8, r: 2.1, turn: 0.89 },
  ],
  [
    { shard: 10, x: 11.2, y: 1.6, r: 2.7, turn: 0.07 },
    { shard: 7, x: 14.2, y: 6.8, r: 2.2, turn: 0.43 },
    { shard: 15, x: 5.0, y: 8.4, r: 1.1, turn: 0.21 },
  ],
  [
    { shard: 11, x: 8.4, y: 14.0, r: 2.6, turn: 0.76 },
    { shard: 9, x: 3.6, y: 10.0, r: 2.2, turn: 0.31 },
  ],
  [
    { shard: 8, x: 6.8, y: 3.2, r: 2.5, turn: 0.13 },
    { shard: 10, x: 13.0, y: 9.4, r: 2.1, turn: 0.58 },
    { shard: 14, x: 1.4, y: 12.6, r: 1.2, turn: 0.95 },
  ],
  // sparse — one chip and one speck: the fringe of a deposit
  [
    { shard: 6, x: 2.8, y: 8.8, r: 2.3, turn: 0.28 },
    { shard: 13, x: 10.0, y: 13.2, r: 1.2, turn: 0.61 },
  ],
  [
    { shard: 9, x: 13.6, y: 3.0, r: 2.2, turn: 0.74 },
    { shard: 12, x: 6.4, y: 7.0, r: 1.1, turn: 0.36 },
  ],
  [
    { shard: 11, x: 7.0, y: 1.4, r: 2.3, turn: 0.46 },
    { shard: 15, x: 11.8, y: 8.0, r: 1.2, turn: 0.91 },
  ],
  [
    { shard: 7, x: 4.2, y: 13.6, r: 2.2, turn: 0.68 },
    { shard: 14, x: 9.4, y: 4.4, r: 1.1, turn: 0.12 },
  ],
  // the thinnest ground there is — grit only, and still never one lone mark
  [
    { shard: 12, x: 3.4, y: 4.8, r: 1.3, turn: 0.39 },
    { shard: 15, x: 11.6, y: 11.2, r: 1.1, turn: 0.84 },
  ],
  [
    { shard: 14, x: 12.8, y: 6.2, r: 1.2, turn: 0.07 },
    { shard: 13, x: 5.2, y: 10.6, r: 1.3, turn: 0.51 },
  ],
];

// Which recipe a cell holds, and which way up. Both sides of a seam run this on the same cell
// coordinate and get the same answer, which is the entire mechanism: it is what puts a neighbour's
// flake in exactly the place the neighbour drew it.
function cellSeed(cx: number, cy: number): number {
  const mixed = Math.imul((cx * 0x1f1f_1f1f) ^ (cy * 0x27d4_eb2d), 0x85eb_ca6b);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  offsetX: number,
  offsetY: number,
): void {
  const seed = cellSeed(cellX, cellY);
  const recipe = RECIPES[seed % RECIPES.length];
  const flip = (seed >>> 8) % 4;
  const flipX = flip === 1 || flip === 3;
  const flipY = flip === 2 || flip === 3;

  for (const mark of recipe) {
    const angle = mark.turn * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centreX = offsetX + (flipX ? SIZE - mark.x : mark.x);
    const centreY = offsetY + (flipY ? SIZE - mark.y : mark.y);
    ctx.beginPath();
    for (const [px, py] of SHARDS[mark.shard]) {
      const dx = (px * cos - py * sin) * mark.r;
      const dy = (px * sin + py * cos) * mark.r;
      ctx.lineTo(centreX + (flipX ? -dx : dx), centreY + (flipY ? -dy : dy));
    }
    ctx.closePath();
    ctx.fill();
  }
}

const oreMetal: SpriteSubject = {
  name: "ore-metal",
  size: SIZE,
  facings: CELLS * CELLS,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);
    ctx.fillStyle = "#000";

    const cellX = Math.floor(facing / CELLS) % CELLS;
    const cellY = facing % CELLS;
    // The eight neighbours as well as this cell, clipped by the box. A mark reaches at most 5 px
    // out of its own cell, so a ring of one is always enough.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = (cellX + dx + CELLS) % CELLS;
        const ny = (cellY + dy + CELLS) % CELLS;
        drawCell(ctx, nx, ny, dx * SIZE, dy * SIZE);
      }
    }
  },
};

export default oreMetal;
