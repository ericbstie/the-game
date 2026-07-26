import type { SpriteSubject } from "./sheet";

// Metal ore is ground, not an object: drawn flat and straight down, sorted with the floor rather
// than with the things that stand on it. It is also the ore that stays **pure ink** — power ore
// owns the red glow, so this tile has to say "mineral" in black alone, with no legend and nothing
// beside it to compare against (#76 §1).
//
// The variants ride the `facing` axis. `drawOre` picks one from a tile's coordinate, so a patch is
// identical on every client with nothing on the wire, exactly as the grass field works (#76 §3).
//
// What this tile has to survive is being **butted against copies of itself**, twenty to thirty at
// a time, which is a harder problem than the 15 px box. Every judgement here was made on a rendered
// field rather than on a single tile, which shows none of it; four versions died that way. The
// findings and what was done about them are in `ore-metal.review.md`.
//
// It also has to be told apart from two other things on the same white paper: **power ore**, which
// has red and round beads, and the **grass tufts**, which do not. Grass falls one tuft per twelve
// tiles in a 10 px box, so scale alone will not separate them — what does is that ore is a *solid
// angular mass in a clump* and grass is a thin open spray, and that ore comes several to a tile
// where grass comes one to a dozen.

const SIZE = 15; // TILE: the smallest box in the game

// Twenty-four drawings on four reflections. The count is the fix for the repeat: a patch runs to
// thirty-odd tiles, so twenty-four alone put six pixel-identical copies of one field inside a
// single 7×7 block, and the eye finds that immediately. Reflections cost no art and nothing on the
// wire, and they are legitimate here in a way they are not for a character, because ground has no
// front. All of it is one `facings` number: the cache wraps `facing`, and 96 bakes of 30×30.
const REFLECTIONS = 4;

type Point = readonly [number, number];

// Hand-cut silhouettes, each in its own unit box. Four things they are not:
//
// **Round.** A polygon whose vertices all sit near unit radius loses its corners to the rasteriser
// and reads as a spot of dirt. These run long straight edges between far-apart points, and several
// are twice as long as they are wide.
//
// **Regular.** No shard has an axis of symmetry, no two edges of one shard are parallel, and no
// placement below uses a quarter- or eighth-turn — an exactly axis-aligned or exactly 45° edge is
// the CAD tell a reviewer measured on the version before this one.
//
// **Even.** A procedural jitter spreads irregularity uniformly, which is its own tell; these are
// lopsided one at a time.
//
// **Memorable.** Deep notches read beautifully at 8× and turn into a glyph at six pixels — a
// bitten C the eye then picks out everywhere the patch repeats that variant, which is far louder
// than the regularity the notch was there to break. So concavities are shallow: about half the
// peak radius, a dent rather than a cleft. The egg-sac agent hit the same rule at 96 px.
const SHARDS: readonly (readonly Point[])[] = [
  // 0 · broad lump, dented between two high points
  [
    [-0.95, -0.22],
    [-0.18, -0.92],
    [0.42, -0.38],
    [0.88, -0.62],
    [0.92, 0.48],
    [-0.12, 0.95],
    [-0.72, 0.52],
  ],
  // 1 · blade — twice as long as it is wide
  [
    [-1.0, 0.08],
    [-0.42, -0.38],
    [0.28, -0.46],
    [0.98, -0.12],
    [0.46, 0.42],
    [-0.28, 0.48],
  ],
  // 2 · dart — one hard apex over a shallow-notched base
  [
    [0.16, -0.98],
    [0.84, 0.28],
    [0.3, 0.46],
    [-0.26, 0.9],
    [-0.82, -0.02],
  ],
  // 3 · irregular quad — a crystal, pushed off a true rhomb so it is not a diamond
  [
    [-0.9, -0.14],
    [-0.02, -0.88],
    [0.96, 0.1],
    [0.2, 0.92],
  ],
  // 4 · squat block, no two sides alike
  [
    [-0.86, -0.36],
    [0.18, -0.9],
    [0.88, -0.2],
    [0.72, 0.62],
    [-0.32, 0.84],
  ],
  // 5 · twin lump over a shallow saddle
  [
    [-0.9, 0.28],
    [-0.54, -0.82],
    [0.02, -0.44],
    [0.54, -0.88],
    [0.94, 0.16],
    [0.06, 0.86],
  ],
  // 6 · splinter — twice as tall as it is wide, waisted on one flank
  [
    [-0.3, -0.96],
    [0.34, -0.58],
    [0.38, 0.06],
    [0.56, 0.64],
    [-0.16, 0.98],
    [-0.46, 0.16],
  ],
  // 7 · wedge — one long cleavage face, and not one parallel pair
  [
    [-0.94, 0.44],
    [-0.36, -0.86],
    [0.58, -0.44],
    [0.96, 0.62],
  ],
  // 8 · pebble — the blunt one
  [
    [-0.84, -0.44],
    [0.34, -0.9],
    [0.9, 0.06],
    [0.44, 0.78],
    [-0.46, 0.86],
  ],
  // 9 · chevron with its back caved shallowly in
  [
    [-0.86, -0.32],
    [0.14, -0.9],
    [0.94, -0.06],
    [0.3, 0.34],
    [-0.16, 0.94],
  ],
];

interface Chip {
  shard: number;
  x: number;
  y: number;
  r: number; // reach from the chip's centre, in tile px
  turn: number; // in turns, not radians
}

// Twenty-four fields, placed by hand. Every number answers something a rendered field showed:
//
// - **Nothing is small.** An early version spent most of its ink on 1–2 px grains and two reviewers
//   independently called it pepper, flyspecks and a halftone screen. On white paper a lone black
//   pixel is a flyspeck, and a fixed ration of them per tile is a tint, not a material. Every mark
//   here is 9–12 px across — bigger than a grass tuft's 10 px box, and the only size that still
//   holds a straight edge and a sharp corner at dpr 1.
// - **Marks clump.** Ten fields carry two masses that overlap into one fused aggregate. Isolated
//   evenly spaced marks are blue noise, which is a print screen; and one tuft per twelve tiles is
//   exactly what grass looks like, so isolated marks are also the wrong reading.
// - **No field fills its box.** This is what makes a *patch* the right shape. A patch is a
//   rectangle of tiles, so if every tile inked its own edges the deposit would end in a perfect
//   axis-aligned rectangle — a highlighter swipe across the floor. Instead most fields sit inside
//   an irregular margin and only ten cross an edge at all, on varied sides, so the boundary of a
//   patch comes out ragged for free and the interior gaps read as sparseness. The margins are
//   deliberately unequal on the four sides of each field: a constant inset would rule a white grid
//   down the seams, which is the defect this replaced.
// - **Mass runs from nothing to two.** Fields 5, 11, 17 and 21 are bare paper. Those are why
//   `sprite:sheet` reports bakes that drew nothing, and that report is correct.
const FIELDS: readonly (readonly Chip[])[] = [
  [
    { shard: 0, x: 2.6, y: 4.2, r: 4.6, turn: 0.07 },
    { shard: 4, x: 10.6, y: 10.4, r: 3.4, turn: 0.61 },
  ],
  [{ shard: 5, x: 12.2, y: 7.4, r: 5.0, turn: 0.43 }],
  [
    { shard: 6, x: 6.0, y: 14.1, r: 4.6, turn: 0.31 },
    { shard: 8, x: 12.0, y: 6.4, r: 3.2, turn: 0.76 },
  ],
  [
    { shard: 2, x: 7.6, y: 7.2, r: 5.2, turn: 0.77 },
    { shard: 9, x: 3.3, y: 12.4, r: 3.0, turn: 0.18 },
  ],
  [
    { shard: 3, x: 13.1, y: 2.0, r: 4.4, turn: 0.52 },
    { shard: 7, x: 5.0, y: 9.6, r: 3.6, turn: 0.14 },
  ],
  [],
  [
    { shard: 3, x: 7.0, y: 2.2, r: 4.9, turn: 0.86 },
    { shard: 1, x: 3.2, y: 10.6, r: 3.2, turn: 0.29 },
  ],
  [
    { shard: 1, x: 2.5, y: 7.8, r: 4.7, turn: 0.58 },
    { shard: 5, x: 10.4, y: 11.6, r: 3.4, turn: 0.09 },
  ],
  [
    { shard: 4, x: 9.4, y: 6.2, r: 5.0, turn: 0.34 },
    { shard: 6, x: 3.4, y: 11.4, r: 3.2, turn: 0.71 },
  ],
  [
    { shard: 9, x: 4.0, y: 10.8, r: 4.5, turn: 0.62 },
    { shard: 2, x: 11.4, y: 4.6, r: 3.4, turn: 0.87 },
  ],
  [{ shard: 0, x: 7.4, y: 12.4, r: 4.8, turn: 0.47 }],
  [],
  [
    { shard: 1, x: 11.6, y: 6.4, r: 4.6, turn: 0.33 },
    { shard: 4, x: 5.2, y: 11.0, r: 3.4, turn: 0.68 },
  ],
  [{ shard: 6, x: 5.4, y: 8.8, r: 4.7, turn: 0.18 }],
  [
    { shard: 7, x: 12.6, y: 11.8, r: 4.4, turn: 0.41 },
    { shard: 3, x: 4.4, y: 4.0, r: 3.6, turn: 0.09 },
  ],
  [{ shard: 7, x: 2.0, y: 8.2, r: 4.8, turn: 0.66 }],
  [
    { shard: 2, x: 8.0, y: 2.2, r: 4.6, turn: 0.79 },
    { shard: 6, x: 4.6, y: 10.4, r: 3.3, turn: 0.44 },
  ],
  [],
  [{ shard: 9, x: 8.6, y: 6.6, r: 5.1, turn: 0.04 }],
  [
    { shard: 5, x: 3.0, y: 6.0, r: 4.4, turn: 0.51 },
    { shard: 0, x: 10.8, y: 10.6, r: 3.4, turn: 0.88 },
  ],
  [
    { shard: 5, x: 12.4, y: 8.6, r: 4.7, turn: 0.37 },
    { shard: 8, x: 5.0, y: 4.4, r: 3.4, turn: 0.13 },
  ],
  [],
  [
    { shard: 0, x: 6.8, y: 12.2, r: 4.6, turn: 0.81 },
    { shard: 6, x: 11.4, y: 5.6, r: 3.2, turn: 0.32 },
  ],
  [{ shard: 8, x: 6.4, y: 8.2, r: 5.0, turn: 0.44 }],
];

const oreMetal: SpriteSubject = {
  name: "ore-metal",
  size: SIZE,
  facings: FIELDS.length * REFLECTIONS,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);

    // Reflecting a torus leaves it a torus, so the seams survive this untouched.
    const reflection = Math.floor(facing / FIELDS.length) % REFLECTIONS;
    const flipX = reflection === 1 || reflection === 3;
    const flipY = reflection === 2 || reflection === 3;
    ctx.translate(flipX ? SIZE : 0, flipY ? SIZE : 0);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);

    ctx.fillStyle = "#000";
    for (const chip of FIELDS[facing % FIELDS.length]) {
      const angle = chip.turn * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      for (const [px, py] of SHARDS[chip.shard]) {
        ctx.lineTo(
          chip.x + (px * cos - py * sin) * chip.r,
          chip.y + (px * sin + py * cos) * chip.r,
        );
      }
      ctx.closePath();
      ctx.fill();
    }
  },
};

export default oreMetal;
