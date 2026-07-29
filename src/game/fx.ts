import type { Vec2 } from "../lobby/protocol";

// The cartoon-FX layer #78 asks for. Speed lines trailing a shot (#114) are the first slice of it;
// the starburst on impact (#115) and the ink puff on death (#116) belong here beside them.
//
// Geometry and nothing else, in the idiom `edgeMarker.ts` and `minimap.ts` already use: this module
// says where the ink goes and `draw.ts` puts it there. That is what lets every claim below be
// checked without a canvas, a spy or a frame.
//
// Nothing here ages. A shot already carries the `at` it is drawn from and `SHOT_LINE_MS` retires it,
// so speed lines need no life of their own. #115 and #116 both do — each is spawned by an event and
// outlives it — and that lifecycle is deliberately not built here: `floats.ts` is the precedent for
// it, and inventing one now would be a shape guessed at from two tickets nobody has written yet.

// The break, in world units: ink, then paper. A shot is instantaneous — #80 is deferred, so nothing
// about it travels — and the breaks are the whole of what makes it read as fast rather than as a
// ruled line.
//
// The period is a cost as much as a look, and the cost is **per stroke, not per inked pixel** —
// the opposite of what a shot's price has meant until now (`docs/frame-budget.md` rule 1). Measured
// at 50 concurrent shots, dpr 2, software rasterisation: a plain line is one stroke and 1.64 ms; the
// same mark broken at 18/12 is ~35 strokes a shot and 4.88 ms, and at 40/26 with this trail ~11 and
// 2.47 ms. 52/32 is ~9. A finer break buys a difference the eye has to hunt for and charges the
// frame's dearest layer for it, so the coarse one ships.
//
// Coarser has a floor: past about 64/38 each trailing strand on a mid-range shot collapses to one
// unbroken stroke, and two of those converging read as an arrowhead rather than as speed.
// Provisional as a look; the arithmetic is not.
export const SHOT_DASH = 52;
export const SHOT_GAP = 32;

// Each trailing strand: how far it stands off the shot's own line in world units, and the stretch of
// that line it runs beside, as a fraction of the shot's length. Every strand closes back onto the
// line at its far end, so the bundle narrows into the head rather than running parallel into it.
//
// Asymmetric on purpose, and not for texture. Struck symmetrically the strands close on one point
// and stamp an arrowhead at the far end of the line, which reads as a mark on what was hit; where
// the line stops is the only thing it is allowed to say (ADR 0003 §3). Staggered, they narrow onto
// the line and leave the head the plain end it has always been.
//
// They sit in the far third because that is where a trail belongs — the shot is at the head and the
// lines are what it left behind — and short because a strand is charged for like the line itself.
// The stand-offs are wide enough that at dpr 1 the strands stay separate 2 px marks rather than one
// smear, which is the resolution the whole treatment has to survive. Provisional otherwise.
const TRAIL: readonly { offset: number; from: number; to: number }[] = [
  { offset: 8, from: 0.6, to: 0.9 },
  { offset: -6, from: 0.74, to: 0.96 },
];

// Below this, in world units, a shot carries no trail at all — the broken line alone. Derived from
// the dash rather than picked, so a retune of either number carries it: it is the shortest shot
// whose longest strand is a whole dash. Any shorter and every strand is a stub of one, which lands
// as a blot beside the muzzle rather than reading as motion — and a point-blank shot at a spider
// already on top of you is exactly that short.
export const TRAIL_MIN_LENGTH = SHOT_DASH / Math.max(...TRAIL.map((s) => s.to - s.from));

// One stroke of a shot's mark, in world coordinates.
export interface Strand {
  from: Vec2;
  to: Vec2;
}

// Every stroke a shot is struck as: the broken run along the line it was fired on, then the speed
// lines trailing it. Stroked as one path, they are what #114 asks for in place of M5's continuous
// ink line.
export function speedLines(from: Vec2, to: Vec2): Strand[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const struck: Strand[] = [];
  if (length === 0) return struck;
  const offX = -dy / length;
  const offY = dx / length;

  // A point on the shot: `at` is how far along it as a fraction, `off` how far it stands to one side
  // in world units. Interpolated between the shot's own two points rather than stepped along a unit
  // vector, so `at` 0 and 1 come back as `from` and `to` themselves — checked over the whole 31,200²
  // arena, 500,000 shots, not one of them off by a bit.
  const point = (at: number, off: number): Vec2 => ({
    x: from.x + dx * at + offX * off,
    y: from.y + dy * at + offY * off,
  });

  // One broken run between two points on the shot, standing `offset` off the line where it begins
  // and closing onto it where it ends.
  //
  // The dash and the gap are stretched together until a whole number of them spans the run exactly,
  // so both of its ends are its own. Stepped at a fixed period instead, a run stops wherever the
  // last whole dash happens to land, which for a shot of the wrong length leaves the mark short of
  // what it struck.
  //
  // The last dash is closed on `endAt` rather than on the arithmetic that should reach it: fitting
  // the break divides by the shot's length and multiplies it back, which lands a bit short for about
  // 0.7% of shots — 2,177 of 300,000 swept across the arena, and none at all with this line in.
  const run = (offset: number, startAt: number, endAt: number): void => {
    const span = length * (endAt - startAt);
    const count = Math.max(1, Math.round((span + SHOT_GAP) / (SHOT_DASH + SHOT_GAP)));
    const scale = span / (count * SHOT_DASH + (count - 1) * SHOT_GAP);
    const dash = (SHOT_DASH * scale) / length;
    const step = ((SHOT_DASH + SHOT_GAP) * scale) / length;
    const stand = (at: number) => offset * (1 - (at - startAt) / (endAt - startAt));
    for (let i = 0; i < count; i++) {
      const at = startAt + i * step;
      struck.push({
        from: point(at, stand(at)),
        to: i === count - 1 ? point(endAt, 0) : point(at + dash, stand(at + dash)),
      });
    }
  };

  run(0, 0, 1);
  if (length < TRAIL_MIN_LENGTH) return struck;
  for (const strand of TRAIL) run(strand.offset, strand.from, strand.to);
  return struck;
}
