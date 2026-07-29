import { join, resolve } from "node:path";
import { MINIMAP_COVERAGE_U } from "../src/game/minimap";
import { DEMO_VIEWPORT } from "./demo-world";
import { capture, measurementsIn } from "./headless";

// Render a real frame of the game — the shipped `drawWorld`, a hand-built world, the same DPR
// transform `GameScreen` paints through — to a PNG.
//
//   bun run sprite:frame                                     # the calibration pattern as the player
//   bun run sprite:frame --sprite grunt=src/sprite/grunt.ts   # a real sprite, in a real frame
//   bun run sprite:frame --map 15600                          # the corner map at its widest level
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
const REGISTRY_MODULE = join(import.meta.dir, "../src/sprite/registry.ts");
const WORLD_MODULE = join(import.meta.dir, "./demo-world.ts");
const DEFAULT_DPR = 2;

export interface FrameRequest {
  sprites: Record<string, string>; // sprite name → absolute path of its module
  out: string;
  dpr: number;
  // Where to put the camera, or null for the scene's own vantage. `--at 0,0` is how the room
  // wall gets looked at: it only draws along an edge the camera can actually see, so from the
  // middle of a 31,200² arena there is correctly nothing to show.
  at: { x: number; y: number } | null;
  // What the corner map is a window onto, in world units — the zoom level the player would have
  // cycled to (#110). In the same units `drawWorld` takes it, so `MINIMAP_COVERAGES` names the
  // three the key steps through and nothing here has to re-list them.
  map: number;
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
  let at: { x: number; y: number } | null = null;
  let map = MINIMAP_COVERAGE_U;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--dpr") {
      dpr = Number(argv[++i]);
      if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("--dpr must be a positive number");
    } else if (arg === "--map") {
      map = Number(argv[++i]);
      if (!Number.isFinite(map) || map <= 0) throw new Error("--map must be a positive number");
    } else if (arg === "--at") {
      const pair = (argv[++i] ?? "").split(",").map(Number);
      if (pair.length !== 2 || pair.some((n) => !Number.isFinite(n))) {
        throw new Error("--at wants x,y");
      }
      at = { x: pair[0], y: pair[1] };
    } else if (arg === "--sprite") {
      const pair = argv[++i] ?? "";
      const split = pair.indexOf("=");
      if (split <= 0) throw new Error(`--sprite wants name=path, got ${pair || "nothing"}`);
      sprites[pair.slice(0, split)] = resolve(pair.slice(split + 1));
    } else throw new Error(`unknown argument ${arg}`);
  }
  // With nothing asked for, the frame is simply the game as the registry has it. `--sprite` layers
  // a module over that: art under review, or a name nothing has drawn yet. `calibration` is the
  // harness's own test pattern and is never art — pass it explicitly to check the machinery.
  return { sprites, out: resolve(out ?? "sprite-frame.png"), dpr, at, map };
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
import { SPRITES } from ${JSON.stringify(modules.registry)};
import { DEMO_CAMERA, DEMO_GHOST, DEMO_NOW, DEMO_SELF, DEMO_VIEWPORT, demoBursts, demoFloats, demoShots, demoWorld } from ${JSON.stringify(modules.world)};

const dpr = ${request.dpr};
const camera = ${JSON.stringify(request.at)} ?? DEMO_CAMERA;
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
// Variadic on purpose: drawImage also takes a 9-argument source-rect form, and a 5-arg-only
// wrapper would silently drop the extra arguments — mis-drawing the frame as well as mismeasuring
// it. The destination is the last four either way.
ctx.drawImage = (...args) => {
  const [x, y, width, height] = args.slice(-4);
  blits.push({ x, y, width, height });
  drawImage(...args);
};

// The transform GameScreen paints the world through, unchanged.
ctx.setTransform(dpr, 0, 0, dpr, -camera.x * dpr, -camera.y * dpr);
const world = demoWorld();
drawWorld(ctx, world, {
  selfId: DEMO_SELF,
  camera,
  viewport,
  dpr,
  // Frozen, so the two things that alternate on the clock are in their visible phase.
  now: DEMO_NOW,
  ghost: DEMO_GHOST,
  minimapCoverage: ${request.map},
  shots: demoShots(world, DEMO_NOW),
  floats: demoFloats(world, DEMO_NOW),
  // On the spiders the scene has flashing, because that is the only place the game ever puts one:
  // the burst and #107's white spider come off one hit and share one lifetime (#115).
  bursts: demoBursts(world, DEMO_NOW),
  // The real registry, so the frame is the game as it actually stands. Anything named on the
  // command line is layered over it — a sprite under review, or one nobody has wired yet.
  sprites: createSpriteCache({ ...SPRITES, ${table} }).source(dpr),
});

document.getElementById("measurements").textContent = JSON.stringify({ dpr, viewport, blits });
`;
}

const MODULES = {
  draw: DRAW_MODULE,
  cache: CACHE_MODULE,
  world: WORLD_MODULE,
  registry: REGISTRY_MODULE,
};

export async function renderFrame(request: FrameRequest): Promise<FrameResult> {
  const dom = await capture({
    entry: entrySource(request),
    out: request.out,
    // From the scene itself, never a second copy of the numbers: `--screenshot` crops to the
    // window it was given and says nothing, which is the trap #77 §1 documented.
    width: Math.round(DEMO_VIEWPORT.width * request.dpr),
    height: Math.round(DEMO_VIEWPORT.height * request.dpr),
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
  console.log(`map     ${request.map} u across`);
  console.log(`sprites ${Object.keys(request.sprites).join(", ") || "none"}`);
  console.log(`blits   ${result.blits.length}`);
  for (const blit of result.blits) {
    console.log(`  ${blit.width}×${blit.height} at ${blit.x},${blit.y}`);
  }
}
