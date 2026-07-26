import type { SpriteSubject } from "./sheet";

// The elite spider. Its sibling the grunt is exaggerated into long legs; this one is exaggerated
// the other way, into a body that fills most of the box and legs that barely clear it. The game is
// black and white, so that difference in silhouette is the only thing telling the two apart.
//
// The projection is the hybrid #76 fixes for spiders and for nothing else in the game: the **body
// and face are upright**, drawn as if seen head-on, while the **legs splay flat around them**, as
// if seen straight down. Two consequences fall out of that and shape everything below:
//
// - The leg star is a top-down disc centred on the creature's contact with the floor, so it is
//   drawn first and the upright body simply covers whichever legs point away from the viewer.
//   Turning the creature rotates the disc, which is why the visible leg fan differs per facing.
// - Turning the body cannot move it up or down the screen, so depth is carried by *overlap*: the
//   abdomen changes sides with the head, rides high when it is the far mass, and swells and drops
//   in front of the head when the creature walks away from the viewer.

const SIZE = 48;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// #73 fixed the convention: `angle = facing / 8 × 2π` in canvas y-down space, so 0 = E, 2 = S with
// the face turned at the viewer, 4 = W, and 6 = N showing the creature's back.
const heading = (facing: number) => (facing / FACINGS) * TAU;

const HUB = { x: 24, y: 30.5 }; // where the legs meet the floor — the foot anchor the Y-sort uses
const BODY = { x: 24, y: 18, rx: 13.5, ry: 12 };
const ABDOMEN = { rx: 9.2, ry: 8.2 };
const LATERAL = 4; // how far head and abdomen separate as the creature turns side-on
const LIFT = 6; // and how far the abdomen rides above the head when it is the far mass
const SWELL = 0.18; // it grows this much again when it is the near one

const LEG_SPREAD = [48, 88, 128, 166].map((d) => d * DEG); // from the heading, per side
const LEG_REACH = 14;
const LEG_BOW = 3.2;
const LEG_BASE_W = 4.8; // stubby: nearly a fifth of its own length, where the grunt's are wire
const LEG_TIP_W = 2.4;

// A two-frame gait, and frame 0 is the one that has to carry it: the cycle parks there whenever a
// creature is not moving (#81), which at the front line is most of them, most of the time. So
// frame 0 is a planted, symmetric stance and frame 1 is the scuttle — an alternating tetrapod,
// half the legs swung toward the heading and reaching, the other half gathered under the body.
const SWING = 11 * DEG;
const REACHING = 1.08;
const GATHERED = 0.88;
const BOB = -1; // and the whole body lifts a hair as the legs push

const EYE_AZIMUTH = 38 * DEG; // where the eyes sit around the head, either side of the face
const EYE_ORBIT = 10;
const EYE_RX = 3.9;
const EYE_RY = 3.3;
const EYE_RISE = 3.4;
const EYE_EDGE = 0.1; // past the limb an eye is gone
const EYE_SLIVER = 0.32; // and near it, it flattens no further than this or it reads as a nick

const BRISTLES = [-150, -117, -90, -63, -30].map((d) => d * DEG);
const BRISTLE_H = 3;
const BRISTLE_W = 1.7;

const FANG_DROP = 4.4;
const FANG_W = 1.55;
const FANG_GAP = 2.9;

interface Point {
  x: number;
  y: number;
}

interface Mass extends Point {
  rx: number;
  ry: number;
}

const elite: SpriteSubject = {
  name: "elite",
  size: SIZE,
  facings: FACINGS,
  frames: 2,
  draw(ctx, _size, facing, frame) {
    const theta = heading(facing);
    const toward = Math.sin(theta); // +1 when the creature walks at the viewer, -1 when away
    const across = Math.cos(theta);
    const bob = frame === 0 ? 0 : BOB;

    const head: Mass = { x: BODY.x + across * LATERAL, y: BODY.y + bob, rx: BODY.rx, ry: BODY.ry };
    const swell = 1 - toward * SWELL;
    const abdomen: Mass = {
      x: BODY.x - across * LATERAL,
      y: BODY.y - toward * LIFT + bob,
      rx: ABDOMEN.rx * swell,
      ry: ABDOMEN.ry * swell,
    };

    ctx.fillStyle = "#000";
    drawLegs(ctx, theta, frame);
    if (toward < 0) {
      drawHead(ctx, head);
      drawMass(ctx, abdomen);
      return;
    }
    drawMass(ctx, abdomen);
    drawHead(ctx, head);
    drawFace(ctx, head, theta);
  },
};

function drawLegs(ctx: CanvasRenderingContext2D, theta: number, frame: number): void {
  for (let pair = 0; pair < LEG_SPREAD.length; pair++) {
    for (const side of [-1, 1]) {
      // Neighbouring legs down one side are never in the same half of the gait, and the two sides
      // are out of phase with each other: the alternating tetrapod a spider actually walks on.
      const reaching = (pair + (side > 0 ? 1 : 0)) % 2 === 0;
      const swing = frame === 0 ? 0 : reaching ? SWING : -SWING;
      const reach = frame === 0 ? 1 : reaching ? REACHING : GATHERED;
      const angle = theta + side * (LEG_SPREAD[pair] - swing);
      tube(ctx, HUB, angle, LEG_REACH * reach, side * LEG_BOW);
    }
  }
}

// One rubber-hose leg: a bowed tube that tapers to a rounded tip, filled rather than stroked so
// the taper is real. No joint anywhere along it — that is the whole of the style.
function tube(
  ctx: CanvasRenderingContext2D,
  from: Point,
  angle: number,
  reach: number,
  bow: number,
): void {
  const to = { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach };
  const ctrl = {
    x: (from.x + to.x) / 2 - Math.sin(angle) * bow,
    y: (from.y + to.y) / 2 + Math.cos(angle) * bow,
  };

  const steps = 12;
  const near: Point[] = [];
  const far: Point[] = [];
  let tip = angle;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p = quadratic(from, ctrl, to, t);
    const d = quadraticTangent(from, ctrl, to, t);
    const len = Math.hypot(d.x, d.y) || 1;
    const half = (LEG_BASE_W + (LEG_TIP_W - LEG_BASE_W) * t) / 2;
    near.push({ x: p.x - (d.y / len) * half, y: p.y + (d.x / len) * half });
    far.push({ x: p.x + (d.y / len) * half, y: p.y - (d.x / len) * half });
    tip = Math.atan2(d.y, d.x);
  }

  ctx.beginPath();
  ctx.moveTo(near[0].x, near[0].y);
  for (let i = 1; i <= steps; i++) ctx.lineTo(near[i].x, near[i].y);
  ctx.arc(to.x, to.y, LEG_TIP_W / 2, tip + Math.PI / 2, tip - Math.PI / 2, true);
  for (let i = steps; i >= 0; i--) ctx.lineTo(far[i].x, far[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawMass(ctx: CanvasRenderingContext2D, m: Mass): void {
  ctx.beginPath();
  ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, TAU);
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, head: Mass): void {
  drawMass(ctx, head);
  for (const t of BRISTLES) {
    const base = { x: head.x + head.rx * Math.cos(t), y: head.y + head.ry * Math.sin(t) };
    const gx = Math.cos(t) / head.rx;
    const gy = Math.sin(t) / head.ry;
    const len = Math.hypot(gx, gy) || 1;
    const out = { x: gx / len, y: gy / len };
    // The base sinks a little way into the mass, so the two fills meet with no seam between them.
    const foot = { x: base.x - out.x * 0.8, y: base.y - out.y * 0.8 };
    ctx.beginPath();
    ctx.moveTo(foot.x - out.y * BRISTLE_W, foot.y + out.x * BRISTLE_W);
    ctx.lineTo(foot.x + out.y * BRISTLE_W, foot.y - out.x * BRISTLE_W);
    ctx.lineTo(base.x + out.x * BRISTLE_H, base.y + out.y * BRISTLE_H);
    ctx.closePath();
    ctx.fill();
  }
}

// The face is knocked out of the ink in white — a black character with white features, which is
// how the era drew one. Every feature is placed by its azimuth around the head and disappears as
// that azimuth passes the limb, so all eight facings fall out of the heading rather than being
// authored one by one.
function drawFace(ctx: CanvasRenderingContext2D, head: Mass, theta: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(head.x, head.y, head.rx, head.ry, 0, 0, TAU);
  ctx.clip();

  for (const side of [-1, 1]) {
    const azimuth = theta + side * EYE_AZIMUTH;
    const facingViewer = Math.sin(azimuth);
    if (facingViewer <= EYE_EDGE) continue;
    const rx = EYE_RX * Math.max(facingViewer, EYE_SLIVER);
    const x = head.x + EYE_ORBIT * Math.cos(azimuth);
    const y = head.y - EYE_RISE;

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, EYE_RY, 0, 0, TAU);
    ctx.fill();

    // The brow: ink laid back over the eye, dropping toward the middle of the face. It is the
    // whole of the elite's expression, and the only thing making it a threat rather than a bug.
    const inward = head.x < x ? -1 : 1;
    const edge = rx + 1;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(x - inward * edge, y - EYE_RY * 1.5);
    ctx.lineTo(x + inward * edge, y + EYE_RY * 0.15);
    ctx.lineTo(x + inward * edge, y - EYE_RY * 3);
    ctx.lineTo(x - inward * edge, y - EYE_RY * 3);
    ctx.closePath();
    ctx.fill();
  }

  const open = 0.38 + 0.62 * Math.sin(theta);
  const mouth = { x: head.x + head.rx * 0.5 * Math.cos(theta), y: head.y + head.ry * 0.34 };
  ctx.fillStyle = "#fff";
  for (const side of [-1, 1]) {
    const x = mouth.x + side * FANG_GAP * open;
    const w = FANG_W * (0.45 + 0.55 * open);
    ctx.beginPath();
    ctx.moveTo(x - w, mouth.y);
    ctx.lineTo(x + w, mouth.y);
    ctx.lineTo(x, mouth.y + FANG_DROP);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
  ctx.fillStyle = "#000";
}

function quadratic(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

function quadraticTangent(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: 2 * (u * (c.x - a.x) + t * (b.x - c.x)), y: 2 * (u * (c.y - a.y) + t * (b.y - c.y)) };
}

export default elite;
