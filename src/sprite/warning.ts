import type { SpriteSubject } from "./sheet";

// The HUD's "something you built is being chewed on" icon: an alarm bell, mid-swing.
//
// It is a bell rather than a triangle-and-exclamation-mark because that glyph is a letterform, and
// ADR 0001 removed text from the game so completely that smuggling punctuation back in as an icon
// would be the same habit wearing a hat. A bell is a drawn object, it is period-correct for a 1930s
// cartoon, and it carries exactly the meaning #76 grants this icon and no more — *something* is
// under attack, with no direction and nothing identified.
//
// The swing is baked into the single frame rather than animated across two. #81 wants it flashing,
// and the HUD flashes it in CSS; a bell frozen upright would read as decoration, while one caught
// at the end of its arc reads as ringing even while it is being blinked on and off.

const SIZE = 28; // matches the player's box, which is the smallest thing in the set that reads
const TILT = -0.11; // radians off vertical — a bell at rest is a doorbell, not an alarm

const warning: SpriteSubject = {
  name: "warning",
  size: SIZE,
  facings: 1,
  frames: 1,
  draw(ctx, size) {
    const s = size / SIZE; // every number below is in the 28-box this was drawn against
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // The ring arcs sit outside the swing, so they are drawn in the untilted frame: sound comes off
    // a bell where the bell *is*, not where its own axis points.
    ctx.lineWidth = 1.6 * s;
    for (const side of [-1, 1]) {
      for (const r of [10.4, 12.4]) {
        ctx.beginPath();
        const from = side === 1 ? -0.42 : Math.PI - 0.42;
        ctx.arc(14 * s, 14 * s, r * s, from, from + 0.84);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(14 * s, 6 * s); // pivot at the crown, which is what a swinging bell turns about
    ctx.rotate(TILT);
    ctx.translate(-14 * s, -6 * s);

    // Crown loop — hollow, so the bell reads as hung from something rather than floating.
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(14 * s, 4.6 * s, 1.9 * s, 0, Math.PI * 2);
    ctx.stroke();

    // The dome, in one solid fill. No interior detail: at 28 px a highlight is a smudge.
    ctx.beginPath();
    ctx.moveTo(6.6 * s, 18.4 * s);
    ctx.bezierCurveTo(6.6 * s, 11.2 * s, 9.2 * s, 6.8 * s, 14 * s, 6.8 * s);
    ctx.bezierCurveTo(18.8 * s, 6.8 * s, 21.4 * s, 11.2 * s, 21.4 * s, 18.4 * s);
    ctx.closePath();
    ctx.fill();

    // The lip, flaring wider than the dome — the silhouette cue that says "bell" and not "dome".
    ctx.beginPath();
    ctx.moveTo(5.8 * s, 18.4 * s);
    ctx.lineTo(22.2 * s, 18.4 * s);
    ctx.lineTo(21.1 * s, 21.2 * s);
    ctx.lineTo(6.9 * s, 21.2 * s);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath(); // clapper
    ctx.arc(14 * s, 23.2 * s, 2.1 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },
};

export default warning;
