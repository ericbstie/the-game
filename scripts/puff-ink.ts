import { join } from "node:path";
import { TURRET_CADENCE_MS, TURRET_DAMAGE } from "../src/game/build";
import { PUFF_MS } from "../src/game/draw";
import { GRUNT_HP, RANGED_CADENCE_MS, RANGED_DAMAGE } from "../src/game/enemies";
import { capture, measurementsIn } from "./headless";

// Measure how much ink #116's puff lays, and what share of a screen the puffs at density cover.
//
//   bun run puff:ink
//   bun run puff:ink --dpr 1 --dpr 2 --dpr 3   # the same three the default runs
//   bun run puff:ink --puffs 40                # a wave clear, which the cadences never average
//   bun run puff:ink --json
//
// This is `burst-ink.ts` asked about the death-side mark, and it exists for the same reason: the
// frame budget's instrument prices *strokes*, and ink is the other axis.
//
// It has to run on a real canvas, and more so than either mark before it. A puff is six arcs and
// nothing else — there is no axis-aligned stretch anywhere on it, so every device pixel it touches
// is a partial one and only a rasteriser knows how many. Three device pixel ratios, because that
// fraying is a fixed cost per unit of curve in device pixels and so is worth a different share of
// the mark at each of them.
//
// Nothing here is timed, so it does not need an idle machine — a pixel count is the same on a busy
// one, which is why the ink claims can be trusted where a sub-millisecond layer cannot.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const FX_MODULE = join(import.meta.dir, "../src/game/fx.ts");
const ENEMIES_MODULE = join(import.meta.dir, "../src/game/enemies.ts");

// The squad, all six of them holding the trigger, and the powered turrets the frame budget's own
// fixture stands (`scripts/frame-budget.ts`). Both are that fixture's worst case rather than a
// typical match, and both are the figures `burst-ink.ts` counts its hits from.
const SQUAD = 6;
const POWERED_TURRETS = 5;

// How many puffs stand on one screen at once, derived rather than picked so a retune of a cadence,
// a damage figure or a grunt's health carries it.
//
// This is `concurrentBursts()` read from the other side of `reapDamage` (`src/game/enemies.ts`),
// which drops a killing blow out of `hits` and reports it as a death: the shots into one grunt split
// into the many that burst and the one that puffs. A grunt takes `ceil(GRUNT_HP / damage)` connects,
// so the death rate is the connect rate divided by that — an order of magnitude under the hit rate,
// which is the whole of why this mark scales more gently than #115's.
export function concurrentPuffs(): number {
  // What fraction of the shots into one grunt are the one that kills it.
  const lethal = (damage: number) => 1 / Math.ceil(GRUNT_HP / damage);
  const perSecond =
    ((SQUAD * 1_000) / RANGED_CADENCE_MS) * lethal(RANGED_DAMAGE) +
    ((POWERED_TURRETS * 1_000) / TURRET_CADENCE_MS) * lethal(TURRET_DAMAGE);
  return Math.ceil((perSecond * PUFF_MS) / 1_000);
}

export interface InkRequest {
  dprs: number[];
  puffs: number;
  out: string;
}

export function parseArgs(argv: string[]): InkRequest {
  const dprs: number[] = [];
  let puffs: number | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dpr") {
      const dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
      dprs.push(dpr);
    } else if (arg === "--puffs") {
      puffs = Number(argv[++i]);
      if (!Number.isInteger(puffs) || puffs <= 0) {
        throw new Error("--puffs must be a positive whole number");
      }
    } else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg !== "--json") throw new Error(`unknown argument ${arg}`);
  }
  // The three #116 was asked to hold at: a plain monitor, a retina one, and the densest a phone
  // reports. Nothing here reads a dpr off the machine it runs on — that would make the run
  // unrepeatable on the next one.
  return {
    dprs: dprs.length ? dprs : [1, 2, 3],
    puffs: puffs ?? concurrentPuffs(),
    out: out ?? join(process.cwd(), "puff-ink.png"),
  };
}

export interface Mark {
  ink: number;
  inked: number;
  solid: number;
  length: number;
}

// What the puffs at density put on one screen: the ink they lay against the device pixels there are
// to lay it on.
export interface Screen {
  puffs: number;
  ink: number;
  inked: number;
  solid: number;
  pixels: number;
}

export interface Reading {
  dpr: number;
  puff: Mark & { arcs: number };
  shot: Mark & { strokes: number };
  screen: Screen;
}

export function entrySource(dpr: number, puffs: number): string {
  return `
import { SHOT_WIDTH } from ${JSON.stringify(DRAW_MODULE)};
import { inkPuff, PUFF_REACH, speedLines } from ${JSON.stringify(FX_MODULE)};
import { RANGED_RANGE } from ${JSON.stringify(ENEMIES_MODULE)};

const DPR = ${dpr};
const PUFFS = ${puffs};
// The viewport the frame budget measures, so a share of the screen here is a share of that screen.
const VIEW = { width: 800, height: 600 };

const canvas = document.getElementById("sheet");
canvas.width = Math.round(VIEW.width * DPR);
canvas.height = Math.round(VIEW.height * DPR);
canvas.style.width = canvas.width + "px";
canvas.style.height = canvas.height + "px";
const ctx = canvas.getContext("2d");

const paper = () => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // The transform the game paints the world through, so SHOT_WIDTH is world units here exactly as
  // it is there — a stroke measured at the wrong width is a different mark.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = SHOT_WIDTH;
};

// Ink on the paper, in device pixels. The floor is white and the mark is black, so a pixel's
// darkness is its coverage; a pixel the rasteriser only half covered is half a pixel of ink.
const count = () => {
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0, inked = 0, solid = 0;
  for (let i = 0; i < px.length; i += 4) {
    const cover = (255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255;
    if (cover <= 0) continue;
    ink += cover;
    inked++;
    if (cover >= 0.999) solid++;
  }
  return { ink: +ink.toFixed(2), inked, solid };
};

const segments = (strands) =>
  strands.reduce((n, s) => n + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);
// A lobe's contribution to the outline is its swept arc, not its circumference.
const scallops = (lobes) => lobes.reduce((n, l) => n + Math.abs(l.to - l.from) * l.radius, 0);

// Struck the way \`drawShots\` strikes: one path, one stroke, whatever it holds.
const strokeShot = (strands) => {
  paper();
  ctx.beginPath();
  for (const s of strands) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
  ctx.stroke();
  return { ...count(), length: +segments(strands).toFixed(2), strokes: strands.length };
};

// Struck the way \`drawPuffs\` strikes: one path for the frame, one subpath per cloud, and the lobes
// chained so the scallops join instead of meeting at butt ends.
const lay = (ctx, lobes) => {
  ctx.moveTo(
    lobes[0].at.x + Math.cos(lobes[0].from) * lobes[0].radius,
    lobes[0].at.y + Math.sin(lobes[0].from) * lobes[0].radius,
  );
  for (const l of lobes) ctx.arc(l.at.x, l.at.y, l.radius, l.from, l.to);
  ctx.closePath();
};

const strokePuffs = (clouds) => {
  paper();
  ctx.beginPath();
  for (const lobes of clouds) lay(ctx, lobes);
  ctx.stroke();
  const lobes = clouds.flat();
  return { ...count(), length: +scallops(lobes).toFixed(2), arcs: lobes.length };
};

// Deterministic, so two runs of this script compare to each other.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 0x1_0000_0000; };
}

try {
  // One puff, struck clear of every edge so nothing of it is measured against the canvas.
  const one = inkPuff({ x: PUFF_REACH * 2, y: PUFF_REACH * 2 });
  // A shot at its full reach, which is the length every own shot runs (ADR 0003 §3) and the mark
  // \`docs/frame-budget.md\` already prices the frame in.
  const shot = speedLines({ x: 24, y: 24 }, { x: 24 + RANGED_RANGE, y: 24 });

  // The puffs a defended base actually has up at once, scattered over the viewport. Clear of the
  // edges, so the share below is ink that is really on the screen rather than ink clipped off it.
  const r = rng(12_345);
  const scattered = [];
  for (let i = 0; i < PUFFS; i++) {
    const at = {
      x: PUFF_REACH + r() * (VIEW.width - PUFF_REACH * 2),
      y: PUFF_REACH + r() * (VIEW.height - PUFF_REACH * 2),
    };
    scattered.push(inkPuff(at));
  }

  const laid = strokePuffs(scattered);
  const screen = {
    puffs: PUFFS, ink: laid.ink, inked: laid.inked, solid: laid.solid,
    pixels: canvas.width * canvas.height,
  };
  const result = { dpr: DPR, puff: strokePuffs([one]), shot: strokeShot(shot), screen };
  // The screenshot is the screen case, because that is the picture the count above has to be
  // checkable against — it is the one the ticket asks a question about.
  paper();
  ctx.beginPath();
  for (const lobes of scattered) lay(ctx, lobes);
  ctx.stroke();
  document.getElementById("measurements").textContent = JSON.stringify(result);
} catch (e) {
  document.getElementById("measurements").textContent = JSON.stringify({ error: String(e && e.stack || e) });
}
`;
}

export async function measure(request: InkRequest): Promise<Reading[]> {
  const readings: Reading[] = [];
  for (const dpr of request.dprs) {
    // Sized to the entry's own canvas. `capture` screenshots the viewport, so a window smaller than
    // this would crop the marks without a word.
    const dom = await capture({
      entry: entrySource(dpr, request.puffs),
      out: request.out,
      width: Math.round(800 * dpr),
      height: Math.round(600 * dpr),
      label: `an ink puff's ink at dpr ${dpr}`,
    });
    const found = measurementsIn(dom) as (Reading & { error?: string }) | null;
    if (!found) throw new Error(`no measurements came back at dpr ${dpr}`);
    if (found.error) throw new Error(found.error);
    readings.push(found);
  }
  return readings;
}

const share = (a: number, b: number, places = 1) =>
  b === 0 ? "—" : `${((a / b) * 100).toFixed(places)}%`;

export function format(readings: Reading[]): string {
  const out: string[] = [];
  out.push(
    `  ${"dpr".padEnd(6)}${"puff ink".padStart(14)}${"v a shot".padStart(11)}${"solid share".padStart(14)}${"ink length".padStart(13)}${"arcs".padStart(9)}`,
  );
  for (const r of readings) {
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${r.puff.ink.toFixed(0).padStart(14)}` +
        `${share(r.puff.ink, r.shot.ink).padStart(11)}` +
        `${share(r.puff.solid, r.puff.inked).padStart(14)}` +
        `${r.puff.length.toFixed(0).padStart(13)}` +
        `${String(r.puff.arcs).padStart(9)}`,
    );
  }
  out.push("");
  out.push(
    `  ${"dpr".padEnd(6)}${"puffs".padStart(8)}${"screen ink".padStart(14)}${"of the screen".padStart(16)}${"pixels touched".padStart(17)}`,
  );
  for (const r of readings) {
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${String(r.screen.puffs).padStart(8)}` +
        `${r.screen.ink.toFixed(0).padStart(14)}` +
        `${share(r.screen.ink, r.screen.pixels, 2).padStart(16)}` +
        `${share(r.screen.inked, r.screen.pixels, 2).padStart(17)}`,
    );
  }
  out.push("");
  out.push(
    "ink is the sum of per-pixel coverage; the screen is the 800x600 the frame budget uses.",
  );
  return out.join("\n");
}

if (import.meta.main) {
  const request = parseArgs(process.argv.slice(2));
  const readings = await measure(request);
  console.log(
    process.argv.includes("--json") ? JSON.stringify(readings, null, 2) : format(readings),
  );
}
