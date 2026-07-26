import type { SpriteSubject } from "./sheet";

// The arena's perimeter — the inside of a room (#76 §3), tiled one segment at a time along each
// visible edge, plus the escape door the run switches to where it crosses the exit.
//
// **The unfolded box is the whole idea.** #76 §2 makes this the one deliberate exception to the
// game's orthographic projection: the four walls lean away from the middle of the room and lie
// flat, like a carton cut at the corners and pressed open. So there is one drawing, in *wall
// space* — `u` along the perimeter, `v` from the wall's top edge down to its base — and four rigid
// rotations of it, each turned so the top points outward and the base sits against the floor. The
// cornice is always on the far side and the skirting always on the floor side, which is what makes
// the four edges read as one room rather than four unrelated fences: at the south edge the heavy
// band is at the *bottom* of the screen, the opposite of every other wall in the game.
//
// **The mass is outboard and the face is light.** The cornice takes 12 of the 30 px and sits on the
// far side, which is the boundary of the play space and the half nobody's feet reach. The face is
// paper under a light hatch, so ink entities still read against it.
//
// **It is opaque, corner to corner.** The band is fully covered — no transparent pixel — for two
// reasons: it joins the Y-sort, so the near wall has to actually hide the legs of a player standing
// against it; and the run draws both an N and a W segment into the same box at each corner, where
// an opaque later segment simply covers the earlier one instead of crossing it into a mesh.
//
// **Nothing in the drawing has a period of 30.** A run repeats every segment, so anything that
// varies along `u` becomes the same "accident" every 30 px in a line — the trap `wall.review.md`
// documents. Every band therefore runs the full length and continues straight through a join, and
// the only along-run rhythm, the hatch, has a pitch that divides the box, so the stroke a neighbour
// starts at its own column 0 is the next member of this one's family rather than a second stroke
// beside it. All the hand is in the profile down `v`, which is free.
//
// **It must not be read as a buildable wall**, which shares the 30 px box and is often on screen
// beside it. That one is masonry: a *light* field of white bricks in a staggered bond at pitch 10,
// 44% ink. This is its inverse — 63% ink, a solid black cornice over a hatched grey face, and no
// bond anywhere. Different material, different tone, different scale of mark.
//
// Every edge is an integer and every band is axis-aligned, which is where this style gets hard
// black for nothing (#77 §4). Only the door's studs curve.

const SIZE = 30; // TILE × 2 (src/game/build.ts) — the perimeter band, and the run's step

const INK = "#000";
const PAPER = "#fff";

// (u, v) → (x, y) for each edge, as `ctx.transform` takes it. All four determinants are +1: these
// are rotations, not mirrors, so it is one rigid wall shown four ways. `v = 0` lands on the box
// edge furthest from the middle of the arena and `v = SIZE` on the edge that meets the floor.
const UNFOLD: [number, number, number, number, number, number][] = [
  [1, 0, 0, 1, 0, 0], // 0 N — top of the wall up the screen
  [0, 1, -1, 0, SIZE, 0], // 1 E — top of the wall to the right
  [-1, 0, 0, -1, SIZE, SIZE], // 2 S — top of the wall down the screen, the near wall
  [0, -1, 1, 0, 0, SIZE], // 3 W — top of the wall to the left
];

const DOOR = 4;

// Ink bands down the wall, `[v, height]`. Each runs the full length of the segment, so it passes
// straight through a join and a run has one unbroken profile. The whites between them are the
// fillet under the cornice, the plaster face, and the skirting board's own face.
//
// **Two thirds of the band is ink, and all of it is outboard.** The first version put a 7 px cornice
// on a mostly-white band and, rendered as a butted run on white paper, read as a decorative rule —
// no heavier than the moulding round a page. The mass has to be there, and the far side is where it
// belongs: it is the edge of the play space, and it is the half nobody's feet ever reach.
//
// The weights are a hierarchy — cornice 12 > ground line 3 > moulding 1 — because this style is a
// heavy outer contour holding lighter interior detail, and one uniform stroke reads as CAD linework.
const BANDS: [v: number, height: number][] = [
  [0, 12], // the cornice: the top of the wall, and where all the weight lives
  [24, 2], // the top edge of the skirting board
  [27, 3], // the shadow where the skirting meets the floor — the room's ground line
];

// A pier every segment, carrying the cornice down onto the skirting. It exists because the review
// measured the first hatched version and found **every column of a 720 px run carried identical
// ink** — dead flat, which is why a run read as milled edging rather than as a wall. Horizontal
// bands alone are an extrusion; a wall needs a beat. This is the beat, and it is one per segment
// because that is the only pitch a bay can have when the box is the bay.
//
// It is off centre, so the tile has no axis of symmetry, and it stops on the skirting rather than
// running to the floor, so the bays it makes are wide, shallow and hatched — a panelled bay, not the
// tall empty cell that reads as a window.
const PIER_AT = 12;
const PIER_WIDTH = 3;
const PIER_TOP = 12; // the underside of the cornice, so the pier hangs off it
const PIER_BOTTOM = 24; // the top edge of the skirting, so the pier lands on something

// The face, hatched — the shade that separates a vertical surface from the white paper floor.
// Hatching is granted on large structures by #76 §1, and this is the largest structure in the game.
//
// **It has to be tone, and it has to be diagonal.** Three earlier attempts put marks *along* the
// run — panelled cells, then scribe lines, then upright hatching — and every one of them failed the
// same way: a single row of identical marks under a heavy black band is a **ruler**, and varying
// their lengths made it a better ruler rather than a worse one. Thirty pixels of depth leaves room
// for horizontal bands or for one row of marks and nothing else, so the only field that reads as
// material here is one that runs across both. A diagonal is the one direction the box's own axes do
// not offer, which is why it resolves as a shade instead of as its strokes — and shading a plane is
// the whole reason to draw one.
//
// The strokes are 1 CSS px, never less; below that a stroke stops being a stroke and turns into a
// grey smear. They are the only thing here that is not axis-aligned, so they are the only ink on the
// sheet that anti-aliases, and that is what makes the band read as grey rather than as stripes.
// The pitch divides the box, so the family carries on through a join at its own spacing.
//
// The weights alternate and every third stroke overshoots the band, because the review found the
// even version — one width, one angle, one period, cut off flush at both rules — to be the sheet's
// loudest generated-imagery tell. Both cycles have a length that divides the box, so a neighbour
// continues this one's alternation rather than restarting it.
const HATCH_TOP = 14;
const HATCH_BOTTOM = 24;
const HATCH_PITCH = 5;
const HATCH_HEAVY = 2; // every other stroke, so the field is not one uniform weight
const HATCH_OVERSHOOT = 3; // every third stroke runs past the rule instead of stopping on it

// The escape door. The exit is 936 world units along its wall (`EXIT_LONG_FRAC`, src/game/world.ts),
// so this variant is tiled about 31 times in a row — one drawing of a door leaf would read as 31
// doors. It is therefore a single unbroken plate: solid ink full depth, studded, so any number of
// them butt into one long riveted gate. The wall's white face stopping dead against a full-depth
// black plate is the jamb, and the studs are what keep the plate a made thing rather than a hole.
//
// It is deliberately symmetric under a quarter turn, which is the one choice on this sheet made
// against taste. `drawWorld` asks for facing 4 whatever edge the exit falls on, so an oriented door
// would be drawn sideways on three walls out of four; a plate with no top is the only door that
// survives that. See `room.review.md` — a lintel, a threshold and jambs all need an orientation this
// sprite is never handed, and every one of them is what the review asked for.
//
// **Strapwork, not rivets.** The first plate was studded with white discs and the review read it as
// punched holes with the floor showing through — the signature of a void, which is the one thing the
// door must not be. Straps are axis-aligned, so unlike a disc they stay hard-edged at every ratio;
// they cross in both axes, which is what a quarter-turn symmetry forces and what a strapped gate
// happens to have anyway; and at this width they bring the plate to the same 64% ink as the wall, so
// the door no longer reads as a heavier mass punched through it. The strap positions are mirrored
// about the box's centre, which is what makes the quarter turn exact, and their pitch divides the
// box, so a run of them is one gate rather than 31 doors. The plate stays solid ink at all four
// edges, so the wall's ground line carries straight on through the door as its threshold.
const STRAP_AT = 13;
const STRAP_WIDTH = 4;

const room: SpriteSubject = {
  name: "room",
  size: SIZE,
  facings: 5,
  frames: 1,
  draw(ctx, size, facing) {
    if (facing >= DOOR) {
      drawDoor(ctx, size);
      return;
    }

    ctx.save();
    ctx.transform(...UNFOLD[facing]);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = INK;
    for (const [v, height] of BANDS) ctx.fillRect(0, v, size, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HATCH_TOP - 1, size, HATCH_BOTTOM - HATCH_TOP + 2);
    ctx.clip();
    ctx.strokeStyle = INK;
    for (let k = -3; k * HATCH_PITCH < size; k++) {
      const top = HATCH_TOP - (mod(k, HATCH_OVERSHOOT) === 0 ? 1 : 0);
      const foot = HATCH_BOTTOM + 1;
      ctx.lineWidth = mod(k, HATCH_HEAVY) === 0 ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(k * HATCH_PITCH, top);
      ctx.lineTo(k * HATCH_PITCH + foot - top, foot);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillRect(PIER_AT, PIER_TOP, PIER_WIDTH, PIER_BOTTOM - PIER_TOP);
    ctx.restore();
  },
};

function drawDoor(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, STRAP_AT, size, STRAP_WIDTH);
  ctx.fillRect(STRAP_AT, 0, STRAP_WIDTH, size);
}

// Positive remainder, because the hatch is indexed from before the box's left edge and JavaScript's
// `%` keeps the sign — which would break the alternation exactly where a run crosses a join.
function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

export default room;
