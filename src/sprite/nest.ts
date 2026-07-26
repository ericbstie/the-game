import type { SpriteSubject } from "./sheet";

// The egg sac — the enemy nest — in elevation, standing on the floor and anchored at the bottom
// centre of its 96px box so it overlaps whatever is behind it.
//
// The two states ride the `facing` axis and there is no animation: waves arrive unannounced, so a
// sac has no charging frame to draw (#76 §5). What the two states have to survive is being read
// side by side on a white floor with no colour and no text, so the difference is carried three
// ways at once — the silhouette loses its top, the mass slumps outward, and the *value* inverts:
// intact is a pale sac holding solid ink eggs, destroyed is a pale shell around a solid ink cavity
// holding pale broken ones. The wreck stays on the field next to live sacs, so a glance has to
// separate them.
//
// The tear is deliberately **asymmetric**, one shoulder still standing. A sac torn evenly across
// reads as a bowl; a sac torn off to one side reads as damage.
//
// Two things this sprite must not become, both found by looking at it rather than by reasoning:
// silk drawn as long taut lines from the flanks to the floor reads as **legs**, so the silk lies
// flat and short on the floor instead; and shading drawn as inset copies of the contour reads as a
// **spiral**, so it is straight parallel ink. This is the largest sprite in the set, which is the
// one place #76 §1 allows hatching at all.
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
const CONTOUR = 3;
const FLAP_CONTOUR = 2.2;
const SILK = 1.4;
const HATCH = 1;
const HATCH_STEP = 5.5;

// The intact sac: a lumpy mass narrowing to a torn opening, off-symmetric and unevenly lobed so it
// reads as grown rather than generated. Points are controls, not vertices — the curve runs through
// their midpoints.
const SHELL: readonly Pt[] = [
  [45, 6],
  [58, 10],
  [66, 20],
  [62, 30],
  [76, 34],
  [87, 50],
  [79, 61],
  [85, 74],
  [70, 89],
  [48, 94],
  [28, 88],
  [13, 73],
  [20, 60],
  [11, 49],
  [22, 32],
  [33, 29],
  [28, 17],
  [34, 8],
];

// The clutch, seen through the sac wall. Solid ink, deliberately uneven in size and spaced rather
// than overlapping: merged eggs read as one blob, and a blob is what makes a sac look like a rock.
const EGGS: readonly Egg[] = [
  [46, 68, 11.5, 11, -0.2],
  [30, 51, 9.5, 8.5, 0.35],
  [55, 46, 7.5, 8, -0.4],
  [67, 60, 8, 8.5, 0.15],
  [27, 73, 6.5, 6, -0.5],
  [63, 79, 5.5, 5, 0.3],
];

// The way out, as radius multipliers round an ellipse. A hole is the cue no rock and no bush has —
// but a lone dark oval on a pale dome reads as an *eye*, so it is torn well off round and fringed
// with the silk it broke through.
const MOUTH: Pt = [45.5, 17];
const MOUTH_LOBES = [1.14, 0.83, 1.05, 0.76, 1.18, 0.88, 0.98, 1.09];
const FRINGE: readonly (readonly [Pt, Pt])[] = [
  [
    [37, 13],
    [33, 7],
  ],
  [
    [43, 11],
    [42, 4],
  ],
  [
    [50, 11],
    [53, 5],
  ],
  [
    [55, 15],
    [61, 12],
  ],
  [
    [39, 22],
    [34, 25],
  ],
];

// Silk lying flat on the floor round the base. Drawn before the contact shadow, which buries the
// inner half of every strand, so what shows is a short splayed stub and never a leg.
const SILK_STRANDS: readonly (readonly [Pt, Pt])[] = [
  [
    [24, 84],
    [6, 90],
  ],
  [
    [28, 90],
    [12, 93],
  ],
  [
    [72, 85],
    [90, 90],
  ],
  [
    [68, 90],
    [84, 93],
  ],
];

// The destroyed sac: the same belly slumped wider and lower, its left shoulder torn away entirely
// and its right one left standing.
const TEAR: readonly Pt[] = [
  [15, 52],
  [21, 61],
  [27, 53],
  [33, 63],
  [40, 56],
  [46, 66],
  [52, 58],
  [58, 64],
  [64, 49],
  [69, 55],
  [73, 38],
];

const WRECK_WALL: readonly Pt[] = [
  [84, 50],
  [87, 66],
  [82, 82],
  [69, 91],
  [48, 94],
  [27, 90],
  [13, 78],
  [10, 57],
];

// The cavity is the tear's own teeth pushed down and inward, so the shell reads as a wall with
// thickness rather than as a black shape sitting inside a pale one.
const CAVITY_TEAR: readonly Pt[] = TEAR.map(([x, y]) => [48 + (x - 48) * 0.88, y + 8] as Pt);

const CAVITY_WALL: readonly Pt[] = [
  [80, 54],
  [83, 67],
  [78, 81],
  [67, 87],
  [48, 89],
  [29, 86],
  [17, 76],
  [15, 58],
];

// Membrane peeled back off the tear — one long flap hanging off the torn side, one small tab still
// clinging to the shoulder that survived.
const FLAPS: readonly (readonly Pt[])[] = [
  [
    [16, 51],
    [8, 57],
    [5, 71],
    [12, 79],
    [19, 71],
    [21, 58],
  ],
  [
    [76, 34],
    [84, 31],
    [88, 39],
    [81, 42],
    [76, 39],
  ],
];

// Broken shells in the cavity — the same clutch as the intact sac's, inverted to pale on ink.
const HUSKS: readonly (readonly Pt[])[] = [
  [
    [34, 80],
    [41, 76],
    [44, 83],
    [36, 86],
  ],
  [
    [50, 77],
    [58, 74],
    [59, 82],
    [51, 84],
  ],
  [
    [60, 83],
    [66, 81],
    [65, 87],
    [59, 86],
  ],
];

// Shell thrown clear, lying on the floor outside the sac's own shadow.
const DEBRIS: readonly (readonly Pt[])[] = [
  [
    [4, 85],
    [11, 82],
    [13, 88],
    [6, 90],
  ],
  [
    [86, 79],
    [93, 82],
    [91, 88],
    [84, 86],
  ],
];

// Guy silk snapped: the floor keeps an anchored stub, the sac keeps a curled loose end, and the
// gap between them is the damage.
const SNAPPED: readonly (readonly [Pt, Pt, Pt])[] = [
  [
    [14, 70],
    [7, 76],
    [11, 82],
  ],
  [
    [87, 68],
    [93, 74],
    [89, 80],
  ],
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
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = SILK;
  for (const [from, to] of SILK_STRANDS) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(to[0], to[1], 2, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  groundShadow(ctx, 34);

  const shell = () => closedCurve(ctx, SHELL);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  shell();
  ctx.fill();

  // Shade on the flank away from the light, drawn under the eggs so they stay solid ink and no
  // hatching ever crosses one.
  hatch(ctx, shell, [
    [54, 24],
    [96, 24],
    [96, 96],
    [32, 96],
  ]);

  ctx.fillStyle = INK;
  for (const [x, y, rx, ry, tilt] of EGGS) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, tilt, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  closedCurve(ctx, lobedRing(MOUTH, 9, 5.5, MOUTH_LOBES));
  ctx.fill();

  ctx.strokeStyle = INK;
  ctx.lineWidth = SILK;
  for (const [from, to] of FRINGE) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }

  ctx.lineWidth = CONTOUR;
  ctx.beginPath();
  shell();
  ctx.stroke();
}

function drawDestroyed(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = SILK;
  for (const [from, bend, to] of SNAPPED) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.quadraticCurveTo(bend[0], bend[1], to[0], to[1]);
    ctx.stroke();
  }
  for (const shard of DEBRIS) {
    ctx.beginPath();
    polyline(ctx, shard);
    ctx.closePath();
    ctx.fill();
  }

  groundShadow(ctx, 36);

  for (const flap of FLAPS) {
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    closedCurve(ctx, flap);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = FLAP_CONTOUR;
    ctx.stroke();
  }

  const wreck = () => {
    polyline(ctx, TEAR);
    openCurve(ctx, WRECK_WALL);
    ctx.lineTo(TEAR[0][0], TEAR[0][1]);
    ctx.closePath();
  };

  ctx.fillStyle = PAPER;
  ctx.beginPath();
  wreck();
  ctx.fill();

  hatch(ctx, wreck, [
    [58, 40],
    [96, 40],
    [96, 96],
    [38, 96],
  ]);

  ctx.fillStyle = INK;
  ctx.beginPath();
  polyline(ctx, CAVITY_TEAR);
  openCurve(ctx, CAVITY_WALL);
  ctx.lineTo(CAVITY_TEAR[0][0], CAVITY_TEAR[0][1]);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PAPER;
  for (const shell of HUSKS) {
    ctx.beginPath();
    polyline(ctx, shell);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = CONTOUR;
  ctx.beginPath();
  wreck();
  ctx.stroke();
}

// A contact shadow rather than a cast one: the sac sits *on* the floor (#76 §2), so the ink spreads
// round its base instead of being thrown to one side.
function groundShadow(ctx: CanvasRenderingContext2D, rx: number): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(48, 89.5, rx, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Straight parallel ink at 45°, clipped to the shape and then to its shaded flank. Contour-following
// strokes were tried first and read as a spiral shell rather than as shading.
function hatch(ctx: CanvasRenderingContext2D, shape: () => void, wedge: readonly Pt[]): void {
  ctx.save();
  ctx.beginPath();
  shape();
  ctx.clip();
  ctx.beginPath();
  polyline(ctx, wedge);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.lineWidth = HATCH;
  ctx.beginPath();
  for (let d = -DESIGN; d <= DESIGN * 2; d += HATCH_STEP) {
    ctx.moveTo(d, DESIGN);
    ctx.lineTo(d + DESIGN, 0);
  }
  ctx.stroke();
  ctx.restore();
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
