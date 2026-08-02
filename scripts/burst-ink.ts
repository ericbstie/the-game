import { join } from "node:path";
import { TURRET_CADENCE_MS, TURRET_DAMAGE } from "../src/game/build";
import { BURST_MS } from "../src/game/draw";
import { GRUNT_HP, RANGED_CADENCE_MS, RANGED_DAMAGE } from "../src/game/enemies";
import { capture, measurementsIn } from "./headless";

// Measure how much ink #115's starburst lays, and what share of a screen the bursts at density
// actually cover.
//
//   bun run burst:ink
//   bun run burst:ink --dpr 1 --dpr 2 --dpr 3   # the same three the default runs
//   bun run burst:ink --bursts 40               # a density the cadences cannot reach today
//   bun run burst:ink --json
//
// This is `shot-ink.ts` asked about the other mark, and it exists for the same reason: the frame
// budget's instrument prices *strokes*, and ink is the other axis. It also answers the one question
// #115 refuses to let the implementer settle by narrowing the trigger — whether the effect reads as
// a wall of ink at density — with a measured share of the viewport rather than an opinion.
//
// It has to run on a real canvas. Half the question is anti-aliasing: a starburst is eight short
// strokes, six of them diagonal, and a stroke that short is nearly all ends fraying into the paper.
// Only a rasteriser knows how much. Three device pixel ratios, because that fraying is a fixed cost
// per end in device pixels and so is worth a different share of the mark at each of them.
//
// Nothing here is timed, so it does not need an idle machine — a pixel count is the same on a busy
// one, which is why the ink claims can be trusted where a sub-millisecond layer cannot.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const FX_MODULE = join(import.meta.dir, "../src/game/fx.ts");
const ENEMIES_MODULE = join(import.meta.dir, "../src/game/enemies.ts");

// The squad, all six of them holding the trigger, and the powered turrets the frame budget's own
// fixture stands (`scripts/frame-budget.ts`). Both are that fixture's worst case rather than a
// typical match.
const SQUAD = 6;
const POWERED_TURRETS = 5;

// How many bursts stand on one screen at once, derived rather than picked so a retune of a cadence
// or a damage figure carries it.
//
// Two things hold it far under the shot count the same fire produces. **A connect that kills reports
// a death and not a hit**: `reapDamage` (`src/game/enemies.ts`) drops the killing blow out of `hits`
// entirely, so the last shot into every grunt lays no burst at all — that connect is #116's. And,
// the larger of the two since #80 put the shot in the air, a burst lives `BURST_MS` (90) where a
// flight lives `PROJECTILE_FLIGHT_MS` (389).
export function concurrentBursts(): number {
  // What fraction of the shots into one grunt are not the one that kills it.
  const nonLethal = (damage: number) => 1 - 1 / Math.ceil(GRUNT_HP / damage);
  const perSecond =
    ((SQUAD * 1_000) / RANGED_CADENCE_MS) * nonLethal(RANGED_DAMAGE) +
    ((POWERED_TURRETS * 1_000) / TURRET_CADENCE_MS) * nonLethal(TURRET_DAMAGE);
  return Math.ceil((perSecond * BURST_MS) / 1_000);
}

export interface InkRequest {
  dprs: number[];
  bursts: number;
  out: string;
}

export function parseArgs(argv: string[]): InkRequest {
  const dprs: number[] = [];
  let bursts: number | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dpr") {
      const dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
      dprs.push(dpr);
    } else if (arg === "--bursts") {
      bursts = Number(argv[++i]);
      if (!Number.isInteger(bursts) || bursts <= 0) {
        throw new Error("--bursts must be a positive whole number");
      }
    } else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg !== "--json") throw new Error(`unknown argument ${arg}`);
  }
  // The three #115 was asked to hold at: a plain monitor, a retina one, and the densest a phone
  // reports. Nothing here reads a dpr off the machine it runs on — that would make the run
  // unrepeatable on the next one.
  return {
    dprs: dprs.length ? dprs : [1, 2, 3],
    bursts: bursts ?? concurrentBursts(),
    out: out ?? join(process.cwd(), "burst-ink.png"),
  };
}

export interface Mark {
  ink: number;
  inked: number;
  solid: number;
  length: number;
  strokes: number;
}

// What the bursts at density put on one screen: the ink they lay against the device pixels there
// are to lay it on.
export interface Screen {
  bursts: number;
  ink: number;
  inked: number;
  solid: number;
  pixels: number;
}

export interface Reading {
  dpr: number;
  burst: Mark;
  shot: Mark;
  screen: Screen;
}

export function entrySource(dpr: number, bursts: number): string {
  return `
import { SHOT_WIDTH } from ${JSON.stringify(DRAW_MODULE)};
import { BURST_REACH, speedLines, starburst } from ${JSON.stringify(FX_MODULE)};
import { RANGED_RANGE } from ${JSON.stringify(ENEMIES_MODULE)};

const DPR = ${dpr};
const BURSTS = ${bursts};
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

const span = (strands) =>
  strands.reduce((n, s) => n + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);

// Struck the way \`drawBursts\` and \`drawShots\` strike: one path, one stroke, whatever it holds.
const stroke = (strands) => {
  paper();
  ctx.beginPath();
  for (const s of strands) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
  ctx.stroke();
  return { ...count(), length: +span(strands).toFixed(2), strokes: strands.length };
};

// Deterministic, so two runs of this script compare to each other.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 0x1_0000_0000; };
}

try {
  // One burst, struck clear of every edge so nothing of it is measured against the canvas.
  const one = starburst({ x: BURST_REACH * 2, y: BURST_REACH * 2 });
  // A shot at its full reach, which is the length every own shot runs (ADR 0003 §3) and the mark
  // \`docs/frame-budget.md\` already prices the frame in.
  const shot = speedLines({ x: 24, y: 24 }, { x: 24 + RANGED_RANGE, y: 24 });

  // The bursts a defended base actually has up at once, scattered over the viewport. Clear of the
  // edges, so the share below is ink that is really on the screen rather than ink clipped off it.
  const r = rng(12_345);
  const scattered = [];
  for (let i = 0; i < BURSTS; i++) {
    const at = {
      x: BURST_REACH + r() * (VIEW.width - BURST_REACH * 2),
      y: BURST_REACH + r() * (VIEW.height - BURST_REACH * 2),
    };
    for (const s of starburst(at)) scattered.push(s);
  }

  const screen = { bursts: BURSTS, ...stroke(scattered), pixels: canvas.width * canvas.height };
  const result = { dpr: DPR, burst: stroke(one), shot: stroke(shot), screen };
  // The screenshot is the screen case, because that is the picture the count above has to be
  // checkable against — it is the one the ticket asks a question about.
  paper();
  ctx.beginPath();
  for (const s of scattered) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
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
      entry: entrySource(dpr, request.bursts),
      out: request.out,
      width: Math.round(800 * dpr),
      height: Math.round(600 * dpr),
      label: `a starburst's ink at dpr ${dpr}`,
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
    `  ${"dpr".padEnd(6)}${"burst ink".padStart(14)}${"v a shot".padStart(11)}${"solid share".padStart(14)}${"ink length".padStart(13)}${"strokes".padStart(9)}`,
  );
  for (const r of readings) {
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${r.burst.ink.toFixed(0).padStart(14)}` +
        `${share(r.burst.ink, r.shot.ink).padStart(11)}` +
        `${share(r.burst.solid, r.burst.inked).padStart(14)}` +
        `${r.burst.length.toFixed(0).padStart(13)}` +
        `${String(r.burst.strokes).padStart(9)}`,
    );
  }
  out.push("");
  out.push(
    `  ${"dpr".padEnd(6)}${"bursts".padStart(8)}${"screen ink".padStart(14)}${"of the screen".padStart(16)}${"pixels touched".padStart(17)}`,
  );
  for (const r of readings) {
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${String(r.screen.bursts).padStart(8)}` +
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
