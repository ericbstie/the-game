import type { SpriteSubject } from "./sheet";

// The bloodling (#140): the thing that runs at the squad, bleeds the whole way, and bursts when it
// arrives. A squat beetle on six short clawed legs, carrying a swollen sack across its back that is
// bigger than the rest of the animal.
//
// **It is the one drawing in the set that is not black ink, and the break is a decision** — dark
// purple carapace, vibrant green sack (README.md, #140). What the break buys is colour and nothing
// else. The drawing stays in the house idiom: bold contour, solid fill, no interior detail, no
// gradient and no shading. Every coloured mass is a black contour laid down first with one flat
// fill inside it, and the legs, claws and jaws are pure ink like every other creature's. The
// carapace is the colour the fallback disc already used before this sprite landed
// (`src/game/draw.ts:322`), so the shape being replaced and the one replacing it are one animal.
//
// The projection is the hybrid #76 fixes for the creatures: **the body is upright**, seen head-on,
// while **the legs splay flat around it**, seen from above. Four things follow, and they are what
// the sprite is made of.
//
// - **Three masses, stacked rather than strung out.** A carapace low and wide, the sack riding on
//   its back, a small head nosing out of the front. The first cut drew two lobes side by side the
//   way the elite does and came out a peanut: two circles of equal weight with nothing under them.
//   Stacking is what makes the sack read as *carried* — the purple is the base at every facing, and
//   the green is what sits on it.
// - **It turns by overlap.** An upright body cannot slide up or down the screen as it turns, so the
//   turn is carried by the masses trading places: the head leads, drops and swells as the creature
//   comes at you, and the sack takes the front and covers it as the creature runs away. Nothing is
//   drawn per facing, so nothing can drift between facings.
// - **The sack is the threat, so it is the silhouette.** Wider than the carapace it sits on, so it
//   overhangs; and lumpy rather than elliptical, because a taut skin under pressure is what "about
//   to burst" looks like in one outline.
// - **The legs are short, so they are what says *squat*.** They leave a hip buried in the carapace,
//   arch once, and land on a flattened ring that only just escapes the overhang.
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
// 2 = S with the face turned at the player, 4 = W, 6 = N showing the sack.
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

// Enemies are blitted **centred** on their position, not stood on it (`draw.ts` `paintEnemy`): the
// flat ring of feet is the floor contact, so that ring sits near the middle of the box and the mass
// rises out of it.
const FLOOR = { x: 15.9, y: 20.8 }; // the centre of the ring of feet
const CORE = { x: 15.9, y: 16.5 }; // what the three masses hang off

// Low and wide, and the base of the silhouette at every facing: it is the only mass the legs can
// plausibly leave from, and the only purple that survives the rear views.
const SHELL = { rx: 6.8, ry: 5 };
const SHELL_DROP = 2;
const SHELL_DEPTH = 0.6; // it barely moves; it is the middle of the animal
const SHELL_LEAD = 1.2; // but it leans the way the creature is going, which is what parts the rear facings

// Bigger than the shell in both axes, so it overhangs on every side — and it rides high enough that
// its underside never reaches the shell's, or the purple base disappears at the rear facings.
//
// It also barely moves up or down as the creature turns, and that is a choice against perspective:
// being *behind* the body would drop it down the screen as the creature runs away, while being
// *above* it would raise it, and at this size the two cancel into a mass that swims. Height wins,
// the lateral slide carries the turn, and the sack stays where a sack on a back belongs.
const SACK = { rx: 9, ry: 7.4 };
const SACK_RIDE = 4.4;
const SACK_DEPTH = 0.4;
const SACK_TRAIL = 2; // how far it slides off the back as the creature turns side-on

const HEAD = { rx: 4.3, ry: 2.9 };
const HEAD_LEAD = 5.6;
const HEAD_DROP = 3.3;
const HEAD_DEPTH = 2; // it noses down toward the floor as the creature comes at you

const SWELL = 0.07; // the near mass grows this much, the far one shrinks by it

// Seven radii, odd so no rotation of them can come out mirror-symmetric, held fixed in the sack's
// own frame: the lumps belong to the sack and travel with it rather than crawling as it turns.
const LUMPS = [1, 1.09, 0.945, 1.07, 0.96, 1.085, 0.985];
const LUMP_TURN = 0.55;

// The plan the legs radiate over, squashed toward the horizon: a true circle of feet would put the
// front pair a third of the box below the creature and the back pair inside the sack.
const FLATTEN = 0.33;
const HIP_R = 3;
const HIP_LIFT = 3.5; // the hip starts up inside the shell, so the two fills meet with no seam
const KNEE_LIFT = 3.2;
const LEG_HIP_W = 3;
const LEG_TIP_W = 1.6; // a leg thinner than a logical px is an intermittent grey smear at real size
const LEG_BELLY = 0.35; // a rubber hose swells at the belly of its curve; constant width reads as pipe

const CLAW_LEN = 1.8;
const CLAW_SPLAY = 30 * DEG; // the two tines, off the leg's own outward direction
const CLAW_W = 1.2;

// The jaws: two ink tines off the front of the head, and the creature's whole face.
//
// **There are no eyes, and that is the decision the head's size forces.** The spiders wear paper
// eyes because they are one black mass that needs a face, and they have the pixels for a pair — the
// elite's head is 14 px across in a 48 px box. This head is 8, which puts an eye at three device
// pixels, and at three pixels a paper round on a dark curve is indistinguishable from the specular
// highlight that nothing else in this game has. Jaws are silhouette rather than interior detail, so
// they hold their shape at real size the way the claws do, and a mindless bomb with a biting end
// and no eyes is closer to what this creature is than a face would be.
const JAW_LEN = 3.1;
const JAW_SPLAY = 24 * DEG;
const JAW_W = 1;
const JAW_PLAN = 0.55; // the flattening the forward direction takes, matching the legs' plan

// Neither frame is the neutral pose. The walk cycle parks on frame 0 whenever an enemy is not
// moving (#81), but a cycle that returns to symmetry every other frame reads as a pulse rather than
// a gait — so the two sit a third and two thirds through one stride, with one tripod planted and the
// other clear of the floor in both.
const PHASE = [-0.45, 0.55];
const STRIDE = 20; // degrees a swinging leg carries fore or aft
const LIFT = 2; // how far a swinging foot comes off the floor
const GATHER = 0.86; // and how far it is pulled in toward the body

// The mass drops as the planted tripod takes the weight, and the sack does not keep up with it: it
// falls a third as far and stretches as it goes, so the gap between it and the shell closes and
// opens. That lag is the whole of "full of liquid" — the legs say walk, and the sack settling a beat
// behind them says what is inside it.
const BOB = 0.9;
const SACK_LAG = 0.35;
const SACK_STRETCH = 0.04;

// Past here the head is turned away, and the sack — nearer now — laps over it and takes the box.
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
  { spread: 40, reach: 12.9, bow: 13, hook: -9, tripod: true, skew: 3, slack: 0.96 },
  { spread: 95, reach: 12.6, bow: 3, hook: 5, tripod: false, skew: -2.5, slack: 1.03 },
  { spread: 155, reach: 13, bow: -13, hook: 12, tripod: true, skew: 3.5, slack: 0.955 },
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

    const shell = lobe(SHELL, across * SHELL_LEAD, SHELL_DROP + toward * SHELL_DEPTH + bob, 1);
    const head = lobe(
      HEAD,
      across * HEAD_LEAD,
      HEAD_DROP + toward * HEAD_DEPTH + bob,
      1 + toward * SWELL,
    );
    const sack = lobe(
      SACK,
      -across * SACK_TRAIL,
      -SACK_RIDE - toward * SACK_DEPTH + bob * SACK_LAG,
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
    // The jaws are gated on the head being turned at the viewer, so the three rear facings lose the
    // face without a special case — and there the sack, being nearest, laps over everything and
    // takes the box, which is what a player chasing one sees.
    if (toward < FACE_HORIZON) {
      drawMass(ctx, head, CARAPACE);
      drawMass(ctx, shell, CARAPACE);
      drawSack(ctx, sack);
      return;
    }
    drawSack(ctx, sack);
    drawMass(ctx, shell, CARAPACE);
    drawMass(ctx, head, CARAPACE);
    drawJaws(ctx, head, theta);
  },
};

function lobe(r: { rx: number; ry: number }, dx: number, dy: number, scale: number): Mass {
  return { x: CORE.x + dx, y: CORE.y + dy, rx: r.rx * scale, ry: r.ry * scale };
}

function drawMass(ctx: CanvasRenderingContext2D, m: Mass, fill: string): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(m.x, m.y, m.rx + LINE, m.ry + LINE, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, TAU);
  ctx.fill();
}

function drawSack(ctx: CanvasRenderingContext2D, m: Mass): void {
  ctx.fillStyle = INK;
  lumpy(ctx, m, LINE);
  ctx.fill();
  ctx.fillStyle = SACK_SKIN;
  lumpy(ctx, m, 0);
  ctx.fill();
}

// The sack's outline: quadratics through the midpoints of seven jittered radial samples, so the
// corners round off into lobes instead of reading as a heptagon at eighteen pixels across. `out` is
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
    y: FLOOR.y + Math.sin(a) * radius * FLATTEN - height,
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

// Where the heading leaves the head's outline, on the same flattened plan the legs splay over — so
// the jaws lie along the floor when the creature runs across the screen and swing down toward the
// viewer as it turns to charge.
function drawJaws(ctx: CanvasRenderingContext2D, head: Mass, theta: number): void {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta) * JAW_PLAN;
  // Off the *contour* rather than the fill, so the tines stand clear of the ink that closes the
  // head instead of being swallowed by it.
  const t = 1 / Math.hypot(dx / (head.rx + LINE), dy / (head.ry + LINE));
  ctx.fillStyle = INK;
  tines(ctx, head, { x: head.x + dx * t, y: head.y + dy * t }, JAW_LEN, JAW_W, JAW_SPLAY);
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
