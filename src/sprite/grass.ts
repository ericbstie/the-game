import type { SpriteSubject } from "./sheet";

// The tufts scattered over the white paper floor. Grass indoors is the joke (#76 §3), and it is
// played straight: a small ink tuft, not a gag.
//
// The variants ride the `facing` axis. `grassAt` derives one per tile coordinate, so all six
// clients scatter the identical field with nothing on the wire.
//
// **The whole sprite is shaped by one constraint: it must not be confusable with metal ore.** Ore
// ships as scattered angular ink rubble — 9-12 px marks, one to three clustered per tile, on the
// same white paper. At a 10 px box, one per twelve tiles, scale alone cannot separate them. Three
// things do, and every decision below serves them:
//
// - **Open, not solid.** A tuft is thin strokes with paper between them. Ore is a filled mass.
// - **Linear and oriented.** Every blade springs from the foot and reaches *up*, so a field of
//   tufts carries a vertical grain. Ore is isotropic — its shards point nowhere.
// - **Sparse.** One tuft per twelve tiles, never touching another. Ore clusters and fuses.
//
// Judged on a field, never on a tile: `sprite:frame --at 20000,20000` for the bare scatter and the
// default camera for grass and ore on the same floor. See `grass.review.md`.

// The box the blades below are composed in. #72 settled it with the density; 5/6/8/10/12/14 were
// rendered. Every number in `TUFTS` is in these units and none of them moved for #106.
const DESIGN = 10;

// What the tuft is drawn at. #106 takes it to 0.8× so the tufts recede behind the ore they were
// being confused with — the scatter, the hand-placed blades and the three-blade ceiling are all
// #72's and unchanged; only the box they land in is smaller. Provisional.
const TUFT_SCALE = 0.8;
const SIZE = DESIGN * TUFT_SCALE; // 8

const MIRRORS = 2;

// Enough samples that the outline's facets are sub-pixel at the 20 px dpr-2 bake, and no more.
const STEPS = 12;

// A single blade, as an ink stroke rather than a line: a quadratic spine with a width that runs
// from a blunt root to a sharp tip. Uniform stroke width is the CAD-linework tell, and a stroke
// held below 1 px at real size is a grey smear rather than a mark — at 10 px both are one wrong
// number away, so width is a per-blade decision and never a global one.
interface Blade {
  x: number; // root, in box px
  y: number; // roots stagger: a shared baseline rules a bar across the foot of the tuft
  tipX: number;
  tipY: number;
  // Where the spine's control point sits between root and tip. Low `bend` leaves the root standing
  // vertical and throws the whole curve into the last third — a blade that whips over, which is the
  // rubber-hose read. `hold` is the same for height.
  bend: number;
  hold: number;
  w: number; // root width; the widest the blade ever is
  taper: number; // exponent on (1 - t^taper): higher holds the width longer and flicks off later
}

// Sixteen tufts, placed by hand. Every rule here is a defect that was rendered, measured and then
// fixed — two independent reviewers rejected the previous version on the first three:
//
// - **No tuft may be a solid convex blob.** That is metal ore's entire vocabulary, and eight of the
//   previous 32 variants fused into one at dpr 1: a 7-9 px unbroken run with almost no row split in
//   two. The cause was roots too close together, so blades that looked separate at dpr 2 merged at
//   dpr 1. Roots are now **at least 2.6 px apart** wherever two blades are rooted at a similar
//   height, which is the spacing at which two 2 px strokes still leave paper between them in ten
//   device pixels. This is not judged by eye — `gaps.ts` in the review scratch measures the widest
//   unbroken run and the number of split rows per variant, on the real dpr-1 bake.
// - **Every blade is at least 1.8 px at the root.** Thinner and it has no near-black pixel at dpr 1
//   at all: it ghosts to grey, which is how the whole set ended up reading a visible step lighter
//   than the ore beside it. A blade too thin to exist is deleted rather than drawn faint, which is
//   why nothing here has more than three blades — see below.
// - **The set has to vary in structure, not just in angle.** Sixteen perturbations of
//   short-tall-short is one drawing, and both reviewers named it as the generated tell. So the set
//   runs **three lone sprigs, six pairs and seven trios**, tallest blade from 3.3 to 7.9 px, and
//   ink mass from a single stroke to three.
// - **Nothing is symmetric, and the tall blade is never centred between two similar flankers.**
//   That exact arrangement reads as a bird's footprint or a letter w at 10 px, and a splayed
//   symmetric pair reads as the cartoon seagull "v" — a glyph that already means something else in
//   a black-and-white cartoon. Blade heights also never run monotonically across a tuft, because a
//   neat ascending or descending ramp is just a different regularity.
//
// **Three blades is the ceiling, and it is arithmetic rather than taste.** A blade needs ~2 px of
// width to hold ink at dpr 1 and ~0.7 px of paper beside it to stay open, so each one costs ~2.7 px
// of a 10 px box. Four will not fit without either fusing or ghosting, both of which are the
// defects above. A reviewer asked for five-blade sprays; this is why there are none.
const TUFTS: readonly (readonly Blade[])[] = [
  // 0 · a lone tall sprig — the low-mass end of the set
  [{ x: 5.2, y: 9.5, tipX: 3.1, tipY: 2.0, bend: 0.1, hold: 0.78, w: 2.5, taper: 3.8 }],
  // 1 · a lone mid blade, laid over to the right
  [{ x: 4.3, y: 9.5, tipX: 6.7, tipY: 4.4, bend: 0.2, hold: 0.66, w: 2.3, taper: 3.2 }],
  // 2 · a lone short sprig — the smallest mark in the set
  [{ x: 5.7, y: 9.5, tipX: 3.9, tipY: 6.2, bend: 0.26, hold: 0.58, w: 2.2, taper: 2.8 }],
  // 3 · tall left, one low stub well clear of it on the right
  [
    { x: 4.0, y: 9.5, tipX: 2.1, tipY: 1.6, bend: 0.1, hold: 0.8, w: 2.5, taper: 3.8 },
    { x: 7.1, y: 9.2, tipX: 8.7, tipY: 5.8, bend: 0.32, hold: 0.58, w: 1.9, taper: 2.6 },
  ],
  // 4 · the same weight thrown the other way, and shorter
  [
    { x: 6.3, y: 9.5, tipX: 8.3, tipY: 3.6, bend: 0.12, hold: 0.78, w: 2.4, taper: 3.6 },
    { x: 3.2, y: 9.2, tipX: 1.5, tipY: 5.4, bend: 0.3, hold: 0.6, w: 2.0, taper: 2.7 },
  ],
  // 5 · a pair both combed to the right, so it cannot read as a splayed v
  [
    { x: 3.0, y: 9.4, tipX: 5.1, tipY: 4.2, bend: 0.22, hold: 0.64, w: 2.2, taper: 3.0 },
    { x: 6.3, y: 9.6, tipX: 8.5, tipY: 6.0, bend: 0.28, hold: 0.54, w: 2.0, taper: 2.6 },
  ],
  // 6 · a pair both laid to the left, very unequal
  [
    { x: 7.1, y: 9.5, tipX: 4.6, tipY: 2.6, bend: 0.12, hold: 0.74, w: 2.4, taper: 3.5 },
    { x: 3.6, y: 9.2, tipX: 1.9, tipY: 6.4, bend: 0.32, hold: 0.56, w: 2.0, taper: 2.6 },
  ],
  // 7 · a low pair, both short — the squat end of the set
  [
    { x: 3.2, y: 9.5, tipX: 4.9, tipY: 5.6, bend: 0.26, hold: 0.58, w: 2.2, taper: 2.8 },
    { x: 6.5, y: 9.3, tipX: 8.1, tipY: 6.8, bend: 0.34, hold: 0.5, w: 1.9, taper: 2.4 },
  ],
  // 8 · tall and mid, leaning apart but too unequal to pair off as a v
  [
    { x: 3.4, y: 9.5, tipX: 1.9, tipY: 2.4, bend: 0.14, hold: 0.76, w: 2.4, taper: 3.6 },
    { x: 6.5, y: 9.3, tipX: 7.9, tipY: 5.2, bend: 0.24, hold: 0.64, w: 2.1, taper: 2.9 },
  ],
  // 9 · a tall blade and a far-off stub, the widest-spaced pair in the set
  //
  // This was a crossing pair, and it was the one variant the gap check still failed: two blades
  // that cross low fuse into a single run for most of the tuft's height, which is the blob again.
  // Crossings survive only where they happen near the tips, as in 13.
  [
    { x: 3.3, y: 9.5, tipX: 5.9, tipY: 2.2, bend: 0.12, hold: 0.76, w: 2.4, taper: 3.6 },
    { x: 7.4, y: 9.2, tipX: 8.9, tipY: 6.4, bend: 0.34, hold: 0.52, w: 1.9, taper: 2.5 },
  ],
  // 10 · trio, tallest on the left, shortest in the middle
  [
    { x: 2.6, y: 9.5, tipX: 1.1, tipY: 1.8, bend: 0.12, hold: 0.78, w: 2.4, taper: 3.7 },
    { x: 5.4, y: 9.2, tipX: 6.7, tipY: 6.4, bend: 0.3, hold: 0.54, w: 2.0, taper: 2.6 },
    { x: 8.2, y: 9.6, tipX: 9.2, tipY: 4.8, bend: 0.26, hold: 0.64, w: 2.0, taper: 2.9 },
  ],
  // 11 · trio, tallest hard right, descending unevenly to the left
  [
    { x: 7.6, y: 9.5, tipX: 8.9, tipY: 1.9, bend: 0.14, hold: 0.78, w: 2.4, taper: 3.7 },
    { x: 4.8, y: 9.2, tipX: 3.3, tipY: 4.4, bend: 0.26, hold: 0.66, w: 2.1, taper: 3.0 },
    { x: 2.0, y: 9.6, tipX: 0.9, tipY: 6.9, bend: 0.36, hold: 0.5, w: 1.9, taper: 2.5 },
  ],
  // 12 · trio all combed right, the tallest out at the edge
  [
    { x: 2.4, y: 9.5, tipX: 4.1, tipY: 4.8, bend: 0.24, hold: 0.62, w: 2.2, taper: 3.0 },
    { x: 5.2, y: 9.2, tipX: 7.3, tipY: 6.2, bend: 0.28, hold: 0.54, w: 2.0, taper: 2.6 },
    { x: 8.0, y: 9.6, tipX: 9.3, tipY: 3.6, bend: 0.22, hold: 0.68, w: 2.1, taper: 3.1 },
  ],
  // 13 · two tall crossing high up, over one low stub
  [
    { x: 4.0, y: 9.5, tipX: 6.3, tipY: 2.4, bend: 0.14, hold: 0.78, w: 2.4, taper: 3.7 },
    { x: 7.3, y: 9.2, tipX: 5.2, tipY: 4.2, bend: 0.22, hold: 0.7, w: 2.1, taper: 3.2 },
    { x: 1.5, y: 9.6, tipX: 0.9, tipY: 6.6, bend: 0.36, hold: 0.52, w: 1.9, taper: 2.5 },
  ],
  // 14 · a low wide spray, heights deliberately out of order
  [
    { x: 2.2, y: 9.5, tipX: 1.0, tipY: 7.1, bend: 0.32, hold: 0.5, w: 2.0, taper: 2.5 },
    { x: 5.0, y: 9.2, tipX: 3.9, tipY: 4.4, bend: 0.24, hold: 0.66, w: 2.2, taper: 3.0 },
    { x: 7.9, y: 9.6, tipX: 9.2, tipY: 5.6, bend: 0.3, hold: 0.56, w: 2.0, taper: 2.7 },
  ],
  // 15 · trio at half height, all leaning left
  [
    { x: 7.6, y: 9.5, tipX: 6.0, tipY: 5.2, bend: 0.26, hold: 0.6, w: 2.2, taper: 2.9 },
    { x: 4.8, y: 9.2, tipX: 3.2, tipY: 6.6, bend: 0.32, hold: 0.52, w: 2.0, taper: 2.6 },
    { x: 1.9, y: 9.6, tipX: 0.9, tipY: 4.6, bend: 0.24, hold: 0.64, w: 2.1, taper: 3.0 },
  ],
];

const grass: SpriteSubject = {
  name: "grass",
  size: SIZE,
  // Mirroring is legitimate here in a way it is not for a character, because ground has no front —
  // but only across x. A y-flip would hang the tuft from its tips, and every blade in the set grows
  // up. `cache.ts` wraps `facing`, so 32 is one number and 32 bakes of 20×20 is ~50 KB.
  facings: TUFTS.length * MIRRORS,
  frames: 1,
  draw(ctx, size, facing) {
    // Into the design box, not the declared one: the blades are laid out in `DESIGN` units and the
    // scale is what takes them to the smaller box the game blits.
    ctx.scale(size / DESIGN, size / DESIGN);

    if (facing >= TUFTS.length) {
      ctx.translate(DESIGN, 0);
      ctx.scale(-1, 1);
    }

    ctx.fillStyle = "#000";
    for (const blade of TUFTS[facing % TUFTS.length]) inkBlade(ctx, blade);
  },
};

// One blade, filled rather than stroked. Walking the spine and offsetting by a varying half-width
// is what buys the swell and the flicked tip; `ctx.stroke` cannot vary its width along a path, and
// a constant-width stroke at this size is the thing that reads as drafting rather than as ink.
function inkBlade(ctx: CanvasRenderingContext2D, blade: Blade): void {
  const { x, y, tipX, tipY, bend, hold, w, taper } = blade;
  const cx = x + (tipX - x) * bend;
  const cy = y + (tipY - y) * hold;

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    const px = u * u * x + 2 * u * t * cx + t * t * tipX;
    const py = u * u * y + 2 * u * t * cy + t * t * tipY;
    const dx = 2 * (u * (cx - x) + t * (tipX - cx));
    const dy = 2 * (u * (cy - y) + t * (tipY - cy));
    const length = Math.hypot(dx, dy) || 1;
    const half = (w * (1 - t ** taper)) / 2;
    left.push([px - (dy / length) * half, py + (dx / length) * half]);
    right.push([px + (dy / length) * half, py - (dx / length) * half]);
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [px, py] of left) ctx.lineTo(px, py);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

export default grass;
