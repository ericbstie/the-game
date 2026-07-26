import type { SpriteSubject } from "./sheet";

// The grunt: a spider exaggerated into legs. Its sibling the elite is exaggerated the other way,
// into a body, and in a black-and-white game the silhouette is the only thing that separates them
// — so the leg span here is four times the body's width, deliberately.
//
// The projection is the hybrid #76 fixes for spiders: the **body and face are upright**, seen
// head-on, while the **legs splay flat around them**, seen from above. Each leg leaves the body's
// base, arches over a knee, and lands flat on a wide ring of feet. That rise and fall is what joins
// the two viewpoints into one creature, and the height of the arch is what says *long legs* at a
// size too small to count them.

const SIZE = 32;
const FACINGS = 8;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const INK = "#000000";
const PAPER = "#ffffff";

// Where the creature meets the floor: the plan origin the legs radiate from. Low in the box,
// because the sprite is anchored at the feet.
const FLOOR_X = SIZE / 2;
const FLOOR_Y = 19.5;

// A true circular splay of long legs cannot fit beside an upright body in 32 px, so the plan is
// squashed toward the horizon. Enough to fit; little enough that the ring of feet still reads as a
// ring rather than a line.
const FLATTEN = 0.78;

const BODY_RX = 3.4;
const BODY_RY = 3.8;
const BODY_LIFT = 1.3; // the body's base rides above the leg plane — the hybrid, in one number
const BODY_BOB = 1; // frame 1 rides a pixel higher, so the whole creature moves and not just its feet

// Heights above the floor plane, not screen offsets: the hip is the body's underside and the knee
// is the top of the arch a leg makes on its way out to its foot.
const HIP_R = 2.8;
const HIP_LIFT = 3.2; // high enough that every hip starts *inside* the body, leaving no seam
const KNEE_LIFT = 4.2;
const KNEE_KICK = 1.0; // a swinging leg in frame 1 picks its knee up this much further
// A leg running up or down the screen is already stretched by the plan squash; arching it as well
// folds it into a hairpin that pinches a white hole against the body — and a white hole beside the
// eye reads as another eye. So the arch is spent on the legs that run across the screen, where it
// is the thing that says *long legs*, and withheld from the ones that do not.
const KNEE_FLAT = 0.34; // the arch a leg keeps when it points straight at or away from the viewer

// A rubber hose is not a constant-width pipe: it swells at the belly of its curve and tapers to
// the tip. Constant width is what reads as a tentacle, and as machine linework rather than ink.
// The tip stays above a whole logical pixel — thinner than that is not a fine stroke, it is an
// intermittent grey smear at real size.
const LEG_HIP_W = 1.7;
const LEG_FOOT_W = 1.3;
const LEG_BELLY = 0.34; // half-width added at the middle of the curve
const FOOT_RX = 0.95;
const FOOT_RY = 0.8;

// The eyes ride a ring around the body's axis, so a facing turns them instead of moving them: the
// far one narrows to a slit as it goes round, and the three back views end up blank on their own
// rather than by special case.
const EYE_AZIMUTH = 42; // degrees each eye sits off the facing direction
const EYE_RING = 2.2;
const EYE_RX = 1.05;
const EYE_RY = 1.25;
const EYE_RISE = 0.5; // above the body's centre
const EYE_EDGE = 0.45; // ink kept between an eye and the body's contour
const EYE_HORIZON = -0.62; // how far past side-on the far eye of a pair keeps peeking
const EYE_SLIT = 0.42; // narrowest an eye gets before it goes round the back
const FACE_HORIZON = -0.2; // the head itself turns away here, and takes both eyes with it

// Frame 0 is the settled stance the walk cycle parks on whenever a grunt is not moving (#81), and
// enemies stand still constantly, so it is the frame most often on screen: feet planted at their
// neutral reach, knees all at one height, the body low. Frame 1 is the other half of the stride —
// half the legs swing forward, lifting and gathering in, the other half push back and extend.
//
// Frame 0 still carries a *little* of the counter-stride. Parking it dead even would make the two
// frames a symmetric open-and-close of the whole fan, which reads as the creature inflating rather
// than walking; the phase offset is what makes a scuttle read. It is small enough that the stance
// still settles, and it costs the perfect mirror symmetry that gives a drawing away as generated.
const STRIDE = 11; // degrees a swinging leg carries fore or aft
const REST_STAGGER = 0.36; // how much of the counter-stride the standing frame keeps
const GATHER = 0.91; // a lifted foot is pulled in toward the body
const PUSH = 1.03; // a planted foot pushes out

interface Leg {
  spread: number; // degrees off the facing direction
  reach: number; // to the foot, from the plan origin
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  tip: number; // degrees the foot hooks back from the knee
  lead: boolean; // which half of the gait
  // How much of the stride this pair takes. The front pair does the walking and the back pair
  // barely moves, as a spider's does — and it keeps a gathered back leg from arching in far enough
  // to close a white pocket against the body, which at this size reads as a third eye.
  carry: number;
  // What the mirrored copy of this leg does *differently*. An exact mirror is the tell of a
  // generated drawing, and frame 0 — the stance a stopped grunt holds, the frame most often on
  // screen — would otherwise be perfectly symmetrical. A hand's worth of slop instead.
  skew: number; // degrees the mirrored leg sits off its reflection
  slack: number; // and how much longer or shorter it is
}

// One side of the creature, front to back. The other side is that mirrored, with its gait halves
// swapped — which gives the alternating tetrapod a real spider walks, four feet down at all times,
// and is the cheapest thing that still reads as a scuttle in two frames.
const LEGS: Leg[] = [
  { spread: 40, reach: 14.0, bow: 15, tip: -8, lead: true, carry: 1, skew: 4, slack: 0.96 },
  { spread: 78, reach: 13.4, bow: 13, tip: -10, lead: false, carry: 0.95, skew: -3, slack: 1.02 },
  { spread: 118, reach: 12.6, bow: -13, tip: 12, lead: true, carry: 0.8, skew: 5, slack: 0.955 },
  { spread: 154, reach: 11.6, bow: -18, tip: 18, lead: false, carry: 0.5, skew: -4, slack: 1.04 },
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
    const half = (wide + (thin - wide) * t) / 2 + LEG_BELLY * Math.sin(Math.PI * t);
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
  const spread = leg.spread * side + (mirrored ? leg.skew : 0);
  const bow = leg.bow * side;
  const tip = leg.tip * side;
  const lead = mirrored ? !leg.lead : leg.lead;
  const span = mirrored ? leg.reach * leg.slack : leg.reach;

  // A stride is fore-and-aft, so it closes or opens the angle to the facing axis. Rotating both
  // sides the same way would walk the creature sideways.
  const phase = frame === 0 ? -REST_STAGGER : 1;
  const swing = side * (lead ? -STRIDE : STRIDE) * leg.carry * phase;
  const stretch = 1 + ((lead ? GATHER : PUSH) - 1) * leg.carry * Math.max(phase, 0);
  const reach = span * stretch;
  const knee = KNEE_LIFT + (frame === 1 && lead ? KNEE_KICK * leg.carry : 0);

  const kneeAngle = heading + spread + bow + swing * 0.35;
  const across = Math.abs(Math.cos(kneeAngle * DEG));
  const arch = knee * (KNEE_FLAT + (1 - KNEE_FLAT) * across);

  const p0 = floorPoint(HIP_R, heading + spread, HIP_LIFT + bob);
  const p1 = floorPoint(reach * 0.4, (heading + spread + kneeAngle) / 2, arch * 0.85 + bob);
  const p2 = floorPoint(reach * 0.97, kneeAngle, arch);
  const p3 = floorPoint(reach * 0.95, heading + spread + bow + tip + swing, 0);

  hose(ctx, p0, p1, p2, p3, LEG_HIP_W, LEG_FOOT_W);

  ctx.beginPath();
  ctx.ellipse(p3.x, p3.y, FOOT_RX, FOOT_RY, 0, 0, TAU);
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, heading: number, bodyY: number): void {
  // The face is drawn as a pair or not at all. A lone eye surviving into the rear-quarter views
  // makes a grunt walking away look like one staring at you, and one white dot on a black body
  // reads as a hole rather than as a face — so the head turning away takes both eyes with it.
  if (Math.sin(heading * DEG) < FACE_HORIZON) return;

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
