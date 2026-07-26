import type { SpriteSubject } from "./sheet";

// The miner: the machine that stands on a metal-ore patch and pulls it into the shared bank. Drawn
// in elevation — the top surface and the front face are both visible, split by the front-top edge —
// inside a box that is exactly its 2×2 footprint at TILE 15, anchored at the bottom centre so it
// stands on its tiles and overlaps whatever is behind it.
//
// The body is white paper inside a heavy ink contour rather than an ink mass, because it stands on
// ore drawn in pure ink: a solid shape sinks into the patch it is mining, a white one is punched
// out of it. The marks that identify it are all silhouette — a stack and a hopper breaking the
// roofline, a driving wheel on the face — because at 30 px a silhouette is all there is.
//
// Every edge that can be axis-aligned is, on integer coordinates: those fills carry no
// anti-aliasing at all (#77), which is the one advantage a building has over a character at this
// size. The hopper's flanks and the wheel curve, and their softness is resolution rather than a
// mistake to correct.

const SIZE = 30;

const INK = "#000";
const PAPER = "#fff";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CONTOUR = 2;
const BODY: Box = { x: 1, y: 9, w: 28, h: 20 };
const SHOULDER = 4; // the top corners are cast and round; the bottom stays square, on the floor
const FRONT_EDGE_Y = 14; // the top surface ends here and the front face begins

const STACK_LIP: Box = { x: 3, y: 1, w: 8, h: 3 };
const STACK_PIPE: Box = { x: 5, y: 3, w: 4, h: 7 };

// The hopper the ore goes into, breaking the roofline opposite the stack: the one mark that says
// this machine swallows what it stands on.
const HOPPER = { top: 2, mouth: { x: 14, w: 12 }, throat: { x: 18, w: 4 }, base: 10 };

const WHEEL = { x: 9, y: 21, r: 5, hub: 2 };
const CHUTE: Box = { x: 18, y: 23, w: 8, h: 4 };

const miner: SpriteSubject = {
  name: "miner",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx) {
    ctx.fillStyle = INK;
    fillBox(ctx, STACK_LIP);
    fillBox(ctx, STACK_PIPE);
    hopper(ctx);
    shell(ctx, BODY, SHOULDER);

    ctx.fillStyle = PAPER;
    shell(ctx, inset(BODY, CONTOUR), SHOULDER - CONTOUR);

    ctx.fillStyle = INK;
    fillBox(ctx, { x: BODY.x, y: FRONT_EDGE_Y, w: BODY.w, h: CONTOUR });
    disc(ctx, WHEEL.x, WHEEL.y, WHEEL.r);
    fillBox(ctx, CHUTE);

    ctx.fillStyle = PAPER;
    disc(ctx, WHEEL.x, WHEEL.y, WHEEL.hub);
  },
};

function hopper(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(HOPPER.mouth.x, HOPPER.top);
  ctx.lineTo(HOPPER.mouth.x + HOPPER.mouth.w, HOPPER.top);
  ctx.lineTo(HOPPER.throat.x + HOPPER.throat.w, HOPPER.base);
  ctx.lineTo(HOPPER.throat.x, HOPPER.base);
  ctx.closePath();
  ctx.fill();
}

function shell(ctx: CanvasRenderingContext2D, box: Box, shoulder: number): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, [shoulder, shoulder, 0, 0]);
  ctx.fill();
}

function fillBox(ctx: CanvasRenderingContext2D, box: Box): void {
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function inset(box: Box, by: number): Box {
  return { x: box.x + by, y: box.y + by, w: box.w - 2 * by, h: box.h - 2 * by };
}

export default miner;
