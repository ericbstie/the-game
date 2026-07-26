import type { SpriteSubject } from "./sheet";

// The buildable barrier — the cheap slab players drop to steer a wave. Not the room perimeter.
//
// Three constraints shape every number here.
//
// **It is drawn edge to edge.** Players lay these in runs, and a run has to read as one wall
// rather than as a line of stamps. So the blockwork repeats every `JOINT_PITCH`, which divides the
// box: a joint lands *on* the box edge, and the half a joint each of two neighbours contributes
// adds up to exactly the joint that sits mid-box. Nothing in the drawing has a period of 30, so
// there is nothing at the seam for the eye to lock onto, and no feature is distinctive enough to
// be recognised as a repeat. The bond is stacked rather than staggered because a staggered course
// has to straddle the box edge, which leaves that course's outer column un-inked and bites a notch
// out of the silhouette of a wall standing on its own.
//
// **Every edge is an integer.** Axis-aligned integer-edge fills are the one place this style gets
// hard black for free — 0% anti-aliasing, measured (#77 §4). A wall is entirely axis-aligned, so
// the bands below are sized to divide exactly and no curve is used anywhere.
//
// **The two planes are told apart by tone, not by outline.** The top surface is solid ink and the
// front face is white blockwork, which is the only way to say "different plane" at 30 px without
// interior detail. The courses are the heavier joint so the face reads as stacked masonry rather
// than as a lattice.
//
// Elevation, per #76 §2. The box is exactly the footprint square, so the top surface is
// foreshortened into a band rather than drawn as a full square, and the sprite is blitted anchored
// at the bottom of its box — that bottom edge is where the wall meets the floor. Ink deliberately
// reaches all four edges of the box; the harness reports that as "touches the edge of its box",
// and for this sprite that is the point.
//
// No damage states: #76 §5 cut them, and a health bar carries damage instead.

const SIZE = 30; // 2×2 tiles at TILE 15 (src/game/build.ts)

// Bands down the box. They sum to SIZE, and every one of them is whole.
const CAP_H = 7; // the top surface, foreshortened
const COURSE_H = 6;
const COURSES = 3;
const COURSE_JOINT = 2; // mortar between courses
const FOOT_H = 1; // the line where the front face meets the floor

const BLOCK_JOINT = 2; // mortar between blocks — one whole joint, or two halves across a seam
const JOINT_PITCH = 10; // divides SIZE, so a run of walls has one rhythm and no seam

const INK = "#000";

const wall: SpriteSubject = {
  name: "wall",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    const faceTop = CAP_H;
    const faceHeight = COURSES * COURSE_H + (COURSES - 1) * COURSE_JOINT;

    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, size, CAP_H);
    ctx.fillRect(0, size - FOOT_H, size, FOOT_H);

    for (let course = 1; course < COURSES; course++) {
      ctx.fillRect(
        0,
        faceTop + course * (COURSE_H + COURSE_JOINT) - COURSE_JOINT,
        size,
        COURSE_JOINT,
      );
    }

    for (let centre = 0; centre <= size; centre += JOINT_PITCH) {
      const left = Math.max(0, centre - BLOCK_JOINT / 2);
      const right = Math.min(size, centre + BLOCK_JOINT / 2);
      ctx.fillRect(left, faceTop, right - left, faceHeight);
    }
  },
};

export default wall;
