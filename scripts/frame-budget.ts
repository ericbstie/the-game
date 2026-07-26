import { join, resolve } from "node:path";
import { capture, measurementsIn } from "./headless";

// Measure the worst frame the game can be asked to draw, layer by layer, through the shipped
// `drawWorld` on a real canvas.
//
//   bun run frame:budget
//   bun run frame:budget --sprite grass=src/sprite/grass.ts   # layer in art that has not landed
//
// The budget this produces is written down in `docs/frame-budget.md`. It exists as a command and
// not only as a number because the rest of Milestone 5 adds to this frame — health bars, the shot
// lines of #74, the restyled HUD — and a budget nobody can re-measure is a budget that rots. The
// numbers come from the `--dump-dom` channel #77 §2 established: a real canvas, in a real browser,
// reporting what it actually cost rather than what a spy context can infer.
//
// Everything is measured under `--disable-gpu`, so the rasterisation is done in software and every
// figure is an **upper bound** on what a player's GPU-composited browser pays. That is the honest
// direction to err in.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const CACHE_MODULE = join(import.meta.dir, "../src/sprite/cache.ts");
const REGISTRY_MODULE = join(import.meta.dir, "../src/sprite/registry.ts");
const BUILD_MODULE = join(import.meta.dir, "../src/game/build.ts");
const ENEMIES_MODULE = join(import.meta.dir, "../src/game/enemies.ts");

export interface BudgetRequest {
  sprites: Record<string, string>;
  out: string;
  dpr: number;
}

export function parseArgs(argv: string[]): BudgetRequest {
  const sprites: Record<string, string> = {};
  let out: string | null = null;
  let dpr = 2;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--dpr") {
      dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
    } else if (arg === "--sprite") {
      const pair = argv[++i] ?? "";
      const split = pair.indexOf("=");
      if (split <= 0) throw new Error(`--sprite wants name=path, got ${pair || "nothing"}`);
      sprites[pair.slice(0, split)] = resolve(pair.slice(split + 1));
    } else throw new Error(`unknown argument ${arg}`);
  }
  return { sprites, out: resolve(out ?? "frame-budget.png"), dpr };
}

export interface BudgetResult {
  standing: number;
  blits: number;
  layers: Record<string, number>;
  ySortMs: number;
  healthBarsMs: Record<string, number>;
  shotLinesMs: Record<string, number>;
}

export function entrySource(request: BudgetRequest): string {
  const imports = Object.keys(request.sprites)
    .map((name, i) => `import s${i} from ${JSON.stringify(request.sprites[name])};`)
    .join("\n");
  const table = Object.keys(request.sprites)
    .map((name, i) => `${JSON.stringify(name)}: s${i}`)
    .join(", ");
  return `${imports}
import { drawWorld } from ${JSON.stringify(DRAW_MODULE)};
import { createSpriteCache } from ${JSON.stringify(CACHE_MODULE)};
import { SPRITES } from ${JSON.stringify(REGISTRY_MODULE)};
import { tileKey, TILE } from ${JSON.stringify(BUILD_MODULE)};
import { ENEMY_CAP } from ${JSON.stringify(ENEMIES_MODULE)};

const VIEW = { width: 800, height: 600 };
const DPR = ${request.dpr};
const CAM = { x: 15_400, y: 15_400 };
const STRUCTURES = 40;
const ITERS = 60;

// Deterministic, so two runs of this script compare to each other.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 0x1_0000_0000; };
}

// The worst frame the game can be asked for: every enemy the governor allows, all of them inside
// the viewport so nothing is culled and all of them go through the Y-sort.
function build(enemyCount, structureCount, withOre) {
  const r = rng(12_345);
  const enemies = [];
  for (let i = 0; i < enemyCount; i++) {
    const elite = i % 5 === 0;
    enemies.push({
      id: "e" + i, kind: elite ? "elite" : "grunt",
      pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      facing: Math.floor(r() * 8), frame: Math.floor(r() * 2),
      radius: elite ? 24 : 16, hp: elite ? 120 : 30,
    });
  }
  const kinds = ["miner", "wall", "turret", "generator"];
  const structures = [];
  for (let i = 0; i < structureCount; i++) {
    const kind = kinds[i % 4];
    structures.push({
      id: "b" + i, kind, hp: 200,
      tile: { tx: Math.floor((CAM.x + r() * VIEW.width) / TILE), ty: Math.floor((CAM.y + r() * VIEW.height) / TILE) },
      ...(kind === "turret" ? { turret: { targetId: "e1", powered: false } } : {}),
    });
  }
  const players = [];
  for (let i = 0; i < 6; i++) {
    players.push({
      id: "p" + i, slot: i + 1, name: "Player" + i,
      pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      facing: Math.floor(r() * 8), frame: Math.floor(r() * 2), radius: 14, hp: 100,
    });
  }
  const nests = [];
  for (let i = 0; i < 4; i++) {
    nests.push({
      id: "n" + i, pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      radius: 48, hp: 600, alive: i % 2 === 0, sector: i,
    });
  }
  const ore = new Map();
  if (withOre) {
    const ftx = Math.floor(CAM.x / TILE), fty = Math.floor(CAM.y / TILE);
    for (let ty = fty + 4; ty < fty + 16; ty++) for (let tx = ftx + 4; tx < ftx + 20; tx++) ore.set(tileKey({ tx, ty }), "metal");
    for (let ty = fty + 24; ty < fty + 34; ty++) for (let tx = ftx + 30; tx < ftx + 44; tx++) ore.set(tileKey({ tx, ty }), "power");
  }
  return { arena: { width: 31_200, height: 31_200 }, players, enemies, nests, ore, structures,
           exit: { x: 0, y: 15_000, width: 98, height: 936 } };
}

const canvas = document.getElementById("sheet");
canvas.width = Math.round(VIEW.width * DPR);
canvas.height = Math.round(VIEW.height * DPR);
canvas.style.width = canvas.width + "px";
canvas.style.height = canvas.height + "px";
const ctx = canvas.getContext("2d");

// Canvas 2D defers rasterisation, so timing the draw calls alone measures queueing rather than
// painting. One 1x1 readback per iteration forces the frame to be rasterised before the clock stops.
const flush = () => ctx.getImageData(0, 0, 1, 1);
function measure(fn, iters = ITERS) {
  for (let i = 0; i < 10; i++) fn();
  flush();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) { fn(); flush(); }
  return (performance.now() - t0) / iters;
}

try {
  const sprites = createSpriteCache({ ...SPRITES, ${table} }).source(DPR);
  const setup = () => ctx.setTransform(DPR, 0, 0, DPR, -CAM.x * DPR, -CAM.y * DPR);
  const opts = { selfId: "p0", camera: CAM, viewport: VIEW, dpr: DPR, now: 1000, sprites };

  const empty = build(0, 0, false);
  const floor = build(0, 0, true);
  const full = build(ENEMY_CAP, STRUCTURES, true);

  // Whichever layer is measured first otherwise absorbs the canvas's one-time setup and reads two
  // to three times its true cost. Spend it here, on a result nobody reads.
  measure(() => { setup(); drawWorld(ctx, full, opts); }, 10);

  // Each layer is the whole frame up to that point, so the deltas below are what each one adds.
  const paperMs = measure(() => { setup(); drawWorld(ctx, empty, opts); });
  const floorMs = measure(() => { setup(); drawWorld(ctx, floor, opts); });
  const fullMs = measure(() => { setup(); drawWorld(ctx, full, opts); });

  let blits = 0;
  const raw = ctx.drawImage.bind(ctx);
  ctx.drawImage = (...args) => { blits++; raw(...args); };
  setup();
  drawWorld(ctx, full, opts);
  ctx.drawImage = raw;

  // The Y-sort alone, to sit beside the 36.6 us at 250 entities #71 measured.
  const rows = [];
  for (let i = 0; i < full.enemies.length + STRUCTURES + 10; i++) rows.push({ y: Math.random() * 600 });
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) rows.slice().sort((a, b) => a.y - b.y);
  const ySortMs = (performance.now() - t0) / 2000;

  // Two allowances for work Milestone 5 has not built yet, so the budget can reserve for them.
  // Health bars: two axis-aligned fills each, on everything damaged.
  const healthBars = (n) => measure(() => {
    setup();
    for (let i = 0; i < n; i++) {
      const e = full.enemies[i % full.enemies.length];
      ctx.fillStyle = "#fff"; ctx.fillRect(e.pos.x - 12, e.pos.y - e.radius - 6, 24, 4);
      ctx.fillStyle = "#000"; ctx.fillRect(e.pos.x - 12, e.pos.y - e.radius - 6, 14, 4);
    }
  });
  // Shot lines (#74). A stroked line costs by the pixels it covers, so a line across the viewport
  // is dear; measured at several counts so a lifetime can be priced rather than guessed.
  const shotLines = (n) => measure(() => {
    setup();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const e = full.enemies[i % full.enemies.length];
      const p = full.players[i % full.players.length];
      ctx.beginPath(); ctx.moveTo(p.pos.x, p.pos.y); ctx.lineTo(e.pos.x, e.pos.y); ctx.stroke();
    }
  });

  const result = {
    standing: full.enemies.length + STRUCTURES + full.players.length + full.nests.length,
    blits,
    layers: {
      paper: +paperMs.toFixed(3),
      floor: +floorMs.toFixed(3),
      full: +fullMs.toFixed(3),
    },
    ySortMs: +ySortMs.toFixed(4),
    healthBarsMs: { 60: +healthBars(60).toFixed(3), 240: +healthBars(240).toFixed(3) },
    shotLinesMs: { 10: +shotLines(10).toFixed(3), 25: +shotLines(25).toFixed(3), 50: +shotLines(50).toFixed(3), 150: +shotLines(150).toFixed(3) },
  };

  // Drawn last so the screenshot is the frame that was measured, not the final probe.
  setup();
  drawWorld(ctx, full, opts);
  document.getElementById("measurements").textContent = JSON.stringify(result);
} catch (e) {
  document.getElementById("measurements").textContent = JSON.stringify({ error: String(e && e.stack || e) });
}
`;
}

export async function runBudget(request: BudgetRequest): Promise<BudgetResult> {
  const dom = await capture({
    entry: entrySource(request),
    out: request.out,
    width: Math.round(800 * request.dpr),
    height: Math.round(600 * request.dpr),
    label: "the frame budget",
  });
  const measured = measurementsIn(dom) as (BudgetResult & { error?: string }) | null;
  if (!measured) throw new Error("no measurements came back — the frame may not have drawn at all");
  if (measured.error) throw new Error(measured.error);
  return measured;
}

// 60 fps. Every figure this script prints is measured against it.
const FRAME_MS = 1000 / 60;

if (import.meta.main) {
  const request = parseArgs(Bun.argv.slice(2));
  const r = await runBudget(request);
  const share = (ms: number) => `${((ms / FRAME_MS) * 100).toFixed(1)}%`;
  console.log(request.out);
  console.log(`worst case  ${r.standing} standing entities, ${r.blits} blits, dpr ${request.dpr}`);
  console.log(
    `sprites     ${Object.keys(request.sprites).join(", ") || "the registry as it stands"}`,
  );
  console.log("");
  console.log(`  paper only          ${r.layers.paper.toFixed(3)} ms`);
  console.log(`  + grass and ore     ${r.layers.floor.toFixed(3)} ms`);
  console.log(
    `  + everything up     ${r.layers.full.toFixed(3)} ms   ${share(r.layers.full)} of a 16.67 ms frame`,
  );
  console.log("");
  console.log(`  y-sort alone        ${(r.ySortMs * 1000).toFixed(1)} us`);
  console.log(`  health bars (240)   ${r.healthBarsMs[240].toFixed(3)} ms`);
  console.log(`  shot lines (25)     ${r.shotLinesMs[25].toFixed(3)} ms`);
  console.log(`  shot lines (150)    ${r.shotLinesMs[150].toFixed(3)} ms`);
  console.log("");
  const projected = r.layers.full + r.healthBarsMs[240] + r.shotLinesMs[50];
  console.log(`projected M5 worst case (frame + 240 bars + 50 shot lines)`);
  console.log(
    `  ${projected.toFixed(2)} ms   ${share(projected)}   headroom ${(FRAME_MS - projected).toFixed(2)} ms`,
  );
}
