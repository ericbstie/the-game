import { join, resolve } from "node:path";
import { damageFx } from "../src/game/damageFx";
import { MINIMAP_COVERAGE_U } from "../src/game/minimap";
import { DEMO_VIEWPORT } from "./demo-world";
import { capture, measurementsIn } from "./headless";

// Render a real frame of the game — the shipped `drawWorld`, a hand-built world, the same DPR
// transform `GameScreen` paints through — to a PNG.
//
//   bun run sprite:frame                                     # the calibration pattern as the player
//   bun run sprite:frame --sprite grunt=src/sprite/grunt.ts   # a real sprite, in a real frame
//   bun run sprite:frame --map 15600                          # the corner map at its widest level
//   bun run sprite:frame --damage 0                           # the frame a blow lands on (#142)
//   bun run sprite:frame --zoom 0.5                           # the camera zoomed out (#92)
//   bun run sprite:frame --zoom 0.5 --enemies 500             # and the worst crowd it can hold
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
const CAMERA_MODULE = join(import.meta.dir, "../src/game/camera.ts");
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
  // How long ago the blow landed, in ms — the one number the screen's swing and its black veil are
  // a function of (#142). Infinity is a frame with no blow behind it, which is what a player who
  // has never been hit carries and what every other frame this script renders has always been.
  damage: number;
  // The camera's zoom, in CSS px per world unit (#92). The PNG is the same number of pixels at
  // every value of it — it is the same screen — so what changes is how much world is in it, which
  // is the only thing a review of this can be about.
  zoom: number;
  // How many spiders the frame holds, or null for the scene's own handful. The scene is arranged to
  // show one of everything; a *crowd* is what a zoomed-out screen actually carries, and the enemy
  // cap is a dial a player can raise (#96), so the worst picture has to be askable for.
  enemies: number | null;
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
  // The screen, in CSS px — the same at every zoom, because the zoom changes how much world is in
  // the picture and never how large the picture is.
  viewport: { width: number; height: number };
  blits: Blit[];
}

export function parseArgs(argv: string[]): FrameRequest {
  const sprites: Record<string, string> = {};
  let out: string | null = null;
  let dpr = DEFAULT_DPR;
  let at: { x: number; y: number } | null = null;
  let map = MINIMAP_COVERAGE_U;
  let damage = Number.POSITIVE_INFINITY;
  let zoom = 1;
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
    } else if (arg === "--damage") {
      damage = Number(argv[++i]);
      if (!Number.isFinite(damage) || damage < 0) {
        throw new Error("--damage wants ms since the blow");
      }
    } else if (arg === "--zoom") {
      zoom = Number(argv[++i]);
      if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("--zoom must be a positive number");
    } else if (arg === "--enemies") {
      enemies = Number(argv[++i]);
      if (!Number.isInteger(enemies) || enemies <= 0) {
        throw new Error("--enemies must be a positive whole number");
      }
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
  return { sprites, out: resolve(out ?? "sprite-frame.png"), dpr, at, map, damage, zoom, enemies };
}

// The screen's swing and its veil are worked out here rather than in the page, because both are a
// pure function of one number this script already holds — so the entry states the frame it draws
// instead of re-deriving it, and a frame with no blow behind it emits the very numbers (a zero
// offset, no veil) that make it the frame this script has always rendered.
export function entrySource(request: FrameRequest, modules = MODULES): string {
  const fx = damageFx(request.damage);
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
import { DEMO_CAMERA, DEMO_GHOST, DEMO_NOW, DEMO_SELF, DEMO_VIEWPORT, demoBlood, demoBursts, demoCrowd, demoFloats, demoProjectiles, demoPuffs, demoTutorial, demoWorld } from ${JSON.stringify(modules.world)};
import { worldViewport } from ${JSON.stringify(modules.camera)};

const dpr = ${request.dpr};
const zoom = ${request.zoom};
// Device pixels per world unit — the ratio the display reports times the camera's zoom, which is
// what \`GameScreen\` folds into one number for the transform, the pixel snap and the sprite bakes.
const scale = dpr * zoom;
// How far the blow threw the view off the camera (#142). Applied to the camera the world is painted
// from and to nothing else, exactly as \`GameScreen\` applies it.
const shake = ${JSON.stringify(fx.shake)};
const at = ${JSON.stringify(request.at)} ?? DEMO_CAMERA;
const camera = { x: at.x + shake.x, y: at.y + shake.y };
// The world the screen reaches, which is the screen itself only at 1:1 (#92).
const viewport = worldViewport(DEMO_VIEWPORT, zoom);
const canvas = document.getElementById("sheet");
canvas.width = Math.round(DEMO_VIEWPORT.width * dpr);
canvas.height = Math.round(DEMO_VIEWPORT.height * dpr);
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
ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
const world = ${request.enemies === null ? "demoWorld()" : `demoCrowd(demoWorld(), ${request.enemies}, viewport)`};
// The shots in the air ride the snapshot rather than the options (#80): they are server state the
// client mirrors, like the spiders, and every client draws the same ones.
world.projectiles = demoProjectiles(world);
drawWorld(ctx, world, {
  selfId: DEMO_SELF,
  camera,
  viewport,
  dpr,
  zoom,
  // Frozen, so the two things that alternate on the clock are in their visible phase.
  now: DEMO_NOW,
  ghost: DEMO_GHOST,
  minimapCoverage: ${request.map},
  floats: demoFloats(world, DEMO_NOW),
  // On the spiders the scene has flashing, because that is the only place the game ever puts one:
  // the burst and #107's white spider come off one hit and share one lifetime (#115).
  bursts: demoBursts(world, DEMO_NOW),
  // On bare paper where spiders have died, because that is the only place the game ever puts one —
  // a puff replaces a sprite rather than annotating it (#116).
  puffs: demoPuffs(DEMO_NOW),
  // The floor's blood (#140): a trail behind the bloodling that is still running and a stain where
  // one went off. The only colour in the frame, and the only mark that is filled rather than struck,
  // so this picture is the whole channel for whether it reads against white paper at every step of
  // its fade — no sprite sheet carries it and no spy says how red is red.
  blood: demoBlood(world, DEMO_NOW),
  // How black the blow left the screen this frame (#142). Zero — the default — is a frame nobody
  // was hit on, and lays nothing at all.
  damageFlash: ${fx.flash},
  // Three of the mini-tutorial's six prompts (#134), off the shipped state machine rather than
  // hand-placed: the highlight and its words on an ore tile, a hover tooltip at the cursor, and the
  // sentence with its two inline icons over a turret. The other three are the HUD's, and the HUD is
  // not in this frame.
  tutorial: demoTutorial(world),
  // The real registry, so the frame is the game as it actually stands. Anything named on the
  // command line is layered over it — a sprite under review, or one nobody has wired yet.
  // Keyed on \`dpr × zoom\` and not on \`dpr\` (ADR 0008): a sprite is baked at the scale it is drawn
  // at and blitted 1:1, which is the whole reason the ink stays crisp at a zoom the player picked.
  // There is no settle here — nothing is gesturing, and this frame is the settled one.
  sprites: createSpriteCache({ ...SPRITES, ${table} }).source(scale),
});

document.getElementById("measurements").textContent = JSON.stringify({ dpr, viewport: DEMO_VIEWPORT, blits });
`;
}

const MODULES = {
  draw: DRAW_MODULE,
  cache: CACHE_MODULE,
  world: WORLD_MODULE,
  registry: REGISTRY_MODULE,
  camera: CAMERA_MODULE,
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
  console.log(`damage  ${request.damage} ms since the blow`);
  console.log(
    `zoom    ${request.zoom}x — ${result.viewport.width / request.zoom} x ${result.viewport.height / request.zoom} u of world in it`,
  );
  console.log(
    `enemies ${request.enemies === null ? "the scene's own" : `${request.enemies}, all on screen`}`,
  );
  console.log(`sprites ${Object.keys(request.sprites).join(", ") || "none"}`);
  console.log(`blits   ${result.blits.length}`);
  for (const blit of result.blits) {
    console.log(`  ${blit.width}×${blit.height} at ${blit.x},${blit.y}`);
  }
}
