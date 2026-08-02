import type { SpriteSubject } from "./sheet";

// The bloodling (#140): the thing that runs at the squad, bleeds the whole way, and bursts when it
// arrives. A squat beetle on six short clawed legs, carrying a swollen sack across its back that is
// bigger than the rest of the animal.
//
// **It is the one drawing in the set that is not black ink, and the break is a decision** — dark
// purple carapace, vibrant green sack (README.md, #140). What the break buys is colour and nothing
// else. The drawing stays in the house idiom: bold contour, solid fill, no interior detail, no
// gradient and no shading. Each coloured mass is a black contour laid down as an outset with one
// flat fill inside it, and the legs, claws and jaws are pure ink like every other creature's. The
// carapace is the colour the fallback disc already used before this sprite landed
// (`src/game/draw.ts:322`), so the shape being replaced and the one replacing it are one animal.
//
// The projection is the hybrid #76 fixes for the creatures: **the masses are upright**, seen
// head-on, while **everything that says where the creature is pointing lies flat**, seen from
// above. Four things follow, and they are what the sprite is made of.
//
// - **The carapace is one path, not two masses.** A body ellipse and a snout ellipse are added to
//   the same path and filled once, so what comes out is their union under a single contour. Drawing
//   the snout as its own mass on top of the body put a closed ink ring *inside* the purple, and a
//   blind reviewer read that ring — correctly, against this style — as interior shading. A union
//   has no interior line to misread.
// - **The snout is what turns, and it turns the outline with it.** It hangs off the body on the
//   flattened plan, so the purple silhouette is a teardrop that points where the creature is going:
//   out to the side in profile, down at the viewer in the charge, hidden behind the sack in the
//   rear views. That is the whole of the facing signal, and it had to move into the silhouette —
//   the same reviewer, told there were eight facings, could not tell them apart while the thing
//   that moved most was buried inside another mass.
// - **The sack trails on that same plan**, so it swings vertically between the charge and the
//   retreat as well as laterally between the two profiles. An earlier cut froze its height on the
//   grounds that perspective and elevation cancel; they do, and the cost was that facing 2 and
//   facing 6 came out the same drawing.
// - **The legs are short, so they are what says *squat*.** They leave a hip buried in the body,
//   arch once, and land on a flattened ring that only just escapes the sack's overhang.
//
// Six legs, not eight: the two spiders own eight, and at 32 px a player reads a silhouette rather
// than counting limbs. Six also walk the alternating tripod an insect actually walks — front and
// back of one side with the middle of the other — which is the cheapest gait that reads as a
// scuttle in two frames.

const SIZE = 32;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S with the snout turned at the player, 4 = W, 6 = N showing the sack.
const heading = (facing: number) => (facing / FACINGS) * TAU;

const INK = "#000000";
const CARAPACE = "#4b2569";
const SACK_SKIN = "#5ec71a";

// The contour every coloured mass carries, in logical px, drawn as an outset under the fill rather
// than stroked around it: a stroke straddles the path and eats the fill from inside, and at this
// size the fill is what carries the colour.
//
// **Weighted for dpr 1, not for dpr 2.** A spider is a solid black mass and holds its ink at any
// ratio; here the only ink is this contour, so it is the whole of what keeps the creature in a
// black-and-white game — and at 1.25 it measured 12% of covered pixels at dpr 1 against 24% at
// dpr 2, which is a contour dissolving into the grey edge the box could not afford to fix. At 1.7
// the line still has a solid device pixel in it on an ordinary monitor.
const LINE = 1.7;

// How much of a plan-space offset survives into screen y. Everything that says *where the creature
// points* — the snout, the sack's trail, the jaws, the ring of feet — is laid out on this one
// flattened plan, so they all turn together and none of them can disagree about the heading.
const PLAN = 0.68;

// Enemies are blitted **centred** on their position, not stood on it (`draw.ts` `paintEnemy`): the
// flat ring of feet is the floor contact, so that ring sits near the middle of the box and the mass
// rises out of it.
const FLOOR = { x: 15.9, y: 20.9 }; // the centre of the ring of feet
const CORE = { x: 15.9, y: 16.6 }; // what the masses hang off

const BODY = { rx: 6.2, ry: 4.9 };
const BODY_DROP = 1.2;
const BODY_LEAN = 0.8; // it leans the way it is going, which parts the two rear quarters

// Reach is generous on purpose: this lobe has to break the body's outline at every facing it is
// visible in, or it stops being a silhouette and goes back to being a ring inside a fill.
const SNOUT = { rx: 3.9, ry: 3.2 };
const SNOUT_REACH = 5.6;
const SNOUT_DROP = 0.7;

// Bigger than the body in both axes, so it overhangs on every side.
const SACK = { rx: 8.4, ry: 6.4 };
const SACK_RIDE = 4.2;
const SACK_TRAIL = 3;

const SWELL = 0.07; // the near mass grows this much, the far one shrinks by it

// Nine radii, odd so no rotation of them can come out mirror-symmetric, held fixed in the sack's
// own frame: the lumps belong to the sack and travel with it rather than crawling as it turns.
// Shallow, because a constant added to a varying radius is not a constant-width offset — the ink
// thins where the outline bends out, and past about a twentieth that unevenness reads as a traced
// line rather than an inked one.
const LUMPS = [1, 1.05, 0.965, 1.04, 0.975, 1.045, 0.97, 1.035, 0.98];
const LUMP_TURN = 0.55;

const HIP_R = 3;
const HIP_LIFT = 3.5; // the hip starts up inside the body, so the two fills meet with no seam
const KNEE_LIFT = 3;
const LEG_HIP_W = 3;
const LEG_TIP_W = 1.9; // a leg thinner than a logical px is an intermittent grey smear at real size
const LEG_BELLY = 0.12; // a hose swells at the belly of its curve — but only just, or it reads as scribble
const LEG_PLAN = 0.33; // the feet ring is flatter than everything else: they all have to land clear

const CLAW_LEN = 1.8;
const CLAW_SPLAY = 30 * DEG; // the two tines, off the leg's own outward direction
const CLAW_W = 1.2;

// The jaws: two ink tines off the front of the snout, and the creature's whole face.
//
// **There are no eyes, and that is the decision the snout's size forces.** The spiders wear paper
// eyes because they are one black mass that needs a face, and they have the pixels for a pair — the
// elite's head is 14 px across in a 48 px box. This one is 8, which puts an eye at three device
// pixels, and at three pixels a paper round on a dark curve is indistinguishable from the specular
// highlight that nothing else in this game has. Jaws are silhouette rather than interior detail, so
// they hold their shape at real size the way the claws do, and a mindless bomb with a biting end
// and no eyes is closer to what this creature is than a face would be.
const JAW_LEN = 2.8;
const JAW_SPLAY = 24 * DEG;
const JAW_W = 1;

// Neither frame is the neutral pose. The walk cycle parks on frame 0 whenever an enemy is not
// moving (#81), but a cycle that returns to symmetry every other frame reads as a pulse rather than
// a gait — so the two sit a third and two thirds through one stride, with one tripod planted and the
// other clear of the floor in both.
const PHASE = [-0.45, 0.55];
const STRIDE = 20; // degrees a swinging leg carries fore or aft
const LIFT = 2; // how far a swinging foot comes off the floor
const GATHER = 0.86; // and how far it is pulled in toward the body

// What the body does between the two frames, and it has to be *relative* motion or a fresh eye sees
// none of it: a first cut moved every mass down together by a whole pixel and read, to a reviewer
// who had not been told, as scratchy legs flickering under a body that never moved.
//
// So the carapace drops as the planted tripod takes the weight and **the sack rises against it**,
// stretching as it goes — a mass with liquid in it does not follow the frame it is carried on. And
// the whole creature sways across its own heading, which is what a six-legged walk does and what
// makes the second frame a different pose rather than the first one lower down.
const BOB = 1.3;
const SACK_LAG = -0.35;
const SACK_STRETCH = 0.06;
const SWAY = 0.55;

// Past here the snout is turned away, and the sack — nearer now — laps over it and takes the box.
const FACE_HORIZON = -0.12;

interface Point {
  x: number;
  y: number;
}

interface Mass extends Point {
  rx: number;
  ry: number;
}

interface Leg {
  spread: number; // degrees off the heading
  reach: number;
  bow: number; // degrees the knee swings wide of the leg's line — the arch, seen from above
  hook: number; // and degrees the foot hooks back from it
  tripod: boolean; // which half of the alternating gait
  // What the mirrored copy does differently. An exact mirror is the tell of a generated drawing,
  // and a creature this symmetrical would otherwise carry one down every facing that runs straight
  // at or away from the viewer.
  skew: number;
  slack: number;
}

const LEGS: Leg[] = [
  { spread: 40, reach: 11.9, bow: 13, hook: -9, tripod: true, skew: 3, slack: 0.96 },
  { spread: 95, reach: 11.7, bow: 3, hook: 5, tripod: false, skew: -2.5, slack: 1.03 },
  { spread: 155, reach: 12.1, bow: -13, hook: 12, tripod: true, skew: 3.5, slack: 0.955 },
];

const bloodling: SpriteSubject = {
  name: "bloodling",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const theta = heading(facing);
    const toward = Math.sin(theta); // +1 running at the player, -1 running away
    const across = Math.cos(theta);
    const bob = frame === 0 ? 0 : BOB;
    // Across the heading, on the same flattened plan, so the sway is a gait and not a slide.
    const sway = (frame === 0 ? -SWAY : SWAY) / 2;
    const rock = { x: -toward * sway, y: across * sway * PLAN };

    const body = at(BODY, across * BODY_LEAN + rock.x, BODY_DROP + bob + rock.y, 1);
    const snout = at(
      SNOUT,
      across * SNOUT_REACH + rock.x,
      toward * SNOUT_REACH * PLAN + SNOUT_DROP + bob + rock.y,
      1 + toward * SWELL,
    );
    const sack = at(
      SACK,
      -across * SACK_TRAIL + rock.x,
      -toward * SACK_TRAIL * PLAN - SACK_RIDE + bob * SACK_LAG + rock.y,
      1 - toward * SWELL,
    );
    const stretch = frame === 1 ? 1 + SACK_STRETCH : 1;
    sack.ry *= stretch;
    sack.rx /= stretch;

    ctx.fillStyle = INK;
    for (const leg of LEGS) {
      drawLeg(ctx, theta / DEG, leg, false, frame, bob);
      drawLeg(ctx, theta / DEG, leg, true, frame, bob);
    }

    // Whichever mass is nearer goes on top, and each one's own contour is what parts the colours.
    // The jaws are gated on the snout being turned at the viewer, so the three rear facings lose the
    // face without a special case — and there the sack, being nearest, laps over everything and
    // takes the box, which is what a player chasing one sees.
    if (toward < FACE_HORIZON) {
      drawCarapace(ctx, body, snout);
      drawSack(ctx, sack);
      return;
    }
    drawSack(ctx, sack);
    drawCarapace(ctx, body, snout);
    drawJaws(ctx, snout, theta);
  },
};

function at(r: { rx: number; ry: number }, dx: number, dy: number, scale: number): Mass {
  return { x: CORE.x + dx, y: CORE.y + dy, rx: r.rx * scale, ry: r.ry * scale };
}

// Both ellipses go into one path and are filled once, so the nonzero rule takes their union and the
// waist between them closes over. Outsetting each lobe rather than the union thickens the ink a
// little where they meet — which is what a pen does at a joint, and the alternative is a notch.
function drawCarapace(ctx: CanvasRenderingContext2D, body: Mass, snout: Mass): void {
  ctx.fillStyle = INK;
  carapacePath(ctx, body, snout, LINE);
  ctx.fill();
  ctx.fillStyle = CARAPACE;
  carapacePath(ctx, body, snout, 0);
  ctx.fill();
}

function carapacePath(ctx: CanvasRenderingContext2D, body: Mass, snout: Mass, out: number): void {
  ctx.beginPath();
  for (const m of [body, snout]) {
    ctx.ellipse(m.x, m.y, m.rx + out, m.ry + out, 0, 0, TAU);
  }
}

function drawSack(ctx: CanvasRenderingContext2D, m: Mass): void {
  ctx.fillStyle = INK;
  lumpy(ctx, m, LINE);
  ctx.fill();
  ctx.fillStyle = SACK_SKIN;
  lumpy(ctx, m, 0);
  ctx.fill();
}

// The sack's outline: quadratics through the midpoints of nine jittered radial samples, so the
// corners round off into lobes instead of reading as a polygon at seventeen pixels across. `out` is
// the contour's weight, laid down before the fill rather than stroked around it.
function lumpy(ctx: CanvasRenderingContext2D, m: Mass, out: number): void {
  const n = LUMPS.length;
  const at = (i: number): Point => {
    const k = ((i % n) + n) % n;
    const a = LUMP_TURN + k * (TAU / n);
    return {
      x: m.x + Math.cos(a) * (m.rx * LUMPS[k] + out),
      y: m.y + Math.sin(a) * (m.ry * LUMPS[k] + out),
    };
  };
  const mid = (i: number): Point => {
    const a = at(i);
    const b = at(i + 1);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  ctx.beginPath();
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
  // Mirroring flips which tripod a leg belongs to, which is exactly the insect gait: the front and
  // back of one side swing with the middle of the other, and three feet are down at all times.
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
  const knee = floorPoint(reach * 0.62, kneeAngle, KNEE_LIFT + LIFT * lifted * 0.6 + bob);
  const rise = floorPoint(reach * 0.28, (bearing + spread + kneeAngle) / 2, KNEE_LIFT * 0.8 + bob);

  hose(ctx, hip, rise, knee, foot);
  tines(ctx, knee, foot, CLAW_LEN, CLAW_W, CLAW_SPLAY);
}

// Where the heading leaves the snout's outline, on the same flattened plan everything else turns
// on — so the jaws lie along the floor when the creature runs across the screen and swing down at
// the viewer as it turns to charge.
function drawJaws(ctx: CanvasRenderingContext2D, snout: Mass, theta: number): void {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta) * PLAN;
  // Off the *contour* rather than the fill, so the tines stand clear of the ink that closes the
  // snout instead of being swallowed by it.
  const t = 1 / Math.hypot(dx / (snout.rx + LINE), dy / (snout.ry + LINE));
  ctx.fillStyle = INK;
  tines(ctx, snout, { x: snout.x + dx * t, y: snout.y + dy * t }, JAW_LEN, JAW_W, JAW_SPLAY);
}

const CURVE_STEPS = 14;

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

// A rubber hose that thins toward the claw. Stroking would give a constant-width tube with a blunt
// end, which at this size reads as a tentacle rather than a leg — the taper is the whole difference,
// so the hose is filled as a shape instead.
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

// A pair of ink tines carrying on the direction the limb was already going. A rounded foot at this
// size reads as a sucker and a single point reads as a needle; the fork is what makes it a claw,
// and it is the same mark on both ends of the animal.
function tines(
  ctx: CanvasRenderingContext2D,
  from: Point,
  tip: Point,
  length: number,
  width: number,
  splay: number,
): void {
  const out = Math.atan2(tip.y - from.y, tip.x - from.x);
  for (const side of [-1, 1]) {
    const a = out + side * splay;
    ctx.beginPath();
    ctx.moveTo(tip.x - Math.sin(a) * width, tip.y + Math.cos(a) * width);
    ctx.lineTo(tip.x + Math.cos(a) * length, tip.y + Math.sin(a) * length);
    ctx.lineTo(tip.x + Math.sin(a) * width, tip.y - Math.cos(a) * width);
    ctx.closePath();
    ctx.fill();
  }
}

export default bloodling;
