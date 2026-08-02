import { join } from "node:path";
import { TURRET_CADENCE_MS } from "../src/game/build";
import { PROJECTILE_FLIGHT_MS, RANGED_CADENCE_MS } from "../src/game/enemies";
import { capture, measurementsIn } from "./headless";

// Measure how much ink a shot's mark lays, #114's speed lines against the plain continuous line
// they replaced.
//
//   bun run shot:ink
//   bun run shot:ink --dpr 1 --dpr 2 --dpr 3   # the same three the default runs
//   bun run shot:ink --json
//
// This exists because `docs/frame-budget.md` makes a claim about ink — that a broken mark with two
// strands beside it lays less than the rule at close range and more at full reach — and the frame
// budget's own instrument cannot see it: that one prices *strokes*, and ink is the other axis.
//
// It has to run on a real canvas. Half the question is anti-aliasing — a diagonal 2 px stroke is
// mostly partial pixels, and a mark broken into nine of them has more ends fraying into the paper
// than one long one does — and only a rasteriser knows how much. Three device pixel ratios, because
// that fraying is a fixed cost per end in device pixels and so is worth a different share of the
// mark at each of them. The `--dump-dom` channel #77 §2 established carries the counts back out.
//
// Three readings per case, all in device pixels:
//
// - **ink** — the sum of every pixel's coverage. This is the honest total: a pixel half covered by
//   a diagonal stroke is half a pixel of ink, and counting it whole is what makes an anti-aliased
//   mark look dearer than it is.
// - **inked** / **solid** — how many pixels carry any ink at all, and how many are fully covered.
//   Their ratio is what says whether a mark rasterises as ink or as grey: the same ink spread over
//   more partial pixels is a fainter mark at the same cost.
// - **length** — the geometry alone, summed over the strokes, with no rasteriser in it. The claim
//   in the budget is about this one, and it is the same number at every dpr.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const FX_MODULE = join(import.meta.dir, "../src/game/fx.ts");
const ENEMIES_MODULE = join(import.meta.dir, "../src/game/enemies.ts");

// The squad, all six of them holding the trigger, and the powered turrets the frame budget's own
// fixture stands (`scripts/frame-budget.ts`). Both are that fixture's worst case rather than a
// typical match — the same pair `scripts/burst-ink.ts` derives its own count from.
const SQUAD = 6;
const POWERED_TURRETS = 5;

// How many shots stand on one screen at once since #80, derived rather than budgeted — which is the
// change: a hitscan line's count came off a *lifetime* somebody picked (`SHOT_LINE_MS`), and a
// flight's comes off `PROJECTILE_FLIGHT_MS`, which is the weapon's own reach over its own speed.
//
// **It is a ceiling and not a rate.** A shot that connects is spent where it lands, and at
// `enemyCap` almost every shot meets something on its first tick — `bun run delta:size` measures
// nine in the air with thirty turrets engaged. This is the sky a squad that misses everything puts
// up, which is the honest thing for a frame budget to price.
export function concurrentShots(): number {
  const perSecond =
    (SQUAD * 1_000) / RANGED_CADENCE_MS + (POWERED_TURRETS * 1_000) / TURRET_CADENCE_MS;
  return Math.ceil((perSecond * PROJECTILE_FLIGHT_MS) / 1_000);
}

export interface InkRequest {
  dprs: number[];
  out: string;
}

export function parseArgs(argv: string[]): InkRequest {
  const dprs: number[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dpr") {
      const dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
      dprs.push(dpr);
    } else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg !== "--json") throw new Error(`unknown argument ${arg}`);
  }
  // The three #114 was asked to hold at: a plain monitor, a retina one, and the densest a phone
  // reports. Nothing here reads a dpr off the machine it runs on — that would make the run
  // unrepeatable on the next one.
  return { dprs: dprs.length ? dprs : [1, 2, 3], out: out ?? join(process.cwd(), "shot-ink.png") };
}

export interface Mark {
  ink: number;
  inked: number;
  solid: number;
  length: number;
  strokes: number;
}

export interface Case {
  length: number;
  angle: number;
  trail: boolean; // whether the shot is long enough to carry one (`TRAIL_MIN_LENGTH`)
  plain: Mark;
  speed: Mark;
}

export interface Reading {
  dpr: number;
  cases: Case[];
}

export function entrySource(dpr: number): string {
  return `
import { SHOT_WIDTH } from ${JSON.stringify(DRAW_MODULE)};
import { SHOT_DASH, speedLines, TRAIL_MIN_LENGTH } from ${JSON.stringify(FX_MODULE)};
import { RANGED_RANGE } from ${JSON.stringify(ENEMIES_MODULE)};

const DPR = ${dpr};
// Room for the widest strand to stand off the line and for the stroke to spread either side of it,
// so nothing is measured against the edge of the canvas.
const PAD = 24;
const SIDE = RANGED_RANGE + PAD * 2;

// What a shot is actually drawn at. Full reach is the length your own shot always runs (ADR 0003
// §3); the rest are what a squadmate's or a turret's mark comes out at when it lands on something.
// The threshold is sampled from both sides — the ink steps there, because a shot under it carries
// no trail — and the last is short enough that the fit puts one whole dash across it and no gap,
// which is the plain line again.
const LENGTHS = [
  RANGED_RANGE,
  RANGED_RANGE / 2,
  TRAIL_MIN_LENGTH,
  TRAIL_MIN_LENGTH - 1,
  SHOT_DASH,
];
// Axis-aligned, and the diagonal — the same stroke costs an anti-aliasing rasteriser far more on
// the second, and a shot is aimed with a mouse so it is on the second nearly always.
const ANGLES = [0, Math.PI / 4];

const canvas = document.getElementById("sheet");
canvas.width = Math.round(SIDE * DPR);
canvas.height = Math.round(SIDE * DPR);
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

const stroke = (strands) => {
  paper();
  ctx.beginPath();
  for (const s of strands) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
  ctx.stroke();
  return { ...count(), length: +span(strands).toFixed(2), strokes: strands.length };
};

try {
  const cases = [];
  for (const length of LENGTHS) {
    for (const angle of ANGLES) {
      const from = { x: PAD, y: PAD };
      const to = { x: PAD + Math.cos(angle) * length, y: PAD + Math.sin(angle) * length };
      cases.push({
        length: +length.toFixed(2),
        angle: +angle.toFixed(4),
        trail: length >= TRAIL_MIN_LENGTH,
        // M5's treatment is gone from the code, so the line it replaced is stroked here rather than
        // called: one segment, shooter to target, at the same width and colour.
        plain: stroke([{ from, to }]),
        speed: stroke(speedLines(from, to)),
      });
    }
  }
  // The screenshot is the last mark measured, so the counts can be checked against a picture.
  document.getElementById("measurements").textContent = JSON.stringify({ dpr: DPR, cases });
} catch (e) {
  document.getElementById("measurements").textContent = JSON.stringify({ error: String(e && e.stack || e) });
}
`;
}

export async function measure(request: InkRequest): Promise<Reading[]> {
  const readings: Reading[] = [];
  for (const dpr of request.dprs) {
    // Sized to the entry's own canvas, which is `RANGED_RANGE + 48` a side. `capture` screenshots
    // the viewport, so a window smaller than this would crop the mark without a word.
    const side = Math.round((700 + 48) * dpr);
    const dom = await capture({
      entry: entrySource(dpr),
      out: request.out,
      width: side,
      height: side,
      label: `a shot's ink at dpr ${dpr}`,
    });
    const found = measurementsIn(dom) as (Reading & { error?: string }) | null;
    if (!found) throw new Error(`no measurements came back at dpr ${dpr}`);
    if (found.error) throw new Error(found.error);
    readings.push(found);
  }
  return readings;
}

const ratio = (a: number, b: number) =>
  b === 0 ? "—" : `${a / b >= 1 ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`;
const share = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);

export function format(readings: Reading[]): string {
  const out: string[] = [];
  for (const reading of readings) {
    out.push(`dpr ${reading.dpr}`);
    out.push(
      `  ${"shot".padEnd(20)}${"ink (device px)".padStart(22)}${"solid share".padStart(26)}${"ink length".padStart(20)}`,
    );
    for (const c of reading.cases) {
      const name = `${c.length.toFixed(0)} u @ ${c.angle === 0 ? "0" : "45"}deg${c.trail ? "" : " (no trail)"}`;
      out.push(
        `  ${name.padEnd(20)}` +
          `${`${c.speed.ink.toFixed(0)} v ${c.plain.ink.toFixed(0)}  ${ratio(c.speed.ink, c.plain.ink)}`.padStart(22)}` +
          `${`${share(c.speed.solid, c.speed.inked)} v ${share(c.plain.solid, c.plain.inked)}`.padStart(26)}` +
          `${`${c.speed.length.toFixed(0)} v ${c.plain.length.toFixed(0)}  ${ratio(c.speed.length, c.plain.length)}`.padStart(20)}`,
      );
    }
    out.push("");
  }
  out.push("speed lines v the plain line they replaced; ink is the sum of per-pixel coverage.");
  return out.join("\n");
}

if (import.meta.main) {
  const request = parseArgs(process.argv.slice(2));
  const readings = await measure(request);
  console.log(
    process.argv.includes("--json") ? JSON.stringify(readings, null, 2) : format(readings),
  );
}
