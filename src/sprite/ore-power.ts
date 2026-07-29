import type { SpriteSubject } from "./sheet";
import { drawTiled, TILED_FACINGS } from "./tiled";

// Power ore: one 15 px tile of the glowing seam, drawn flat and straight down like the floor it is
// part of (#76 §2). Ten to twenty tiles make a patch and the game picks a variant from the tile's
// coordinate, so a whole field costs nothing on the wire.
//
// Red is one of only two colours #76 grants the game, so it is spent where it does work rather
// than spread until the tile is a red square. **The tile has no background**: the paper shows
// through, and the only red is what escapes the ore itself — the solid bodies and the radiance
// around them. An earlier cut filled the whole box with a flat wash to carry the glow to every
// edge; over white paper that reads as a pink square with hard edges, and a patch of them prints
// a visible grid of squares. A glow that fills its own box is a tile, not a glow.
//
// The ink is a weighted line rather than a contour. Each body is filled black and then re-filled
// red offset up and left, so black survives only as a crescent, heaviest at the lower right and
// gone by the upper left. That is how the line was drawn, it swells and tapers for free, and it
// never asks the rasteriser for a stroke thinner than it can hold. A body too small to carry a
// crescent that thick goes bare instead of turning into a black dot.
//
// A generator — 75 px, flat, white — is built on a patch and covers most of it. Nothing here needs
// the middle of a tile to survive: the tiles the chassis misses still carry bodies, and with no
// background there is nothing for the chassis to punch a hole in.

const SIZE = 15; // TILE
const VARIANTS = 12; // more than a patch holds, so no patch reads as a repeating stamp

const INK = "#000";
const ORE = "#d1200e"; // the body: dark enough to hold its shape against the paper it sits on
const EMBER = "#ff5c2a"; // hotter and barely oranger, only ever at the centre of the largest body
const GLOW = "224, 50, 20"; // the radiance, which supplies its own alpha per stop

const CENTRE = SIZE / 2;
const TAU = Math.PI * 2;

// The line always falls to the lower right and the ember always sits up and left of it, so twelve
// variants read as one hand drawing one motif twelve times rather than as twelve motifs.
// #106 asks the ore for bolder ink. Here the ink is the crescent, so this is where the weight goes:
// a floor a quarter over a logical pixel, and half again as much of the body's radius as before
// (0.42). At dpr 1 the old floor put exactly one device pixel of black on the smallest lit body,
// which is the width at which a line is indistinguishable from a grey edge. Both provisional.
const WEIGHT_MIN = 1.25;
const WEIGHT_OF_R = 0.55;
const BARE_BELOW = 2.1; // a body this small is all line and no colour, so it takes none

const GLOW_REACH = 2.8; // of the body's radius
const GLOW_LOBES = 9; // odd, and long-short alternating, so the radiance has points and no axis
const GLOW_LONG = 2.5;
const GLOW_SHORT = 1.7;

const OUTLINE_POINTS = 7; // odd: a seven-point blob cannot come out mirror-symmetric
const EMBER_OF_R = 0.44;

interface Body {
  x: number;
  y: number;
  r: number;
  rotation: number;
  outline: number[];
}

// Mulberry32. The variants have to be identical on every client, and a hand-written table of the
// ~250 numbers twelve lumpy pebbles need would be neither identical nor hand-written.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// A closed curve through jittered radial samples: quadratics through the midpoints, so the corners
// round off into lobes instead of reading as a polygon at three pixels across.
function blob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radii: number[],
  rotation: number,
): void {
  const n = radii.length;
  const at = (i: number): [number, number] => {
    const angle = rotation + (i / n) * TAU;
    const r = radii[((i % n) + n) % n];
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const mid = (i: number): [number, number] => {
    const [ax, ay] = at(i);
    const [bx, by] = at(i + 1);
    return [(ax + bx) / 2, (ay + by) / 2];
  };
  ctx.beginPath();
  ctx.moveTo(...mid(-1));
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(...at(i), ...mid(i));
  ctx.closePath();
}

function outlineOf(rand: () => number, r: number): number[] {
  return Array.from({ length: OUTLINE_POINTS }, () => r * (0.84 + rand() * 0.32));
}

// Bodies are scattered on a jittered fan from the tile's middle rather than dropped near it: a big
// body pinned at every tile centre is the lattice this sprite exists to avoid, and the fan lets one
// reach far enough to be cut by the box edge and continue into its neighbour.
function bodiesOf(rand: () => number, count: number, big: boolean): Body[] {
  const start = rand() * TAU;
  return Array.from({ length: count }, (_, i) => {
    const angle = start + (i / count) * TAU + (rand() - 0.5) * 0.9;
    const reach = 1.2 + rand() * 4.6;
    const r = big && i === 0 ? 2.4 + rand() * 1 : 1.2 + rand() * 1.1;
    return {
      x: CENTRE + Math.cos(angle) * reach,
      y: CENTRE + Math.sin(angle) * reach,
      r,
      rotation: rand() * TAU,
      outline: outlineOf(rand, r),
    };
  });
}

function drawRadiance(ctx: CanvasRenderingContext2D, rand: () => number, body: Body): void {
  const reach = body.r * GLOW_REACH;
  const fill = ctx.createRadialGradient(body.x, body.y, body.r * 0.4, body.x, body.y, reach);
  fill.addColorStop(0, `rgba(${GLOW}, 0.34)`);
  fill.addColorStop(0.5, `rgba(${GLOW}, 0.14)`);
  fill.addColorStop(1, `rgba(${GLOW}, 0)`);
  ctx.fillStyle = fill;
  const lobes = Array.from(
    { length: GLOW_LOBES },
    (_, i) => body.r * (i % 2 === 0 ? GLOW_LONG : GLOW_SHORT) * (0.85 + rand() * 0.3),
  );
  blob(ctx, body.x, body.y, lobes, body.rotation + 0.4);
  ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D, body: Body): void {
  if (body.r >= BARE_BELOW) {
    const weight = Math.max(WEIGHT_MIN, body.r * WEIGHT_OF_R);
    ctx.fillStyle = INK;
    blob(
      ctx,
      body.x + weight * Math.SQRT1_2,
      body.y + weight * Math.SQRT1_2,
      body.outline,
      body.rotation,
    );
    ctx.fill();
  }
  ctx.fillStyle = ORE;
  blob(ctx, body.x, body.y, body.outline, body.rotation);
  ctx.fill();
}

// One cell's deposit, in its own box. Seeded from **both** grid axes, so the field cannot stripe
// into identical rows the way it did before #87 measured it. Called nine times per tile by
// `drawTiled` — this cell plus its eight neighbours, translated into place — so a body whose glow
// or silhouette overruns the box is completed by the tile next door rather than cut off on the
// grid pitch.
// Two bodies per cell sitting *astride* its east and south edges. Without them the deposit has no
// ink on a seam: the fan that places the rest reaches out from the tile centre and rarely crosses,
// so drawing a neighbour's cell contributes nothing to mine and the lattice survives.
//
// East and south only, because each seam belongs to exactly one of the two cells that share it.
// `drawTiled` draws the neighbouring cells too, so the tile across a seam draws this same body
// translated and keeps the other half — the halves meet because both come from one cell
// coordinate.
function seamBodies(rand: () => number): Body[] {
  return [
    { x: SIZE, y: 2 + rand() * (SIZE - 4) },
    { x: 2 + rand() * (SIZE - 4), y: SIZE },
  ].map(({ x, y }) => {
    const r = 1.6 + rand() * 1.2;
    return { x, y, r, rotation: rand() * TAU, outline: outlineOf(rand, r) };
  });
}

function paintCell(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const rand = seeded(Math.imul(cx * VARIANTS + cy + 1, 0x9e3779b1) ^ 0x51ed2701);

  // `rand` is already seeded from this cell, so the seam bodies are as cell-specific as the rest.
  const bodies = [...bodiesOf(rand, 2 + Math.floor(rand() * 2), true), ...seamBodies(rand)];
  // Unlit fragments: the only pure ink on the tile, and the reason a patch still belongs to a
  // black-and-white game rather than reading as the one coloured thing on the floor.
  const chips = bodiesOf(rand, Math.floor(rand() * 2.4), false);

  for (const body of bodies) drawRadiance(ctx, rand, body);
  for (const body of bodies) drawBody(ctx, body);

  const [lit] = bodies;
  ctx.fillStyle = EMBER;
  blob(
    ctx,
    lit.x - lit.r * 0.18,
    lit.y - lit.r * 0.18,
    outlineOf(rand, lit.r * EMBER_OF_R),
    lit.rotation + 0.7,
  );
  ctx.fill();

  ctx.fillStyle = INK;
  for (const chip of chips) {
    blob(ctx, chip.x, chip.y, chip.outline, chip.rotation);
    ctx.fill();
  }
}

const orePower: SpriteSubject = {
  name: "ore-power",
  size: SIZE,
  // The tiled contract (#87): the tile's cell in the repeating grid, packed with a 4-bit mask of
  // which neighbours hold power ore too. `drawTiled` unpacks both.
  facings: TILED_FACINGS,
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);
    drawTiled(ctx, SIZE, facing, paintCell);
  },
};

export default orePower;
