import { join, resolve } from "node:path";
import { capture, measurementsIn } from "./headless";

// Render a real frame of the game — the shipped `drawWorld`, a hand-built world, the same DPR
// transform `GameScreen` paints through — to a PNG.
//
//   bun run sprite:frame                                     # the calibration pattern as the player
//   bun run sprite:frame --sprite grunt=src/sprite/grunt.ts   # a real sprite, in a real frame
//
// #77 §6 proved this needs no server, no lobby, no socket and no play-through. It is the only
// channel that shows a sprite at the size and against the background a player actually sees it,
// and the only one that can catch a Y-sort or foot-anchor regression — a spy context records that
// a blit happened, never that it landed behind something it should have covered.
//
// The same run also reports every blit's destination, read off a real canvas, so "the sprite is
// where the draw order says it is" is a number and not an impression.

const DRAW_MODULE = join(import.meta.dir, "../src/game/draw.ts");
const CACHE_MODULE = join(import.meta.dir, "../src/sprite/cache.ts");
const WORLD_MODULE = join(import.meta.dir, "./demo-world.ts");
const CALIBRATION = join(import.meta.dir, "../src/sprite/calibration.ts");
const DEFAULT_DPR = 2;

export interface FrameRequest {
  sprites: Record<string, string>; // sprite name → absolute path of its module
  out: string;
  dpr: number;
}

export interface Blit {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameResult {
  out: string;
  dpr: number;
  viewport: { width: number; height: number };
  blits: Blit[];
}

export function parseArgs(argv: string[]): FrameRequest {
  const sprites: Record<string, string> = {};
  let out: string | null = null;
  let dpr = DEFAULT_DPR;
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
  // With nothing asked for, stand the harness's own test pattern where the player sprite goes.
  // It is not art and never ships as art — it is what proves the machinery without drawing any.
  if (Object.keys(sprites).length === 0) sprites.player = CALIBRATION;
  return { sprites, out: resolve(out ?? "sprite-frame.png"), dpr };
}

export function entrySource(request: FrameRequest, modules = MODULES): string {
  const imports = Object.keys(request.sprites)
    .map((name, i) => `import s${i} from ${JSON.stringify(request.sprites[name])};`)
    .join("\n");
  const table = Object.keys(request.sprites)
    .map((name, i) => `${JSON.stringify(name)}: s${i}`)
    .join(", ");
  return `${imports}
import { drawWorld } from ${JSON.stringify(modules.draw)};
import { createSpriteCache } from ${JSON.stringify(modules.cache)};
import { DEMO_CAMERA, DEMO_SELF, DEMO_VIEWPORT, demoWorld } from ${JSON.stringify(modules.world)};

const dpr = ${request.dpr};
const viewport = DEMO_VIEWPORT;
const canvas = document.getElementById("sheet");
canvas.width = Math.round(viewport.width * dpr);
canvas.height = Math.round(viewport.height * dpr);
// One backing-store pixel per captured pixel, so the PNG is exactly the device pixels a player at
// this ratio sees — nothing in the screenshot path can soften or sharpen a sprite.
canvas.style.width = canvas.width + "px";
canvas.style.height = canvas.height + "px";
const ctx = canvas.getContext("2d");

// Every blit, measured on a real canvas rather than inferred from a spy.
const blits = [];
const drawImage = ctx.drawImage.bind(ctx);
ctx.drawImage = (image, x, y, width, height) => {
  blits.push({ x, y, width, height });
  drawImage(image, x, y, width, height);
};

// The transform GameScreen paints the world through, unchanged.
ctx.setTransform(dpr, 0, 0, dpr, -DEMO_CAMERA.x * dpr, -DEMO_CAMERA.y * dpr);
drawWorld(ctx, demoWorld(), {
  selfId: DEMO_SELF,
  camera: DEMO_CAMERA,
  viewport,
  dpr,
  sprites: createSpriteCache({ ${table} }).source(dpr),
});

document.getElementById("measurements").textContent = JSON.stringify({ dpr, viewport, blits });
`;
}

const MODULES = { draw: DRAW_MODULE, cache: CACHE_MODULE, world: WORLD_MODULE };

export async function renderFrame(request: FrameRequest): Promise<FrameResult> {
  const dom = await capture({
    entry: entrySource(request),
    out: request.out,
    width: Math.round(800 * request.dpr),
    height: Math.round(600 * request.dpr),
    label: "the world frame",
  });
  const measured = measurementsIn(dom) as Omit<FrameResult, "out"> | null;
  if (!measured) throw new Error("no measurements came back — the frame may not have drawn at all");
  return { out: request.out, ...measured };
}

if (import.meta.main) {
  const request = parseArgs(Bun.argv.slice(2));
  const result = await renderFrame(request);
  console.log(result.out);
  console.log(
    `frame   ${result.viewport.width}×${result.viewport.height} css at dpr ${result.dpr}`,
  );
  console.log(`sprites ${Object.keys(request.sprites).join(", ") || "none"}`);
  console.log(`blits   ${result.blits.length}`);
  for (const blit of result.blits) {
    console.log(`  ${blit.width}×${blit.height} at ${blit.x},${blit.y}`);
  }
}
