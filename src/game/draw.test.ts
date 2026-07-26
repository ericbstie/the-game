import { describe, expect, test } from "bun:test";
import type { WorldSnapshot } from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import type { SpriteName } from "../sprite/registry";
import { tileKey } from "./build";
import type { Camera, Viewport } from "./camera";
import { drawWorld, grassAt } from "./draw";

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
    expect(withHalo.calls.filter((c) => c.fn === "stroke").length).toBe(0);

    const withoutHalo = spyCtx();
    drawWorld(withoutHalo, one, { ...options, sprites: stubSprites(everything) });
    expect(withoutHalo.calls.filter((c) => c.fn === "stroke").length).toBe(1);
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
    const doors = blits(ctx).filter((b) => b.tag === "room/4/0");
    expect(doors.map((d) => d.y)).toEqual([60, 90]); // the two segments the exit spans
  });

  test("keeps the M2 outline and exit rect until the room sprite lands", () => {
    const ctx = spyCtx();
    drawWorld(ctx, standing, { camera, viewport, sprites: stubSprites(everything) });
    expect(ctx.calls.some((c) => c.fn === "strokeRect" && c.args[0] === 2)).toBe(true);
    expect(ctx.calls.some((c) => c.fn === "fillRect" && c.args[1] === 1100)).toBe(true);
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
