import { mulberry32, type OreGrid, TILE, tileKey } from "../src/game/build";
import type { Mark } from "../src/game/clientWorld";
import type { BuildGhost, ShotSource } from "../src/game/draw";
import { ELITE_HP } from "../src/game/enemies";
import { FLOAT_MS, type MetalFloat, minerFloatOrigin } from "../src/game/floats";
import type { Tile, Vec2, WorldSnapshot } from "../src/lobby/protocol";

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
    // The scene is staged at the arena's centre, and the nearest avatar in it is ~15,400 u from
    // that door — nobody here has been anywhere near enough to find it.
    exitRevealed: false,
    ore: demoOre(),
    structures: [
      { id: "b1", kind: "generator", tile: { tx: 1042, ty: 1030 }, hp: 300 },
      // Three miners rather than one, because #99's `+1` is a *fade* — a single number at a single
      // instant says nothing about whether it reads on its way up or disappears too soon. Same
      // argument as the paired elites above.
      { id: "b2", kind: "miner", tile: { tx: 1030, ty: 1032 }, hp: 200 },
      { id: "b9", kind: "miner", tile: { tx: 1027, ty: 1037 }, hp: 200 },
      { id: "b10", kind: "miner", tile: { tx: 1034, ty: 1037 }, hp: 200 },
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
// turret's. The turret's is generated by `drawWorld` from `b5`'s streamed aim, so it is not here —
// only the bullet it needs, since a turret over an empty pool is one the server is holding (#102).
export function demoShots(world: WorldSnapshot, now: number): ShotSource {
  return {
    ammo: 9,
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

// A starburst on every spider the scene has flashing (#115), and on no other.
//
// The two are one event told twice — one `EnemyHit`, one delayed clock, one lifetime — so a burst
// anywhere else would be a frame the game cannot produce, and the only question this picture exists
// to answer is what a hit actually looks like now that it has both channels at once. Derived from
// the enemies rather than hand-placed, for the reason `demoFloats` is: a mark over a spider that is
// not there is the one way this drawing can be wrong.
//
// The mark is procedural ink and not a bake, so no sprite sheet carries it and no spy says whether
// it reads against white paper. This frame is the channel (ADR 0002 §5).
export function demoBursts(world: WorldSnapshot, now: number): Mark[] {
  return world.enemies.filter((e) => e.flashing).map((e) => ({ pos: e.pos, at: now }));
}

// An ink puff at each point the scene has had a spider die (#116).
//
// Placed rather than derived, and that is the mirror of `demoBursts`: a burst goes *on* a spider, so
// it can be read off one, while a puff goes where a spider no longer is and there is nothing left in
// the snapshot to read. What keeps it honest is a check instead of a derivation — `demo-world.test`
// holds both points clear of everything still standing and inside the frame, which is the one way
// this drawing can be wrong. A cloud over a live spider is a frame the game cannot produce, and it
// is also the frame in which nobody could tell whether the mark reads on bare paper.
//
// Two of them, on the two backgrounds the mark has to survive: open floor north of the squad, and
// the crowded south-east corner where the elites and the silenced nest are. It is procedural ink and
// not a bake, so no sprite sheet carries it and no spy says whether it reads at 38 u across against
// white paper. This frame is the channel (ADR 0002 §5).
const DEMO_DEATHS: Vec2[] = [
  { x: 15_600, y: 15_540 },
  { x: 15_900, y: 15_900 },
];

export function demoPuffs(now: number): Mark[] {
  return DEMO_DEATHS.map((pos) => ({ pos: { ...pos }, at: now }));
}

// A `+1` over every miner in the scene, spread across the life of a float so the frame carries the
// whole fade at once. Derived from the structures rather than hand-placed, so a number can never end
// up over a miner that is not there — which is the one way this drawing can be wrong.
export function demoFloats(world: WorldSnapshot, now: number): MetalFloat[] {
  const miners = world.structures.filter((s) => s.kind === "miner");
  return miners.map((s, i) => ({
    id: s.id,
    pos: minerFloatOrigin(s.tile),
    at: now - Math.round((i / miners.length) * FLOAT_MS),
  }));
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
//
// And patches well out of sight of it, which are for the corner map alone (#110). The map's ore is
// the one layer whose marks the zoom level adds to and takes away, and it is bounded to the map's
// window rather than to the viewport — so a scene whose ore all sits under the camera draws the
// same picture at all three levels and a run at each of them proves nothing. The offsets below are
// chosen against the levels: two land between the closest window and the middle one, and two
// between the middle one and the widest.
function demoOre(): OreGrid {
  const grid: OreGrid = new Map();
  grow(grid, "metal", { tx: 1029, ty: 1030 }, 90, 1);
  grow(grid, "metal", { tx: 1061, ty: 1048 }, 70, 2);
  grow(grid, "power", { tx: 1046, ty: 1039 }, 60, 3);
  grow(grid, "metal", { tx: 1242, ty: 1044 }, 40, 4); // ~3,000 u east
  grow(grid, "power", { tx: 1042, ty: 819 }, 40, 5); // ~3,400 u north
  grow(grid, "metal", { tx: 1475, ty: 1044 }, 40, 6); // ~6,500 u east
  grow(grid, "power", { tx: 1042, ty: 597 }, 40, 7); // ~6,700 u north
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
