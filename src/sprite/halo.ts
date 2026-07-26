import type { SpriteSubject } from "./sheet";

// The self marker, painted behind your own avatar and centred on its body.
//
// One is on screen at a time — yours — and it has to be found instantly among six identical
// figures and a wave of spiders. The floor is white paper, and that is the whole problem: #76
// grants this sprite a glow "barely yellow, mostly white", and a mostly-white glow on white paper
// has almost no value contrast to spend. So the warmth is not what finds you.
//
// The ink is. A brushed circle drawn *around* the figure is a shape nothing else in the set has —
// the spiders radiate, the buildings are boxes, the ore is tiles — and it is the era's own device:
// the iris that closes on a character at the end of a 1930s short. It is drawn as one continuous
// stroke that overshoots and cuts back across its own head, the way a hand circles something on
// paper, which is also what keeps the most naturally symmetric shape in the set off the symmetry
// that gives generated art away.
//
// The warm plate underneath is the glow, and it is a second channel the ink cannot reach: in a
// black-and-white game the only other colour is power ore's red. It is printed *out of register*
// with the black rather than blurred under it — a soft radial bloom is a modern glow filter and
// reads as one, while a flat tint plate a pixel off its black plate is what a two-colour press of
// the period actually did.

const SIZE = 44; // 1.57× the player's 28 — see halo.review.md
const RADIUS = 0.375; // of the box: the ring clears the figure rather than cutting across it

const INK = "#111111";
const WARM = "255, 246, 208"; // barely yellow, and only ever laid down at low alpha over paper
// Three flat tone steps rather than a gradient: a tint ladder is how the era printed a glow, and
// the strongest step sits inside the ring so the light reads as coming off the figure.
const PLATE = [
  { grow: 2.0, alpha: 0.15 },
  { grow: -0.4, alpha: 0.2 },
  { grow: -3.2, alpha: 0.26 },
];
const REGISTER = { x: -0.6, y: -0.7 }; // how far the warm plate misses the black one

const NIB = 2.35; // heaviest, on the diagonal a right hand pulls the pen along
const HAIR = 1.15; // lightest; never under 1 logical px, which smears instead of drawing
const NIB_AXIS = 2.36; // ~3π/4 — heavy at lower-left and upper-right, light between

const START = 3.46; // where the pen went down, off every axis
const OVERSHOOT = 0.52; // and how far past that it ran before lifting
const DRIFT = 0.13; // no hand closes a circle on itself; the stroke spirals out as it goes
const HOOK = 3.2; // then cuts back inside, crossing the stroke it started with

const STEPS = 240;

const halo: SpriteSubject = {
  name: "halo",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    const cx = size / 2 + 0.25; // off true by a quarter pixel, like everything else here
    const cy = size / 2 - 0.2;
    const base = size * RADIUS;
    const wobble = (angle: number) =>
      base *
      (1 +
        0.026 * Math.sin(angle + 0.42) +
        0.022 * Math.sin(3 * angle + 1.15) +
        0.014 * Math.sin(5 * angle + 2.66));

    for (const step of PLATE) {
      ctx.fillStyle = `rgba(${WARM}, ${step.alpha})`;
      ctx.beginPath();
      trace(ctx, cx + REGISTER.x, cy + REGISTER.y, 0, Math.PI * 2, (a) => wobble(a) + step.grow);
      ctx.closePath();
      ctx.fill();
    }

    const sweep = Math.PI * 2 + OVERSHOOT;
    const outer = (angle: number, t: number) => wobble(angle) * (1 + DRIFT * (t - 0.5)) - hook(t);
    ctx.fillStyle = INK;
    ctx.beginPath();
    trace(ctx, cx, cy, START, sweep, outer);
    trace(ctx, cx, cy, START + sweep, -sweep, (angle, t) => {
      const along = 1 - t;
      return outer(angle, along) - nib(angle, along);
    });
    ctx.closePath();
    ctx.fill();
  },
};

// Sample an angular span into the current path, moving to the first point only when the path is
// still empty. Both edges of the stroke come off this, which is the only way to vary a line's
// width along its length: canvas has one `lineWidth` for the whole call, and a ring of constant
// width reads as CAD linework rather than as a pen.
function trace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  from: number,
  sweep: number,
  radius: (angle: number, t: number) => number,
): void {
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = from + t * sweep;
    const r = radius(angle, t);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0 && from !== START + sweep) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

// The last tenth of the stroke, turning in hard so the tail passes inside the head instead of
// meeting it — the crossing is what says a hand drew this and not a compass.
function hook(t: number): number {
  const into = (t - 0.9) / 0.1;
  return into <= 0 ? 0 : HOOK * into ** 1.5;
}

// The pen's weight around the circle: heavy twice per turn on the nib's axis, and heavier on one
// of those two than the other so the ring is not symmetric about its own diagonal. `t` runs 0→1
// along the stroke and thins the ink at both ends, where the pen touched down and lifted.
function nib(angle: number, t: number): number {
  const heavy = 0.5 + 0.5 * Math.cos(2 * (angle - NIB_AXIS));
  const lean = 0.5 + 0.5 * Math.cos(angle - 1.9);
  const ends = Math.min(1, 0.34 + t / 0.1, 0.3 + (1 - t) / 0.13);
  return Math.max(HAIR, (HAIR + (NIB - HAIR) * heavy * (0.6 + 0.4 * lean)) * ends);
}

export default halo;
