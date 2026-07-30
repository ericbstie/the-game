import { join } from "node:path";
import { concurrentBursts } from "./burst-ink";
import { capture, measurementsIn } from "./headless";
import { concurrentPuffs } from "./puff-ink";

// Measure how much ink #79's lettered word lays, and what share of a screen the words at density
// cover.
//
//   bun run lettering:ink
//   bun run lettering:ink --dpr 1 --dpr 2 --dpr 3   # the same three the default runs
//   bun run lettering:ink --words 40                # a density the cadences cannot reach today
//   bun run lettering:ink --json
//
// This is `burst-ink.ts` and `puff-ink.ts` asked about the third mark, and it exists for the same
// reason: the frame budget's instrument prices *drawing*, and ink is the other axis. It is also the
// instrument the ticket's anti-narrowing clause is answered with — whether lettering on both hits
// and deaths reads as a wall of ink is a measured share of the viewport here, not an opinion.
//
// **It differs from its two siblings in one way that matters.** A burst and a puff are strokes, so
// those probes can lay the geometry themselves; a word is a **baked sprite**, so this one has to go
// through the sprite cache and blit exactly what the game blits. That is deliberate rather than
// convenient: #120 found that `sprite:sheet` measures a sprite's own box, which is only what the
// player sees when the box and the blit agree. Here they do — `lettering.size` is 36 and `drawWorld`
// blits into 36 — and this probe is what checks it, because it composes the box the way the cache
// does (`bakedPixels(size, dpr) / dpr`) rather than assuming it.
//
// Nothing here is timed, so it does not need an idle machine — a pixel count is the same on a busy
// one, which is why the ink claims can be trusted where a sub-millisecond layer cannot.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const FX_MODULE = join(import.meta.dir, "../src/game/fx.ts");
const ENEMIES_MODULE = join(import.meta.dir, "../src/game/enemies.ts");
const CACHE_MODULE = join(import.meta.dir, "../src/sprite/cache.ts");
const REGISTRY_MODULE = join(import.meta.dir, "../src/sprite/registry.ts");
const LETTERING_MODULE = join(import.meta.dir, "../src/sprite/lettering.ts");

// How many words stand on one screen at once, derived rather than picked so a retune of a cadence, a
// damage figure, a grunt's health or either mark's lifetime carries it.
//
// **It is the sum of the other two marks' counts, and that is the whole of the arithmetic.** A word
// rides #115's impact marks and #116's death marks rather than a list of its own, so it is up for
// exactly as long as they are and there is one of it per mark: `concurrentBursts()` words on hits
// plus `concurrentPuffs()` on deaths. Nothing about lettering both events lets the count run away —
// the hit rate is set by the squad's cadences and the death rate by `reapDamage` splitting a run of
// connects, and both are arithmetic on constants the game already fixes.
export function concurrentLettering(): number {
  return concurrentBursts() + concurrentPuffs();
}

export interface InkRequest {
  dprs: number[];
  words: number;
  out: string;
}

export function parseArgs(argv: string[]): InkRequest {
  const dprs: number[] = [];
  let words: number | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dpr") {
      const dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
      dprs.push(dpr);
    } else if (arg === "--words") {
      words = Number(argv[++i]);
      if (!Number.isInteger(words) || words <= 0) {
        throw new Error("--words must be a positive whole number");
      }
    } else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg !== "--json") throw new Error(`unknown argument ${arg}`);
  }
  // The three #79 was asked to hold at: a plain monitor, a retina one, and the densest a phone
  // reports. Nothing here reads a dpr off the machine it runs on — that would make the run
  // unrepeatable on the next one.
  return {
    dprs: dprs.length ? dprs : [1, 2, 3],
    words: words ?? concurrentLettering(),
    out: out ?? join(process.cwd(), "lettering-ink.png"),
  };
}

export interface Mark {
  ink: number;
  inked: number;
  solid: number;
}

// One word's bake, measured at the size the game actually blits it into.
export interface Bake extends Mark {
  word: number;
  box: number; // the blit's width in device px — what `BakedSprite.size × dpr` comes to
}

// What the words at density put on one screen: the ink they lay against the device pixels there are
// to lay it on.
export interface Screen extends Mark {
  words: number;
  pixels: number;
}

export interface Reading {
  dpr: number;
  bakes: Bake[];
  shot: Mark & { strokes: number };
  screen: Screen;
}

export function entrySource(dpr: number, words: number): string {
  return `
import { SHOT_WIDTH, letteringAt } from ${JSON.stringify(DRAW_MODULE)};
import { speedLines } from ${JSON.stringify(FX_MODULE)};
import { RANGED_RANGE } from ${JSON.stringify(ENEMIES_MODULE)};
import { createSpriteCache } from ${JSON.stringify(CACHE_MODULE)};
import { SPRITES } from ${JSON.stringify(REGISTRY_MODULE)};
import lettering, { WORDS } from ${JSON.stringify(LETTERING_MODULE)};

const DPR = ${dpr};
const WORD_COUNT = ${words};
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
  // The transform the game paints the world through, so a blit here is the blit there — and
  // \`imageSmoothingEnabled\` off for the same reason \`drawWorld\` sets it: the bake is 1:1 with the
  // box, and turning smoothing off is what makes a drift off that alignment show rather than blur.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = SHOT_WIDTH;
};

// Ink on the paper, in device pixels. The floor is white and the mark is black, so a pixel's
// darkness is its coverage; a pixel the rasteriser only half covered is half a pixel of ink.
//
// A word carries **paper of its own**, unlike either mark before it, and white on white counts as
// nothing here — which is correct: what this measures is what the player sees added to the floor.
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

// Struck the way \`drawShots\` strikes: one path, one stroke, whatever it holds.
const strokeShot = (strands) => {
  paper();
  ctx.beginPath();
  for (const s of strands) { ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); }
  ctx.stroke();
  return { ...count(), strokes: strands.length };
};

// Blitted the way \`drawLettering\` blits: centred on the mark, in the box the cache hands over,
// through the very cache the game builds its source from.
const source = createSpriteCache(SPRITES).source(DPR);
const blit = (word, x, y) => {
  const sprite = source("lettering", word, 0);
  if (!sprite) throw new Error("the lettering sprite is not in the registry");
  ctx.drawImage(sprite.image, x - sprite.size / 2, y - sprite.size / 2, sprite.size, sprite.size);
  return sprite.size;
};

// Deterministic, so two runs of this script compare to each other.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0; return s / 0x1_0000_0000; };
}

try {
  // Each word on its own, struck clear of every edge so nothing of it is measured against the canvas.
  const bakes = [];
  for (let word = 0; word < WORDS.length; word++) {
    paper();
    const box = blit(word, lettering.size, lettering.size);
    bakes.push({ word, box: +(box * DPR).toFixed(2), ...count() });
  }

  // A shot at its full reach, which is the length every own shot runs (ADR 0003 §3) and the mark
  // \`docs/frame-budget.md\` already prices the frame in.
  const shot = strokeShot(speedLines({ x: 24, y: 24 }, { x: 24 + RANGED_RANGE, y: 24 }));

  // The words a defended base actually has up at once, scattered over the viewport and lettered by
  // the game's own rule rather than in order, so the mix is the mix a player sees. Clear of the
  // edges, so the share below is ink that is really on the screen rather than ink clipped off it.
  const r = rng(12_345);
  const scattered = [];
  const edge = lettering.size;
  for (let i = 0; i < WORD_COUNT; i++) {
    const at = {
      x: Math.round(edge + r() * (VIEW.width - edge * 2)),
      y: Math.round(edge + r() * (VIEW.height - edge * 2)),
    };
    scattered.push(at);
  }
  paper();
  for (const at of scattered) blit(letteringAt(at, 1_000), at.x, at.y);
  const screen = { words: WORD_COUNT, ...count(), pixels: canvas.width * canvas.height };

  document.getElementById("measurements").textContent = JSON.stringify({ dpr: DPR, bakes, shot, screen });
} catch (e) {
  document.getElementById("measurements").textContent = JSON.stringify({ error: String(e && e.stack || e) });
}
`;
}

export async function measure(request: InkRequest): Promise<Reading[]> {
  const readings: Reading[] = [];
  for (const dpr of request.dprs) {
    // Sized to the entry's own canvas. `capture` screenshots the viewport, so a window smaller than
    // this would crop the words without a word.
    const dom = await capture({
      entry: entrySource(dpr, request.words),
      out: request.out,
      width: Math.round(800 * dpr),
      height: Math.round(600 * dpr),
      label: `a lettered word's ink at dpr ${dpr}`,
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

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function format(readings: Reading[]): string {
  const out: string[] = [];
  out.push(
    `  ${"dpr".padEnd(6)}${"word ink".padStart(12)}${"heaviest".padStart(10)}${"v a shot".padStart(11)}${"solid share".padStart(14)}${"box (px)".padStart(11)}`,
  );
  for (const r of readings) {
    const inks = r.bakes.map((b) => b.ink);
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${mean(inks).toFixed(0).padStart(12)}` +
        `${Math.max(...inks)
          .toFixed(0)
          .padStart(10)}` +
        `${share(mean(inks), r.shot.ink).padStart(11)}` +
        `${share(mean(r.bakes.map((b) => b.solid)), mean(r.bakes.map((b) => b.inked))).padStart(14)}` +
        `${r.bakes[0].box.toFixed(0).padStart(11)}`,
    );
  }
  out.push("");
  out.push(
    `  ${"dpr".padEnd(6)}${"words".padStart(8)}${"screen ink".padStart(14)}${"of the screen".padStart(16)}${"pixels touched".padStart(17)}`,
  );
  for (const r of readings) {
    out.push(
      `  ${String(r.dpr).padEnd(6)}` +
        `${String(r.screen.words).padStart(8)}` +
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
