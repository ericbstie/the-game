import { describe, expect, test } from "bun:test";
import type { BuildableKind, WorldSnapshot } from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import type { SpriteName } from "../sprite/registry";
import { tileKey } from "./build";
import type { Camera, Viewport } from "./camera";
import { drawWorld, grassAt, type ShotSource } from "./draw";

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

  test("an ore tile's variant is its position, so no two neighbours draw the same cell", () => {
    // The variant is `(tx mod 12) * 12 + (ty mod 12)`, not a hash. A hash is uniform but tells a
    // tile nothing about who it sits next to, so every mark stays boxed in its own cell and a
    // measurable ink deficit forms on the grid pitch. Position lets a tile derive its neighbours'
    // cells and draw a mark that straddles a seam identically from both sides. 12 is past the
    // widest patch the generator can grow, so no patch can contain a cell twice.
    const ore = new Map<number, "metal" | "power">();
    for (let ty = 70; ty < 78; ty++)
      for (let tx = 70; tx < 78; tx++) ore.set(tileKey({ tx, ty }), "metal");
    const ctx = spyCtx();
    drawWorld(
      ctx,
      { ...standing, players: [], enemies: [], nests: [], ore },
      { camera, viewport, sprites: stubSprites({ ...everything, "ore-metal": 15 }) },
    );
    const at = (tx: number, ty: number) =>
      blits(ctx).find((b) => b.x === tx * 15 && b.y === ty * 15)?.tag;
    // The exact formula, not merely "distinct" — a hash also gives distinct values here, so an
    // assertion about distinctness would pass with the property this indexing exists for removed.
    expect(at(72, 73)).toBe(`ore-metal/${(72 % 12) * 12 + (73 % 12)}/0`);
    expect(at(72, 73)).not.toBe(at(73, 73)); // neighbours never share a cell
    expect(at(72, 73)).not.toBe(at(72, 74));
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
  const none = { peers: [], own: null, resolve: live };

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
