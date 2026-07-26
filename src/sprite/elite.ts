import type { SpriteSubject } from "./sheet";

// The elite spider. Its sibling the grunt is exaggerated into long thin legs; this one is
// exaggerated the other way, into body mass. The game is black and white, so silhouette is the
// only thing telling the two apart: the grunt is a small dot on wire, this is a heavy two-lobed
// carcass carried on eight short thick arches.
//
// The projection is the hybrid #76 fixes for spiders and nothing else in the game: the **body and
// face are upright**, drawn head-on, while the **legs splay flat around them**, drawn from above.
// Three things follow, and they shape everything below.
//
// - **A leg arches.** It leaves the body's flank, rises *outboard of and above* where it attached,
//   and comes down to a planted foot. That hook over the silhouette is the whole spider signal; a
//   leg that only hangs off the bottom contour reads as a drip and the creature reads as an ant.
// - **The body turns by overlap, not by moving.** An upright body cannot slide up or down the
//   screen as it turns, so the turn is carried by the two lobes trading places: the small
//   face-carrying cephalothorax leads, the big abdomen trails, and the near one is drawn over the
//   far one. Walking at the player puts the small lobe low; walking away puts it high.
// - **Each foot's bearing sets its lateral position honestly, and its depth is compressed.** Two
//   legs the same angle fore and aft of the creature therefore share a column and separate only in
//   depth, exactly as they do in a real profile. Depth itself is squeezed into a shallow band
//   below the body, because at 48 px an upright body hides anything standing behind it — and a
//   spider that shows four of its eight legs is an octopus.
//
// Nothing here is exactly mirrored: the bearings carry a fixed skew and every leg has its own
// reach, knee height and knee clearance. Exact symmetry is a tell, not a style.

const SIZE = 48;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S with the face turned at the player, 4 = W, 6 = N showing the creature's back.
const heading = (facing: number) => (facing / FACINGS) * TAU;

// The body is wide, but not so wide that a leg has nowhere to arch. Eight arches need room
// outboard of the silhouette, and at 48 px a body that fills the box eats it — which is how the
// legs end up fused to the flank and the creature ends up a shaggy lump.
const CORE = { x: 24, y: 18 };
const ABDOMEN = { rx: 9.8, ry: 9.5 }; // the heavy back lobe: the elite's whole silhouette identity
const HEAD = { rx: 7.5, ry: 7 }; // the cephalothorax, smaller and set lower — it carries the face
const HEAD_DROP = 2.5; // it sits below the abdomen at every facing, not only when it leads
const LATERAL = 5; // how far apart the lobes slide as the creature turns side-on
const DEPTH = 5; // and how far the near one drops below the far one
const SWELL = 0.08; // the near lobe grows this much, the far one shrinks by it

// Where each foot falls, as a bearing off the heading, mirrored per side — plus a fixed skew that
// is *not* mirrored, so no facing of this sprite has an axis of exact symmetry.
const LEG_BEARINGS = [36, 72, 110, 150].map((d) => d * DEG);
const LEG_SKEW = [2, -3, 1.5, -2].map((d) => d * DEG);
const LEG_REACH = 16;
const LEG_SPACING = 0.55; // how far the feet are pulled off their bearing to stop them colliding
const KNEE_OUT = [2, 1.1, 1.6, 0.7]; // the arch peaks out beyond the foot, not halfway to it
const KNEE_UP = [6.8, 4.6, 5.8, 3.8]; // and above where the leg left the body
const SHOULDER_DROP = 0.45; // legs leave the body low, so the arch has white to rise through
const FOOT_LINE = 38;
const FOOT_DEPTH = 3.5; // a foot behind the creature lands higher up the screen than one in front
const FOOT_SAG = 3.5; // and a foot under the middle of the body lands nearer the viewer
const LEG_ROOT_W = 4.2;
const LEG_TIP_W = 1.9; // never below 1 CSS px, or the tip breaks up into grey at real size
const LEG_BELLY = 0.16; // rubber hose: the tube swells at the belly of its curve
const LEG_BURIED = 2.5; // the root starts inside the body, so the two fills meet without a seam

// Two frames, and frame 0 is the one that carries the sprite: the cycle parks there whenever a
// creature is not moving (#81), which at the front line is most of them, most of the time. So
// frame 0 is the neutral planted stance, every foot down. Frame 1 is the scuttle — an alternating
// tetrapod, half the legs swung forward and planted while the other half swing back and lift clear
// of the floor. The body itself does not move between frames, and neither does the foot ring: a
// sprite that inflates and deflates reads as a pulse rather than as a stride.
const SWING = 15 * DEG;
const LIFT = 2.6; // how far a swinging foot comes off the floor

// The eyes sit at a fixed bearing around the head and vanish as that bearing passes the limb, so
// the eight facings fall out of the heading instead of being drawn one at a time. They are narrow
// tilted slits rather than rounds: a white oval on a black curve is where you would paint a
// specular highlight, and at real size that is exactly what it reads as.
const EYE_BEARING = 34 * DEG;
const EYE_ORBIT = 7;
const EYE_EDGE = 0.12; // past the limb the eye is gone
const EYE_SLIVER = 0.5; // and near it, it flattens no further than this or it reads as a nick
const EYE = { rx: 3.5, ry: 1.75, rise: 1.8, tilt: 26 * DEG };

const FANG_DROP = 3.2;
const FANG_W = 1.2;
const FANG_GAP = 2.4;

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
    const toward = Math.sin(theta); // +1 walking at the player, -1 walking away
    const across = Math.cos(theta);

    const head = lobe(HEAD, across * LATERAL, toward * DEPTH + HEAD_DROP, 1 + toward * SWELL);
    const abdomen = lobe(ABDOMEN, -across * LATERAL, -toward * DEPTH, 1 - toward * SWELL);
    const body = [head, abdomen];

    ctx.fillStyle = "#000";
    for (const l of layOutLegs(theta, frame)) leg(ctx, l, body);

    if (toward < 0) {
      drawMass(ctx, head);
      drawMass(ctx, abdomen);
      return;
    }
    drawMass(ctx, abdomen);
    drawMass(ctx, head);
    drawFace(ctx, head, theta);
  },
};

function lobe(r: { rx: number; ry: number }, dx: number, dy: number, scale: number): Mass {
  return { x: CORE.x + dx, y: CORE.y + dy, rx: r.rx * scale, ry: r.ry * scale };
}

interface Leg {
  index: number;
  foot: Point;
  depth: number; // +1 the foot is in front of the creature, -1 behind it
  out: -1 | 1; // which side of the box the leg arches over
  spread: number; // 0 under the body, 1 at full stretch — how high the arch can afford to be
}

// The eight feet, placed and then sorted apart. The bearing decides where a foot wants to be, but
// two legs the same angle fore and aft of the creature want the same column, and eight legs sharing
// four columns is four legs as far as a player is concerned. So the honest placement is blended
// with an even fan: the ordering and the lean survive, the collisions do not.
function layOutLegs(theta: number, frame: number): Leg[] {
  const wanted = [];
  for (let index = 0; index < LEG_BEARINGS.length; index++) {
    for (const side of [-1, 1]) {
      // Neighbouring legs down one side are never in the same half of the gait, and the two sides
      // are out of phase: the alternating tetrapod a spider actually walks on.
      const forward = (index + (side > 0 ? 1 : 0)) % 2 === 0;
      const phase = frame === 0 ? 0 : forward ? 1 : -1;
      const bearing = theta + side * LEG_BEARINGS[index] + LEG_SKEW[index] + phase * SWING;
      wanted.push({ index, bearing, lift: phase < 0 ? LIFT : 0 });
    }
  }
  wanted.sort((a, b) => Math.cos(a.bearing) - Math.cos(b.bearing));

  const legs = wanted.map((w, slot) => {
    const across = Math.cos(w.bearing);
    const depth = Math.sin(w.bearing);
    const fanned = (slot - (wanted.length - 1) / 2) / ((wanted.length - 1) / 2);
    const spread = across * (1 - LEG_SPACING) + fanned * LEG_SPACING;
    return {
      index: w.index,
      depth,
      out: (spread >= 0 ? 1 : -1) as -1 | 1,
      spread: Math.abs(spread),
      foot: {
        x: CORE.x + spread * LEG_REACH,
        y: FOOT_LINE + depth * FOOT_DEPTH + (1 - spread * spread) * FOOT_SAG - w.lift,
      },
    };
  });
  // Behind first, so a leg in front of the creature laps the one behind it rather than the reverse.
  return legs.sort((a, b) => a.depth - b.depth);
}

// One rubber-hose leg: out and up off the flank, over an arch that clears the silhouette, and down
// to its foot on the floor. Filled rather than stroked, so the tube can swell at the belly of the
// curve and taper to a rounded foot, and bent in one continuous curve, so it has no joint.
function leg(ctx: CanvasRenderingContext2D, l: Leg, body: Mass[]): void {
  const { foot, out } = l;
  // A leg whose foot falls behind the creature leaves the body a little higher up its flank than
  // one whose foot falls in front, which is what keeps the eight arches off each other.
  const shoulder = flank(out, SHOULDER_DROP - l.depth * 0.3, body);
  // The arch peaks *over the foot*, not halfway to it: the leg goes out from under the body, up
  // and clear of the silhouette, and only then comes down. Bending it at the midpoint instead
  // keeps the whole arch inside the body, where it fuses to the flank and reads as a shaggy hem.
  // Legs planted under the belly have nowhere to rise into, so they barely arch at all.
  const knee = {
    x: foot.x + out * KNEE_OUT[l.index],
    y: shoulder.y - KNEE_UP[l.index] * (0.3 + 0.7 * l.spread),
  };

  const steps = 14;
  const near: Point[] = [];
  const far: Point[] = [];
  let tip = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p = quadratic(shoulder, knee, foot, t);
    const d = quadraticTangent(shoulder, knee, foot, t);
    const len = Math.hypot(d.x, d.y) || 1;
    const taper = LEG_ROOT_W + (LEG_TIP_W - LEG_ROOT_W) * t ** 0.75;
    const half = (taper * (1 + LEG_BELLY * Math.sin(Math.PI * t))) / 2;
    near.push({ x: p.x - (d.y / len) * half, y: p.y + (d.x / len) * half });
    far.push({ x: p.x + (d.y / len) * half, y: p.y - (d.x / len) * half });
    tip = Math.atan2(d.y, d.x);
  }

  ctx.beginPath();
  ctx.moveTo(near[0].x, near[0].y);
  for (let i = 1; i <= steps; i++) ctx.lineTo(near[i].x, near[i].y);
  ctx.arc(foot.x, foot.y, LEG_TIP_W / 2, tip + Math.PI / 2, tip - Math.PI / 2, true);
  for (let i = steps; i >= 0; i--) ctx.lineTo(far[i].x, far[i].y);
  ctx.closePath();
  ctx.fill();
}

// Where a direction leaves the body's outline, marched rather than solved because the outline is
// the union of two ellipses and it is the far crossing a leg has to start outside of.
function flank(dx: number, dy: number, body: Mass[]): Point {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let radius = 0;
  for (let t = 0; t <= 26; t += 0.5) {
    const x = CORE.x + ux * t;
    const y = CORE.y + uy * t;
    if (body.some((m) => ((x - m.x) / m.rx) ** 2 + ((y - m.y) / m.ry) ** 2 <= 1)) radius = t + 0.5;
  }
  const buried = Math.max(radius - LEG_BURIED, 0);
  return { x: CORE.x + ux * buried, y: CORE.y + uy * buried };
}

function drawMass(ctx: CanvasRenderingContext2D, m: Mass): void {
  ctx.beginPath();
  ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, TAU);
  ctx.fill();
}

// The face is knocked out of the ink in white, which is how the era drew a black character. The
// tilt of the slits is the whole of the elite's expression, and the only thing that makes it a
// threat rather than a bug. Everything stays inside the head's outline: a mouth cut through the
// bottom contour hollows out the very mass this sprite exists to sell.
function drawFace(ctx: CanvasRenderingContext2D, head: Mass, theta: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(head.x, head.y, head.rx, head.ry, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "#fff";

  for (const side of [-1, 1]) {
    const bearing = theta + side * EYE_BEARING;
    const open = Math.sin(bearing);
    if (open <= EYE_EDGE) continue;
    const x = head.x + EYE_ORBIT * Math.cos(bearing);
    const inward = head.x < x ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(
      x,
      head.y - EYE.rise,
      EYE.rx * Math.max(open, EYE_SLIVER),
      EYE.ry,
      -inward * EYE.tilt,
      0,
      TAU,
    );
    ctx.fill();
  }

  const gape = 0.45 + 0.55 * Math.sin(theta);
  const mouth = { x: head.x + head.rx * 0.4 * Math.cos(theta), y: head.y + head.ry * 0.25 };
  for (const side of [-1, 1]) {
    const x = mouth.x + side * FANG_GAP * gape;
    const w = FANG_W * (0.5 + 0.5 * gape);
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
