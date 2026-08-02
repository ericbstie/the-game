import { join, resolve } from "node:path";
import { MINIMAP_COVERAGE_U } from "../src/game/minimap";
import { concurrentBursts } from "./burst-ink";
import { capture, measurementsIn } from "./headless";
import { concurrentLettering } from "./lettering-ink";
import { concurrentPuffs } from "./puff-ink";
import { concurrentShots } from "./shot-ink";

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
const BLOOD_MODULE = join(import.meta.dir, "../src/game/blood.ts");
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
  inFlight: number;
  floats: number;
  bursts: number;
  puffs: number;
  lettering: number;
  decals: number;
  layers: Record<string, number>;
  ySortMs: number;
  healthBarsMs: Record<string, number>;
  shotsMs: Record<string, number>;
  burstsMs: Record<string, number>;
  puffsMs: Record<string, number>;
  letteringMs: Record<string, number>;
  bloodMs: Record<string, number>;
  veilMs: number;
  aimMs: number;
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
import { inkPuff, reticle, speedLines, starburst } from ${JSON.stringify(FX_MODULE)};
import { AIM_INK_WIDTH, AIM_PAPER_WIDTH, letteringAt, SHOT_STREAK } from ${JSON.stringify(DRAW_MODULE)};
import { BLOOD_BANDS } from ${JSON.stringify(DRAW_MODULE)};
import { BLOOD_CAP, BLOOD_FADE_MS, DROP_RADIUS, stainMarks } from ${JSON.stringify(BLOOD_MODULE)};
import { FLASH_ALPHA } from ${JSON.stringify(DAMAGE_MODULE)};

const VIEW = { width: 800, height: 600 };
const DPR = ${request.dpr};
const ARENA = { width: 31_200, height: 31_200 };
const CAM = { x: 15_400, y: 15_400 };
const STRUCTURES = 40;
const ITERS = 60;
// Shots in the air (#80), and this one is *derived* where the line it replaced was budgeted: a
// hitscan line's 50 came off a lifetime somebody picked, and a flight's count comes off
// \`PROJECTILE_FLIGHT_MS\` — the weapon's reach over its speed (\`scripts/shot-ink.ts\`). Five of the
// shooters are powered turrets and six are the squad, the same pair every derived count on this
// page uses. It is a ceiling: a shot that connects is spent where it lands, and at \`enemyCap\`
// almost every one does.
const IN_FLIGHT = ${concurrentShots()};
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
// #140's blood, and this one is neither budgeted nor derived from a cadence: it is the module's own
// hard ceiling. Every other mark on this page rides a rate, so its count is arithmetic on the
// cadences; a decal rides how many bloodlings are on screen, which at \`ENEMY_CAP\` is unbounded — so
// the list is capped instead, and the cap *is* the worst case. Nothing off screen is ever admitted
// to it, so this is a count of marks drawn and not of marks held.
const DECALS = BLOOD_CAP;

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
    // Every seventh is a bloodling (#140), so the kind the budget's decal layer belongs to is in the
    // frame it is measured on. It shares the grunt's box, so the standing layer is unmoved; its HP
    // is under BLOODLING_HP for the reason every other enemy here is damaged — a bar apiece.
    const kind = elite ? "elite" : i % 7 === 3 ? "bloodling" : "grunt";
    enemies.push({
      id: "e" + i, kind,
      pos: { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height },
      facing: Math.floor(r() * 8), frame: Math.floor(r() * 2),
      radius: elite ? 24 : 16, hp: elite ? 119 : kind === "bloodling" ? 7 : 17,
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
  // No shots in the air: they are the layer above (#80), and \`flying\` spreads this world to add
  // them. A world without the field would throw rather than draw nothing.
  return { arena: ARENA, players, enemies, nests, ore, structures, projectiles: [],
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
  // The pointer, in the middle of the frame (#154). In the *base* options rather than a row of its
  // own, because it is the one mark that is up on every frame the game draws — there is exactly one
  // pointer and nothing can put up a second — so a ladder measured without it would be pricing a
  // frame the game does not paint. It is priced on its own below as well, since 0.02 ms cannot be
  // resolved between two rows that vary by a millisecond.
  const AIM = { x: CAM.x + VIEW.width / 2, y: CAM.y + VIEW.height / 2 };
  const opts = { selfId: "p0", camera: CAM, viewport: VIEW, dpr: DPR, now: 1000, sprites, minimapCoverage: ${request.map}, aim: AIM };

  const empty = build(0, 0, false);
  const floor = build(0, 0, true);
  const full = build(${request.enemies ?? "DEFAULT_WORLD_SETTINGS.enemyCap"}, STRUCTURES, true);

  // The shots in the air, through the shipped path rather than a hand-rolled stroke (#80). They ride
  // the *snapshot* now rather than the options — a bullet is server state the client mirrors, like a
  // spider — so this layer is a different world rather than a different options bag.
  //
  // Scattered over the viewport and each at a different point of its flight, because the mark is
  // clipped at the launch point for the first fifth of a streak's length: a list all of one age
  // would price the cheapest frame or the dearest one rather than the real mix.
  const inFlight = (n) => {
    const r = rng(4242);
    const shots = [];
    for (let i = 0; i < n; i++) {
      const from = { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height };
      const bearing = r() * Math.PI * 2;
      const flown = r() * SHOT_STREAK * 2;
      shots.push({
        id: "s" + i,
        from,
        pos: { x: from.x + Math.cos(bearing) * flown, y: from.y + Math.sin(bearing) * flown },
      });
    }
    return shots;
  };
  const flying = { ...full, projectiles: inFlight(IN_FLIGHT) };
  const m5 = opts;

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

  // #140's blood, scattered over the viewport the way a screen of charging bloodlings lays it: mostly
  // drips, one splat in every dozen or so marks, and every age across the fade — which matters here
  // and nowhere else on this page, because the fade is *banded* and the bands are what the layer's
  // paths are. A list all of one age would open one path and price the cheapest frame rather than
  // the worst one.
  const bloodMarks = (n) => {
    const r = rng(777);
    const marks = [];
    while (marks.length < n) {
      const at = { x: CAM.x + r() * VIEW.width, y: CAM.y + r() * VIEW.height };
      const laid = opts.now - r() * BLOOD_FADE_MS;
      if (r() < 0.08) for (const lobe of stainMarks(at, laid)) marks.push(lobe);
      else marks.push({ pos: at, at: laid, radius: DROP_RADIUS });
    }
    return marks.slice(0, n);
  };
  const withBlood = { ...withLettering, blood: bloodMarks(DECALS) };

  // Whichever layer is measured first otherwise absorbs the canvas's one-time setup and reads two
  // to three times its true cost. Spend it here, on a result nobody reads.
  measure(() => { setup(); drawWorld(ctx, flying, m5); }, 10);

  // Each layer is the whole frame up to that point, so the deltas below are what each one adds.
  const paperMs = measure(() => { setup(); drawWorld(ctx, empty, opts); });
  const floorMs = measure(() => { setup(); drawWorld(ctx, floor, opts); });
  const fullMs = measure(() => { setup(); drawWorld(ctx, full, opts); });
  const m5Ms = measure(() => { setup(); drawWorld(ctx, flying, m5); });
  const floatsMs = measure(() => { setup(); drawWorld(ctx, flying, withFloats); });
  const burstsMs = measure(() => { setup(); drawWorld(ctx, flying, withBursts); });
  const puffsMs = measure(() => { setup(); drawWorld(ctx, flying, withPuffs); });
  const letteringMs = measure(() => { setup(); drawWorld(ctx, flying, withLettering); });
  const bloodMs = measure(() => { setup(); drawWorld(ctx, flying, withBlood); });

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
  drawWorld(ctx, flying, withBlood);
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
  // The shots in the air (#80), struck the way drawProjectiles strikes them: the whole frame's worth
  // in one path, each a \`speedLines\` streak of \`SHOT_STREAK\` behind the point it has reached.
  // Measured at several counts because the count is now a *ceiling* off the cadences rather than a
  // lifetime somebody picked, and #80's speed is provisional — a retune moves the count.
  const shots = (n) => {
    const marks = inFlight(n);
    return measure(() => {
      setup();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const m of marks) for (const s of speedLines(m.from, m.pos)) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
      ctx.stroke();
    });
  };
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

  // The blood (#140), laid the way drawBlood lays it: bucketed into the fade's bands, one path and
  // one fill a band, a disc a mark. **The only filled mark on this page** — every other one is
  // stroked — and the only one whose count is a ceiling rather than a rate, so the ladder is what
  // says whether that ceiling is affordable. Priced at counts under it as well as at it, because the
  // lever if it ever has to get cheaper is \`BLOOD_CAP\` itself.
  const blood = (n) => {
    const marks = bloodMarks(n);
    return measure(() => {
      setup();
      ctx.fillStyle = "#d81324";
      const bands = Array.from({ length: BLOOD_BANDS }, () => []);
      for (const m of marks) {
        const left = 1 - (opts.now - m.at) / BLOOD_FADE_MS;
        bands[Math.min(BLOOD_BANDS - 1, Math.max(0, Math.floor(left * BLOOD_BANDS)))].push(m);
      }
      for (const band of bands) {
        if (band.length === 0) continue;
        ctx.beginPath();
        for (const m of band) {
          ctx.moveTo(m.pos.x + m.radius, m.pos.y);
          ctx.arc(m.pos.x, m.pos.y, m.radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
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

  // The aim mark (#154), struck the way drawAim strikes it: one path of four mitred corners, laid in
  // paper and struck again in ink. Standalone and with no ladder, because it is the one mark in the
  // frame whose count is fixed — there is exactly one pointer, and it is up on every frame the game
  // draws. Nothing about play, a cadence or a cap can put up a second.
  const aimMs = measure(() => {
    setup();
    ctx.beginPath();
    for (const corner of reticle(AIM)) {
      ctx.moveTo(corner[0].x, corner[0].y);
      for (let i = 1; i < corner.length; i++) ctx.lineTo(corner[i].x, corner[i].y);
    }
    ctx.lineJoin = "miter";
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = AIM_PAPER_WIDTH;
    ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.lineWidth = AIM_INK_WIDTH;
    ctx.stroke();
  });

  const result = {
    standing: full.enemies.length + STRUCTURES + full.players.length + full.nests.length,
    blits,
    bars,
    lines,
    inFlight: IN_FLIGHT,
    floats: floats.length,
    bursts: BURSTS,
    puffs: PUFFS,
    lettering: LETTERING,
    decals: DECALS,
    layers: {
      paper: +paperMs.toFixed(3),
      floor: +floorMs.toFixed(3),
      full: +fullMs.toFixed(3),
      m5: +m5Ms.toFixed(3),
      floats: +floatsMs.toFixed(3),
      bursts: +burstsMs.toFixed(3),
      puffs: +puffsMs.toFixed(3),
      lettering: +letteringMs.toFixed(3),
      blood: +bloodMs.toFixed(3),
    },
    ySortMs: +ySortMs.toFixed(4),
    healthBarsMs: { 60: +healthBars(60).toFixed(3), 240: +healthBars(240).toFixed(3) },
    shotsMs: { [IN_FLIGHT]: +shots(IN_FLIGHT).toFixed(3), 25: +shots(25).toFixed(3), 50: +shots(50).toFixed(3), 150: +shots(150).toFixed(3) },
    burstsMs: { [BURSTS]: +bursts(BURSTS).toFixed(3), 25: +bursts(25).toFixed(3), 50: +bursts(50).toFixed(3), 150: +bursts(150).toFixed(3) },
    puffsMs: { [PUFFS]: +puffs(PUFFS).toFixed(3), 25: +puffs(25).toFixed(3), 50: +puffs(50).toFixed(3), 150: +puffs(150).toFixed(3) },
    letteringMs: { [LETTERING]: +words(LETTERING).toFixed(3), 25: +words(25).toFixed(3), 50: +words(50).toFixed(3), 150: +words(150).toFixed(3) },
    bloodMs: { [DECALS]: +blood(DECALS).toFixed(3), 25: +blood(25).toFixed(3), 50: +blood(50).toFixed(3), 150: +blood(150).toFixed(3) },
    veilMs: +veilMs.toFixed(3),
    aimMs: +aimMs.toFixed(3),
  };

  // Drawn last so the screenshot is the frame that was measured, not the final probe.
  setup();
  drawWorld(ctx, flying, withBlood);
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
    `worst case  ${r.standing} standing entities, ${r.blits} blits, ${r.bars} health bars, ${r.lines} stroked paths, ${r.floats} miner floats, ${r.bursts} impact bursts, ${r.puffs} death puffs, ${r.lettering} lettered words, ${r.decals} blood decals, dpr ${request.dpr}`,
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
  console.log(`  + the shots in the air  ${r.layers.m5.toFixed(3)} ms   ${r.inFlight} of them`);
  console.log(`  + the miner floats  ${r.layers.floats.toFixed(3)} ms`);
  console.log(`  + the bursts        ${r.layers.bursts.toFixed(3)} ms`);
  console.log(`  + the puffs         ${r.layers.puffs.toFixed(3)} ms`);
  console.log(`  + the lettering     ${r.layers.lettering.toFixed(3)} ms`);
  console.log(
    `  + the blood         ${r.layers.blood.toFixed(3)} ms   ${share(r.layers.blood)} of a 16.67 ms frame`,
  );
  console.log("");
  console.log(`  y-sort alone        ${(r.ySortMs * 1000).toFixed(1)} us`);
  console.log(`  shots (150)         ${r.shotsMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  bursts (150)        ${r.burstsMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  puffs (150)         ${r.puffsMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(`  lettering (150)     ${r.letteringMs[150].toFixed(3)} ms   standalone, for scale`);
  console.log(
    `  blood (${String(r.decals).padEnd(3)})        ${r.bloodMs[r.decals].toFixed(3)} ms   standalone, the cap the list holds`,
  );
  console.log(
    `  the damage veil     ${r.veilMs.toFixed(3)} ms   standalone, one full-viewport fill`,
  );
  console.log(
    `  the aim mark        ${r.aimMs.toFixed(3)} ms   standalone, one path struck twice — and always exactly one`,
  );
  console.log("");
  console.log(`Worst case, measured through the shipped drawWorld`);
  console.log(
    `  ${r.layers.blood.toFixed(2)} ms   ${share(r.layers.blood)}   headroom ${(FRAME_MS - r.layers.blood).toFixed(2)} ms`,
  );
}
