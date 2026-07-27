import type { SpriteSubject } from "./sheet";

// The HUD's squad-ammunition icon: three cartridges, whole and unfired, standing in a loose row.
//
// The counter it labels is a shared pool — a player's shot and a turret's shot come out of the same
// forged supply — so the icon has to mean *rounds*, not a gun and not a shot in flight. Cartridges
// still carrying their bullets are the thing being counted, and they name no weapon and no shooter.
//
// It is a drawn object rather than a mark, for the reason `warning.ts` gives: ADR 0001 took text out
// of the game thoroughly enough that a letterform or a punctuation glyph smuggled back in as an
// icon would be the same habit wearing a hat.
//
// **There are three of them because one was never going to read.** Six bakes of a single upright
// round were reviewed cold by three different agents and came back rocket, lighthouse, obelisk,
// pawn, headstone and hooded figure — every one of them a thing that stands alone. A lone tapered
// cylinder at 26 px has no feature left to spend on saying which kind of cylinder it is. Repetition
// is that feature: identical tapered objects side by side are ammunition, and there is no lighthouse
// that comes in threes.
//
// It also buys the two things the single round could not have at once. The **group** covers 24×22 of
// its 28 units against `warning`'s 27×23.5 on the same HUD plate, and at real size its ink covers
// 1314 device px against `warning`'s 1303 — parity, where the old bake was 13 px wide beside that 27
// and read as half the weight of its neighbour. And because the mass is carried by three bodies
// rather than one, each **round** is 6×22, an aspect of 0.27, which is what a real cartridge is; the
// single round had to sit at 0.54 to hold any weight at all, and 0.54 is a bollard.
//
// The two 3-unit columns of paper between the rounds are the drawing's negative space, and they do
// structural work: ~200 css px² of white inside the icon's own bounding box, against the 13 css px²
// of the hole in `warning`'s crown loop. It is open rather than enclosed white, and it is hard-edged
// at both densities because the walls either side of it are.
//
// **Each round stands plumb, and that is settled — do not tilt them.** Every other icon on this HUD
// plate leans, so the exception is deliberate and it was paid for twice. The second attempt answered
// the obvious objection to the first: it was built *at* the angle, point by point, with the shoulder
// stepped on each flank by a different amount so both notches met the case wall at the same shallow
// angle once the lean had swung them. It was measurably worse — round 3 of the review has the
// numbers. The short version is that a leaning round is a leaning headstone, and that symmetry is
// what makes a small notch legible: with the round plumb every edge but the nose is axis-aligned, so
// the walls, the base and the shoulder ledge cost no anti-aliasing at all. Off plumb the notch is a
// grey chamfer on one flank and absent on the other at dpr 1. What replaces the lean as this icon's
// anti-glyph gesture is the row itself: three objects and two full-height columns of paper are not a
// mark, and none of it costs an edge.
//
// So the bottleneck carries the cartridge read, and it is a **hard horizontal ledge** rather than a
// shoulder cone: at six pixels of case width a cone is one grey pixel, while a ledge on an integer
// row is a corner. Above it the neck and the bullet's shank are one unbroken parallel-sided column,
// longer than the nose that caps it — a step into a taper is a spire widening at its foot, a step
// into a column that then turns over is a case mouth gripping a bullet. The nose is deliberately
// stubby for the same reason: a long point is a rocket, and a real pistol round has almost none.
//
// **There is no rim and no extractor groove, and both were built before being dropped.** A rim
// proud of a 6-unit case is a pedestal foot, and that foot is what made the first bake a chess pawn.
// The groove — two bites of paper out of the flanks where the head meets the body — was baked twice,
// at 1 and at 2 units of depth. Both are crisp at dpr 2 and neither survives dpr 1: the shallow one
// takes the bake from 38% ink to 34% and turns the base into a flared foot, the deep one to 29% and
// a foot on a stem. Round 3 of the review condemned exactly this — a feature that is present on
// retina and gone off it, so the two densities read as different objects. The numbers are in the
// review notes.

const SIZE = 28; // the box `warning` and `reconnecting` draw in, and this lands in the same HUD

const CONTOUR = 0.6; // stroked as well as filled, which is what rounds every corner

// Half-widths. Both are set so that the *ink* edge — the path plus half the contour — lands on a
// whole unit, which is what keeps every wall hard at dpr 1 as well as at dpr 2. That is the one
// thing no earlier bake of this icon managed: round 3 measured the old shoulder as "a 45° chamfer
// on one flank and gone on the other" at dpr 1, and called the feature retina-only.
const CASE_HALF = 2.7; // 6 units of ink
const NECK_HALF = 1.7; // 4 units of ink; the neck and the bullet's shank share it

// Stations down one round, measured from its own tip.
const OGIVE_Y = 4.0; // the nose curve meets the bullet's straight shank
const SHOULDER_Y = 9.0; // the bottleneck, in one horizontal step
const BASE_Y = 21.4; // 21.4 + the contour is 22 units of ink

// The nose, as one cubic per side. The first control sits close to the axis and the second out at
// full width, which is what makes an ogive rather than a cone: the sides leave the shank almost
// upright, carry their width most of the way, and only then turn over into a point. How far down
// that second control sits is the whole tuning: high up and the nose reaches full width in its top
// third and the round is a dome-capped tube — one reviewer read that as a lipstick, another as a
// finial.
// At 2.8 of the nose's 4.0 the taper is spread over most of the nose and the tip comes to a point.
const OGIVE_TIP_IN = 0.45;
const OGIVE_TIP_Y = 1.0;
const OGIVE_SHANK_Y = 2.8;

// Where each round stands: 3 units of paper between neighbours, all on one baseline. The three did
// stand at three different heights for one bake, on the theory that a stagger would read as objects
// placed rather than as a picket fence. It did not: the reviewer's first note after naming the
// object was that the 1- and 2-unit offsets were "not a row, not an arc, not a deliberate scatter —
// it reads as drift", and drift is the one thing an icon must never look like. A flat row is a row.
// Every value keeps the ink on whole units, so the group covers exactly 2…26 across and 3…25 down.
const ROUNDS = [
  { cx: 5, tip: 3.3 },
  { cx: 14, tip: 3.3 },
  { cx: 23, tip: 3.3 },
];

const ammo: SpriteSubject = {
  name: "ammo",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    ctx.scale(size / SIZE, size / SIZE);
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = CONTOUR;

    for (const { cx, tip } of ROUNDS) {
      ctx.beginPath();
      ctx.moveTo(cx, tip);
      ctx.bezierCurveTo(
        cx + OGIVE_TIP_IN,
        tip + OGIVE_TIP_Y,
        cx + NECK_HALF,
        tip + OGIVE_SHANK_Y,
        cx + NECK_HALF,
        tip + OGIVE_Y,
      );
      ctx.lineTo(cx + NECK_HALF, tip + SHOULDER_Y);
      ctx.lineTo(cx + CASE_HALF, tip + SHOULDER_Y);
      ctx.lineTo(cx + CASE_HALF, tip + BASE_Y);
      ctx.lineTo(cx - CASE_HALF, tip + BASE_Y);
      ctx.lineTo(cx - CASE_HALF, tip + SHOULDER_Y);
      ctx.lineTo(cx - NECK_HALF, tip + SHOULDER_Y);
      ctx.lineTo(cx - NECK_HALF, tip + OGIVE_Y);
      ctx.bezierCurveTo(
        cx - NECK_HALF,
        tip + OGIVE_SHANK_Y,
        cx - OGIVE_TIP_IN,
        tip + OGIVE_TIP_Y,
        cx,
        tip,
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  },
};

export default ammo;
