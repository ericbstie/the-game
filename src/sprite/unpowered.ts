import type { SpriteSubject } from "./sheet";

// The flashing symbol over a turret that is holding a target it has no power to fire on (#81).
// `drawWorld` owns the predicate — `target !== null && !powered`, because an idle turret is
// unpowered too and has nothing to complain about — and owns the flash rate, one frame per 400 ms.
// What is here is only the mark itself.
//
// Three things decided the drawing, and all three come from what it sits on top of.
//
// **It is hollow because the turret is not.** The turret is a wide, low casemate with a bold ink
// contour and a white roof, and a solid black bolt laid over it merges into that contour and reads
// as a fitting. The bolt is therefore drawn the same way the turret is — a white form carrying an
// ink outline — so it reads as a *mark on* the building rather than as part of its silhouette.
//
// **It carries its own paper gap.** The knockout is a second, fatter pass of the identical path in
// white, laid down first, so a ring of bare paper separates the bolt from whatever is under it. Ink
// on ink at 24 px is a blob; a gap is what keeps the two drawings apart wherever the bolt crosses
// the roof's edge or its bore ring.
//
// **It stays inside the turret's top line.** Sized and placed so the ink starts just *below* the
// casemate's flat roof edge and ends short of the floor. Anything poking above that line reads as a
// mast or an aerial — a permanent piece of the building — and a permanent protrusion is the
// *miner's* distinguishing feature, which two 2×2 structures cannot share.
//
// The bolt is tilted a few degrees off plumb and its two limbs are not reflections of each other.
// At this size an even-weight contour is accepted, so the tilt and the asymmetry are what is left
// to keep it from reading as a flat UI glyph struck onto the frame.

const BOX = 24; // ~4/5 of the turret's 30, so it marks the building without covering it

const INK = "#000";
const PAPER = "#fff";

// The three widths are one decision, not three. A limb has to carry an ink line down each side and
// still leave paper between them, so the contour and the gap are what set how fat the bolt must be
// — at a 2.2 contour inside the 3.8-wide limb this started with, the two lines met and the first
// render came out solid. Just under 5 across the limb leaves ~2.8 of white down the middle, which
// is 5–6 device pixels at the ratios this is looked at.
const CONTOUR = 1.8; // the ink line's weight
const MARGIN = 1.2; // bare paper outside the ink, so the mark never touches what it sits on

const TILT = 0.09; // ~5° — no hand strikes a bolt plumb, and a plumb one is a glyph
const PIVOT = { x: 12, y: 12.5 };

// The bolt, as the path both passes stroke. Not a mirrored zigzag: the upper limb leaves its peak
// at a steeper angle than the lower one returns at, and the two waists are a shade different in
// length, which is the difference between a struck symbol and a drawn one.
type Point = [x: number, y: number];
const BOLT: Point[] = [
  [14.7, 4.5],
  [6.0, 13.3],
  [10.9, 13.3],
  [8.2, 20.5],
  [18.0, 10.8],
  [13.1, 10.8],
];

const unpowered: SpriteSubject = {
  name: "unpowered",
  size: BOX,
  facings: 1,
  // Two, and the second is deliberately empty: the flash *is* the mark coming and going, and
  // `drawWorld` alternates the frames off the injected clock rather than fading anything.
  frames: 2,
  draw(ctx, size, _facing, frame) {
    if (frame % 2 === 1) return;
    ctx.scale(size / BOX, size / BOX);
    ctx.translate(PIVOT.x, PIVOT.y);
    ctx.rotate(TILT);
    ctx.translate(-PIVOT.x, -PIVOT.y);

    // Round joins on both passes. The bolt's peaks are sharp enough that a miter spikes well past
    // the box, and a rounded corner is what a brush leaves anyway.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // The paper plate: the path fattened by the ink's weight plus the gap, filled as well as
    // stroked so the inside of the bolt is paper rather than whatever it is standing on.
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = CONTOUR + MARGIN * 2;
    path(ctx);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = INK;
    ctx.lineWidth = CONTOUR;
    path(ctx);
    ctx.stroke();
  },
};

function path(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  for (const [x, y] of BOLT) ctx.lineTo(x, y);
  ctx.closePath();
}

export default unpowered;
