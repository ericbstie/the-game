import type { SpriteSubject } from "./sheet";

// The buildable barrier — the cheap slab players drop to steer a wave. Not the room perimeter.
//
// **It is a wall top, not a wall face.** A run of these is read from above: what you see most is
// the broad flat top surface, joined tile to tile into one mass, and masonry shows only where that
// mass is *cut* — on the vertical faces a neighbour is not covering. So the drawing is a pale top
// held inside dark faces, and which faces exist is a property of the run, not of the tile.
//
// **`facing` is neighbour occupancy, not an orientation**: which of the twelve tiles ringing this
// wall's 2×2 footprint hold another wall. `drawWorld` derives it from the structure list once per
// frame (src/game/draw.ts) through `packWall`. A face with a neighbour behind it is drawn as
// nothing at all — no band, no keyline — which is what lets two tops merge instead of showing a
// seam every 30 px.
//
// It is read **per tile rather than per side**, and that is the whole of #90:
//
// - **A side is two tiles long and a neighbour can cover one of them.** Placement is per tile
//   (`cursorTile` → `tileOf`), so two walls butt while sitting one tile out of step. A per-side bit
//   has to call that half covered or cut and is wrong either way — covered suppresses a face that
//   is genuinely exposed, cut draws masonry into the middle of a solid mass. Each half is resolved
//   on its own instead.
// - **The four diagonals are in it because a concave corner has no face of its own.** At the inner
//   corner of an L or a ring the two neighbours' faces stop at their own box edges and meet only at
//   a point; the tile in the angle draws neither of them, because it has a neighbour on both of
//   those sides. The diagonal is what tells it the angle is empty and the corner wants closing.
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

// The wall's footprint, in tiles, which is what the box and the mask are both cut into. It is
// `BUILDABLES.wall.footprint`, and the drawing would have to be redrawn if that ever moved.
export const WALL_TILES = 2;

const INK = "#000";
const PAPER = "#fff";

// The tiles the mask carries, offset in tiles from the footprint's top-left: the 4×4 block the
// footprint sits in the middle of, minus the footprint itself, in reading order. Bit n is
// `NEIGHBOURS[n]`. This is the one definition — `drawWorld` builds a mask through `packWall` and
// reads none of it itself.
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [2, -1],
  [-1, 0],
  [2, 0],
  [-1, 1],
  [2, 1],
  [-1, 2],
  [0, 2],
  [1, 2],
  [2, 2],
];

// 4,096 — a variant per neighbourhood. Bakes are lazy and per variant (src/sprite/cache.ts), so a
// base pays for the arrangements it actually stands in, which is a couple of dozen.
export const WALL_FACINGS = 1 << NEIGHBOURS.length;

// The bit carrying the tile at `(dx, dy)`, or -1 for the footprint's own tiles and anything outside
// the block.
export function wallBit(dx: number, dy: number): number {
  return NEIGHBOURS.findIndex(([x, y]) => x === dx && y === dy);
}

export function packWall(occupied: (dx: number, dy: number) => boolean): number {
  let mask = 0;
  for (let bit = 0; bit < NEIGHBOURS.length; bit++) {
    const [dx, dy] = NEIGHBOURS[bit];
    if (occupied(dx, dy)) mask |= 1 << bit;
  }
  return mask;
}

// Whether the tile at `(dx, dy)` holds wall. The footprint's own tiles always do, which is what
// keeps a face or a corner from ever being drawn inside the mass this sprite is part of.
export function wallAt(mask: number, dx: number, dy: number): boolean {
  if (dx >= 0 && dx < WALL_TILES && dy >= 0 && dy < WALL_TILES) return true;
  const bit = wallBit(dx, dy);
  return bit >= 0 && (mask & (1 << bit)) !== 0;
}

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
  facings: WALL_FACINGS,
  frames: 1,
  draw(ctx, size, facing) {
    const cell = size / WALL_TILES;
    const last = WALL_TILES - 1;
    const cut = (dx: number, dy: number): boolean => !wallAt(facing, dx, dy);

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    slabs(ctx, size);

    // Order is the projection: the near face lies in front of the far one, and the cut ends of a run
    // lie in front of both. Drawn the other way round, a flank's mortar eats a notch out of the
    // corner of the band it crosses.
    //
    // Every face walks its side a tile at a time. With the side wholly cut the pieces butt into
    // exactly the band the whole-side version drew — every phase is taken in box coordinates, so
    // nothing shifts — and with half of it covered only the exposed half is drawn.
    ctx.fillStyle = INK;
    for (let i = 0; i < WALL_TILES; i++) {
      if (cut(i, -1)) ctx.fillRect(i * cell, 0, cell, FAR);
    }
    for (let i = 0; i < WALL_TILES; i++) {
      if (cut(i, WALL_TILES)) nearFace(ctx, size, i * cell, (i + 1) * cell);
    }
    for (const west of [true, false]) {
      const column = west ? 0 : last;
      const beside = west ? -1 : WALL_TILES;
      for (let j = 0; j < WALL_TILES; j++) {
        if (!cut(beside, j)) continue;
        // Where the near and far bands already are, so a corner is a butt joint between two faces
        // of different depth. Only the row that runs alongside one of them has to give way.
        const top = j === 0 && cut(column, -1) ? FAR : j * cell;
        const bottom = j === last && cut(column, WALL_TILES) ? size - NEAR : (j + 1) * cell;
        flank(ctx, size, west, top, bottom);
      }
    }
    innerCorners(ctx, cell, facing);

    // The hard outline, last of everything, because a white mortar line running out to a box edge
    // would otherwise leave a hole in the silhouette at a corner. Only cut edges get one: an edge
    // with a neighbour behind it is interior to the mass and must carry no mark whatever.
    ctx.fillStyle = INK;
    for (let i = 0; i < WALL_TILES; i++) {
      if (cut(i, -1)) ctx.fillRect(i * cell, 0, cell, JOINT);
      if (cut(i, WALL_TILES)) ctx.fillRect(i * cell, size - JOINT, cell, JOINT);
      if (cut(-1, i)) ctx.fillRect(0, i * cell, JOINT, cell);
      if (cut(WALL_TILES, i)) ctx.fillRect(size - JOINT, i * cell, JOINT, cell);
    }
  },
};

// The mass's concave corners. Two neighbours meeting with nothing in the angle between them leave a
// corner no face reaches: theirs stop at their own box edges, and the tile in the angle draws
// neither, because it has a neighbour on both of those sides. Unfilled it is a white bite out of the
// silhouette — and since every enclosure has four inner corners, it was in essentially every base a
// player built (#90 §1).
//
// The patch is the two faces butted, so it takes its width from the flank and its depth from
// whichever of the near and far bands it is closing against. Solid: at five pixels by eight there is
// nothing to knock mortar out of. It can only fire where the diagonal tile is outside the footprint,
// so a corner interior to this sprite's own 2×2 never draws one.
function innerCorners(ctx: CanvasRenderingContext2D, cell: number, facing: number): void {
  ctx.fillStyle = INK;
  for (let i = 0; i < WALL_TILES; i++) {
    for (let j = 0; j < WALL_TILES; j++) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const concave =
            wallAt(facing, i + sx, j) &&
            wallAt(facing, i, j + sy) &&
            !wallAt(facing, i + sx, j + sy);
          if (!concave) continue;
          const depth = sy < 0 ? FAR : NEAR;
          ctx.fillRect(
            sx < 0 ? i * cell : (i + 1) * cell - FLANK,
            sy < 0 ? j * cell : (j + 1) * cell - depth,
            FLANK,
            depth,
          );
        }
      }
    }
  }
}

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

// The near face over one stretch of the south side. The arris at the top and the ground line at the
// bottom stay unbroken — a head joint reaching either would dash the silhouette at the brick pitch,
// which is a seam by another name. `from` and `to` bound the stretch; every joint keeps its phase in
// box coordinates and is simply withheld outside it, so two stretches butt into one bond.
function nearFace(ctx: CanvasRenderingContext2D, size: number, from: number, to: number): void {
  const top = size - NEAR;
  ctx.fillStyle = INK;
  ctx.fillRect(from, top, to - from, NEAR);
  ctx.fillStyle = PAPER;
  ctx.fillRect(from, top + NEAR_BED, to - from, JOINT);
  const upper = NEAR_BED - JOINT; // rows between the arris and the bed joint
  const lower = NEAR - NEAR_BED - 2 * JOINT; // and between the bed joint and the ground line
  for (let x = NEAR_PHASE; x < size; x += BRICK) {
    if (x >= from && x < to) ctx.fillRect(x, top + JOINT, JOINT, upper);
  }
  for (let x = NEAR_PHASE + BRICK / 2; x < size; x += BRICK) {
    if (x >= from && x < to) ctx.fillRect(x, top + NEAR_BED + JOINT, JOINT, lower);
  }
}

// One stretch of a cut end of a run, mirrored for the two sides. `top` and `bottom` bound it clear
// of wherever the near and far bands already are, so a corner is a butt joint between two faces of
// different depth rather than two bonds crossing each other into mush.
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
