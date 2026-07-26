import { describe, expect, test } from "bun:test";
import type { WorldSnapshot } from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import type { SpriteName } from "../sprite/registry";
import type { Camera, Viewport } from "./camera";
import { drawWorld } from "./draw";

// happy-dom returns null from getContext('2d'), so the draw path is exercised against a
// spy that records the calls and lets any property be assigned.
interface Call {
  fn: string;
  args: unknown[];
}
function spyCtx() {
  const calls: Call[] = [];
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  const ctx = {
    calls,
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    beginPath: record("beginPath"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillText: record("fillText"),
    drawImage: record("drawImage"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

// A sprite source standing in for baked art: every requested name resolves, and each image is
// tagged so a call log says *which* sprite was blitted and in what order. Sprites the game has
// not been given fall through to the shapes it has drawn since M2, which is what a name left out
// of `boxes` reproduces.
function stubSprites(boxes: Partial<Record<SpriteName, number>>): SpriteSource {
  return (name, facing, frame) => {
    const size = boxes[name];
    if (size === undefined) return null;
    const image = { tag: `${name}/${facing}/${frame}` } as unknown as CanvasImageSource;
    return { image, size } satisfies BakedSprite;
  };
}

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
// Facing and walk frame are derived in ClientWorld, not here — drawWorld reads them off the
// snapshot, so any value serves these fixtures.
const POSE = { facing: 2, frame: 0 };

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

  test("draws the exit rectangle in world coordinates", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    expect(
      ctx.calls.some((c) => c.fn === "fillRect" && c.args[0] === 0 && c.args[1] === 1100),
    ).toBe(true);
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

  test("a downed (0 HP) self avatar still draws but drops its self-ring (corpse)", () => {
    const ctx = spyCtx();
    const withCorpse: WorldSnapshot = {
      ...world,
      players: [
        { ...POSE, id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14, hp: 0 },
      ],
      nests: [],
    };
    drawWorld(ctx, withCorpse, { selfId: "p1", camera, viewport });
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(1); // the corpse circle is drawn
    expect(ctx.calls.filter((c) => c.fn === "stroke").length).toBe(0); // but no self-ring stroke()
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
      "player/0/0",
      "player/0/0",
      "grunt/0/0",
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
    expect(blits(ctx)[0]).toEqual({ tag: "player/0/0", x: 1086, y: 1072, width: 28, height: 28 });
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
    expect(blits(ctx).map((b) => b.tag)).toEqual(["player/0/0", "player/0/0"]);
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(2); // the nest and the grunt
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
