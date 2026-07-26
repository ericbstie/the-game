import type { SpriteSubject } from "./sheet";

// The egg sac — the enemy nest — in elevation, standing on the floor and anchored at the bottom
// centre of its 96px box so it overlaps whatever is behind it.
//
// The two states ride the `facing` axis and there is no animation: waves arrive unannounced, so a
// sac has no charging frame to draw (#76 §5). What they have to survive is being read side by side
// on a white floor with no colour and no text, so the difference is carried four ways at once — the
// wreck loses its top, slumps wider, empties, and keeps only a couple of the eggs that fill the
// live one. The wreck stays on the field next to live sacs, so a glance has to separate them.
//
// The tear is deliberately **asymmetric**, one side still standing. A sac torn evenly across reads
// as a bowl; a sac torn off to one side reads as damage.
//
// Six things this sprite must not become. Every one of them is something a bake actually did, not
// something reasoned about in advance, and most were only visible at real size:
//
// - **legs** — silk drawn as long taut lines from the flanks to the floor turns the sac into a
//   standing creature, which on a spider nest is the worst available misread. The silk lies flat
//   and short on the floor instead, and the puddle buries its inner half.
// - **a face** — one dome with one dark hole near its top is a head with an eye, and fringing the
//   hole with torn silk only supplies eyelashes. The opening is a crescent sunk into the crown, so
//   what shows is the far inner wall of a tube rather than a closed oval.
// - **already broken** — a deep notch cut into the intact outline to separate two lobes reads as a
//   bite taken out of it, which is the one thing the *other* variant is for.
// - **a cut gemstone** — many control points at alternating radii looks like the obvious way to
//   scallop a bag and is not: the segments go straight and it comes out faceted, which is the rock
//   this must never be. Few points, wide apart, so each quadratic bows.
// - **a bowling ball** — perfect circles evenly scattered inside a smooth ring are holes punched in
//   a solid, not eggs in a skin. Hence `membraneAround`: the outline is computed *from* the clutch,
//   so the skin can only bulge where an egg is pressing it.
// - **a mouth** — an even row of triangles across a solid black interior is a cartoon jaw. The tear
//   breaks unevenly, twice into blunt flats, and the wreck is hollow and pale rather than filled.
//
// **Hatching was tried and cut.** #76 §1 allows it on a sprite this large and this is one of only
// two with the room, but both forms failed at real size: contour-following strokes read as a snail
// shell, and straight parallel ink read as a barber pole, then — once thinned to a band — as a bite
// out of the outline. What replaced it is what the era actually used: solid shapes with a hard
// terminator, and a contour that swells on the shaded side. See `nest.review.md`.
//
// Coordinates are written in a 96-unit design space so the numbers read as the drawing. Buildings
// get axis-aligned integer edges; a sac is the one thing in the set that should not, so its
// contours are free curves and carry their anti-aliasing (which is not to be "fixed" — README.md).

type Pt = readonly [number, number];
type Egg = readonly [number, number, number, number, number]; // x, y, rx, ry, tilt

const DESIGN = 96;
const INTACT = 0;

const INK = "#000";
const PAPER = "#fff";
const CONTOUR = 2.2;
const RIM = 1.6;
const SILK = 1.7; // below ~1.5 a stroke is a grey smear at real size, not a line
const HALO = 2.4; // pale separator that keeps crowded eggs from fusing into one blob
const SWELL_PASSES = 3;
const SWELL_STEP = 0.85;

// The brood. Unequal and overlapping, because a real clutch crowds — evenly spaced circles of one
// size are dice pips. Ordered back to front: each egg's pale halo cuts into the ones already down.
//
// Piled rather than packed. One egg ringed by the rest at a constant gap is a rosette, and a
// rosette reads as a flower, a molecule diagram, or a blackberry — it is also the loudest possible
// "an algorithm placed these". So the gaps run from touching to wide and the mass leans low-left.
const CLUTCH_CENTRE: Pt = [46, 60];
const EGGS: readonly Egg[] = [
  [30, 50, 10.5, 9.5, 0.2],
  [49, 44, 8, 8.5, -0.35],
  [64, 52, 8, 7.5, 0.45],
  [20, 63, 7, 7.5, 0.25],
  [36, 63, 9.5, 9, -0.15],
  [54, 61, 7.5, 7, 0.3],
  [27, 77, 8, 7.5, 0.5],
  [46, 76, 9, 8.5, -0.4],
  [62, 70, 6.5, 6, 0.15],
];

const MEMBRANE = 7; // the skin's thickness over the clutch
const CROWN = 16; // extra slack gathered above the brood, where the sac opens

// The way out, sunk into the crown. A dark ellipse with a paler one laid over it leaves the far
// inner wall showing as a crescent — what looking down a tube gives you, and what a closed oval on
// the front of a dome never will. It is also the sprite's visible top surface, so both variants are
// seen from the same slightly-above elevation.
//
// It is drawn *under* the clutch, so the topmost eggs cover its near edge and are seen through it.
// Floated clear of them it stops being a hole in the bag and becomes a handle on a basket.
const VENT: Pt = [46, 34];
const VENT_RX = 13;
const VENT_RY = 7;
const VENT_LIP: Pt = [46, 36.4];

// Silk lying flat on the floor. Drawn before the puddle, which buries the inner half of every
// strand, so what shows is a short splayed stub and never a leg. Unequal on purpose, and ending in
// nothing: a blob on the end of a thin line is a pin, and four pins round a splat are legs again.
const SILK_STRANDS: readonly (readonly [Pt, Pt])[] = [
  [
    [28, 87],
    [10, 91],
  ],
  [
    [64, 88],
    [86, 91],
  ],
  [
    [38, 90],
    [23, 94],
  ],
];

// Flat and low. A tall splat swallows the bottom of the sac, and with the bottom contour goes the
// whole read of the thing standing on a floor. The wreck's has a tongue running out past its own
// footprint on one side — what a ruptured sac leaks, and the one thing on it that spills.
const PUDDLE_LOBES = [1.01, 0.95, 1.04, 0.93, 0.98, 1.05, 0.94, 1];
const SPILL_LOBES = [0.97, 0.93, 1.02, 1.1, 1.22, 1.01, 0.95, 1];

// The wreck's torn edge. Eight breaks whose rises run 11, 3, 12, 10, 4, 13, 6, 14 — nothing
// repeats, and two of them are near-flat rather than teeth. An even amplitude at an even period is
// not a fracture, it is a row of teeth, and a row of teeth over a dark mound is a grin.
const TEAR: readonly Pt[] = [
  [13, 52],
  [21, 63],
  [31, 60],
  [38, 48],
  [47, 58],
  [56, 54],
  [64, 41],
  [73, 47],
  [80, 33],
];

const WRECK_WALL: readonly Pt[] = [
  [87, 44],
  [88, 64],
  [80, 82],
  [62, 92],
  [40, 91],
  [22, 84],
  [12, 70],
  [13, 52],
];

// The broken shell has thickness, shown by the wreck's whole outline shrunk a little and stroked
// inside itself. Offsetting only the torn edge downward is the obvious way and it self-crosses
// wherever a break is steeper than it is wide, which encloses a stray triangle.
const WALL_CENTRE: Pt = [48, 62];
const WALL_INSET = 0.88;

// What is left inside, as one solid shape with a hard terminator — the era's own way of shading,
// and the reason the wreck is not filled black to its rim. Its top edge falls steadily to one side
// rather than dipping in the middle: a dark mound that rises at both ends is a smile.
const RESIDUE: readonly Pt[] = [
  [15, 72],
  [29, 71],
  [44, 76],
  [59, 81],
  [74, 85],
  [72, 90],
  [50, 91],
  [30, 89],
  [17, 82],
];

// Eggs that survived the wreck. Without these the two variants share nothing but the floor. Very
// unequal and at different heights — a matched pair sitting level above a dark bar is two eyes over
// a mouth. Both straddle the residue's edge rather than sitting inside it: an egg landed wholly on
// the ink has its pale halo close into a ring, and a ring is a doughnut, or another eye.
const CLINGING: readonly Egg[] = [
  [31, 73, 7, 6.5, 0.2],
  [66, 78, 4.5, 4, -0.3],
];

// Membrane peeled off the torn side and left hanging. One, not two: a pair sits symmetrically and
// puts the bowl back.
// It overlaps the wall it tore off, because a shard drawn clear of the shell is not a shard — at
// real size it is a stray mark beside the sprite.
const FLAP: readonly Pt[] = [
  [14, 50],
  [6, 56],
  [5, 70],
  [12, 78],
  [20, 68],
  [22, 56],
];

const nest: SpriteSubject = {
  name: "nest",
  size: DESIGN,
  facings: 2,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.save();
    ctx.scale(size / DESIGN, size / DESIGN);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (facing === INTACT) drawIntact(ctx);
    else drawDestroyed(ctx);
    ctx.restore();
  },
};

function drawIntact(ctx: CanvasRenderingContext2D): void {
  const outline = membraneAround(CLUTCH_CENTRE, EGGS, MEMBRANE, CROWN);
  const shell = () => closedCurve(ctx, outline);

  ctx.strokeStyle = INK;
  ctx.lineWidth = SILK;
  for (const [from, to] of SILK_STRANDS) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }

  ctx.fillStyle = PAPER;
  ctx.beginPath();
  shell();
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  shell();
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(VENT[0], VENT[1], VENT_RX, VENT_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = RIM;
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(VENT_LIP[0], VENT_LIP[1], VENT_RX - 1.2, VENT_RY - 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (const egg of EGGS) haloedEgg(ctx, egg);

  inkContour(ctx, shell);
  puddle(ctx, 33, PUDDLE_LOBES);
}

function drawDestroyed(ctx: CanvasRenderingContext2D): void {
  // The floor keeps the live sac's own silk, snapped back to stubs. That shared anchoring is what
  // makes the wreck the same object rather than a second prop that happens to be nearby.
  ctx.strokeStyle = INK;
  ctx.lineWidth = SILK;
  for (const [from, to] of SILK_STRANDS) {
    ctx.beginPath();
    ctx.moveTo((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }

  ctx.fillStyle = PAPER;
  ctx.beginPath();
  closedCurve(ctx, FLAP);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = CONTOUR;
  ctx.stroke();

  const wreck = () => {
    polyline(ctx, TEAR);
    openCurve(ctx, WRECK_WALL);
    ctx.closePath();
  };

  ctx.fillStyle = PAPER;
  ctx.beginPath();
  wreck();
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  wreck();
  ctx.clip();

  ctx.strokeStyle = INK;
  ctx.lineWidth = RIM;
  ctx.save();
  ctx.translate(WALL_CENTRE[0], WALL_CENTRE[1]);
  ctx.scale(WALL_INSET, WALL_INSET);
  ctx.translate(-WALL_CENTRE[0], -WALL_CENTRE[1]);
  ctx.beginPath();
  wreck();
  ctx.restore();
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.beginPath();
  closedCurve(ctx, RESIDUE);
  ctx.fill();

  for (const egg of CLINGING) haloedEgg(ctx, egg);
  ctx.restore();

  inkContour(ctx, wreck);
  puddle(ctx, 35, SPILL_LOBES);
}

// The sac's outline is the clutch's own outline pushed out by the membrane's thickness, so the skin
// bulges exactly where an egg presses against it. A contour drawn independently of the contents is
// what turns this into a ball with holes in it. The margin widens toward the top, which gathers the
// bag into a pale crown above the brood — the slack the sac opens through.
function membraneAround(
  centre: Pt,
  eggs: readonly Egg[],
  margin: number,
  crown: number,
  // Even, so one sample lands square on the top and the crown's slack is gathered centrally
  // rather than swelling onto one shoulder as a handle. Few and wide apart, so each quadratic bows
  // instead of running straight and faceting the bag.
  samples = 12,
): Pt[] {
  return Array.from({ length: samples }, (_, i) => {
    const angle = (i / samples) * Math.PI * 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let reach = 0;
    for (const [x, y, rx, ry] of eggs) {
      const r = (rx + ry) / 2;
      const dx = x - centre[0];
      const dy = y - centre[1];
      const off = Math.abs(dx * uy - dy * ux);
      if (off >= r) continue;
      reach = Math.max(reach, dx * ux + dy * uy + Math.sqrt(r * r - off * off));
    }
    const slack = margin + crown * Math.max(0, -uy) ** 1.5;
    return [centre[0] + ux * (reach + slack), centre[1] + uy * (reach + slack)] as Pt;
  });
}

// Pale first, ink second: the halo is struck into whatever is already down, then covered on this
// egg's own side. It is what lets the clutch crowd and overlap without fusing into one black mass.
function haloedEgg(ctx: CanvasRenderingContext2D, [x, y, rx, ry, tilt]: Egg): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, tilt, 0, Math.PI * 2);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = HALO;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fill();
}

// Rubber-hose ink swells at a curve's belly and thins away from it; one uniform width reads as CAD
// linework. Offset passes thicken the side the light falls away from and taper by themselves where
// the contour turns parallel to the offset, which no clipped band does.
//
// They are clipped to the *outside* of the shape. Unclipped, the side where the offset points
// inward lays a second stroke across the pale fill, which reads as a doubled contour that starts
// and ends against nothing.
function inkContour(ctx: CanvasRenderingContext2D, shape: () => void): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = CONTOUR;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, DESIGN, DESIGN);
  shape();
  ctx.clip("evenodd");
  for (let i = 1; i < SWELL_PASSES; i++) {
    ctx.save();
    ctx.translate(i * SWELL_STEP, i * SWELL_STEP);
    ctx.beginPath();
    shape();
    ctx.restore(); // the path is already in user space; stroke it at an unscaled width
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  shape();
  ctx.stroke();
}

// Drawn last and lapping over the base, so the sac sits *in* it rather than on it. Lumpy rather
// than elliptical: a splat with two matching ends reads as a pair of feet.
function puddle(ctx: CanvasRenderingContext2D, rx: number, lobes: readonly number[]): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  closedCurve(ctx, lobedRing([48, 90.5], rx, 4.2, lobes));
  ctx.fill();
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
}

function lobedRing(centre: Pt, rx: number, ry: number, lobes: readonly number[]): Pt[] {
  return lobes.map((lobe, i) => {
    const angle = (i / lobes.length) * Math.PI * 2;
    return [centre[0] + Math.cos(angle) * rx * lobe, centre[1] + Math.sin(angle) * ry * lobe] as Pt;
  });
}

// Smooth closed loop through the midpoints of consecutive points, each point acting as a control.
// The cheapest way to close an organic contour without hand-solving beziers.
function closedCurve(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  const n = pts.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [sx, sy] = mid(pts[n - 1], pts[0]);
  ctx.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [nx, ny] = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], nx, ny);
  }
  ctx.closePath();
}

// The open form, continuing from wherever the path already is and landing on the last point.
function openCurve(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const [lx, ly] = pts[pts.length - 1];
  ctx.lineTo(lx, ly);
}

export default nest;
