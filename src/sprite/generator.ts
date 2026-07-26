import type { SpriteSubject } from "./sheet";

// The power plant: 5×5 tiles at TILE 15, the largest building in the game.
//
// Alone among the buildings it is drawn **flat, straight down** (#76 §2, #81). The miner, wall and
// turret are elevation — top surface and front face both visible — and stand up into the Y-sorted
// layer. This one paints underneath it, with the floor and the ore, so every cue that would make it
// read as standing is deliberately withheld: no front face, no ground line, no shadow, and every
// round part is a true circle rather than the foreshortened ellipse a tilted view produces. The
// affirmative half of the statement is the coil — a spiral only has a shape at all when you are
// looking straight down its axis.
//
// The chassis is filled white because the generator only ever stands on power ore, the one thing in
// the game drawn in red (#76 §1). Ink alone would be read against that tint; a white field gives it
// something of its own to sit on, and the ore left showing in the inset seam reads as the plant set
// into the patch.
//
// The deck hatching is the texture #76 reserves for the floor and for large structures. It is ruled
// in axis-aligned lines on integer edges, which #77 measured as carrying no anti-aliasing at all,
// so it stays hard black at any display density instead of going grey the way a curve does — and it
// thins toward the drum the way ink hatching follows a form rather than tiling a field.

const SIZE = 75;
const CENTRE = SIZE / 2;

const INK = "#000";
const PAPER = "#fff";

const CONTOUR = 3.5; // the heaviest line on the drawing; everything inside it is lighter
const INSET = 3; // keeps the contour off the box edge, so it never clips a neighbouring tile
const CHASSIS_CORNER = 18; // generous enough that no corner reads as a drafted right angle

const HATCH_INSET = 7;
const HATCH_CORNER = 14;
const HATCH_PITCH = 3;
const HATCH_RULE = 1;

const RIVET_CENTRE = 15;
const RIVET_R = 3.8;
const RIVET_HALO = 5.5; // clears the hatching away, so a rivet reads as a machined boss

const DRUM_R = 23;
const DRUM_LINE = 3;
const DRUM_CLEAR = 25.5;

const COIL_R = 18;
const COIL_TURNS = 2.5;
const COIL_LINE = 3;
const COIL_STEP = 0.08; // radians per segment — fine enough that the spiral has no visible facets
const TERMINAL_R = 2.6;

function roundedSquare(
  ctx: CanvasRenderingContext2D,
  inset: number,
  side: number,
  radius: number,
): void {
  const near = inset;
  const far = inset + side;
  ctx.beginPath();
  ctx.moveTo(near + radius, near);
  ctx.arcTo(far, near, far, far, radius);
  ctx.arcTo(far, far, near, far, radius);
  ctx.arcTo(near, far, near, near, radius);
  ctx.arcTo(near, near, far, near, radius);
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// An Archimedean spiral from the shaft outward. The winding is what makes this a dynamo rather than
// a fan, and unlike blades it cannot be mistaken for a shape seen edge-on.
function coilEnd(ctx: CanvasRenderingContext2D): { x: number; y: number } {
  const sweep = COIL_TURNS * Math.PI * 2;
  const growth = COIL_R / sweep;
  ctx.beginPath();
  let x = CENTRE;
  let y = CENTRE;
  for (let angle = 0; angle <= sweep; angle += COIL_STEP) {
    const radius = growth * angle;
    x = CENTRE + Math.cos(angle) * radius;
    y = CENTRE + Math.sin(angle) * radius;
    if (angle === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  return { x, y };
}

const generator: SpriteSubject = {
  name: "generator",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;

    ctx.fillStyle = PAPER;
    ctx.lineWidth = CONTOUR;
    roundedSquare(ctx, INSET, size - 2 * INSET, CHASSIS_CORNER);
    ctx.fill();
    ctx.stroke();

    // Ruled off the centre line so the band is symmetric by construction and lands on whole pixels.
    ctx.save();
    roundedSquare(ctx, HATCH_INSET, size - 2 * HATCH_INSET, HATCH_CORNER);
    ctx.clip();
    ctx.fillStyle = INK;
    for (let y = CENTRE - 0.5; y < size; y += HATCH_PITCH) {
      ctx.fillRect(0, y, size, HATCH_RULE);
      ctx.fillRect(0, size - y - HATCH_RULE, size, HATCH_RULE);
    }
    ctx.restore();

    ctx.fillStyle = PAPER;
    disc(ctx, CENTRE, CENTRE, DRUM_CLEAR);
    ctx.lineWidth = DRUM_LINE;
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, DRUM_R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = COIL_LINE;
    const terminal = coilEnd(ctx);
    ctx.fillStyle = INK;
    disc(ctx, terminal.x, terminal.y, TERMINAL_R);

    for (const x of [RIVET_CENTRE, size - RIVET_CENTRE]) {
      for (const y of [RIVET_CENTRE, size - RIVET_CENTRE]) {
        ctx.fillStyle = PAPER;
        disc(ctx, x, y, RIVET_HALO);
        ctx.fillStyle = INK;
        disc(ctx, x, y, RIVET_R);
      }
    }
  },
};

export default generator;
