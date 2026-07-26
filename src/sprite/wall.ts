import type { SpriteSubject } from "./sheet";

// The buildable barrier — the cheap slab players drop to steer a wave. Not the room perimeter.
//
// **It is a wall top, not a wall face.** A run of these is read from above: what you see most is
// the broad flat top surface, joined tile to tile into one mass, and masonry shows only where that
// mass is *cut* — on the vertical faces a neighbour is not covering. So the drawing is a pale top
// held inside dark faces, and which faces exist is a property of the run, not of the tile.
//
// **`facing` is a 4-bit neighbour mask**, not an orientation: bit 1 north, 2 east, 4 south, 8 west,
// set when another wall abuts that side. 0 is a wall standing alone with all four faces cut; 15 is
// a wall buried inside a mass with none. `drawWorld` derives it from the structure list once per
// frame (src/game/draw.ts). A face with a neighbour is drawn as nothing at all — no band, no
// keyline — which is what lets two tops merge instead of showing a seam every 30 px.
//
// **Top against side is carried by value, because there is no colour to carry it** (#76 §1). The
// top is open paper ruled with the hairline joints of its own slabs; a cut face is a solid ink mass
// with the mortar knocked out white. Roughly 10% ink against roughly 80%: they separate before any
// detail resolves, and they separate at dpr 1 as well as dpr 2 because both are flat integer fills.
//
// **The three faces are three depths, and that is the light.** The near face is deepest (8 px), the
// flanks middling (5), the far face a 3 px shadow with no brick in it at all — you barely see the
// far side of a wall from above, and pretending otherwise is what makes a top-down tile read as an
// elevation. The depths also give the sprite the line-weight hierarchy the style wants: one width
// everywhere is CAD linework, not ink.
//
// **Almost nothing in the drawing has a period of 30.** That rule is what makes a run seamless, and
// it binds harder here than before, because a run can now go *down* the screen as well as across:
//
// - Across the box everything repeats at the brick pitch (10) or the slab pitch (15), with every
//   phase clear of columns 0 and 29 — so two neighbours never double a joint into a thicker line at
//   the seam, and never leave a gap either.
// - Down the box the flank courses repeat at 10, clear of rows 0 and 29, so a vertical run carries
//   one unbroken bond exactly as a horizontal one does.
// - The **one** exception is deliberate and is the top's own bond: a running bond staggers over two
//   courses, and two courses of 15 are the box. The alternatives were worse — see `SLAB_COURSE` —
//   and the 30 is spent on the faintest marks in the sprite rather than on anything the eye finds.
//
// **Every edge is an integer.** Axis-aligned integer-edge fills are the one place this style gets
// hard black for free — 0% anti-aliasing, measured (#77 §4). Nothing here curves, so the sprite is
// pure ink at any dpr.
//
// **It has to be told apart from the miner and the turret**, which share its 30 px box, and from the
// room perimeter, which shares its size and its subject. The miner and the turret are solid ink
// masses standing clear of their box edges; this is a light field that bleeds to whichever edges are
// cut. The room wall is a diagonal grey hatch — different frequency, different value, different
// material — and it is drawn as an unfolded elevation, so its cap always points away from the middle
// of the arena while this one has no orientation at all beyond its neighbours.
//
// No damage states: #76 §5 cut them, and a health bar carries damage instead.

const SIZE = 30; // 2×2 tiles at TILE 15 (src/game/build.ts)

const INK = "#000";
const PAPER = "#fff";

// The mask bits, in the same compass order `room` numbers its four unfolded edges in. Mirrored in
// `src/game/draw.ts`, which is the only caller that builds one.
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

const JOINT = 1; // every mortar line; below 1 px at real size a stroke is a grey smear, not a line

// How deep each cut face is, foreshortened into the footprint box. The box *is* the footprint, so a
// face cannot be extruded past it and has to be read as depth instead.
const NEAR = 8; // south — the face turned toward the viewer, and the only one with two courses
const FLANK = 5; // east and west — the cut ends of a run
const FAR = 3; // north — a shadow under the far arris; no brick is visible from up here

// The top surface: slabs, ruled in hairlines. It is the largest thing in the sprite and has to stay
// the lightest, so it is joints only and no tone — a halftone here would put the top at the value of
// the room wall's hatched face and the two would collapse into each other.
//
// **The slabs are half again the size of a brick and there are only two courses of them.** Three
// courses at a pitch of 10 was drawn and thrown away: it put two full-width rules across every top,
// at the weight and the spacing of the near face's own courses, and a run came out reading as a
// brick wall seen face-on — the exact thing this drawing exists to stop being. A wall top is a
// *surface*; it gets the fewest marks that say so.
//
// The stagger costs a period of 30 down the box, since a bond repeats over two courses and two
// courses of 15 are the box. That is the one place the no-30 rule is deliberately spent, and it is
// spent on the faintest marks in the sprite: three hairlines, against a bond at 10 and a course at
// 10 on the faces, which are what the eye actually finds.
const SLAB_COURSE = 15;
const SLAB_BED = 12; // the first bed joint; 12 and 27 both sit clear of rows 0 and 29
const SLAB_HEAD_INSET = 3; // head joints stop short of the beds, so no slab shuts into a closed cell
// Each course's head joints, at a pitch of 15 and clear of columns 0 and 29.
const SLAB_HEAD: readonly (readonly number[])[] = [
  [3, 18],
  [10, 25],
];

// The near face, in two courses of unequal depth. The phases are half a brick apart, which is what
// makes it masonry rather than a lattice — a stacked bond at this size reads as a window. The pitch
// is finer than the top's slabs on purpose: a coping stone is bigger than a brick, and the two
// scales are half of what says these are different surfaces of the same building.
const BRICK = 10; // head-joint pitch along the run; divides the box, and 2/12/22 clear both edges
const NEAR_PHASE = 2; // the upper course's head joints; the lower course staggers by half a brick
const NEAR_BED = 4; // the bed joint between the two courses, measured down from the arris

// The flanks are the near face turned on its side and cut down to one course — five pixels holds a
// silhouette, a course and an arris, and nothing more. So they carry bed joints only, at the brick
// pitch, running *down* the run: a vertical stack of walls then carries one bond exactly as a
// horizontal one does. A head joint was drawn across them too and had to come out — crossing a bed
// joint in a 3 px face it made a white capital I every five pixels, which is a chain of marks and
// not a wall.
const FLANK_COURSE = BRICK;
// The first bed joint. 6, 16 and 26 clear rows 0 and 29 *and* miss the top's own bed joints at 12
// and 27 — landing on one put a white notch at each end of a black hairline and broke it into three.
const FLANK_BED = 6;

const wall: SpriteSubject = {
  name: "wall",
  size: SIZE,
  facings: 16, // the neighbour mask, whole
  frames: 1,
  draw(ctx, size, facing) {
    const cutN = (facing & NORTH) === 0;
    const cutE = (facing & EAST) === 0;
    const cutS = (facing & SOUTH) === 0;
    const cutW = (facing & WEST) === 0;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    slabs(ctx, size);

    // Order is the projection: the near face lies in front of the far one, and the cut ends of a run
    // lie in front of both. Drawn the other way round, a flank's mortar eats a notch out of the
    // corner of the band it crosses.
    if (cutN) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, size, FAR);
    }
    if (cutS) nearFace(ctx, size);
    const top = cutN ? FAR : 0;
    const bottom = size - (cutS ? NEAR : 0);
    if (cutW) flank(ctx, size, true, top, bottom);
    if (cutE) flank(ctx, size, false, top, bottom);

    // The hard outline, last of everything, because a white mortar line running out to a box edge
    // would otherwise leave a hole in the silhouette at a corner. Only cut edges get one: an edge
    // with a neighbour behind it is interior to the mass and must carry no mark whatever.
    ctx.fillStyle = INK;
    if (cutN) ctx.fillRect(0, 0, size, JOINT);
    if (cutS) ctx.fillRect(0, size - JOINT, size, JOINT);
    if (cutW) ctx.fillRect(0, 0, JOINT, size);
    if (cutE) ctx.fillRect(size - JOINT, 0, JOINT, size);
  },
};

// The top surface's own joints. Courses are indexed from -1 so the one straddling the top box edge
// is drawn here too: it is the same course the wall above ends with, and drawing it from the same
// arithmetic is what makes the two line up across the join rather than nearly line up.
function slabs(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = INK;
  for (let course = -1; course * SLAB_COURSE + SLAB_BED < size; course++) {
    const bed = SLAB_BED + course * SLAB_COURSE;
    if (bed >= 0) ctx.fillRect(0, bed, size, JOINT);
    const from = Math.max(0, bed + SLAB_HEAD_INSET);
    const to = Math.min(size, bed + SLAB_COURSE - SLAB_HEAD_INSET);
    if (to <= from) continue;
    // `course` runs negative, so the phase is taken off a remainder that cannot be.
    const phase = ((course % SLAB_HEAD.length) + SLAB_HEAD.length) % SLAB_HEAD.length;
    for (const x of SLAB_HEAD[phase]) ctx.fillRect(x, from, JOINT, to - from);
  }
}

// The near face: solid ink with the mortar knocked out of it. The arris at the top and the ground
// line at the bottom stay unbroken — a head joint reaching either would dash the silhouette at the
// brick pitch, which is a seam by another name.
function nearFace(ctx: CanvasRenderingContext2D, size: number): void {
  const top = size - NEAR;
  ctx.fillStyle = INK;
  ctx.fillRect(0, top, size, NEAR);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, top + NEAR_BED, size, JOINT);
  const upper = NEAR_BED - JOINT; // rows between the arris and the bed joint
  const lower = NEAR - NEAR_BED - 2 * JOINT; // and between the bed joint and the ground line
  for (let x = NEAR_PHASE; x < size; x += BRICK) ctx.fillRect(x, top + JOINT, JOINT, upper);
  for (let x = NEAR_PHASE + BRICK / 2; x < size; x += BRICK) {
    ctx.fillRect(x, top + NEAR_BED + JOINT, JOINT, lower);
  }
}

// One cut end of a run, mirrored for the two sides. `top` and `bottom` are where the near and far
// bands already are, so a corner is a butt joint between two faces of different depth rather than
// two bonds crossing each other into mush.
function flank(
  ctx: CanvasRenderingContext2D,
  size: number,
  west: boolean,
  top: number,
  bottom: number,
): void {
  const edge = west ? 0 : size - FLANK;
  ctx.fillStyle = INK;
  ctx.fillRect(edge, top, FLANK, bottom - top);
  ctx.fillStyle = PAPER;
  // The outer column is the silhouette and the inner one is the arris against the top surface;
  // mortar runs between them and touches neither.
  const face = edge + 1;
  for (let y = FLANK_BED; y < size; y += FLANK_COURSE) {
    if (y >= top && y < bottom) ctx.fillRect(face, y, FLANK - 2 * JOINT, JOINT);
  }
}

export default wall;
