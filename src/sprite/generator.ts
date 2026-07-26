import type { SpriteSubject } from "./sheet";

// The power plant: 5×5 tiles at TILE 15, the largest building in the game, and the only building
// drawn **flat, straight down** (#76 §2, #81). The miner, wall and turret are elevation — top
// surface and front face both visible — and stand up into the Y-sorted layer. This one paints
// underneath it, with the floor and the ore, which is also why it is drawn as openly as it is:
// every point of ink here competes with the ore's glow and with the characters standing on it.
//
// Projection is read semantically, not geometrically. Early drafts were flat by construction — no
// front face, no shadow, no tilt — and still read as standing up, because each was built around a
// **wheel seen face-on**, and a wheel is a thing everybody knows faces sideways. Drawing one square
// to the viewer says "you are looking at its front", whatever the geometry does.
//
// So the subject is a **generator set in plan**, one shaft running left to right: cylinder, crank,
// flywheel, shaft, dynamo. Everything mounted on that shaft is broadside to the viewer, so it
// projects as a **bar or a capsule, never a disc** — which is both what fixes the projection and
// what keeps a face-on wheel from creeping back in. Nothing here is a circle except the gauge,
// whose axis really does point up out of the deck.
//
// Two later reads drove the rest of it. The set alone was called *an appliance control panel*, so
// there is now **pipework**: a tube leaving the cylinder, turning two elbows and ending at a flange.
// A pipe is unmistakable from above, it is what a plant is full of, and it is the one part that says
// this thing is plumbed into something. And a wide capsule centred under two round-ish things read
// as **a cartoon face** — two eyes, a nose, a mouth — so the masses are now a single asymmetric
// train across the top with the pipe run beneath, which has no face in it.
//
// The deck is **not filled**. The generator stands on power ore, the one thing in the game drawn in
// red (#76 §1), and an opaque plate would punch a hole in that glow; the ore comes up through the
// gaps in the screen instead, and only the machinery is solid white. The screen is the halftone #76
// reserves for large structures — round dots on a 45° lattice, which reads as tone. Square dots on
// the 0° grid this was tried on first read as perforated mesh, and sat ready to moiré against any
// change of scale or density.

const SIZE = 75;
const AXIS = 22; // the shaft line, high on the deck so the pipe run has the width beneath it

const INK = "#000";
const PAPER = "#fff";

// The thin end of the range. Every contour is modulated off this, and none of it is drawn at one
// width: a constant-weight outline reads as CAD linework whatever it is drawn around, and two
// separate reviews called this drawing a vector icon before the range was opened up this far.
const MASS_CONTOUR = 2.4;
const SWELL_NEAR = 1.2; // the lit side of a form, barely thickened
const SWELL_FAR = 3.6; // and the far side, at two and a half times the thin end
const SWELL_FROM = 0.15;
const SWELL_TO = 0.85;

const PLATE_CONTOUR = 3;
const PLATE_CORNER = 10;
const DETAIL_LINE = 2;
const RIB = 1.8;

const PIPE_BORE = 7.5;
const PIPE_WALL = 2.2; // drawn as a tube — two walls with the deck showing between them, not a bar

const TINT_INSET = 7;
const TINT_CORNER = 7;
const TINT_PITCH = 5; // rows at half the pitch, alternate rows offset by half — a 45° screen
const TINT_DOT = 0.9;
const CLEARANCE = 1.8; // white margin held around every piece of linework

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

// Long capsules, not the near-square hollow rectangles this started with — those read as windows in
// a panel. Barrel proportions are what make them read as machinery, and the two are deliberately
// different lengths so they cannot pair off as a matched set of panel furniture.
const CYLINDER: Box = { x: 5, y: AXIS - 9, w: 28, h: 18, r: 9 };
const CRANK: Box = { x: 31, y: AXIS - 2, w: 8, h: 4, r: 2 };
const WHEEL: Box = { x: 38, y: AXIS - 15, w: 8, h: 30, r: 4 };
const SHAFT: Box = { x: 45, y: AXIS - 2, w: 7, h: 4, r: 2 };
const DYNAMO: Box = { x: 50, y: AXIS - 8, w: 19, h: 16, r: 8 };
const FLANGE: Box = { x: 50, y: 54, w: 4, h: 12, r: 2 };

const GAUGE = { x: 12, y: 46, r: 5.5 };
const RIBS = [55, 59.5, 64]; // what tells the dynamo from the cylinder at a glance
// The run hugs the bottom of the deck on purpose. Carried higher, it fenced a sliver of deck off
// below the gauge, and the screen's dots landed in it as an orphaned patch reading as stray dirt
// rather than as one continuous tone.
const PIPE: readonly (readonly [number, number])[] = [
  [12, 31],
  [12, 60],
  [50, 60],
];

const MASSES: readonly Box[] = [CYLINDER, WHEEL, DYNAMO, FLANGE];

function roundedRect(ctx: CanvasRenderingContext2D, box: Box): void {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  ctx.beginPath();
  ctx.moveTo(box.x + box.r, box.y);
  ctx.arcTo(right, box.y, right, bottom, box.r);
  ctx.arcTo(right, bottom, box.x, bottom, box.r);
  ctx.arcTo(box.x, bottom, box.x, box.y, box.r);
  ctx.arcTo(box.x, box.y, right, box.y, box.r);
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function pipePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  PIPE.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

// Distance from a point to a rounded rect's straight core, which is within `radius` exactly when the
// point is inside it. Padding a rounded rect leaves the core alone and only grows the radius, so one
// test answers both questions asked of the screen: is this dot on the deck, and is it too near a
// piece of linework to be drawn. Dots are placed by that test rather than clipped or painted over,
// because both of those leave part-dots and half-alpha crumbs that read as dirt at real size.
function withinRounded(x: number, y: number, box: Box, pad = 0): boolean {
  const dx = Math.max(box.x + box.r - x, 0, x - (box.x + box.w - box.r));
  const dy = Math.max(box.y + box.r - y, 0, y - (box.y + box.h - box.r));
  return dx * dx + dy * dy <= (box.r + pad) * (box.r + pad);
}

function swell(ctx: CanvasRenderingContext2D, box: Box, vertical: boolean): void {
  const span = vertical ? box.h : box.w;
  const start = vertical ? box.y : box.x;
  const from = start + span * SWELL_FROM;
  const to = start + span * SWELL_TO;
  const edges = vertical ? [box.x, box.x + box.w] : [box.y, box.y + box.h];
  ctx.strokeStyle = INK;
  edges.forEach((edge, side) => {
    ctx.lineWidth = MASS_CONTOUR + (side === 0 ? SWELL_NEAR : SWELL_FAR);
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(edge, from);
      ctx.lineTo(edge, to);
    } else {
      ctx.moveTo(from, edge);
      ctx.lineTo(to, edge);
    }
    ctx.stroke();
  });
}

const generator: SpriteSubject = {
  name: "generator",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const deck: Box = {
      x: TINT_INSET,
      y: TINT_INSET,
      w: size - 2 * TINT_INSET,
      h: size - 2 * TINT_INSET,
      r: TINT_CORNER,
    };
    // Each run is carried a half-bore past the elbow, because the stroke's round join reaches that
    // far and a box stopping at the corner leaves the outside of the bend uncovered — which the
    // screen fills with a couple of stranded dots that read as dirt.
    const bore = PIPE_BORE / 2;
    const runs: Box[] = [
      {
        x: PIPE[0][0] - bore,
        y: PIPE[0][1],
        w: PIPE_BORE,
        h: PIPE[1][1] - PIPE[0][1] + bore,
        r: bore,
      },
      {
        x: PIPE[1][0] - bore,
        y: PIPE[1][1] - bore,
        w: PIPE[2][0] - PIPE[1][0] + bore,
        h: PIPE_BORE,
        r: bore,
      },
    ];
    const keepOff = MASS_CONTOUR / 2 + CLEARANCE + TINT_DOT;
    ctx.fillStyle = INK;
    const row = TINT_PITCH / 2;
    for (let step = 0; step * row < size; step++) {
      const y = step * row;
      for (let x = (step % 2) * row; x < size; x += TINT_PITCH) {
        if (!withinRounded(x, y, deck)) continue;
        if ([...MASSES, CRANK, SHAFT, ...runs].some((b) => withinRounded(x, y, b, keepOff)))
          continue;
        if (Math.hypot(x - GAUGE.x, y - GAUGE.y) <= GAUGE.r + keepOff) continue;
        disc(ctx, x, y, TINT_DOT);
      }
    }

    // Contoured wholly inside the box, so the line keeps its full weight instead of losing half of
    // itself off the edge of the bake.
    ctx.strokeStyle = INK;
    ctx.lineWidth = PLATE_CONTOUR;
    roundedRect(ctx, {
      x: PLATE_CONTOUR / 2,
      y: PLATE_CONTOUR / 2,
      w: size - PLATE_CONTOUR,
      h: size - PLATE_CONTOUR,
      r: PLATE_CORNER - PLATE_CONTOUR / 2,
    });
    ctx.stroke();

    // Laid before the machinery, so the cylinder's own body closes the end the pipe leaves from.
    pipePath(ctx);
    ctx.lineWidth = PIPE_BORE;
    ctx.stroke();
    pipePath(ctx);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = PIPE_BORE - 2 * PIPE_WALL;
    ctx.stroke();

    ctx.fillStyle = INK;
    for (const box of [CRANK, SHAFT]) {
      roundedRect(ctx, box);
      ctx.fill();
    }

    for (const box of MASSES) {
      roundedRect(ctx, box);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = MASS_CONTOUR;
      ctx.stroke();
    }
    swell(ctx, CYLINDER, false);
    swell(ctx, DYNAMO, false);
    swell(ctx, WHEEL, true);

    ctx.lineWidth = RIB;
    for (const x of RIBS) {
      ctx.beginPath();
      ctx.moveTo(x, DYNAMO.y + 3);
      ctx.lineTo(x, DYNAMO.y + DYNAMO.h - 3);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(GAUGE.x, GAUGE.y, GAUGE.r, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = MASS_CONTOUR;
    ctx.stroke();
    ctx.lineWidth = MASS_CONTOUR + SWELL_NEAR; // a dial is small enough that the full swell closes it
    ctx.beginPath();
    ctx.arc(GAUGE.x, GAUGE.y, GAUGE.r, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.lineWidth = DETAIL_LINE;
    ctx.beginPath();
    ctx.moveTo(GAUGE.x, GAUGE.y);
    ctx.lineTo(GAUGE.x + 2.8, GAUGE.y - 2.4);
    ctx.stroke();
    ctx.fillStyle = INK;
    disc(ctx, GAUGE.x, GAUGE.y, 1.2);
  },
};

export default generator;
