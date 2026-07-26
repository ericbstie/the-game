import { join } from "node:path";
import { capture, measurementsIn } from "./headless";

// Measure whether an ore patch is seamless inside and ragged at its edge — the two requirements
// #87 says pull in opposite directions.
//
//   bun run ore:seams
//   bun run ore:seams --dpr 2
//
// Both are measured on **real accretion patches from `generateOre`**, drawn through the shipped
// `drawOre` on a real canvas, because the thing being measured is ink on pixels and nothing else
// can see it. The `--dump-dom` channel #77 §2 established carries the numbers back out.
//
// Three readings come back:
//
// - **seam** — ink density folded modulo the tile pitch, over interior tiles only (all four
//   neighbours are the same ore). If marks are boxed inside their cells, the columns and rows that
//   land on a tile boundary carry far less ink than the ones through a tile centre, and a regular
//   white lattice appears on the grid pitch. Even coverage means the fold is flat.
// - **edge** — how much ink reaches the outermost pixel of a *boundary* edge, the one with no ore
//   beyond it. Ink there is what squares off a patch; holding it back is what leaves it ragged.
// - **variety** — how often two horizontally or vertically adjacent tiles draw the identical
//   variant. A field that repeats on one axis reads as stripes however good its seams are.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const BUILD_MODULE = join(import.meta.dir, "../src/game/build.ts");
const REGISTRY_MODULE = join(import.meta.dir, "../src/sprite/registry.ts");
const CACHE_MODULE = join(import.meta.dir, "../src/sprite/cache.ts");
const WORLD_MODULE = join(import.meta.dir, "../src/game/world.ts");

export interface SeamsRequest {
  dpr: number;
  kind: "metal" | "power";
  out: string;
}

export function parseArgs(argv: string[]): SeamsRequest {
  let dpr = 1;
  let kind: "metal" | "power" = "metal";
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dpr") {
      dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
    } else if (arg === "--kind") {
      const asked = argv[++i];
      if (asked !== "metal" && asked !== "power") throw new Error("--kind wants metal or power");
      kind = asked;
    } else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg !== "--json") throw new Error(`unknown argument ${arg}`);
  }
  return { dpr, kind, out: out ?? join(process.cwd(), `ore-seams-${kind}.png`) };
}

export interface Reading {
  dpr: number;
  kind: string;
  tiles: number; // interior tiles the seam fold was taken over
  seam: { centre: number; edge: number; ratio: number };
  edge: { boundary: number; interior: number };
  variety: { adjacentIdentical: number; pairs: number };
}

export function entrySource(request: SeamsRequest): string {
  return `
import { drawWorld } from ${JSON.stringify(DRAW_MODULE)};
import { generateOre, oreAt, TILE } from ${JSON.stringify(BUILD_MODULE)};
import { ARENA } from ${JSON.stringify(WORLD_MODULE)};
import { SPRITES } from ${JSON.stringify(REGISTRY_MODULE)};
import { createSpriteCache } from ${JSON.stringify(CACHE_MODULE)};

const DPR = ${request.dpr};
const KIND = ${JSON.stringify(request.kind)};

// A viewport parked over the densest metal patch the seed grows, so the fold is taken over real
// accretion output rather than a hand-drawn rectangle.
const ore = generateOre(ARENA, 1);
const counts = new Map();
for (const [key, kind] of ore) {
  if (kind !== KIND) continue;
  const tx = Math.floor(key / 65536), ty = key % 65536;
  const bucket = Math.floor(tx / 16) + ":" + Math.floor(ty / 16);
  counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
}
let best = null, bestN = -1;
for (const [bucket, n] of counts) if (n > bestN) { bestN = n; best = bucket; }
const [bx, by] = best.split(":").map(Number);

const VIEW = 240; // 16 tiles a side
const camera = { x: bx * 16 * TILE, y: by * 16 * TILE };
const viewport = { width: VIEW, height: VIEW };

const canvas = document.getElementById("sheet");
canvas.width = VIEW * DPR;
canvas.height = VIEW * DPR;
canvas.style.width = canvas.width + "px";
canvas.style.height = canvas.height + "px";
const ctx = canvas.getContext("2d");
// The transform GameScreen paints the world through, unchanged — drawWorld works in world
// coordinates, so without this the whole scene lands off-canvas.
ctx.setTransform(DPR, 0, 0, DPR, -camera.x * DPR, -camera.y * DPR);

const cache = createSpriteCache(SPRITES);
drawWorld(ctx, {
  arena: ARENA, players: [], enemies: [], nests: [], structures: [],
  exit: { x: -1000, y: -1000, width: 1, height: 1 }, ore,
}, { camera, viewport, sprites: cache.source(DPR), dpr: DPR });

const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
// Ink coverage of one device pixel: the floor is white paper, so darkness is ink.
const ink = (x, y) => {
  const i = (y * canvas.width + x) * 4;
  return (255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255;
};

const tileAt = (tx, ty) => oreAt(ore, { tx, ty }) === KIND;
const firstTx = Math.floor(camera.x / TILE), firstTy = Math.floor(camera.y / TILE);
const span = Math.floor(VIEW / TILE);
const pitch = TILE * DPR;

// --- seam: ink folded modulo the tile pitch, interior tiles only ------------------------------
const colInk = new Array(pitch).fill(0);
const rowInk = new Array(pitch).fill(0);
let interior = 0;
for (let j = 0; j < span; j++) {
  for (let i = 0; i < span; i++) {
    const tx = firstTx + i, ty = firstTy + j;
    if (!tileAt(tx, ty)) continue;
    if (!tileAt(tx - 1, ty) || !tileAt(tx + 1, ty) || !tileAt(tx, ty - 1) || !tileAt(tx, ty + 1)) continue;
    interior++;
    for (let dy = 0; dy < pitch; dy++) {
      for (let dx = 0; dx < pitch; dx++) {
        const v = ink(i * pitch + dx, j * pitch + dy);
        colInk[dx] += v;
        rowInk[dy] += v;
      }
    }
  }
}
// The pitch-aligned lanes are the seam; everything else is tile interior.
const SEAM_LANES = Math.max(1, Math.round(DPR));
const seamOf = (arr) => {
  let edge = 0, centre = 0, edgeN = 0, centreN = 0;
  for (let k = 0; k < arr.length; k++) {
    const onSeam = k < SEAM_LANES || k >= arr.length - SEAM_LANES;
    if (onSeam) { edge += arr[k]; edgeN++; } else { centre += arr[k]; centreN++; }
  }
  return { edge: edgeN ? edge / edgeN : 0, centre: centreN ? centre / centreN : 0 };
};
const c = seamOf(colInk), r = seamOf(rowInk);
const centre = (c.centre + r.centre) / 2;
const edgeLane = (c.edge + r.edge) / 2;

// --- edge: ink on the outermost lane of a boundary edge vs an interior one --------------------
let boundary = 0, boundaryN = 0, interiorEdge = 0, interiorEdgeN = 0;
for (let j = 0; j < span; j++) {
  for (let i = 0; i < span; i++) {
    const tx = firstTx + i, ty = firstTy + j;
    if (!tileAt(tx, ty)) continue;
    const sides = [
      { open: !tileAt(tx, ty - 1), read: (k) => ink(i * pitch + k, j * pitch) },
      { open: !tileAt(tx, ty + 1), read: (k) => ink(i * pitch + k, j * pitch + pitch - 1) },
      { open: !tileAt(tx - 1, ty), read: (k) => ink(i * pitch, j * pitch + k) },
      { open: !tileAt(tx + 1, ty), read: (k) => ink(i * pitch + pitch - 1, j * pitch + k) },
    ];
    for (const side of sides) {
      let sum = 0;
      for (let k = 0; k < pitch; k++) sum += side.read(k);
      if (side.open) { boundary += sum / pitch; boundaryN++; }
      else { interiorEdge += sum / pitch; interiorEdgeN++; }
    }
  }
}

// --- variety: how often neighbouring tiles draw the same thing --------------------------------
const stamp = (i, j) => {
  let s = "";
  for (let dy = 0; dy < pitch; dy += 2) for (let dx = 0; dx < pitch; dx += 2)
    s += ink(i * pitch + dx, j * pitch + dy) > 0.5 ? "1" : "0";
  return s;
};
let identical = 0, pairs = 0;
for (let j = 0; j < span; j++) {
  for (let i = 0; i < span; i++) {
    const tx = firstTx + i, ty = firstTy + j;
    if (!tileAt(tx, ty)) continue;
    if (tileAt(tx + 1, ty) && i + 1 < span) { pairs++; if (stamp(i, j) === stamp(i + 1, j)) identical++; }
    if (tileAt(tx, ty + 1) && j + 1 < span) { pairs++; if (stamp(i, j) === stamp(i, j + 1)) identical++; }
  }
}

document.getElementById("measurements").textContent = JSON.stringify({
  dpr: DPR,
  kind: KIND,
  tiles: interior,
  seam: { centre, edge: edgeLane, ratio: edgeLane > 0 ? centre / edgeLane : Infinity },
  edge: {
    boundary: boundaryN ? boundary / boundaryN : 0,
    interior: interiorEdgeN ? interiorEdge / interiorEdgeN : 0,
  },
  variety: { adjacentIdentical: identical, pairs },
});
`;
}

export async function measure(request: SeamsRequest): Promise<Reading> {
  const dom = await capture({
    entry: entrySource(request),
    out: request.out,
    width: 240 * request.dpr,
    height: 240 * request.dpr,
    label: `ore-${request.kind} seams at dpr ${request.dpr}`,
  });
  const found = measurementsIn(dom);
  if (!found) throw new Error("the page reported no measurements");
  return found as Reading;
}

export function format(reading: Reading): string {
  const { seam, edge, variety } = reading;
  return [
    `ore-${reading.kind} seams at dpr ${reading.dpr}, over ${reading.tiles} interior tiles`,
    ``,
    `  seam fold (ink per device px, folded mod the tile pitch)`,
    `    through a tile centre   ${seam.centre.toFixed(3)}`,
    `    on the tile boundary    ${seam.edge.toFixed(3)}`,
    `    deficit                 ${seam.ratio.toFixed(2)}x   (1.00 is no lattice at all)`,
    ``,
    `  outermost lane of an edge (ink per device px)`,
    `    boundary edge           ${edge.boundary.toFixed(3)}   (low is ragged)`,
    `    interior edge           ${edge.interior.toFixed(3)}   (high is seamless)`,
    ``,
    `  adjacent tiles drawing the identical stamp`,
    `    ${variety.adjacentIdentical} of ${variety.pairs} pairs` +
      ` (${variety.pairs ? ((variety.adjacentIdentical / variety.pairs) * 100).toFixed(1) : "0"}%)`,
  ].join("\n");
}

if (import.meta.main) {
  const request = parseArgs(process.argv.slice(2));
  const reading = await measure(request);
  console.log(process.argv.includes("--json") ? JSON.stringify(reading, null, 2) : format(reading));
}
