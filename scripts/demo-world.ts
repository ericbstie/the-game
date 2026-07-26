import { type OreGrid, TILE, tileKey } from "../src/game/build";
import type { Tile, WorldSnapshot } from "../src/lobby/protocol";

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
// Browser-safe on purpose: it is bundled into the page, so it touches no filesystem and no DOM.

export const DEMO_VIEWPORT = { width: 800, height: 600 };
export const DEMO_CAMERA = { x: 15_400, y: 15_400 };
export const DEMO_SELF = "p2";

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
        hp: 100,
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
      },
      {
        id: "e2",
        kind: "grunt",
        pos: { x: 15_480, y: 15_840 },
        facing: 2,
        frame: 0,
        radius: 16,
        hp: 30,
      },
      {
        id: "e3",
        kind: "elite",
        pos: { x: 15_900, y: 15_780 },
        facing: 2,
        frame: 0,
        radius: 24,
        hp: 120,
      },
      {
        id: "e4",
        kind: "grunt",
        pos: { x: 16_060, y: 15_600 },
        facing: 2,
        frame: 0,
        radius: 16,
        hp: 30,
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
      { id: "b3", kind: "wall", tile: { tx: 1032, ty: 1050 }, hp: 400 },
      { id: "b4", kind: "wall", tile: { tx: 1034, ty: 1050 }, hp: 400 },
      { id: "b5", kind: "turret", tile: { tx: 1052, ty: 1042 }, hp: 250 },
      { id: "b6", kind: "turret", tile: { tx: 1066, ty: 1054 }, hp: 250 },
    ],
  };
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
