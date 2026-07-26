import type { SpriteSubject } from "./sheet";

// The automated defence: a wide, low casemate with a bore sunk into its roof, drawn in elevation on
// its 2×2 footprint.
//
// #76 settled that the turret **never rotates**, so nothing on it may point anywhere in the world.
// The bore answers that by facing **up, out of the plane** — you look down into it rather than
// along it, so it reads the same whether the shot leaves left, right, or straight down the screen.
// A barrel lying in the plane would be a lie the first time it fired the other way.
//
// Four rounds of review killed the shapes before this one, and the same three mistakes kept coming
// back in new clothes. They are recorded because each is easy to make again:
//
//   1. **A cap on a stem on a foot is furniture.** As a dome, a cupola, a drum and a flared stack it
//      read as a chess pawn, a desk bell, a table lamp, a mushroom, a bandstand, a desk telephone
//      and — in a brief that asks for ink — an inkwell. Reviewers agreed the *waist* causes it, so
//      there is no narrowing anywhere here: the bore sits straight on the roof with no neck.
//   2. **White knocked out of a black mass is a pictogram, not ink.** Twice it was called out and
//      twice it returned. One grammar throughout now: white forms carrying a bold ink contour, with
//      solid black spent only on the bore ring and on the weight where the building meets the floor.
//   3. **A solid flared trapezoid is a funnel, not a gun** — an opening that widens upward reads as
//      an intake, and worse, the miner already owns that exact mark. Two 2×2 structures cannot share
//      their one distinguishing silhouette. So the gun cue is a ring you can see *into*: a bold black
//      annulus with the bore knocked out white, foreshortened because it lies in the roof plane.
//
// It is deliberately **wider than it is tall**. That is the axis the miner leaves free — the miner is
// tall, busy and asymmetric; the wall is a filled square — and it keeps the sprite's own body out of
// the way of the ink line, which is drawn from here to whatever it hit every 200 ms.
//
// Absent on purpose, because other sprites own them: the flashing lightning symbol when it is
// unpowered, and the health bar. It does not change as it is damaged either — #76 cut structure
// damage states.

const BOX = 30; // 2 tiles at TILE 15 — the footprint square, which is also the sprite's whole box

const INK = "#000";
const PAPER = "#fff";

type Point = [x: number, y: number];

// The outer silhouette. The roof plane is narrower than the front face, so the two are separated in
// the outline itself and not merely by a line drawn across a flat shape.
const CASEMATE: Point[] = [
  [6, 7],
  [24, 7],
  [29, 20],
  [29, 30],
  [1, 30],
  [1, 20],
];

// The same shape inset, which leaves a contour rather than punching a hole in a mass. It stops short
// of the floor so the ink gathers where the building stands on it.
const INTERIOR: Point[] = [
  [9, 10],
  [21, 10],
  [26, 22],
  [26, 28],
  [4, 28],
  [4, 22],
];

const turret: SpriteSubject = {
  name: "turret",
  size: BOX,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.scale(size / BOX, size / BOX);

    ctx.fillStyle = INK;
    polygon(ctx, CASEMATE);

    ctx.fillStyle = PAPER;
    polygon(ctx, INTERIOR);

    ctx.fillStyle = INK;
    ctx.fillRect(4, 21, 22, 2); // where the roof stops and the front face starts
    ctx.fillRect(7, 24, 4, 3); // a coupling on one flank, so the drawing is not a mirror of itself
    ellipse(ctx, 15, 15.5, 5.5, 3.2);

    ctx.fillStyle = PAPER;
    ellipse(ctx, 15, 15.5, 3, 1.4); // the bore itself, open to the sky
  },
};

function polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
  ctx.fill();
}

export default turret;
