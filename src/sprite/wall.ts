import type { SpriteSubject } from "./sheet";

// The buildable barrier — the cheap slab players drop to steer a wave. Not the room perimeter.
//
// What fixes every number here:
//
// **It is drawn edge to edge, in runs.** A row of these has to read as one wall, not as a line of
// stamps. Nothing in the drawing has a period of 30: the courses run the full width, and the bond
// repeats every `BOND_PITCH`, which divides the box. The phases are deliberately off the box edges
// — no vertical ink sits in column 0 or column 29 — so two neighbours never double a joint into a
// thicker line at the seam, and never leave a gap either. The result is one continuous bond across
// a run, with nothing marking where one wall ends and the next begins.
//
// **The bond is staggered.** A stacked bond turns into a lattice at this size and reads as a
// window; the half-pitch offset between courses is what makes it read as masonry instead.
//
// **Every edge is an integer.** Axis-aligned integer-edge fills are the one place this style gets
// hard black for free — 0% anti-aliasing, measured (#77 §4). Nothing here curves, so the sprite is
// pure ink at any dpr.
//
// **It has to be told apart from the miner and the turret**, which share its 30 px box. Both of
// those are solid ink masses standing clear of their box edges. The wall is their inverse: a white
// field of thin ink lines filling the box corner to corner. Tone and silhouette both separate them
// before any detail is resolved.
//
// Elevation, per #76 §2. The box is exactly the footprint square, so the top surface is
// foreshortened into a band rather than drawn as a full square, and the sprite is blitted anchored
// at the bottom of its box — that bottom edge is the course line where the wall meets the floor.
// Ink deliberately reaches all four edges of the box; the harness reports that as "touches the edge
// of its box", and for this sprite that is the point.
//
// No damage states: #76 §5 cut them, and a health bar carries damage instead.

const SIZE = 30; // 2×2 tiles at TILE 15 (src/game/build.ts)

const CAP_H = 5; // the top surface, foreshortened into a band
// The base outranks a bed joint so the wall reads as sitting on the floor rather than floating,
// and so the silhouette has some line-weight hierarchy: this style is a heavy outer contour
// holding lighter interior detail, and the cap and the base are the only contour a wall gets.
const BASE_H = 2;

const BOND_PITCH = 10; // divides SIZE, so a run of walls carries one unbroken bond

const BED_JOINT = 1;

// Courses deepen toward the floor and the head joints alternate weight. **Variation down the box is
// the only irregularity a tiling sprite can afford.** A run of walls repeats horizontally, so
// anything that varies across the box has a period of exactly 30 and shows up as a repeating stamp;
// anything that varies down it is free, because every course still runs the full width and lines up
// with its neighbours. So the hand goes in vertically — which is also what keeps the face off
// reading as CAD linework, since real ink is not all one weight, while the silhouette keeps the hard
// integer edges that make this sprite pure black at any dpr.
//
// The weight varies only on the **head** joints, which are 4–6 px stubs. It was tried on the bed
// joints too and had to come out: those run the full width, so a 2 px bed reads as a second cap
// band across the middle of the wall and competes with the real one.
//
// `phase` is where a course's head joints start, and alternating it by half a pitch is the stagger
// that makes this masonry rather than a lattice. Both phases sit clear of columns 0 and 29, which
// is what lets two neighbours meet without doubling a joint or leaving a gap. Heights sum with the
// bed joints, the cap and the base to exactly SIZE.
const COURSES = [
  { height: 4, phase: 2, head: 1 },
  { height: 5, phase: 7, head: 2 },
  { height: 5, phase: 2, head: 1 },
  { height: 6, phase: 7, head: 2 },
];

const INK = "#000";

const wall: SpriteSubject = {
  name: "wall",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, size, CAP_H);
    ctx.fillRect(0, size - BASE_H, size, BASE_H);

    let y = CAP_H;
    for (const [index, course] of COURSES.entries()) {
      for (let x = course.phase; x < size; x += BOND_PITCH) {
        ctx.fillRect(x, y, course.head, course.height);
      }
      y += course.height;
      if (index < COURSES.length - 1) {
        ctx.fillRect(0, y, size, BED_JOINT);
        y += BED_JOINT;
      }
    }
  },
};

export default wall;
