import { join, resolve } from "node:path";
import { MINIMAP_COVERAGE_U } from "../src/game/minimap";
import { concurrentBursts } from "./burst-ink";
import { capture, measurementsIn } from "./headless";
import { concurrentLettering } from "./lettering-ink";
import { concurrentPuffs } from "./puff-ink";

// Measure the worst frame the game can be asked to draw, layer by layer, through the shipped
// `drawWorld` on a real canvas.
//
//   bun run frame:budget
//   bun run frame:budget --sprite grass=src/sprite/grass.ts   # layer in art that has not landed
//   bun run frame:budget --map 15600                          # the corner map at its widest level
//   bun run frame:budget --enemies 500                        # a cap the governor has not reached
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
const SETTINGS_MODULE = join(import.meta.dir, "../src/game/worldSettings.ts");
const FLOATS_MODULE = join(import.meta.dir, "../src/game/floats.ts");
const FX_MODULE = join(import.meta.dir, "../src/game/fx.ts");
const DAMAGE_MODULE = join(import.meta.dir, "../src/game/damageFx.ts");

export interface BudgetRequest {
  sprites: Record<string, string>;
  out: string;
  dpr: number;
  // What the corner map is a window onto, in world units — the zoom level the player would have
  // cycled to (#110). It defaults to the level the map opens at, so a plain run measures the frame
  // the published budget measures.
  map: number;
  // How many enemies the worst frame holds, or null for whatever the world config's cap is today. A cap the
  // governor has not been raised to yet — #111's 500 — can only be priced by asking for it, and the
  // alternative is a number nobody measured (rule 5).
  enemies: number | null;
}

export function parseArgs(argv: string[]): BudgetRequest {
  const sprites: Record<string, string> = {};
  let out: string | null = null;
  let dpr = 2;
  let map = MINIMAP_COVERAGE_U;
  let enemies: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--dpr") {
      dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
    } else if (arg === "--map") {
      map = Number(argv[++i]);
      if (!Number.isFinite(map) || map <= 0) throw new Error("--map must be a positive number");
    } else if (arg === "--enemies") {
      enemies = Number(argv[++i]);
      if (!Number.isInteger(enemies) || enemies <= 0) {
        throw new Error("--enemies must be a positive whole number");
      }
    } else if (arg === "--sprite") {
      const pair = argv[++i] ?? "";
      const split = pair.indexOf("=");
      if (split <= 0) throw new Error(`--sprite wants name=path, got ${pair || "nothing"}`);
      sprites[pair.slice(0, split)] = resolve(pair.slice(split + 1));
    } else throw new Error(`unknown argument ${arg}`);
  }
  return { sprites, out: resolve(out ?? "frame-budget.png"), dpr, map, enemies };
}

export interface BudgetResult {
  standing: number;
  blits: number;
  bars: number;
  lines: number;
  floats: number;
  bursts: number;
  puffs: number;
  lettering: number;
  layers: Record<string, number>;
  ySortMs: number;
  healthBarsMs: Record<string, number>;
  shotLinesMs: Record<string, number>;
  burstsMs: Record<string, number>;
  puffsMs: Record<string, number>;
  letteringMs: Record<string, number>;
  veilMs: number;
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
import { generateOre, tileKey, TILE } from ${JSON.stringify(BUILD_MODULE)};
import { DEFAULT_WORLD_SETTINGS } from ${JSON.stringify(SETTINGS_MODULE)};
import { FLOAT_MS, minerFloatOrigin } from ${JSON.stringify(FLOATS_MODULE)};
import { inkPuff, speedLines, starburst } from ${JSON.stringify(FX_MODULE)};
import { letteringAt } from ${JSON.stringify(DRAW_MODULE)};
import { FLASH_ALPHA } from ${JSON.stringify(DAMAGE_MODULE)};

const VIEW = { width: 800, height: 600 };
const DPR = ${request.dpr};
const ARENA = { width: 31_200, height: 31_200 };
const CAM = { x: 15_400, y: 15_400 };
const STRUCTURES = 40;
const ITERS = 60;
// The budget's own rule: 50 concurrent lines, which is what a 100 ms lifetime holds a defended
// base's fire down to. Five come from powered turrets and the rest from relayed squadmate shots.
const SHOT_LINES = 50;
// #115's starbursts, and unlike the line above this one is *derived* rather than budgeted: it comes
// off the cadences that fire and the damage they do (\`scripts/burst-ink.ts\`), because a burst rides
// the hit rate and the hit rate is arithmetic on constants the game already fixes.
const BURSTS = ${concurrentBursts()};
// #116's puffs, derived the same way and off the other side of the same split: \`reapDamage\` reports
// a killing connect as a death, so the shots into one grunt burst many times and puff once.
const PUFFS = ${concurrentPuffs()};
// #79's lettered words, which ride the two mark lists above rather than a list of their own — so the
// count is one word per mark of either kind, and it is derived from the same arithmetic they are.
const LETTERING = ${concurrentLettering()};

// Deterministic, so two runs of this script compare to each other.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 0x1_0000_0000; };
}

// The worst frame the game can be asked for: every enemy the governor allows, all of them inside
// the viewport so nothing is culled and all of them go through the Y-sort.
//
// Everything is damaged, deliberately. A health bar is drawn only for something below full health
// (#81), so an undamaged fixture would measure a frame the game never has to draw at its worst —
// and the bars are the one M5 addition whose count scales with the enemy cap.
function build(enemyCount, structureCount, withOre) {
  const r = rng(12_345);
  const enemies = [];
  for (let i = 0; i < enemyCount; i++) {
    const elite = i % 5 === 0;
    enemies.push({
      id: "e" + i, kind: elite ? "elite" : "grunt",
      pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      facing: Math.floor(r() * 8), frame: Math.floor(r() * 2),
      radius: elite ? 24 : 16, hp: elite ? 119 : 17,
    });
  }
  const kinds = ["miner", "wall", "turret", "generator"];
  const structures = [];
  for (let i = 0; i < structureCount; i++) {
    const kind = kinds[i % 4];
    structures.push({
      id: "b" + i, kind, hp: 137,
      tile: { tx: Math.floor((CAM.x + r() * VIEW.width) / TILE), ty: Math.floor((CAM.y + r() * VIEW.height) / TILE) },
      // Half the turrets hold a target they can fire on and draw a line; the other half hold one
      // they cannot, which is the only thing that draws the lightning. Both cost, so both are here.
      ...(kind === "turret" ? { turret: { targetId: "e" + i, powered: i % 8 === 2 } } : {}),
    });
  }
  const players = [];
  for (let i = 0; i < 6; i++) {
    players.push({
      id: "p" + i, slot: i + 1, name: "Player" + i,
      pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      facing: Math.floor(r() * 8), frame: Math.floor(r() * 2), radius: 14, hp: 61,
    });
  }
  const nests = [];
  for (let i = 0; i < 4; i++) {
    nests.push({
      id: "n" + i, pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      radius: 48, maxHp: 600, hp: 600, alive: i % 2 === 0,
    });
  }
  // The arena's own generated field, and then dense patches laid over it under the camera.
  //
  // Both, because the two layers that read the ore are bounded to different things. The floor pass
  // is bounded to visible tiles, so it needs a full patch under the camera to be measured at its
  // worst; the corner map's ore layer is bounded to the map's *window*, which at the widest zoom
  // reaches 15,600 u — an ore field that stopped at the viewport would draw the same few marks at
  // every level and no level could measure dearer than another (#110).
  const ore = withOre ? generateOre(ARENA, 12_345) : new Map();
  if (withOre) {
    const ftx = Math.floor(CAM.x / TILE), fty = Math.floor(CAM.y / TILE);
    for (let ty = fty + 4; ty < fty + 16; ty++) for (let tx = ftx + 4; tx < ftx + 20; tx++) ore.set(tileKey({ tx, ty }), "metal");
    for (let ty = fty + 24; ty < fty + 34; ty++) for (let tx = ftx + 30; tx < ftx + 44; tx++) ore.set(tileKey({ tx, ty }), "power");
  }
  return { arena: ARENA, players, enemies, nests, ore, structures,
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
  // Two sources over the same subjects, because #79's words are the one layer that cannot be added
  // by handing drawWorld another list: a word rides #115's and #116's marks, so the only way to
  // measure the frame without it is to take the art away. Every row up to "+ the puffs" therefore
  // draws through a set with no lettering entry — where drawWorld falls back to nothing at all — and
  // the last row draws through the whole registry.
  const subjects = { ...SPRITES, ${table} };
  const lettered = createSpriteCache(subjects).source(DPR);
  const unlettered = { ...subjects };
  delete unlettered.lettering;
  const sprites = createSpriteCache(unlettered).source(DPR);
  const setup = () => ctx.setTransform(DPR, 0, 0, DPR, -CAM.x * DPR, -CAM.y * DPR);
  const opts = { selfId: "p0", camera: CAM, viewport: VIEW, dpr: DPR, now: 1000, sprites, minimapCoverage: ${request.map} };

  const empty = build(0, 0, false);
  const floor = build(0, 0, true);
  const full = build(${request.enemies ?? "DEFAULT_WORLD_SETTINGS.enemyCap"}, STRUCTURES, true);

  // The shot lines, through the shipped path rather than a hand-rolled stroke: the powered turrets
  // generate their own pulse, and squadmates' relayed shots make the count up to the budgeted 50.
  const byId = new Map(full.enemies.map((e) => [e.id, e.pos]));
  const turretLines = full.structures.filter((s) => s.turret && s.turret.powered).length;
  const peers = [];
  for (let i = 0; i < SHOT_LINES - turretLines; i++) {
    peers.push({ shot: { id: "p" + (i % 6), dir: { x: 1, y: 0 }, hit: "e" + i }, at: opts.now });
  }
  // A pool that cannot be the thing that caps the turret trains (#102): the budget is the worst
  // frame, so every powered turret has to draw, and SHOT_LINES is by construction at least as many
  // as there are.
  const shots = { peers, own: null, resolve: (id) => byId.get(id) ?? null, ammo: SHOT_LINES };
  const m5 = { ...opts, shots };

  // #99's floats. STRUCTURES cycles the four kinds, so a quarter of them are miners — ten at 40,
  // which is the count the ticket asks this to be measured at. Each is at a different point of its
  // life, because opacity is what a float costs differently at.
  const miners = full.structures.filter((s) => s.kind === "miner");
  const floats = miners.map((s, i) => ({
    id: s.id,
    pos: minerFloatOrigin(s.tile),
    at: opts.now - Math.round((i / miners.length) * FLOAT_MS),
  }));
  const withFloats = { ...m5, floats };

  // #115's bursts, one on each of the enemies the squad's fire is currently landing on. Struck on
  // spiders rather than scattered, because that is the only place the game puts one and a burst over
  // bare paper would be measured against a cheaper background than the real one.
  const burstMarks = (n) => {
    const marks = [];
    for (let i = 0; i < n; i++) marks.push({ pos: full.enemies[i % full.enemies.length].pos, at: opts.now });
    return marks;
  };
  const withBursts = { ...withFloats, bursts: burstMarks(BURSTS) };

  // #116's puffs, on the enemies the squad's fire is currently finishing off. Struck on spiders
  // rather than scattered for the same reason the bursts are — the ink under a mark is part of what
  // it costs — even though the spider a puff belongs to is, in the game, already gone by then.
  const puffMarks = (n) => {
    const marks = [];
    for (let i = 0; i < n; i++) marks.push({ pos: full.enemies[(i * 7) % full.enemies.length].pos, at: opts.now });
    return marks;
  };
  const withPuffs = { ...withBursts, puffs: puffMarks(PUFFS) };

  // #79's words, on exactly the marks the two layers above already carry. Nothing is added to the
  // frame but the art itself, which is what makes this row the cost of the lettering and nothing else.
  const withLettering = { ...withPuffs, sprites: lettered };

  // Whichever layer is measured first otherwise absorbs the canvas's one-time setup and reads two
  // to three times its true cost. Spend it here, on a result nobody reads.
  measure(() => { setup(); drawWorld(ctx, full, m5); }, 10);

  // Each layer is the whole frame up to that point, so the deltas below are what each one adds.
  const paperMs = measure(() => { setup(); drawWorld(ctx, empty, opts); });
  const floorMs = measure(() => { setup(); drawWorld(ctx, floor, opts); });
  const fullMs = measure(() => { setup(); drawWorld(ctx, full, opts); });
  const m5Ms = measure(() => { setup(); drawWorld(ctx, full, m5); });
  const floatsMs = measure(() => { setup(); drawWorld(ctx, full, withFloats); });
  const burstsMs = measure(() => { setup(); drawWorld(ctx, full, withBursts); });
  const puffsMs = measure(() => { setup(); drawWorld(ctx, full, withPuffs); });
  const letteringMs = measure(() => { setup(); drawWorld(ctx, full, withLettering); });

  let blits = 0;
  let bars = 0;
  let lines = 0;
  const raw = ctx.drawImage.bind(ctx);
  const rawStroke = ctx.stroke.bind(ctx);
  const rawFill = ctx.fillRect.bind(ctx);
  ctx.drawImage = (...args) => { blits++; raw(...args); };
  ctx.stroke = (...args) => { lines++; rawStroke(...args); };
  ctx.fillRect = (...args) => { if (args[3] === 4) bars++; rawFill(...args); };
  setup();
  drawWorld(ctx, full, withLettering);
  ctx.drawImage = raw;
  ctx.stroke = rawStroke;
  ctx.fillRect = rawFill;

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
  // Shot lines (#74), struck the way the game strikes them — the strands and the dash out of fx.ts,
  // not a plain stroke of this script's own. A shot costs by the pixels it covers, so one across the
  // viewport is dear; measured at several counts so a lifetime can be priced rather than guessed.
  const shotLines = (n) => measure(() => {
    setup();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const e = full.enemies[i % full.enemies.length];
      const p = full.players[i % full.players.length];
      ctx.beginPath();
      for (const s of speedLines(p.pos, e.pos)) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
      ctx.stroke();
    }
  });
  // The bursts (#115), struck the way drawBursts strikes them: the whole frame's worth in one path,
  // from the shipped starburst. Priced at counts the cadences cannot reach today as well as at the
  // one they do, because the count rides the hit rate and #111 is about to move it.
  const bursts = (n) => {
    const marks = burstMarks(n);
    return measure(() => {
      setup();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const m of marks) for (const s of starburst(m.pos)) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
      ctx.stroke();
    });
  };

  // The puffs (#116), struck the way drawPuffs strikes them: one path for the frame, one subpath a
  // cloud, and the lobes chained so the scallops join. Priced at a wave clear's counts as well as at
  // the one the cadences average to, because a clear is exactly when many of them land at once.
  const puffs = (n) => {
    const marks = puffMarks(n);
    return measure(() => {
      setup();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const m of marks) {
        const lobes = inkPuff(m.pos);
        ctx.moveTo(lobes[0].at.x + Math.cos(lobes[0].from) * lobes[0].radius, lobes[0].at.y + Math.sin(lobes[0].from) * lobes[0].radius);
        for (const l of lobes) ctx.arc(l.at.x, l.at.y, l.radius, l.from, l.to);
        ctx.closePath();
      }
      ctx.stroke();
    });
  };

  // The words (#79), blitted the way drawLettering blits them: one baked sprite a mark, centred on
  // it, out of the shipped cache. **The one mark in the frame that is a blit rather than a stroke**,
  // so it is the one whose cost the frame budget's rule 1 says nothing about — a blit is charged for
  // its pixels and a stroke for its pieces. Priced at a wave clear's counts as well as at the one the
  // cadences average to, because both events letter and a clear lands many of them at once.
  const words = (n) => {
    const marks = [...burstMarks(n), ...puffMarks(n)].slice(0, n);
    return measure(() => {
      setup();
      for (const m of marks) {
        const s = lettered("lettering", letteringAt(m.pos, m.at), 0);
        ctx.drawImage(s.image, m.pos.x - s.size / 2, m.pos.y - s.size / 2, s.size, s.size);
      }
    });
  };

  // The veil (#142), laid the way drawWorld lays it: one rgba fill over the whole viewport, at the
  // alpha the blow itself puts up. Standalone for the reason every mark under a millisecond on this
  // page is — the whole-frame ladder cannot resolve one — and it is also the figure rule 2 has been
  // missing since #72, which prices full-screen *mechanisms* and never a single pass on its own.
  const veilMs = measure(() => {
    setup();
    ctx.fillStyle = "rgba(0, 0, 0, " + FLASH_ALPHA + ")";
    ctx.fillRect(CAM.x, CAM.y, VIEW.width, VIEW.height);
  });

  const result = {
    standing: full.enemies.length + STRUCTURES + full.players.length + full.nests.length,
    blits,
    bars,
    lines,
    floats: floats.length,
    bursts: BURSTS,
    puffs: PUFFS,
    lettering: LETTERING,
    layers: {
      paper: +paperMs.toFixed(3),
      floor: +floorMs.toFixed(3),
      full: +fullMs.toFixed(3),
      m5: +m5Ms.toFixed(3),
      floats: +floatsMs.toFixed(3),
      bursts: +burstsMs.toFixed(3),
      puffs: +puffsMs.toFixed(3),
      lettering: +letteringMs.toFixed(3),
    },
    ySortMs: +ySortMs.toFixed(4),
    healthBarsMs: { 60: +healthBars(60).toFixed(3), 240: +healthBars(240).toFixed(3) },
    shotLinesMs: { 10: +shotLines(10).toFixed(3), 25: +shotLines(25).toFixed(3), 50: +shotLines(50).toFixed(3), 150: +shotLines(150).toFixed(3) },
    burstsMs: { [BURSTS]: +bursts(BURSTS).toFixed(3), 25: +bursts(25).toFixed(3), 50: +bursts(50).toFixed(3), 150: +bursts(150).toFixed(3) },
    puffsMs: { [PUFFS]: +puffs(PUFFS).toFixed(3), 25: +puffs(25).toFixed(3), 50: +puffs(50).toFixed(3), 150: +puffs(150).toFixed(3) },
    letteringMs: { [LETTERING]: +words(LETTERING).toFixed(3), 25: +words(25).toFixed(3), 50: +words(50).toFixed(3), 150: +words(150).toFixed(3) },
    veilMs: +veilMs.toFixed(3),
  };

  // Drawn last so the screenshot is the frame that was measured, not the final probe.
  setup();
  drawWorld(ctx, full, withLettering);
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
  console.log(
    `worst case  ${r.standing} standing entities, ${r.blits} blits, ${r.bars} health bars, ${r.lines} stroked paths, ${r.floats} miner floats, ${r.bursts} impact bursts, ${r.puffs} death puffs, ${r.lettering} lettered words, dpr ${request.dpr}`,
  );
  console.log(`corner map  ${request.map} u across`);
  console.log(
    `enemy cap   ${request.enemies === null ? "the config's, as the governor stands" : `${request.enemies}, asked for`}`,
  );
  console.log(
    `sprites     ${Object.keys(request.sprites).join(", ") || "the registry as it stands"}`,
  );
  console.log("");
  console.log(`  paper only          ${r.layers.paper.toFixed(3)} ms`);
  console.log(`  + grass and ore     ${r.layers.floor.toFixed(3)} ms`);
  console.log(`  + everything up     ${r.layers.full.toFixed(3)} ms`);
  console.log(`  + the shot lines    ${r.layers.m5.toFixed(3)} ms`);
  console.log(`  + the miner floats  ${r.layers.floats.toFixed(3)} ms`);
  console.log(`  + the bursts        ${r.layers.bursts.toFixed(3)} ms`);
  console.log(`  + the puffs         ${r.layers.puffs.toFixed(3)} ms`);
  console.log(
    `  + the lettering     ${r.layers.lettering.toFixed(3)} ms   ${share(r.layers.lettering)} of a 16.67 ms frame`,
  );
  console.log("");
  console.log(`  y-sort alone        ${(r.ySortMs * 1000).toFixed(1)} us`);
  console.log(`  shot lines (150)    ${r.shotLinesMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  bursts (150)        ${r.burstsMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  puffs (150)         ${r.puffsMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  lettering (150)     ${r.letteringMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(
    `  the damage veil     ${r.veilMs.toFixed(3)} ms   standalone, one full-viewport fill`,
  );
  console.log("");
  console.log(`Worst case, measured through the shipped drawWorld`);
  console.log(
    `  ${r.layers.lettering.toFixed(2)} ms   ${share(r.layers.lettering)}   headroom ${(FRAME_MS - r.layers.lettering).toFixed(2)} ms`,
  );
}
