import type { SpriteSubject } from "./sheet";

// The HUD's gun icon (#120): the weapon in side elevation, muzzle right, in two states — facing 1
// **filled** with the gun equipped, facing 0 **hollow** with it stowed.
//
// One contour, drawn once and used twice. The equipped bake fills it and strokes it; the stowed bake
// only strokes it. That is what keeps the two states the same object rather than two drawings of one:
// the outer ink edge is `path + CONTOUR / 2` either way, so the icon neither grows nor shifts a pixel
// when the gun comes up — only its inside turns from paper to ink.
//
// **There is no trigger-guard loop, and that is arithmetic rather than taste.** An enclosed hole
// loses `CONTOUR` off each of its sides, and the guard's own walls have to clear the outer contour by
// another `CONTOUR` or the two strokes merge into one bar. At 28 units that leaves a guard block
// 9 × 9 carrying about 12 units² of paper — under `warning`'s crown loop, which `ammo`'s review round
// 3 already condemned as a feature that is present on retina and gone off it. A hole big enough to
// survive would want an 11-unit block, which is most of the height the frame and the grip need. So
// the guard is drawn **solid**, and the finger space is the open notch behind it: paper joined to the
// outside, which no stroke can close, between the guard's rear wall and the grip's front strap.
//
// The read is carried by the silhouette alone, which is the only thing there is at this size: a long
// barrel stepped down off a deeper frame, a hammer spur standing off the back, one tab under the
// frame, and a grip leaning away from it. The **hammer** is what the first bake was missing and what
// stopped it reading as a boot — a bare bar-and-leg is a boot, an axe or a set square, and nothing
// but a gun has a spur cocked back over its own grip.

const SIZE = 28; // the box `warning`, `ammo` and `reconnecting` draw in — this lands on the same HUD

// One unit, and every axis-aligned station below sits on a half unit — so the *ink* edge of every
// long run, which is the path plus half the contour, lands on a whole unit and carries no
// anti-aliasing at all, at dpr 1 as well as at dpr 2. That is the whole reason it is not heavier:
// a 1.4 contour measured 24% hard ink on the stowed bake at dpr 1 against this one's 48%, because
// every edge of it fell mid-pixel. A crisp thin outline beats a soft thick one at 28 px.
const CONTOUR = 1;

// The silhouette, clockwise on a y-down canvas, from the hammer.
const CONTOUR_PATH: readonly (readonly [number, number])[] = [
  [2.5, 3.5], // the hammer spur, standing off the back of the frame
  [6.5, 2.5],
  [7.5, 6.5], // and down onto the frame's top
  [14.5, 6.5],
  [14.5, 8.5], // the step off the frame, which is what makes the barrel a barrel
  [26.5, 8.5],
  [26.5, 12.5], // the muzzle
  [19.5, 12.5], // back along the barrel's underside to the guard
  [19.5, 18.5],
  [18.5, 20.5], // the guard's bottom, chamfered off both corners
  [12.5, 20.5],
  [11.5, 18.5],
  [11.5, 12.5], // up the guard's rear wall
  [8.5, 12.5], // the strip of frame the notch opens under
  [6.5, 25.5], // the front strap, raked forward off a straight backstrap
  [2.5, 25.5], // the heel
];

const gun: SpriteSubject = {
  name: "gun",
  size: SIZE,
  facings: 2, // 0 stowed (hollow), 1 equipped (filled)
  frames: 1,
  draw(ctx, size, facing) {
    const s = size / SIZE;
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = CONTOUR * s;

    ctx.beginPath();
    for (const [x, y] of CONTOUR_PATH) ctx.lineTo(x * s, y * s);
    ctx.closePath();
    if (facing === 1) ctx.fill();
    ctx.stroke();
  },
};

export default gun;
