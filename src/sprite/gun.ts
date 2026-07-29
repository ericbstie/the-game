import type { SpriteSubject } from "./sheet";

// The HUD's gun icon (#120): the weapon in side elevation, muzzle right, in two states — facing 1
// **filled** with the gun equipped, facing 0 **hollow** with it stowed.
//
// One contour, drawn once and used twice. The equipped bake fills it and strokes it; the stowed bake
// only strokes it. That is what keeps the two states the same object rather than two drawings of one:
// the outer ink edge is `path + CONTOUR / 2` either way, so the icon neither grows nor shifts a pixel
// when the gun comes up — only its inside turns from paper to ink.
//
// **There is no trigger-guard loop.** It was built and dropped in round 2; the size argument that was
// written down for it did not survive being measured, and `gun.review.md` records what replaced it.
// What holds either way is that the finger space here is the **open notch** behind the guard — paper
// joined to the outside, which no stroke can close, between the guard's rear wall and the grip's
// front strap — so the guard itself is drawn solid.
//
// The read is carried by the silhouette alone, which is the only thing there is at this size: a long
// barrel stepped down off a deeper frame, a hammer spur standing off the back, one tab under the
// frame, and a grip leaning away from it. The **hammer** is what the first bake was missing and what
// stopped it reading as a boot — a bare bar-and-leg is a boot, an axe or a set square, and nothing
// but a gun has a spur cocked back over its own grip.

// The box the HUD blits this into (`GUN_ICON_PX` in `GameScreen.tsx`), and not the 28 its siblings
// draw in. `SpriteIcon` composes `scale = pixels / subject.size` *before* the dpr scale, so a 28-unit
// box shown at 26 px is rescaled by 26/28 and every station below lands mid-pixel — which is exactly
// the anti-aliasing the half-unit discipline exists to avoid. Measured at the real blit size, the
// 28-unit box put **zero** hard ink in the stowed bake at dpr 1; on 26 it is 44. Matching the box to
// the blit makes the composed scale integral at every density.
const SIZE = 26;

// One unit, and every axis-aligned station below sits on a half unit — so the *ink* edge of every
// long run, which is the path plus half the contour, lands on a whole unit and carries no
// anti-aliasing at all, at dpr 1 as well as at dpr 2. That is the whole reason it is not heavier:
// a 1.4 contour measured 24% hard ink on the stowed bake at dpr 1 against this one's 48%, because
// every edge of it fell mid-pixel. A crisp thin outline beats a soft thick one at this size.
const CONTOUR = 1;

// The silhouette, clockwise on a y-down canvas, from the hammer. Two units narrower than the 28-unit
// drawing it came from — one off the frame's top, one off the barrel — which is what the smaller box
// costs while keeping a unit of margin on every side and the barrel's share of the width unchanged.
const CONTOUR_PATH: readonly (readonly [number, number])[] = [
  [2.5, 2.5], // the hammer spur, standing off the back of the frame
  [6.5, 1.5],
  [7.5, 5.5], // and down onto the frame's top
  [13.5, 5.5],
  [13.5, 7.5], // the step off the frame, which is what makes the barrel a barrel
  [24.5, 7.5],
  [24.5, 11.5], // the muzzle
  [18.5, 11.5], // back along the barrel's underside to the guard
  [18.5, 17.5],
  [17.5, 19.5], // the guard's bottom, chamfered off both corners
  [11.5, 19.5],
  [10.5, 17.5],
  [10.5, 11.5], // up the guard's rear wall
  [7.5, 11.5], // the strip of frame the notch opens under
  [6.5, 24.5], // the front strap, raked forward off a straight backstrap
  [2.5, 24.5], // the heel
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
