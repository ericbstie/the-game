import { basename, dirname, extname, join, resolve } from "node:path";
import { type BakeMeasurement, layoutSheet, type SpriteSubject } from "../src/sprite/sheet";
import { capture, measurementsIn } from "./headless";

// Render a sprite module to a PNG review sheet an agent can look at.
//
//   bun run sprite:sheet src/sprite/player/player.ts
//
// The Chromium launch itself lives in `headless.ts`, which the world-frame renderer shares.

const SHEET_MODULE = join(import.meta.dir, "../src/sprite/sheet.ts");
const DEFAULT_DPR = 2;

export interface SheetRequest {
  subject: string; // absolute path to a module default-exporting a SpriteSubject
  out: string;
  dpr: number;
  json: boolean;
}

export interface SheetResult {
  out: string;
  dpr: number;
  sheet: { width: number; height: number };
  subject: { name: string; size: number; facings: number; frames: number };
  bakes: BakeMeasurement[];
}

export function parseArgs(argv: string[]): SheetRequest {
  let subject: string | null = null;
  let out: string | null = null;
  let dpr = DEFAULT_DPR;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--dpr") {
      dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error(`--dpr must be a positive number`);
    } else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    else subject = arg;
  }
  if (!subject) {
    throw new Error(
      "usage: bun run sprite:sheet <sprite module> [--out sheet.png] [--dpr 2] [--json]",
    );
  }
  const path = resolve(subject);
  // Named after the module, not "sheet.png": a dozen sprite agents render into this one directory
  // in parallel, and a shared default would have each of them quietly overwrite the last.
  const stem = basename(path, extname(path));
  return {
    subject: path,
    out: resolve(out ?? join(dirname(path), `${stem}.sheet.png`)),
    dpr,
    json,
  };
}

// The browser entry, generated per subject because a bundler has to see the import path. Sprite
// modules are imported here *and* in Bun (for the layout size), so they must not touch the DOM at
// module scope — all their drawing happens inside `draw`.
export function entrySource(subject: string, dpr: number, sheetModule = SHEET_MODULE): string {
  return `import subject from ${JSON.stringify(subject)};
import { bakeSubject, drawSheet, layoutSheet, measureBakes } from ${JSON.stringify(sheetModule)};

const dpr = ${dpr};
const layout = layoutSheet(subject);
const canvas = document.getElementById("sheet");
canvas.width = Math.round(layout.width * dpr);
canvas.height = Math.round(layout.height * dpr);
// One backing-store pixel per CSS pixel, so the capture is 1:1 with the device pixels a player at
// this dpr sees and nothing in the screenshot path can add or remove grey.
canvas.style.width = canvas.width + "px";
canvas.style.height = canvas.height + "px";
const ctx = canvas.getContext("2d");
ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // the same transform GameScreen paints the world through
const bakes = bakeSubject(subject, dpr);
drawSheet(ctx, { subject, bakes, dpr });
document.getElementById("measurements").textContent = JSON.stringify({
  subject: {
    name: subject.name,
    size: subject.size,
    facings: subject.facings,
    frames: subject.frames,
  },
  dpr,
  sheet: { width: layout.width, height: layout.height },
  bakes: measureBakes(bakes),
});
`;
}

export async function renderSheet(request: SheetRequest): Promise<SheetResult> {
  const subject: SpriteSubject = (await import(request.subject)).default;
  if (!subject?.draw) {
    throw new Error(`${request.subject} must default-export a SpriteSubject`);
  }
  // The runner needs the sheet's size before it launches: `--screenshot` captures the viewport, so
  // a sheet taller than `--window-size` is cropped without a word. Hence the pure layout.
  const layout = layoutSheet(subject);
  const dom = await capture({
    entry: entrySource(request.subject, request.dpr),
    out: request.out,
    width: Math.round(layout.width * request.dpr),
    height: Math.round(layout.height * request.dpr),
    label: request.subject,
  });
  const measured = measurementsIn(dom) as Omit<SheetResult, "out"> | null;
  if (!measured) {
    throw new Error(`no measurements came back — ${request.subject} may not have drawn at all`);
  }
  return { out: request.out, ...measured };
}

function report(result: SheetResult): void {
  const { subject, dpr, sheet } = result;
  console.log(`${result.out}`);
  console.log(
    `sheet   ${sheet.width}×${sheet.height} css → ${Math.round(sheet.width * dpr)}×${Math.round(sheet.height * dpr)} px`,
  );
  console.log(
    `subject ${subject.name} · ${subject.size}px box baked at ${subject.size * dpr}px for dpr ${dpr}`,
  );
  for (const bake of result.bakes) {
    const box = bake.bounds
      ? `${bake.bounds.width}×${bake.bounds.height} at ${bake.bounds.x},${bake.bounds.y}`
      : "nothing drawn";
    console.log(
      `  facing ${bake.facing} frame ${bake.frame}  ink ${bake.ink}  grey ${bake.grey}  covers ${box}`,
    );
  }
  const covered = result.bakes.reduce((sum, b) => sum + b.ink + b.grey, 0);
  const ink = result.bakes.reduce((sum, b) => sum + b.ink, 0);
  if (covered > 0) {
    console.log(`ink is ${Math.round((ink / covered) * 100)}% of covered pixels across all bakes`);
  }
  // Two failures the picture alone hides: a bake that drew nothing, and one whose ink runs into the
  // edge of its box, which will clip against neighbours once it is blitted in the world.
  const empty = result.bakes.filter((b) => !b.bounds);
  const clipped = result.bakes.filter(
    (b) =>
      b.bounds &&
      (b.bounds.x === 0 ||
        b.bounds.y === 0 ||
        b.bounds.x + b.bounds.width === b.width ||
        b.bounds.y + b.bounds.height === b.height),
  );
  if (empty.length) console.log(`${empty.length} bake(s) drew nothing at all`);
  if (clipped.length) console.log(`${clipped.length} bake(s) touch the edge of their box`);
}

if (import.meta.main) {
  const request = parseArgs(Bun.argv.slice(2));
  const result = await renderSheet(request);
  if (request.json) console.log(JSON.stringify(result, null, 2));
  else report(result);
}
