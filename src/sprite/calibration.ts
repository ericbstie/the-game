import type { SpriteSubject } from "./sheet";

// Not art, and not a sprite — the harness's own test pattern. Pure geometry that exercises
// everything a review sheet has to show: an axis-aligned edge (which carries no anti-aliasing at
// all), a curve and a thin tapered stroke (which carry the most and are the first things a low
// resolution breaks up), and a mark that moves per facing and per frame so the contact grid and
// the flip strip have something to compare. Render it to check the harness, never to judge a
// sprite:
//
//   bun run sprite:sheet src/sprite/calibration.ts

const SIZE = 28; // the player's box, the size at which this style is hardest (#77 §4)
const FACINGS = 8;

const calibration: SpriteSubject = {
  name: "calibration",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, size, facing, frame) {
    const center = size / 2;
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;

    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    ctx.beginPath();
    ctx.arc(center, center, center - 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.quadraticCurveTo(center + 6, center - 8 + frame * 5, size - 5, center);
    ctx.stroke();

    const angle = (facing / FACINGS) * Math.PI * 2;
    const reach = center - 8;
    ctx.beginPath();
    ctx.arc(center + Math.cos(angle) * reach, center + Math.sin(angle) * reach, 2, 0, Math.PI * 2);
    ctx.fill();
  },
};

export default calibration;
