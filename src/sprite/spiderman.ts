import type { SpriteSubject } from "./sheet";

// The spiderman (#137): the one that comes at you in slanted dashes and, once it is near enough,
// bursts cobweb all round itself. It is the fourth creature in the set and the third drawn in pure
// ink, so the whole job is a silhouette a player can name while grunts and elites are on the same
// screen.
//
// **What it is: a long-bodied hunter with two raised grappling arms.** A heavy pear of an abdomen
// trailing behind, a small low head end in front, a pinched waist between them, and above all a
// **pair of thick hooked forelimbs** thrown out ahead of the body and held clear of the floor. The
// six walking legs are short and tucked in under the mass. Every mark on it is a rubber hose of
// varying thickness — nothing here is a spike, a spatter or a point.
//
// **The burst cannot be drawn, so the drawing is the arms.** The web is an event that leaves nothing
// behind and the creature survives its own (#137), so a baked sprite can only ever carry *the animal
// that throws it*. A first attempt drew that animal as a burr — stout spines standing off the
// abdomen on every bearing — reasoning that a burst standing still is a bristle. It read as an ink
// blot, because **radiating black points is already this game's language for impact**: the lettering
// bursts, the death puffs, the torn edges on ore. A creature drawn in the effects alphabet is a
// legibility bug. So the thing that says *it throws* is anatomy instead: an animal built to reach
// past its own body, with grappling arms it holds up and forward and a silk-heavy abdomen behind.
//
// **How it is told apart from the other three, which is the whole task.**
//
// | | mass | limbs | outline |
// | --- | --- | --- | --- |
// | grunt | a dot | eight long thin wires on a wide open ring | a sparse radiating star |
// | elite | a huge two-lobed carcass in a 48 box | eight short posts | one heavy blob, low and wide |
// | bloodling | a round sack over a body — purple and green | six short clawed | a coloured circle |
// | this | **a pear with a waist**, long and directional | **two big hooked arms, held up and forward**, over six short tucked legs | **a closed comma with two hooks off the front** |
//
// The grunt is the hard pair and it is the one this drawing is composed against: same 32 px box,
// same pure ink, no colour and no readable face at either. Three separators, all in silhouette:
//
// - **Density.** A grunt is mostly white — a dot on wires. This is mostly ink: one contiguous body
//   carries the middle of the box, and the legs are short enough to stay under it.
// - **Span.** A grunt's ring of feet is about 28 px across inside a 32 px box. This one's is about
//   21, and the only things reaching further are the two arms, which reach *forward* and not
//   sideways.
// - **Where the ink points.** A grunt radiates evenly on every bearing and has no direction in its
//   outline. This one is an arrow: heavy behind, narrow in front, two hooks off the front corner.
//
// **The facing is carried by the outline, not by a face.** There is none to spend — the head lobe
// tops out about 7 px, which puts an eye at two or three device pixels, and a paper round that size
// on a black curve is the specular highlight nothing else in this game has (the bloodling's
// arithmetic, and it lands the same way here). So the eight bearings are one shape rotating, and
// three things turn together on one flattened plan to make that read:
//
// - **The two lobes trade places**, the near one drawn low and the far one high, exactly as the
//   elite's do. Coming at you the head end hangs low and forward off a high abdomen; going away, the
//   abdomen is the near mass and drops, and the head end is a small bump above it. The pair is never
//   level, because the waist rides higher than either lobe and both fall away from it by different
//   amounts.
// - **The tail points.** The abdomen is a pear whose tip runs back along the plan, so the body is a
//   comma that swings round the box as the creature turns — long across the screen, foreshortened
//   into a stack coming at you or leaving.
// - **The arms lead.** They are the longest thing on the animal and they always reach along the
//   heading, so whichever way it is going, two hooks stand out of the front of the silhouette.
//
// **The lean is structural, and its sign is the sim's.** A spiderman never runs at what it is
// chasing: `dashPoint` turns its heading off the bearing to its target by `DASH_ANGLE`, always the
// same way round (`game/enemies.ts:99` and `:1153`), so the player is permanently off to one side of
// where it is going. The drawing agrees — the fore end is cranked toward that side while the abdomen
// trails down the line of travel, and the legs on the outside of the drift brace wide while the
// inside ones gather. It is the only oblique creature in the game.
//
// **The projection is the hybrid #76 fixes for the spiders.** The masses are upright, seen head-on;
// everything that says where the creature points — the lobes' swing, the ring of feet, the arms'
// reach — lies flat on one flattened plan, so none of them can disagree about the heading.
//
// **Weight, measured.** On a dense metal-ore patch a grunt's 1.3–1.7 px legs all but vanish into the
// stipple at dpr 1 while the elite's mass survives it. Nothing here is drawn thinner than a grunt's
// hip: the arms run 3.4 → 2.0 and the walking legs 2.6 → 1.6, between the grunt's wires and the
// elite's posts. The blind review of the burr version complained about shape and never about
// weight, so that finding is kept.

const SIZE = 32;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const INK = "#000000";

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S coming at the player, 4 = W, 6 = N going away.
const bearingOf = (facing: number) => (facing / FACINGS) * 360;

// Enemies are blitted **centred** on their position, not stood on it (`draw.ts` `blitOver`): the
// flat ring of feet is the floor contact, so it sits near the middle of the box and the body rises
// out of it.
const FLOOR = { x: 16, y: 20.6 };

// How much of a plan-space offset survives into screen y.
const PLAN = 0.46;

// **The drift, in degrees.** The fore end is cranked this far off the line the creature is running
// down, toward the side its target sits on. One fixed side and never the other: a facing index is a
// compass bearing and carries no memory of which way the last dash leaned, and `DASH_ANGLE` is one
// fixed sign for exactly the same reason. Provisional — a number only a played match can judge.
const LEAN = 16;

// The body, as two lobes swept out of one waist. Heights are above the ring of feet; reaches are
// along the plan.
//
// The waist rides highest and both lobes fall away from it — the head end forward and well below,
// the abdomen back and a little above. That difference is what stops the two lobes going level in
// the facings that run straight at or away from the viewer, where the plan offsets foreshorten to
// nothing and a body built out of plan alone collapses into a disc.
const WAIST_RIDE = 7.4;
const HEAD_DROP = 3.6; // the head end's height below the waist
const TAIL_RISE = 1.6; // and the abdomen tip's above it
const HEAD_REACH = 8.6;
const TAIL_REACH = 10.4;
const NECK = 2; // the width at the waist, and the pinch that makes the body two masses

// Width down each lobe, from the waist outward: `[how far along, how wide there]`. Hand-cut — a
// small blunt head in front, and behind it a pear that carries most of the creature's ink and comes
// to a point. The point is the silk end, and it is the cheapest thing that makes the outline an
// arrow rather than an ellipse.
const HEAD_SHAPE: [at: number, wide: number][] = [
  [0, NECK],
  [0.5, 6.2],
  [0.8, 5.4],
  [1, 2.4],
];
const TAIL_SHAPE: [at: number, wide: number][] = [
  [0, NECK],
  [0.42, 9.6],
  [0.74, 8.4],
  [1, 1.6],
];

// The near lobe grows this much as the creature turns toward the viewer and the far one shrinks by
// it, which is the last of the depth cue once the plan has foreshortened.
const SWELL = 0.07;

// **The arms: the two marks that name this creature.** They leave the shoulders, bow out wide over a
// raised elbow, come back in past the head end and finish in a hook that curls toward the other arm.
// The pair encloses white paper between them, which is the one counter in this silhouette and the
// thing that makes them read as *grasping* rather than as two more limbs.
//
// They are separated from the walking legs by four things at once: half again as long, a third
// thicker, held clear of the floor at every point, and taking no part in the gait. The arch is
// spent clearing the ring of feet and never the body — an arm that towers over the abdomen makes
// the top of the silhouette point away from the heading, which is exactly backwards in the facings
// that run at the viewer.
const ARM_SPREAD = 24; // degrees each arm sits off the fore end's own bearing
const ARM_BOW = 14; // and how much further out the elbow swings before the reach comes back in
const ARM_HOOK_IN = 16; // degrees the wrist gathers back toward the creature's own line
const ARM_REACH = 14.2;
const ARM_ELBOW_AT = 0.5; // how far out along the arm the elbow sits
const ARM_ELBOW_RISE = 5.4; // and how high it is carried above the plan
const ARM_TIP_LIFT = 1.8; // the hook is held this far off the floor
const ARM_SHOULDER = 3.2; // where the arm leaves the body, inside the fill so the two meet with no seam
const ARM_W = [3.4, 3, 2.1]; // shoulder, elbow, wrist
const HOOK_LEN = 3.4;
const HOOK_TURN = 74; // degrees the hook curls off the direction the arm was already going
const HOOK_W = 1.8;

const HIP_R = 2.4;
const HIP_LIFT = 5.2; // the hip starts up inside the body, so the two fills meet with no seam
const LEG_W = [2.6, 2.4, 1.6]; // hip, knee, foot — between a grunt's wires and an elite's posts

interface Leg {
  spread: number; // degrees off the heading
  reach: number;
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  hook: number; // and degrees the foot hooks back from it
  arch: number; // how high the knee is carried
  tripod: boolean; // which half of the alternating gait
  // What the mirrored copy does differently. An exact mirror is the tell of a generated drawing, and
  // the facings that run straight at or away from the viewer would otherwise carry one.
  skew: number;
  slack: number;
}

// Three pairs, short and tucked in. The reach is deliberately well inside the grunt's 11.6–14.0:
// this creature's ink is its body, and a wide open fan of feet is the one silhouette in the set
// that is already taken.
const LEGS: Leg[] = [
  { spread: 78, reach: 10.4, bow: 12, hook: -8, arch: 4.4, tripod: true, skew: 3, slack: 0.96 },
  { spread: 122, reach: 10.8, bow: 2, hook: 6, arch: 4.8, tripod: false, skew: -2.5, slack: 1.03 },
  { spread: 160, reach: 9.6, bow: -14, hook: 14, arch: 4, tripod: true, skew: 3.5, slack: 0.955 },
];

// The drift, in the legs. The side the fore end turns *away* from is the outside of the slide and
// takes the creature's weight, so it plants wider and further out; the inside gathers under the
// body. Structural rather than sprinkled: this animal is genuinely lopsided because it never runs
// down the line it is looking at.
const BRACE_REACH = 1.08;
const BRACE_SPREAD = 7;
const GATHER_REACH = 0.9;
const GATHER_SPREAD = -5;

// The dash, in two frames. Frame 0 is where the cycle parks whenever an enemy is not moving (#81),
// so it is the frame most often on screen, and it is the **gathered** one: the body sits back over
// the hind legs and the arms are drawn in and carried high. Frame 1 is the reach.
//
// The two poses move **against each other** rather than together, or a fresh eye sees no motion at
// all: a first cut of the bloodling dropped every mass by a pixel and read as scratchy legs
// flickering under a body that never moved. So the body slides forward as the arms stretch out and
// drop, while the abdomen swings back against it and the planted tripod pushes the other way.
const LUNGE = 1.5; // how far the whole body carries forward along the heading
const BOB = 1; // and how far it drops onto the planted legs
const TAIL_TRAIL = 1.6; // the abdomen tip is left this much further behind
const ARM_THROW = 1.14; // the arms reach this much further
const ARM_FALL = 2.2; // and the hooks come this much nearer the floor
const STRIDE = 18; // degrees a swinging leg carries fore or aft
const PHASE = [-0.45, 0.55];
const LIFT = 1.8; // how far a swinging foot comes off the floor
const GATHER = 0.87; // and how far it is pulled in toward the body

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
    const bearing = bearingOf(facing);
    const reach = frame === 1 ? 1 : 0;
    const toward = Math.sin(bearing * DEG); // +1 coming at the player, -1 going away
    const fore = bearing + LEAN;

    // The whole animal carries forward and drops onto the planted tripod between the two frames.
    const shift = plan(bearing, LUNGE * reach, BOB * reach);

    ctx.fillStyle = INK;

    // One path for the whole animal, filled once. Every part is a run of same-winding discs, so the
    // nonzero rule takes their union and the outer boundary is exactly what eleven separate fills
    // produced — but the joins between parts come out solid. Two filled paths meeting along a
    // near-tangent each cover about half of the boundary pixels, and two half-covered composites do
    // not sum to opaque: that is the light seam #171 found through the tail, and it was latent at
    // every other join too. The bloodling closed the same artefact the same way (#171,
    // `bloodling.review.md`).
    ctx.beginPath();

    for (const leg of LEGS) {
      walk(ctx, bearing, leg, false, frame, shift);
      walk(ctx, bearing, leg, true, frame, shift);
    }

    body(ctx, bearing, fore, toward, reach, shift);

    for (const side of [-1, 1] as const) arm(ctx, fore, side, reach, shift);

    ctx.fill();
  },
};

// A point on the flattened plan, lifted clear of it. One function, so the lobes, the ring of feet
// and the arms' reach cannot disagree about where the creature is pointing.
//
// `FIT` shrinks the whole animal about the floor point. Every reach and every height below was
// hand-cut against a 32 box and the sum of them overran it: `sprite:sheet` measured six of the
// sixteen bakes running into the edge of their box — facings 0, 3, 4 and 7, the ones whose arms and
// tail lie flattest across the screen — where a grunt, an elite and a bloodling each measure none.
// A bake that reaches the edge is shorn at it, so the hooks that name this creature were being cut
// off in exactly the four facings that show them best.
//
// One factor here rather than a smaller `ARM_REACH`, because the arms are not the only thing over
// the line — pulling them back alone still left bakes clipping on the abdomen. Scaling at the one
// place every mark's position is computed keeps the proportions the drawing was composed with, and
// deliberately does not touch the stroke widths: those were set against a grunt's hip so this
// creature survives a dense ore patch, and a thinner line is the one thing that must not follow
// from a smaller body.
//
// 0.76 is measured, not chosen: it is the largest value at which `sprite:sheet` reports no bake
// touching its box at all. 0.78 still clips one. The cost is a creature about a quarter smaller
// than it was drawn, which is a real loss of presence and is recorded in the review notes.
const FIT = 0.76;

function plan(bearing: number, radius: number, height: number): Point {
  const a = bearing * DEG;
  const r = radius * FIT;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * PLAN - height * FIT };
}

function from(origin: Point, bearing: number, radius: number, height: number): Point {
  const p = plan(bearing, radius, height);
  return { x: origin.x + p.x, y: origin.y + p.y };
}

// The body: two lobes swept out of one waist. Adds to the caller's path and does not fill — the
// whole animal is one contour, so there is no interior line here or anywhere the limbs meet it.
function body(
  ctx: CanvasRenderingContext2D,
  bearing: number,
  fore: number,
  toward: number,
  reach: number,
  shift: Point,
): void {
  const root = { x: FLOOR.x + shift.x, y: FLOOR.y + shift.y };
  const waist = from(root, 0, 0, WAIST_RIDE);
  const head = from(root, fore, HEAD_REACH, WAIST_RIDE - HEAD_DROP);
  const tail = from(
    root,
    bearing + 180,
    TAIL_REACH + TAIL_TRAIL * reach,
    WAIST_RIDE + TAIL_RISE - shift.y * 0.5,
  );

  sweep(ctx, waist, head, HEAD_SHAPE, 1 + toward * SWELL);
  sweep(ctx, waist, tail, TAIL_SHAPE, 1 - toward * SWELL);
}

const SWEEP_STEPS = 22;

// A lobe, as the union of the discs swept along its spine. A union rather than an offset outline,
// and that is not a style choice: an offset pair of edges folds through itself wherever the
// half-width exceeds the radius of curvature, which on a mass this fat is everywhere, and what comes
// out is a slab with a bite in one side. A swept disc cannot fold, and it rounds both ends for free.
function sweep(
  ctx: CanvasRenderingContext2D,
  root: Point,
  tip: Point,
  shape: [number, number][],
  scale: number,
): void {
  for (let i = 0; i <= SWEEP_STEPS; i++) {
    const t = i / SWEEP_STEPS;
    const x = root.x + (tip.x - root.x) * t;
    const y = root.y + (tip.y - root.y) * t;
    const r = (widthAt(shape, t) * scale) / 2;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
}

function widthAt(shape: [number, number][], t: number): number {
  for (let i = 1; i < shape.length; i++) {
    const [to, wide] = shape[i];
    if (t > to) continue;
    const [at, thin] = shape[i - 1];
    return thin + (wide - thin) * ((t - at) / (to - at));
  }
  return shape[shape.length - 1][1];
}

// A rubber hose of varying thickness, swept as discs along a polyline. Every limb on this creature
// is one of these: the joints come out round, the tip comes out round, and no stroke can fold
// through itself or trail off the mass it left as a loose whisker. Adds to the caller's path and
// does not fill, so a limb fuses with the mass it grows out of instead of compositing against it.
function hose(ctx: CanvasRenderingContext2D, spine: Point[], widths: number[]): void {
  for (let bone = 0; bone < spine.length - 1; bone++) {
    const a = spine[bone];
    const b = spine[bone + 1];
    const steps = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 1.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = (widths[bone] + (widths[bone + 1] - widths[bone]) * t) / 2;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  }
}

// One grappling arm: shoulder buried in the body, elbow raised and swung outboard, wrist reaching
// past the head end, and a hook curling back off the tip. The hook is the whole difference between a
// limb and a spike — a point carrying on outward is a spine, and a point that turns back is a claw.
function arm(
  ctx: CanvasRenderingContext2D,
  fore: number,
  side: -1 | 1,
  reach: number,
  shift: Point,
): void {
  const root = { x: FLOOR.x + shift.x, y: FLOOR.y + shift.y };
  const out = fore + side * ARM_SPREAD;
  const span = ARM_REACH * (1 + (ARM_THROW - 1) * reach);

  const shoulder = from(root, out, ARM_SHOULDER, WAIST_RIDE - HEAD_DROP * 0.7);
  const elbow = from(
    root,
    out + side * ARM_BOW,
    span * ARM_ELBOW_AT,
    ARM_ELBOW_RISE - shift.y * 0.4,
  );
  const wrist = from(root, out - side * ARM_HOOK_IN, span, ARM_TIP_LIFT + ARM_FALL * (1 - reach));

  hose(ctx, [shoulder, elbow, wrist], ARM_W);

  const away = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) - side * HOOK_TURN * DEG;
  const claw = { x: wrist.x + Math.cos(away) * HOOK_LEN, y: wrist.y + Math.sin(away) * HOOK_LEN };
  hose(ctx, [wrist, claw], [HOOK_W * 1.7, HOOK_W * 0.7]);
}

// One walking leg: hip buried in the body, one arch over a knee, foot on a narrow flattened ring.
function walk(
  ctx: CanvasRenderingContext2D,
  bearing: number,
  leg: Leg,
  mirrored: boolean,
  frame: number,
  shift: Point,
): void {
  const side = mirrored ? -1 : 1;
  // The fore end cranks toward +side, so -side is the outside of the drift and takes the weight.
  const braced = mirrored;
  const spread =
    leg.spread * side + (mirrored ? leg.skew : 0) + (braced ? BRACE_SPREAD : GATHER_SPREAD) * side;
  const bow = leg.bow * side;
  const hooked = leg.hook * side;
  // Mirroring flips which tripod a leg belongs to, which is exactly the alternating gait: the front
  // and back of one side swing with the middle of the other, and three feet are down at all times.
  const tripod = mirrored ? !leg.tripod : leg.tripod;
  const phase = PHASE[tripod ? frame : 1 - frame];
  const swing = side * STRIDE * phase;
  const lifted = Math.max(phase, 0);
  const span =
    leg.reach *
    (mirrored ? leg.slack : 1) *
    (braced ? BRACE_REACH : GATHER_REACH) *
    (1 + (GATHER - 1) * lifted);

  const root = { x: FLOOR.x + shift.x * 0.4, y: FLOOR.y + shift.y * 0.4 };
  const kneeAt = bearing + spread + bow + swing * 0.4;
  const hip = from(root, bearing + spread, HIP_R, HIP_LIFT);
  const knee = from(root, kneeAt, span * 0.58, leg.arch + LIFT * lifted * 0.6);
  const foot = from(root, bearing + spread + bow + hooked + swing, span, LIFT * lifted);

  hose(ctx, [hip, knee, foot], LEG_W);
}

export default spiderman;
