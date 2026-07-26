import type { SpriteSubject } from "./sheet";

// The power plant: 5×5 tiles at TILE 15, the largest building in the game, and the only building
// drawn **flat, straight down** (#76 §2, #81). The miner, wall and turret are elevation — top
// surface and front face both visible — and stand up into the Y-sorted layer. This one paints
// underneath it, with the floor and the ore.
//
// Projection is read semantically, not geometrically. Three earlier drafts were flat by
// construction — no front face, no shadow, no tilt — and every one still read as standing up,
// because each was built around a **wheel seen face-on**, and a wheel is a thing everybody knows
// faces sideways. Drawing one square to the viewer says "you are looking at its front", whatever
// the geometry does. A bolt in each corner made it worse: that says "screwed to a bulkhead".
//
// So the subject changed to one that only makes sense lying down — an **engine bed in plan**. The
// crank runs left to right, which puts everything mounted on it broadside to the viewer: the
// flywheel projects as a bar rather than a disc, and so do the cylinder and the dynamo. The only
// true circles left are the things whose axes really do point up out of the deck — the rivet heads
// and the gauge. That consistency is the whole argument that this is a plan view, and it buys back
// what the earlier drafts never had: a reason to believe the thing makes power.
//
// The deck is **not filled**. The generator stands on power ore, the one thing in the game drawn in
// red (#76 §1), and an opaque plate would punch a hole in that glow; the ore comes up through the
// gaps in the screen instead, and only the machinery is solid white. The screen is the halftone #76
// reserves for large structures — round dots on a 45° lattice at roughly a fifth coverage, which
// reads as tone. Square dots on the 0° grid this was tried on first read as perforated mesh, and
// sat ready to moiré against any change of scale or density.

const SIZE = 75;
const AXIS = 33; // the crank line, held off the box's own centre on purpose

const INK = "#000";
const PAPER = "#fff";

// Weights are absolute rather than proportional, so this sprite is drawn with the same nib as the
// 30 px buildings beside it. Those are solid black masses with white windows cut out; at 75 px that
// idiom would put the heaviest ink mass in the game on the floor layer, and this sprite paints
// *under* the Y-sorted layer — a black-and-white player crossing it would lose its silhouette. So
// the masses stay open and the family resemblance is carried by the line weight instead.
const PLATE_CONTOUR = 3;
const MASS_CONTOUR = 3.2;
const MASS_SWELL = 1.3; // added at the belly of a run, so no contour is one width end to end
const DETAIL_LINE = 2;
const SOLID = 5; // shafts are drawn as solid bars, the one place the siblings' idiom fits directly
const CLEARANCE = 2.5; // white margin burnt through the screen around the machine's silhouette

const PLATE_CORNER = 10;

const TINT_INSET = 7;
const TINT_CORNER = 7;
const TINT_PITCH = 5; // rows at half the pitch, alternate rows offset by half — a 45° screen
const TINT_DOT = 0.9;

// Uneven on purpose, and four along the top against two along the bottom. Evenly spaced hardware in
// matching counts is the tell that no hand was involved.
const RIVETS: readonly (readonly [number, number])[] = [
  [11, 9],
  [26, 9],
  [38, 9],
  [65, 9],
  [22, 67],
  [38, 67],
];
const RIVET_R = 2.6;
const RIVET_PIN = 1.1;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const bar = (from: number, to: number): Box => ({
  x: from,
  y: AXIS - SOLID / 2,
  w: to - from,
  h: SOLID,
  r: SOLID / 2,
});

// A separate cylinder-head flange was drawn here and cut: at this line weight the cylinder's own
// contour swallowed all but a pixel of it, and one bold mass beats two that overlap into a smear.
const CYLINDER: Box = { x: 7, y: AXIS - 13, w: 29, h: 26, r: 6 };
const CRANK: Box = bar(34, 45);
const WHEEL: Box = { x: 44, y: AXIS - 23, w: 11, h: 46, r: 5.5 };
const DRIVE: Box = bar(53, 60);
const DYNAMO: Box = { x: 56, y: AXIS - 9, w: 12, h: 18, r: 5 };
const TERMINALS: Box = { x: 44, y: 60, w: 24, h: 9, r: 3 };

// The crank enters the wheel's left edge and the drive shaft leaves its right, so the shaft reads as
// running through it — a boss on top of that only crowded the dynamo, and was cut.
const SHAFTS: readonly Box[] = [CRANK, DRIVE];

// Back to front. A later piece's white body covers the contour of whatever it is mounted over, which
// is the only occlusion a plan view of one flat deck needs.
const TRAIN: readonly Box[] = [CYLINDER, DYNAMO, WHEEL, TERMINALS];

const GAUGE = { x: 15, y: 57, r: 6 };
const POSTS = [50, 56, 62];
const POST_R = 1.4;

function roundedRect(ctx: CanvasRenderingContext2D, box: Box): void {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  ctx.beginPath();
  ctx.moveTo(box.x + box.r, box.y);
  ctx.arcTo(right, box.y, right, bottom, box.r);
  ctx.arcTo(right, bottom, box.x, bottom, box.r);
  ctx.arcTo(box.x, bottom, box.x, box.y, box.r);
  ctx.arcTo(box.x, box.y, right, box.y, box.r);
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Distance from a point to a rounded rect's straight core, which is within `radius` exactly when the
// point is inside it. Padding a rounded rect leaves the core alone and grows the radius, so one test
// answers both questions asked of the screen: is this dot on the deck, and is it too near a piece of
// linework to be drawn. Dots are placed by that test rather than clipped or painted over, because
// both of those leave part-dots and half-alpha crumbs that read as dirt at real size.
function withinRounded(x: number, y: number, box: Box, pad = 0): boolean {
  const dx = Math.max(box.x + box.r - x, 0, x - (box.x + box.w - box.r));
  const dy = Math.max(box.y + box.r - y, 0, y - (box.y + box.h - box.r));
  return dx * dx + dy * dy <= (box.r + pad) * (box.r + pad);
}

// Ink swells at the belly of a run and thins as it turns; a contour of one width end to end reads
// as CAD linework whatever it is drawn around. Each straight run takes a second heavier pass over
// its middle, blended in at both ends by the round caps.
function swell(ctx: CanvasRenderingContext2D, box: Box, vertical: boolean): void {
  const span = vertical ? box.h : box.w;
  const start = vertical ? box.y : box.x;
  ctx.strokeStyle = INK;
  ctx.lineWidth = MASS_CONTOUR + MASS_SWELL;
  for (const edge of vertical ? [box.x, box.x + box.w] : [box.y, box.y + box.h]) {
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(edge, start + span * 0.3);
      ctx.lineTo(edge, start + span * 0.7);
    } else {
      ctx.moveTo(start + span * 0.3, edge);
      ctx.lineTo(start + span * 0.7, edge);
    }
    ctx.stroke();
  }
}

const generator: SpriteSubject = {
  name: "generator",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const deck: Box = {
      x: TINT_INSET,
      y: TINT_INSET,
      w: size - 2 * TINT_INSET,
      h: size - 2 * TINT_INSET,
      r: TINT_CORNER,
    };
    const keepOff = MASS_CONTOUR / 2 + CLEARANCE + TINT_DOT;
    ctx.fillStyle = INK;
    const row = TINT_PITCH / 2;
    for (let step = 0; step * row < size; step++) {
      const y = step * row;
      for (let x = (step % 2) * row; x < size; x += TINT_PITCH) {
        if (!withinRounded(x, y, deck)) continue;
        if ([...TRAIN, ...SHAFTS].some((box) => withinRounded(x, y, box, keepOff))) continue;
        if (Math.hypot(x - GAUGE.x, y - GAUGE.y) <= GAUGE.r + keepOff) continue;
        if (RIVETS.some(([rx, ry]) => Math.hypot(x - rx, y - ry) <= RIVET_R + keepOff)) continue;
        disc(ctx, x, y, TINT_DOT);
      }
    }

    // Contoured wholly inside the box, so the heaviest line keeps its full weight instead of losing
    // half of itself off the edge of the bake.
    ctx.strokeStyle = INK;
    ctx.lineWidth = PLATE_CONTOUR;
    roundedRect(ctx, {
      x: PLATE_CONTOUR / 2,
      y: PLATE_CONTOUR / 2,
      w: size - PLATE_CONTOUR,
      h: size - PLATE_CONTOUR,
      r: PLATE_CORNER - PLATE_CONTOUR / 2,
    });
    ctx.stroke();

    for (const [x, y] of RIVETS) {
      ctx.beginPath();
      ctx.arc(x, y, RIVET_R, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = DETAIL_LINE;
      ctx.stroke();
      ctx.fillStyle = INK;
      disc(ctx, x - 0.5, y - 0.5, RIVET_PIN); // struck off centre, the way a peened head sits
    }

    ctx.fillStyle = INK;
    for (const box of SHAFTS) {
      roundedRect(ctx, box);
      ctx.fill();
    }

    for (const box of TRAIN) {
      roundedRect(ctx, box);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = MASS_CONTOUR;
      ctx.stroke();
    }
    swell(ctx, CYLINDER, false);
    swell(ctx, DYNAMO, false);
    swell(ctx, WHEEL, true);

    ctx.fillStyle = INK;
    for (const x of POSTS) disc(ctx, x, TERMINALS.y + TERMINALS.h / 2, POST_R);

    ctx.beginPath();
    ctx.arc(GAUGE.x, GAUGE.y, GAUGE.r, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = MASS_CONTOUR;
    ctx.stroke();
    ctx.lineWidth = DETAIL_LINE;
    ctx.beginPath();
    ctx.moveTo(GAUGE.x, GAUGE.y);
    ctx.lineTo(GAUGE.x + 3.2, GAUGE.y - 2.8);
    ctx.stroke();
    ctx.fillStyle = INK;
    disc(ctx, GAUGE.x, GAUGE.y, 1.3);
  },
};

export default generator;
