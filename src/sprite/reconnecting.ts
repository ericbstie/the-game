import type { SpriteSubject } from "./sheet";

// The HUD's "the socket dropped and the client is trying to get back in" icon: a chain link snapped
// in two, its halves pulled apart.
//
// #81 settled that this banner earns an icon rather than being dropped silently, with the same
// treatment as the under-attack bell. A broken link is the one image that means *a connection*
// rather than *a fault* — a lightning bolt is already spoken for by the unpowered turret, and a
// cross or a slash would read as an error the player caused.
//
// Drawn on a diagonal so both halves get the box's long axis: laid out flat, a 28 px link is 28 px
// of length split between two shapes and a gap, and the halves stop reading as one broken object.

const SIZE = 28;
const ANGLE = -Math.PI / 5; // the diagonal the link lies along

// Half a link, as a stadium: a straight run capped by a semicircle, open at the break.
function half(ctx: CanvasRenderingContext2D, s: number, direction: 1 | -1): void {
  const reach = 6.3 * s; // centre of the round cap, from the middle of the link
  const rise = 3.9 * s; // half the link's height
  const gap = 1.7 * s; // how far this half has been pulled off the break
  const x = direction * gap;
  ctx.beginPath();
  ctx.moveTo(x, rise);
  ctx.lineTo(x + direction * reach, rise);
  ctx.arc(
    x + direction * reach,
    0,
    rise,
    Math.PI / 2,
    -Math.PI / 2,
    direction === 1, // sweep around the outside, so the cap closes the link rather than crossing it
  );
  ctx.lineTo(x, -rise);
  ctx.stroke();
}

const reconnecting: SpriteSubject = {
  name: "reconnecting",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    const s = size / SIZE;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3.1 * s; // thick enough that the ring survives a non-retina bake
    ctx.lineJoin = "round";
    ctx.lineCap = "butt"; // a snapped end is flat and torn, not rounded off

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(ANGLE);
    half(ctx, s, -1);
    half(ctx, s, 1);

    // Two short ticks flying off the break. Without them the halves read as two separate links that
    // merely failed to meet; with them the link reads as having come apart under load.
    ctx.lineWidth = 1.4 * s;
    ctx.lineCap = "round";
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(side * 1.0 * s, side * 5.8 * s);
      ctx.lineTo(side * 2.1 * s, side * 8.4 * s);
      ctx.stroke();
    }
    ctx.restore();
  },
};

export default reconnecting;
