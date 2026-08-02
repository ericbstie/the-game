import type { SpriteSubject } from "./sheet";

// The tutorial's mark (#134): the ring a sub-editor lays round something on a proof, in one stroke
// that goes on light, bears down through the turn and runs past where it started before it lifts.
// One mark, two hosts — `drawWorld` blits it over the ore tile the run is sending the player to,
// and `SpriteIcon` draws the same subject at 64 px over the HUD's ammo button — so it is a ring
// *round* a thing and never a thing itself.
//
// **It is heavy because of what it has to be read against.** A metal-ore patch is ~30% ink laid
// down as splinters, with black runs up to 15.5 u and white gaps up to 31 u, and #154 measured
// three ways of putting a thin mark on that which all failed: a wider paper rim (the texture is
// already made of white gaps, so more white is more texture), a bigger mark (135 px, still not
// found) and `difference` compositing (most of the band inverted paper to black and landed back in
// the texture's own vocabulary). What ore cannot counterfeit is **flat mass** — an unbroken black
// band 8 to 12 u across and over 200 u round, with no white anywhere inside it, against a field
// whose largest solid clump is a fraction of that. So the whole mark is spent on one closed band
// and carries no interior detail at all.
//
// It can afford that where an aim reticle could not. This marks one fixed tile, it is what the
// player is being sent to rather than something they are aiming through, and it is on screen only
// until they mine their first Metal.

const TAU = Math.PI * 2;
const INK = "#000";
const PAPER = "#fff";

// The units the mark is drawn in, and exactly the pixels the HUD host draws it at
// (`AMMO_MARK_PX`), so one design unit is one DOM pixel there. The button's 56 px face falls just
// inside the band, which is what puts the ring on its border and leaves its icon and its count
// inside the hole.
const DESIGN = 64;
const CENTRE = DESIGN / 2;

// The world box: how much of the patch the ring encircles around the 15 u tile at its centre. Only
// this host's scale rides on it — the HUD's is fixed at 64 px — so it buys band width against the
// ore without moving anything in the DOM. Provisional.
const BOX = 84;

const RING = 24.6; // the stroke's mean radius
const WEIGHT = 7.4; // and its width at full pressure
const MARGIN = 1.0; // bare paper outside the ink, so no splinter ever decides the band's edge
const OVAL = 0.03; // how far off round
const TILT = -0.28; // radians the oval leans
const START = 2.3; // where the stroke went down
const SWEEP = TAU + 0.72; // and how far past that it carried on before lifting

// Where the ends sit relative to the ring: the head inside it, the tail swinging out past the head
// and running on. Both deviations are driven to a power, so they belong to the ends alone and the
// body of the stroke stays on the ring — which is what keeps the mass flat where the mass is doing
// the work. The offset between them is what leaves paper visible between the tail and the head it
// crosses, instead of one lump where the two ends meet.
const HEAD_IN = 0.1;
const TAIL_OUT = 0.15;

// A wrist does not hold a radius. Two slow harmonics rather than noise: noise at this weight only
// frets the band's edge, and a fretted edge is the ore's own vocabulary.
const waver = (theta: number): number =>
  0.02 * Math.sin(2 * theta + 0.75) + 0.012 * Math.sin(3 * theta - 1.85);

// Pressure along the stroke. It touches down light, bears hardest half a turn later where the
// wrist is closing, and lifts off to a flick. Constant width is what reads as a washer, and a
// washer is the one thing this must not read as.
//
// The heavy flank is put opposite the start on purpose: it leaves both ends of the gesture at
// their lightest exactly where they cross, so the crossing reads as one stroke passing over
// another rather than as a chip out of a ring.
const BEAR = 3.05; // radians past the start that the wrist bears down

function press(t: number): number {
  const bear = 1 + 0.2 * Math.cos(SWEEP * t - BEAR);
  const onto = 0.3 + 0.7 * Math.min(1, t / 0.085);
  const off = 0.16 + 0.84 * Math.min(1, (1 - t) / 0.17);
  return bear * onto * off;
}

interface Point {
  x: number;
  y: number;
}

const LEAN_COS = Math.cos(TILT);
const LEAN_SIN = Math.sin(TILT);

function centreline(t: number): Point {
  const theta = START + SWEEP * t;
  const drift = -HEAD_IN * (1 - t) ** 4 + TAIL_OUT * t ** 4;
  const r = RING * (1 + drift + waver(theta));
  const x = Math.cos(theta) * r * (1 + OVAL);
  const y = Math.sin(theta) * r * (1 - OVAL);
  return { x: x * LEAN_COS - y * LEAN_SIN, y: x * LEAN_SIN + y * LEAN_COS };
}

const STEPS = 260;
const NUDGE = 1 / (STEPS * 4); // the tangent, off the same curve rather than a second formula

// The band is a filled shape, not a stroked path. A stroke carries one width for its whole length;
// the taper, the swell and the flick only exist as a shape, and they are the whole difference
// between a laid stroke and a drawn washer.
function band(ctx: CanvasRenderingContext2D, extra: number): void {
  const near: Point[] = [];
  const far: Point[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const at = centreline(t);
    const back = centreline(Math.max(0, t - NUDGE));
    const on = centreline(Math.min(1, t + NUDGE));
    const dx = on.x - back.x;
    const dy = on.y - back.y;
    const length = Math.hypot(dx, dy) || 1;
    const half = (WEIGHT * press(t)) / 2 + extra;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    near.push({ x: at.x + nx, y: at.y + ny });
    far.push({ x: at.x - nx, y: at.y - ny });
  }
  ctx.beginPath();
  ctx.moveTo(near[0].x, near[0].y);
  for (let i = 1; i < near.length; i++) ctx.lineTo(near[i].x, near[i].y);
  for (let i = far.length - 1; i >= 0; i--) ctx.lineTo(far[i].x, far[i].y);
  ctx.closePath();
  ctx.fill();

  // Both ends rounded. A flat end leaves a step where it crosses the band, and a step at this
  // weight is the one thing here that reads as an artefact rather than as ink.
  for (const t of [0, 1]) cap(ctx, t, extra);
}

function cap(ctx: CanvasRenderingContext2D, t: number, extra: number): void {
  const at = centreline(t);
  ctx.beginPath();
  ctx.arc(at.x, at.y, (WEIGHT * press(t)) / 2 + extra, 0, TAU);
  ctx.fill();
}

const highlight: SpriteSubject = {
  name: "highlight",
  size: BOX,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.scale(size / DESIGN, size / DESIGN);
    ctx.translate(CENTRE, CENTRE);

    // The paper first, as the same stroke fattened by the gutter: the band has to arrive on bare
    // paper wherever it crosses the patch, or its own edge is settled by whatever splinter it
    // happens to land against.
    ctx.fillStyle = PAPER;
    band(ctx, MARGIN);

    ctx.fillStyle = INK;
    band(ctx, 0);
  },
};

export default highlight;
