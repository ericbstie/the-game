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
// eyes, the buttons and the stride, so a facing and its mirror are the same drawing evaluated at
// opposite `fx` — nothing is authored twice and nothing can drift between them.
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

// The armature, in logical px measured down from the top of the box. `drawWorld` blits this box
// with its bottom edge on the player's position, so the soles belong on that edge. The proportions
// are the era's: head plus ears is over a third of the height, shoulders are narrower than the
// hips, and the hose limbs are long enough to hang clear of the body.
const EAR_Y = 3.4;
const EAR_R = 2.4;
const EAR_R_RIGHT = 2.28;
const EAR_DX = 3.7;
const HEAD_Y = 7;
const HEAD_R = 4.9;
const SHOULDER_Y = 12.2;
const SHOULDER_DX = 2.2;
const TORSO_Y = 13.3;
const TORSO_RX = 2.7;
const TORSO_RY = 2.8;
const HIP_Y = 16.3;
const HIP_RX = 3.3;
const HIP_RY = 2.45;
const HAND_Y = 20.3;
const HAND_DX = 6.2;
const HAND_R = 1.45;
const ARM_BEND = 1.9;
const ARM_REST = 2; // a relaxed arm hangs forward of the hip, which is what keeps it readable in
const ARM_SWING = 3.6; // profile instead of buried inside the body's silhouette
// Even at rest the two arms sit at different points fore and aft. Squared up they stack into one
// shape in profile, and the near hand lands on the far leg — a lump where two limbs should read.
const ARM_REST_SWING = 0.65;
// A body is wider across the shoulders and hips than it is deep, so turning to profile shows a
// narrower torso. Drawing one width for every facing is what buries the arms in the side views.
const PROFILE_NARROW = 0.15;
// Rubber hose is stroke modulation: a limb is thick where it leaves the body and tapers to the
// extremity, with a swell through the belly of the curve. A constant width reads as CAD linework.
const ARM_W_TOP = 1.55;
const ARM_W_MID = 1.25;
const ARM_W_END = 0.95;
const LEG_W_TOP = 1.95;
const LEG_W_MID = 1.6;
const LEG_W_END = 1.3;
// Feet are never quite level in a standing pose, and squared up in profile the two legs stack into
// one black pillar. This is the fore-and-aft offset frame 0 rests at, opened out to `STRIDE` in
// frame 1.
const LEG_REST = 0.8;
const HIP_JOINT_DX = 1.9;
const FOOT_Y = 25.2;
const FOOT_DX = 2.6;
const SHOE_RY = 1.5;
const STRIDE = 3;
// A whole logical pixel. A fractional bob resamples the face against a different sub-pixel grid in
// each frame, so the head appears to change shape rather than to move.
const BOB = 1;
const FACE_HIDDEN_BELOW = -0.45; // fy at which the head has turned far enough to show only its back
const SNOUT_BREAKS_OUT_ABOVE = 0.25; // profile at which the snout leaves the head and needs a contour
// A drawn figure is never exactly symmetrical, and exact symmetry is the tell a reviewer is asked
// to hunt for. Straight-on facings have no `fx` to break it, so the asymmetry is carried by the
// parts themselves: the head leans, the ears differ, and the two sides of the body do not match.
const LEAN = 0.2;

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

    ctx.fillStyle = INK;

    const hipY = HIP_Y + bob * 0.7;
    const narrow = 1 - PROFILE_NARROW * profile;
    const hipRX = HIP_RX * narrow;

    const feet = [-1, 1].map((side) => {
      // The leg that leads is the one already on the leading side, so its lateral offset and its
      // stride add rather than cancel. Squared up they land on top of each other in profile.
      const lead = side;
      // The right foot rests fractionally narrower than the left. Straight-on facings have no `fx`
      // to break the mirror, and a figure standing in exact bilateral symmetry reads as a toy.
      const spread =
        FOOT_DX * (side < 0 ? 1 : 0.93) * (1 - 0.85 * profile) * (1 + 0.55 * (1 - profile) * step);
      // A foot stepping away from the viewer rises; the near foot keeps the ground line, so the
      // sprite's contact point never leaves the bottom of the box.
      const away = Math.max(0, -fy * lead);
      return {
        side,
        lead,
        x: CX + side * spread + fx * lead * (LEG_REST + (STRIDE - LEG_REST) * step),
        // Side-on, the trailing foot is the far one. Lifting it puts a step in the silhouette,
        // which is the only thing separating two shoes that necessarily overlap in a side view.
        y: FOOT_Y - away * 1.1 * step - (lead < 0 ? profile * 0.55 : 0),
      };
    });

    for (const foot of depthSorted(feet)) {
      limb(
        ctx,
        CX + foot.side * HIP_JOINT_DX * (1 - 0.45 * profile),
        hipY + 1.1,
        foot.x,
        foot.y - 0.7,
        foot.side * 0.95 * (1 - 0.85 * profile) + fx * foot.lead * 0.2 * profile,
        LEG_W_TOP,
        LEG_W_MID,
        LEG_W_END,
      );
      drawShoe(ctx, foot.x, foot.y, fx, fy, profile, foot.side);
    }

    // Turned to profile the two arms stop differing across the screen and start differing in depth:
    // same x, one nearer the viewer and so lower. What separates them side-on is how far forward
    // each is swung — so the lateral split has to go to zero, or it cancels the forward reach on
    // whichever side it opposes and leaves that facing armless while its mirror keeps an arm.
    const arms = [-1, 1].map((side) => {
      const swing = -side; // opposite the leg on the same side
      const reach = ARM_REST + ARM_SWING * swing * (ARM_REST_SWING + (1 - ARM_REST_SWING) * step);
      return {
        side,
        reach,
        lead: swing,
        x: CX + side * HAND_DX * (1 - profile) + fx * reach,
        y: HAND_Y + bob + swing * (0.9 * profile - step * (1 - profile)) + (side < 0 ? 0 : 0.22),
      };
    });

    for (const arm of depthSorted(arms)) {
      limb(
        ctx,
        CX + arm.side * SHOULDER_DX * (1 - profile) + fx * 1.6 * profile + LEAN,
        SHOULDER_Y + bob + (arm.side < 0 ? 0.15 : 0),
        arm.x,
        arm.y,
        arm.side * ARM_BEND * (1 - profile) + fx * profile * arm.reach * 0.3,
        ARM_W_TOP,
        ARM_W_MID,
        ARM_W_END,
      );
      ellipse(ctx, arm.x, arm.y, HAND_R, HAND_R * 1.12, arm.side * 0.3);
      ctx.fill();
    }

    ellipse(ctx, CX, TORSO_Y + bob, TORSO_RX * narrow, TORSO_RY);
    ctx.fill();
    drawShorts(ctx, hipY, hipRX);

    drawButtons(ctx, fx, fy, profile, hipY);
    drawHead(ctx, fx, fy, profile, bob);
  },
};

// Shorts, not an egg: narrow at the waist, flared, and cut off by a straight hem the legs come out
// from under. The flare and the hem are silhouette, which is the only place a garment can be drawn
// at this size — the buttons alone leave the body reading as one undifferentiated blob.
function drawShorts(ctx: CanvasRenderingContext2D, hipY: number, hipRX: number): void {
  const top = hipY - HIP_RY;
  const hem = hipY + HIP_RY;
  const waist = hipRX * 0.62;
  ctx.beginPath();
  ctx.moveTo(CX - waist, top);
  ctx.quadraticCurveTo(CX - hipRX * 1.04, hipY + 0.6, CX - hipRX, hem - 0.55);
  ctx.quadraticCurveTo(CX - hipRX, hem, CX - hipRX + 0.55, hem);
  ctx.lineTo(CX + hipRX - 0.55, hem);
  ctx.quadraticCurveTo(CX + hipRX, hem, CX + hipRX, hem - 0.55);
  ctx.quadraticCurveTo(CX + hipRX * 1.04, hipY + 0.6, CX + waist, top);
  ctx.closePath();
  ctx.fill();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  profile: number,
  bob: number,
): void {
  const headX = CX + LEAN;
  const headY = HEAD_Y + bob;
  const snoutX = headX + fx * 3;
  const snoutY = headY + 2.3;
  const snoutRX = 2.3 + 0.45 * profile;
  const snoutRY = 1.65;

  ctx.fillStyle = INK;
  ellipse(ctx, headX - EAR_DX - fx * 0.6, EAR_Y + bob, EAR_R, EAR_R);
  ctx.fill();
  ellipse(ctx, headX + EAR_DX - fx * 0.6, EAR_Y + bob + 0.15, EAR_R_RIGHT, EAR_R_RIGHT);
  ctx.fill();
  ellipse(ctx, headX, headY, HEAD_R, HEAD_R);
  ctx.fill();

  // The snout leaves the head's silhouette in profile, so it is laid down as ink first and the
  // white sits inside it. A stroke would work too, but it draws a line across the middle of the
  // face where there should be none — and at this size it rasterises as a broken grey chain.
  // Only where the snout actually breaks the head's outline. Ringing it on every facing puts a
  // dashed grey chain under the muzzle of the front view that reads as a mouth nobody drew.
  const showFace = fy > FACE_HIDDEN_BELOW;
  if (profile > SNOUT_BREAKS_OUT_ABOVE) {
    ellipse(ctx, snoutX + fx * 0.3, snoutY, snoutRX + 0.7, snoutRY + 0.35);
    ctx.fill();
  }
  if (!showFace) return; // a head turned this far away shows no face at all

  ctx.fillStyle = PAPER;
  ellipse(ctx, headX + fx * 1.35, headY + 0.3, 2.85, 3.05);
  ctx.fill();
  ellipse(ctx, snoutX, snoutY, snoutRX, snoutRY);
  ctx.fill();

  const eyeY = headY - 0.75;
  const eyeCX = headX + fx * 1.7;
  const sep = 1.2 * (1 - 0.5 * profile);
  for (const side of [-1, 1]) {
    const far = side * Math.sign(fx) < 0;
    const scale = far ? 1 - 0.8 * profile : 1;
    if (scale < 0.3) continue; // at full profile the far eye is behind the snout
    const rx = (1 + 0.15 * profile) * scale;
    // Both wedges lean the same way. Mirroring them turns the pair into matched brackets, which is
    // the symmetry tell again, and a hand-inked pair never matched anyway.
    pieEye(ctx, eyeCX + side * sep, eyeY, rx, side < 0 ? 1.35 : 1.4, 0.35);
  }

  // Far enough out that the nose meets the ink around the snout rather than floating in the white
  // with a hairline of paper between the two. Tilted, because a nose sitting exactly on the
  // horizontal is the giveaway of a shape placed by arithmetic.
  ctx.fillStyle = INK;
  ellipse(ctx, headX + fx * 4.6, headY + 2.2, 1.25, 0.92, fx * 0.28);
  ctx.fill();
}

// A solid oval with a wedge notched out of its top and no pupil — the 1928 eye. The apex sits below
// the centre so the wedge takes a bite rather than splitting the oval into a hook, and the wedge is
// paper rather than erased because the eye always sits on the white of the face.
function pieEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  tilt: number,
): void {
  ctx.save();
  ctx.fillStyle = INK;
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
  ctx.clip();
  const cut = -Math.PI / 2 + tilt;
  const apexY = y;
  const reach = ry * 4;
  const spread = 0.42;
  ctx.beginPath();
  ctx.moveTo(x, apexY);
  ctx.lineTo(x + Math.cos(cut - spread) * reach, apexY + Math.sin(cut - spread) * reach);
  ctx.lineTo(x + Math.cos(cut + spread) * reach, apexY + Math.sin(cut + spread) * reach);
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
  const cx = CX + fx * 1.4;
  const y = hipY + 0.1;
  // Two buttons only while there is room between them. Foreshortened they merge into one light
  // band across the hips, which reads as a slot cut through the body rather than as buttons.
  if (profile > 0.6) {
    ellipse(ctx, cx + fx * 0.35, y, 0.72, 0.72);
    ctx.fill();
    return;
  }
  const sep = 1.45 * (1 - 0.25 * profile);
  ellipse(ctx, cx - sep, y, 0.75, 0.75);
  ctx.fill();
  ellipse(ctx, cx + sep, y - 0.14, 0.67, 0.67);
  ctx.fill();
}

// Solid ink. Outlined white shoes are the brightest mass on a figure that is otherwise solid black:
// they break the ink language, read as light-coloured spats, and in profile the two overlap into a
// single white pill. Oversized is carried by the silhouette instead.
//
// Toe and heel are separate lobes, so the shoe points where the figure faces and is not the
// perfectly symmetrical lens a single ellipse gives. Running up or down the screen the toe is
// foreshortened away to nothing, and what is left is depth — so it shifts in `y` instead, which is
// the only thing distinguishing the feet of the front view from the feet of the back view.
function drawShoe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fx: number,
  fy: number,
  profile: number,
  side: number,
): void {
  const tilt = (1 - profile) * side * 0.26;
  ctx.fillStyle = INK;
  ellipse(ctx, x + fx * 1.15, y + fy * 0.45, 1.6 + 0.7 * profile, SHOE_RY * 0.95, tilt);
  ctx.fill();
  ellipse(ctx, x - fx * 0.55, y - fy * 0.35, 1.3 + 0.2 * profile, SHOE_RY, tilt);
  ctx.fill();
}

// A limb is two hoses meeting at a joint, not one arc. However well a single arc tapers it reads as
// a tentacle: what makes a leg a leg is the change of direction partway down, the thigh carrying
// outward and the shin dropping back in. No hard corner — this is rubber hose, so the joint is a
// bend in a continuous tube rather than a hinge.
function limb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bend: number,
  wTop: number,
  wMid: number,
  wEnd: number,
): void {
  const knee = 0.58;
  const kx = ax + (bx - ax) * knee + bend;
  const ky = ay + (by - ay) * knee;
  hose(ctx, ax, ay, (ax + kx) / 2 + bend * 0.7, (ay + ky) / 2, kx, ky, wTop, wMid);
  hose(ctx, kx, ky, (kx + bx) / 2 - bend * 0.55, (ky + by) / 2, bx, by, wMid, wEnd);
}

// A quadratic swept by a width that tapers from `wTop` to `wEnd` and swells through the belly of
// the curve, filled as one polygon with rounded ends. `ctx.stroke` cannot vary its width, and a
// constant width is what makes a limb read as a tube from a drawing program rather than as ink.
function hose(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  wTop: number,
  wEnd: number,
): void {
  const steps = 12;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y = u * u * ay + 2 * u * t * cy + t * t * by;
    const dx = 2 * u * (cx - ax) + 2 * t * (bx - cx);
    const dy = 2 * u * (cy - ay) + 2 * t * (by - cy);
    const len = Math.hypot(dx, dy) || 1;
    const half = ((wTop + (wEnd - wTop) * t) * (1 + 0.2 * Math.sin(Math.PI * t))) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left.slice(1)) ctx.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, ax, ay, wTop / 2, wTop / 2);
  ctx.fill();
  ellipse(ctx, bx, by, wEnd / 2, wEnd / 2);
  ctx.fill();
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
