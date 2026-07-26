import type { SpriteSubject } from "./sheet";

// The miner: the machine that stands on a metal-ore patch and pulls it into the shared bank. Drawn
// in elevation, in a box that is exactly its 2×2 footprint at TILE 15, anchored at the bottom
// centre so it stands on its tiles and overlaps whatever is behind it.
//
// It is a pithead: a sheave at the head of a tower, braced by one raked back-leg, over the engine
// house that drives it. The proportion is the whole trick — a *small* wheel at the apex of a tall
// open frame reads as winding gear, and a big wheel on a stubby frame reads as a lens on an arm.
// The back-leg is what makes it a headframe rather than a signpost, and it is the only member that
// leans, so it is also what keeps the sprite off the vertical axis of symmetry the wall and the
// turret both sit on.
//
// Against its two neighbours the separation is value before shape: the turret is an outline drawing,
// white-dominant with ink only at its contours, and this is a solid black mass. Value is the fastest
// thing the eye resolves at 30 px, so nothing here should be hollowed out to match them.
//
// The ground it stands on is ore — small discrete ink specks on white. A large contiguous mass beats
// specks on its own, and a white keyline round every ink mass keeps a speck that lands on the edge
// from growing into the silhouette.
//
// Every edge that can be axis-aligned is, on integer coordinates: those fills carry no
// anti-aliasing at all (#77), the one advantage a building has over a character at this size. The
// sheave, the arch and the raked leg have to curve or lean, and their softness is resolution rather
// than a mistake to correct.

const SIZE = 30;

const INK = "#000";
const PAPER = "#fff";

const KEYLINE = 1; // white, outside every ink mass, so ore specks cannot grow into the silhouette

// The engine house. Solid, not a frame: a black outline round a white panel is what the wall and the
// turret both are, and at 30 px value is what separates these three before shape does.
const HOUSE = { x: 2, y: 19, w: 26, h: 9, shoulder: 3 };
const DECK = { x: 14, y: 21, w: 12, h: 2 }; // where the top surface meets the front face
const MOUTH = { x: 6, y: 25, w: 6, h: 3, arch: 3 }; // the ore comes out here, onto the ground line

// The tower carries the sheave; the back-leg braces it. Both run down into the house, so the house
// covers their feet and neither can terminate in mid-air — a member that lands on nothing reads as a
// stray scratch rather than as structure.
const TOWER = [
  [13, 10],
  [16.5, 10],
  [15, 21],
  [11.5, 21],
];
const BACK_LEG = [
  [16, 10.5],
  [19, 10.5],
  [26.5, 21],
  [23, 21],
];
// High and short, stopping inside the back-leg. A bar at mid-height spanning two uprights is the
// signature of a capital A, and at 30 px the eye takes the letter over the machine every time.
const BRACE = { x: 15, y: 13, w: 5, h: 2 };

// Small, and centred over the house. No axle across the bore: a ring crossed by a full-width bar is
// a prohibition sign, and that is what the eye resolves first. The bore clears the tower head, so
// nothing shows through it — and it is at the size floor, so nothing may be put back inside it.
const SHEAVE = { x: 15, y: 7, r: 4.2, bore: 2 };

const miner: SpriteSubject = {
  name: "miner",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx) {
    const masses = [
      () => polygon(ctx, BACK_LEG),
      () => polygon(ctx, TOWER),
      () => ring(ctx, SHEAVE.x, SHEAVE.y, SHEAVE.r),
      () => housing(ctx, HOUSE),
    ];

    // Keylines in one pass, ink in a second, over the same four shapes. Laid down shape by shape
    // the keyline falls *between* members and cuts the sprite into three floating pieces — the
    // whole sheave hanging off nothing, the frame parted from the roof by a full-width white band.
    // In two passes the ink closes every internal seam and the white survives only on the outside,
    // which is the only place it was ever for.
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2 * KEYLINE;
    for (const mass of masses) {
      mass();
      ctx.stroke();
    }

    ctx.fillStyle = INK;
    for (const mass of masses) {
      mass();
      ctx.fill();
    }
    ctx.fillRect(BRACE.x, BRACE.y, BRACE.w, BRACE.h);

    ctx.fillStyle = PAPER;
    ring(ctx, SHEAVE.x, SHEAVE.y, SHEAVE.bore);
    ctx.fill();
    ctx.fillRect(DECK.x, DECK.y, DECK.w, DECK.h);
    ctx.beginPath();
    ctx.roundRect(MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, [MOUTH.arch, MOUTH.arch, 0, 0]);
    ctx.fill();
  },
};

function housing(ctx: CanvasRenderingContext2D, box: typeof HOUSE): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, [box.shoulder, box.shoulder, 0, 0]);
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function polygon(ctx: CanvasRenderingContext2D, points: number[][]): void {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

export default miner;
