import type { SpriteSubject } from "./sheet";

// The miner: the machine that stands on a metal-ore patch and pulls it into the shared bank. Drawn
// in elevation, in a box that is exactly its 2×2 footprint at TILE 15, anchored at the bottom
// centre so it stands on its tiles and overlaps whatever is behind it.
//
// It is a pithead: a winding wheel carried on a splayed headframe over the engine house that drives
// it. The headframe is the point. A wheel on its own sat on the roof like a decal and read as a
// knob on a stove; carried on legs that reach the ground it reads as structure, and the tapering
// A-silhouette is the one shape in the set that is neither the wall's rectangle nor the turret's
// dome. At 30 px the silhouette is the whole of what a player gets.
//
// The ink is arranged around one fact about where this thing stands: the ore under it is drawn in
// pure ink, so on its own tile every black mark is at risk and only white survives. So the mass is
// black and the *counterspace* carries the identity — the wheel's bore, the gap between the legs,
// the edge along the deck, the mouth the ore comes out of. Each is irregular and none is a framed
// rectangle, which is what the wall already is. A white keyline runs outside every ink mass for the
// same reason.
//
// Weights are deliberately unequal — keyline 1, brace 2, wheel rim 3, legs 3 to 4 as they splay —
// because one width everywhere reads as draughtsmanship rather than as ink.
//
// Every edge that can be axis-aligned is, on integer coordinates: those fills carry no
// anti-aliasing at all (#77), the one advantage a building has over a character at this size. The
// wheel, the arch and the splayed legs are the parts that must curve or lean, and their softness is
// resolution rather than a mistake to correct.

const SIZE = 30;

const INK = "#000";
const PAPER = "#fff";

const KEYLINE = 1; // white, outside every ink mass, so ore ink cannot eat into the silhouette

// The engine house. Solid, not a frame: a black outline round a white panel is what the wall is,
// and at 30 px on a dark tile the two collapse into the same mark.
const HOUSE = { x: 2, y: 19, w: 26, h: 9, shoulder: 3 };
// The edge where the top surface meets the front face. It stops well short of the right end: run
// full width it is a band through a plinth, which is what the turret's base already is, and the
// two collapse into each other below the waist.
const DECK = { x: 4, y: 21, w: 13, h: 2 };
const MOUTH = { x: 18, y: 22, w: 8, h: 4, arch: 3.5 }; // the ore comes out here, above a threshold

// The headframe: two legs splaying as they descend, a brace across them, and the wheel at the head.
// The legs run a long way — a short pair reads as one block under the wheel, and a ring on a block
// is a padlock.
const HEAD_Y = 9;
const FOOT_Y = 20;
const LEG_LEFT = { top: [5, 7.5], foot: [3, 5.5] };
const LEG_RIGHT = { top: [12.5, 15], foot: [15, 18] };
const BRACE = { x: 6, y: 15, w: 8, h: 2 };

// The strut that leans back off the head to the ground: the one line that makes a pithead a pithead
// rather than a ring on a stand, and the thing that keeps the whole silhouette off the vertical
// axis of symmetry the wall and the turret both sit on.
const STRUT = [
  [12, 11],
  [15.5, 11],
  [26, 20],
  [22.5, 20],
];

// A thick ring with one large bore and an axle straight across it. Radial spokes were tried and
// measured: three at this radius fill in solid at real size and read as a badge when they show. The
// axle is one axis-aligned bar, so it is the one part of the wheel that costs no anti-aliasing —
// and without it the ring is an eyelet rather than a sheave.
const WHEEL = { x: 10, y: 7, r: 5, bore: 3 };
const AXLE = { x: 6, y: 6, w: 8, h: 2 };

const miner: SpriteSubject = {
  name: "miner",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx) {
    headframe(ctx);
    engineHouse(ctx);
  },
};

function headframe(ctx: CanvasRenderingContext2D): void {
  inked(ctx, () => polygon(ctx, STRUT));
  inked(ctx, () => leg(ctx, LEG_LEFT));
  inked(ctx, () => leg(ctx, LEG_RIGHT));

  // No keyline on the brace: it lives between the legs, where there is no ore to hide it, and a
  // keyline there would open a white seam and float it off the structure it is bracing.
  ctx.fillStyle = INK;
  ctx.fillRect(BRACE.x, BRACE.y, BRACE.w, BRACE.h);

  // The wheel goes on last, so its bore stays a clean circle: legs drawn over it fill the bore in
  // and the whole head reads as a padlock shackle.
  inked(ctx, () => ring(ctx, WHEEL.x, WHEEL.y, WHEEL.r));
  ctx.fillStyle = PAPER;
  ring(ctx, WHEEL.x, WHEEL.y, WHEEL.bore);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(AXLE.x, AXLE.y, AXLE.w, AXLE.h);
}

function engineHouse(ctx: CanvasRenderingContext2D): void {
  inked(ctx, () => housing(ctx, HOUSE));

  ctx.fillStyle = PAPER;
  ctx.fillRect(DECK.x, DECK.y, DECK.w, DECK.h);
  ctx.beginPath();
  ctx.roundRect(MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, [MOUTH.arch, MOUTH.arch, 0, 0]);
  ctx.fill();
}

// Fill a shape in ink and lay the white keyline around it in one pass: stroking the same path in
// paper first widens it by exactly `KEYLINE` on every side, and the ink fill takes the inside half
// of that stroke back.
function inked(ctx: CanvasRenderingContext2D, path: () => void): void {
  path();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 2 * KEYLINE;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fill();
}

function leg(
  ctx: CanvasRenderingContext2D,
  { top, foot }: { top: number[]; foot: number[] },
): void {
  polygon(ctx, [
    [top[0], HEAD_Y],
    [top[1], HEAD_Y],
    [foot[1], FOOT_Y],
    [foot[0], FOOT_Y],
  ]);
}

function polygon(ctx: CanvasRenderingContext2D, points: number[][]): void {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

function housing(ctx: CanvasRenderingContext2D, box: typeof HOUSE): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, [box.shoulder, box.shoulder, 0, 0]);
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export default miner;
