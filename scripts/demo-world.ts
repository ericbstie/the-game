import { type OreGrid, TILE, tileKey } from "../src/game/build";
import type { WorldSnapshot } from "../src/lobby/protocol";

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
      { id: "p1", slot: 1, name: "Ana", pos: { x: 15_620, y: 15_640 }, radius: 14, hp: 100 },
      { id: "p2", slot: 2, name: "Ben", pos: { x: 15_632, y: 15_662 }, radius: 14, hp: 100 },
      { id: "p3", slot: 3, name: "Cy", pos: { x: 15_644, y: 15_684 }, radius: 14, hp: 100 },
    ],
    enemies: [
      { id: "e1", kind: "grunt", pos: { x: 15_680, y: 15_500 }, radius: 16, hp: 30 },
      { id: "e2", kind: "grunt", pos: { x: 15_480, y: 15_840 }, radius: 16, hp: 30 },
      { id: "e3", kind: "elite", pos: { x: 15_900, y: 15_780 }, radius: 24, hp: 120 },
      { id: "e4", kind: "grunt", pos: { x: 16_060, y: 15_600 }, radius: 16, hp: 30 },
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

// Two patches under the camera, so the floor the sprites stand on is the floor the game draws and
// not a flat colour. The real grid is derived from the world seed; this only has to look like it.
function demoOre(): OreGrid {
  const grid: OreGrid = new Map();
  paint(grid, "metal", 1027, 1032, 1027, 1034);
  paint(grid, "metal", 1058, 1064, 1046, 1050);
  paint(grid, "power", 1044, 1049, 1038, 1041);
  return grid;
}

function paint(
  grid: OreGrid,
  kind: "metal" | "power",
  fromTx: number,
  toTx: number,
  fromTy: number,
  toTy: number,
): void {
  for (let ty = fromTy; ty <= toTy; ty++) {
    for (let tx = fromTx; tx <= toTx; tx++) grid.set(tileKey({ tx, ty }), kind);
  }
}

// Where the camera's top-left tile falls, purely so a reader can check the ore above lands on
// screen without doing the division themselves.
export const DEMO_FIRST_TILE = {
  tx: Math.floor(DEMO_CAMERA.x / TILE),
  ty: Math.floor(DEMO_CAMERA.y / TILE),
};
