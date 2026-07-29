import type { SpriteSubject } from "./sheet";
import { drawTiled, TILED_FACINGS } from "./tiled";

// Metal ore is ground, not an object: drawn flat and straight down, sorted with the floor rather
// than with the things that stand on it. It is also the ore that stays **pure ink** — power ore
// owns the red glow, so this tile has to say "mineral" in black alone, with no legend and nothing
// beside it to compare against (#76 §1).
//
// The variants ride the `facing` axis. The game picks one from a tile's coordinate, so a patch is
// identical on every client with nothing on the wire, exactly as the grass field works (#76 §3).

const SIZE = 15; // one ore tile: the smallest box in the game

// The weight laid on every shard's silhouette (#106). Bolder was asked for as *ink*, not as size, so
// it goes on the outline of what is already there: a stroke grows each piece by half its width all
// round, which is what thickens the blades and splinters that were ghosting to grey at dpr 1 without
// moving a vertex of the hand-cut set. Provisional.
//
// The fines take none of it. A grain is a whole pixel on whole-pixel edges — the one mark at this
// size that carries no anti-aliasing at all — and a stroke around a 1 px rect is a 2 px grey smudge,
// which is the opposite of bolder.
const SHARD_WEIGHT = 1.1;

type Point = readonly [number, number];

// Hand-cut silhouettes, each in its own unit box. Two things they are not: round, and even.
//
// Round is what a polygon becomes when every vertex sits near unit radius — at 30 device px the
// anti-aliasing rounds the corners off and it reads as a spot of dirt. So the radius swings from
// about 0.15 to 1.0 within a single shard: long straight runs between far-apart points, and deep
// notches between the peaks. The notch is the fracture, and it is cut into the **silhouette**,
// against white paper, rather than scored inside the black where a 1 px mark could not survive.
//
// Even is the generated-image tell. A procedural jitter spreads irregularity uniformly; these are
// lopsided one at a time, on purpose.
const SHARDS: readonly (readonly Point[])[] = [
  // 0 · cleft nugget — two peaks over a deep V
  [
    [-0.95, 0.15],
    [-0.55, -0.8],
    [-0.1, -0.2],
    [0.3, -0.95],
    [0.9, -0.3],
    [0.7, 0.55],
    [-0.05, 0.95],
  ],
  // 1 · blade — twice as long as it is wide, tapered at both ends
  [
    [-1.0, 0.1],
    [-0.3, -0.35],
    [0.35, -0.45],
    [1.0, -0.05],
    [0.3, 0.35],
    [-0.35, 0.4],
  ],
  // 2 · dart — one hard apex, notched base
  [
    [0.05, -1.0],
    [0.85, 0.45],
    [0.2, 0.25],
    [-0.15, 0.9],
    [-0.75, 0.1],
  ],
  // 3 · rhomb — four points, the closest thing here to a clean crystal
  [
    [-0.85, -0.15],
    [0.05, -0.9],
    [0.95, 0.05],
    [0.15, 0.85],
  ],
  // 4 · chip — a small quad, no two sides alike
  [
    [-0.8, -0.45],
    [0.55, -0.9],
    [0.9, 0.35],
    [-0.2, 0.75],
  ],
  // 5 · twin peaks — the deepest notch of the set
  [
    [-0.9, 0.45],
    [-0.55, -0.9],
    [-0.05, -0.15],
    [0.45, -0.95],
    [0.9, 0.3],
    [0.15, 0.8],
  ],
  // 6 · splinter — tall, thin, kinked at the waist
  [
    [-0.2, -1.0],
    [0.35, -0.55],
    [0.15, 0.05],
    [0.55, 0.6],
    [-0.1, 1.0],
    [-0.45, 0.15],
  ],
  // 7 · wedge — one long flat cleavage face
  [
    [-0.95, 0.55],
    [-0.35, -0.85],
    [0.6, -0.55],
    [0.95, 0.6],
  ],
  // 8 · grain — the blunt one, for pieces too small to hold a notch
  [
    [-0.85, -0.55],
    [0.65, -0.9],
    [0.95, 0.45],
    [-0.35, 0.9],
  ],
  // 9 · arrow — a chevron with its back caved in
  [
    [-0.9, -0.3],
    [0.05, -0.95],
    [0.95, -0.05],
    [0.1, 0.25],
    [-0.25, 0.95],
  ],
];

interface Chip {
  shard: number;
  x: number;
  y: number;
  r: number; // reach from the chip's centre, in tile px
  turn: number; // in turns, not radians
}

// The fines. Whole pixels on whole-pixel edges, which is the one mark at this size that carries no
// anti-aliasing at all: a rotated 2 px chip bakes almost entirely into grey, while these stay hard
// black at every dpr the game meets. They are what keeps a patch reading as ink rather than as a
// smudge, and they are scattered rather than ranked, so they never line up into a mesh.
//
// No grain is ever a 2×2 square: at this size a filled square is the one axis-aligned shape big
// enough to be recognised as one, and a perfect one reads as a pixel rather than as rock. Anything
// larger than a single dot is a bar or an L built from two bars.
type Grain = readonly [x: number, y: number, width: number, height: number];

interface Field {
  chips: readonly Chip[];
  grit: readonly Grain[];
}

// Twelve fields, placed by hand. Three things are varied deliberately, because each is a way a
// patch betrays itself as one stamp repeated rather than as scattered mineral:
//
// - **Mass.** Field 10 is a single lump and field 6 is nearly all fines; a patch needs clumps and
//   gaps, and a constant mass per tile is a rhythm the eye finds immediately.
// - **Margin.** A constant inset would draw a white lattice down every tile seam, so some pieces
//   run right to an edge while other tiles leave a third of themselves bare.
// - **Grade.** Every field mixes size classes, because evenly sized pieces read as a pattern of
//   dots — crushed rock is fines around a few big pieces.
const FIELDS: readonly Field[] = [
  {
    chips: [
      { shard: 0, x: 4.8, y: 9.6, r: 3.4, turn: 0.07 },
      { shard: 2, x: 10.6, y: 4.6, r: 2.3, turn: 0.62 },
      { shard: 7, x: 12.4, y: 10.6, r: 1.7, turn: 0.33 },
    ],
    grit: [
      [8, 2, 2, 1],
      [13, 1, 1, 1],
      [1, 4, 1, 2],
    ],
  },
  {
    chips: [
      { shard: 5, x: 5.2, y: 4.8, r: 3.2, turn: 0.44 },
      { shard: 1, x: 9.6, y: 8.0, r: 2.4, turn: 0.15 },
    ],
    grit: [
      [2, 11, 2, 1],
      [2, 12, 1, 1],
      [13, 12, 1, 1],
      [6, 13, 1, 1],
      [0, 7, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 3, x: 7.8, y: 6.4, r: 2.5, turn: 0.28 },
      { shard: 4, x: 3.6, y: 11.4, r: 2.0, turn: 0.55 },
    ],
    grit: [
      [12, 3, 1, 2],
      [10, 10, 2, 1],
      [5, 1, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 6, x: 10.6, y: 6.2, r: 3.3, turn: 0.52 },
      { shard: 0, x: 4.4, y: 10.6, r: 2.5, turn: 0.36 },
      { shard: 9, x: 3.6, y: 3.6, r: 2.0, turn: 0.68 },
    ],
    grit: [
      [8, 13, 2, 1],
      [13, 12, 1, 1],
      [0, 0, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 7, x: 4.0, y: 11.0, r: 3.1, turn: 0.13 },
      { shard: 2, x: 8.4, y: 7.2, r: 2.3, turn: 0.77 },
      { shard: 1, x: 12.0, y: 3.8, r: 2.0, turn: 0.41 },
    ],
    grit: [
      [6, 2, 1, 1],
      [1, 5, 2, 1],
      [13, 9, 1, 2],
    ],
  },
  {
    chips: [
      { shard: 3, x: 7.6, y: 3.4, r: 3.5, turn: 0.86 },
      { shard: 5, x: 11.4, y: 10.0, r: 2.3, turn: 0.24 },
    ],
    grit: [
      [2, 7, 2, 1],
      [3, 8, 1, 1],
      [5, 13, 1, 1],
      [0, 11, 1, 1],
      [9, 13, 2, 1],
    ],
  },
  {
    chips: [
      { shard: 8, x: 4.6, y: 5.4, r: 1.8, turn: 0.31 },
      { shard: 4, x: 10.4, y: 4.2, r: 1.6, turn: 0.66 },
    ],
    grit: [
      [7, 10, 2, 2],
      [12, 11, 1, 1],
      [3, 12, 1, 1],
      [13, 1, 1, 2],
      [0, 8, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 1, x: 3.6, y: 6.6, r: 3.3, turn: 0.58 },
      { shard: 0, x: 10.6, y: 10.6, r: 2.4, turn: 0.09 },
      { shard: 7, x: 12.6, y: 5.4, r: 1.9, turn: 0.79 },
    ],
    grit: [
      [6, 13, 1, 1],
      [9, 1, 2, 1],
      [1, 0, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 2, x: 8.4, y: 10.8, r: 3.3, turn: 0.35 },
      { shard: 6, x: 4.2, y: 4.8, r: 2.4, turn: 0.71 },
      { shard: 4, x: 12.2, y: 6.8, r: 1.8, turn: 0.18 },
    ],
    grit: [
      [10, 1, 1, 2],
      [0, 2, 2, 1],
      [13, 13, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 9, x: 10.0, y: 8.4, r: 3.2, turn: 0.63 },
      { shard: 5, x: 11.8, y: 12.4, r: 2.0, turn: 0.27 },
      { shard: 7, x: 6.4, y: 5.0, r: 2.2, turn: 0.85 },
    ],
    grit: [
      [2, 12, 1, 1],
      [1, 1, 1, 1],
      [13, 4, 1, 1],
    ],
  },
  {
    chips: [{ shard: 0, x: 7.6, y: 7.2, r: 3.8, turn: 0.48 }],
    grit: [
      [13, 2, 1, 2],
      [2, 12, 2, 1],
      [12, 12, 1, 1],
      [5, 1, 1, 1],
    ],
  },
  {
    chips: [
      { shard: 4, x: 5.0, y: 3.6, r: 2.2, turn: 0.22 },
      { shard: 1, x: 8.2, y: 9.4, r: 2.4, turn: 0.9 },
      { shard: 8, x: 3.4, y: 11.8, r: 1.9, turn: 0.4 },
    ],
    grit: [
      [11, 5, 2, 1],
      [13, 10, 1, 1],
      [7, 0, 1, 1],
      [0, 6, 1, 2],
    ],
  },
];

// Which hand-cut field a cell of the repeating grid draws. Both axes matter: indexing on one alone
// is what striped the field into identical rows before #87 measured it (37.5% of adjacent tile
// pairs drew the identical stamp).
function fieldOf(cx: number, cy: number): Field {
  return FIELDS[(cx * 5 + cy * 7) % FIELDS.length];
}

// One cell's marks, in its own 15-unit box. Called nine times per tile by `drawTiled` — once for
// this cell and once for each neighbour, translated into place — so a chip whose silhouette
// overruns the box is completed by the tile next door instead of being clipped into a straight
// line on the grid pitch.
function chip(ctx: CanvasRenderingContext2D, spec: Chip): void {
  const angle = spec.turn * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  ctx.beginPath();
  for (const [px, py] of SHARDS[spec.shard]) {
    ctx.lineTo(spec.x + (px * cos - py * sin) * spec.r, spec.y + (px * sin + py * cos) * spec.r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const noise = (cx: number, cy: number, salt: number): number => {
  const mixed = Math.imul((cx * 73_856_093) ^ (cy * 19_349_663) ^ (salt * 83_492_791), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 4_294_967_296;
};

// Two chips per cell sitting *astride* its east and south edges. Without them the field has no
// ink on a seam at all: the hand-cut fields are composed inside their boxes, so drawing a
// neighbour's cell contributes nothing to mine and the lattice survives every amount of
// machinery. Measured at an 8.08x centre-to-seam deficit before these went in.
//
// East and south only, because each seam belongs to exactly one of the two cells that share it —
// claiming both ends would put two chips on every seam. `drawTiled` draws the neighbouring cells
// too, so the tile on the far side of a seam draws this same chip translated and keeps the other
// half of it. The halves meet because both are generated from the same cell coordinate.
function seamChips(cx: number, cy: number): Chip[] {
  return [
    {
      shard: Math.floor(noise(cx, cy, 1) * SHARDS.length),
      x: SIZE,
      y: 2 + noise(cx, cy, 2) * (SIZE - 4),
      r: 2.1 + noise(cx, cy, 3) * 1.5,
      turn: noise(cx, cy, 4),
    },
    {
      shard: Math.floor(noise(cx, cy, 5) * SHARDS.length),
      x: 2 + noise(cx, cy, 6) * (SIZE - 4),
      y: SIZE,
      r: 2.1 + noise(cx, cy, 7) * 1.5,
      turn: noise(cx, cy, 8),
    },
  ];
}

function paintCell(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const field = fieldOf(cx, cy);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = SHARD_WEIGHT;
  ctx.lineJoin = "round"; // a mitre on a shard's apex draws a whisker off the point
  for (const spec of field.chips) chip(ctx, spec);
  for (const spec of seamChips(cx, cy)) chip(ctx, spec);
  for (const [x, y, width, height] of field.grit) ctx.fillRect(x, y, width, height);
}

const oreMetal: SpriteSubject = {
  name: "ore-metal",
  size: SIZE,
  // The tiled contract (#87): the tile's cell in the repeating grid, packed with a 4-bit mask of
  // which neighbours hold metal too. `drawTiled` unpacks both.
  facings: TILED_FACINGS,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);
    drawTiled(ctx, SIZE, facing, paintCell);
  },
};

export default oreMetal;
