import type { SpriteSubject } from "./sheet";

// The automated defence, drawn in elevation on its 2×2 footprint: an armoured cupola ringed with
// gun ports, on a pinched neck, on a plinth whose lit top surface and shadowed front face are both
// visible.
//
// #76 settled that the turret **never rotates**, so nothing on it points anywhere. The threat is
// radial instead of aimed: the ports run edge to edge and read as continuing around the back, so a
// shot line leaving the cupola is as plausible going left as going right. A barrel would be a lie
// the first time it fired sideways.
//
// Two things that belong to a turret are deliberately absent, because other sprites own them: the
// flashing lightning symbol when it is unpowered, and its health bar. It also does not change as it
// is damaged — #76 cut structure damage states.
//
// The cupola is a white form inside a bold ink contour rather than a solid mass with white knocked
// out of it, which is what separates 1930s pen work from a modern pictogram. The contour is
// heaviest where the form turns away — thin over the lit crown, thick at the shoulders and under
// the lip. Everything below it is an axis-aligned fill on integer edges, which carries no
// anti-aliasing at all (#77), so the plinth stays hard at 30 px while the cupola's curve pays the
// grey the resolution owes it.

const BOX = 30; // 2 tiles at TILE 15 — the footprint square, which is also the sprite's whole box

const INK = "#000";
const PAPER = "#fff";

const PIERS = [8, 14, 20]; // the masonry between the gun ports, symmetric about the box centre

const turret: SpriteSubject = {
  name: "turret",
  size: BOX,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.scale(size / BOX, size / BOX);

    ctx.fillStyle = INK;
    ctx.fillRect(4, 21, 22, 9); // the plinth, standing on the floor
    ctx.fillRect(11, 17, 8, 5); // the neck, pinched so the cupola reads as a separate head
    dome(ctx, 18, 13, 11);

    ctx.fillStyle = PAPER;
    dome(ctx, 16, 10, 7); // the cupola's lit interior, leaving the outer draw as its contour

    // The ring of gun ports. Inset far enough that it stays inside the cupola on every row it
    // covers, so it merges into the contour at both ends instead of bulging out of it.
    ctx.fillStyle = INK;
    ctx.fillRect(3, 14, 24, 4);

    ctx.fillStyle = PAPER;
    for (const x of PIERS) ctx.fillRect(x, 14, 2, 3); // stopping a row short of the unbroken lip
    ctx.fillRect(6, 23, 18, 3); // the plinth's lit top surface, above its front face in shadow
  },
};

function dome(ctx: CanvasRenderingContext2D, baseY: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(15, baseY, rx, ry, 0, Math.PI, 2 * Math.PI);
  ctx.fill();
}

export default turret;
