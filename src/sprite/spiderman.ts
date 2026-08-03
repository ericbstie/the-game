import type { SpriteSubject } from "./sheet";

// The spiderman (#137): the one that comes at you in diagonal dashes and then bursts cobweb all
// round itself. It is the fourth creature in the set and the third drawn in pure ink, so the whole
// job is a silhouette a player can name while a grunt and an elite are on the same screen.
//
// **Its two behaviours are the drawing.**
//
// - **The burst is the bristle.** Seven stout ink spines stand out of the abdomen on every bearing
//   at once, and that burr is what makes this creature nameable at 32 px. The web itself cannot be
//   drawn here — it is an event that leaves nothing behind, and the spiderman survives its own
//   (#137) — so what the sprite carries is the animal that throws it, spiked outward in all
//   directions. Every other mass in the game is smooth; this one is not, and that is the whole tell.
// - **The dash is angled off the straight line**, so the creature is angled off its own: the body
//   is thrown out to one side, and the legs on that side brace wide while the other side gathers
//   under it — a drift, held. Every other creature in the set is symmetric about its heading. This
//   is the only oblique silhouette in the game.
//
// **How it is told apart from the other three, which is the whole task.**
//
// | | mass | limbs | axis |
// | --- | --- | --- | --- |
// | grunt | a dot | eight long wires, wide and low | symmetric |
// | elite | a huge two-lobed carcass, low, in a 48 box | eight short and thick | symmetric |
// | bloodling | a round sack over a body — purple and green | six short and clawed | symmetric |
// | this | **a spiked burr**, humped over the legs | eight, mid-weight | **oblique** |
//
// **The body is one path, not two masses.** Two ellipses were tried first and they fused: at 32 px a
// head and an abdomen each large enough to read are each large enough to touch the other, and what
// came out was a lump. So the body is one arced spine filled at a width hand-cut along its length,
// which puts a small head lobe at the front and the big abdomen behind it under a single contour and
// no interior line. **The pinch between them is a waist on paper and not on screen** — at this size
// the two lobes are closer together than the sum of their radii, so the union closes over it. It is
// kept because it shapes the outline; it is not a mark a player will see, and nothing here depends
// on it.
//
// **The ore floor set the weight.** Measured on a dense metal patch, a grunt's 1.3–1.7 px legs
// disappear into the stipple almost entirely while the elite's mass survives it, so a purely wiry
// drawing at 32 px is one a player cannot find when it matters. The ink here is carried by the
// humped body; the legs are mid-weight, between the grunt's wires and the elite's posts.
//
// The projection is the hybrid #76 fixes for spiders: **the body is upright**, seen head-on, while
// **everything that says where the creature points lies flat**, seen from above — the ring of feet,
// the reach of each leg, and the bearing the abdomen is swung out along. They all turn on the one
// flattened plan, so none of them can disagree about the heading.
//
// **There is no face, and that follows the bloodling's arithmetic rather than the spiders'.** The
// two spiders wear paper eyes because each is one black mass wide enough to hold a pair — the
// elite's head is 14 px inside a 48 px box. The widest this head lobe gets is 7, which puts an eye
// at two or three device pixels, and at that size a paper round on a black curve is the specular
// highlight nothing else in this game has. The front is marked by the two raised forelimbs instead,
// in silhouette, which is what survives at real size.

// **32 is an assumption, not a derivation.** Every other box in `SPRITE_BOX` comes off a radius the
// simulation already fixes, and this kind's `STATS` entry does not exist yet — #137 leaves the radius
// to whoever writes it. Drawn against the grunt's class, `GRUNT_RADIUS * 2`, because that is what
// "a spider that dashes at you" is beside a grunt and an elite. If the radius lands somewhere else,
// this number moves with it and the drawing is composed in whatever box it names.
const SIZE = 32;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S with the forelimbs reaching at the player, 4 = W, 6 = N showing the humped abdomen.
const heading = (facing: number) => (facing / FACINGS) * 360;

const INK = "#000000";

// Enemies are blitted **centred** on their position, not stood on it (`draw.ts` `blitOver`), so the
// flat ring of feet is the floor contact: it sits near the middle of the box and the body rises
// out of it.
const FLOOR = { x: 16, y: 20.4 };

// How much of a plan-space offset survives into screen y.
const PLAN = 0.56;

// **The drift, in one number.** The abdomen is swung this far off the line the creature is running
// down, to one fixed side. It cannot alternate: a facing is a compass bearing and carries no memory
// of which way the last dash was angled, so the drawing commits to one lean and holds it.
// Provisional — a number only a played match can judge.
const SWING = 38;

// The two ends of the body, on the plan and above it. The head end barely leaves the plan origin
// and the abdomen end is mostly *lift* rather than reach, because a body built out of plan offsets
// alone collapses to nothing in the facings that point at or away from the viewer — there the two
// ends foreshorten toward each other and the animal becomes a disc.
const NOSE = { reach: 4.6, lift: 2.2 };
const TAIL = { reach: 7.2, lift: 6.8 };

// The abdomen rides a shallower plan than the legs. It still swings between near and far as the
// creature turns, which is a heading signal and is kept; at the full plan it costs so much headroom
// in the facings that carry it away from the viewer that the bristle leaves the box.
const TAIL_PLAN = 0.34;

// **The body arches, and that is what stops the drawing growing a second head.** A first cut reared
// the abdomen straight up on a stalk, and every eye reads the topmost lump on a creature as its
// head: at facing 2 — walking *at* the player — the tail sat at the top of the box and the animal
// read as walking away. So the body is an arc instead. It leaves the jaws low and forward, humps
// over the abdomen and comes back *down* behind, which puts the widest part of the mass at the top
// of every silhouette, where the eye will read it as a body and not as a face.
//
// The arch is also what keeps the creature from collapsing in the facings that run at or away from
// the viewer, where the two ends foreshorten toward each other and a straight body would be a disc.
const CREST = 6.8; // how far above the chord between the two ends the arc is pulled
const CREST_AT = 0.6; // and where along it, so the hump sits over the abdomen and not the waist
const ABDOMEN_AT = 0.66; // where along the body the abdomen is widest, and so where the bristle seats

// The body's width down its own length: how far along the spine, and the full width there. Hand-cut
// — a head lobe, the pinch of a waist, and the abdomen that carries the bristle.
const BODY: [at: number, width: number][] = [
  [0, 2.2],
  [0.12, 6.4],
  [0.22, 7.0],
  [0.36, 3.2],
  [0.52, 9.0],
  [0.66, 10.0],
  [0.86, 5.8],
  [1, 2.0],
];

// **The bristle: the burst, standing still.** Seven stout ink spines radiate from the abdomen in
// every direction, and they are the single mark that makes this creature nameable at 32 px. A smooth
// mass is what the elite and the bloodling both are; a burr is not, and no amount of tuning a smooth
// outline was going to separate the three. It is also the only honest way to draw *bursts cobweb all
// round itself* on a creature that survives its own burst: the web is an event with nothing left
// behind (#137), so what the sprite can carry is the animal that throws it, spiked outward on every
// bearing at once.
//
// Seven, because an odd count has no rotation that comes out mirror-symmetric, and stout because a
// spine thinner than about a logical pixel is an intermittent grey smear at real size. Their lengths
// are uneven on purpose — an even fringe is a gear, not an animal.
const SPINES = [4.4, 3.4, 4.0, 3.2, 4.3, 3.6, 3.8];
const SPINE_W = 0.95; // half-width where it leaves the mass
const SPINE_ROOT = 0.5; // how far in from the outline it starts, so the two fills meet with no seam
// Held in the abdomen's own frame, so the bristle travels with the mass rather than crawling round
// it as the creature turns — the lesson the bloodling's sack records.
const SPINE_PHASE = 0.42;

const HIP_R = 2.6;
const HIP_LIFT = 4.0; // the hip starts up inside the body, so the two fills meet with no seam

// Mid-weight: heavier than a grunt's 1.7 → 1.3 wires, lighter than the posts an elite carries. A
// leg thinner than about a logical pixel is an intermittent grey smear at real size.
const LEG_HIP_W = 2.5;
const LEG_TIP_W = 1.5;
const LEG_BELLY = 0.18; // a hose swells at the belly of its curve, but only just

interface Leg {
  spread: number; // degrees off the heading
  reach: number;
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  hook: number; // and degrees the foot hooks back from it
  knee: number; // how high the arch peaks
  lift: number; // how far the tip is held off the floor — nonzero only for the forelimbs
  drive: boolean; // which half of the bound this limb takes
}

// One side of the creature, front to back. The forelimb comes first and is the only one that never
// touches the ground: it is thrown forward at whatever the spiderman is running at, and it is what
// marks the front now that the face is gone.
//
// The arch peaks hard and close in. A grunt's leg is a long low bow that reads as stilts; this one
// is a steep tent, which is what a crouch looks like from above.
const LEGS: Leg[] = [
  { spread: 26, reach: 12.2, bow: 7, hook: -8, knee: 6.8, lift: 3.6, drive: false },
  { spread: 68, reach: 12.6, bow: 15, hook: -10, knee: 4.8, lift: 0, drive: true },
  { spread: 114, reach: 12.8, bow: -13, hook: 12, knee: 5.0, lift: 0, drive: false },
  { spread: 158, reach: 11.6, bow: -20, hook: 18, knee: 4.2, lift: 0, drive: true },
];

// **The asymmetry is structural, not sprinkled.** The other three sprites carry a hand's worth of
// per-leg slop to break the mirror symmetry that gives a generated drawing away. Here the creature
// is genuinely lopsided because it is drifting: the side the tail swung out to braces — legs opened
// wider and planted further out, carrying the turn — and the other side gathers under the body.
const BRACE_REACH = 1.08;
const BRACE_SPREAD = 8;
const GATHER_REACH = 0.88;
const GATHER_SPREAD = -6;

// The bound, in two frames. Frame 0 is where the cycle parks whenever an enemy is not moving (#81),
// so it is the frame most often on screen and it is the **loaded** one: legs gathered under the
// body, forelimbs drawn back and high, abdomen at its steepest. Frame 1 is the launch.
//
// The two poses move **against each other** rather than together. A first cut that dropped every
// mass by a pixel read, to an eye that had not been told, as legs flickering under a body that never
// moved — the bloodling records the same finding. So the nose goes forward and down while the tail
// swings back and drops less, which straightens the animal out; and the forelimbs throw forward as
// the driving legs push back.
const STRIDE = 16; // degrees a driving leg carries fore or aft
const NOSE_PITCH = { reach: 2.0, lift: 1.5 };
const TAIL_UNCOCK = { reach: 1.8, lift: 2.6 };
const FORE_THROW = 1.1; // the forelimbs reach this much further in the launch
const FORE_DROP = 1.8; // and come this much nearer the floor

interface Point {
  x: number;
  y: number;
}

const spiderman: SpriteSubject = {
  name: "spiderman",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const bearing = heading(facing);
    const launch = frame === 1 ? 1 : 0;

    ctx.fillStyle = INK;

    for (const leg of LEGS) {
      drawLimb(ctx, bearing, leg, false, launch);
      drawLimb(ctx, bearing, leg, true, launch);
    }

    const nose = at(
      bearing,
      NOSE.reach + NOSE_PITCH.reach * launch,
      NOSE.lift - NOSE_PITCH.lift * launch,
    );
    const tail = at(
      bearing + 180 + SWING,
      TAIL.reach + TAIL_UNCOCK.reach * launch,
      TAIL.lift - TAIL_UNCOCK.lift * launch,
      TAIL_PLAN,
    );
    drawBody(ctx, nose, tail);
  },
};

// A point on the flattened plan, lifted clear of it. One function, so the feet, the reach of a
// forelimb and the bearing the body is swung out along cannot drift apart.
function at(bearingDeg: number, radius: number, height: number, plan = PLAN): Point {
  const a = bearingDeg * DEG;
  return {
    x: FLOOR.x + Math.cos(a) * radius,
    y: FLOOR.y + Math.sin(a) * radius * plan - height,
  };
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

const BODY_STEPS = 48;

// The body: one arced spine, filled as the **union of the discs swept along it**, radius read off
// `BODY` at each step.
//
// A union rather than an offset outline, and that is not a style choice. The first cut walked the
// spine and pushed a pair of points out either side, which is what the legs do — but a leg is thin
// against its own curvature and this body is not. Where the arch bends hardest the half-width
// exceeds the radius of curvature, so the inner edge folds through itself and fills the concavity,
// and the outline that came out was a slab with a bite taken out of one side. A swept disc cannot
// fold, and it rounds both ends for nothing.
function drawBody(ctx: CanvasRenderingContext2D, nose: Point, tail: Point): void {
  const control = {
    x: nose.x + (tail.x - nose.x) * CREST_AT,
    y: nose.y + (tail.y - nose.y) * CREST_AT - CREST,
  };

  ctx.beginPath();
  for (let i = 0; i <= BODY_STEPS; i++) {
    const t = i / BODY_STEPS;
    const u = 1 - t;
    const x = u * u * nose.x + 2 * u * t * control.x + t * t * tail.x;
    const y = u * u * nose.y + 2 * u * t * control.y + t * t * tail.y;
    const r = widthAt(t) / 2;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();

  const u = 1 - ABDOMEN_AT;
  const seat = {
    x: u * u * nose.x + 2 * u * ABDOMEN_AT * control.x + ABDOMEN_AT * ABDOMEN_AT * tail.x,
    y: u * u * nose.y + 2 * u * ABDOMEN_AT * control.y + ABDOMEN_AT * ABDOMEN_AT * tail.y,
  };
  drawBristle(ctx, seat, widthAt(ABDOMEN_AT) / 2, unit(nose, tail));
}

function widthAt(t: number): number {
  for (let i = 1; i < BODY.length; i++) {
    const [to, wide] = BODY[i];
    if (t > to) continue;
    const [from, thin] = BODY[i - 1];
    return thin + (wide - thin) * ((t - from) / (to - from));
  }
  return BODY[BODY.length - 1][1];
}

// The spines, struck outward from the abdomen's middle: each starts inside the fill and ends clear
// of the outline, so it is a spike *on* the mass rather than a whisker beside it.
function drawBristle(
  ctx: CanvasRenderingContext2D,
  seat: Point,
  radius: number,
  along: Point,
): void {
  const turn = Math.atan2(along.y, along.x) + SPINE_PHASE;
  for (let i = 0; i < SPINES.length; i++) {
    const a = turn + (i / SPINES.length) * TAU;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const from = { x: seat.x + cos * radius * SPINE_ROOT, y: seat.y + sin * radius * SPINE_ROOT };
    const to = { x: seat.x + cos * (radius + SPINES[i]), y: seat.y + sin * (radius + SPINES[i]) };
    ctx.beginPath();
    ctx.moveTo(from.x - sin * SPINE_W, from.y + cos * SPINE_W);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(from.x + sin * SPINE_W, from.y - cos * SPINE_W);
    ctx.closePath();
    ctx.fill();
  }
}

function drawLimb(
  ctx: CanvasRenderingContext2D,
  bearing: number,
  leg: Leg,
  mirrored: boolean,
  launch: number,
): void {
  const side = mirrored ? -1 : 1;
  // The tail swings out to the positive bearing, so that is the braced side and its mirror gathers.
  const braced = !mirrored;
  const spread = leg.spread * side + (braced ? BRACE_SPREAD : GATHER_SPREAD) * side;
  const bow = leg.bow * side;
  const hook = leg.hook * side;

  // A stride is fore-and-aft, so it opens or closes the angle to the heading. Rotating both sides
  // the same way would walk the creature sideways. Mirroring flips which half of the bound a limb
  // takes, which is the alternating gait a spider actually runs on.
  const drives = mirrored ? !leg.drive : leg.drive;
  const phase = drives ? launch * 2 - 1 : 1 - launch * 2;
  const swing = side * STRIDE * phase * (leg.lift > 0 ? 0.5 : 1);

  const thrown = leg.lift > 0 ? 1 + (FORE_THROW - 1) * launch : 1 + 0.07 * phase;
  const reach = leg.reach * (braced ? BRACE_REACH : GATHER_REACH) * thrown;
  const tipLift = Math.max(leg.lift - FORE_DROP * launch, 0) + (drives ? 0 : 0.9 * (1 - launch));

  const kneeAngle = bearing + spread + bow + swing * 0.4;
  const knee = leg.knee + (leg.lift > 0 ? 0 : 0.8 * Math.max(phase, 0));

  const hip = at(bearing + spread, HIP_R, HIP_LIFT);
  const rise = at((bearing + spread + kneeAngle) / 2, reach * 0.24, knee * 0.72);
  const peak = at(kneeAngle, reach * 0.56, knee);
  const tip = at(bearing + spread + bow + hook + swing, reach, tipLift);

  hose(ctx, hip, rise, peak, tip);
}

const CURVE_STEPS = 16;

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

// A rubber hose that thins toward the tip. Stroking would give a constant-width tube with a blunt
// end, which at this size reads as a tentacle rather than a leg — the taper is the whole
// difference, so the hose is filled as a shape instead.
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

export default spiderman;
