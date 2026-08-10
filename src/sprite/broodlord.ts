import type { SpriteSubject } from "./sheet";

// The broodlord: the heaviest thing that walks in this game and the slowest. It chases, stops once
// it is inside a radius of whoever it is chasing, and births three broodlings (#138) — so the whole
// creature is drawn as a womb that grew legs. Its siblings are each exaggerated one way: the grunt
// into leg, the elite into two lobes of carcass. This one is a single low swollen sack with the
// **brood riding on its back as three lobes of its own outline**, and a small head shoved out from
// under the front of it.
//
// The projection is the hybrid #76 fixes for these creatures: the **sack and face are upright**,
// seen head-on, while the **legs splay flat around them**, seen from above.
//
// **The brood is carried in the silhouette, not knocked out of it.** Three white ovals inside a
// black mass is a face — it was drawn that way first, and at real size the clutch read as two eyes
// and a snout however the eggs were sized, tilted, overlapped or spaced. Contour is also the only
// part of a black mark that survives being twenty pixels among other black marks, which is where
// this creature has to be told from a grunt. So the eggs are three rounds bulging off the back,
// each laid over the mass with a **hairline of paper between it and whatever it sits on** — the
// era's own way of separating two blacks — and the only white left in the drawing is that hairline
// and the pair of eyes. Nothing can be mistaken for the face except the face.
//
// Nothing is exactly mirrored: the leg bearings carry a skew that is not mirrored, each leg has its
// own reach, rise and clearance, the sack sits off the box's centre line, and its outline runs on
// four harmonics that never come back into phase. Exact symmetry gives a drawing away as generated.
//
// **Every proportion below is provisional** — looked at on a sheet, not yet played.

const SIZE = 52; // BROODLORD_RADIUS × 2 — the simulation fixes this
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const INK = "#000000";
const PAPER = "#ffffff";

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S with the face turned at the player, 4 = W, 6 = N showing the creature's back.
const heading = (facing: number) => (facing / FACINGS) * TAU;

const FLOOR = { x: 26.2, y: 37.8 }; // the creature's position: the centre of the flat ring of feet
const CORE = { x: 25.6, y: 22.2 }; // the sack rides above it, off the box's centre line on purpose
const SACK = { rx: 13.4, ry: 10.8 }; // wider than tall: this is a load being carried, not a ball
const SQUASH = { rx: 1.03, ry: 0.96 }; // the mass spreads as it takes the weight, on frame 1 only
const LATERAL = 2.5; // how far the mass slides as the creature turns side-on
const DEPTH = 2.2; // and how far it drops coming at the viewer

// The skin of a full sack. Four harmonics, no two of them harmonically related, so the lumps never
// settle into a rosette; the phases drift with the heading, so the mass reads as turning rather
// than as a backdrop the legs move in front of.
const LUMPS = [
  { k: 3, amp: 0.055, phase: 0.72 },
  { k: 5, amp: 0.04, phase: -1.94 },
  { k: 7, amp: 0.026, phase: 2.63 },
  { k: 11, amp: 0.015, phase: 0.31 },
];
const LUMP_DRIFT = 0.42; // of the heading, in radians of contour phase
const CONTOUR_STEPS = 108;

// The clutch, as bearings around the sack rather than points on it: it rides the back and leans
// away from whichever way the head has gone, so it turns with the creature instead of sitting
// still while the head slides out from under it.
const BROOD_LEAN = 0.62; // radians the cluster swings off vertical, with the heading
const BROOD = [
  { off: -0.66, r: 4.5, seat: 0.9, drop: 0.4, squash: 0.08, spin: 0.5, grain: 0.9 },
  { off: 0.03, r: 4.8, seat: 0.86, drop: -0.5, squash: 0.06, spin: -0.9, grain: 2.4 },
  { off: 0.64, r: 4.1, seat: 0.92, drop: 0.7, squash: 0.09, spin: 1.7, grain: -1.6 },
]; // `seat` is how deep it sits in the sack, `drop` its own nudge off the arc
// An egg drawn as a circle is the one mark on this creature a compass could have made, and three of
// them in a row is a machine's drawing however good the rest is. So each carries its own squash, its
// own turn and its own grain of lumpiness.
const EGG_LUMPS = [
  { k: 3, amp: 0.048 },
  { k: 5, amp: 0.03 },
];

const CREASE = 0.9; // the paper left between two blacks that are meant to read as two things

// The head hangs off the front underside of the sack rather than sitting on top of it, so the waist
// between the two masses is what carries the facing: it swings across the box as the creature
// turns, and on the rear facings the sack has swallowed the head whole and there is no face at all.
const HEAD = { rx: 6.0, ry: 5.4 };
const HEAD_OUT = 12.5; // how far it slides to the side as the creature turns
const HEAD_DROP = 7.6;
const HEAD_LIFT = 3.2; // and how far it climbs the flank once it is out there, clear of the legs
const HEAD_DEPTH = 2.6;
const HEAD_LUMPS = [
  { k: 3, amp: 0.07, phase: 1.4 },
  { k: 5, amp: 0.04, phase: -0.6 },
];

// The jaw only comes out on the facings that are looking at you. Held at the side-on facings it
// runs into the head's own outline and the pair of them read as one snout.
const TUSK = { spread: 0.78, len: 3.8, root: 2.2, curl: 1.2, horizon: 0.3 };

const EYE = { bearing: 34 * DEG, orbit: 5.4, rx: 2.5, ry: 1.2, rise: 1.0, tilt: 20 * DEG };
const EYE_EDGE = 0.26; // an eye past this bearing has gone round the head rather than squeezed in
const EYE_SLIVER = 0.62;
const FACE_INSET = 0.85; // no mark comes nearer the head's outline, which would cut it open
const FACE_HORIZON = 0.02; // the head has turned away, and takes the face with it

const LEG_BEARINGS = [40, 96, 152].map((d) => d * DEG);
const LEG_SKEW = [2.5, -3.5, 1.8].map((d) => d * DEG); // not mirrored — no facing is symmetric
const LEG_STRETCH = [1.0, 0.92, 1.06];
const RING_REACH = 20.8;
const RING_DEPTH = 5.0; // the ring is flattened hard, or the near feet land off the box
const RING_LEAN = 0.08; // a foot reaching at the viewer plants a little further out than one away
const LEG_SPACING = 0.62; // how far a foot is pulled off its bearing to stop two sharing a column
const FAN_FLOOR = 0.72; // and no foot lands under the sack, where the whole leg would be lost

// The hips are parted down the *lower* flank only. A limb leaving the top of a mass this round runs
// along its shoulder and reads as a wing, and the white the legs need has to open under the belly —
// which is the one place this creature has any paper left around it.
const HIP_SPAN = [0.15, 0.85]; // radians of flank the hips are parted down, rear leg highest
const HIP_BURIED = 2.6; // the hip starts inside the sack, so the two fills meet without a seam
const KNEE_CLEAR = [3.7, 2.9, 3.4]; // outboard of the outline, or the knee is swallowed by the sack
const KNEE_RISE = [2.6, 1.8, 2.2]; // and it climbs, which is what opens the white under the flank
const KNEE_LIMIT = 19.4; // past this the knee would leave the box

// A limb this short is all taper: narrow where it leaves the flank, swollen at the joint, closing
// to a claw. Constant width is what reads as machine linework rather than as ink.
const HIP_W = 3.0;
const KNEE_W = 4.0;
const FOOT_W = 2.0;
const LEG_BELLY = 0.3;
const CLAW = { len: [2.4, 1.8], splay: 0.44, wide: 1.5 };

// It is slow, and the walk has to say so: a short stride, a low lift, and most of the motion spent
// on the mass dropping rather than on the feet travelling. Neither frame is neutral — a cycle that
// returns to symmetry every other frame reads as a pulse instead of a gait — but frame 0 is the
// more planted of the two, because the cycle parks there whenever a creature is not moving (#81).
const STRIDE = 9 * DEG;
const PHASE = [-0.35, 0.55];
const LIFT = 1.2;
const BOB = 1.3;

interface Point {
  x: number;
  y: number;
}

interface Egg extends Point {
  r: number;
  squash: number;
  spin: number;
  grain: number;
}

interface Leg {
  index: number;
  foot: Point;
  depth: number; // +1 the foot falls in front of the creature, -1 behind it
  out: -1 | 1;
  spread: number; // 0 under the sack, 1 at full stretch
  rank: number; // 0 at the top of its own flank, 1 at the bottom — no two legs share a hip
}

const broodlord: SpriteSubject = {
  name: "broodlord",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const theta = heading(facing);
    const toward = Math.sin(theta); // +1 walking at the viewer, -1 walking away
    const across = Math.cos(theta);
    const loaded = frame === 1;

    const core = {
      x: CORE.x + across * LATERAL,
      y: CORE.y + toward * DEPTH + (loaded ? BOB : 0),
    };
    const rx = SACK.rx * (loaded ? SQUASH.rx : 1);
    const ry = SACK.ry * (loaded ? SQUASH.ry : 1);
    const drift = theta * LUMP_DRIFT;
    const radius = (t: number) => sackRadius(t, rx, ry, drift);

    const head = {
      x: core.x + across * HEAD_OUT,
      y: core.y + toward * HEAD_DEPTH + HEAD_DROP - Math.abs(across) * HEAD_LIFT,
    };
    const leading = toward >= FACE_HORIZON;

    ctx.fillStyle = INK;

    // Every mass after the first lays its own hairline of paper where it meets ink already down.
    // That hairline is the whole drawing: without it a black limb behind a black sack is one blob
    // with a spur on it, which is what a broodlord looked like until this went in. So the order is
    // the order it would be inked in — the legs, then the sack over their roots, then the clutch on
    // its back, then the head out from under its front — and `worn` is what has been laid so far.
    const worn: Path[] = [];
    for (const l of layOutLegs(theta, frame)) worn.push(...drawLeg(ctx, l, core, radius));
    if (!leading) drawHead(ctx, head, drift);

    crease(ctx, worn, (c) => contourPath(c, core, (t) => radius(t) + CREASE));
    ctx.beginPath();
    contourPath(ctx, core, radius);
    ctx.fill();
    worn.push((c) => contourPath(c, core, radius));

    for (const egg of layOutBrood(core, radius, across)) {
      crease(ctx, worn, (c) => contourPath(c, egg, (t) => eggRadius(egg, t) + CREASE));
      ctx.beginPath();
      contourPath(ctx, egg, (t) => eggRadius(egg, t));
      ctx.fill();
      worn.push((c) => contourPath(c, egg, (t) => eggRadius(egg, t)));
    }

    if (leading) {
      crease(ctx, worn, (c) => contourPath(c, head, (t) => headRadius(t, drift) + CREASE));
      if (toward >= TUSK.horizon) drawTusks(ctx, head, across);
      drawHead(ctx, head, drift);
      drawFace(ctx, head, theta, drift);
    }
    ctx.fillStyle = INK;
  },
};

type Path = (ctx: CanvasRenderingContext2D) => void;

// A hairline of paper, laid only where the new shape meets ink that is already down. Painting it
// everywhere would put a white rim on the outside of the silhouette, which is a highlight — and on
// a floor that is not blank paper it would scrub a hole in whatever the creature is standing on.
function crease(ctx: CanvasRenderingContext2D, worn: Path[], shape: Path): void {
  ctx.fillStyle = PAPER;
  // One clip per shape already down, rather than one clip against all of them at once: a leg
  // outline and a contour are wound opposite ways, and under the nonzero rule two subpaths of
  // opposite winding cancel where they overlap, which would punch the crease full of holes.
  for (const p of worn) {
    ctx.save();
    ctx.beginPath();
    p(ctx);
    ctx.clip();
    ctx.beginPath();
    shape(ctx);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = INK;
}

// The sack's outline, as a radius per angle. The ellipse underneath keeps the mass egg-shaped; the
// harmonics on top are the whole of what makes it look drawn rather than plotted.
function sackRadius(t: number, rx: number, ry: number, drift: number): number {
  const base = (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t));
  let swell = 0;
  for (const l of LUMPS) swell += l.amp * Math.sin(l.k * (t + drift) + l.phase);
  return base * (1 + swell);
}

function contourPath(
  ctx: CanvasRenderingContext2D,
  at: Point,
  radius: (t: number) => number,
): void {
  for (let i = 0; i < CONTOUR_STEPS; i++) {
    const t = (i / CONTOUR_STEPS) * TAU;
    const r = radius(t);
    const x = at.x + Math.cos(t) * r;
    const y = at.y + Math.sin(t) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Seated on the back, leaning away from the head. Each egg sits at its own depth in the sack and
// its own nudge off the arc, so the three of them never read as a machined row of three.
function layOutBrood(core: Point, radius: (t: number) => number, across: number): Egg[] {
  const centre = -Math.PI / 2 - across * BROOD_LEAN;
  return BROOD.map((e) => {
    const at = centre + e.off;
    const seat = radius(at) * e.seat;
    return {
      ...e,
      x: core.x + Math.cos(at) * seat,
      y: core.y + Math.sin(at) * seat + e.drop,
    };
  });
}

function eggRadius(egg: Egg, t: number): number {
  let swell = egg.squash * Math.cos(2 * (t - egg.spin));
  for (const l of EGG_LUMPS) swell += l.amp * Math.sin(l.k * t + egg.grain * l.k);
  return egg.r * (1 + swell);
}

function headRadius(t: number, drift: number): number {
  const base = (HEAD.rx * HEAD.ry) / Math.hypot(HEAD.ry * Math.cos(t), HEAD.rx * Math.sin(t));
  let swell = 0;
  for (const l of HEAD_LUMPS) swell += l.amp * Math.sin(l.k * (t + drift) + l.phase);
  return base * (1 + swell);
}

function drawHead(ctx: CanvasRenderingContext2D, head: Point, drift: number): void {
  ctx.beginPath();
  contourPath(ctx, head, (t) => headRadius(t, drift));
  ctx.fill();
}

// A pair of heavy tusks under the jaw — the only part of the creature that points at anything, and
// what keeps a head this small from reading as one more lump fallen off the sack.
function drawTusks(ctx: CanvasRenderingContext2D, head: Point, across: number): void {
  for (const side of [-1, 1] as const) {
    const lean = side * TUSK.spread + across * 0.18;
    const root = { x: head.x + side * TUSK.root, y: head.y + HEAD.ry * 0.45 };
    const tip = {
      x: root.x + Math.sin(lean) * TUSK.len * (side > 0 ? 1.08 : 0.92),
      y: root.y + Math.cos(lean) * TUSK.len,
    };
    ctx.beginPath();
    ctx.moveTo(root.x - side * 1.2, root.y - 0.6);
    ctx.quadraticCurveTo(root.x + side * TUSK.curl, root.y + TUSK.len * 0.5, tip.x, tip.y);
    ctx.quadraticCurveTo(root.x + side * 1.6, root.y + TUSK.len * 0.3, root.x + side * 1.1, root.y);
    ctx.closePath();
    ctx.fill();
  }
}

// Slits, never rounds: a white disc on a black curve is where a highlight goes, and at real size
// that is what it reads as. They ride a bearing round the head, so the eight facings fall out of
// the heading instead of being drawn one at a time.
function drawFace(ctx: CanvasRenderingContext2D, head: Point, theta: number, drift: number): void {
  ctx.save();
  ctx.beginPath();
  contourPath(ctx, head, (t) => headRadius(t, drift));
  ctx.clip();
  ctx.fillStyle = PAPER;
  for (const side of [-1, 1] as const) {
    const bearing = theta + side * EYE.bearing;
    const open = Math.sin(bearing);
    if (open <= EYE_EDGE) continue;
    const rx = EYE.rx * Math.max(open, EYE_SLIVER);
    const limit = HEAD.rx - rx - FACE_INSET;
    const x = head.x + clamp(EYE.orbit * Math.cos(bearing), limit);
    const inward = x < head.x ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(x, head.y - EYE.rise, rx, EYE.ry, -inward * EYE.tilt, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = INK;
}

function clamp(value: number, reach: number): number {
  return Math.max(-reach, Math.min(reach, value));
}

// Six feet, placed by bearing and then sorted apart. The bearing decides where a foot wants to
// land, but two legs the same angle fore and aft want the same column, and six legs sharing three
// columns is three legs as far as a player is concerned. So the honest placement is blended with an
// even fan: the ordering and the lean survive, the collisions do not.
function layOutLegs(theta: number, frame: number): Leg[] {
  const wanted = [];
  for (let index = 0; index < LEG_BEARINGS.length; index++) {
    for (const side of [-1, 1] as const) {
      // The alternating tripod a hexapod actually walks on: the front and rear of one flank swing
      // with the middle leg of the other, so three feet are planted at every instant.
      const leads = (index + (side > 0 ? 1 : 0)) % 2 === 0;
      const phase = leads ? PHASE[frame] : PHASE[1 - frame];
      const bearing = theta + side * LEG_BEARINGS[index] + LEG_SKEW[index] + phase * STRIDE;
      wanted.push({ index, bearing, lift: phase > 0 ? LIFT : 0 });
    }
  }
  wanted.sort((a, b) => Math.cos(a.bearing) - Math.cos(b.bearing));

  const legs: Leg[] = wanted.map((w, slot) => {
    const across = Math.cos(w.bearing);
    const depth = Math.sin(w.bearing);
    const fanned = (slot - (wanted.length - 1) / 2) / ((wanted.length - 1) / 2);
    const wants = across * (1 - LEG_SPACING) + fanned * LEG_SPACING;
    const shaped = FAN_FLOOR + (1 - FAN_FLOOR) * Math.abs(wants);
    const spread = Math.sign(wants) * Math.min(shaped * LEG_STRETCH[w.index], 1);
    return {
      index: w.index,
      depth,
      out: (spread >= 0 ? 1 : -1) as -1 | 1,
      spread: Math.abs(spread),
      rank: 0,
      foot: {
        x: FLOOR.x + spread * RING_REACH * (1 + depth * RING_LEAN),
        y: FLOOR.y + depth * RING_DEPTH - w.lift,
      },
    };
  });
  // Three legs leaving one flank at one point is one leg as far as a silhouette is concerned, so
  // each side's legs are ranked back to front and given their own place down the flank to leave
  // from, with paper above and below every root.
  for (const out of [-1, 1] as const) {
    const side = legs.filter((l) => l.out === out).sort((a, b) => a.depth - b.depth);
    side.forEach((l, i) => {
      l.rank = side.length > 1 ? i / (side.length - 1) : 0.5;
    });
  }
  return legs.sort((a, b) => a.depth - b.depth);
}

// Returns its own outline, so the sack can lay a hairline of paper over the leg where the two meet.
function drawLeg(
  ctx: CanvasRenderingContext2D,
  l: Leg,
  core: Point,
  radius: (t: number) => number,
): Path[] {
  const { foot, out } = l;
  const tilt = HIP_SPAN[0] + (HIP_SPAN[1] - HIP_SPAN[0]) * l.rank;
  const dir = out > 0 ? tilt : Math.PI - tilt;
  const r = radius(dir);
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);

  const hip = { x: core.x + ux * (r - HIP_BURIED), y: core.y + uy * (r - HIP_BURIED) };
  const clear = r + KNEE_CLEAR[l.index] * (0.55 + 0.45 * l.spread);
  const knee = {
    x: FLOOR.x + out * Math.min(Math.abs(core.x + ux * clear - FLOOR.x), KNEE_LIMIT),
    y: core.y + uy * clear - KNEE_RISE[l.index],
  };

  const thigh = arc(hip, { x: hip.x + out * 1.6, y: hip.y + (knee.y - hip.y) * 0.35 }, knee);
  const shin = arc(knee, { x: knee.x + out * 0.9, y: knee.y + (foot.y - knee.y) * 0.45 }, foot);
  const spine = [...thigh, ...shin.slice(1)];
  const knot = thigh.length - 1;
  const last = spine.length - 1;

  const near: Point[] = [];
  const far: Point[] = [];
  for (let i = 0; i <= last; i++) {
    const s = i <= knot ? (i / knot) * 0.5 : 0.5 + ((i - knot) / (last - knot)) * 0.5;
    const width =
      (s <= 0.5
        ? HIP_W + (KNEE_W - HIP_W) * (s / 0.5)
        : KNEE_W + (FOOT_W - KNEE_W) * ((s - 0.5) / 0.5) ** 0.8) +
      LEG_BELLY * Math.sin(Math.PI * s);
    const prev = spine[Math.max(i - 1, 0)];
    const next = spine[Math.min(i + 1, last)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    near.push({
      x: spine[i].x - (dy / len) * (width / 2),
      y: spine[i].y + (dx / len) * (width / 2),
    });
    far.push({
      x: spine[i].x + (dy / len) * (width / 2),
      y: spine[i].y - (dx / len) * (width / 2),
    });
  }

  // The joint is rounded rather than mitred: an offset polygon turning a corner this sharp comes
  // out as a square block, and a square block on a rubber-hose limb reads as furniture.
  ctx.beginPath();
  ctx.ellipse(knee.x, knee.y, KNEE_W / 2, KNEE_W / 2 - 0.2, 0, 0, TAU);
  ctx.fill();

  const aim = Math.atan2(spine[last].y - spine[last - 1].y, spine[last].x - spine[last - 1].x);
  const outline: Path = (c) => {
    c.moveTo(near[0].x, near[0].y);
    for (let i = 1; i <= last; i++) c.lineTo(near[i].x, near[i].y);
    c.arc(foot.x, foot.y, FOOT_W / 2, aim + Math.PI / 2, aim - Math.PI / 2, true);
    for (let i = last; i >= 0; i--) c.lineTo(far[i].x, far[i].y);
    c.closePath();
  };
  ctx.beginPath();
  outline(ctx);
  ctx.fill();

  drawClaw(ctx, foot, aim);
  return [outline];
}

// Two toes, unequal, splayed off the line of the shin. A blunt end on a limb this thick is a stump,
// and a stump under this much mass reads as furniture again.
function drawClaw(ctx: CanvasRenderingContext2D, foot: Point, aim: number): void {
  CLAW.len.forEach((len, i) => {
    const a = aim + (i === 0 ? CLAW.splay : -CLAW.splay * 1.2);
    const tip = { x: foot.x + Math.cos(a) * len, y: foot.y + Math.sin(a) * len };
    const nx = -Math.sin(a) * (CLAW.wide / 2);
    const ny = Math.cos(a) * (CLAW.wide / 2);
    ctx.beginPath();
    ctx.moveTo(foot.x + nx, foot.y + ny);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(foot.x - nx, foot.y - ny);
    ctx.closePath();
    ctx.fill();
  });
}

function arc(a: Point, c: Point, b: Point): Point[] {
  const steps = 8;
  return Array.from({ length: steps + 1 }, (_, s) => {
    const t = s / steps;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  });
}

export default broodlord;
