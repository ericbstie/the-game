import type { Vec2 } from "../lobby/protocol";

// The cartoon-FX layer #78 asks for. Speed lines trailing a shot (#114) are the first slice of it;
// the starburst on impact (#115) and the ink puff on death (#116) belong here beside them.
//
// Geometry and nothing else, in the idiom `edgeMarker.ts` and `minimap.ts` already use: this module
// says where the ink goes and `draw.ts` puts it there. That is what lets every claim below be
// checked without a canvas, a spy or a frame.
//
// Nothing here ages, the starburst and the puff included. A shot is no longer aged on a clock at
// all — since #80 it is a body the sim carries, and `ClientWorld.renderProjectiles` strikes it for
// as long as the server still has it in the air; an impact's mark carries the instant its hit
// arrived and `ClientWorld.impactMarks` retires it; a death's mark carries the instant its enemy
// was taken off the stream and `ClientWorld.deathMarks` retires it. The lifecycle #114 left
// unwritten went there rather than here, because the two things it needs are both private to that
// class — the delta the mark is spawned from, and `ENEMY_RENDER_DELAY_MS`, the clock it has to be
// judged on. What is left for this module is what it was always for: where the ink goes.

// The break, in world units: ink, then paper. #114 struck it down the whole of a shot's line, when
// a shot was instantaneous and the breaks were the whole of what made it read as fast rather than
// as a ruled one. #80 gave the shot a body that travels, and the mark became a streak of exactly one
// `SHOT_DASH` behind it (`draw.ts` `SHOT_STREAK`) — so what the dash sets in the game today is the
// *length* of that streak, which `run` below fits as a single unbroken stroke with no trail. The
// period still governs the longer marks struck through here, which is what the ink instruments
// price a full-reach shot at.
//
// The period is a cost as much as a look, and the cost is **per stroke, not per inked pixel** —
// the opposite of what a shot's price had meant until then (`docs/frame-budget.md` rule 1).
// Measured on the full-length mark at 50 concurrent shots, dpr 2, software rasterisation: a plain
// line is one stroke and 1.64 ms; the same mark broken at 18/12 is ~35 strokes a shot and 4.88 ms,
// and at 40/26 with this trail ~11 and 2.47 ms. 52/32 is ~9. A finer break buys a difference the
// eye has to hunt for and charges the frame's dearest layer for it, so the coarse one ships.
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

// The starburst struck where a shot connects (#115): spikes radiating from the point of the blow,
// alternately long and short so the ring reads as a star rather than as a wheel.
//
// **Spikes and not a filled star, and this is the whole reason it is affordable.** A shot is charged
// per stroke rather than per inked pixel (`docs/frame-budget.md` rule 1), and a burst fires on every
// connect rather than on every death — so the mark that could be drawn at that rate is the one made
// of a handful of short strokes with nothing inside it. It is also the one that can be drawn *over*
// a spider without hiding it, which a filled field cannot be. #79's lettered burst is the other
// shape for the other reason: letters need a field to sit on. The two are not one mark.
//
// Struck in ink like every other mark the game lays, and legible over the spider it belongs to for
// the same window it exists in: #107 has that spider inverted to paper for exactly `HIT_FLASH_MS`
// off the same event and the same delayed clock, so the burst lands on white whatever the spider is
// drawn as the rest of the time.

// The spikes, and how far out each kind of them reaches, in world units. Eight because four long
// points and four short ones between them is the mark; the count is the cost, so it is the lever if
// this ever has to get cheaper.
const BURST_SPIKES = 8;
// How far a long spike reaches. Provisional as a look: at 30 the mark stands a little wider than a
// grunt (32 across) and inside an elite (48), so it frames the one and marks the other.
export const BURST_REACH = 30;
// The short spikes between them, and the open middle every spike starts at. The middle is open so
// the burst reads as a mark *around* the blow rather than as a blot over the thing that took it —
// which is also what leaves #107's white spider showing through the frames they share.
const BURST_SHORT = 15;
const BURST_INNER = 7;

// **The long spikes are the diagonal ones, and that is not a taste.** A damaged spider carries a
// health bar directly above its sprite, exactly as wide as the sprite is tall (`paintEnemy`), and
// the burst paints over the Y-sort — so anything it strikes above the sprite is struck over the one
// damage readout the game has (#81), at the moment the player is reading it. On the diagonal a
// spike stands as far out sideways as it does upward, so it is already clear of the bar's width
// before it is above the bar's underside, and it can be as long as it likes. On the axis it has no
// width at all to clear with, so it stops short of the sprite instead.
export function starburst(at: Vec2): Strand[] {
  const struck: Strand[] = [];
  for (let i = 0; i < BURST_SPIKES; i++) {
    const bearing = (i * 2 * Math.PI) / BURST_SPIKES;
    const out = i % 2 === 1 ? BURST_REACH : BURST_SHORT;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    struck.push({
      from: { x: at.x + dx * BURST_INNER, y: at.y + dy * BURST_INNER },
      to: { x: at.x + dx * out, y: at.y + dy * out },
    });
  }
  return struck;
}

// The ink puff struck where an enemy dies (#116): a ring of overlapping lobes, each drawn only over
// the stretch of itself that the ring does not already cover, so the whole is one scalloped cloud.
//
// **An outline and not a blot, for the reason the burst is spikes.** A shot is charged per stroke
// rather than per inked pixel (`docs/frame-budget.md` rule 1), so what a mark costs is how many
// pieces it is struck in — six arcs here, against a burst's eight segments. Filled, it would be the
// same price and a different drawing: a solid mass the size of the spider it replaces reads as a
// blot dropped on the paper, where the outline reads as something dispersing off it.
//
// **The lobes alternate large and small, and that is not texture.** Equal lobes on a ring scallop
// into an even, regular cloud — a thought balloon, which is a shape a cartoon spends on speech.
// Alternating them makes the silhouette wobble between two reaches, which is what a puff of smoke
// does and a balloon does not.

// The lobes and the ring they stand on, in world units. Even on purpose: the sizes alternate, so an
// odd count would seat two of one size beside each other and put a flat spot on the outline.
const PUFF_LOBES = 6;
const PUFF_RING = 10;
// How far a lobe of each kind reaches from its own centre. Both are wide enough to cross their
// neighbours — a lobe that cleared them would leave the outline open — and the pair is what sets
// the wobble: the silhouette runs out to 19 at a large lobe and 16 at a small one, and falls back
// to 14.2 where two of them meet. Provisional as a look; that they overlap is not.
const PUFF_LARGE = 9;
const PUFF_SMALL = 6;

// How far the mark reaches from the point it is struck at, and what `drawPuffs` culls on. Derived
// from the ring and the larger lobe rather than picked, so a retune of either carries it.
export const PUFF_REACH = PUFF_RING + PUFF_LARGE;

// One lobe of a puff: a circle, and the stretch of it that is actually struck. The trim is stated
// here rather than left to the render layer because it is geometry — where two lobes cross is what
// decides it, and this module is where that arithmetic belongs.
export interface Lobe {
  at: Vec2;
  radius: number;
  from: number; // bearing in radians, and always the lesser of the two
  to: number;
}

export function inkPuff(at: Vec2): Lobe[] {
  const step = (2 * Math.PI) / PUFF_LOBES;
  // Between the centres of two lobes standing beside each other on the ring.
  const gap = 2 * PUFF_RING * Math.sin(step / 2);
  const struck: Lobe[] = [];
  for (let i = 0; i < PUFF_LOBES; i++) {
    const bearing = i * step;
    const large = i % 2 === 0;
    const radius = large ? PUFF_LARGE : PUFF_SMALL;
    const neighbour = large ? PUFF_SMALL : PUFF_LARGE;
    // Where this lobe crosses the one beside it, as an angle off the line joining their centres.
    // Both neighbours are the same size as each other — the sizes alternate — so one figure covers
    // the crossings on both sides and the arc is symmetric about the lobe's own bearing.
    const crossing = Math.acos(
      (gap * gap + radius * radius - neighbour * neighbour) / (2 * gap * radius),
    );
    // The outer crossing of the two, measured back to this lobe's own bearing. The line to the
    // neighbour leaves at `(π + step) / 2` off that bearing, and the crossing nearer the bearing is
    // the one standing away from the middle of the puff — which is the half the outline runs along.
    const half = (Math.PI + step) / 2 - crossing;
    struck.push({
      at: { x: at.x + Math.cos(bearing) * PUFF_RING, y: at.y + Math.sin(bearing) * PUFF_RING },
      radius,
      from: bearing - half,
      to: bearing + half,
    });
  }
  return struck;
}

// The mark under the pointer (#154): four corners of a square standing around the point, and
// nothing at the point itself.
//
// **A frame around the aim rather than a star on it, and that is what tells it apart from the two
// marks it will share a spot with.** A shot aimed at a spider that is being hit puts this, #115's
// burst and #116's puff within a few units of each other, struck in one pen at one width — so shape
// is the only channel left to tell them apart. Both of those radiate from their point; every stroke
// here runs *around* it, and none of them points at anything.
//
// That is also what keeps it honest about the shot. Since #80 a shot is a body the server flies, and
// it takes `PROJECTILE_FLIGHT_MS` to arrive and can miss a spider that walks out of the way — so a
// mark that reached toward the target, or led it, would promise something the sim does not. This one
// says where the pointer is, which is exactly what `aimDir` reads and all that is being claimed.
//
// The middle is left open for the reason the burst's is: what is being aimed at is what the player
// is reading, and a blot on it would be the one drawing that hides the thing it is about.

// Half the square the corners stand on, and how far each arm runs in from its corner, in world
// units. **Provisional**: at 13 the mark is 26 u across, a little under a grunt's 32 and wider than a
// 15 u tile, so it frames the cursor's tile without covering the spider standing on it; at 6 the two
// arms of a corner are unmistakably an L rather than a full box outline.
export const AIM_REACH = 13;
export const AIM_ARM = 6;

// One corner as the three points its two arms run through, so `draw.ts` strikes each as a single
// polyline and the joint mitres shut. Struck as two strands instead, the outer corner comes out
// notched by half a line width — which is the whole visual weight of a mark this size.
export function reticle(at: Vec2): Vec2[][] {
  const corners: Vec2[][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = at.x + sx * AIM_REACH;
      const y = at.y + sy * AIM_REACH;
      corners.push([
        { x: x - sx * AIM_ARM, y },
        { x, y },
        { x, y: y - sy * AIM_ARM },
      ]);
    }
  }
  return corners;
}
