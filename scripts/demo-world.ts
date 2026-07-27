import { type OreGrid, TILE, tileKey } from "../src/game/build";
import type { BuildGhost, ShotSource } from "../src/game/draw";
import { ELITE_HP } from "../src/game/enemies";
import type { Tile, Vec2, WorldSnapshot } from "../src/lobby/protocol";

// A local copy rather than exporting the sim's: this is a fixture, and widening `build.ts`'s
// surface so a screenshot script can borrow a private helper is the wrong trade.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A hand-built world for `sprite:frame` to paint. Not a fixture for `bun test` and not the real
// game's state: a scene arranged so that the two things Milestone 5 changed about the draw order
// are visible in one picture, and wrong in an obvious way if either regresses.
//
// - Three avatars on a short diagonal, close enough that their boxes overlap. Whichever is lower
//   on screen has to cover the one behind it.
// - A grunt standing on the generator. The generator is drawn flat, from above, so it belongs to
//   the floor no matter where its own front edge falls.
// - A nest above the avatars and an elite below them, so the sort has to cross entity kinds
//   rather than just order within one.
//
// It also carries one of everything the render layer draws *over* the world rather than in it, for
// the same reason: a health bar, a shot line from each of the three shooters, a turret's unpowered
// lightning and a refused build ghost either appear in the picture or they do not.
//
// Browser-safe on purpose: it is bundled into the page, so it touches no filesystem and no DOM.

export const DEMO_VIEWPORT = { width: 800, height: 600 };
export const DEMO_CAMERA = { x: 15_400, y: 15_400 };
export const DEMO_SELF = "p2";

// The clock the scene is frozen at, chosen so the two things that alternate on it are both in their
// visible phase: a turret's pulse train is up for the first 100 ms of each 200 ms cadence, and the
// unpowered lightning is on for even 400 ms flashes.
export const DEMO_NOW = 1_000;

export function demoWorld(): WorldSnapshot {
  return {
    arena: { width: 31_200, height: 31_200 },
    players: [
      {
        id: "p1",
        slot: 1,
        name: "Ana",
        pos: { x: 15_620, y: 15_640 },
        facing: 2,
        frame: 0,
        radius: 14,
        hp: 62, // wounded, so a peer's bar is in the picture
      },
      {
        id: "p2",
        slot: 2,
        name: "Ben",
        pos: { x: 15_632, y: 15_662 },
        facing: 2,
        frame: 0,
        radius: 14,
        hp: 100,
      },
      {
        id: "p3",
        slot: 3,
        name: "Cy",
        pos: { x: 15_644, y: 15_684 },
        facing: 2,
        frame: 0,
        radius: 14,
        hp: 100,
      },
    ],
    enemies: [
      {
        id: "e1",
        kind: "grunt",
        pos: { x: 15_680, y: 15_500 },
        facing: 2,
        frame: 0,
        radius: 16,
        hp: 30,
        flashing: false,
      },
      {
        id: "e2",
        kind: "grunt",
        pos: { x: 15_480, y: 15_840 },
        facing: 2,
        frame: 0,
        radius: 16,
        hp: 11, // a grunt two thirds of the way down
        // Mid hit flash, and one of each kind carries it: the flash inverts a silhouette against
        // white paper, and whether it stays *readable* there can only be looked at (#107). A grunt
        // is mostly leg and an elite mostly body, so one of them says nothing about the other.
        flashing: true,
      },
      {
        id: "e3",
        kind: "elite",
        pos: { x: 15_900, y: 15_780 },
        facing: 2,
        frame: 0,
        radius: 24,
        hp: 120,
        flashing: true,
      },
      {
        // The same elite, same facing, same frame, standing alongside the flashing one — because a
        // flash is a *change*, and neither half of it can be judged without the other in the same
        // picture. At full health on purpose: this is the scene's unflashed, unbarred elite, which is
        // what makes this frame the channel for judging the elite's own art at real size (ADR 0002).
        id: "e5",
        kind: "elite",
        pos: { x: 15_720, y: 15_940 },
        facing: 2,
        frame: 0,
        radius: 24,
        hp: ELITE_HP,
        flashing: false,
      },
      {
        id: "e4",
        kind: "grunt",
        pos: { x: 16_060, y: 15_600 },
        facing: 2,
        frame: 0,
        radius: 16,
        hp: 30,
        flashing: false,
      },
    ],
    nests: [
      { id: "n1", pos: { x: 15_500, y: 15_470 }, radius: 48, hp: 600, alive: true, sector: 0 },
      { id: "n2", pos: { x: 16_020, y: 15_900 }, radius: 48, hp: 0, alive: false, sector: 1 },
    ],
    exit: { x: 0, y: 15_000, width: 98, height: 936 },
    ore: demoOre(),
    structures: [
      { id: "b1", kind: "generator", tile: { tx: 1042, ty: 1030 }, hp: 300 },
      { id: "b2", kind: "miner", tile: { tx: 1030, ty: 1032 }, hp: 200 },
      // An L of walls, not a pair: a wall's variant is a mask of which sides another wall abuts, so
      // a lone wall or a straight run only ever exercises a few of the sixteen. The corner is what
      // shows whether a run reads as one continuous mass — which is the whole point of the mask, and
      // is invisible on a single tile.
      { id: "b3", kind: "wall", tile: { tx: 1032, ty: 1050 }, hp: 145 }, // chewed on by e2
      { id: "b4", kind: "wall", tile: { tx: 1034, ty: 1050 }, hp: 400 },
      { id: "b6", kind: "wall", tile: { tx: 1036, ty: 1050 }, hp: 400 },
      { id: "b7", kind: "wall", tile: { tx: 1036, ty: 1052 }, hp: 400 },
      { id: "b8", kind: "wall", tile: { tx: 1036, ty: 1054 }, hp: 400 },
      // One turret engaged and powered — it draws a line — and one holding a target it has no
      // power to fire on, which is the only thing that draws the lightning.
      {
        id: "b5",
        kind: "turret",
        tile: { tx: 1052, ty: 1042 },
        hp: 250,
        turret: { powered: true, targetId: "e4" },
      },
      {
        id: "b6",
        kind: "turret",
        tile: { tx: 1066, ty: 1054 },
        hp: 250,
        turret: { powered: false, targetId: "e3" },
      },
    ],
  };
}

// A placement that cannot be made — this tile is under the near wall — so the frame shows the ghost
// in its faded state. #81 spends opacity and nothing else on validity, so the valid case is simply
// the same drawing at full alpha and needs no picture of its own.
export const DEMO_GHOST: BuildGhost = {
  kind: "turret",
  tile: { tx: 1033, ty: 1049 },
  valid: false,
};

// One shot from each of the three shooters #81 draws a line for: your own, a squadmate's, and a
// turret's. The turret's is generated by `drawWorld` from `b5`'s streamed aim, so it is not here.
export function demoShots(world: WorldSnapshot, now: number): ShotSource {
  return {
    own: {
      at: now,
      from: world.players[1].pos,
      dir: unit(world.players[1].pos, { x: 16_060, y: 15_600 }),
    },
    peers: [
      // Cy hit the elite; the server named it, and it is still alive, so the line lands on it.
      { shot: { id: "p3", dir: { x: 1, y: 0.4 }, hit: "e3" }, at: now },
      // Ana hit nothing. A miss still draws, out to full range (#74 §6).
      { shot: { id: "p1", dir: { x: -0.8, y: -0.6 } }, at: now },
    ],
    resolve: (id) =>
      world.enemies.find((e) => e.id === id)?.pos ??
      world.nests.find((n) => n.id === id && n.alive)?.pos ??
      null,
  };
}

function unit(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

// Patches under the camera, grown the way the game grows them. These used to be hand-painted
// rectangles, which quietly lied: `generateOre` accretes a patch outward from a seed tile, so a
// real deposit is a blob with a ragged edge. A rectangular fixture makes every ore sprite look
// like it ends in a hard axis-aligned border and sends its agent chasing a defect the game does
// not have — it cost one round before anyone noticed the fixture was the problem.
function demoOre(): OreGrid {
  const grid: OreGrid = new Map();
  grow(grid, "metal", { tx: 1029, ty: 1030 }, 90, 1);
  grow(grid, "metal", { tx: 1061, ty: 1048 }, 70, 2);
  grow(grid, "power", { tx: 1046, ty: 1039 }, 60, 3);
  return grid;
}

// The same random-walk accretion `generateOre` uses, kept local because the real one seeds from
// the whole arena and would put nothing under this camera.
function grow(grid: OreGrid, kind: "metal" | "power", from: Tile, tiles: number, seed: number) {
  const rng = mulberry32(seed);
  let { tx, ty } = from;
  for (let i = 0; i < tiles; i++) {
    grid.set(tileKey({ tx, ty }), kind);
    const step = Math.floor(rng() * 4);
    tx += step === 0 ? 1 : step === 1 ? -1 : 0;
    ty += step === 2 ? 1 : step === 3 ? -1 : 0;
  }
}

// Where the camera's top-left tile falls, purely so a reader can check the ore above lands on
// screen without doing the division themselves.
export const DEMO_FIRST_TILE = {
  tx: Math.floor(DEMO_CAMERA.x / TILE),
  ty: Math.floor(DEMO_CAMERA.y / TILE),
};
