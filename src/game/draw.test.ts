import { describe, expect, test } from "bun:test";
import type {
  Avatar,
  BuildableKind,
  OreKind,
  RenderedEnemy,
  Tile,
  Vec2,
  WorldSnapshot,
} from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import type { SpriteName } from "../sprite/registry";
import { tileKey, tileOf } from "./build";
import type { Camera, Viewport } from "./camera";
import { drawWorld, grassAt, type ShotSource } from "./draw";
import { FLOAT_MS, type MetalFloat } from "./floats";
import {
  MINIMAP_COVERAGE_U,
  MINIMAP_ORE_CELL_U,
  MINIMAP_SIZE,
  minimapWindow,
  projectRect,
} from "./minimap";

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
}
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
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

// Where a stroked line went, in world coordinates. `moveTo`/`lineTo` are recorded like everything
// else, so a shot line reads off the log as the pair of points it was drawn from.
const lines = (ctx: { calls: Call[] }) => {
  const drawn: { from: [number, number]; to: [number, number] }[] = [];
  let from: [number, number] | null = null;
  for (const c of ctx.calls) {
    if (c.fn === "moveTo") from = c.args as [number, number];
    else if (c.fn === "lineTo" && from) drawn.push({ from, to: c.args as [number, number] });
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
const mapStart = (ctx: { calls: Call[] }) => {
  for (let i = ctx.calls.findIndex((c) => c.fn === "clip"); i >= 0; i--) {
    const c = ctx.calls[i];
    if (c.fn === "fillRect" && c.args[2] === MINIMAP_SIZE && c.args[3] === MINIMAP_SIZE) return i;
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
  players: [
    { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 100 },
    { ...POSE, id: "p2", slot: 2, name: "Ben", pos: { x: 1200, y: 1150 }, radius: 14, hp: 100 },
  ],
  enemies: [],
  nests: [
    { id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, hp: 600, alive: true, sector: 0 },
    { id: "n2", pos: { x: 20_000, y: 20_000 }, radius: 48, hp: 600, alive: true, sector: 1 }, // off-screen
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
      nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, hp: 0, alive: false, sector: 0 }],
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
    nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, hp: 600, alive: true, sector: 0 }],
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
      nests: [{ id: "n1", pos: { x: 1100, y: 1010 }, radius: 48, hp: 600, alive: true, sector: 0 }],
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
      nests: [{ id: "n1", pos: { x: 1090, y: 1090 }, radius: 48, hp: 0, alive: false, sector: 0 }],
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
    drawWorld(ctx, world, { camera, viewport, sprites: stubSprites({ grass: 10, player: 28 }) });
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
  // it got none — and at NEST_HP 600 it is the longest single fight in the game, and the one
  // readout with real tactical weight, since killing a nest is how a sector is silenced.
  test("shows one on a damaged nest — the longest fight in the game had no progress at all", () => {
    const nest = { id: "n1", pos: { x: 1150, y: 1150 }, radius: 48, alive: true, sector: 0 };
    expect(drawn({ nests: [{ ...nest, hp: 600 }] }).frames).toEqual([]); // untouched, as ever
    const { frames, interiors } = drawn({ nests: [{ ...nest, hp: 300 }] });
    expect(frames.length).toBe(1);
    expect(frames[0].args[2]).toBe(96); // the nest's own width, like every other bar
    expect(interiors[0].args[2]).toBe(47); // half the 94 interior px
  });

  test("a silenced nest shows none — it is wreckage, not a fight in progress", () => {
    expect(
      drawn({
        nests: [
          { id: "n1", pos: { x: 1150, y: 1150 }, radius: 48, hp: 0, alive: false, sector: 0 },
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

// One continuous ink line from a shooter to what it hit, for your own shots, your squadmates' and
// your turrets' alike (#81). Two constraints shape every test here: the line may never depict
// damage the server did not apply (#74 §7), and it is the most expensive thing in the frame per
// unit, so its 100 ms lifetime is enforced rather than assumed.
describe("shot lines", () => {
  const shooter = {
    ...POSE,
    id: "p1",
    slot: 1,
    name: "Ana",
    pos: { x: 1100, y: 1100 },
    radius: 14,
    hp: 100,
  };
  const grunt = {
    ...POSE,
    id: "e1",
    kind: "grunt" as const,
    pos: { x: 1300, y: 1200 },
    radius: 16,
  };
  const field: WorldSnapshot = {
    ...world,
    players: [shooter],
    enemies: [{ ...grunt, hp: 30 }],
    nests: [],
    structures: [],
  };
  const live = (id: string) => (id === "e1" ? grunt.pos : null);
  const fire = (patch: Partial<WorldSnapshot>, shots: ShotSource, now = 1000) => {
    const ctx = spyCtx();
    drawWorld(ctx, { ...field, ...patch }, { camera, viewport, now, shots });
    return lines(ctx);
  };
  const none = { peers: [], own: null, resolve: live, ammo: 9 };

  test("draws your own shot where you fired it, without waiting for the relay", () => {
    const drawn = fire({}, { ...none, own: { at: 960, from: shooter.pos, dir: { x: 1, y: 0 } } });
    expect(drawn.length).toBe(1);
    expect(drawn[0].from).toEqual([1100, 1100]);
    expect(drawn[0].to[0]).toBeGreaterThan(1100); // out along the aim, to the weapon's full reach
    expect(drawn[0].to[1]).toBe(1100);
  });

  test("retires a line after its 100 ms, whoever fired it", () => {
    const own = { at: 900, from: shooter.pos, dir: { x: 1, y: 0 } };
    expect(fire({}, { ...none, own }, 999).length).toBe(1);
    expect(fire({}, { ...none, own }, 1000).length).toBe(0);
    const peer = { shot: { id: "p1", dir: { x: 1, y: 0 }, hit: "e1" }, at: 900 };
    expect(fire({}, { ...none, peers: [peer] }, 999).length).toBe(1);
    expect(fire({}, { ...none, peers: [peer] }, 1000).length).toBe(0);
  });

  test("ends a squadmate's shot on what the server says it hit", () => {
    const drawn = fire(
      {},
      { ...none, peers: [{ shot: { id: "p1", dir: { x: 1, y: 0 }, hit: "e1" }, at: 1000 }] },
    );
    expect(drawn).toEqual([{ from: [1100, 1100], to: [1300, 1200] }]);
  });

  // The authority invariant. A target id outlives its target by one tick in two places — a turret
  // still names the enemy it just killed until it re-targets, and a killing shot rides the same
  // delta as the death it caused — so a line drawn on an unresolvable id would be damage nobody
  // applied. `shotTargetPos` answers null for both, and that is where the line stops.
  test("draws nothing at all when the target no longer resolves", () => {
    const gone = { ...none, resolve: () => null };
    expect(
      fire(
        {},
        { ...gone, peers: [{ shot: { id: "p1", dir: { x: 1, y: 0 }, hit: "e1" }, at: 1000 }] },
      ),
    ).toEqual([]);
    expect(
      fire(
        {
          structures: [
            {
              id: "b1",
              kind: "turret",
              tile: { tx: 74, ty: 74 },
              hp: 250,
              turret: { powered: true, targetId: "e1" },
            },
          ],
        },
        gone,
      ),
    ).toEqual([]);
  });

  // A hitscan ray at 24 half-width over 700 units misses often, and a squadmate firing into empty
  // air with no line looks broken (#74 §6). A miss names no target, so there is nothing to falsify.
  test("still draws a shot that hit nothing, out to full range", () => {
    const drawn = fire(
      {},
      { ...none, peers: [{ shot: { id: "p1", dir: { x: 0, y: 1 } }, at: 1000 }] },
    );
    expect(drawn.length).toBe(1);
    expect(drawn[0].to[1]).toBeGreaterThan(1100);
  });

  test("ignores a shot from a peer who is no longer in the world", () => {
    expect(
      fire(
        {},
        { ...none, peers: [{ shot: { id: "p9", dir: { x: 1, y: 0 }, hit: "e1" }, at: 1000 }] },
      ),
    ).toEqual([]);
  });

  // No per-shot event arrives for a turret — only its `(target, powered)` transition does — so the
  // client generates the pulse train itself: one pulse per 200 ms cadence, each lasting 100 ms.
  describe("a turret's generated pulse train", () => {
    const turreted = (turret: { powered: boolean; targetId: string | null }) => ({
      structures: [
        { id: "b1", kind: "turret" as const, tile: { tx: 74, ty: 74 }, hp: 250, turret },
      ],
    });

    test("pulses for half of each cadence, so it reads as shots and not as a beam", () => {
      const engaged = turreted({ powered: true, targetId: "e1" });
      expect(fire(engaged, none, 1000).length).toBe(1);
      expect(fire(engaged, none, 1099).length).toBe(1);
      expect(fire(engaged, none, 1100).length).toBe(0);
      expect(fire(engaged, none, 1200).length).toBe(1);
    });

    test("fires from the middle of the turret's own footprint", () => {
      expect(fire(turreted({ powered: true, targetId: "e1" }), none, 1000)).toEqual([
        { from: [1125, 1125], to: [1300, 1200] },
      ]);
    });

    test("draws nothing for a turret with no target or no power", () => {
      expect(fire(turreted({ powered: true, targetId: null }), none, 1000)).toEqual([]);
      expect(fire(turreted({ powered: false, targetId: "e1" }), none, 1000)).toEqual([]);
    });

    // #102 stage 4: a turret shoots the squad's bullets, and the server holds its fire when there
    // are none. Nothing else would stop the train — it is generated from a state that says nothing
    // about ammo — so an empty pool would otherwise draw shots nobody took (ADR 0003).
    test("draws nothing while the squad's pool is empty and its fire is held", () => {
      const engaged = turreted({ powered: true, targetId: "e1" });
      expect(fire(engaged, { ...none, ammo: 0 }, 1000)).toEqual([]);
      expect(fire(engaged, { ...none, ammo: 1 }, 1000)).toHaveLength(1);
    });

    // The gate is the turret's alone. Your own line is optimistic by decision and drawn at the
    // click; a squadmate's is a shot the server has already admitted and already paid for.
    test("an empty pool withholds no line the server has already resolved", () => {
      const dry = { ...none, ammo: 0 };
      expect(
        fire({}, { ...dry, own: { at: 960, from: shooter.pos, dir: { x: 1, y: 0 } } }),
      ).toHaveLength(1);
      const peer = { shot: { id: "p1", dir: { x: 1, y: 0 }, hit: "e1" }, at: 1000 };
      expect(fire({}, { ...dry, peers: [peer] })).toHaveLength(1);
    });
  });

  test("costs nothing when the render layer has no shots to draw", () => {
    const ctx = spyCtx();
    drawWorld(ctx, field, { camera, viewport, now: 1000 });
    expect(lines(ctx)).toEqual([]);
  });

  // A line can be long enough to cross the whole viewport, so it is culled on the box it spans and
  // not on either end: a turret off one edge firing at a nest off the other still crosses the middle
  // of the screen. Only a shot with nothing of it on screen is skipped.
  test("culls a shot the camera cannot see any part of", () => {
    const far = {
      ...POSE,
      id: "p2",
      slot: 2,
      name: "Ben",
      pos: { x: 9000, y: 9000 },
      radius: 14,
      hp: 100,
    };
    expect(
      fire(
        { players: [far] },
        {
          ...none,
          peers: [{ shot: { id: "p2", dir: { x: 1, y: 0 }, hit: "e2" }, at: 1000 }],
          resolve: () => ({ x: 9500, y: 9000 }),
        },
      ),
    ).toEqual([]);
    expect(
      fire(
        { players: [far] },
        { ...none, peers: [{ shot: { id: "p2", dir: { x: -1, y: 0 }, hit: "e1" }, at: 1000 }] },
      ).length,
    ).toBe(1);
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
      sector: 0,
    }));
    const bare = spyCtx();
    const swarmed = spyCtx();
    drawWorld(bare, world, { camera, viewport, selfId: "p1" });
    drawWorld(swarmed, { ...world, enemies: swarm }, { camera, viewport, selfId: "p1" });
    expect(mapCalls(swarmed)).toHaveLength(mapCalls(bare).length);
  });

  test("writes nothing anywhere on it", () => {
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...world, exitRevealed: true, structures: [struct("s1", "turret", { tx: 74, ty: 74 })] },
      { camera, viewport, selfId: "p1" },
    );
    expect(mapCalls(ctx).some((c) => c.fn === "fillText" || c.fn === "strokeText")).toBe(false);
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
      { id: "n1", pos: near(SELF.pos, 500), radius: 48, hp: 600, alive: true, sector: 0 },
      { id: "n2", pos: near(SELF.pos, -500), radius: 48, hp: 0, alive: false, sector: 1 },
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

  test("projects onto the same plate at dpr 1, 2 and 3, and at any viewport size", () => {
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
        drawWorld(ctx, world, { camera, viewport: view, selfId: "p1", dpr });
        const win = minimapWindow(SELF.pos, camera, view, MINIMAP_COVERAGE_U);
        const x = onDevicePixel(win.x, camera.x, dpr);
        const y = onDevicePixel(win.y, camera.y, dpr);
        expect(mapCalls(ctx)[0].args.slice(0, 4)).toEqual([x, y, MINIMAP_SIZE, MINIMAP_SIZE]);
        const self = mapDiscs(ctx).find((d) => d.fill === "#4f8cff");
        expect(self?.x).toBeCloseTo(x + MINIMAP_SIZE / 2, 6);
        expect(self?.y).toBeCloseTo(y + MINIMAP_SIZE / 2, 6);
      }
    }
  });

  // A frame with something of every layer pressed against the rim of the window, which is the only
  // place a projection that was off by anything at all would put ink on the floor beside the map.
  const crowded = () => {
    const centre = { x: 15_600, y: 15_600 };
    const cam = { x: centre.x - viewport.width / 2, y: centre.y - viewport.height / 2 };
    const win = minimapWindow(centre, cam, viewport, MINIMAP_COVERAGE_U);
    const edge = MINIMAP_COVERAGE_U / 2 - 1; // a world unit inside the window, on every side
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
      hp: alive ? 600 : 0,
      alive,
      sector: 0,
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
      nests: [nest("n1", -edge, -edge, true), nest("n2", edge, edge, false)],
      ore,
      structures: [rimTx, rimTx + 1, rimTx + 2].map((tx, i) =>
        struct(`s${i}`, "wall", { tx, ty: rimTy + cellTiles * 2 }),
      ),
      // A door straddling the rim, so the clipped bar is drawn as well as the whole one.
      exit: { x: win.worldX - 50, y: centre.y - 400, width: 98, height: 936 },
      exitRevealed: true,
    };
    const ctx = spyCtx();
    drawWorld(ctx, snapshot, { camera: cam, viewport, selfId: "p1" });
    return { ctx, win };
  };

  test("keeps every layer inside the plate", () => {
    const { ctx, win } = crowded();
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
