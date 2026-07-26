import type { SpriteSubject } from "./sheet";

// The self marker, painted behind your own avatar and centred on its body.
//
// One is on screen at a time — yours — and it has to be found instantly among six identical
// figures and a wave of spiders. The floor is white paper, and that is the whole problem: #76
// grants this sprite a glow "barely yellow, mostly white", and a mostly-white glow on white paper
// has almost no value contrast to spend.
//
// Two channels do the work, because neither is enough alone.
//
// **Ink**, for the shape: a brushed circle drawn *around* the figure, one continuous stroke that
// runs past its own start and crosses it. A hand does that and a machine does not, which matters
// because a halo is the most naturally symmetric thing in the set. The stroke stays outside the
// avatar's silhouette, so an enemy standing on top of you cannot erase your marker.
//
// **Tint**, for the distance: ink alone is not enough, because the 240 spiders are also ink — a
// reviewer's squint test found the marked figure was merely the *dimmest* dark blob on the field.
// The warmth is the one channel nothing else in a black-and-white game has, so it is the thing
// that survives being small, blurred, or half-covered. It is spent as **area** rather than
// saturation: the tone stays at the faintest step that reads, and reaches instead.
//
// It is an annulus and not a disc. A filled circle behind a figure reads as a shadow or a
// selection puck on any floor, and it hides its own centre for nothing — the avatar is standing
// there. Light around the stroke reads as light; a plate under the feet does not.
//
// The tint is also printed slightly *out of register* with the ink rather than blurred under it.
// A soft radial bloom is a modern glow filter and reads as one; offset downward it reads as a drop
// shadow. A flat plate a pixel off its black plate is what a two-colour press of the period did.

const SIZE = 52; // see halo.review.md
const RADIUS = 0.385; // of the box — the ink, not the glow, is what the box is sized for
const OVAL = 0.02; // barely taller than wide: the thing it frames is an upright figure

const INK = "#000"; // the same black as every other sprite in the set
const WARM = "255, 246, 208"; // barely yellow, and only ever laid down at low alpha over paper

// Flat tone steps, not a gradient: a tint ladder is how the era printed a glow. Each is an
// annulus centred on the stroke, so the warmth is brightest where the ink is and the middle of
// the mark stays bare paper.
const GLOW = [
  { out: 2.4, in: -8.6, alpha: 0.13 },
  { out: 1.6, in: -5.4, alpha: 0.18 },
  { out: 0.9, in: -3.0, alpha: 0.27 },
];
const REGISTER = { x: -0.6, y: -0.7 }; // how far the warm plate misses the black one

const NIB = 4.2; // heaviest, on the diagonal a right hand pulls the pen along
const WISP = 1.25; // what the ends taper *through*; below HAIR, or the taper cannot show at all
const HAIR = 2.1; // lightest; never under 1 logical px, which smears instead of drawing
const NIB_AXIS = 2.36; // ~3π/4 — heavy at lower-left and upper-right, light between

// The pen touches down on the upper-left diagonal, where the nib's own weighting is lightest —
// which is where a hand starts a circle, and which keeps the start, the finish and the crossing
// they make off both axes. Sitting it at the bottom left a dead-horizontal chord along the inner
// edge of the stroke, and an axis-aligned edge is a machine tell however good the rest is.
const START = 3.9;
const OVERSHOOT = 0.42; // how far past its own start it ran before lifting
const DRIFT = -0.22; // no hand closes a circle on itself; this one tightens as it goes
const HOOK = -7.0; // then cuts back out across its own head, steeply enough to be a crossing
const HOOK_FROM = (Math.PI * 2) / (Math.PI * 2 + OVERSHOOT); // exactly the overshoot, no more

const STEPS = 260;
const TURN = Math.PI * 2;

const halo: SpriteSubject = {
  name: "halo",
  size: SIZE,
  facings: 1,
  frames: 1, // `drawWorld` asks for facing 0 frame 0 and nothing else — a second frame is dead art
  draw(ctx, size) {
    const cx = size / 2 + 0.25; // off true by a quarter pixel, like everything else here
    const cy = size / 2 - 0.2;
    const base = size * RADIUS;
    // The oval term does double duty: it frames an upright figure the way a circle cannot, and it
    // is another thing a generated ring would not have. The three harmonics on top are the hand,
    // and they are sized to be worth 1–2 device pixels at dpr 1 — below that the wobble is real in
    // the code and invisible on screen, which is the same as not having drawn it.
    const wobble = (angle: number) =>
      base *
      (1 -
        OVAL * Math.cos(2 * angle) +
        0.028 * Math.sin(angle + 0.42) +
        0.028 * Math.sin(3 * angle + 1.15) +
        0.016 * Math.sin(5 * angle + 2.66));

    for (const step of GLOW) {
      ctx.fillStyle = `rgba(${WARM}, ${step.alpha})`;
      ctx.beginPath();
      trace(ctx, cx + REGISTER.x, cy + REGISTER.y, 0, TURN, (a) => wobble(a) + step.out, true);
      trace(ctx, cx + REGISTER.x, cy + REGISTER.y, TURN, -TURN, (a) => wobble(a) + step.in, false);
      ctx.closePath();
      ctx.fill();
    }

    const sweep = TURN + OVERSHOOT;
    const outer = (angle: number, t: number) => wobble(angle) * (1 + DRIFT * (t - 0.5)) - hook(t);
    ctx.fillStyle = INK;
    ctx.beginPath();
    trace(ctx, cx, cy, START, sweep, outer, true);
    trace(
      ctx,
      cx,
      cy,
      START + sweep,
      -sweep,
      (angle, t) => outer(angle, 1 - t) - nib(angle, 1 - t),
      false,
    );
    ctx.closePath();
    ctx.fill();
  },
};

// Sample an angular span into the current path. Both edges of the stroke, and both edges of every
// tone step, come off this — which is the only way to vary a line's width along its length, since
// canvas has one `lineWidth` for the whole call and a ring of constant width reads as CAD linework
// rather than as a pen.
function trace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  from: number,
  sweep: number,
  radius: (angle: number, t: number) => number,
  start: boolean,
): void {
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = from + t * sweep;
    const r = radius(angle, t);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0 && start) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

// The last sixth of the stroke, swinging outward so the tail crosses its own head and finishes in
// open paper rather than on the avatar. The crossing is what says a hand drew this; ending it away
// from the figure is what stops it reading as a wire growing out of the head.
function hook(t: number): number {
  const into = (t - HOOK_FROM) / (1 - HOOK_FROM);
  return into <= 0 ? 0 : HOOK * into ** 1.2;
}

// The pen's weight around the circle: heavy twice per turn on the nib's axis, tilted so one of
// those two is heavier than the other, and carrying a third-harmonic tremor on top. Without the
// tremor the weight is monotonic thin-at-top to fat-at-bottom, which reads as a gradient applied
// to a line rather than as a nib, which varies locally.
//
// `ends` is separate and does something else: it thins the stroke through the whole overshoot, so
// the finish crosses its own start as a whisker over a line instead of pooling into a slab where
// the two runs overlap.
function nib(angle: number, t: number): number {
  const heavy = 0.5 + 0.5 * Math.cos(2 * (angle - NIB_AXIS));
  const lean = 0.5 + 0.5 * Math.cos(angle - 1.9);
  const tremor = 0.5 + 0.5 * Math.cos(3 * angle + 0.8);
  const weight = HAIR + (NIB - HAIR) * (0.72 * heavy + 0.18 * tremor + 0.1 * lean);
  const ends = Math.min(1, 0.3 + t / 0.06, 0.22 + (1 - t) / 0.3);
  return Math.max(WISP, weight * ends) * point(t);
}

// The touch-down and the lift, each a short taper to a point. A blunt end reads as a broken line;
// a taper is the one place a stroke is allowed under a pixel, because it is a point and not a
// line that came out too thin.
function point(t: number): number {
  return Math.min(1, 0.08 + t / 0.022, 0.05 + (1 - t) / 0.034);
}

export default halo;
