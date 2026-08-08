import type { SpriteSubject } from "./sheet";

// The self marker: an angel's halo ring, hanging in the air above your avatar's head.
//
// One is on screen at a time — yours — and it has to be found instantly among six identical
// figures and a wave of spiders. The floor is white paper, and that is the whole problem: #76
// grants this sprite "barely yellow, mostly white", and a mostly-white mark on white paper has
// almost no value contrast to spend.
//
// **It is not a ring around the figure.** It was, and that ring's difficulty was that a circle
// drawn on the picture plane around a body is a selection marker — the vocabulary of a strategy
// game's UI, not of a comic. A halo is an *object in the scene*: it has a position in space, above
// the head, and the head does not pass through it. That is what makes it read as belonging to the
// drawing rather than being laid over it, and it is the one thing here that must not be lost.
//
// Three things carry that reading, and none of them is enough alone.
//
// **Foreshortening.** The camera looks down on the arena, so a ring lying flat above a head is seen
// as an ellipse far wider than it is tall. This is most of the effect: the same ink drawn as a
// circle reads as a hoop standing on edge, or as a letter O. It is squashed to a little over two to
// one, which is as flat as it can go before the two arcs merge into one bar at dpr 1.
//
// **The band's own width.** A halo is a flat ring, not a wire, so its band is seen at full width at
// the left and right ends and compressed to nothing at the near and far arcs. The stroke is
// therefore heaviest at the two ends and lightest top and bottom — the pen's weighting and the
// perspective ask for the same thing, which is lucky, because a constant-width ellipse reads as CAD
// linework. Canvas has one `lineWidth` per call, so the only way to vary a stroke along its length
// is to trace both of its edges: see `trace`.
//
// **Tint**, for the distance: ink alone is not enough, because the 240 spiders are also ink — a
// reviewer's squint test of the old marker found the marked figure was merely the *dimmest* dark
// blob on the field. The warmth is the one channel nothing else in a black-and-white game has, so
// it is what survives being small, blurred, or half-covered. It stays at the faintest step that
// reads and spends itself as area instead of saturation.
//
// The tint is flat tone steps printed slightly *out of register* with the ink, not a soft bloom
// under it. A radial gradient is a modern glow filter and reads as one; offset downward it reads as
// a drop shadow. A flat plate a fraction off its black plate is what a two-colour press of the era
// did, and it is the only version of this that looks printed.
//
// **Findability with an enemy standing on you.** The old ring answered this by staying outside the
// avatar's silhouette. Above the head is a different answer to the same requirement and a better
// one: a spider that covers you covers the floor you are standing on, and this mark is not on the
// floor. It is the only ink in the game that floats clear of every silhouette.
//
// This draws **one still frame**. The bounce is applied by the caller at blit time, which is why
// `frames` is 1 — an animation baked in here would cost a bake per phase and quantise the motion
// to whatever count was chosen.

// The box. The player's is 28 and its head with the ears spans about 12 of that, so a ring 14–15
// units across is a halo's proportion: a shade wider than the head it floats over, and half the
// width of the figure. 22 is that ring plus room for the tilt, the wobble and the warm plate's
// out-of-register offset without any of them touching the box edge, which would be shorn on blit.
// The old marker's box was 52 — a whole body's width — and the difference is the point of #160.
const SIZE = 22;

const RING = 0.315; // of the box — the ink's outer edge, which is what the box is sized for
const FLAT = 0.37; // the ellipse's height over its width: the foreshortening, and the whole illusion
const TILT = -0.08; // no hand draws a level ellipse, and level is the machine tell here

const INK = "#000"; // the same black as every other sprite in the set
const WARM = "255, 246, 208"; // barely yellow, and only ever laid down at low alpha over paper

// Flat tone steps, not a gradient. Each is a band straddling the stroke, so the warmth is
// brightest where the ink is. Offsets are outward from the nominal ellipse, in logical units.
// Provisional until played: the alphas, and how far the outermost step reaches.
const GLOW = [
  { out: 1.3, in: -2.5, alpha: 0.1 },
  { out: 0.85, in: -1.9, alpha: 0.15 },
  { out: 0.4, in: -1.3, alpha: 0.22 },
];
const REGISTER = { x: -0.45, y: -0.5 }; // how far the warm plate misses the black one

// The pen. Thin, per #160: the old marker's 4.2 nib was sized for a stroke around a whole body,
// and at a head's width the same weight closes the ellipse into a bar. Provisional until played.
const NIB = 2.0; // heaviest, at the ends of the ellipse where the band is seen at full width
const WISP = 0.62; // what the ends taper *through*; below HAIR, or the taper cannot show at all
const HAIR = 1.05; // lightest, on the near and far arcs; never under 1 logical px, which smears
const LEAN = 1.0; // ~π/3 past the right end: the heavier of the two ends is the lower-right one

// The pen touches down on the far arc, left of the top, and runs round to cross its own start.
// Away from both the ends and the arcs' midpoints, so neither the start, the finish nor the
// crossing they make lands on a place where the curve is momentarily axis-aligned.
const START = -2.05;
const OVERSHOOT = 0.5; // how far past its own start it ran before lifting
const DRIFT = -0.35; // no hand closes an ellipse on itself; this one tightens as it goes
const HOOK = -0.8; // then lifts outward across its own head, so the crossing is a cross
const HOOK_FROM = (Math.PI * 2) / (Math.PI * 2 + OVERSHOOT); // exactly the overshoot, no more

const STEPS = 180;
const TURN = Math.PI * 2;

const halo: SpriteSubject = {
  name: "halo",
  size: SIZE,
  facings: 1,
  frames: 1, // one still frame: the bounce is the caller's, applied at blit time
  draw(ctx, size) {
    const cx = size / 2 + 0.25; // off true by a quarter pixel, like everything else here
    const cy = size / 2 - 0.15;

    for (const step of GLOW) {
      ctx.fillStyle = `rgba(${WARM}, ${step.alpha})`;
      ctx.beginPath();
      trace(ctx, size, cx + REGISTER.x, cy + REGISTER.y, 0, TURN, () => step.out, true);
      trace(ctx, size, cx + REGISTER.x, cy + REGISTER.y, TURN, -TURN, () => step.in, false);
      ctx.closePath();
      ctx.fill();
    }

    const sweep = TURN + OVERSHOOT;
    const outer = (_angle: number, t: number) => DRIFT * (t - 0.5) - hook(t);
    ctx.fillStyle = INK;
    ctx.beginPath();
    trace(ctx, size, cx, cy, START, sweep, outer, true);
    trace(
      ctx,
      size,
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
  size: number,
  cx: number,
  cy: number,
  from: number,
  sweep: number,
  out: (angle: number, t: number) => number,
  start: boolean,
): void {
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = from + t * sweep;
    const { x, y } = edge(size, cx, cy, angle, out(angle, t));
    if (i === 0 && start) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

// A point on the foreshortened ellipse, pushed `out` logical units clear of it. Adding the same
// amount to both semi-axes offsets the curve by that much along its own normal at the ends and at
// the arcs alike, so `out` is a width in the units the nib is written in rather than a fraction of
// a radius that would mean something different at the top than at the side.
function edge(
  size: number,
  cx: number,
  cy: number,
  angle: number,
  out: number,
): { x: number; y: number } {
  const s = wobble(angle);
  const ex = (size * RING * s + out) * Math.cos(angle);
  const ey = (size * RING * FLAT * s + out) * Math.sin(angle);
  return {
    x: cx + ex * Math.cos(TILT) - ey * Math.sin(TILT),
    y: cy + ex * Math.sin(TILT) + ey * Math.cos(TILT),
  };
}

// The hand in the curve. Three harmonics, sized to be worth 1–2 device pixels at dpr 1 — below that
// the wobble is real in the code and invisible on screen, which is the same as not having drawn it.
// The first is once per turn, so the ring is fractionally lopsided rather than merely bumpy, which
// is what a freehand loop actually is.
function wobble(angle: number): number {
  return (
    1 +
    0.03 * Math.sin(angle + 0.42) +
    0.024 * Math.sin(3 * angle + 1.15) +
    0.014 * Math.sin(5 * angle + 2.66)
  );
}

// The last sixth of the stroke, swinging outward so the tail crosses its own head and lifts into
// open paper. The crossing is what says a hand drew this rather than a path generator; it happens
// on the far arc, above the head, where nothing else in the frame is.
function hook(t: number): number {
  const into = (t - HOOK_FROM) / (1 - HOOK_FROM);
  return into <= 0 ? 0 : HOOK * into ** 1.2;
}

// The band's width around the ellipse. `ends` is the perspective and the nib at once: a flat ring
// shows its full width at the left and right extremes and none of it at the near and far arcs, and
// a pen dragged round a small loop is heaviest where the wrist is turning through. `lean` makes one
// of the two ends heavier than the other, and `tremor` keeps the variation local — without it the
// weight is a clean twice-per-turn curve, which reads as a gradient applied to a line rather than
// as a nib.
//
// `taper` is separate and does something else: it thins the stroke through the whole overshoot, so
// the finish crosses its own start as a whisker over a line instead of pooling into a slab where
// the two runs overlap.
function nib(angle: number, t: number): number {
  const ends = 0.5 + 0.5 * Math.cos(2 * angle);
  const lean = 0.5 + 0.5 * Math.cos(angle - LEAN);
  const tremor = 0.5 + 0.5 * Math.cos(3 * angle + 0.8);
  const weight = HAIR + (NIB - HAIR) * (0.58 * ends + 0.18 * lean + 0.24 * tremor);
  const taper = Math.min(1, 0.3 + t / 0.06, 0.22 + (1 - t) / 0.3);
  return Math.max(WISP, weight * taper) * point(t);
}

// The touch-down and the lift, each a short taper to a point. A blunt end reads as a broken line;
// a taper is the one place a stroke is allowed under a pixel, because it is a point and not a line
// that came out too thin.
function point(t: number): number {
  return Math.min(1, 0.08 + t / 0.022, 0.05 + (1 - t) / 0.034);
}

export default halo;
