import type { SpriteSubject } from "./sheet";

// The elite spider. Its sibling the grunt is exaggerated into long thin legs; this one is
// exaggerated the other way, into body mass. The game is black and white, so silhouette is the
// only thing telling the two apart: the grunt is a small dot on wire, this is a heavy two-lobed
// carcass carried on eight short thick legs.
//
// The projection is the hybrid #76 fixes for spiders and nothing else in the game: the **body and
// face are upright**, drawn head-on, while the **legs splay flat around them**, drawn from above.
// Four things follow, and they are what the sprite is made of.
//
// - **A leg has a knee.** One unbroken curve reads as a tentacle however well it tapers — the
//   octopus that several rounds of reshaping could not shift. Two hoses meeting at an angle, thigh
//   climbing away from the body and shin dropping back to the floor, thickest where they meet, is
//   what says arthropod. It is still rubber hose: a bend in the tube, not a mechanism.
// - **A knee is placed clear of the body, and the leg only rises once it is.** That clearance is
//   the white sky between flank and limb, and without it eight legs sinter into a shaggy hem.
// - **The body turns by overlap, not by moving.** An upright body cannot slide up or down the
//   screen as it turns, so the turn is carried by the two lobes trading places: the face-carrying
//   cephalothorax leads and drops, the big abdomen trails and rides high, and the near one is
//   drawn over the far one.
// - **The creature is centred on its position, not stood on it.** The legs splay flat around the
//   spider and that ring *is* the floor contact, so the ring is centred in the box and the body
//   rises out of it. Foot-anchoring at the bottom edge is for things that stand on two legs.
//
// Nothing here is exactly mirrored: the bearings carry a skew that is not mirrored, and every leg
// has its own reach, rise and clearance. Exact symmetry is a tell, not a style.

const SIZE = 48;
const FACINGS = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// #73 fixed the convention: `angle = facing / 8 × 2π` on a canvas whose y points down, so 0 = E,
// 2 = S with the face turned at the player, 4 = W, 6 = N showing the creature's back.
const heading = (facing: number) => (facing / FACINGS) * TAU;

const FLOOR = { x: 24, y: 36 }; // the spider's position: the centre of the flat ring of feet
const CORE = { x: 23.4, y: 16 }; // the body rises out of it, off the box's centre line on purpose
const ABDOMEN = { rx: 9.4, ry: 8.8 }; // the heavy back lobe: the elite's whole silhouette identity
const HEAD = { rx: 8.2, ry: 7.6 }; // the cephalothorax, smaller and lower — it carries the face
const HEAD_DROP = 2; // it sits below the abdomen at every facing, not only when it leads
const LATERAL = 5; // how far apart the lobes slide as the creature turns side-on
const DEPTH = 5.5; // and how far the near one drops below the far one
const SWELL = 0.08; // the near lobe grows this much, the far one shrinks by it

// Where each foot falls, as a bearing off the heading, mirrored per side — plus a fixed skew that
// is *not* mirrored, so no facing of this sprite has an axis of exact symmetry.
const LEG_BEARINGS = [36, 72, 110, 150].map((d) => d * DEG);
const LEG_SKEW = [2, -3, 1.5, -2].map((d) => d * DEG);
const LEG_STRETCH = [1, 0.93, 1.06, 0.88]; // and its own reach, so the fan is never evenly spaced
const RING_REACH = 20;
const RING_DEPTH = 4; // the ring is flattened hard: every foot has to land
// in one band clear of the body, or the ones behind it are swallowed and nothing reads as standing
const LEG_SPACING = 0.7; // how far a foot is pulled off its bearing to stop two sharing a column
const FAN_FLOOR = 0.5; // and no foot lands under the body, where its whole leg would be hidden

const KNEE_AT = 0.58; // where along the leg the two hoses meet
const KNEE_CLEAR = [3.4, 2.2, 2.9, 1.6]; // how far outboard of the body's outline the knee sits
const KNEE_RISE = [8, 5.6, 7, 4.4]; // and how far above the hip, once that clearance is possible
const KNEE_LIMIT = 20; // past this the knee would leave the box, so the rise gives way instead
const KNEE_CEILING = [7.5, 4.6, 6.4, 3.2]; // no knee climbs higher above the body's middle,
const KNEE_W = 4.6; // and each sits at its own height, so no two thighs stack into one slab
const HIP_W = 3.2; // narrow where it leaves the flank, so white traps it there
const FOOT_W = 1.2;
const LEG_BURIED = 3.6; // the hip starts inside the body, so the two fills meet without a seam

// Two frames. Frame 0 carries the sprite — the cycle parks there whenever a creature is not
// moving (#81), which at the front line is most of them, most of the time. So neither frame is the
// neutral pose: they sit a third and two thirds through one stride, counter-posed, with one
// tetrapod planted and the other clear of the floor in *both*. A cycle that returns to symmetry
// every other frame reads as a pulse rather than as a gait.
const STRIDE = 17 * DEG;
const PHASE = [-0.33, 0.67]; // of a stride, for the tetrapod that leads
const LIFT = 1.8; // how far the other tetrapod's feet come off the floor

// The eyes sit at a fixed bearing around the head and vanish as that bearing passes the limb, so
// the eight facings fall out of the heading instead of being drawn one at a time. They are narrow
// tilted slits, never rounds: a white disc on a black curve is where you would paint a specular
// highlight, and at real size that is exactly what it reads as.
const EYE_BEARING = 34 * DEG;
const EYE_ORBIT = 7.2;
const EYE_EDGE = 0.3; // an eye this near the limb goes, rather than squeezing into its neighbour
const EYE_SLIVER = 0.62; // and one that stays never flattens past this, or it reads as a nick
const EYE = { rx: 3.2, ry: 1.35, rise: 1.6, tilt: 24 * DEG };

const FANG_DROP = 3.6;
const FANG_W = 1.7; // half-width: a knocked-out mark under 1 CSS px bakes to grey, not to white
const FANG_GAP = 2.8;
const FACE_INSET = 1.1; // and no face mark comes closer than this to the head's outline

// The spinnerets, on the far side of the abdomen — so they are only ever seen from behind. They
// are the one silhouette mark that says "walking away", on the three facings that have no face.
const SPINNERET = { spread: 3.4, length: 4.4, width: 3.2 };

interface Point {
  x: number;
  y: number;
}

interface Mass extends Point {
  rx: number;
  ry: number;
}

interface Leg {
  index: number;
  foot: Point;
  depth: number; // +1 the foot falls in front of the creature, -1 behind it
  out: -1 | 1; // which side of the box the leg reaches over
  spread: number; // 0 under the body, 1 at full stretch
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

    // The face is gated on the head being turned at the viewer, so the rear three facings go blank
    // without a special case — and the abdomen, being nearer there, laps over the head.
    if (toward < 0) {
      drawMass(ctx, head);
      drawMass(ctx, abdomen);
      drawSpinnerets(ctx, abdomen, across, toward);
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

// The eight feet, placed by bearing and then sorted apart. The bearing decides where a foot wants
// to land, but two legs the same angle fore and aft of the creature want the same column, and
// eight legs sharing four columns is four legs as far as a player is concerned. So the honest
// placement is blended with an even fan: the ordering and the lean survive, the collisions do not.
function layOutLegs(theta: number, frame: number): Leg[] {
  const wanted = [];
  for (let index = 0; index < LEG_BEARINGS.length; index++) {
    for (const side of [-1, 1]) {
      // Neighbouring legs down one side are never in the same tetrapod, and the two sides are out
      // of phase with each other: the alternating gait a spider actually walks on.
      const leads = (index + (side > 0 ? 1 : 0)) % 2 === 0;
      const phase = leads ? PHASE[frame] : -PHASE[1 - frame];
      const bearing = theta + side * LEG_BEARINGS[index] + LEG_SKEW[index] + phase * STRIDE;
      // Exactly one tetrapod is off the floor in each frame, so neither frame is the fuller one.
      wanted.push({ index, bearing, lift: leads === (frame === 1) ? LIFT : 0 });
    }
  }
  wanted.sort((a, b) => Math.cos(a.bearing) - Math.cos(b.bearing));

  const legs = wanted.map((w, slot) => {
    const across = Math.cos(w.bearing);
    const depth = Math.sin(w.bearing);
    const fanned = (slot - (wanted.length - 1) / 2) / ((wanted.length - 1) / 2);
    const wants = across * (1 - LEG_SPACING) + fanned * LEG_SPACING;
    const spread =
      Math.sign(wants) * (FAN_FLOOR + (1 - FAN_FLOOR) * Math.abs(wants)) * LEG_STRETCH[w.index];
    return {
      index: w.index,
      depth,
      out: (spread >= 0 ? 1 : -1) as -1 | 1,
      spread: Math.abs(spread),
      // A leg reaching toward the viewer plants further out than one reaching away, which is what
      // separates the creature coming at you from the same creature leaving.
      foot: {
        x: FLOOR.x + spread * RING_REACH * (1 + depth * 0.12),
        y: FLOOR.y + depth * RING_DEPTH - w.lift,
      },
    };
  });
  // Behind first, so a leg in front of the creature laps the one behind it rather than the reverse.
  return legs.sort((a, b) => a.depth - b.depth);
}

function leg(ctx: CanvasRenderingContext2D, l: Leg, body: Mass[]): void {
  const { foot, out } = l;
  // A leg whose foot falls in front of the creature leaves the body lower down its flank than one
  // whose foot falls behind, which is what keeps eight legs off each other.
  const hip = flank(out, 0.12 + l.depth * 0.3, body);

  // The leg may only climb as far as its knee can still clear the body. Where the body is widest
  // the knee would have to leave the box to stay clear, so there the rise gives way instead — the
  // alternative, a knee buried in the flank, is the merged slab that reads as a hem.
  let rise = KNEE_RISE[l.index] * (0.35 + 0.65 * l.spread);
  let reach = 0;
  for (let tries = 0; tries < 6; tries++) {
    reach = silhouetteReach(hip.y - rise, out, body) + KNEE_CLEAR[l.index];
    if (reach <= KNEE_LIMIT) break;
    rise *= 0.6;
  }
  // and never above the body's shoulder, where a thigh running along the top edge reads as a wing
  const knee = {
    x: FLOOR.x + out * Math.min(reach, KNEE_LIMIT),
    y: Math.max(hip.y - rise, CORE.y - KNEE_CEILING[l.index]),
  };

  const thigh = sample(hip, { x: hip.x + out * 1.4, y: hip.y - rise * 0.75 }, knee);
  const shin = sample(knee, { x: knee.x + out * 0.9, y: knee.y + (foot.y - knee.y) * 0.4 }, foot);
  const spine = [...thigh, ...shin.slice(1)];
  const knot = thigh.length - 1;
  const last = spine.length - 1;

  const near: Point[] = [];
  const far: Point[] = [];
  for (let i = 0; i <= last; i++) {
    const s =
      i <= knot ? (i / knot) * KNEE_AT : KNEE_AT + ((i - knot) / (last - knot)) * (1 - KNEE_AT);
    const width =
      s <= KNEE_AT
        ? HIP_W + (KNEE_W - HIP_W) * (s / KNEE_AT)
        : KNEE_W + (FOOT_W - KNEE_W) * ((s - KNEE_AT) / (1 - KNEE_AT)) ** 0.85;
    const prev = spine[Math.max(i - 1, 0)];
    const next = spine[Math.min(i + 1, last)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    near.push({
      x: spine[i].x - (dy / len) * (width / 2),
      y: spine[i].y + (dx / len) * (width / 2),
    });
    far.push({
      x: spine[i].x + (dy / len) * (width / 2),
      y: spine[i].y - (dx / len) * (width / 2),
    });
  }

  const tip = Math.atan2(spine[last].y - spine[last - 1].y, spine[last].x - spine[last - 1].x);
  ctx.beginPath();
  ctx.moveTo(near[0].x, near[0].y);
  for (let i = 1; i <= last; i++) ctx.lineTo(near[i].x, near[i].y);
  ctx.arc(foot.x, foot.y, FOOT_W / 2, tip + Math.PI / 2, tip - Math.PI / 2, true);
  for (let i = last; i >= 0; i--) ctx.lineTo(far[i].x, far[i].y);
  ctx.closePath();
  ctx.fill();
}

function sample(a: Point, c: Point, b: Point): Point[] {
  const steps = 8;
  return Array.from({ length: steps + 1 }, (_, s) => {
    const t = s / steps;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  });
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

// How far the body's outline stands out from the spider's position at one height, on one side.
function silhouetteReach(y: number, out: -1 | 1, body: Mass[]): number {
  let reach = 0;
  for (const m of body) {
    const t = (y - m.y) / m.ry;
    if (Math.abs(t) >= 1) continue;
    reach = Math.max(reach, out * (m.x - FLOOR.x) + m.rx * Math.sqrt(1 - t * t));
  }
  return reach;
}

function drawMass(ctx: CanvasRenderingContext2D, m: Mass): void {
  ctx.beginPath();
  ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, TAU);
  ctx.fill();
}

function drawSpinnerets(
  ctx: CanvasRenderingContext2D,
  abdomen: Mass,
  across: number,
  toward: number,
): void {
  const y = abdomen.y + abdomen.ry * 0.82;
  for (const side of [-1, 1]) {
    const x = abdomen.x + across * 2 + side * SPINNERET.spread;
    ctx.beginPath();
    ctx.moveTo(x - SPINNERET.width / 2, y);
    ctx.lineTo(x + SPINNERET.width / 2, y);
    ctx.lineTo(x + side * 0.6, y - toward * SPINNERET.length);
    ctx.closePath();
    ctx.fill();
  }
}

// The face is knocked out of the ink in white, which is how the era drew a black character. The
// tilt of the slits is the whole of the elite's expression, and the only thing that makes it a
// threat rather than a bug. Everything stays inside the head's outline: a mark that reaches the
// contour is cut open by it and hollows out the very mass this sprite exists to sell.
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
    const rx = EYE.rx * Math.max(open, EYE_SLIVER);
    const x = clampInside(
      head.x + EYE_ORBIT * Math.cos(bearing),
      head.x,
      head.rx - rx - FACE_INSET,
    );
    const inward = head.x < x ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(x, head.y - EYE.rise, rx, EYE.ry, -inward * EYE.tilt, 0, TAU);
    ctx.fill();
  }

  const gape = 0.75 + 0.25 * Math.sin(theta);
  const mouth = { x: head.x + head.rx * 0.4 * Math.cos(theta), y: head.y + head.ry * 0.22 };
  for (const side of [-1, 1]) {
    const w = FANG_W * gape;
    const x = clampInside(mouth.x + side * FANG_GAP * gape, head.x, head.rx - w - FACE_INSET);
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

function clampInside(value: number, centre: number, reach: number): number {
  return Math.max(centre - reach, Math.min(centre + reach, value));
}

export default elite;
