import type { SpriteSubject } from "./sheet";

// The arena's perimeter — the inside of a room (#76 §3), tiled one segment at a time along each
// visible edge, plus the escape door the run switches to where it crosses the exit.
//
// **The unfolded box is the whole idea.** #76 §2 makes this the one deliberate exception to the
// game's orthographic projection: the four walls lean away from the middle of the room and lie
// flat, like a carton cut at the corners and pressed open. So there is one drawing, in *wall
// space* — `u` along the perimeter, `v` from the wall's top edge down to its base — and four rigid
// rotations of it, each turned so the top points outward and the base sits against the floor. The
// cap is always on the far side and the base always meets the floor, which is what makes the four
// edges read as one room rather than four unrelated fences: at the south edge the cap is at the
// *bottom* of the screen, the opposite of every other wall in the game.
//
// **The face carries the mass, and it is the only thing in the tile with a period.** Three drawings
// put the weight in a thick cornice instead, and every one of them read as trim: with the face at
// the floor's own value, the only part that is actually *wall* did not occupy space. The face is now
// two thirds of the band and hatched to a mid grey, and everything else is a rule that bounds it.
//
// **The tile has no interior event at all, and that is the point.** It carried a pier for two
// drawings, put there because an earlier featureless version measured dead flat across a 720 px run.
// The pier fixed that and introduced something worse: a bay enclosed on four sides by solid black is
// a closed region, gestalt closure fires before anything else, and a run read as twenty-four cells —
// a strip of film. With the pier gone and the hatch phase-continuous across the join, a run has
// **no 30 px event whatever** and reads as one unbroken length of wall. Rhythm, if it is wanted
// later, belongs at a longer period in variants the caller cycles, not in every single box.
//
// **It must not be read as a buildable wall**, which shares the 30 px box and is often on screen
// beside it. That one is masonry: coarse white bricks in a staggered bond, ink-light. This is fine,
// grey and diagonal. Confirmed at every round — "different frequency, different value, different
// material".
//
// Every band edge is an integer and axis-aligned, which is where this style gets hard black for
// nothing (#77 §4). Only the hatch is diagonal, and it is meant to carry grey.

const SIZE = 30; // TILE × 2 (src/game/build.ts) — the perimeter band, and the run's step

const INK = "#000";
const PAPER = "#fff";

// (u, v) → (x, y) for each edge, as `ctx.transform` takes it. All four determinants are +1: these
// are rotations, not mirrors, so it is one rigid wall shown four ways. `v = 0` lands on the box
// edge furthest from the middle of the arena and `v = SIZE` on the edge that meets the floor.
const UNFOLD: [number, number, number, number, number, number][] = [
  [1, 0, 0, 1, 0, 0], // N — top of the wall up the screen
  [0, 1, -1, 0, SIZE, 0], // E — top of the wall to the right
  [-1, 0, 0, -1, SIZE, SIZE], // S — top of the wall down the screen, the near wall
  [0, -1, 1, 0, 0, SIZE], // W — top of the wall to the left
];

// Facings 0–3 are the four walls; 4–7 are the same four edges with the door in them, so the caller
// asks for `DOOR + facing` where the run crosses the exit.
//
// **The door needs that edge.** The wall's profile is asymmetric top to bottom, so a tile that
// cannot tell which way is up is invariant under a vertical flip, and no vflip-invariant tile can
// line up with both ends of an asymmetric wall. That is arithmetic, not taste, and it is why two
// earlier orientation-free plates read as a punched grille and then as a bar of chocolate.
const DOOR = 4;

// The wall: a cap over a hatched face over a base. **One solid base, not a moulding** — it was a
// rule over white over a line, and run for 936 units that is a printed double rule, the strongest
// certificate-border cue on the sheet.
//
// **The cap and the base must never weigh the same.** They did, at 5 px each, and the tile came out
// symmetric about its own middle: nothing in it said which edge was coping and which was floor, the
// north and south drawings were structurally identical, and a band that is the same at both edges is
// a printed rule rather than a wall standing in a room. The unfolded box was asserted and not drawn.
// So the cap outweighs the base and carries a white reveal beneath it — a projecting coping throws a
// line of light, a skirting does not. It costs two pixels, runs the full length so it cannot
// reintroduce a tile beat, and it is the one thing that tells a player which way is up.
const CAP = 6;
const REVEAL = 1; // the white under the coping; the wall's only top-to-bottom asymmetry
const FACE = CAP + REVEAL;
const BASE = 26; // the face stops here and the base runs to the bottom of the box

// The face, hatched. Hatching is granted on large structures by #76 §1, and this is the largest
// structure in the game.
//
// **It has to be tone, and it has to be diagonal.** Attempts that put marks *along* the run read as
// sprocket holes, a comb, and a measuring tape in turn; bold diagonals at 2 px on a 6 px pitch read
// as hazard tape. A diagonal is the one direction the box's own axes do not offer, and it has to be
// fine and close enough that the eye stops resolving strokes and sees a value.
//
// **One weight, one length, one pitch.** Cycling any of them to look hand-laid reads as a repeating
// cluster of unlike marks — a stamped pattern, not a hatch. A hatch is a uniform family.
//
// The pitch divides the box and the strokes run many pitches, so the family is phase-continuous and
// a run has no locatable seam: measured, every face column of a butted run carries identical ink.
// The width is above 1 px because a 1 px stroke is a whole device pixel at dpr 1 and two at dpr 2,
// and the rasteriser drops far more of the first — which made the wall half again as dark on a
// retina display as on an ordinary one.
const HATCH_PITCH = 5;
const HATCH_WIDTH = 1.5;

// The escape door. The exit is 936 world units along its wall (`EXIT_LONG_FRAC`, src/game/world.ts),
// so this variant is tiled about 31 times in a row and every part of it has to survive repetition:
// it is a *length of gate*, not a picture of a door.
//
// What makes it a door rather than a hole is that the wall does not stop at it: the cap runs on
// above and thickens into a head deep enough to read as a lintel, and the base continues at exactly
// the wall's own depth, so the room's floor line never breaks.
//
// **The gate is a mass, not a set of bars.** With 2 px joints on a 6 px pitch it was a third white
// in full-height slots — something you can see through, which is the one thing an escape door must
// not be. Hairline joints on a wide pitch keep it near solid, the **ledger** is solid ink and is
// painted over the joints so it interrupts them the way a real brace crosses boards, and the joint
// pitch divides the box with every board the same width, so there is no doubled stile at the seam
// and no 30 px beat.
const DOOR_HEAD = 8;
const DOOR_SOFFIT = 2; // the lit underside of the lintel; 1 px does not separate at dpr 1
const GATE = DOOR_HEAD + DOOR_SOFFIT;
const BOARD_PITCH = 10;
const BOARD_PHASE = 4; // clear of columns 0 and 29, and every board comes out 9 px wide
const BOARD_JOINT = 1;
// The ledger is **hatched, not inked**. Painted in solid ink on a solid ink gate it was invisible as
// a member — all it did was interrupt the joints, which left the boarding reading as two rows of
// ticks. Given the wall's own value it becomes a timber lying across the boards, which is the whole
// job of a brace and the thing that stops a run of planks being a run of stripes.
const LEDGER_AT = GATE + 5; // off centre, so the gate is not symmetric either
const LEDGER_HEIGHT = 3;

const room: SpriteSubject = {
  name: "room",
  size: SIZE,
  facings: 8,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.save();
    ctx.transform(...UNFOLD[facing % UNFOLD.length]);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, size, CAP);
    ctx.fillRect(0, BASE, size, size - BASE);
    if (facing < DOOR) hatch(ctx, size, FACE, BASE);
    else drawGate(ctx, size);
    ctx.restore();
  },
};

// One 45° family drawn across the whole box and clipped to a band, so every band the sprite hatches
// — the wall's face and the gate's ledger — belongs to the same continuous set of strokes rather than
// each starting its own. Strokes begin a box-length before the left edge, so one that entered the
// neighbour's right edge is drawn here too and the family crosses a join instead of restarting at it.
function hatch(ctx: CanvasRenderingContext2D, size: number, top: number, bottom: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, size, bottom - top);
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.beginPath();
  for (let u = -size; u < size; u += HATCH_PITCH) {
    ctx.moveTo(u, 0);
    ctx.lineTo(u + size, size);
  }
  ctx.stroke();
  ctx.restore();
}

function drawGate(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillRect(0, 0, size, DOOR_HEAD);
  ctx.fillRect(0, GATE, size, BASE - GATE);

  ctx.fillStyle = PAPER;
  for (let u = BOARD_PHASE; u < size; u += BOARD_PITCH) {
    ctx.fillRect(u, GATE, BOARD_JOINT, BASE - GATE);
  }
  ctx.fillRect(0, LEDGER_AT, size, LEDGER_HEIGHT);
  hatch(ctx, size, LEDGER_AT, LEDGER_AT + LEDGER_HEIGHT);
}

export default room;
