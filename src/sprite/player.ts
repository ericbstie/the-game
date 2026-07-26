import type { SpriteSubject } from "./sheet";

// The player: a simplified 1928 public-domain cartoon figure, drawn as 1930s rubber-hose ink.
// Black and white only — the self halo is a separate sprite and supplies the one granted colour.
//
// Legally load-bearing, not stylistic: the hands are **bare**. Gloves belong to the 1929 redesign
// and are still under copyright. Everything else here is the 1928 vocabulary — pie-cut eyes with
// no pupils, hose limbs with no elbows or knees, two-button shorts, oversized shoes, and ears that
// stay circular whatever the head is doing.
//
// All 8 facings come from one figure. The facing's screen vector `(fx, fy)` moves the snout, the
// eyes, the buttons, the stride and the tail, so a facing and its mirror are the same drawing
// evaluated at opposite `fx` — nothing is authored twice and nothing can drift between them.
// Index convention is #73's: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE, in canvas y-down space.
//
// Frame 0 is a standing stance, not half a stride: below `MOVE_EPS` the walk cycle parks there and
// it is what a stopped player is seen in most of the time (#81).

const SIZE = 28; // PLAYER_RADIUS * 2
const FACINGS = 8;
const TAU = Math.PI * 2;
const CX = SIZE / 2;

const INK = "#000";
const PAPER = "#fff";

// The armature, in logical px measured down from the top of the box. The figure is anchored at the
// feet, so the soles sit just above the bottom edge and the head is free to bob without moving it.
// The proportions are the era's: head plus ears is over a third of the height, shoulders are
// narrower than the hips, and the hose limbs are long enough to hang clear of the body.
const EAR_Y = 3.8;
const EAR_R = 2.5;
const EAR_DX = 3.9;
const HEAD_Y = 7.8;
const HEAD_R = 5.15;
const SHOULDER_Y = 13.4;
const SHOULDER_DX = 2.4;
const TORSO_Y = 14.6;
const TORSO_RX = 2.8;
const TORSO_RY = 3;
const HIP_Y = 17.9;
const HIP_RX = 3.85;
const HIP_RY = 2.6;
const HAND_Y = 21.6;
const HAND_DX = 5.45;
const HAND_R = 1.05;
const ARM_BOW = 6.7;
const ARM_W = 1.65;
const ARM_REST = 1.2; // a relaxed arm hangs a little forward of the hip, which is what keeps it
const ARM_SWING = 2.2; // readable in profile instead of buried in the body's silhouette
const LEG_W = 1.85;
const HIP_JOINT_DX = 1.7;
const FOOT_Y = 25.2;
const FOOT_DX = 2.6;
const SHOE_RY = 1.45;
const STRIDE = 3;
const BOB = 0.9;
const FACE_HIDDEN_BELOW = -0.45; // fy at which the head has turned far enough to show only its back

const player: SpriteSubject = {
  name: "player",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const bearing = (facing / FACINGS) * TAU;
    // Snapped, because cos(π/2) is 6.1e-17 rather than 0 and every "is this a straight-on view"
    // test below would silently never fire.
    const fx = snap(Math.cos(bearing));
    const fy = snap(Math.sin(bearing)); // +1 faces the viewer, -1 faces away
    const profile = Math.abs(fx);
    const step = frame === 1 ? 1 : 0;
    const bob = step * BOB;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const hipY = HIP_Y + bob * 0.7;

    const feet = [-1, 1].map((side) => {
      const lead = side < 0 ? 1 : -1;
      const spread = FOOT_DX * (1 - 0.62 * profile) * (1 + 0.55 * (1 - profile) * step);
      // A foot stepping away from the viewer rises; the near foot keeps the ground line, so the
      // sprite's contact point never leaves the bottom of the box.
      const away = Math.max(0, -fy * lead);
      return {
        side,
        lead,
        x: CX + side * spread + fx * STRIDE * lead * step,
        y: FOOT_Y - away * 1.1 * step,
      };
    });

    if (fy <= 0.1) drawTail(ctx, fx, hipY);

    for (const foot of depthSorted(feet)) {
      hose(
        ctx,
        CX + foot.side * HIP_JOINT_DX * (1 - 0.45 * profile),
        hipY + 1.3,
        CX + (foot.x - CX) * 0.55 + foot.side * 0.9,
        (hipY + foot.y) / 2 + 0.6,
        foot.x,
        foot.y - 0.6,
        LEG_W,
      );
      drawShoe(ctx, foot.x, foot.y, fx, profile, foot.side);
    }

    const arms = [-1, 1].map((side) => {
      const swing = side < 0 ? -1 : 1; // opposite the leg on the same side
      return {
        side,
        lead: -swing,
        x: CX + side * HAND_DX + fx * 2.1 * swing * step,
        y: HAND_Y + bob - 0.9 * swing * step,
      };
    });

    for (const arm of depthSorted(arms)) {
      hose(
        ctx,
        CX + arm.side * SHOULDER_DX,
        SHOULDER_Y + bob,
        CX + arm.side * ARM_BOW,
        (SHOULDER_Y + HAND_Y) / 2 + bob,
        arm.x,
        arm.y,
        ARM_W,
      );
      ctx.fillStyle = INK;
      ellipse(ctx, arm.x, arm.y, HAND_R, HAND_R * 1.2);
      ctx.fill();
    }

    ctx.fillStyle = INK;
    ellipse(ctx, CX, TORSO_Y + bob, TORSO_RX, TORSO_RY);
    ctx.fill();
    ellipse(ctx, CX, hipY, HIP_RX, HIP_RY);
    ctx.fill();

    drawButtons(ctx, fx, fy, profile, hipY);
    drawHead(ctx, fx, fy, profile, bob);
  },
};

function drawHead(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  profile: number,
  bob: number,
): void {
  const headY = HEAD_Y + bob;
  const snoutX = CX + fx * 3.4;
  const snoutY = headY + 2.6;
  const snoutRX = 2.6 + 0.5 * profile;
  const snoutRY = 1.9;

  ctx.fillStyle = INK;
  for (const side of [-1, 1]) {
    ellipse(ctx, CX + side * EAR_DX - fx * 0.6, EAR_Y + bob, EAR_R, EAR_R);
    ctx.fill();
  }
  ellipse(ctx, CX, headY, HEAD_R, HEAD_R);
  ctx.fill();

  // The snout leaves the head's silhouette in profile, so it is laid down as ink first and the
  // white sits inside it. A stroke would work too, but it draws a line across the middle of the
  // face where there should be none.
  const showFace = fy > FACE_HIDDEN_BELOW;
  if (showFace || profile > 0.2) {
    ellipse(ctx, snoutX, snoutY, snoutRX + 0.5, snoutRY + 0.5);
    ctx.fill();
  }
  if (!showFace) return; // a head turned this far away shows no face at all

  ctx.fillStyle = PAPER;
  ellipse(ctx, CX + fx * 1.8, headY + 0.15, 3.2, 3.5);
  ctx.fill();
  ellipse(ctx, snoutX, snoutY, snoutRX, snoutRY);
  ctx.fill();

  const eyeY = headY - 1.4;
  const eyeCX = CX + fx * 2.2;
  const sep = 1.7 * (1 - 0.5 * profile);
  for (const side of [-1, 1]) {
    const far = side * Math.sign(fx) < 0;
    const scale = far ? 1 - 0.8 * profile : 1;
    if (scale < 0.3) continue; // at full profile the far eye is behind the snout
    pieEye(ctx, eyeCX + side * sep, eyeY, 1.25 * scale, 1.8, -Math.PI / 2 + side * 0.6);
  }

  ctx.fillStyle = INK;
  ellipse(ctx, CX + fx * 4.9, headY + 2.5, 1.35, 1.05);
  ctx.fill();
}

// A solid oval with a wedge taken out of it and no pupil — the 1928 eye. The wedge is filled with
// paper rather than erased, because the eye always sits on the white of the face.
function pieEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  cut: number,
): void {
  ctx.save();
  ctx.fillStyle = INK;
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
  ctx.clip();
  const reach = Math.max(rx, ry) * 3;
  const spread = 0.62;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(cut - spread) * reach, y + Math.sin(cut - spread) * reach);
  ctx.lineTo(x + Math.cos(cut + spread) * reach, y + Math.sin(cut + spread) * reach);
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.restore();
}

function drawButtons(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  profile: number,
  hipY: number,
): void {
  if (fy < -0.3) return; // the buttons are on the front of the shorts
  ctx.fillStyle = PAPER;
  const cx = CX + fx * 1.5;
  const y = hipY - 0.2;
  if (profile > 0.85) {
    ellipse(ctx, cx, y, 0.8, 0.8);
    ctx.fill();
    return;
  }
  const sep = 1.5 * (1 - 0.55 * profile);
  for (const side of [-1, 1]) {
    ellipse(ctx, cx + side * sep, y, 0.8, 0.8);
    ctx.fill();
  }
}

function drawShoe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fx: number,
  profile: number,
  side: number,
): void {
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  ellipse(ctx, x + fx * 0.9, y, 1.85 + 1.6 * profile, SHOE_RY, (1 - profile) * side * 0.26);
  ctx.fill();
  ctx.stroke();
}

function drawTail(ctx: CanvasRenderingContext2D, fx: number, hipY: number): void {
  const swing = fx === 0 ? 1 : -Math.sign(fx);
  const baseX = CX - fx * 2.4;
  const tipX = CX - fx * 4.9 + swing * (1 - Math.abs(fx)) * 4.4;
  hose(ctx, baseX, hipY - 0.6, baseX + (tipX - baseX) * 0.9, hipY - 2, tipX, hipY - 4.8, 1.25);
}

function hose(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  width: number,
): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(cx, cy, bx, by);
  ctx.stroke();
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
}

// Nearer limbs paint over further ones. In a pure side view neither is nearer, so the leading one
// wins — which keeps the two frames of a profile walk consistent with each other.
function depthSorted<T extends { y: number; lead: number }>(limbs: T[]): T[] {
  return [...limbs].sort((a, b) => a.y - b.y || a.lead - b.lead);
}

function snap(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

export default player;
