import type { SpriteSubject } from "./sheet";

// The arena's perimeter — the inside of a room (#76 §3), tiled one segment at a time along each
// visible edge, plus the escape door the run switches to where it crosses the exit.
//
// **The unfolded box is the whole idea.** #76 §2 makes this the one deliberate exception to the
// game's orthographic projection: the four walls lean away from the middle of the room and lie
// flat, like a carton cut at the corners and pressed open. So there is one drawing, in *wall
// space* — `u` along the perimeter, `v` from the wall's top edge down to its base — and four rigid
// rotations of it, each turned so the top points outward and the base sits against the floor. The
// cap is always on the far side and the skirting always on the floor side, which is what makes the
// four edges read as one room rather than four unrelated fences: at the south edge the heavy band is
// at the *bottom* of the screen, the opposite of every other wall in the game.
//
// **The face carries the mass, and the cap is only a cap.** This was the other way round for three
// drawings and it was the thing that kept the sprite reading as trim: with a 12 px slab of cornice
// over a face that was 73% paper, the largest black shape in the sprite was its least important
// part, and the only part that is actually *wall* was the same value as the floor it stands on. A
// wall has to occupy space. So the cap is 5 px, the face is 18, and the face is hatched to about
// half ink — dark enough to separate from white paper at a glance, open enough that ink entities
// still read against it.
//
// **It is opaque, corner to corner.** The band is fully covered — no transparent pixel — for two
// reasons: it joins the Y-sort, so the near wall has to actually hide the legs of a player standing
// against it; and the run draws both an N and a W segment into the same box at each corner, where
// an opaque later segment simply covers the earlier one instead of crossing it into a mesh.
//
// **Nothing has a period of 30 except the pier, which is meant to.** A run repeats every segment, so
// anything that varies along `u` becomes the same "accident" every 30 px in a line — the trap
// `wall.review.md` documents. Every band therefore runs the full length and continues straight
// through a join, and the hatch's pitch divides the box while its strokes are three times longer
// than that pitch, so three of them cross any column and the family reads as continuous rather than
// as one closed cell per box. The pier is the deliberate exception: it is the bay rhythm, and a bay
// is exactly one box wide.
//
// **It must not be read as a buildable wall**, which shares the 30 px box and is often on screen
// beside it. That one is masonry: a *light* field of white bricks in a staggered bond under a solid
// black cap. This is its inverse — a dark hatched field under a thin cap, and no bond anywhere.
//
// Every edge is an integer and every band is axis-aligned, which is where this style gets hard black
// for nothing (#77 §4). Only the wall's hatch is diagonal, and it is meant to carry grey.

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
// **The door needs that edge.** The wall's profile is asymmetric top to bottom — a 5 px cap outboard
// against a 7 px floor group inboard — so a tile that cannot tell which way is up cannot line up
// with both ends of it. That is arithmetic, not taste, and it is why two earlier orientation-free
// plates read as a punched grille and then as a bar of chocolate: both had to be invariant under a
// vertical flip, and no vertically symmetric tile can meet an asymmetric wall at both edges.
const DOOR = 4;

const CAP = 5; // the wall's top edge: a cap on a surface, not the main event
const SKIRTING = 23; // where the face stops and the floor group starts

// Ink bands down the wall, `[v, height]`. Each runs the full length of the segment, so it passes
// straight through a join and a run has one unbroken profile.
//
// The weights are a hierarchy — cap 5 > ground line 3 > skirting rule 2 — because this style is a
// heavy outer contour holding lighter interior detail, and one uniform stroke reads as CAD linework.
// The 2 px of white between the skirting rule and the ground line is load-bearing and was measured:
// at 1 px it fails to separate them at dpr 1 and the whole floor group collapses into one black bar.
const BANDS: [v: number, height: number][] = [
  [0, CAP], // the cap along the top of the wall
  [SKIRTING, 2], // the top edge of the skirting board
  [27, 3], // the shadow where the skirting meets the floor — the room's ground line
];

// The face, hatched. Hatching is granted on large structures by #76 §1, and this is the largest
// structure in the game.
//
// **It has to be tone, and it has to be diagonal.** Three earlier attempts put marks *along* the run
// — panelled cells, scribe lines, upright hatching — and each failed the same way: a single row of
// identical marks under a heavy black band is a **ruler**, and varying their lengths made it a better
// ruler, not a worse one. A diagonal is the one direction the box's own axes do not offer, which is
// why it resolves as a shade instead of as its strokes.
//
// **One weight, one length, one pitch.** A fourth attempt gave the strokes cycling weights and
// lengths to look hand-laid, and a fresh reviewer measured it as three unlike marks in a repeating
// cluster — a stamped pattern rather than a hatch. A hatch is a uniform family; its irregularity has
// to come from the rasteriser, not from a cycle. The strokes are 1 CSS px, never less, because below
// that a stroke stops being a stroke and becomes a grey smear.
//
// **Fine and close, not bold and wide.** At 2 px on a 6 px pitch the same coverage read as hazard
// tape: bold alternating diagonals are a warning stripe, not shading. A hatch has to be dense enough
// that the eye stops resolving individual strokes and sees a value instead, which is the whole point
// of using one.
const HATCH_PITCH = 3; // divides the box, so the family carries straight through a join
const HATCH_WIDTH = 1;

// A pier every segment, carrying the cap down onto the skirting. It exists because a review measured
// the first hatched version and found **every column of a 720 px run carried identical ink** — dead
// flat, which is why the run read as milled edging rather than as a wall. Horizontal bands alone are
// an extrusion; a wall needs a beat, and the beat is one bay per box because the box is the bay.
//
// It is off centre, so the tile has no axis of symmetry, and it is narrow and full height: a stubby
// 4 px tab with a splayed foot was read as a thumbtack, and the aspect ratio is what fixes that.
//
// **No reveal around it.** Flanking it with white to make it stand out closed each bay into a
// discrete rectangular cell holding three slashes, which is the sprocket-hole failure returning by
// another route. A pier is the only unbroken vertical in a field of diagonals; that is enough, and
// the hatch has to run past it for the wall to stay one surface.
const PIER = { u: 11, width: 3 };

// The escape door. The exit is 936 world units along its wall (`EXIT_LONG_FRAC`, src/game/world.ts),
// so this variant is tiled about 31 times in a row and every part of it has to survive repetition:
// it is a *length of gate*, not a picture of a door.
//
// What makes it a door rather than a hole is that the wall does not stop at it. The cap runs straight
// on above and thickens into the head; the skirting rule, its white gap and the ground line all
// continue at exactly the depths the wall puts them, so the room's floor line never breaks.
//
// **The gate has to be carpentry, not stripes.** A 7 px band of vertical bars read as a vent grille,
// and the fix is three things at once: give it most of the tile's height, make the joints hairline so
// the field stays near-solid, and run a **ledger** across it — a horizontal brace is what stops a row
// of boards being a row of stripes. The boards are also laid so the black left over at the box edge
// is double width, which puts a **stile every 30 px**, the way a long boarded gate really is built;
// that stile is also the jamb where the run meets the wall.
const DOOR_HEAD = 6; // the cap, thickened into a lintel over the opening
const DOOR_SOFFIT = 2; // the lit underside of that lintel; 1 px does not separate at dpr 1
const BOARD_PITCH = 6;
const BOARD_PHASE = 4;
const BOARD_JOINT = 2;
const BOARD_STILE = 6; // black left whole at the box edge, so two neighbours make one stile
const LEDGER_AT = 5; // down from the top of the gate — off centre, so the gate is not symmetric
const LEDGER_HEIGHT = 2;

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
    if (facing < DOOR) drawWall(ctx, size);
    else drawDoor(ctx, size);
    ctx.restore();
  },
};

function drawWall(ctx: CanvasRenderingContext2D, size: number): void {
  for (const [v, height] of BANDS) ctx.fillRect(0, v, size, height);

  const drop = SKIRTING - CAP;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, CAP, size, drop);
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.beginPath();
  // From a full stroke-length before the box, so a stroke that entered the neighbour's right edge is
  // drawn here too and the family crosses the join instead of restarting at it.
  for (let u = -drop; u < size; u += HATCH_PITCH) {
    ctx.moveTo(u, CAP);
    ctx.lineTo(u + drop, SKIRTING);
  }
  ctx.stroke();
  ctx.restore();

  ctx.fillRect(PIER.u, CAP, PIER.width, drop);
}

function drawDoor(ctx: CanvasRenderingContext2D, size: number): void {
  const gate = DOOR_HEAD + DOOR_SOFFIT;
  ctx.fillRect(0, 0, size, DOOR_HEAD);
  ctx.fillRect(0, gate, size, size - gate);

  ctx.fillStyle = PAPER;
  for (let u = BOARD_PHASE; u < size - BOARD_STILE; u += BOARD_PITCH) {
    ctx.fillRect(u, gate, BOARD_JOINT, SKIRTING - gate);
  }
  ctx.fillRect(0, gate + LEDGER_AT, size, LEDGER_HEIGHT);
  // The wall's own skirting face, carried across the door so the floor line reads as one line.
  ctx.fillRect(0, SKIRTING + 2, size, 2);
}

export default room;
