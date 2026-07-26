import type { SpriteSubject } from "./sheet";

// The grunt: a spider exaggerated into legs. Its sibling the elite is exaggerated the other way,
// into a body, and in a black-and-white game the silhouette is the only thing that separates them
// — so the leg span here is four times the body's width, deliberately.
//
// The projection is the hybrid #76 fixes for spiders: the **body and face are upright**, seen
// head-on, while the **legs splay flat around them**, seen from above. Each leg leaves the body's
// base, arches over a knee that rises clear of the body, and lands flat on a wide ring of feet.
// That rise and fall is what joins the two viewpoints into one creature, and the height of the
// arch is what says *long legs* at a size too small to count them.

const SIZE = 32;
const FACINGS = 8;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const INK = "#000000";
const PAPER = "#ffffff";

// Where the creature meets the floor: the plan origin the legs radiate from. Low in the box,
// because the sprite is anchored at the feet.
const FLOOR_X = SIZE / 2;
const FLOOR_Y = 20.6;

// A true circular splay of long legs cannot fit beside an upright body in 32 px, so the plan is
// squashed toward the horizon. Enough to fit; little enough that the ring of feet still reads as a
// ring rather than a line.
const FLATTEN = 0.66;

const BODY_RX = 3.6;
const BODY_RY = 4.2;
const BODY_LIFT = 1; // the body's base rides above the leg plane — the hybrid, in one number
const BODY_BOB = 1; // frame 1 rides a pixel higher, so the whole creature moves and not just its feet

// Heights above the floor plane, not screen offsets: the hip is the body's underside and the knee
// is the top of the arch, so a leg pointing away from us hooks up over the body and back down.
const HIP_R = 2.4;
const HIP_LIFT = 2.2;
const KNEE_LIFT = 5.5;
const KNEE_KICK = 1.3; // a swinging leg in frame 1 picks its knee up this much further

const LEG_HIP_W = 1.95;
const LEG_FOOT_W = 1.15;
const FOOT_RX = 0.95;
const FOOT_RY = 0.62;

// The eyes ride a ring around the body's axis, so a facing turns them instead of moving them: the
// far one narrows to a slit as it goes round, and the three back views end up blank on their own
// rather than by special case.
const EYE_AZIMUTH = 38; // degrees each eye sits off the facing direction
const EYE_RING = 2.4;
const EYE_RX = 1.15;
const EYE_RY = 1.5;
const EYE_RISE = 1.1; // above the body's centre
const EYE_EDGE = 0.55; // ink kept between an eye and the body's contour
const EYE_HORIZON = -0.15; // how far past side-on an eye keeps peeking
const EYE_SLIT = 0.5; // narrowest an eye gets before it goes round the back

// Frame 0 is the settled stance the walk cycle parks on whenever a grunt is not moving (#81), and
// enemies stand still constantly — so it is drawn even, every foot at its neutral place and every
// knee at the same height. Frame 1 is the other half of the stride: half the legs swing forward,
// lifting and gathering in, while the other half push back and extend.
const STRIDE = 14; // degrees a swinging leg carries fore or aft
const GATHER = 0.84; // a lifted foot is pulled in toward the body
const PUSH = 1.04; // a planted foot pushes out

interface Leg {
  spread: number; // degrees off the facing direction
  reach: number; // to the foot, from the plan origin
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  tip: number; // degrees the foot hooks back from the knee
  lead: boolean; // which half of the gait
}

// One side of the creature, front to back. The other side is the mirror with its gait halves
// swapped, which gives the alternating tetrapod a real spider walks — four feet down at all times,
// and the cheapest thing that still reads as a scuttle in two frames.
const LEGS: Leg[] = [
  { spread: 41, reach: 13.2, bow: 17, tip: -23, lead: true },
  { spread: 81, reach: 13.4, bow: 8, tip: -9, lead: false },
  { spread: 121, reach: 12.8, bow: -9, tip: 12, lead: true },
  { spread: 156, reach: 11.4, bow: -16, tip: 19, lead: false },
];

interface Point {
  x: number;
  y: number;
}

function floorPoint(radius: number, degrees: number, height: number): Point {
  const a = degrees * DEG;
  return {
    x: FLOOR_X + Math.cos(a) * radius,
    y: FLOOR_Y + Math.sin(a) * radius * FLATTEN - height,
  };
}

const CURVE_STEPS = 18;

function curveAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function slopeAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

// A rubber hose that thins toward the foot. Stroking would give a constant-width tube with a
// blunt end, which at this size reads as a tentacle rather than a leg — the taper is the whole
// difference, so the hose is filled as a shape instead.
function hose(
  ctx: CanvasRenderingContext2D,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  wide: number,
  thin: number,
): void {
  const near: Point[] = [];
  const far: Point[] = [];
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const p = curveAt(p0, p1, p2, p3, t);
    const d = slopeAt(p0, p1, p2, p3, t);
    const length = Math.hypot(d.x, d.y) || 1;
    const half = (wide + (thin - wide) * t) / 2;
    const nx = (-d.y / length) * half;
    const ny = (d.x / length) * half;
    near.push({ x: p.x + nx, y: p.y + ny });
    far.push({ x: p.x - nx, y: p.y - ny });
  }
  ctx.beginPath();
  ctx.moveTo(near[0].x, near[0].y);
  for (let i = 1; i < near.length; i++) ctx.lineTo(near[i].x, near[i].y);
  for (let i = far.length - 1; i >= 0; i--) ctx.lineTo(far[i].x, far[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  heading: number,
  leg: Leg,
  mirrored: boolean,
  frame: number,
  bob: number,
): void {
  const side = mirrored ? -1 : 1;
  const spread = leg.spread * side;
  const bow = leg.bow * side;
  const tip = leg.tip * side;
  const lead = mirrored ? !leg.lead : leg.lead;

  // A stride is fore-and-aft, so it closes or opens the angle to the facing axis. Rotating both
  // sides the same way would walk the creature sideways.
  const swing = frame === 0 ? 0 : side * (lead ? -STRIDE : STRIDE);
  const reach = frame === 0 ? leg.reach : leg.reach * (lead ? GATHER : PUSH);
  const knee = KNEE_LIFT + (frame === 1 && lead ? KNEE_KICK : 0);

  const kneeAngle = heading + spread + bow + swing * 0.35;
  const p0 = floorPoint(HIP_R, heading + spread, HIP_LIFT + bob);
  const p1 = floorPoint(reach * 0.4, (heading + spread + kneeAngle) / 2, knee * 0.85 + bob);
  const p2 = floorPoint(reach * 0.97, kneeAngle, knee);
  const p3 = floorPoint(reach * 0.95, heading + spread + bow + tip + swing, 0);

  hose(ctx, p0, p1, p2, p3, LEG_HIP_W, LEG_FOOT_W);

  ctx.beginPath();
  ctx.ellipse(p3.x, p3.y, FOOT_RX, FOOT_RY, 0, 0, TAU);
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, heading: number, bodyY: number): void {
  ctx.fillStyle = PAPER;
  for (const offset of [-EYE_AZIMUTH, EYE_AZIMUTH]) {
    const a = (heading + offset) * DEG;
    const towardViewer = Math.sin(a); // +1 dead ahead of us, −1 turned away
    if (towardViewer <= EYE_HORIZON) continue;
    const rx = EYE_RX * (EYE_SLIT + (1 - EYE_SLIT) * Math.max(towardViewer, 0));
    const limit = BODY_RX * 0.95 - EYE_EDGE - rx;
    const x = Math.max(-limit, Math.min(limit, Math.cos(a) * EYE_RING));
    ctx.beginPath();
    ctx.ellipse(FLOOR_X + x, bodyY - EYE_RISE, rx, EYE_RY, 0, 0, TAU);
    ctx.fill();
  }
}

const grunt: SpriteSubject = {
  name: "grunt",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const heading = (facing / FACINGS) * 360;
    const bob = frame === 0 ? 0 : BODY_BOB;

    ctx.fillStyle = INK;

    for (const leg of LEGS) {
      drawLeg(ctx, heading, leg, false, frame, bob);
      drawLeg(ctx, heading, leg, true, frame, bob);
    }

    // The body goes over the hips, and the eyes over everything: black on black is invisible, so
    // the only order that matters is that no leg crosses a white eye.
    const bodyY = FLOOR_Y - BODY_LIFT - BODY_RY - bob;
    ctx.beginPath();
    ctx.ellipse(FLOOR_X, bodyY, BODY_RX, BODY_RY, 0, 0, TAU);
    ctx.fill();

    drawEyes(ctx, heading, bodyY);
  },
};

export default grunt;
