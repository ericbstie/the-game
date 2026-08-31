import type { SpriteSubject } from "./sheet";

// The broodling (#138): what a Broodlord stops to birth, three at a time, at a fifth of a grunt's
// HP. The smallest drawing in the set — an 18 px box against the grunt's 32 — so the whole problem
// is that almost nothing survives at this size except the outline.
//
// It is drawn as a **hatchling**, and every proportion is that one word:
//
// - **The body is still the egg.** A tall round mass nearly as wide as the box, taller than it is
//   wide, because the thing has not yet grown into a spider's build. Where the grunt is a body
//   four times narrower than its leg span, this is a body only a third narrower — and that
//   inversion is the entire silhouette separation between the two. At 18 px a player is reading a
//   blob with stubs against a star with legs; nothing finer than that arrives.
// - **The head is too big for it**, the way a newborn's is, and it is the one mass that moves with
//   the heading.
// - **The legs are stubs.** Thick where they leave the body and short — they barely clear the
//   overhang of the mass they carry, which is what says the animal cannot yet hold itself up.
// - **The eyes are enormous.** Two paper rounds taking most of the head's width. This is the
//   strongest *young* signal available and it costs two marks, so it gets spent here rather than on
//   jaws or claws, which the broodling therefore does not have: its feet are soft unformed nubs.
//
// The projection is the hybrid #76 fixes for the creatures: the **masses are upright**, seen
// head-on, while everything that says where it is pointing — the head's offset and the ring of
// feet — lies **flat**, seen from above. The head hanging off the body on that flattened plan is
// what puts the facing into the silhouette rather than inside the fill: it swings out to the side
// in profile, drops toward the viewer in the charge, and rides up behind the body in the rear
// views, where the union leaves it as a bump over the shoulders and the face is gone.
//
// Enemies are blitted **centred** on their position rather than stood on it
// (`src/game/draw.ts` `paintEnemy`), so the ring of feet sits near the middle of the box and the
// mass rises out of it.
//
// Every number below is provisional — nothing here has been played, and the proportions are the
// only claim being made.

const SIZE = 18; // BROODLING_RADIUS * 2, fixed by the simulation (`src/game/enemies.ts:170`)
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const INK = "#000000";
const PAPER = "#ffffff";

// How much of a plan-space offset survives into screen y. The head and the ring of feet turn on
// this one plan, so they cannot disagree about the heading.
const PLAN = 0.6;

const CORE = { x: 9, y: 8.5 }; // what the masses hang off
const FLOOR = { x: 9, y: 11 }; // the centre of the ring of feet

// The head is nearly as wide as the abdomen — the proportion a hatchling has and an adult does not,
// and the only place the two eyes it needs will fit. A first cut gave the body half again the
// head's width and the drawing came out a blob: the legs never cleared the overhang, and the eyes,
// crowded onto a head six pixels across, merged into one paper ring that read as a hole punched in
// the ink rather than as a face.
const BODY = { rx: 3.9, ry: 4.7 };
const HEAD = { rx: 3.6, ry: 3.45 };
// Far enough that the head breaks the body's outline at every facing it is visible in. A head that
// stays inside the union is not a silhouette, and at this size a facing that is not in the
// silhouette is not a facing. Capped by the box rather than by taste: the two profiles put the
// head's whole diameter on one side of centre, and that sum is the widest thing the sprite draws.
const HEAD_REACH = 3.3;
// The head hangs *below* the body's waist rather than level with it. Level, the union came out an
// egg with a bump on one side; slung low it comes out a body with a head under it, and the notch
// the two masses leave above the head is what makes the front end read as a front end at 18 px.
const HEAD_DROP = 1;
const SWELL = 0.09; // the near head grows this much, the far one shrinks by it

// The outline's wobble, as a factor on each radius. At 32 px the bloodling could carry its hand in
// a twentieth of a radius; here a twentieth of four is a fifth of a pixel and is simply not drawn.
// So these run to a tenth either way — peak to trough about one logical pixel on the body, which is
// the least a wobble can be at this size and still exist rather than being a rounding error in the
// rasteriser. Odd counts, so no rotation of them comes out mirror-symmetric.
//
// The head's are shallower on the outward side only: at the two profiles the head's whole diameter
// hangs off one side of centre, and it is a lump on *that* radius that decides whether the sprite
// keeps its clearance to the edge of the box.
const BODY_LUMPS = [1, 1.09, 0.92, 1.07, 0.93, 1.085, 0.915];
const BODY_TURN = 0.4;
const HEAD_LUMPS = [1.055, 0.93, 1.07, 0.92, 1.045];
const HEAD_TURN = 1.1;

// Stubs: thick at the hip, short, and only just past the body's overhang.
const HIP_R = 2.2;
const HIP_LIFT = 3.2; // the hip starts up inside the body, so the two fills meet with no seam
const KNEE_LIFT = 2;
const LEG_HIP_W = 1.9;
const LEG_TIP_W = 1.05; // a leg thinner than a logical px is an intermittent grey smear at real size
const LEG_BELLY = 0.1;
const LEG_PLAN = 0.48; // the feet ring is flatter than the head's plan: they all have to land clear
const FOOT_RX = 0.8;
const FOOT_RY = 0.65;

// Six, not the spiders' eight. Eight stubs around a mass this round is a bristled ring in which no
// single leg is a whole pixel wide at its tip; six leaves six clear points in the outline, and at
// 18 px a player reads points rather than counting them.
interface Leg {
  spread: number; // degrees off the heading
  reach: number;
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  hook: number; // and degrees the foot hooks back from it
  tripod: boolean; // which half of the alternating gait
  // What the mirrored copy does differently. An exact mirror is the tell of a generated drawing,
  // and a creature this symmetrical would otherwise carry one down every facing that runs straight
  // at or away from the viewer. At this size the slop has to be coarse to survive at all.
  skew: number;
  slack: number;
}

const LEGS: Leg[] = [
  { spread: 42, reach: 6.35, bow: 15, hook: -10, tripod: true, skew: 5, slack: 0.93 },
  { spread: 98, reach: 6.55, bow: 4, hook: 6, tripod: false, skew: -4, slack: 1.05 },
  { spread: 152, reach: 6, bow: -13, hook: 12, tripod: true, skew: 5.5, slack: 0.94 },
];

// Neither frame is the neutral pose. The walk parks on frame 0 whenever an enemy is not moving
// (#81), but a cycle that returns to symmetry every other frame reads as a pulse rather than a
// gait, so the two sit a third and two thirds through one stride with one tripod planted in both.
const PHASE = [-0.5, 0.55];
const STRIDE = 23; // degrees a swinging leg carries fore or aft
const LIFT = 1.2; // how far a swinging foot comes off the floor
const GATHER = 0.84; // and how far it is pulled in toward the body

// The body drops onto the planted tripod while the head lags above it — relative motion, because a
// mass moved wholesale between two frames reads as no motion at all. The sway is deliberately
// larger than a grunt's share of its box: a thing this new does not walk straight, and the lurch is
// the second place after the proportions where *young* gets said.
const BOB = 0.8;
const HEAD_LAG = -0.4;
const SWAY = 0.6;

// Past here the head is turned away and the body laps over it, taking the face with it. A lone eye
// surviving into a rear quarter makes a broodling walking away look like one staring at you.
const FACE_HORIZON = -0.15;

// Most of the head's width, which is the point. They ride a ring around its axis, so a facing turns
// them rather than moving them and the far one narrows to a slit as it goes round.
// Set apart rather than made huge. Two paper rounds three quarters of a pixel apart are one paper
// round with a nick in it at dpr 1, and a single wide one is a hole punched in the ink — so the
// pair is carried further out on its ring and each eye is narrowed to pay for it. Taller than they
// are wide for the same reason: an upright oval is a shape a round hole is not.
const EYE_AZIMUTH = 44;
const EYE_RING = 2.3;
const EYE_RX = 1.2;
const EYE_RY = 1.5;
const EYE_RISE = 0.45; // above the head's centre, which leaves the head a chin
const EYE_EDGE = 0.5; // ink kept between an eye and the head's contour
const EYE_HORIZON = -0.5; // how far past side-on the far eye of a pair keeps peeking
const EYE_SLIT = 0.35; // narrowest an eye gets before it goes round the back
const EYE_ODD = 0.07; // one of the pair is inked a little larger than the other

interface Point {
  x: number;
  y: number;
}

interface Mass extends Point {
  rx: number;
  ry: number;
}

const broodling: SpriteSubject = {
  name: "broodling",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    // #73's convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
    // 2 = S with the face turned at the player, 4 = W, 6 = N showing its back.
    const theta = (facing / FACINGS) * TAU;
    const toward = Math.sin(theta); // +1 coming at the player, -1 going away
    const across = Math.cos(theta);
    const bob = frame === 0 ? 0 : BOB;
    // Across the heading, on the same flattened plan, so the lurch is a gait and not a slide.
    const lurch = (frame === 0 ? -SWAY : SWAY) / 2;
    const rock = { x: -toward * lurch, y: across * lurch * PLAN };

    const body: Mass = {
      x: CORE.x + rock.x,
      y: CORE.y + bob + rock.y,
      rx: BODY.rx,
      ry: BODY.ry,
    };
    const scale = 1 + toward * SWELL;
    const head: Mass = {
      x: CORE.x + across * HEAD_REACH + rock.x,
      y: CORE.y + toward * HEAD_REACH * PLAN + HEAD_DROP + bob * HEAD_LAG + rock.y,
      rx: HEAD.rx * scale,
      ry: HEAD.ry * scale,
    };

    ctx.fillStyle = INK;
    for (const leg of LEGS) {
      drawLeg(ctx, theta / DEG, leg, false, frame, bob);
      drawLeg(ctx, theta / DEG, leg, true, frame, bob);
    }

    // Both masses go into one path and fill once, so the nonzero rule takes their union and the
    // neck between them closes over. Drawing the head as its own mass on top would lay a closed ink
    // ring inside the fill, which in this style is interior shading — and the union has no interior
    // line to misread. It also means the two never need z-ordering: black over black is nothing,
    // and the only order that matters is that no leg crosses a paper eye.
    ctx.beginPath();
    lumpy(ctx, body, BODY_LUMPS, BODY_TURN);
    lumpy(ctx, head, HEAD_LUMPS, HEAD_TURN);
    ctx.fill();

    drawEyes(ctx, head, theta);
  },
};

// An outline of quadratics through the midpoints of jittered radial samples, so the corners round
// off into lobes instead of reading as a polygon at ten pixels across.
function lumpy(ctx: CanvasRenderingContext2D, m: Mass, lumps: number[], turn: number): void {
  const n = lumps.length;
  const at = (i: number): Point => {
    const k = ((i % n) + n) % n;
    const a = turn + k * (TAU / n);
    return { x: m.x + Math.cos(a) * m.rx * lumps[k], y: m.y + Math.sin(a) * m.ry * lumps[k] };
  };
  const mid = (i: number): Point => {
    const a = at(i);
    const b = at(i + 1);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const start = mid(-1);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const c = at(i);
    const e = mid(i);
    ctx.quadraticCurveTo(c.x, c.y, e.x, e.y);
  }
  ctx.closePath();
}

function floorPoint(radius: number, degrees: number, height: number): Point {
  const a = degrees * DEG;
  return {
    x: FLOOR.x + Math.cos(a) * radius,
    y: FLOOR.y + Math.sin(a) * radius * LEG_PLAN - height,
  };
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  bearing: number,
  leg: Leg,
  mirrored: boolean,
  frame: number,
  bob: number,
): void {
  const side = mirrored ? -1 : 1;
  const spread = leg.spread * side + (mirrored ? leg.skew : 0);
  const bow = leg.bow * side;
  const hook = leg.hook * side;
  // Mirroring flips which tripod a leg belongs to, which is the gait itself: the front and back of
  // one side swing with the middle of the other, and three feet are down at all times.
  const tripod = mirrored ? !leg.tripod : leg.tripod;
  const phase = PHASE[tripod ? frame : 1 - frame];

  // A stride is fore-and-aft, so it opens or closes the angle to the heading. Rotating both sides
  // the same way would walk the creature sideways.
  const swing = side * STRIDE * phase;
  const lifted = Math.max(phase, 0);
  const reach = leg.reach * (mirrored ? leg.slack : 1) * (1 + (GATHER - 1) * lifted);
  const kneeAngle = bearing + spread + bow + swing * 0.4;

  const hip = floorPoint(HIP_R, bearing + spread, HIP_LIFT + bob);
  const foot = floorPoint(reach, bearing + spread + bow + hook + swing, LIFT * lifted + bob * 0.4);
  const knee = floorPoint(reach * 0.6, kneeAngle, KNEE_LIFT + LIFT * lifted * 0.6 + bob);
  const rise = floorPoint(reach * 0.27, (bearing + spread + kneeAngle) / 2, KNEE_LIFT * 0.8 + bob);

  hose(ctx, hip, rise, knee, foot);

  // A soft round nub, not a claw. The bloodling forks its feet into tines because it is a grown
  // thing that grips; this one has not finished growing feet, and the blunt end is the difference.
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, FOOT_RX, FOOT_RY, 0, 0, TAU);
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, head: Mass, theta: number): void {
  // The face is a pair or it is nothing: one paper dot alone on a black mass reads as a hole rather
  // than as an eye, so the head turning away takes both with it.
  if (Math.sin(theta) < FACE_HORIZON) return;

  ctx.fillStyle = PAPER;
  const offsets = [-EYE_AZIMUTH, EYE_AZIMUTH];
  for (let i = 0; i < offsets.length; i++) {
    const a = theta + offsets[i] * DEG;
    const towardViewer = Math.sin(a); // +1 dead ahead of us, −1 turned away
    if (towardViewer <= EYE_HORIZON) continue;
    const odd = 1 + (i === 0 ? EYE_ODD : -EYE_ODD);
    const rx = EYE_RX * odd * (EYE_SLIT + (1 - EYE_SLIT) * Math.max(towardViewer, 0));
    const limit = Math.max(head.rx * 0.94 - EYE_EDGE - rx, 0);
    const x = Math.max(-limit, Math.min(limit, Math.cos(a) * EYE_RING));
    ctx.beginPath();
    ctx.ellipse(head.x + x, head.y - EYE_RISE, rx, EYE_RY * odd, 0, 0, TAU);
    ctx.fill();
  }
}

const CURVE_STEPS = 12;

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

// A rubber hose that thins toward the foot. Stroking would give a constant-width tube with a blunt
// end, which reads as a tentacle rather than a leg — the taper is the whole difference, so the hose
// is filled as a shape instead.
function hose(ctx: CanvasRenderingContext2D, p0: Point, p1: Point, p2: Point, p3: Point): void {
  const near: Point[] = [];
  const far: Point[] = [];
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const p = curveAt(p0, p1, p2, p3, t);
    const d = slopeAt(p0, p1, p2, p3, t);
    const length = Math.hypot(d.x, d.y) || 1;
    const half = (LEG_HIP_W + (LEG_TIP_W - LEG_HIP_W) * t) / 2 + LEG_BELLY * Math.sin(Math.PI * t);
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

export default broodling;
