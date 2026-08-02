import { describe, expect, test } from "bun:test";
import type {
  Avatar,
  BuildableKind,
  OreKind,
  RenderedEnemy,
  RenderedProjectile,
  Tile,
  Vec2,
  WorldSnapshot,
} from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import lettering from "../sprite/lettering";
import type { SpriteName } from "../sprite/registry";
import { BLOOD_FADE_MS, type BloodMark } from "./blood";
import { TILE, tileKey, tileOf } from "./build";
import { type Camera, type Viewport, worldViewport } from "./camera";
import {
  ClientWorld,
  DEATH_RETENTION_MS,
  ENEMY_RENDER_DELAY_MS,
  HIT_FLASH_MS,
  type Mark,
} from "./clientWorld";
import {
  BLOOD,
  BLOOD_BANDS,
  BURST_MS,
  type DrawOptions,
  drawWorld,
  grassAt,
  letteringAt,
  PUFF_MS,
  SHOT_STREAK,
} from "./draw";
import { MARKER_INSET } from "./edgeMarker";
import { FLOAT_MS, type MetalFloat } from "./floats";
import { inkPuff, starburst } from "./fx";
import {
  MINIMAP_COVERAGE_CLOSE_U,
  MINIMAP_COVERAGE_U,
  MINIMAP_COVERAGES,
  MINIMAP_MARGIN,
  MINIMAP_ORE_CELL_U,
  MINIMAP_SIZE,
  minimapWindow,
  nextMinimapCoverage,
  projectRect,
} from "./minimap";
import { METAL_WORDS, MINE_WORDS, TURRET_WORDS, type TutorialMarks } from "./tutorial";
import { distanceToExit, escapeTally, squadEscaped } from "./world";
import { DEFAULT_WORLD_SETTINGS } from "./worldSettings";

// happy-dom returns null from getContext('2d'), so the draw path is exercised against a
// spy that records the calls and lets any property be assigned.
// The drawing state a call went out under is recorded with it, because from M5 on that state *is*
// the message for two of the things drawn here: the ghost says "you cannot place this" in opacity
// alone, and the health bar's two fills differ only in colour and extent.
interface Call {
  fn: string;
  args: unknown[];
  alpha: number;
  fill: unknown;
  stroke: unknown;
  composite: unknown;
  // The type a written call went out in. Recorded for the same reason the fills are: for #152's
  // escape count the size *is* part of the message — it is screen-fixed chrome, so it has to grow
  // in world units as the camera zooms out, and nothing about its position can say that.
  font: unknown;
}
const SPY_CHAR_WIDTH = 6;

function spyCtx() {
  const calls: Call[] = [];
  let ctx: Record<string, unknown>;
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({
        fn,
        args,
        alpha: (ctx.globalAlpha as number | undefined) ?? 1,
        fill: ctx.fillStyle,
        stroke: ctx.strokeStyle,
        composite: ctx.globalCompositeOperation ?? "source-over",
        font: ctx.font,
      });
    };
  ctx = {
    calls,
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillText: record("fillText"),
    strokeText: record("strokeText"),
    drawImage: record("drawImage"),
    closePath: record("closePath"),
    // The minimap holds its layers inside its plate with a clip, so the spy has to carry the
    // path-and-state calls that takes. They are recorded like everything else and restore nothing:
    // a spy has no drawing state to unwind, and nothing here leans on it having one.
    save: record("save"),
    restore: record("restore"),
    rect: record("rect"),
    clip: record("clip"),
    // The tutorial's sentences wrap (#134), so the draw path asks the context how wide a word is.
    // A fixed width per character rather than a real font metric: the layout under test is which
    // words land on which line, and a spy that measured nothing could not have any.
    measureText: (text: string) => ({ width: text.length * SPY_CHAR_WIDTH }),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

// The stroked paths in a frame, each as the segments it was built from. A shot is one path of
// several strands (#114), so this is what tells a bundle from the run of separate lines M5 drew.
const paths = (ctx: { calls: Call[] }) => {
  const drawn: { from: [number, number]; to: [number, number] }[][] = [];
  let path: { from: [number, number]; to: [number, number] }[] | null = null;
  let at: [number, number] | null = null;
  for (const c of ctx.calls) {
    if (c.fn === "beginPath") path = [];
    else if (c.fn === "moveTo") at = c.args as [number, number];
    else if (c.fn === "lineTo" && path && at)
      path.push({ from: at, to: c.args as [number, number] });
    else if (c.fn === "stroke" && path?.length) {
      drawn.push(path);
      path = null;
    }
  }
  return drawn;
};

// The filled polygons in a frame, in world coordinates, with the state each went out under. An
// off-screen teammate's arrow is the only multi-point path `drawWorld` fills — a circle is an `arc`
// and a shot line is two points and never filled — so this reads the arrows off the log.
const polygons = (ctx: { calls: Call[] }) => {
  const drawn: { points: [number, number][]; alpha: number; fill: unknown }[] = [];
  let points: [number, number][] = [];
  for (const c of ctx.calls) {
    if (c.fn === "beginPath") points = [];
    else if (c.fn === "moveTo" || c.fn === "lineTo") points.push(c.args as [number, number]);
    else if (c.fn === "fill" && points.length > 2) {
      drawn.push({ points, alpha: c.alpha, fill: c.fill });
    }
  }
  return drawn;
};

// A sprite source standing in for baked art: every requested name resolves, and each image is
// tagged so a call log says *which* sprite was blitted and in what order. Sprites the game has
// not been given fall through to the shapes it has drawn since M2, which is what a name left out
// of `boxes` reproduces.
// A rim wider than the one production bakes, and a number nothing in `draw.ts` knows: the flash
// blit's destination has to come off the sprite it was handed, never be worked out again there.
const STUB_FLASH_RIM = 3;

function stubSprites(boxes: Partial<Record<SpriteName, number>>): SpriteSource {
  return (name, facing, frame, variant = "ink") => {
    const size = boxes[name];
    if (size === undefined) return null;
    const flash = variant === "flash";
    const tag = flash ? `${name}/${facing}/${frame}/flash` : `${name}/${facing}/${frame}`;
    return {
      image: { tag } as unknown as CanvasImageSource,
      size: flash ? size + 2 * STUB_FLASH_RIM : size,
    } satisfies BakedSprite;
  };
}

// Where the corner map begins in a frame's log. `drawWorld` puts it up after everything in the
// world, so this is the seam between an assertion about the arena and an assertion about the map.
// Everything the world layer claims is counted below it, or the map's own marks would answer for it.
//
// The plate is found by walking back from the map's clip — the only one a frame makes — rather than
// forward to the first fill at the plate's size. Forward, a 200 px viewport would match the floor
// fill instead, and every world-layer assertion built on `worldCalls` would go on passing against an
// empty log.
// `plate` is the map's side in *world* units, which is `MINIMAP_SIZE` only at 1:1 — the map is
// chrome and holds its size on screen, so a zoomed frame draws it into a different world box (#92).
const mapStart = (ctx: { calls: Call[] }, plate = MINIMAP_SIZE) => {
  for (let i = ctx.calls.findIndex((c) => c.fn === "clip"); i >= 0; i--) {
    const c = ctx.calls[i];
    if (c.fn === "fillRect" && c.args[2] === plate && c.args[3] === plate) return i;
  }
  return ctx.calls.length;
};
const worldCalls = (ctx: { calls: Call[] }) => ctx.calls.slice(0, mapStart(ctx));
const mapCalls = (ctx: { calls: Call[] }) => ctx.calls.slice(mapStart(ctx));

const blits = (ctx: { calls: Call[] }) =>
  ctx.calls
    .filter((c) => c.fn === "drawImage")
    .map((c) => ({
      tag: (c.args[0] as { tag: string }).tag,
      x: c.args[1] as number,
      y: c.args[2] as number,
      width: c.args[3] as number,
      height: c.args[4] as number,
    }));
// Facing, walk frame and whether the hit flash is up are all derived in ClientWorld, not here —
// drawWorld reads them off the snapshot, so any value serves these fixtures.
const POSE = { facing: 2, frame: 0, flashing: false };

const world: WorldSnapshot = {
  arena: { width: 31_200, height: 31_200 },
  projectiles: [],
  players: [
    { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 100 },
    { ...POSE, id: "p2", slot: 2, name: "Ben", pos: { x: 1200, y: 1150 }, radius: 14, hp: 100 },
  ],
  enemies: [],
  nests: [
    { id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, maxHp: 600, hp: 600, alive: true },
    { id: "n2", pos: { x: 20_000, y: 20_000 }, radius: 48, maxHp: 600, hp: 600, alive: true }, // off-screen
  ],
  exit: { x: 0, y: 1100, width: 98, height: 936 },
  exitRevealed: false,
  ore: new Map(),
  structures: [],
};

const viewport: Viewport = { width: 800, height: 600 };
const camera: Camera = { x: 1000, y: 1000 }; // shows the two avatars + n1, not n2

describe("drawWorld", () => {
  test("clears and fills only the viewport region, not the whole arena", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    const clear = ctx.calls.find((c) => c.fn === "clearRect");
    expect(clear?.args).toEqual([1000, 1000, 800, 600]);
    // the background fill covers the viewport, never the 31,200² arena
    expect(
      ctx.calls.some((c) => c.fn === "fillRect" && c.args[2] === 800 && c.args[3] === 600),
    ).toBe(true);
  });

  // The exit had a flat `#39d353` rectangle here through M4. #76 grants exactly two colours and
  // neither is that one, and the `room` sprite now draws the door as the variant its wall run
  // switches to where it crosses the exit — so the rectangle went, rather than being restyled.
  test("no longer paints a fallback rectangle over the exit", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    expect(
      ctx.calls.some((c) => c.fn === "fillRect" && c.args[0] === 0 && c.args[1] === 1100),
    ).toBe(false);
  });

  test("culls entities outside the viewport", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    // Both avatars + n1 are on screen; n2 (20,000, 20,000) is culled.
    const arcs = ctx.calls.filter((c) => c.fn === "arc").length;
    expect(arcs).toBe(3);
  });

  test("labels each on-screen avatar with its name", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    const labels = ctx.calls.filter((c) => c.fn === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("Ana");
    expect(labels).toContain("Ben");
  });

  test("rings the self avatar", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { selfId: "p1", camera, viewport });
    // self ring adds a stroke() beyond the arena wall's strokeRect
    expect(ctx.calls.filter((c) => c.fn === "stroke").length).toBeGreaterThan(0);
  });

  test("draws on-screen enemies and culls off-screen ones", () => {
    const ctx = spyCtx();
    const withEnemies: WorldSnapshot = {
      ...world,
      enemies: [
        { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1150 }, radius: 16, hp: 30 },
        { ...POSE, id: "e2", kind: "grunt", pos: { x: 25_000, y: 25_000 }, radius: 16, hp: 30 },
      ],
    };
    drawWorld(ctx, withEnemies, { camera, viewport });
    // 2 avatars + n1 + one on-screen enemy = 4 arcs; the far enemy is culled.
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(4);
  });

  // M2 faded a downed player to a 0.35-alpha corpse. #81 replaced that outright: the character
  // vanishes instantly, and what marks the death is the screen darkening below.
  test("a dead player vanishes — no body, no name, no marker", () => {
    const ctx = spyCtx();
    const downed: WorldSnapshot = {
      ...world,
      players: [
        { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 0 },
      ],
      nests: [],
    };
    drawWorld(ctx, downed, { selfId: "p1", camera, viewport });
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(0);
    expect(ctx.calls.filter((c) => c.fn === "fillText").length).toBe(0);
  });

  test("darkens only the dying player's own screen, and only while they are down", () => {
    const dim = (selfId: string, hp: number) => {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        {
          ...world,
          players: [
            { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp },
            {
              ...POSE,
              id: "p2",
              slot: 2,
              name: "Ben",
              pos: { x: 1200, y: 1150 },
              radius: 14,
              hp: 100,
            },
          ],
          nests: [],
        },
        { selfId, camera, viewport },
      );
      // The viewport-sized fill the paper always lays down is one; a second is the darkening.
      return ctx.calls.filter((c) => c.fn === "fillRect" && c.args[2] === 800 && c.args[3] === 600)
        .length;
    };
    expect(dim("p1", 0)).toBe(2); // Ana is down and this is Ana's screen
    expect(dim("p2", 0)).toBe(1); // Ben sees Ana gone and nothing else
    expect(dim("p1", 100)).toBe(1);
  });

  test("draws a silenced (dead) nest in its dimmed colour", () => {
    const ctx = spyCtx();
    const withDeadNest: WorldSnapshot = {
      ...world,
      nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, maxHp: 600, hp: 0, alive: false }],
    };
    drawWorld(ctx, withDeadNest, { camera, viewport });
    // The dead nest still draws (one arc) — the colour change is what reads as "silenced".
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(3); // 2 avatars + the dead nest
  });
});

// Everything above pins the shapes the game has drawn since M2, and it all still holds: a sprite
// that has not landed falls back to its circle or rectangle. What follows pins the sprite path
// itself. A blit is the one thing a call log records perfectly — which image, where, in what
// order — so the Y-sort and the foot anchor are asserted the same way, against a stub source.
describe("drawWorld with sprites", () => {
  const standing: WorldSnapshot = {
    ...world,
    players: [
      { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 100 },
      { ...POSE, id: "p2", slot: 2, name: "Ben", pos: { x: 1200, y: 1150 }, radius: 14, hp: 100 },
    ],
    enemies: [{ ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1200 }, radius: 16, hp: 30 }],
    nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, maxHp: 600, hp: 600, alive: true }],
  };
  const everything = { nest: 96, player: 28, grunt: 32, elite: 48, miner: 30, generator: 75 };

  test("paints in Y order, so whatever is lower on screen paints in front", () => {
    const ctx = spyCtx();
    drawWorld(ctx, standing, { camera, viewport, sprites: stubSprites(everything) });
    // By category — the old order — this would be nest, grunt, player, player. By floor line it
    // is nest 1090, player 1100, player 1150, grunt 1200.
    expect(blits(ctx).map((b) => b.tag)).toEqual([
      "nest/0/0",
      "player/2/0",
      "player/2/0",
      "grunt/2/0",
    ]);
  });

  test("anchors an upright sprite at its feet, not at its centre", () => {
    const ctx = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [standing.players[0]],
      enemies: [],
      nests: [],
    };
    drawWorld(ctx, one, { camera, viewport, sprites: stubSprites(everything) });
    // The avatar stands at (1100, 1100): its 28 px box is centred on x and sits *above* y.
    expect(blits(ctx)[0]).toEqual({ tag: "player/2/0", x: 1086, y: 1072, width: 28, height: 28 });
  });

  test("centres a spider on its position rather than standing it on the box's bottom edge", () => {
    const ctx = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [],
      nests: [],
      enemies: [
        { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1200 }, radius: 16, hp: 30 },
      ],
    };
    drawWorld(ctx, one, { camera, viewport, sprites: stubSprites(everything) });
    // A spider's legs splay flat *around* it, so the ring of legs is what meets the floor and its
    // centre is the position the sim owns. Foot-anchoring would put y at 1168 and lift the body a
    // full radius clear of where contact damage is actually judged.
    expect(blits(ctx)[0]).toEqual({ tag: "grunt/2/0", x: 1134, y: 1184, width: 32, height: 32 });
  });

  test("blits into the logical box, leaving the bake's device pixels to the DPR transform", () => {
    const ctx = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [standing.players[0]],
      enemies: [],
      nests: [],
    };
    drawWorld(ctx, one, { camera, viewport, dpr: 3, sprites: stubSprites(everything) });
    const blit = blits(ctx)[0];
    expect([blit.width, blit.height]).toEqual([28, 28]); // never 28 × 3
  });

  test("snaps a blit to whole device pixels, so a fractional position cannot resample it", () => {
    const ctx = spyCtx();
    const drifting: WorldSnapshot = {
      ...standing,
      players: [
        {
          ...POSE,
          id: "p1",
          slot: 1,
          name: "Ana",
          pos: { x: 1100.4, y: 1100.7 },
          radius: 14,
          hp: 100,
        },
      ],
      enemies: [],
      nests: [],
    };
    drawWorld(ctx, drifting, { camera, viewport, dpr: 2, sprites: stubSprites(everything) });
    const blit = blits(ctx)[0];
    expect((blit.x - camera.x) * 2).toBe(173);
    expect((blit.y - camera.y) * 2).toBe(145);
  });

  test("turns image smoothing off, every frame, because resizing the canvas resets it", () => {
    const ctx = spyCtx();
    ctx.imageSmoothingEnabled = true; // what a freshly resized backing store leaves behind
    drawWorld(ctx, standing, { camera, viewport, sprites: stubSprites(everything) });
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  test("a building's box is exactly its footprint", () => {
    const ctx = spyCtx();
    const built: WorldSnapshot = {
      ...standing,
      players: [],
      enemies: [],
      nests: [],
      structures: [{ id: "b1", kind: "miner", tile: { tx: 74, ty: 74 }, hp: 200 }],
    };
    drawWorld(ctx, built, { camera, viewport, sprites: stubSprites(everything) });
    expect(blits(ctx)[0]).toEqual({ tag: "miner/0/0", x: 1110, y: 1110, width: 30, height: 30 });
  });

  test("the flat generator stays under everything that stands, whatever its floor line", () => {
    const ctx = spyCtx();
    const powered: WorldSnapshot = {
      ...standing,
      players: [],
      enemies: [],
      // The nest's floor line (1010) is far above the generator's (1125), so a single sorted pass
      // would paint the generator over it. Drawn flat, it belongs to the floor instead.
      nests: [
        { id: "n1", pos: { x: 1100, y: 1010 }, radius: 48, maxHp: 600, hp: 600, alive: true },
      ],
      structures: [{ id: "b1", kind: "generator", tile: { tx: 70, ty: 70 }, hp: 300 }],
    };
    drawWorld(ctx, powered, { camera, viewport, sprites: stubSprites(everything) });
    expect(blits(ctx).map((b) => b.tag)).toEqual(["generator/0/0", "nest/0/0"]);
  });

  test("a silenced nest asks for the destroyed variant of the one egg-sac sprite", () => {
    const ctx = spyCtx();
    const silenced: WorldSnapshot = {
      ...standing,
      players: [],
      enemies: [],
      nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, maxHp: 600, hp: 0, alive: false }],
    };
    drawWorld(ctx, silenced, { camera, viewport, sprites: stubSprites(everything) });
    expect(blits(ctx)[0].tag).toBe("nest/1/0");
  });

  test("an entity whose sprite has not landed keeps the shape it has had since M2", () => {
    const ctx = spyCtx();
    drawWorld(ctx, standing, { camera, viewport, sprites: stubSprites({ player: 28 }) });
    expect(blits(ctx).map((b) => b.tag)).toEqual(["player/2/0", "player/2/0"]);
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(2); // the nest and the grunt
  });

  test("asks for the facing and walk frame the entity is actually in", () => {
    const ctx = spyCtx();
    const walking: WorldSnapshot = {
      ...standing,
      players: [{ ...standing.players[0], facing: 5, frame: 1 }],
      enemies: [{ ...standing.enemies[0], facing: 7, frame: 1 }],
      nests: [],
    };
    drawWorld(ctx, walking, { camera, viewport, sprites: stubSprites(everything) });
    expect(blits(ctx).map((b) => b.tag)).toEqual(["player/5/1", "grunt/7/1"]);
  });

  test("marks your own avatar over its body, not in a puddle at its ankles", () => {
    const ctx = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [standing.players[0]],
      enemies: [],
      nests: [],
    };
    drawWorld(ctx, one, {
      selfId: "p1",
      camera,
      viewport,
      sprites: stubSprites({ ...everything, halo: 40 }),
    });
    const halo = blits(ctx).find((b) => b.tag.startsWith("halo"));
    // The avatar stands at y 1100 in a 28 px box, so its body centres on 1086 — and the 40 px halo
    // hangs off that centre rather than off the feet.
    expect(halo).toEqual({ tag: "halo/0/0", x: 1080, y: 1066, width: 40, height: 40 });
  });

  test("paints the halo behind the avatar, so a glow does not veil the face", () => {
    const ctx = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [standing.players[0]],
      enemies: [],
      nests: [],
    };
    drawWorld(ctx, one, {
      selfId: "p1",
      camera,
      viewport,
      sprites: stubSprites({ ...everything, halo: 40 }),
    });
    expect(blits(ctx).map((b) => b.tag)).toEqual(["halo/0/0", "player/2/0"]);
  });

  test("drops the stand-in ring once the halo sprite exists", () => {
    const withHalo = spyCtx();
    const one: WorldSnapshot = {
      ...standing,
      players: [standing.players[0]],
      enemies: [],
      nests: [],
    };
    const options = { selfId: "p1", camera, viewport };
    drawWorld(withHalo, one, { ...options, sprites: stubSprites({ ...everything, halo: 40 }) });
    expect(worldCalls(withHalo).filter((c) => c.fn === "stroke").length).toBe(0);

    const withoutHalo = spyCtx();
    drawWorld(withoutHalo, one, { ...options, sprites: stubSprites(everything) });
    expect(worldCalls(withoutHalo).filter((c) => c.fn === "stroke").length).toBe(1);
  });

  test("flags a turret holding a target it has no power to fire on", () => {
    const engaged = { powered: false, targetId: "e1" };
    const cases: [string, { powered: boolean; targetId: string | null }, number][] = [
      ["engaged and unpowered", engaged, 1],
      ["engaged and powered", { powered: true, targetId: "e1" }, 0],
      // An idle turret is unpowered too, and has nothing to complain about.
      ["idle", { powered: false, targetId: null }, 0],
    ];
    for (const [why, turret, expected] of cases) {
      const ctx = spyCtx();
      const defended: WorldSnapshot = {
        ...standing,
        players: [],
        enemies: [],
        nests: [],
        structures: [{ id: "b1", kind: "turret", tile: { tx: 74, ty: 74 }, hp: 250, turret }],
      };
      drawWorld(ctx, defended, {
        camera,
        viewport,
        sprites: stubSprites({ ...everything, unpowered: 24 }),
      });
      const lightning = blits(ctx).filter((b) => b.tag.startsWith("unpowered"));
      expect({ why, count: lightning.length }).toEqual({ why, count: expected });
    }
  });

  test("flashes the lightning off the injected clock rather than reading one", () => {
    const at = (now: number) => {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        {
          ...standing,
          players: [],
          enemies: [],
          nests: [],
          structures: [
            {
              id: "b1",
              kind: "turret",
              tile: { tx: 74, ty: 74 },
              hp: 250,
              turret: { powered: false, targetId: "e1" },
            },
          ],
        },
        { camera, viewport, now, sprites: stubSprites({ ...everything, unpowered: 24 }) },
      );
      return blits(ctx).find((b) => b.tag.startsWith("unpowered"))?.tag;
    };
    expect(at(0)).toBe("unpowered/0/0");
    expect(at(500)).toBe("unpowered/0/1");
    expect(at(900)).toBe("unpowered/0/2");
  });

  test("draws ore a tile at a time once its sprite lands, and in runs before that", () => {
    const ore = new Map<number, "metal" | "power">();
    for (let tx = 70; tx < 74; tx++) ore.set(tileKey({ tx, ty: 70 }), "metal");
    const bare: WorldSnapshot = { ...standing, players: [], enemies: [], nests: [], ore };

    const flat = spyCtx();
    drawWorld(flat, bare, { camera, viewport, sprites: stubSprites(everything) });
    // One run of four tiles, merged into a single fill — the path the game has always used.
    expect(flat.calls.some((c) => c.fn === "fillRect" && c.args[2] === 60)).toBe(true);

    const drawn = spyCtx();
    drawWorld(drawn, bare, {
      camera,
      viewport,
      sprites: stubSprites({ ...everything, "ore-metal": 15 }),
    });
    const tiles = blits(drawn).filter((b) => b.tag.startsWith("ore-metal"));
    expect(tiles.length).toBe(4);
    expect(tiles[0]).toMatchObject({ x: 1050, y: 1050, width: 15, height: 15 });
  });

  test("scatters ore variants from the tile coordinate, so every client sees one field", () => {
    const ore = new Map<number, "metal" | "power">();
    for (let tx = 70; tx < 76; tx++) ore.set(tileKey({ tx, ty: 70 }), "metal");
    const seeded: WorldSnapshot = { ...standing, players: [], enemies: [], nests: [], ore };
    const variants = () => {
      const ctx = spyCtx();
      drawWorld(ctx, seeded, {
        camera,
        viewport,
        sprites: stubSprites({ ...everything, "ore-metal": 15 }),
      });
      return blits(ctx).map((b) => b.tag);
    };
    expect(variants()).toEqual(variants()); // same tiles, same field, every time
    expect(new Set(variants()).size).toBeGreaterThan(1); // and not all the same tile
  });

  // The variant packs two facts (#87). The **cell** is `(tx mod 12) * 12 + (ty mod 12)`, not a
  // hash: a hash is uniform but tells a tile nothing about who it sits next to, so every mark
  // stays boxed in its own cell and a measurable ink deficit forms on the grid pitch. Position
  // lets a tile derive its neighbours' cells and draw a mark that straddles a seam identically
  // from both sides. The **mask** says which of the four neighbours hold the same ore, which is
  // the only thing that distinguishes an interior edge — where ink must cross — from a boundary
  // one, where it must be held back.
  describe("an ore tile's variant", () => {
    const patch = (from: number, to: number) => {
      const ore = new Map<number, "metal" | "power">();
      for (let ty = from; ty < to; ty++)
        for (let tx = from; tx < to; tx++) ore.set(tileKey({ tx, ty }), "metal");
      return ore;
    };
    const tagsFor = (ore: Map<number, "metal" | "power">) => {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        { ...standing, players: [], enemies: [], nests: [], ore },
        { camera, viewport, sprites: stubSprites({ ...everything, "ore-metal": 15 }) },
      );
      return (tx: number, ty: number) =>
        blits(ctx).find((b) => b.x === tx * 15 && b.y === ty * 15)?.tag;
    };
    const packed = (mask: number, tx: number, ty: number) =>
      `ore-metal/${mask * 144 + (tx % 12) * 12 + (ty % 12)}/0`;

    test("carries its position cell, by the exact formula rather than merely distinctly", () => {
      const at = tagsFor(patch(70, 78));
      expect(at(72, 73)).toBe(packed(15, 72, 73)); // buried: all four neighbours present
      expect(at(72, 73)).not.toBe(at(73, 73)); // neighbours never share a cell
      expect(at(72, 73)).not.toBe(at(72, 74));
    });

    test("carries which neighbours hold the same ore, so an edge knows which kind it is", () => {
      const at = tagsFor(patch(70, 78));
      expect(at(70, 70)).toBe(packed(2 | 4, 70, 70)); // north-west corner: east and south only
      expect(at(77, 77)).toBe(packed(1 | 8, 77, 77)); // south-east corner: north and west only
      expect(at(74, 70)).toBe(packed(2 | 4 | 8, 74, 70)); // north edge: everything but north
    });

    test("a lone tile is all boundary, and reads as mask 0", () => {
      const ore = new Map<number, "metal" | "power">([[tileKey({ tx: 72, ty: 73 }), "metal"]]);
      expect(tagsFor(ore)(72, 73)).toBe(packed(0, 72, 73));
    });

    test("a neighbour of the other ore kind is not a neighbour", () => {
      const ore = patch(70, 78);
      ore.set(tileKey({ tx: 73, ty: 73 }), "power"); // punch a hole of the wrong kind
      expect(tagsFor(ore)(72, 73)).toBe(packed(15 & ~2, 72, 73)); // east is open again
    });
  });

  test("tiles the room's wall along the edges the camera can see, and nowhere else", () => {
    const ctx = spyCtx();
    const corner: Camera = { x: 0, y: 0 }; // against the north-west corner
    const room: WorldSnapshot = {
      ...standing,
      players: [],
      enemies: [],
      nests: [],
      ore: new Map(),
    };
    drawWorld(ctx, room, {
      camera: corner,
      viewport,
      sprites: stubSprites({ ...everything, room: 30 }),
    });
    const segments = blits(ctx).filter((b) => b.tag.startsWith("room"));
    const north = segments.filter((b) => b.tag === "room/0/0" && b.y === 0);
    const west = segments.filter((b) => b.tag === "room/3/0" && b.x === 0);
    expect(north.length).toBe(Math.ceil(viewport.width / 30));
    expect(west.length).toBeGreaterThan(0);
    // The far edges of a 31,200² arena are nowhere near this corner.
    expect(segments.some((b) => b.tag === "room/1/0" || b.tag === "room/2/0")).toBe(false);
  });

  test("switches the wall run to the door where it crosses the exit", () => {
    const ctx = spyCtx();
    const room: WorldSnapshot = {
      ...standing,
      players: [],
      enemies: [],
      nests: [],
      ore: new Map(),
      exit: { x: 0, y: 60, width: 98, height: 60 },
    };
    drawWorld(ctx, room, {
      camera: { x: 0, y: 0 },
      viewport,
      sprites: stubSprites({ ...everything, room: 30 }),
    });
    // The exit sits on the west edge, so the door carries that edge: ROOM_DOOR (4) + ROOM_WEST (3).
    // A single shared door tile cannot work — the wall's profile is asymmetric top to bottom, so an
    // orientation-free tile is invariant under a vertical flip and cannot match both ends.
    const doors = blits(ctx).filter((b) => b.tag === "room/7/0");
    expect(doors.map((d) => d.y)).toEqual([60, 90]); // the two segments the exit spans
    expect(blits(ctx).some((b) => b.tag === "room/4/0")).toBe(false); // never the edgeless door
  });

  test("keeps the M2 outline until the room sprite lands", () => {
    const ctx = spyCtx();
    drawWorld(ctx, standing, { camera, viewport, sprites: stubSprites(everything) });
    expect(ctx.calls.some((c) => c.fn === "strokeRect" && c.args[0] === 2)).toBe(true);
  });

  test("keeps drawing a sprite whose feet have left the viewport but whose body has not", () => {
    const reaching: WorldSnapshot = {
      ...standing,
      players: [],
      nests: [],
      // 20 below the bottom edge (1600). A 32 px grunt anchored at its feet still covers 1588—1600,
      // so culling on the radius alone — 16 — would pop it out while it is a third on screen.
      enemies: [
        { ...POSE, id: "e1", kind: "grunt", pos: { x: 1400, y: 1620 }, radius: 16, hp: 30 },
      ],
    };
    const ctx = spyCtx();
    drawWorld(ctx, reaching, { camera, viewport, sprites: stubSprites(everything) });
    expect(blits(ctx).length).toBe(1);

    const gone = spyCtx();
    drawWorld(
      gone,
      { ...reaching, enemies: [{ ...reaching.enemies[0], pos: { x: 1400, y: 1640 } }] },
      { camera, viewport, sprites: stubSprites(everything) },
    );
    expect(blits(gone).length).toBe(0);
  });
});

// A buildable wall is drawn from a 4-bit mask of which sides another wall abuts — 1 north, 2 east,
// 4 south, 8 west — carried on the sprite's facing axis. The sprite draws a cut masonry face on
// every side the mask leaves clear and nothing at all on the others, so a mask that is wrong by one
// bit is a seam, or a brick face buried inside a solid mass. It is pinned here rather than looked
// at, because sixteen variants is exactly the size of set where an eye stops checking.
describe("a wall's neighbour mask", () => {
  const NORTH = 1;
  const EAST = 2;
  const SOUTH = 4;
  const WEST = 8;
  // Tile-space, not world-space: a wall is 2×2 tiles, so a butted neighbour is two tiles away.
  const at = (tx: number, ty: number, kind: BuildableKind = "wall") =>
    ({ id: `${kind}-${tx}-${ty}`, kind, tile: { tx, ty }, hp: 400 }) as const;

  // Keyed by the tile a blit landed on rather than by collection order: buildings paint in Y order,
  // so the sorted pass reorders them and an index would quietly pair a facing with the wrong wall.
  const facings = (structures: WorldSnapshot["structures"]) => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...world, players: [], nests: [], structures },
      {
        camera,
        viewport,
        sprites: stubSprites({ wall: 30, miner: 30, turret: 30, generator: 75 }),
      },
    );
    return Object.fromEntries(
      blits(ctx).map((b) => [`${b.x / 15}-${b.y / 15}`, Number(b.tag.split("/")[1])]),
    );
  };

  test("leaves a wall standing on its own with all four faces cut", () => {
    expect(facings([at(70, 70)])).toEqual({ "70-70": 0 });
  });

  test("bares only the faces a run covers", () => {
    expect(facings([at(70, 70), at(72, 70), at(74, 70)])).toEqual({
      "70-70": EAST,
      "72-70": EAST | WEST,
      "74-70": WEST,
    });
  });

  test("runs down the screen as well as across", () => {
    expect(facings([at(70, 70), at(70, 72), at(70, 74)])).toEqual({
      "70-70": SOUTH,
      "70-72": NORTH | SOUTH,
      "70-74": NORTH,
    });
  });

  test("gives an L's corner both its neighbours and keeps the other two faces bricked", () => {
    // The corner is at (70,70) with an arm running east and an arm running south.
    expect(facings([at(70, 70), at(72, 70), at(70, 72)])).toEqual({
      "70-70": EAST | SOUTH,
      "72-70": WEST,
      "70-72": NORTH,
    });
  });

  test("buries a wall with a neighbour on every side", () => {
    const ring = [at(70, 70), at(68, 70), at(72, 70), at(70, 68), at(70, 72)];
    expect(facings(ring)["70-70"]).toBe(NORTH | EAST | SOUTH | WEST);
  });

  test("counts a neighbour a tile out of step, which per-tile placement allows", () => {
    // Nothing snaps a wall to its own footprint: these two butt along part of a face while their
    // origins are one tile apart, and the join is real even though `tx ± 2` would not find it.
    expect(facings([at(70, 70), at(72, 71)])).toEqual({
      "70-70": EAST,
      "72-71": WEST,
    });
  });

  test("counts only walls — another building butted against one is not a neighbour", () => {
    expect(facings([at(70, 70), at(72, 70, "miner")])).toEqual({ "70-70": 0, "72-70": 0 });
  });

  test("leaves every other buildable on facing 0, walled in or not", () => {
    const drawn = facings([
      at(70, 70, "turret"),
      at(68, 70),
      at(72, 70),
      at(70, 68),
      at(70, 72),
      at(80, 80, "generator"),
      at(78, 80),
    ]);
    expect(drawn["70-70"]).toBe(0); // the turret, walled in on all four sides
    expect(drawn["80-80"]).toBe(0); // the generator, with a wall against its west face
  });

  test("gives the ghost the mask too, so it previews the join it will make", () => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...world, players: [], nests: [], structures: [at(72, 70)] },
      {
        camera,
        viewport,
        sprites: stubSprites({ wall: 30 }),
        ghost: { kind: "wall", tile: { tx: 70, ty: 70 }, valid: true },
      },
    );
    // The standing wall paints first and keeps all four faces — the ghost is not a structure and
    // does not change one. The ghost, drawn last, bares the face it will join along.
    expect(blits(ctx).map((b) => b.tag)).toEqual(["wall/0/0", `wall/${EAST}/0`]);
  });

  test("sees a neighbour the camera culled, so a run does not grow a face at the viewport edge", () => {
    const ctx = spyCtx();
    // The second wall is thousands of units off screen to the east of the first — but they are
    // butted, and the drawn one must still know its east face is covered.
    drawWorld(
      ctx,
      { ...world, players: [], nests: [], structures: [at(120, 70), at(122, 70)] },
      { camera, viewport, sprites: stubSprites({ wall: 30 }) },
    );
    expect(blits(ctx).map((b) => b.tag)).toEqual([`wall/${EAST}/0`]);
  });
});

// The floor's own scatter. Its density is a decision (#72) rather than an implementation detail —
// it is what the grass sprite was drawn against and what the frame budget was measured at — so it
// is pinned here, where changing the hash or the period fails loudly instead of quietly redressing
// the whole game.
describe("the grass scatter", () => {
  test("is derived from the tile alone, so every client scatters the identical field", () => {
    for (const [tx, ty] of [
      [0, 0],
      [37, 812],
      [2079, 2079],
      [1040, 1040],
    ]) {
      expect(grassAt(tx, ty)).toEqual(grassAt(tx, ty));
    }
  });

  test("falls one tuft per 12 tiles, the density the art was judged at", () => {
    let tufts = 0;
    const side = 400; // 160,000 tiles — enough that the rate is the hash's and not the sample's
    for (let ty = 0; ty < side; ty++) {
      for (let tx = 0; tx < side; tx++) if (grassAt(tx, ty)) tufts++;
    }
    expect(tufts / (side * side)).toBeCloseTo(1 / 12, 2);
  });

  test("puts a tuft inside the tile that chose it, which is what bounds the viewport walk", () => {
    for (let ty = 0; ty < 60; ty++) {
      for (let tx = 0; tx < 60; tx++) {
        const tuft = grassAt(tx, ty);
        if (!tuft) continue;
        expect(tuft.x).toBeGreaterThanOrEqual(tx * 15);
        expect(tuft.x).toBeLessThan((tx + 1) * 15);
        expect(tuft.y).toBeGreaterThanOrEqual(ty * 15);
        expect(tuft.y).toBeLessThan((ty + 1) * 15);
      }
    }
  });

  test("costs nothing at all until the grass sprite lands", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, sprites: stubSprites({ player: 28 }) });
    expect(blits(ctx).every((b) => !b.tag.startsWith("grass/"))).toBe(true);
  });

  test("covers the viewport and paints under everything that stands on it", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, sprites: stubSprites({ grass: 8, player: 28 }) });
    const painted = blits(ctx);
    const grass = painted.filter((b) => b.tag.startsWith("grass/"));

    // ~2,450 tiles fall in the walk at this viewport, so one per 12 is roughly 200 tufts. A wide
    // band, because the exact count is the hash's business — the point is that it is a scatter and
    // not a lawn, and not three stray marks.
    expect(grass.length).toBeGreaterThan(120);
    expect(grass.length).toBeLessThan(320);
    // Nothing standing may be painted before the floor it stands on.
    expect(painted.findIndex((b) => b.tag.startsWith("player/"))).toBeGreaterThan(
      painted.findLastIndex((b) => b.tag.startsWith("grass/")),
    );
    // Several distinct variants, or the field is one drawing repeated.
    expect(new Set(grass.map((b) => b.tag)).size).toBeGreaterThan(1);
  });

  // A tuft hangs off the point that chose it and reaches a whole box above it, so the walk has to
  // run outside the viewport by as much as the tuft is tall or one pops in at the edge as the
  // camera moves. #106 took the box to 0.8×, and the walk has to follow the sprite the source hands
  // back rather than any extent written down beside it.
  test("walks outside the viewport by as much as the tuft the source hands back is tall", () => {
    // The tile that chose each tuft, recovered from where its box was blitted — the box hangs off
    // the point's bottom centre, so this reads back the walk itself rather than the size of what it
    // put down. Reading the blit's own left edge would move with the box and pass without a walk.
    const reached = (box: number) => {
      const ctx = spyCtx();
      drawWorld(ctx, world, { camera, viewport, sprites: stubSprites({ grass: box }) });
      const tiles = blits(ctx)
        .filter((b) => b.tag.startsWith("grass/"))
        .map((b) => ({ tx: Math.floor((b.x + box / 2) / 15), ty: Math.floor((b.y + box) / 15) }));
      return {
        tx: Math.min(...tiles.map((t) => t.tx)),
        ty: Math.min(...tiles.map((t) => t.ty)),
      };
    };
    const small = reached(8); // the shipped box
    const tall = reached(45); // three tiles, so the walk has to reach three tiles further out
    expect(tall.tx).toBeLessThan(small.tx);
    expect(tall.ty).toBeLessThan(small.ty);
  });
});

// The damage readout, and the only one there is: #81 gives it to enemies, peers and structures
// alike, withholds it from anything at full health, and refuses structures any damage state of
// their own — so a bar that fails to appear is the whole feedback loop failing to appear.
describe("health bars", () => {
  // Two axis-aligned fills per bar: the ink frame, four px tall, and the paper knocked back out of
  // its two-px interior. Nothing else in the frame fills a rect that short, so the height alone
  // identifies each, and counting the frames counts the bars.
  const bars = (ctx: { calls: Call[] }) =>
    ctx.calls.filter((c) => c.fn === "fillRect" && c.args[3] === 4);
  const knockouts = (ctx: { calls: Call[] }) =>
    ctx.calls.filter((c) => c.fn === "fillRect" && c.args[3] === 2);
  const bare = { ...world, players: [], enemies: [], nests: [], structures: [] };
  const ana = { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14 };
  const drawn = (patch: Partial<WorldSnapshot>) => {
    const ctx = spyCtx();
    drawWorld(ctx, { ...bare, ...patch }, { camera, viewport });
    return { frames: bars(ctx), interiors: knockouts(ctx) };
  };

  test("shows nothing at all while everything is at full health", () => {
    expect(
      drawn({
        players: [{ ...ana, hp: 100 }],
        enemies: [
          { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1150 }, radius: 16, hp: 30 },
        ],
        structures: [{ id: "b1", kind: "wall", tile: { tx: 74, ty: 74 }, hp: 400 }],
      }).frames,
    ).toEqual([]);
  });

  test("shows one on an enemy, a peer and a structure the moment each is damaged", () => {
    expect(
      drawn({
        enemies: [
          { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1150 }, radius: 16, hp: 29 },
        ],
      }).frames.length,
    ).toBe(1);
    expect(drawn({ players: [{ ...ana, hp: 99 }] }).frames.length).toBe(1);
    expect(
      drawn({ structures: [{ id: "b1", kind: "wall", tile: { tx: 74, ty: 74 }, hp: 399 }] }).frames
        .length,
    ).toBe(1);
  });

  // The elite's 120 HP is full for nothing in the set — 60% of an elite, four times a grunt's whole
  // health — so a bar read off one shared maximum would be wrong for one kind or for both.
  test("judges 'full' per enemy kind, not against a shared number", () => {
    const at = (kind: "grunt" | "elite", hp: number, radius: number) =>
      drawn({ enemies: [{ ...POSE, id: "e1", kind, pos: { x: 1150, y: 1150 }, radius, hp }] })
        .frames.length;
    expect(at("grunt", 30, 16)).toBe(0);
    expect(at("elite", 30, 24)).toBe(1); // the same number, and a badly wounded elite
    expect(at("elite", 200, 24)).toBe(0);
  });

  // #88 §2: #81 granted bars to "enemies, peers and structures". A nest is none of those three, so
  // it got none — and a nest is the longest single fight in the game, and the one readout with real
  // tactical weight, since killing one is how the pressure around it drops. The bar is scaled
  // against the nest's own `maxHp`, which since #123 varies with how far out it sits.
  test("shows one on a damaged nest — the longest fight in the game had no progress at all", () => {
    const nest = { id: "n1", pos: { x: 1150, y: 1150 }, radius: 48, maxHp: 600, alive: true };
    expect(drawn({ nests: [{ ...nest, hp: 600 }] }).frames).toEqual([]); // untouched, as ever
    const { frames, interiors } = drawn({ nests: [{ ...nest, hp: 300 }] });
    expect(frames.length).toBe(1);
    expect(frames[0].args[2]).toBe(96); // the nest's own width, like every other bar
    expect(interiors[0].args[2]).toBe(47); // half the 94 interior px
  });

  // The nest twin of the elite/grunt test above, and the one #123 made necessary: an inner nest is
  // worth 150 and an outer one 600, so a bar read off a shared 600 would draw an untouched inner
  // nest as three-quarters dead.
  test("judges a nest against its own maxHp, not a shared ceiling", () => {
    const inner = { id: "n1", pos: { x: 1150, y: 1150 }, radius: 48, maxHp: 150, alive: true };
    expect(drawn({ nests: [{ ...inner, hp: 150 }] }).frames).toEqual([]); // full, so no bar at all
    const { interiors } = drawn({ nests: [{ ...inner, hp: 75 }] });
    expect(interiors[0].args[2]).toBe(47); // half of the 94 interior px, on its own 150
  });

  test("a silenced nest shows none — it is wreckage, not a fight in progress", () => {
    expect(
      drawn({
        nests: [
          { id: "n1", pos: { x: 1150, y: 1150 }, radius: 48, maxHp: 600, hp: 0, alive: false },
        ],
      }).frames,
    ).toEqual([]);
  });

  test("spends the bar's length on what is left, inside an ink frame that never shrinks", () => {
    const { frames, interiors } = drawn({
      enemies: [
        { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1150 }, radius: 16, hp: 15 },
      ],
    });
    const [frame] = frames;
    const [lost] = interiors;
    expect(frame.args[2]).toBe(32); // the grunt's own width
    expect(lost.args[2]).toBe(15); // half of the 30 interior px
    expect(frame.fill).not.toBe(lost.fill); // ink under paper, so the frame survives any health
    expect(frame.args[1]).toBe(1150 - 16 - 3 - 4); // clear of the top of the drawing
    expect(lost.args[1]).toBe((frame.args[1] as number) + 1);
  });
});

// A name over a head is on ADR 0001's short allowlist, so it has to survive a floor that is now
// white paper and a set of sprites that are now solid ink. Two ways it did not, both found in a
// rendered frame once the halo shipped.
describe("name labels", () => {
  const two: WorldSnapshot = {
    ...world,
    enemies: [],
    nests: [],
    structures: [],
  };
  const sprites = stubSprites({ player: 28, halo: 52 });

  test("cuts the name out of whatever is under it, rather than laying black on black", () => {
    const ctx = spyCtx();
    drawWorld(ctx, two, { camera, viewport, selfId: "p1", sprites });
    const stroked = ctx.calls.filter((c) => c.fn === "strokeText");
    const filled = ctx.calls.filter((c) => c.fn === "fillText");
    expect(stroked.map((c) => c.args[0])).toEqual(["Ana", "Ben"]);
    // Paper under ink, and the outline laid down first so the fill sits inside it.
    expect(stroked.every((c) => c.stroke === "#ffffff")).toBe(true);
    expect(filled.every((c) => c.fill === "#000")).toBe(true);
    expect(ctx.calls.indexOf(stroked[0])).toBeLessThan(ctx.calls.indexOf(filled[0]));
  });

  // The halo is centred on the *body* — half a sprite above `pos` — and is nearly twice the
  // player's width, so it reaches higher than the figure does. A label offset by the sprite's own
  // height lands inside it.
  test("clears the halo's reach, not just the sprite's", () => {
    const ctx = spyCtx();
    drawWorld(ctx, two, { camera, viewport, selfId: "p1", sprites });
    const label = ctx.calls.find((c) => c.fn === "fillText" && c.args[0] === "Ana");
    const haloTop = 1100 - 28 / 2 - 52 / 2; // bodyY − half the halo box
    expect(label?.args[2]).toBeLessThan(haloTop);
  });

  // #88 §4: the UI ships Playfair Display on every screen, but this label is drawn by `drawWorld`
  // and kept the system font — the only text in the game not in the game's typeface.
  test("is set in the game's own typeface, like every other word in it", () => {
    const ctx = spyCtx();
    drawWorld(ctx, two, { camera, viewport, selfId: "p1", sprites });
    expect(ctx.font).toContain("Playfair Display");
  });

  // The offset alone is not enough: a squadmate 7–40 px above you still paints their body — and
  // their halo — after your label if labels ride the Y-sort.
  test("paints every name after every avatar, so no halo can cover a squadmate's", () => {
    const ctx = spyCtx();
    drawWorld(ctx, two, { camera, viewport, selfId: "p1", sprites });
    const lastBlit = ctx.calls.findLastIndex((c) => c.fn === "drawImage");
    const firstLabel = ctx.calls.findIndex((c) => c.fn === "strokeText");
    expect(firstLabel).toBeGreaterThan(lastBlit);
  });
});

// #81 makes a refused placement a matter of opacity and nothing else — no second colour, no cross,
// no outline. The ghost through M4 was a green or red 0.45-alpha rectangle, which said the same
// thing three ways and in two colours #76 never granted.
describe("the build ghost", () => {
  const ghosting = (valid: boolean) => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...world, players: [], nests: [], structures: [] },
      {
        camera,
        viewport,
        sprites: stubSprites({ wall: 30 }),
        ghost: { kind: "wall", tile: { tx: 74, ty: 74 }, valid },
      },
    );
    return ctx.calls.filter((c) => c.fn === "drawImage");
  };

  test("draws the building itself, near-solid where it can be placed", () => {
    const [ghost] = ghosting(true);
    expect((ghost.args[0] as { tag: string }).tag).toBe("wall/0/0");
    expect(ghost.alpha).toBeGreaterThan(0.5);
    // #88 §1: taken literally, "full opacity when valid" made a valid ghost pixel-identical to a
    // placed building — a player lining a wall up against an existing one could not tell the
    // preview from the real thing without moving the cursor. Held back just enough to read as a
    // preview, which keeps validity a matter of opacity and adds no second channel.
    expect(ghost.alpha).toBeLessThan(1);
  });

  test("fades it further, and only fades it, where it cannot", () => {
    const [ghost] = ghosting(false);
    expect((ghost.args[0] as { tag: string }).tag).toBe("wall/0/0");
    expect(ghost.alpha).toBeGreaterThan(0);
    expect(ghost.alpha).toBeLessThan(ghosting(true)[0].alpha as number);
  });

  test("says nothing about validity beyond that", () => {
    const shape = (valid: boolean) => ghosting(valid).map((c) => [c.args.slice(1), c.fill]);
    expect(shape(true)).toEqual(shape(false));
  });
});

// A shot in the air, for your own, your squadmates' and your turrets' alike (#80). M5 struck a line
// from the shooter to what it hit and #114 broke that into speed lines; a projectile is a streak
// behind a moving point, struck by the same pen.
//
// Two constraints shape every test here. The frame may draw no shot the server did not put in the
// air — which after #80 is a property of `WorldSnapshot.projectiles` having one source rather than
// of any gate in this file — and hundreds of them are in flight at once, so what a bullet costs the
// frame is pinned rather than assumed.
describe("shots in flight", () => {
  const grunt = {
    ...POSE,
    id: "e1",
    kind: "grunt" as const,
    pos: { x: 1300, y: 1200 },
    radius: 16,
  };
  const field: WorldSnapshot = {
    ...world,
    players: [],
    enemies: [{ ...grunt, hp: 30 }],
    nests: [],
    structures: [],
  };
  const flying = (projectiles: RenderedProjectile[], patch: Partial<WorldSnapshot> = {}) => {
    const ctx = spyCtx();
    drawWorld(ctx, { ...field, ...patch, projectiles }, { camera, viewport, now: 1000 });
    return ctx;
  };
  // One stroke is one bullet: at `SHOT_STREAK` the fit puts a single unbroken stroke across the
  // whole mark, so the frame's one bundled path reads straight back as its list of shots.
  const streaks = (ctx: { calls: Call[] }) => paths(ctx)[0] ?? [];
  const inFlight = (id: string, from: Vec2, pos: Vec2): RenderedProjectile => ({ id, from, pos });

  test("a bullet is struck as a streak behind the point it has reached", () => {
    const head = { x: 1400, y: 1100 };
    const [mark] = streaks(flying([inFlight("s1", { x: 1100, y: 1100 }, head)]));
    expect(mark.to).toEqual([head.x, head.y]);
    expect(mark.from).toEqual([head.x - SHOT_STREAK, head.y]);
  });

  test("and clipped at its launch point, so nothing sticks out behind the gun that fired it", () => {
    const head = { x: 1110, y: 1100 };
    const [mark] = streaks(flying([inFlight("s1", { x: 1100, y: 1100 }, head)]));
    expect(mark.from).toEqual([1100, 1100]);
    expect(mark.to).toEqual([head.x, head.y]);
  });

  test("a bullet still on the muzzle strikes nothing at all", () => {
    const at = { x: 1100, y: 1100 };
    expect(paths(flying([inFlight("s1", at, { ...at })]))).toEqual([]);
  });

  // The cost control. A hitscan line lived 100 ms and the frame carried ~50; a flight lives 389 ms
  // and it carries several hundred, so the count of paths has to stay at one however many are up.
  test("every shot in the frame goes out in one path, however many are in the air", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      inFlight(`s${i}`, { x: 1000 + i, y: 1000 }, { x: 1200 + i, y: 1000 }),
    );
    const drawn = paths(flying(many));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toHaveLength(40);
  });

  test("a shot the camera cannot see strikes nothing — the cull is spent before the geometry", () => {
    expect(paths(flying([inFlight("s1", { x: 9000, y: 9000 }, { x: 9200, y: 9000 })]))).toEqual([]);
  });

  // The #85 property at the render layer, and the whole of it: this file has no other source for a
  // shot. There is no own-shot input, no turret pulse train and no ammo gate left to disagree with
  // the server about — a bullet is drawn because the world snapshot carries one.
  test("costs nothing when the world has no shots in the air", () => {
    expect(paths(flying([]))).toEqual([]);
  });
});

// A spider turns white for a split second when it takes damage (#107). The floor is white paper, so
// the flash cannot be a white spider: it is the ink bake inverted with a rim of ink left standing,
// derived once as its own cached variant rather than composited into every frame. What the draw layer
// owes is therefore small and exact — wear the variant for the pose the spider is in, in one blit,
// landed where the ink bake would have gone. Whether the rim *reads* is a question for the eye, and
// `bun run sprite:frame` is where it is asked.
describe("the hit flash", () => {
  const grunt = (over: Partial<RenderedEnemy>): WorldSnapshot => ({
    ...world,
    players: [],
    nests: [],
    // Wounded, so the health bar is in the picture and cannot be mistaken for part of the flash.
    enemies: [
      { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150, y: 1200 }, radius: 16, hp: 12, ...over },
    ],
  });
  const flash = (flashing: boolean, dpr = 2) => {
    const ctx = spyCtx();
    drawWorld(ctx, grunt({ flashing }), {
      camera,
      viewport,
      dpr,
      sprites: stubSprites({ grunt: 32 }),
    });
    return ctx;
  };
  // Where a grunt's 32 px box lands when it is centred on (1150, 1200) …
  const CENTRE = { x: 1134, y: 1184 };
  // … and the wider box its flash variant has to land in to stay centred on the same point.
  const FLASH_BOX = 32 + 2 * STUB_FLASH_RIM;
  const FLASH_CENTRE = { x: 1150 - FLASH_BOX / 2, y: 1200 - FLASH_BOX / 2 };

  test("an unhurt spider is one plain blit of the ink bake", () => {
    expect(blits(flash(false))).toEqual([{ tag: "grunt/2/0", ...CENTRE, width: 32, height: 32 }]);
  });

  // The destination is the whole of it, not just that a blit happened. A box of the wrong size or off
  // its centre resamples the bake and drags the silhouette off the ink one it stands in for — and
  // #107's first attempt hid a see-through hole through every flashing spider behind exactly that
  // gap in the assertions.
  test("a hit spider is one blit of the flash variant, in its own box, on the same centre", () => {
    expect(blits(flash(true))).toEqual([
      { tag: "grunt/2/0/flash", ...FLASH_CENTRE, width: FLASH_BOX, height: FLASH_BOX },
    ]);
  });

  test("in logical px, so the rim is the same weight on a retina display", () => {
    for (const dpr of [1, 2, 3]) {
      expect(blits(flash(true, dpr))).toEqual([
        { tag: "grunt/2/0/flash", ...FLASH_CENTRE, width: FLASH_BOX, height: FLASH_BOX },
      ]);
    }
  });

  test("the variant is the one for the pose the spider is standing in", () => {
    const ctx = spyCtx();
    drawWorld(ctx, grunt({ facing: 5, frame: 1, flashing: true }), {
      camera,
      viewport,
      dpr: 2,
      sprites: stubSprites({ grunt: 32 }),
    });
    expect(blits(ctx).map((b) => b.tag)).toEqual(["grunt/5/1/flash"]);
  });

  // The old mechanism dilated, punched and back-filled in nine blits and two mode switches, at ~70 µs
  // a spider — and left the context in a mode the health bar after it had to survive. A derived bake
  // is none of that, and this is what says so.
  test("touches no compositing mode: the flash is a blit like any other", () => {
    expect(flash(true).calls.every((c) => c.composite === "source-over")).toBe(true);
  });

  test("hangs the health bar off the plain box, so it does not hop as the flash comes and goes", () => {
    const bar = (ctx: { calls: Call[] }) =>
      ctx.calls.filter((c) => c.fn === "fillRect").map((c) => c.args.slice(0, 4));
    expect(bar(flash(true))).toEqual(bar(flash(false)));
  });

  test("costs nothing when a sprite has not landed: the M2 shape is unchanged", () => {
    const ctx = spyCtx();
    drawWorld(ctx, grunt({ flashing: true }), { camera, viewport, sprites: stubSprites({}) });
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(1);
    expect(ctx.calls.every((c) => c.composite === "source-over")).toBe(true);
  });
});

// #115: a starburst where a shot connects. The render layer holds no state here either — it is
// handed the marks whose sprites have already caught up with them (`ClientWorld.impactMarks`) and
// strikes one burst at each. What is left to pin is the ink: one path for the whole frame's worth,
// nothing struck for a mark the camera cannot see, and the burst laid over the bodies rather than
// sorted among them.
describe("the starburst on impact", () => {
  const HIT: Vec2 = { x: 1_300, y: 1_200 };
  const spiders: WorldSnapshot = {
    ...world,
    players: [],
    nests: [],
    structures: [],
    enemies: [{ ...POSE, id: "e1", kind: "grunt", pos: HIT, radius: 16, hp: 12 }],
  };
  const burst = (marks: readonly Mark[], patch: Partial<WorldSnapshot> = {}) => {
    const ctx = spyCtx();
    drawWorld(ctx, { ...spiders, ...patch }, { camera, viewport, now: 1000, bursts: marks });
    return ctx;
  };
  const spikes = (at: Vec2) =>
    starburst(at).map((s) => ({
      from: [s.from.x, s.from.y] as [number, number],
      to: [s.to.x, s.to.y] as [number, number],
    }));

  // The burst and the white spider under it are one event told twice, so they are timed off one
  // number. Two lifetimes would read as two events on a single hit — the stacking #78 asks to be
  // read together rather than piled up.
  test("stays up exactly as long as the white spider it is struck on", () => {
    expect(BURST_MS).toBe(HIT_FLASH_MS);
  });

  test("strikes the star `fx.ts` lays out, centred on the mark, in ink", () => {
    const ctx = burst([{ pos: HIT, at: 900 }]);
    expect(paths(ctx)).toEqual([spikes(HIT)]);
    // The floor is white paper (#72), so the one colour a mark on it may not be is the paper's.
    expect(ctx.calls.filter((c) => c.fn === "stroke").map((c) => c.stroke)).toEqual(["#000"]);
  });

  // Every burst in the frame rides one path. A shot is charged per stroke and this fires on every
  // connect rather than on every death (`docs/frame-budget.md` rule 1), so the count of paths is the
  // one thing about it that must not scale with the count of bursts.
  test("the whole frame's bursts go out in a single stroke", () => {
    const ctx = burst([
      { pos: HIT, at: 900 },
      { pos: { x: 1_120, y: 1_150 }, at: 940 },
      { pos: { x: 1_400, y: 1_080 }, at: 980 },
    ]);
    expect(ctx.calls.filter((c) => c.fn === "stroke").length).toBe(1);
    expect(paths(ctx)[0].length).toBe(starburst(HIT).length * 3);
  });

  test("costs the frame nothing at all when nothing has been hit", () => {
    const bare = spyCtx();
    drawWorld(bare, spiders, { camera, viewport, now: 1000 });
    // Not "no stroke" but *no call*: a frame in which nothing was hit has to be the identical frame
    // to one the render layer never handed a burst list at all, down to the opened path.
    expect(burst([]).calls.map((c) => c.fn)).toEqual(bare.calls.map((c) => c.fn));
    expect(bare.calls.filter((c) => c.fn === "stroke")).toEqual([]);
  });

  // Hits stream for the whole arena, not for the part of it the camera happens to be over, so most
  // marks in a wave belong to a fight nobody is looking at. Culled before the geometry is built, so
  // one of those costs the frame no strokes rather than eight it throws away.
  test("strikes nothing for a mark the camera cannot see", () => {
    expect(paths(burst([{ pos: { x: 9_000, y: 9_000 }, at: 900 }]))).toEqual([]);
  });

  // Over the Y-sort, like a shot line and for the same reason: a burst is an event between two
  // things rather than a thing standing on the floor, and one half-hidden behind the spider it
  // belongs to says nothing.
  test("is struck over the bodies, never sorted among them", () => {
    const ctx = burst([{ pos: HIT, at: 900 }], {});
    const blitted = ctx.calls.map((c) => c.fn).lastIndexOf("arc");
    expect(ctx.calls.map((c) => c.fn).indexOf("stroke")).toBeGreaterThan(blitted);
  });
});

// #116: an ink puff where an enemy dies. The render layer holds no state here either — it is handed
// the marks whose enemies are already off the screen (`ClientWorld.deathMarks`) and strikes one
// cloud at each. What is left to pin is the ink: one path for the whole frame's worth, nothing
// struck for a mark the camera cannot see, and the puff laid over the bodies rather than among them.
describe("the ink puff on death", () => {
  const FELL: Vec2 = { x: 1_300, y: 1_200 };
  // The spider that died is deliberately *not* in the world — a puff and the sprite it replaces are
  // never in one frame, which is the whole shape of the ticket. One live grunt stands beside it so
  // the draw order below has a body to be judged against.
  const spiders: WorldSnapshot = {
    ...world,
    players: [],
    nests: [],
    structures: [],
    enemies: [
      { ...POSE, id: "e1", kind: "grunt", pos: { x: 1_100, y: 1_150 }, radius: 16, hp: 12 },
    ],
  };
  const sprites = stubSprites({ grunt: 32 });
  const puff = (marks: readonly Mark[], patch: Partial<WorldSnapshot> = {}) => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...spiders, ...patch },
      { camera, viewport, now: 1000, sprites, puffs: marks },
    );
    return ctx;
  };
  // Every arc the frame struck, as the numbers `ctx.arc` was handed.
  const arcs = (ctx: { calls: Call[] }) =>
    ctx.calls.filter((c) => c.fn === "arc").map((c) => c.args as number[]);
  const cloud = (at: Vec2) => inkPuff(at).map((l) => [l.at.x, l.at.y, l.radius, l.from, l.to]);

  // The retention window is a memory bound and never a lifetime (#74 §5), so it has to clear any
  // life this layer asks for — a mark pruned while it is still being drawn pops off mid-frame.
  test("is up for less time than the buffer that holds it", () => {
    expect(PUFF_MS).toBeLessThan(DEATH_RETENTION_MS);
  });

  test("strikes the cloud `fx.ts` lays out, centred on the mark, in ink", () => {
    const ctx = puff([{ pos: FELL, at: 900 }]);
    expect(arcs(ctx)).toEqual(cloud(FELL));
    // The floor is white paper (#72), so the one colour a mark on it may not be is the paper's.
    expect(ctx.calls.filter((c) => c.fn === "stroke").map((c) => c.stroke)).toEqual(["#000"]);
  });

  // The lobes chain into one outline in `fx.ts`, and that only reaches the paper if the path is
  // opened once per puff. A `moveTo` before every lobe would break the outline into six arcs that
  // meet at butt ends instead of joining, and the seam would show as a notch at every scallop.
  test("each puff is one closed outline, opened once and closed at the end", () => {
    const ctx = puff([{ pos: FELL, at: 900 }]);
    const marks = ctx.calls.filter((c) => ["moveTo", "arc", "closePath"].includes(c.fn));
    expect(marks.map((c) => c.fn)).toEqual([
      "moveTo",
      ...inkPuff(FELL).map(() => "arc"),
      "closePath",
    ]);
  });

  // Every puff in the frame rides one path, the way every burst does. A wave clear is many deaths on
  // one tick, so this is the one thing about the mark that must not scale with the count.
  test("the whole frame's puffs go out in a single stroke", () => {
    const one = puff([{ pos: FELL, at: 900 }]);
    const three = puff([
      { pos: FELL, at: 900 },
      { pos: { x: 1_120, y: 1_150 }, at: 940 },
      { pos: { x: 1_400, y: 1_080 }, at: 980 },
    ]);
    expect(three.calls.filter((c) => c.fn === "stroke").length).toBe(1);
    expect(arcs(three).length).toBe(inkPuff(FELL).length * 3);
    // Counted against the single-puff frame rather than asserted flat, because the frame opens paths
    // for other things too. A path opened per puff would still stroke once and still lay every arc —
    // and on a real canvas only the last cloud would survive to reach the paper.
    const opened = (c: { calls: Call[] }) => c.calls.filter((k) => k.fn === "beginPath").length;
    expect(opened(three)).toBe(opened(one));
  });

  test("costs the frame nothing at all when nothing has died", () => {
    const bare = spyCtx();
    drawWorld(bare, spiders, { camera, viewport, now: 1000, sprites });
    // Not "no stroke" but *no call*: a frame in which nothing died has to be the identical frame to
    // one the render layer never handed a puff list at all, down to the opened path.
    expect(puff([]).calls.map((c) => c.fn)).toEqual(bare.calls.map((c) => c.fn));
    expect(bare.calls.filter((c) => c.fn === "stroke")).toEqual([]);
  });

  // Deaths stream for the whole arena, not for the part of it the camera happens to be over, so most
  // of a wave's puffs belong to a fight nobody is looking at. Culled before the geometry is built.
  test("strikes nothing for a mark the camera cannot see", () => {
    expect(arcs(puff([{ pos: { x: 9_000, y: 9_000 }, at: 900 }]))).toEqual([]);
  });

  // Over the Y-sort, like a shot line and a burst. A puff stands in for a body rather than being
  // one, and one sorted in among them would be buried by whatever is standing in front of the gap.
  test("is struck over the bodies, never sorted among them", () => {
    const ctx = puff([{ pos: FELL, at: 900 }]);
    const bodies = ctx.calls.map((c) => c.fn).lastIndexOf("drawImage");
    expect(bodies).toBeGreaterThan(-1);
    expect(ctx.calls.map((c) => c.fn).indexOf("stroke")).toBeGreaterThan(bodies);
  });
});

// #79: a hand-lettered word popping over a hit and over a death, in the style of the era. The render
// layer holds no state here either, and it holds no *lifetime* either: the word rides the very marks
// #115's burst and #116's puff already ride, so it is judged on the delayed clock the spiders are
// drawn against without this layer ever seeing that delay.
//
// What is left to pin is that the word is a **blit** and not a written word, that it is aimed at the
// mark, that it keeps off the one damage readout the game has, and that the word a mark gets is the
// same word every frame it is up.
describe("the lettered word over a hit and a death", () => {
  const MARK: Vec2 = { x: 1_300, y: 1_200 };
  const spiders: WorldSnapshot = {
    ...world,
    players: [],
    nests: [],
    structures: [],
    enemies: [{ ...POSE, id: "e1", kind: "grunt", pos: MARK, radius: 16, hp: 12 }],
  };
  const sprites = stubSprites({ grunt: 32, lettering: lettering.size });
  const frame = (options: Partial<DrawOptions> = {}, patch: Partial<WorldSnapshot> = {}) => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...spiders, ...patch },
      {
        camera,
        viewport,
        now: 1_000,
        sprites,
        ...options,
      },
    );
    return ctx;
  };
  const words = (ctx: { calls: Call[] }) =>
    blits(ctx).filter((b) => b.tag.startsWith("lettering/"));

  test("blits a word centred on the blow when a shot connects", () => {
    const drawn = words(frame({ bursts: [{ pos: MARK, at: 900 }] }));
    expect(drawn.length).toBe(1);
    expect({ x: drawn[0].x, y: drawn[0].y, width: drawn[0].width }).toEqual({
      x: MARK.x - lettering.size / 2,
      y: MARK.y - lettering.size / 2,
      width: lettering.size,
    });
  });

  // The other half of the ask, and the half that has no burst of its own to sit on: a death is
  // #116's mark, and the word rides it exactly as it rides a hit's.
  test("blits one where an enemy died as well", () => {
    expect(words(frame({ puffs: [{ pos: MARK, at: 900 }] })).length).toBe(1);
    expect(
      words(frame({ bursts: [{ pos: MARK, at: 900 }], puffs: [{ pos: MARK, at: 900 }] })).length,
    ).toBe(2);
  });

  // **The Verify box ADR 0001's grant turns on.** The exception is for four drawings, not for a
  // typeface in the arena, so a lettered frame has to add no text draw at all — counted against the
  // same frame without the marks rather than asserted flat, because a player's name is written in
  // every frame and is on the allowlist already.
  test("adds no text draw to the world pass: the word is a bake, never a writing", () => {
    const wrote = (ctx: { calls: Call[] }) =>
      worldCalls(ctx).filter((c) => c.fn === "fillText" || c.fn === "strokeText").length;
    const lettered = frame({ bursts: [{ pos: MARK, at: 900 }], puffs: [{ pos: MARK, at: 940 }] });
    expect(words(lettered).length).toBe(2);
    expect(wrote(lettered)).toBe(wrote(frame()));
  });

  // A word that changed between frames would flicker through the whole set over its own lifetime,
  // and one word for every mark would be a set of four wearing one label. Both are properties of
  // `letteringAt`, so both are pinned on it rather than on a frame.
  test("gives one mark one word for as long as it is up, and does not give every mark the same one", () => {
    expect(letteringAt(MARK, 900)).toBe(letteringAt({ ...MARK }, 900));
    // Both halves of the mark have to reach the word, and each is the case the other cannot cover.
    // Every hit in one delta shares an `at` (`ClientWorld.applyMapDelta`), so a word off the instant
    // alone letters a whole wave identically; and one mark keeps its position for its whole life
    // while `at` never moves, so a word off the position alone letters every blow on one spider the
    // same. Counted in words rather than in hashes — the wrap is what the player sees.
    const across = new Set<number>();
    const over = new Set<number>();
    for (let i = 0; i < 200; i++) {
      across.add(letteringAt({ x: 1_000 + i * 7, y: 1_200 - i * 3 }, 900) % lettering.facings);
      over.add(letteringAt(MARK, 900 + i * 50) % lettering.facings);
    }
    expect(across.size).toBe(lettering.facings);
    expect(over.size).toBe(lettering.facings);
  });

  // Hits and deaths stream for the whole arena rather than for the part of it the camera is over, so
  // most of a wave's words belong to a fight nobody is watching. Culled before the sprite is asked
  // for (rule 3).
  test("blits nothing for a mark the camera cannot see", () => {
    const away = { pos: { x: 9_000, y: 9_000 }, at: 900 };
    expect(words(frame({ bursts: [away], puffs: [away] }))).toEqual([]);
  });

  // Not "no blit" but *no call*: a frame in which nothing was hit and nothing died has to be the
  // identical frame to one that has never heard of lettering at all. Held against two frames rather
  // than one, because they close different holes — a mark list the layer was never given, and the art
  // being absent from the registry. A layer that opened a path or set a style before finding it had
  // nothing to draw would pass the first and fail the second.
  test("costs the frame nothing at all when nothing has been hit or died", () => {
    const empty = frame({ bursts: [], puffs: [] }).calls.map((c) => c.fn);
    expect(empty).toEqual(frame().calls.map((c) => c.fn));
    const unlettered = spyCtx();
    drawWorld(unlettered, spiders, {
      camera,
      viewport,
      now: 1_000,
      sprites: stubSprites({ grunt: 32 }),
      bursts: [],
      puffs: [],
    });
    expect(empty).toEqual(unlettered.calls.map((c) => c.fn));
  });

  // The one thing this layer must never fall back to. Every other entity keeps the M2 shape it drew
  // before its sprite landed; a word has no shape, and the shape it would reach for is `fillText`.
  test("draws nothing at all when the art has not landed", () => {
    const ctx = spyCtx();
    drawWorld(ctx, spiders, {
      camera,
      viewport,
      now: 1_000,
      sprites: stubSprites({ grunt: 32 }),
      bursts: [{ pos: MARK, at: 900 }],
      puffs: [{ pos: MARK, at: 900 }],
    });
    expect(words(ctx)).toEqual([]);
    expect(ctx.calls.filter((c) => c.fn === "fillText")).toEqual([]);
  });

  // Over the Y-sort, like a shot line, a burst and a puff: the word is about an event rather than a
  // thing standing on the floor, and one sorted in behind the spider it belongs to says nothing.
  test("is blitted over the bodies, never sorted among them", () => {
    const ctx = frame({ bursts: [{ pos: MARK, at: 900 }] });
    const tags = blits(ctx).map((b) => b.tag);
    expect(tags.lastIndexOf("grunt/2/0")).toBeLessThan(
      tags.findIndex((t) => t.startsWith("lettering/")),
    );
  });

  // The box is derived from this and nothing else (`src/sprite/lettering.ts`). A damaged spider
  // carries the game's only damage readout directly above its sprite (#81), and the word is struck
  // centred on the blow — so a box any taller would cover the bar at the moment it is being read.
  // #115 could put its long spikes on the diagonal; a blitted box has no diagonal to hide in.
  test("stops short of the health bar over the spider it belongs to", () => {
    const ctx = frame({ bursts: [{ pos: MARK, at: 900 }] });
    const bar = ctx.calls.find((c) => c.fn === "fillRect" && c.args[3] === 4);
    const under = (bar?.args[1] as number) + (bar?.args[3] as number);
    expect(bar).toBeDefined();
    expect(words(ctx)[0].y).toBeGreaterThanOrEqual(under);
  });

  // The whole of the ticket's "timed against the rendered sprite, not the raw event" box, end to end
  // through the class that owns the clock. A hit rides the 20 Hz tick while the spider it belongs to
  // is `ENEMY_RENDER_DELAY_MS` behind it, so a word stamped on arrival would pop before the drawing
  // it is about. It rides `impactMarks`, which is what holds it back.
  test("is held back until the spider it belongs to has caught up with the blow", () => {
    const at = 5_000;
    const client = new ClientWorld(
      {
        arena: { width: 31_200, height: 31_200 },
        exit: { x: 0, y: 100, width: 18, height: 96 },
        spawns: [{ id: "self", slot: 1, name: "Me", pos: MARK }],
        nestSeed: 7,
        oreSeed: 1,
        settings: DEFAULT_WORLD_SETTINGS,
      },
      "self",
    );
    client.applyMapDelta(
      { tick: 1, moves: [], spawns: [{ id: "e9", kind: "grunt", hp: 12, pos: MARK }] },
      at,
    );
    client.applyMapDelta(
      { tick: 2, moves: [["e9", MARK.x, MARK.y]], hits: [{ id: "e9", hp: 6 }] },
      at,
    );
    const lettered = (now: number) =>
      words(frame({ bursts: client.impactMarks(now, BURST_MS), now }));
    expect(lettered(at)).toEqual([]);
    expect(lettered(at + ENEMY_RENDER_DELAY_MS).length).toBe(1);
    expect(lettered(at + ENEMY_RENDER_DELAY_MS + BURST_MS)).toEqual([]);
  });
});

// #99: one `+1` per whole Metal, rising off the miner that earned it. The render layer holds no
// state, so it is handed the floats already accrued and only ages, places and fades them.
describe("a miner's floating +1", () => {
  const MINER: WorldSnapshot["structures"][number] = {
    id: "b1",
    kind: "miner",
    tile: { tx: 70, ty: 70 },
    hp: 200,
  };
  const mining: WorldSnapshot = { ...world, players: [], nests: [], structures: [MINER] };
  const sprites = stubSprites({ miner: 30, player: 28, halo: 52 });
  const NOW = 5_000;
  const float = (over: Partial<MetalFloat> = {}): MetalFloat => ({
    id: "b1",
    pos: { x: 1_065, y: 1_050 },
    at: NOW,
    ...over,
  });
  const drawn = (floats: MetalFloat[], snapshot = mining, now = NOW) => {
    const ctx = spyCtx();
    drawWorld(ctx, snapshot, { camera, viewport, sprites, now, floats });
    return ctx;
  };

  test("reads +1, in the game's own typeface", () => {
    const ctx = drawn([float()]);
    expect(ctx.calls.filter((c) => c.fn === "fillText").map((c) => c.args[0])).toEqual(["+1"]);
    expect(ctx.font).toContain("Playfair Display");
  });

  test("is cut out of paper, so it reads over the ink it passes", () => {
    const ctx = drawn([float()]);
    const stroked = ctx.calls.find((c) => c.fn === "strokeText");
    const filled = ctx.calls.find((c) => c.fn === "fillText");
    expect(stroked?.stroke).toBe("#ffffff");
    expect(filled?.fill).toBe("#000");
    expect(ctx.calls.indexOf(stroked as Call)).toBeLessThan(ctx.calls.indexOf(filled as Call));
  });

  test("rises from its own miner and fades as it goes", () => {
    const young = drawn([float()]).calls.find((c) => c.fn === "fillText");
    const old = drawn([float()], mining, NOW + FLOAT_MS / 2).calls.find((c) => c.fn === "fillText");
    expect(young?.args[1]).toBe(1_065); // the miner's own centre, not a shared point
    expect(old?.args[1]).toBe(1_065);
    expect(old?.args[2] as number).toBeLessThan(young?.args[2] as number);
    expect(old?.alpha as number).toBeLessThan(young?.alpha as number);
  });

  test("is gone once its life is up, and leaves the context at full opacity", () => {
    const ctx = drawn([float()], mining, NOW + FLOAT_MS);
    expect(ctx.calls.filter((c) => c.fn === "fillText").length).toBe(0);
    expect(ctx.globalAlpha).toBe(1);
  });

  test("draws over the world rather than sorted into it, and under the names", () => {
    const ctx = drawn([float()], { ...mining, players: world.players });
    const lastBlit = ctx.calls.findLastIndex((c) => c.fn === "drawImage");
    const plus = ctx.calls.findIndex((c) => c.fn === "strokeText" && c.args[0] === "+1");
    const name = ctx.calls.findIndex((c) => c.fn === "strokeText" && c.args[0] === "Ana");
    expect(plus).toBeGreaterThan(lastBlit);
    expect(plus).toBeLessThan(name);
  });
});

// #94: a small arrow at the viewport edge for each teammate the camera has left behind. Which
// peers get one is decided here, off the same cull that decides whether their body draws, so an
// arrow and a sprite can never both be up for the same player. Where the arrow goes and how faint
// it is belongs to `edgeMarker` and is tested there.
describe("an off-screen teammate's arrow", () => {
  const connected = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
  const peer = (id: string, slot: number, pos: Vec2, hp = 100): Avatar => ({
    ...POSE,
    id,
    slot,
    name: id,
    pos,
    radius: 14,
    hp,
  });
  const centre = { x: camera.x + viewport.width / 2, y: camera.y + viewport.height / 2 };
  const arrowsFor = (players: Avatar[], selfId = "me") => {
    const ctx = spyCtx();
    drawWorld(ctx, { ...world, players, nests: [] }, { camera, viewport, selfId, connected });
    return polygons(ctx);
  };

  test("appears for a connected teammate the camera has left behind", () => {
    expect(arrowsFor([peer("p1", 1, { x: centre.x + 9000, y: centre.y })])).toHaveLength(1);
  });

  test("does not appear while that teammate is still on screen", () => {
    expect(arrowsFor([peer("p1", 1, centre)])).toHaveLength(0);
  });

  test("never draws for both the arrow and the body at the edge the cull uses", () => {
    // One unit either side of the exact frame the peer stops being drawn: a body, then an arrow.
    const edge = camera.y + viewport.height + 14 * 2 + 30;
    const inside = arrowsFor([peer("p1", 1, { x: centre.x, y: edge - 1 })]);
    const outside = arrowsFor([peer("p1", 1, { x: centre.x, y: edge + 1 })]);
    expect(inside).toHaveLength(0);
    expect(outside).toHaveLength(1);
  });

  test("it is the camera that decides, so the same teammate comes and goes as it moves", () => {
    const pos = { x: 20_000, y: 20_000 };
    const shown = (at: Camera) => {
      const ctx = spyCtx();
      const players = [peer("p1", 1, pos)];
      drawWorld(
        ctx,
        { ...world, players, nests: [] },
        {
          camera: at,
          viewport,
          selfId: "me",
          connected,
        },
      );
      return polygons(ctx).length;
    };
    expect(shown({ x: 0, y: 0 })).toBe(1);
    expect(shown({ x: 19_000, y: 19_000 })).toBe(1);
    expect(shown({ x: 19_700, y: 19_800 })).toBe(0); // now on screen — the body draws instead
    expect(shown({ x: 20_000, y: 20_000 })).toBe(0);
    expect(shown({ x: 25_000, y: 25_000 })).toBe(1);
  });

  test("a dead teammate gets nothing", () => {
    expect(arrowsFor([peer("p1", 1, { x: centre.x + 9000, y: centre.y }, 0)])).toHaveLength(0);
  });

  test("a teammate frozen in the disconnect grace window gets nothing", () => {
    const ctx = spyCtx();
    const players = [peer("p1", 1, { x: centre.x + 9000, y: centre.y })];
    // The roster still holds their slot, so they are still in `world.players` — but not connected.
    drawWorld(
      ctx,
      { ...world, players, nests: [] },
      {
        camera,
        viewport,
        selfId: "me",
        connected: new Set<string>(),
      },
    );
    expect(polygons(ctx)).toHaveLength(0);
  });

  test("no arrow is drawn for yourself", () => {
    expect(arrowsFor([peer("p1", 1, { x: centre.x + 9000, y: centre.y })], "p1")).toHaveLength(0);
  });

  test("nothing at all is drawn without a roster to read presence from", () => {
    const ctx = spyCtx();
    const players = [peer("p1", 1, { x: centre.x + 9000, y: centre.y })];
    drawWorld(ctx, { ...world, players, nests: [] }, { camera, viewport, selfId: "me" });
    expect(polygons(ctx)).toHaveLength(0);
  });

  test("five off-screen teammates give five arrows, each in its own slot colour", () => {
    const away = [
      { x: centre.x + 9000, y: centre.y },
      { x: centre.x - 9000, y: centre.y },
      { x: centre.x, y: centre.y + 9000 },
      { x: centre.x, y: centre.y - 9000 },
      { x: centre.x + 6000, y: centre.y + 6000 },
    ];
    const arrows = arrowsFor(away.map((pos, i) => peer(`p${i + 1}`, i + 1, pos)));
    expect(arrows).toHaveLength(5);
    expect(new Set(arrows.map((a) => a.fill)).size).toBe(5);
  });

  test("every arrow is clamped inside the viewport rect", () => {
    const ring = Array.from({ length: 5 }, (_, i) => {
      const angle = (i / 5) * Math.PI * 2 + 0.3;
      return peer(`p${i + 1}`, i + 1, {
        x: centre.x + Math.cos(angle) * 12_000,
        y: centre.y + Math.sin(angle) * 12_000,
      });
    });
    for (const arrow of arrowsFor(ring)) {
      for (const [x, y] of arrow.points) {
        expect(x).toBeGreaterThanOrEqual(camera.x);
        expect(x).toBeLessThanOrEqual(camera.x + viewport.width);
        expect(y).toBeGreaterThanOrEqual(camera.y);
        expect(y).toBeLessThanOrEqual(camera.y + viewport.height);
      }
    }
  });

  test("points at the position the snapshot renders the peer at", () => {
    // `WorldSnapshot.players[].pos` is already the render-delayed sample (`ClientWorld.render`), so
    // the arrow and the sprite are aimed by the same number and cannot disagree.
    const pos = { x: centre.x - 8000, y: centre.y + 6000 };
    const [arrow] = arrowsFor([peer("p1", 1, pos)]);
    const [tip] = arrow.points;
    expect(Math.atan2(tip[1] - centre.y, tip[0] - centre.x)).toBeCloseTo(
      Math.atan2(pos.y - centre.y, pos.x - centre.x),
      6,
    );
  });

  test("fades with distance, and is drawn under the names", () => {
    const near = arrowsFor([peer("p1", 1, { x: centre.x + 1500, y: centre.y })]);
    const far = arrowsFor([peer("p1", 1, { x: centre.x + 20_000, y: centre.y })]);
    expect(far[0].alpha).toBeLessThan(near[0].alpha);

    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...world, players: [...world.players, peer("p5", 5, { x: centre.x + 9000, y: centre.y })] },
      { camera, viewport, selfId: "p1", connected },
    );
    const arrow = ctx.calls.findIndex((c) => c.fn === "closePath");
    const name = ctx.calls.findIndex((c) => c.fn === "strokeText");
    expect(arrow).toBeGreaterThan(-1);
    expect(arrow).toBeLessThan(name);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("#151: the pointer back to a revealed door", () => {
  // The base world's door is on the west wall, 902 u beyond the left of the camera's viewport, and
  // the squad stands in the middle of the screen — so nothing in this block ever has the door in
  // sight, which is the whole situation the pointer exists for.
  const found = { ...world, exitRevealed: true };
  const drawn = (snapshot: WorldSnapshot, options: Partial<DrawOptions> = {}) => {
    const ctx = spyCtx();
    drawWorld(ctx, snapshot, { camera, viewport, selfId: "p1", ...options });
    return ctx;
  };
  // The pointer's dart. It is the frame's only ink-filled path of more than two points: a peer's
  // arrow is filled in a slot colour, a nest and a body are arcs, and a burst and a puff are struck
  // rather than filled.
  const dart = (ctx: { calls: Call[] }) => polygons(ctx).find((p) => p.fill === "#000");
  // The figure it states. Every other word in the frame is a name, and no name is a run of digits.
  const figures = (ctx: { calls: Call[] }) =>
    ctx.calls
      .filter((c) => c.fn === "fillText" && /^\d+$/.test(String(c.args[0])))
      .map((c) => String(c.args[0]));
  const standing = (pos: Vec2) => ({ ...found, players: [{ ...SELF, pos }] });
  const centre = { x: camera.x + viewport.width / 2, y: camera.y + viewport.height / 2 };
  // The size of the type the figure is set in, off `WORLD_FONT` in `draw.ts`.
  const FIGURE_TYPE_SIZE = 12;

  test("before the door is found, nothing points at it and nothing states its distance", () => {
    const ctx = drawn(world);
    expect(dart(ctx)).toBeUndefined();
    expect(figures(ctx)).toEqual([]);
  });

  test("once it is found, a player who cannot see it is pointed back at it", () => {
    const ctx = drawn(found);
    expect(dart(ctx)).toBeDefined();
    expect(figures(ctx)).toEqual([String(Math.round(distanceToExit(SELF.pos, world.exit)))]);
  });

  test("it is struck from the middle of the screen toward the nearest part of the door", () => {
    const ctx = drawn(standing({ x: 5_000, y: 1_500 }));
    const [tip] = dart(ctx)?.points ?? [];
    expect(Math.atan2(tip[1] - centre.y, tip[0] - centre.x)).toBeCloseTo(
      Math.atan2(1_500 - centre.y, 98 - centre.x),
      6,
    );
  });

  test("the figure is how far the player is from the door, in whole world units", () => {
    expect(figures(drawn(standing({ x: 5_000, y: 1_500 })))).toEqual(["4902"]);
  });

  test("it counts down as the player walks in", () => {
    const away = Number(figures(drawn(standing({ x: 5_000, y: 1_500 })))[0]);
    const closer = Number(figures(drawn(standing({ x: 3_000, y: 1_500 })))[0]);
    expect(closer).toBeLessThan(away);
  });

  test("every client draws it off the one reveal, each from where it is standing", () => {
    const ana = drawn(found, { selfId: "p1" });
    const ben = drawn(found, { selfId: "p2" });
    expect(dart(ana)).toBeDefined();
    expect(dart(ben)).toBeDefined();
    expect(figures(ana)).not.toEqual(figures(ben));
  });

  test("nothing is drawn while the door is on screen — you can see it", () => {
    const ctx = drawn(found, { camera: { x: 0, y: 1_000 } });
    expect(dart(ctx)).toBeUndefined();
    expect(figures(ctx)).toEqual([]);
  });

  test("nothing at all without a player to measure from", () => {
    const ctx = drawn(found, { selfId: undefined });
    expect(dart(ctx)).toBeUndefined();
    expect(figures(ctx)).toEqual([]);
  });

  test("every point of the dart stays inside the viewport, at every bearing", () => {
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const pos = { x: 98 - Math.cos(angle) * 9_000, y: 1_500 - Math.sin(angle) * 9_000 };
      for (const [x, y] of dart(drawn(standing(pos)))?.points ?? []) {
        expect(x).toBeGreaterThanOrEqual(camera.x);
        expect(x).toBeLessThanOrEqual(camera.x + viewport.width);
        expect(y).toBeGreaterThanOrEqual(camera.y);
        expect(y).toBeLessThanOrEqual(camera.y + viewport.height);
      }
    }
  });

  test("the figure stays inside the viewport with the mark at each of the four corners", () => {
    // A corner is where the figure has least room in both axes at once, and it is the mark's own
    // inset that has to buy that room: the type runs flat across the screen whatever the bearing
    // did, and its baseline is dropped `EXIT_FIGURE_MIDLINE` further toward the bottom edge again.
    //
    // The corners are struck rather than searched for. The ray leaves the inset rect exactly at a
    // corner when it runs along that rect's own diagonal, so the camera is put ten diagonals back
    // from the door — far enough out that the door is nowhere near the screen being pointed off.
    const pos = { x: 5_000, y: 1_500 };
    const nearest = { x: world.exit.x + world.exit.width, y: pos.y };
    const reach = { x: viewport.width / 2 - MARKER_INSET, y: viewport.height / 2 - MARKER_INSET };
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const vantage = {
          x: nearest.x - sx * reach.x * 10 - viewport.width / 2,
          y: nearest.y - sy * reach.y * 10 - viewport.height / 2,
        };
        const ctx = drawn(standing(pos), { camera: vantage });
        const written = ctx.calls.filter(
          (c) => c.fn === "fillText" && /^\d+$/.test(String(c.args[0])),
        );
        expect(written).toHaveLength(1);
        const [figure, x, y] = written[0].args as [string, number, number];
        // The figure's ink box. Across, what the draw path itself measured — asked of the same
        // context, so the box cannot disagree with the width the clamp worked from. Down, the
        // baseline: a digit has no descender to reach below it, and none reaches a whole type size
        // above it either, so 12 u is a ceiling and not a metric.
        const half = ctx.measureText(figure).width / 2;
        expect(x - half).toBeGreaterThanOrEqual(vantage.x);
        expect(x + half).toBeLessThanOrEqual(vantage.x + viewport.width);
        expect(y - FIGURE_TYPE_SIZE).toBeGreaterThanOrEqual(vantage.y);
        expect(y).toBeLessThanOrEqual(vantage.y + viewport.height);
      }
    }
  });

  test("it is world-anchored: the mark holds its size in the world at every zoom", () => {
    // The opposite choice from the corner map, and the same one #94's arrows made — the two sit on
    // the same rim, so a pointer that held a screen size beside them would grow and shrink against
    // its own neighbour as the player zoomed.
    const span = (zoom: number) => {
      const ctx = drawn(found, { zoom, viewport: worldViewport(viewport, zoom) });
      const points = dart(ctx)?.points ?? [];
      return Math.hypot(points[1][0] - points[3][0], points[1][1] - points[3][1]);
    };
    expect(span(0.5)).toBeCloseTo(span(1), 9);
    expect(span(3)).toBeCloseTo(span(1), 9);
  });

  test("the figure is cut out of paper, so it reads over whatever it crosses", () => {
    const ctx = drawn(found);
    const cut = ctx.calls.findIndex(
      (c) => c.fn === "strokeText" && /^\d+$/.test(String(c.args[0])),
    );
    expect(ctx.calls[cut].stroke).toBe("#ffffff");
    expect(ctx.calls[cut + 1]).toMatchObject({ fn: "fillText", fill: "#000" });
  });

  test("it is drawn over the world and under the names", () => {
    const ctx = drawn(found);
    const pointer = ctx.calls.findIndex((c) => c.fn === "closePath");
    const name = ctx.calls.findIndex((c) => c.fn === "strokeText" && c.args[0] === "Ana");
    expect(pointer).toBeGreaterThan(-1);
    expect(pointer).toBeLessThan(name);
  });
});

describe("#152: the count for a player standing in the escape door", () => {
  // The base world's door is on the west wall — x 0..98, y 1,100..2,036 — and a player standing in
  // it is looking straight at it, so the camera here is the one the game would have.
  const exit = world.exit;
  const doorCam: Camera = { x: 0, y: 1_150 };
  const IN = { x: 50, y: 1_400 };
  const ALSO_IN = { x: 60, y: 1_500 };
  const OUT = { x: 5_000, y: 1_500 };

  // One member of the squad: where they are standing, whether they are up, and whether the roster
  // still has them at the keyboard. The first is always the self.
  interface Member {
    pos: Vec2;
    hp?: number;
    dropped?: boolean; // in the server's grace window: still on the screen, out of the squad
  }

  const scene = (members: Member[]) => {
    const players: Avatar[] = members.map((m, i) => ({
      ...POSE,
      id: `p${i + 1}`,
      slot: i + 1,
      name: `P${i + 1}`,
      pos: m.pos,
      radius: 14,
      hp: m.hp ?? 100,
    }));
    return {
      snapshot: { ...world, players } satisfies WorldSnapshot,
      connected: new Set(players.filter((_, i) => !members[i].dropped).map((p) => p.id)),
    };
  };

  const drawn = (members: Member[], options: Partial<DrawOptions> = {}) => {
    const { snapshot, connected } = scene(members);
    const ctx = spyCtx();
    drawWorld(ctx, snapshot, { camera: doorCam, viewport, selfId: "p1", connected, ...options });
    return ctx;
  };

  // The squad as the *server* would hold it for this scene: the connected, at the HP and position it
  // was last told. What the sign is checked against, rather than a second copy of the client's own
  // arithmetic.
  const asServerHolds = (members: Member[]) =>
    members.filter((m) => !m.dropped).map((m) => ({ pos: m.pos, hp: m.hp ?? 100 }));

  // The sign, read off the log. Nothing else in the frame is written in this shape: a name is a
  // name, a `+1` is a `+1`, and #151's distance is a bare run of digits.
  const written = (ctx: { calls: Call[] }) =>
    ctx.calls
      .filter((c) => c.fn === "fillText" && /^\d+ of \d+$/.test(String(c.args[0])))
      .map((c) => ({
        text: String(c.args[0]),
        x: c.args[1] as number,
        y: c.args[2] as number,
        font: String(c.font),
      }));
  const sign = (ctx: { calls: Call[] }) => written(ctx).map((w) => w.text);

  test("standing outside the door, nothing is written at all", () => {
    expect(sign(drawn([{ pos: OUT }, { pos: IN }]))).toEqual([]);
  });

  test("standing in it says so, and says how much of the squad is in with you", () => {
    expect(sign(drawn([{ pos: IN }, { pos: OUT }]))).toEqual(["1 of 2"]);
  });

  test("the count climbs as the rest of the squad arrives", () => {
    expect(sign(drawn([{ pos: IN }, { pos: ALSO_IN }]))).toEqual(["2 of 2"]);
  });

  test("a downed squadmate in the door is not in it, and is still needed", () => {
    expect(sign(drawn([{ pos: IN }, { pos: ALSO_IN, hp: 0 }]))).toEqual(["1 of 2"]);
  });

  test("a downed player in the door is told nothing — they are not one of the counted", () => {
    expect(sign(drawn([{ pos: IN, hp: 0 }, { pos: ALSO_IN }]))).toEqual([]);
  });

  test("a dropped squadmate is out of the count entirely, as the escape rule leaves them out", () => {
    expect(sign(drawn([{ pos: IN }, { pos: OUT, dropped: true }]))).toEqual(["1 of 1"]);
  });

  test("without the roster nothing is written — a dropped teammate reads as one standing still", () => {
    // The same refusal #94's arrows make (#75): presence rides the lobby snapshot, and with no
    // snapshot there is nothing that tells a player in the server's grace window from a player who
    // has simply stopped walking. A denominator guessed from the avatars alone would be wrong in the
    // one case the escape rule cares about.
    expect(sign(drawn([{ pos: IN }, { pos: OUT }], { connected: undefined }))).toEqual([]);
  });

  test("nothing at all without a player to judge", () => {
    expect(sign(drawn([{ pos: IN }, { pos: OUT }], { selfId: undefined }))).toEqual([]);
  });

  test("what it counts is what ends the match, case for case", () => {
    // The whole of the agreement (#152). Both readers take one measure — `escapeTally` in
    // `world.ts` — so what is checked here is the half that is *not* shared: that the client
    // assembles the same squad the server does. Connected only, a downed player in it and blocking,
    // a dropped one not in it at all.
    const cases: Member[][] = [
      [{ pos: IN }],
      [{ pos: IN }, { pos: OUT }],
      [{ pos: IN }, { pos: ALSO_IN }],
      [{ pos: IN }, { pos: ALSO_IN, hp: 0 }],
      [{ pos: IN }, { pos: OUT, dropped: true }],
      [{ pos: IN }, { pos: ALSO_IN }, { pos: OUT }],
      [{ pos: IN }, { pos: ALSO_IN }, { pos: OUT, dropped: true }],
      [{ pos: IN }, { pos: ALSO_IN, dropped: true }, { pos: OUT, dropped: true }],
    ];
    for (const members of cases) {
      const squad = asServerHolds(members);
      const { inside, needed } = escapeTally(squad, exit);
      expect(sign(drawn(members))).toEqual([`${inside} of ${needed}`]);
      // And the match ends on that tally reaching its own denominator, never on a second rule.
      expect(squadEscaped(squad, exit)).toBe(inside === needed);
    }
  });

  test("drawing it changes nothing the rule that ends the match reads", () => {
    const { snapshot, connected } = scene([{ pos: IN }, { pos: ALSO_IN }]);
    const before = structuredClone(snapshot.players);
    drawWorld(spyCtx(), snapshot, { camera: doorCam, viewport, selfId: "p1", connected });
    expect(snapshot.players).toEqual(before);
    expect(squadEscaped(asServerHolds([{ pos: IN }, { pos: ALSO_IN }]), exit)).toBe(true);
  });

  test("it is screen-anchored: same place and same size on the screen at every zoom", () => {
    // The opposite choice from #151's dart and the same one the corner map made. The count is about
    // the squad rather than about a point on the floor, and a 936 u door has no point a camera is
    // guaranteed to hold in view — so it is chrome. Held in the world it would be six CSS px of type
    // at 0.5×, on the one frame a whole match resolves on.
    const onScreen = (zoom: number) => {
      const view = worldViewport(viewport, zoom);
      const [mark] = written(drawn([{ pos: IN }, { pos: OUT }], { zoom, viewport: view }));
      const size = Number(/^([\d.]+)px/.exec(mark.font)?.[1]);
      return {
        x: (mark.x - doorCam.x) * zoom,
        y: (mark.y - doorCam.y) * zoom,
        size: size * zoom,
        centred: mark.x - (doorCam.x + view.width / 2),
      };
    };
    const at1 = onScreen(1);
    expect(at1.centred).toBeCloseTo(0, 9);
    for (const zoom of [0.5, 3]) {
      const zoomed = onScreen(zoom);
      expect(zoomed.x).toBeCloseTo(at1.x, 9);
      expect(zoomed.y).toBeCloseTo(at1.y, 9);
      expect(zoomed.size).toBeCloseTo(at1.size, 9);
      expect(zoomed.centred).toBeCloseTo(0, 9);
    }
  });

  test("it stands at the top of the screen, clear of the whole viewport's depth", () => {
    const [mark] = written(drawn([{ pos: IN }, { pos: OUT }]));
    expect(mark.y).toBeGreaterThan(doorCam.y);
    expect(mark.y - doorCam.y).toBeLessThan(viewport.height / 4);
  });

  test("it is cut out of paper, so it reads over the door as well as over the floor", () => {
    const ctx = drawn([{ pos: IN }, { pos: OUT }]);
    const cut = ctx.calls.findIndex(
      (c) => c.fn === "strokeText" && /^\d+ of \d+$/.test(String(c.args[0])),
    );
    expect(ctx.calls[cut].stroke).toBe("#ffffff");
    expect(ctx.calls[cut + 1]).toMatchObject({ fn: "fillText", fill: "#000" });
  });

  test("it is not on the corner map, which still writes nothing", () => {
    const ctx = drawn([{ pos: IN }, { pos: OUT }]);
    expect(sign(ctx)).toHaveLength(1);
    expect(mapCalls(ctx).some((c) => c.fn === "fillText" || c.fn === "strokeText")).toBe(false);
  });

  test("it says nothing about the door until somebody stands in it", () => {
    // #151's latch has no say here and must not acquire one: a player standing in the door has found
    // it by definition, so gating this on the reveal would be a second condition that can only ever
    // be true.
    expect(sign(drawn([{ pos: IN }, { pos: OUT }], { camera: doorCam }))).toEqual(["1 of 2"]);
    expect(sign(drawn([{ pos: OUT }, { pos: IN }]))).toEqual([]);
  });
});

// --- The corner minimap (#93) -------------------------------------------------------------

// The map's discs — the squad and the nests — as centre, radius and the fill they went out under.
const mapDiscs = (ctx: { calls: Call[] }) => {
  const calls = mapCalls(ctx);
  const discs: { x: number; y: number; r: number; fill: unknown }[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c.fn !== "arc") continue;
    const next = calls[i + 1];
    if (next?.fn !== "fill") continue;
    discs.push({
      x: c.args[0] as number,
      y: c.args[1] as number,
      r: c.args[2] as number,
      fill: next.fill,
    });
  }
  return discs;
};

// The map's ink squares — ore cells, structures and the door — as their rects.
const mapRects = (ctx: { calls: Call[] }) =>
  mapCalls(ctx)
    .filter((c) => c.fn === "fillRect" && c.fill === "#000")
    .map((c) => ({
      x: c.args[0] as number,
      y: c.args[1] as number,
      width: c.args[2] as number,
      height: c.args[3] as number,
    }));

const SELF = world.players[0];
const near = (pos: Vec2, dx: number, dy = 0) => ({ x: pos.x + dx, y: pos.y + dy });
const struct = (id: string, kind: BuildableKind, tile: Tile) => ({ id, kind, tile, hp: 400 });

describe("the minimap", () => {
  test("draws nothing without a player to centre the window on", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    expect(mapCalls(ctx)).toHaveLength(0);
  });

  test("plates a square in the viewport's top-right corner, paper inside a hard rule", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, selfId: "p1" });
    const win = minimapWindow(SELF.pos, camera, viewport, MINIMAP_COVERAGE_U);
    const plate = mapCalls(ctx)[0];
    expect(plate.fill).toBe("#ffffff");
    expect(plate.args.slice(0, 4)).toEqual([win.x, win.y, MINIMAP_SIZE, MINIMAP_SIZE]);
    expect(
      ctx.calls.some(
        (c) =>
          c.fn === "strokeRect" &&
          c.stroke === "#000" &&
          c.args[0] === win.x &&
          c.args[2] === MINIMAP_SIZE,
      ),
    ).toBe(true);
  });

  test("opens centred on the player, at 1×", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, selfId: "p1" });
    const win = minimapWindow(SELF.pos, camera, viewport, MINIMAP_COVERAGE_U);
    expect(win.coverage).toBe(7_800);
    const self = mapDiscs(ctx).find((d) => d.fill === "#4f8cff");
    expect(self).toBeDefined();
    expect(self?.x).toBeCloseTo(win.x + MINIMAP_SIZE / 2, 6);
    expect(self?.y).toBeCloseTo(win.y + MINIMAP_SIZE / 2, 6);
  });

  test("marks the squad in slot colours, and rings the self the way the world does", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, selfId: "p1" });
    const discs = mapDiscs(ctx);
    expect(discs.some((d) => d.fill === "#4f8cff")).toBe(true); // slot 1, the self
    expect(discs.some((d) => d.fill === "#ff5d5d")).toBe(true); // slot 2, a peer
    const rings = mapCalls(ctx).filter((c) => c.fn === "arc");
    const self = discs.find((d) => d.fill === "#4f8cff");
    expect(rings.some((c) => c.args[0] === self?.x && (c.args[2] as number) > (self?.r ?? 0))).toBe(
      true,
    );
  });

  test("leaves a teammate outside the window off the map rather than pinning them to its edge", () => {
    const far = { ...world.players[1], pos: near(SELF.pos, 10_000) };
    const ctx = spyCtx();
    drawWorld(ctx, { ...world, players: [SELF, far] }, { camera, viewport, selfId: "p1" });
    expect(mapDiscs(ctx).some((d) => d.fill === "#ff5d5d")).toBe(false);
  });

  test("draws no enemy at any count", () => {
    const swarm: RenderedEnemy[] = Array.from({ length: 240 }, (_, i) => ({
      ...POSE,
      id: `e${i}`,
      kind: "grunt",
      pos: near(SELF.pos, (i % 60) * 30, Math.floor(i / 60) * 30),
      radius: 16,
      hp: 30,
    }));
    const bare = spyCtx();
    const swarmed = spyCtx();
    drawWorld(bare, world, { camera, viewport, selfId: "p1" });
    drawWorld(swarmed, { ...world, enemies: swarm }, { camera, viewport, selfId: "p1" });
    expect(mapCalls(swarmed)).toHaveLength(mapCalls(bare).length);
  });

  test("writes nothing anywhere on it, at any level", () => {
    for (const minimapCoverage of MINIMAP_COVERAGES) {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        { ...world, exitRevealed: true, structures: [struct("s1", "turret", { tx: 74, ty: 74 })] },
        { camera, viewport, selfId: "p1", minimapCoverage },
      );
      expect(mapCalls(ctx).some((c) => c.fn === "fillText" || c.fn === "strokeText")).toBe(false);
    }
  });

  // The zoom (#110). The plate never changes — only how much world it is a window onto — so the
  // level is read off where a mark of a known world offset lands rather than off the plate.
  test("shows the level it is handed, and the same plate at every one of them", () => {
    const peer = { ...world.players[1], pos: near(SELF.pos, 2_000) };
    for (const minimapCoverage of MINIMAP_COVERAGES) {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        { ...world, players: [SELF, peer] },
        {
          camera,
          viewport,
          selfId: "p1",
          minimapCoverage,
        },
      );
      const win = minimapWindow(SELF.pos, camera, viewport, minimapCoverage);
      expect(mapCalls(ctx)[0].args.slice(0, 4)).toEqual([win.x, win.y, MINIMAP_SIZE, MINIMAP_SIZE]);
      const mark = mapDiscs(ctx).find((d) => d.fill === "#ff5d5d");
      // 2,000 u out is inside the two wider windows and outside the closest, and the two it is on
      // put it at the distance their own scale says — which is the coverage, drawn.
      if (minimapCoverage === MINIMAP_COVERAGE_CLOSE_U) expect(mark).toBeUndefined();
      else expect((mark?.x ?? 0) - (win.x + MINIMAP_SIZE / 2)).toBeCloseTo(2_000 * win.scale, 6);
    }
  });

  test("opens at 1×, and lands back on it after a full cycle of the key", () => {
    const view = (minimapCoverage?: number) => {
      const ctx = spyCtx();
      drawWorld(ctx, world, { camera, viewport, selfId: "p1", minimapCoverage });
      return mapCalls(ctx);
    };
    // No level asked for is the level the map opens at, which is what makes a cycle a round trip.
    const opened = view();
    expect(opened).toEqual(view(MINIMAP_COVERAGE_U));
    const pressed: ReturnType<typeof view>[] = [];
    let level = MINIMAP_COVERAGE_U;
    for (let step = 0; step < 3; step++) {
      level = nextMinimapCoverage(level);
      pressed.push(view(level));
    }
    // Three presses show three different maps and the third is the one it opened on — a cycle that
    // stepped nowhere would satisfy "lands back on it" while showing the same map throughout.
    expect(pressed[0]).not.toEqual(opened);
    expect(pressed[1]).not.toEqual(opened);
    expect(pressed[2]).toEqual(opened);
  });

  describe("the door", () => {
    // A door on the west wall, with the squad standing beside it so it falls inside the window.
    const doorside = {
      ...world,
      players: [{ ...SELF, pos: { x: 1_500, y: 15_800 } }],
      exit: { x: 0, y: 15_400, width: 98, height: 936 },
    };
    const doorRect = (ctx: { calls: Call[] }) => {
      const win = minimapWindow(doorside.players[0].pos, camera, viewport, MINIMAP_COVERAGE_U);
      const box = projectRect(win, doorside.exit);
      return mapRects(ctx).find(
        (r) => box && Math.abs(r.x - box.x) < 1 && Math.abs(r.height - box.height) < 1,
      );
    };

    test("is not drawn before it has been revealed", () => {
      const ctx = spyCtx();
      drawWorld(ctx, { ...doorside, exitRevealed: false }, { camera, viewport, selfId: "p1" });
      expect(doorRect(ctx)).toBeUndefined();
    });

    test("is drawn as the bar in the wall it is, once revealed", () => {
      const ctx = spyCtx();
      drawWorld(ctx, { ...doorside, exitRevealed: true }, { camera, viewport, selfId: "p1" });
      const bar = doorRect(ctx);
      expect(bar).toBeDefined();
      expect(bar?.height).toBeGreaterThan(bar?.width ?? 0);
    });

    test("is simply absent when it falls outside the window — never clamped to the map edge", () => {
      const away = { ...doorside, players: [{ ...SELF, pos: { x: 15_600, y: 15_600 } }] };
      const ctx = spyCtx();
      drawWorld(ctx, { ...away, exitRevealed: true }, { camera, viewport, selfId: "p1" });
      const win = minimapWindow(away.players[0].pos, camera, viewport, MINIMAP_COVERAGE_U);
      // Nothing tall stands on the rim where a clamped door would have been pinned.
      expect(mapRects(ctx).some((r) => r.height > 10 && Math.abs(r.x - win.x) < 3)).toBe(false);
    });
  });

  test("reads a nest as alive or silenced", () => {
    const nests = [
      { id: "n1", pos: near(SELF.pos, 500), radius: 48, maxHp: 600, hp: 600, alive: true },
      { id: "n2", pos: near(SELF.pos, -500), radius: 48, maxHp: 600, hp: 0, alive: false },
    ];
    const ctx = spyCtx();
    drawWorld(ctx, { ...world, nests }, { camera, viewport, selfId: "p1" });
    const discs = mapDiscs(ctx);
    expect(discs.some((d) => d.fill === "#8e44ad")).toBe(true); // alive, inked in
    // Silenced is hollow rather than a second dark colour: at this size a fill/no-fill pair reads
    // where two near-black inks would not.
    expect(discs.filter((d) => d.fill === "#ffffff")).toHaveLength(1);
  });

  test("shows own structures as they are placed and drops them as they are destroyed", () => {
    const tiles: Tile[] = [
      { tx: 74, ty: 74 },
      { tx: 76, ty: 74 },
      { tx: 78, ty: 74 },
    ];
    const marks = (n: number) => {
      const ctx = spyCtx();
      drawWorld(
        ctx,
        { ...world, structures: tiles.slice(0, n).map((t, i) => struct(`s${i}`, "wall", t)) },
        { camera, viewport, selfId: "p1" },
      );
      return mapRects(ctx).length;
    };
    expect(marks(3) - marks(0)).toBe(3);
    expect(marks(1) - marks(0)).toBe(1);
  });

  test("reads ore as density, never as tiles", () => {
    // Two cells beside the player, both laid on the lattice: one solid, one carrying a single tile.
    const ore = new Map<number, OreKind>();
    const cellTiles = MINIMAP_ORE_CELL_U / 15;
    const base = tileOf(SELF.pos);
    const tx0 = Math.floor(base.tx / cellTiles) * cellTiles;
    const ty0 = Math.floor(base.ty / cellTiles) * cellTiles;
    for (let i = 0; i < cellTiles * cellTiles; i++) {
      ore.set(tileKey({ tx: tx0 + (i % cellTiles), ty: ty0 + Math.floor(i / cellTiles) }), "metal");
    }
    ore.set(tileKey({ tx: tx0 + cellTiles * 2, ty: ty0 }), "power");
    const ctx = spyCtx();
    drawWorld(ctx, { ...world, ore }, { camera, viewport, selfId: "p1" });
    const rects = mapRects(ctx);
    expect(rects).toHaveLength(2);
    const [dense, sparse] = [...rects].sort((a, b) => b.width - a.width);
    expect(dense.width).toBeGreaterThan(sparse.width);
    // A full cell of ore is one mark, not 64 — the whole point of the layer.
    expect(dense.width).toBeLessThanOrEqual(
      MINIMAP_ORE_CELL_U * (MINIMAP_SIZE / MINIMAP_COVERAGE_U),
    );
  });

  // The plate's corner is snapped to a device pixel and every mark is projected off it, so the
  // expectation has to be the snapped corner rather than the window's.
  const onDevicePixel = (world: number, cameraAxis: number, dpr: number) =>
    cameraAxis + Math.round((world - cameraAxis) * dpr) / dpr;

  test("projects onto the same plate at dpr 1, 2 and 3, at any viewport size and any level", () => {
    for (const minimapCoverage of MINIMAP_COVERAGES) {
      for (const dpr of [1, 2, 3]) {
        for (const view of [
          { width: 800, height: 600 },
          { width: 1920, height: 1080 },
          // A real HiDPI `getBoundingClientRect()` returns fractions, and one is needed here or the
          // device ratio does not reach this test at all: on a whole-pixel viewport the plate already
          // sits on a device pixel at every ratio, so the loop would assert one thing three times.
          { width: 1512.5, height: 945.5 },
        ]) {
          const ctx = spyCtx();
          drawWorld(ctx, world, { camera, viewport: view, selfId: "p1", dpr, minimapCoverage });
          const win = minimapWindow(SELF.pos, camera, view, minimapCoverage);
          const x = onDevicePixel(win.x, camera.x, dpr);
          const y = onDevicePixel(win.y, camera.y, dpr);
          expect(mapCalls(ctx)[0].args.slice(0, 4)).toEqual([x, y, MINIMAP_SIZE, MINIMAP_SIZE]);
          const self = mapDiscs(ctx).find((d) => d.fill === "#4f8cff");
          expect(self?.x).toBeCloseTo(x + MINIMAP_SIZE / 2, 6);
          expect(self?.y).toBeCloseTo(y + MINIMAP_SIZE / 2, 6);
        }
      }
    }
  });

  // A frame with something of every layer pressed against the rim of the window, which is the only
  // place a projection that was off by anything at all would put ink on the floor beside the map.
  //
  // Built to the level it is asked for rather than to 1×, because the rim is a different piece of
  // world at each of them and a scene pinned to one level would sit harmlessly mid-plate at the
  // others. `without` drops one layer, so what a layer contributes is the difference it makes.
  const crowded = (
    minimapCoverage = MINIMAP_COVERAGE_U,
    without?: "ore" | "structures" | "door" | "nests",
  ) => {
    const centre = { x: 15_600, y: 15_600 };
    const cam = { x: centre.x - viewport.width / 2, y: centre.y - viewport.height / 2 };
    const win = minimapWindow(centre, cam, viewport, minimapCoverage);
    const edge = minimapCoverage / 2 - 1; // a world unit inside the window, on every side
    const peer = (slot: number, dx: number, dy: number) => ({
      ...POSE,
      id: `p${slot}`,
      slot,
      name: `P${slot}`,
      pos: near(centre, dx, dy),
      radius: 14,
      hp: 100,
    });
    const nest = (id: string, dx: number, dy: number, alive: boolean) => ({
      id,
      pos: near(centre, dx, dy),
      radius: 48,
      maxHp: 600,
      hp: alive ? 600 : 0,
      alive,
    });
    // Ore laid over the window's left and top rim, where a cell is half on the plate and half off.
    const ore = new Map<number, OreKind>();
    const cellTiles = MINIMAP_ORE_CELL_U / 15;
    const rimTx = Math.floor(win.worldX / 15);
    const rimTy = Math.floor(win.worldY / 15);
    for (let i = 0; i < cellTiles; i++) {
      ore.set(tileKey({ tx: rimTx + i, ty: rimTy + i }), "metal");
      ore.set(tileKey({ tx: rimTx + cellTiles + i, ty: rimTy + i }), "power");
    }
    const snapshot: WorldSnapshot = {
      ...world,
      players: [
        { ...SELF, pos: centre },
        peer(2, edge, 0),
        peer(3, -edge, 0),
        peer(4, 0, edge),
        peer(5, 0, -edge),
      ],
      nests:
        without === "nests" ? [] : [nest("n1", -edge, -edge, true), nest("n2", edge, edge, false)],
      ore: without === "ore" ? new Map() : ore,
      structures:
        without === "structures"
          ? []
          : [rimTx, rimTx + 1, rimTx + 2].map((tx, i) =>
              struct(`s${i}`, "wall", { tx, ty: rimTy + cellTiles * 2 }),
            ),
      // A door straddling the rim, so the clipped bar is drawn as well as the whole one.
      exit: { x: win.worldX - 50, y: centre.y - 400, width: 98, height: 936 },
      exitRevealed: without !== "door",
    };
    const ctx = spyCtx();
    drawWorld(ctx, snapshot, { camera: cam, viewport, selfId: "p1", minimapCoverage });
    return { ctx, win };
  };

  test("keeps every layer inside the plate, at every level", () => {
    for (const coverage of MINIMAP_COVERAGES) {
      const { ctx, win } = crowded(coverage);
      expect(
        mapCalls(ctx).some(
          (c) =>
            c.fn === "rect" &&
            c.args[0] === win.x &&
            c.args[1] === win.y &&
            c.args[2] === MINIMAP_SIZE &&
            c.args[3] === MINIMAP_SIZE,
        ),
      ).toBe(true);
      expect(mapCalls(ctx).some((c) => c.fn === "clip")).toBe(true);

      // Every mark is anchored on the plate. A mark also has a size the projection knows nothing
      // about, so one on the rim hangs over it by up to its own width — that overhang is what the
      // clip is there to trim, and one ore cell, the widest thing drawn, bounds it.
      const slop = MINIMAP_ORE_CELL_U * win.scale;
      const marks = mapCalls(ctx).filter((c) => c.fn === "arc" || c.fn === "fillRect");
      for (const c of marks) {
        const over = c.fn === "arc" ? 0 : slop;
        expect(c.args[0] as number).toBeGreaterThanOrEqual(win.x - over);
        expect(c.args[1] as number).toBeGreaterThanOrEqual(win.y - over);
        expect(c.args[0] as number).toBeLessThanOrEqual(win.x + MINIMAP_SIZE + over);
        expect(c.args[1] as number).toBeLessThanOrEqual(win.y + MINIMAP_SIZE + over);
      }
      // …and the scene really does press the rim, or the bounds above are asserting nothing.
      const discs = mapDiscs(ctx);
      const xs = discs.map((d) => d.x);
      const ys = discs.map((d) => d.y);
      expect(Math.min(...xs)).toBeLessThan(win.x + 1);
      expect(Math.max(...xs)).toBeGreaterThan(win.x + MINIMAP_SIZE - 1);
      expect(Math.min(...ys)).toBeLessThan(win.y + 1);
      expect(Math.max(...ys)).toBeGreaterThan(win.y + MINIMAP_SIZE - 1);
    }
  });

  test("draws every #93 layer at every level, in marks the level never shrinks", () => {
    const radii = new Set<number>();
    for (const coverage of MINIMAP_COVERAGES) {
      const discs = mapDiscs(crowded(coverage).ctx);
      // Self, four peers and two nests — no layer of discs drops out at any level.
      expect(discs).toHaveLength(7);
      for (const d of discs) radii.add(d.r);
      const rects = mapRects(crowded(coverage).ctx).length;
      expect(rects - mapRects(crowded(coverage, "structures").ctx).length).toBe(3);
      expect(rects - mapRects(crowded(coverage, "door").ctx).length).toBe(1);
      expect(rects - mapRects(crowded(coverage, "ore").ctx).length).toBeGreaterThan(0);
      expect(mapDiscs(crowded(coverage, "nests").ctx)).toHaveLength(5);
    }
    // One radius across all three levels: a squad mark is a fixed size on the plate, so zooming out
    // shows more world at the same legibility rather than the same map printed smaller.
    expect(radii.size).toBe(1);
  });

  test("closes the clip it opened, so the rest of the match is not drawn inside the plate", () => {
    const { ctx } = crowded();
    // `GameScreen` re-runs `setTransform` every frame and nothing else in `drawWorld` saves or
    // restores — and `setTransform` does not drop a clip region. A `restore` the map failed to
    // reach would therefore crop every later frame of the match to this 200 px square.
    let depth = 0;
    for (const c of ctx.calls) {
      if (c.fn === "save") depth++;
      else if (c.fn === "restore") depth--;
      else if (c.fn === "clip") expect(depth).toBeGreaterThan(0); // clipped with nothing to undo it
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});

// #142: the black veil a blow lays over your own screen. The render layer holds no state here — it
// is handed an alpha the frame worked out from the instant it was hit (`damageFx`) and lays one
// fill at it. What is left to pin is that the fill is the whole viewport, that it is black, that it
// is the last thing in the frame, and — the one that matters most — that a frame carrying no blow
// is byte-for-byte the frame the game has always drawn.
describe("the damage veil", () => {
  // The viewport-sized fills in a frame, in the order they were laid. The paper is always the
  // first; a veil is a second one behind it.
  const fullScreen = (ctx: { calls: Call[] }) =>
    ctx.calls.filter(
      (c) => c.fn === "fillRect" && c.args[2] === viewport.width && c.args[3] === viewport.height,
    );
  const veiled = (damageFlash?: number) => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { selfId: "p1", camera, viewport, damageFlash });
    return ctx;
  };

  test("a frame with no blow behind it lays nothing over the world", () => {
    expect(fullScreen(veiled()).length).toBe(1); // the paper, and only the paper
    expect(fullScreen(veiled(0)).length).toBe(1);
  });

  test("a blow lays one black fill over the whole viewport", () => {
    const laid = fullScreen(veiled(0.5));
    expect(laid.length).toBe(2);
    expect(laid[1].args).toEqual([camera.x, camera.y, viewport.width, viewport.height]);
    expect(laid[1].fill).toBe("rgba(0, 0, 0, 0.5)");
  });

  test("goes darker as the alpha does", () => {
    expect(fullScreen(veiled(0.125))[1].fill).toBe("rgba(0, 0, 0, 0.125)");
  });

  test("is the last mark in the frame — nothing in the world is drawn over the blow", () => {
    const ctx = veiled(0.5);
    expect(ctx.calls.at(-1)).toBe(fullScreen(ctx)[1]);
  });

  // The whole of "the frame returns exactly to normal": the alpha rides the colour rather than
  // `globalAlpha`, so there is no drawing state left set for the next frame to inherit.
  test("leaves no alpha on the context for the next frame to inherit", () => {
    const ctx = veiled(0.5) as unknown as { globalAlpha?: number; calls: Call[] };
    expect(ctx.globalAlpha ?? 1).toBe(1);
    expect(ctx.calls.every((c) => c.composite === "source-over")).toBe(true);
  });

  // Both are black and both are the dying player's own. A blow landing on the frame you go down on
  // is still a blow, so the veil goes over the darkening rather than under it.
  test("falls over the downed darkening, not beneath it", () => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      {
        ...world,
        players: [
          { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 0 },
        ],
        nests: [],
      },
      { selfId: "p1", camera, viewport, damageFlash: 0.5 },
    );
    const laid = fullScreen(ctx);
    expect(laid.length).toBe(3); // paper, the darkening, the veil
    expect(laid[2].fill).toBe("rgba(0, 0, 0, 0.5)");
  });
});

// #140: the blood a bloodling leaves on the floor. The render layer holds none of it — `stepBlood`
// accrues the marks, culls them at spawn and bounds the list, and this layer is handed what is left.
// What is pinned here is the ink: red, on the floor rather than among the bodies, one path a band
// however many marks are up, fading with age, and nothing at all struck for a mark off camera.
describe("blood on the floor", () => {
  const ON: Vec2 = { x: 1_200, y: 1_200 };
  const sprites = stubSprites({ player: 28, bloodling: 32 });
  const bleeding: WorldSnapshot = {
    ...world,
    nests: [],
    enemies: [
      { ...POSE, id: "b1", kind: "bloodling", pos: { x: 1_300, y: 1_300 }, radius: 16, hp: 15 },
    ],
  };
  const bled = (marks: readonly BloodMark[], now = 1_000) => {
    const ctx = spyCtx();
    drawWorld(ctx, bleeding, { camera, viewport, now, sprites, blood: marks });
    return ctx;
  };
  // Every filled disc the frame laid, as the numbers `ctx.arc` was handed plus the alpha it went
  // out under — which is the whole of what a decal is.
  const discs = (ctx: { calls: Call[] }) =>
    ctx.calls
      .filter((c) => c.fn === "arc")
      .map((c) => ({ args: c.args as number[], alpha: c.alpha, fill: c.fill }));

  test("lays one disc per mark, in vibrant red", () => {
    const marks = [
      { pos: ON, at: 1_000, radius: 4 },
      { pos: { x: 1_250, y: 1_250 }, at: 1_000, radius: 32 },
    ];
    const laid = discs(bled(marks));
    expect(laid.map((d) => d.args.slice(0, 3))).toEqual([
      [ON.x, ON.y, 4],
      [1_250, 1_250, 32],
    ]);
    // The one place the black-and-white theme is broken on purpose (#140), so it may not be ink.
    expect(new Set(laid.map((d) => d.fill))).toEqual(new Set([BLOOD]));
  });

  test("costs the frame nothing at all when nothing has bled", () => {
    const bare = spyCtx();
    drawWorld(bare, bleeding, { camera, viewport, now: 1_000, sprites });
    expect(bled([]).calls.map((c) => c.fn)).toEqual(bare.calls.map((c) => c.fn));
  });

  // It is on the ground, so everything that stands on the ground has to paint over it — the
  // opposite of the burst and the puff, which are events and go over the sort.
  test("is laid under everything standing on it", () => {
    const ctx = bled([{ pos: ON, at: 1_000, radius: 4 }]);
    const bodyCall = ctx.calls.findIndex(
      (c) => c.fn === "drawImage" && (c.args[0] as { tag: string }).tag.startsWith("bloodling/"),
    );
    const laid = ctx.calls.findIndex((c) => c.fn === "fill");
    expect(bodyCall).toBeGreaterThan(0); // the spider is in this frame, or the order says nothing
    expect(laid).toBeGreaterThan(0);
    expect(laid).toBeLessThan(bodyCall);
  });

  // The floor is the layer most exposed to the count, and a decal list is the longest one in the
  // frame: `docs/frame-budget.md` rule 1 charges a mark by the pieces it is struck in, so the paths
  // are held to the bands and only the discs ride the count.
  test("bundles the whole layer into one path per fade band, not one per mark", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      pos: { x: 1_050 + i * 10, y: 1_400 },
      at: 1_000 - i * 40,
      radius: 4,
    }));
    const ctx = bled(many);
    expect(discs(ctx)).toHaveLength(60);
    expect(ctx.calls.filter((c) => c.fn === "fill")).toHaveLength(BLOOD_BANDS);
  });

  test("a mark dries as it ages: the older it is the fainter it goes", () => {
    const fresh = { pos: ON, at: 1_000, radius: 4 };
    const old = { pos: { x: 1_100, y: 1_200 }, at: 1_000 - BLOOD_FADE_MS * 0.9, radius: 4 };
    const laid = discs(bled([fresh, old]));
    const alphaAt = (x: number) => laid.find((d) => d.args[0] === x)?.alpha ?? 0;
    expect(alphaAt(ON.x)).toBe(1);
    expect(alphaAt(1_100)).toBeGreaterThan(0);
    expect(alphaAt(1_100)).toBeLessThan(1);
  });

  test("leaves the drawing state as it found it, so nothing after it inherits an alpha", () => {
    const ctx = bled([{ pos: ON, at: 1_000 - BLOOD_FADE_MS * 0.9, radius: 4 }]);
    expect(ctx.calls[ctx.calls.length - 1].alpha).toBe(1);
  });

  // A trail is laid where a bloodling ran, which is anywhere in a 31,200² arena; the camera is over
  // 800 × 600 of it. Culled before the geometry is built, so a mark nobody can see costs no arcs.
  test("lays nothing for a mark the camera cannot see", () => {
    expect(discs(bled([{ pos: { x: 9_000, y: 9_000 }, at: 1_000, radius: 32 }]))).toEqual([]);
  });
});

// #134: the mini-tutorial's world-anchored half. Three of its six prompts are about things standing
// in the world — an ore tile, the tile under the cursor, the turret you just put up — so they move
// with the camera and are drawn here. The other two are the HUD's.
describe("#134: the tutorial's marks", () => {
  const ORE_TILE: Tile = { tx: 70, ty: 70 }; // (1050, 1050): inside the camera above
  const TURRET_TILE: Tile = { tx: 74, ty: 70 };
  const oreCentre = { x: ORE_TILE.tx * TILE + TILE / 2, y: ORE_TILE.ty * TILE + TILE / 2 };
  const CURSOR = { x: 1300, y: 1250 };

  const tutorial = (marks: Partial<TutorialMarks> = {}): TutorialMarks => ({
    ore: null,
    cursor: null,
    turret: null,
    ...marks,
  });

  const drawn = (marks: Partial<TutorialMarks>, sprites?: SpriteSource) => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport, sprites, tutorial: tutorial(marks) });
    return ctx;
  };

  // Every word the frame wrote, in order, so a wrapped sentence can be read back whole.
  const written = (ctx: { calls: Call[] }) =>
    ctx.calls.filter((c) => c.fn === "fillText").map((c) => c.args[0] as string);

  test("marks the ore tile with the highlight sprite, centred on it", () => {
    const ctx = drawn(
      { ore: { tile: ORE_TILE, words: MINE_WORDS } },
      stubSprites({ highlight: 30 }),
    );
    const mark = blits(ctx).find((b) => b.tag.startsWith("highlight/"));
    // An overlay hangs off its centre, like the halo and the turret's lightning — it marks the tile
    // rather than standing on it. Within the device-pixel snap every blit in this file lands on.
    expect(mark?.width).toBe(30);
    expect(mark?.height).toBe(30);
    expect(Math.abs((mark?.x ?? 0) + 15 - oreCentre.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((mark?.y ?? 0) + 15 - oreCentre.y)).toBeLessThanOrEqual(0.5);
  });

  // The seam a sprite drops into is one lookup, exactly as every other entity's is: until
  // `src/sprite/highlight.ts` lands the mark falls back to a plain ink ring, so the tutorial is
  // legible from the day it ships rather than from the day the art does.
  test("falls back to a ring where the highlight art has not landed", () => {
    const ctx = drawn({ ore: { tile: ORE_TILE, words: MINE_WORDS } });
    expect(blits(ctx).some((b) => b.tag.startsWith("highlight/"))).toBe(false);
    const rings = ctx.calls.filter(
      (c) => c.fn === "arc" && c.args[0] === oreCentre.x && c.args[1] === oreCentre.y,
    );
    expect(rings.length).toBe(1);
  });

  test("writes prompt 1 over the tile it marked, cut out of paper like every other word", () => {
    const ctx = drawn({ ore: { tile: ORE_TILE, words: MINE_WORDS } });
    const filled = ctx.calls.find((c) => c.fn === "fillText" && c.args[0] === MINE_WORDS);
    const stroked = ctx.calls.find((c) => c.fn === "strokeText" && c.args[0] === MINE_WORDS);
    expect(filled?.fill).toBe("#000");
    expect(stroked?.stroke).toBe("#ffffff"); // paper, so it reads over a spider standing on the ore
    expect(filled?.args[2] as number).toBeLessThan(ORE_TILE.ty * TILE); // above the tile, not on it
  });

  test("writes the hover tooltip at the cursor", () => {
    const ctx = drawn({ cursor: { at: CURSOR, words: METAL_WORDS.taught } });
    const at = ctx.calls.find((c) => c.fn === "fillText" && c.args[0] === METAL_WORDS.taught);
    expect(at).toBeDefined();
    expect(at?.args[2] as number).toBeLessThan(CURSOR.y); // clear of the pointer itself
  });

  test("writes prompt 5 over the turret, whole, however many lines it takes", () => {
    const ctx = drawn(
      { turret: { tile: TURRET_TILE, words: TURRET_WORDS } },
      stubSprites({ generator: 75, "ore-power": 15 }),
    );
    const sentence = written(ctx)
      .filter((word) => !["Ana", "Ben"].includes(word))
      .join(" ");
    expect(sentence).toBe(
      "Turrets require energy. Build a generator on top of power ore in order to generate electricity",
    );
    // The sentence wraps rather than running off the screen in one line.
    expect(written(ctx).length).toBeGreaterThan(3);
  });

  test("blits prompt 5's two icons inline, one per placeholder, at one size", () => {
    const ctx = drawn(
      { turret: { tile: TURRET_TILE, words: TURRET_WORDS } },
      stubSprites({ generator: 75, "ore-power": 15 }),
    );
    const inline = blits(ctx).filter(
      (b) => b.tag.startsWith("generator/") || b.tag.startsWith("ore-power/"),
    );
    expect(inline.map((b) => b.tag)).toEqual(["generator/0/0", "ore-power/0/0"]);
    // Sized to the line rather than to the sprite's own box: a 75 px generator and a 15 px ore tile
    // have to sit as one thing inside a sentence.
    expect(inline[0].width).toBe(inline[1].width);
    expect(inline[0].width).toBe(inline[0].height);
  });

  test("says the sentence without its icons where that art has not landed", () => {
    const ctx = drawn({ turret: { tile: TURRET_TILE, words: TURRET_WORDS } });
    expect(
      written(ctx)
        .filter((word) => !["Ana", "Ben"].includes(word))
        .join(" "),
    ).toBe(
      "Turrets require energy. Build a generator on top of power ore in order to generate electricity",
    );
  });

  test("paints over the world, so nothing standing in it can bury a prompt", () => {
    const ctx = drawn({ ore: { tile: ORE_TILE, words: MINE_WORDS } });
    const words = written(ctx);
    expect(words.indexOf(MINE_WORDS)).toBeGreaterThan(words.indexOf("Ana"));
    expect(words.indexOf(MINE_WORDS)).toBeGreaterThan(words.indexOf("Ben"));
  });

  test("a frame with no tutorial in it draws none of this", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    expect(written(ctx)).toEqual(["Ana", "Ben"]);
  });
});

// #92: the camera's zoom, folded into the transform the caller paints through. `drawWorld` never
// sees that transform — it draws in world units and always has — so the zoom reaches it as exactly
// two things: a `viewport` that is now the *world* rectangle on screen, and the device scale a blit
// has to land on.
describe("the camera's zoom", () => {
  const boxes = { nest: 96, player: 28, grunt: 32 };
  // Fractional positions on both axes, because a sprite already sitting on a whole device pixel
  // cannot show whether it was snapped to the right one.
  const drifting: WorldSnapshot = {
    ...world,
    players: [
      {
        ...POSE,
        id: "p1",
        slot: 1,
        name: "Ana",
        pos: { x: 1100.4, y: 1100.7 },
        radius: 14,
        hp: 100,
      },
      {
        ...POSE,
        id: "p2",
        slot: 2,
        name: "Ben",
        pos: { x: 1207.3, y: 1152.9 },
        radius: 14,
        hp: 100,
      },
    ],
    enemies: [
      { ...POSE, id: "e1", kind: "grunt", pos: { x: 1150.1, y: 1200.6 }, radius: 16, hp: 30 },
    ],
    nests: [
      { id: "n1", pos: { x: 1090.8, y: 1090.2 }, radius: 48, maxHp: 600, hp: 600, alive: true },
    ],
  };
  const zooms = [0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  // How far a device coordinate is off the whole pixel it should be on, with the float dust the
  // snap's own arithmetic leaves swept away: anything within a thousandth of a pixel reads here as
  // zero, and anything a *half* pixel out — what ADR 0008 measured — reads as itself.
  const offPixel = (device: number) => (Math.abs(device - Math.round(device)) < 0.001 ? 0 : device);
  const at = (zoom: number, dpr: number) => {
    const ctx = spyCtx();
    drawWorld(ctx, drifting, {
      camera,
      viewport: worldViewport(viewport, zoom),
      zoom,
      dpr,
      selfId: "p1",
      sprites: stubSprites(boxes),
    });
    return ctx;
  };

  // ADR 0008's loudest measurement: a bake that *is* the right size, landed half a device pixel
  // off, reads 17.9–41.0 RMSE against the ideal — worse than every resampling candidate it
  // rejected, at every zoom. `snap` is the only thing standing between the bake decision and that,
  // and the scale it has to snap to is `dpr × zoom`, never `dpr`.
  test("lands every blit on a whole device pixel, at every zoom and every ratio", () => {
    for (const dpr of [1, 2, 3]) {
      for (const zoom of zooms) {
        const scale = dpr * zoom;
        for (const blit of blits(at(zoom, dpr))) {
          const device = { x: (blit.x - camera.x) * scale, y: (blit.y - camera.y) * scale };
          // Whole device pixels, to well inside the width of one: what the ADR measured is a *half*
          // pixel, and the arithmetic that puts a corner back on the grid carries a float's worth
          // of dust with it.
          expect({ dpr, zoom, off: offPixel(device.x) }).toEqual({ dpr, zoom, off: 0 });
          expect({ dpr, zoom, off: offPixel(device.y) }).toEqual({ dpr, zoom, off: 0 });
        }
      }
    }
  });

  test("snapping to the ratio alone would put a sprite half a device pixel out", () => {
    // The control for the test above: at 0.5× and dpr 1 the device scale is 0.5, so rounding on the
    // ratio leaves every odd world unit on a half pixel. If this ever passes, the test above is
    // asserting nothing.
    const unsnapped = 1100.4;
    expect((Math.round(unsnapped - camera.x) - (unsnapped - camera.x)) * 0.5).not.toBe(0);
  });

  test("draws a sprite into its world box, so it is the same size in the world at every zoom", () => {
    for (const zoom of zooms) {
      const player = blits(at(zoom, 2)).find((b) => b.tag.startsWith("player/"));
      expect({ zoom, width: player?.width }).toEqual({ zoom, width: 28 });
    }
  });

  test("clears and fills the world the screen actually reaches", () => {
    const ctx = at(0.5, 2);
    const clear = ctx.calls.find((c) => c.fn === "clearRect");
    expect(clear?.args).toEqual([camera.x, camera.y, 1600, 1200]);
  });

  test("the corner map is chrome and holds its size on screen at every zoom", () => {
    for (const zoom of zooms) {
      const world = worldViewport(viewport, zoom);
      const plate = MINIMAP_SIZE / zoom;
      const ctx = at(zoom, 2);
      const paper = ctx.calls[mapStart(ctx, plate)];
      // The plate's world box shrinks as the zoom grows, which is what leaves it 200 CSS px across.
      expect({ zoom, side: paper.args[2] }).toEqual({ zoom, side: plate });
      expect((paper.args[2] as number) * zoom).toBeCloseTo(MINIMAP_SIZE, 9);
      // And it stays in the corner it was put in, the same distance off the screen's own edge.
      const rightEdge = camera.x + world.width - (paper.args[0] as number) - plate;
      expect(rightEdge * zoom).toBeCloseTo(MINIMAP_MARGIN, 6);
    }
  });

  test("the map's marks hold their size on the plate, so it reads the same at every zoom", () => {
    // A squad dot is a fixed mark on the plate (#93) — the world is never drawn smaller onto it —
    // so at 0.5× it is drawn twice as wide in world units and comes out the same on screen.
    const dot = (zoom: number) => {
      const ctx = at(zoom, 2);
      const arcs = ctx.calls
        .slice(mapStart(ctx, MINIMAP_SIZE / zoom))
        .filter((c) => c.fn === "arc");
      return (arcs[0].args[2] as number) * zoom;
    };
    expect(dot(0.5)).toBeCloseTo(dot(1), 9);
    expect(dot(3)).toBeCloseTo(dot(1), 9);
  });

  test("a frame with no zoom in it is the 1:1 frame the game has always drawn", () => {
    const zoomed = spyCtx();
    drawWorld(zoomed, drifting, {
      camera,
      viewport,
      zoom: 1,
      dpr: 2,
      selfId: "p1",
      sprites: stubSprites(boxes),
    });
    const plain = spyCtx();
    drawWorld(plain, drifting, {
      camera,
      viewport,
      dpr: 2,
      selfId: "p1",
      sprites: stubSprites(boxes),
    });
    expect(blits(zoomed)).toEqual(blits(plain));
    expect(zoomed.calls.length).toBe(plain.calls.length);
  });
});
