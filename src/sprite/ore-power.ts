import type { SpriteSubject } from "./sheet";

// Power ore: one 15 px tile of the glowing seam, drawn flat and straight down like the floor it is
// part of (#76 §2). Ten to twenty tiles make a patch, and the game picks a variant from the tile's
// coordinate, so a whole field costs nothing on the wire.
//
// **Distinct from metal ore in ink alone.** Metal is angular — sharp shards and hard grit. These
// are lobed, bitten lumps, and they carry rays and a halo, which metal never does. Colour is what
// separates the two ores at a glance, but the shapes separate them without it, so they do not
// collapse into each other for a red-blind player or under a semi-transparent build ghost.
//
// A generator — 75 px, flat, white — is built on a patch and covers most of it. Several fields
// therefore run a lump hard off a box edge, so the ring of tiles the chassis half-covers still
// shows light in the seam, and there is ink in the field for the chassis contour to sit against.

const SIZE = 15; // TILE

// **The ore is ink. The red is the light coming off it.** Every earlier draft had it the other way
// round — red lumps with a black line — and two reviewers landed on the same verdict: swap the red
// for green and the drawing loses nothing, because the red *was* the fill and there was no drawing
// underneath for it to accent. A red fill is also not a glow. It is a red dot, and forty red dots
// butted together are the loudest thing on the screen.
//
// So the piece is solid black, the way every other sprite in this game is solid black, and the red
// is only ever what escapes it: a rim of light around the stone, a few rays off it, and a tight
// halo. That is a glow — it emanates from a mark instead of being one — and it is the least red
// that can carry the grant.
const INK = "#000";
const LIGHT = "#e33212"; // the rim: the only saturated red in the drawing
const RAY = "rgba(233, 60, 30, 0.85)";
const AURA = "233, 60, 30"; // supplies its own alpha per gradient stop

const TAU = Math.PI * 2;

// Hand-cut lumps, each a closed curve through seven radii in its own unit box. Two things they are
// not: round, and even.
//
// Round is what a lobed shape becomes when every radius sits near 1 — at 30 device px the
// anti-aliasing rounds it off and it reads as a bead, and a bead with a bright edge reads as
// glossy candy. So the radius swings from 0.3 to 1.0 within a single lump: long shallow flanks
// against bites deep enough to survive both the rasteriser and the rim being grown over them.
//
// Even is the generated-image tell. A procedural jitter spreads irregularity uniformly; these are
// lopsided one at a time, on purpose.
const LUMPS: readonly (readonly number[])[] = [
  [1.0, 0.52, 0.88, 0.34, 0.82, 0.66, 0.45], // 0 · haunch — one long flank over a deep bite
  [0.95, 0.8, 0.32, 0.62, 1.0, 0.38, 0.7], // 1 · kidney — two masses pinched at the waist
  [0.55, 1.0, 0.42, 0.86, 0.3, 0.92, 0.6], // 2 · knuckle — three knobs, none the same
  [1.0, 0.68, 0.58, 0.95, 0.3, 0.76, 0.4], // 3 · teardrop — blunt at one end, drawn at the other
  [0.84, 0.34, 1.0, 0.48, 0.72, 0.36, 0.96], // 4 · clinker — the most bitten of the set
  [0.62, 0.95, 0.74, 0.36, 0.88, 0.5, 1.0], // 5 · pebble — the calm one, for the small pieces
];

// `r` is the ember's reach from its own centre, in tile px; `turn` is its rotation, in turns
// rather than radians, so a glance down the table reads as fractions of a circle.
type Ember = readonly [lump: number, x: number, y: number, r: number, turn: number];

// A ray leaves ember `from` at `turn` and runs `len` px past it.
type Ray = readonly [from: number, turn: number, len: number];

interface Field {
  embers: readonly Ember[];
  rays: readonly Ray[];
}

// Twelve fields, placed by hand. Four things vary deliberately, because each is a way a patch
// betrays itself as one stamp repeated rather than as scattered mineral:
//
// - **Mass.** Fields 2, 6 and 10 are nearly bare and 0, 3, 5, 8 and 11 are full. A constant mass
//   per tile is a rhythm the eye finds immediately, and a seam needs clumps and gaps.
// - **Position.** Only field 7 puts its largest ember near the middle of the box. Anything else
//   would print a lattice at exactly the tile pitch — the one period this drawing must not have.
// - **Margin.** A constant inset would draw a white lattice down every seam instead, so several
//   fields run a lump right off an edge, to be cut by it and continue into the neighbour.
// - **Grade.** Every field mixes sizes. Evenly sized pieces read as a pattern of dots; ore is
//   fines around a few big pieces.
const FIELDS: readonly Field[] = [
  {
    embers: [
      [0, 1.5, 6.1, 3.2, 0.07],
      [5, 7.7, 0.5, 2.1, 0.42],
      [3, 9.5, 7.3, 1.4, 0.66],
      [2, -0.9, -0.3, 1.6, 0.21],
    ],
    rays: [
      [0, 0.6, 2.1],
      [0, 0.85, 1.4],
      [1, 0.28, 1.5],
    ],
  },
  {
    embers: [
      [2, 12.4, 1.3, 3.0, 0.55],
      [3, 5.6, 7.3, 1.8, 0.18],
      [4, 7.4, -1.7, 1.4, 0.77],
      [5, 15.8, 8.3, 1.3, 0.33],
    ],
    rays: [
      [0, 0.14, 2.0],
      [0, 0.4, 1.4],
      [1, 0.72, 1.4],
    ],
  },
  {
    embers: [
      [3, 5.1, 6.5, 2.3, 0.29],
      [5, 9.3, 14.1, 1.4, 0.6],
    ],
    rays: [
      [0, 0.47, 1.9],
      [0, 0.9, 1.2],
    ],
  },
  {
    embers: [
      [1, -0.6, 9.7, 3.4, 0.64],
      [4, 7.0, 15.5, 2.2, 0.36],
      [0, 9.4, 7.9, 1.7, 0.09],
      [5, 3.0, 17.3, 1.3, 0.5],
    ],
    rays: [
      [0, 0.02, 2.3],
      [0, 0.25, 1.5],
      [1, 0.16, 1.4],
    ],
  },
  {
    embers: [
      [0, 16.4, 7.3, 2.8, 0.21],
      [5, 7.8, 12.1, 1.8, 0.73],
      [2, 10.0, 5.1, 1.6, 0.44],
      [3, 4.6, 1.7, 1.4, 0.88],
    ],
    rays: [
      [0, 0.52, 2.1],
      [0, 0.69, 1.4],
      [1, 0.35, 1.2],
    ],
  },
  {
    embers: [
      [4, 6.1, 10.1, 2.6, 0.48],
      [1, 11.3, 15.3, 2.5, 0.11],
      [3, 13.1, 8.1, 1.4, 0.7],
      [5, 2.7, 16.7, 1.4, 0.26],
    ],
    rays: [
      [0, 0.33, 1.7],
      [1, 0.63, 1.6],
      [0, 0.06, 1.2],
    ],
  },
  {
    embers: [
      [5, 7.4, 5.5, 2.1, 0.83],
      [2, 1.6, -2.3, 1.7, 0.4],
    ],
    rays: [
      [0, 0.29, 1.6],
      [1, 0.72, 1.2],
    ],
  },
  {
    embers: [
      [1, 11.3, 9.1, 3.0, 0.16],
      [0, 16.7, 14.3, 1.6, 0.58],
      [4, 6.1, 14.9, 1.4, 0.31],
    ],
    rays: [
      [0, 0.09, 2.0],
      [0, 0.43, 1.6],
      [0, 0.68, 1.2],
    ],
  },
  {
    embers: [
      [3, -1.6, 10.8, 2.9, 0.71],
      [0, 5.8, 4.8, 2.3, 0.26],
      [5, 2.4, 1.2, 1.4, 0.05],
      [2, 8.2, 10.0, 1.4, 0.52],
    ],
    rays: [
      [0, 0.55, 1.9],
      [0, 0.78, 1.4],
      [1, 0.2, 1.6],
    ],
  },
  {
    embers: [
      [2, 12.5, 9.5, 2.4, 0.59],
      [4, 4.9, -0.5, 2.0, 0.94],
      [1, 2.3, 5.7, 1.7, 0.37],
      [5, 8.5, 3.3, 1.3, 0.14],
    ],
    rays: [
      [0, 0.45, 1.8],
      [1, 0.62, 1.4],
    ],
  },
  {
    embers: [
      [4, 5.9, 11.2, 2.2, 0.37],
      [3, 0.7, 6.8, 1.4, 0.8],
    ],
    rays: [
      [0, 0.13, 1.6],
      [0, 0.58, 1.2],
    ],
  },
  {
    embers: [
      [0, 8.8, 0.6, 3.4, 0.87],
      [5, 14.4, 9.4, 2.0, 0.31],
      [3, 3.8, 6.6, 1.6, 0.62],
      [2, 12.2, 5.8, 1.4, 0.18],
    ],
    rays: [
      [0, 0.24, 2.2],
      [0, 0.49, 1.5],
      [1, 0.06, 1.4],
    ],
  },
];

// **The lean is bigger than the band, so the rim is not a ring.** A band of even width running the
// whole way round a black shape is a rind, and a rind is decoration: nothing in it says which way
// the light is getting out. Leaning it further than its own width closes it off entirely on one
// flank — the stone sits flush against the paper there — and piles all of it onto the other, where
// it reads as light escaping. Which flank comes from the piece's own rotation, so a patch has no
// agreed direction and therefore implies no light source, which flat ground must not have.
//
// Both scale with the stone, capped. A fixed width is a rim on a big piece and a coat of paint on
// a small one, and a reviewer counting red against black found the smallest stones running half
// red — which is the fill this drawing gave up, arriving by the back door.
const RIM_BAND = 1.15;
const RIM_LEAN = 1.3;
const RIM_OF_R = 0.38; // the cap: no piece gives up more of itself than this to its own light
const RIM_LEAN_TURN = 0.13; // added to a piece's own turn, so no two rims lean the same way
const RIM_ABOVE = 1.9; // under this a piece is a fine, and a fine is unlit: solid ink, no light
const MIN_RADIUS = 0.35; // `grow` also runs inwards; a deep bite driven past the centre inverts

// **Absolute, not a multiple of the piece.** `reach × 3` on a 4 px lump is a 26 px gradient inside
// a 15 px box: the ramp cannot finish, the box chops it while it still carries a fifth of its
// alpha, and every tile prints as a pink square with ruler-straight edges. Measured on the draft
// that did it. Two px past the lump always finishes inside the tile, whatever size the lump is.
const AURA_HALO = 1.5;
const AURA_INNER_OF_R = 0.6;

const RAY_ROOT = 0.95; // buried in the ember, so no lobe leaves a ray floating
const RAY_BASE = 1.8;
const RAY_TIP = 1;

// A closed curve through the lump's radii: quadratics through the midpoints, so the samples round
// off into lobes instead of reading as a heptagon at five pixels across.
function outline(
  ctx: CanvasRenderingContext2D,
  ember: Ember,
  grow: number,
  dx: number,
  dy: number,
): void {
  const [lump, cx, cy, reach, turn] = ember;
  const radii = LUMPS[lump];
  const n = radii.length;
  const at = (i: number): [number, number] => {
    const angle = (turn + i / n) * TAU;
    // Clamped, because `grow` also runs inwards to cut the core, and a deep bite driven past the
    // centre would turn the curve inside out.
    const r = Math.max(MIN_RADIUS, radii[((i % n) + n) % n] * reach + grow);
    return [cx + dx + Math.cos(angle) * r, cy + dy + Math.sin(angle) * r];
  };
  const mid = (i: number): [number, number] => {
    const [ax, ay] = at(i);
    const [bx, by] = at(i + 1);
    return [(ax + bx) / 2, (ay + by) / 2];
  };
  ctx.beginPath();
  ctx.moveTo(...mid(-1));
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(...at(i), ...mid(i));
  ctx.closePath();
}

function drawRay(ctx: CanvasRenderingContext2D, ember: Ember, turn: number, len: number): void {
  const [, cx, cy, reach] = ember;
  const angle = turn * TAU;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const root = reach * RAY_ROOT;
  const x0 = cx + cos * root;
  const y0 = cy + sin * root;
  const x1 = cx + cos * (root + len);
  const y1 = cy + sin * (root + len);
  const base = RAY_BASE / 2;
  const tip = RAY_TIP / 2;
  ctx.beginPath();
  ctx.moveTo(x0 - sin * base, y0 + cos * base);
  ctx.lineTo(x1 - sin * tip, y1 + cos * tip);
  ctx.lineTo(x1 + sin * tip, y1 - cos * tip);
  ctx.lineTo(x0 + sin * base, y0 - cos * base);
  ctx.closePath();
  ctx.fill();
}

// Twelve hand-placed fields, each drawn in four orientations. The game picks a variant from the
// tile's coordinate, and at twelve a patch was measured repeating — two identical tiles landed
// directly on top of each other. Forty-eight makes that vanishingly unlikely without forty-eight
// compositions to author and check, and a reflection of scattered ground is not a reflection
// anybody can see: there is no figure in it to come out backwards.
const ORIENTATIONS = 4;
const VARIANTS = FIELDS.length * ORIENTATIONS;

const orePower: SpriteSubject = {
  name: "ore-power",
  size: SIZE,
  facings: VARIANTS,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);
    const variant = ((facing % VARIANTS) + VARIANTS) % VARIANTS;
    const flip = Math.floor(variant / FIELDS.length);
    if (flip & 1) {
      ctx.translate(SIZE, 0);
      ctx.scale(-1, 1);
    }
    if (flip & 2) {
      ctx.translate(0, SIZE);
      ctx.scale(1, -1);
    }
    const { embers, rays } = FIELDS[variant % FIELDS.length];

    for (const [, cx, cy, reach] of embers) {
      const far = reach + AURA_HALO;
      const aura = ctx.createRadialGradient(cx, cy, reach * AURA_INNER_OF_R, cx, cy, far);
      aura.addColorStop(0, `rgba(${AURA}, 0.3)`);
      aura.addColorStop(0.5, `rgba(${AURA}, 0.1)`);
      aura.addColorStop(1, `rgba(${AURA}, 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, far, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = RAY;
    for (const [from, turn, len] of rays) drawRay(ctx, embers[from], turn, len);

    // Two passes, not one piece at a time. Drawing a piece's rim and then its stone before starting
    // the next lets the next rim cut into ink already laid down, and two lumps that touch end up
    // with a red seam between them instead of merging into one mass. Every rim first, then every
    // stone over the lot of them.
    ctx.fillStyle = LIGHT;
    for (const ember of embers) {
      if (ember[3] < RIM_ABOVE) continue;
      // The rim runs all the way round and leans, rather than being one translated copy of the
      // lump: a pure translation shows up as a slab parked along whichever flank is straightest,
      // with two cut ends. Growing the shape as well puts light on every side, `RIM_BAND ±
      // RIM_LEAN` wide, so it swells and tapers around the stone the way a loaded nib does and is
      // never thinner than a whole pixel — the width that survives an ordinary monitor, where an
      // earlier draft's line was measured existing on only a fifth of each outline.
      const lean = (ember[4] + RIM_LEAN_TURN) * TAU;
      const cap = ember[3] * RIM_OF_R;
      const band = Math.min(RIM_BAND, cap);
      const throw_ = Math.min(RIM_LEAN, cap * 1.13);
      outline(ctx, ember, band, Math.cos(lean) * throw_, Math.sin(lean) * throw_);
      ctx.fill();
    }

    ctx.fillStyle = INK;
    for (const ember of embers) {
      outline(ctx, ember, 0, 0, 0);
      ctx.fill();
    }
  },
};

export default orePower;
