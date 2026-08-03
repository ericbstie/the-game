import {
  BLOOD_FADE_MS,
  type BloodMark,
  DRIP_SPACING,
  DROP_RADIUS,
  stainMarks,
} from "../src/game/blood";
import {
  BUILDABLES,
  footprintCenter,
  freshBuildState,
  insertStructure,
  mulberry32,
  type OreGrid,
  TILE,
  tileKey,
} from "../src/game/build";
import type { Mark } from "../src/game/clientWorld";
import type { BuildGhost } from "../src/game/draw";
import { SHOT_STREAK } from "../src/game/draw";
import { BLOODLING_HP, BLOODLING_RADIUS, ELITE_HP } from "../src/game/enemies";
import { FLOAT_MS, type MetalFloat, minerFloatOrigin, oreFloatOrigin } from "../src/game/floats";
import { freshTutorial, observe, stepTutorial, type TutorialMarks } from "../src/game/tutorial";
import type { RenderedProjectile, Tile, Vec2, WorldSnapshot } from "../src/lobby/protocol";

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
// the same reason: a health bar, a shot in flight from each of the three shooters, a turret's
// unpowered lightning and a refused build ghost either appear in the picture or they do not.
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
      {
        // One bloodling running at the squad from the east (#140), unflashed and at full health so
        // the frame is the channel for judging its art at real size (ADR 0002 §5) — and so the trail
        // `demoBlood` lays behind it has a creature at the head of it. Everything else in this scene
        // is drawn in ink; this one thing and its blood are the theme's stated exception.
        id: "e6",
        kind: "bloodling",
        pos: { x: 15_760, y: 15_700 },
        facing: 4,
        frame: 0,
        radius: BLOODLING_RADIUS,
        hp: BLOODLING_HP,
        flashing: false,
      },
    ],
    nests: [
      { id: "n1", pos: { x: 15_500, y: 15_470 }, radius: 48, maxHp: 600, hp: 600, alive: true },
      { id: "n2", pos: { x: 16_020, y: 15_900 }, radius: 48, maxHp: 600, hp: 0, alive: false },
    ],
    exit: { x: 0, y: 15_000, width: 98, height: 936 },
    // The scene is staged at the arena's centre, and the nearest avatar in it is ~15,400 u from
    // that door — nobody here has been anywhere near enough to find it.
    exitRevealed: false,
    // Filled in by `demoProjectiles`, which reads the scene back to place them.
    projectiles: [],
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

// The shots in the air (#80). One from each thing that fires, at the three stages a flight has a
// different mark at: a squadmate's crossing open floor with its full streak behind it, a turret's
// leaving its own footprint, and one just out of the scene's own player's barrel — the clipped
// stub, which is the one stage whose mark is not the full `SHOT_STREAK`.
//
// Derived from the scene rather than hand-placed, for `demoFloats`'s reason: a bullet with nothing
// at either end of it is the one way this drawing can be wrong. It is procedural ink and not a
// bake, so no sprite sheet carries it and no spy says whether a 52 u streak reads against white
// paper at real size. This frame is the channel (ADR 0002 §5).
export function demoProjectiles(world: WorldSnapshot): RenderedProjectile[] {
  const flight = (id: string, from: Vec2, toward: Vec2, flown: number): RenderedProjectile => {
    const dir = unit(from, toward);
    return { id, from: { ...from }, pos: { x: from.x + dir.x * flown, y: from.y + dir.y * flown } };
  };
  const cy = world.players[2].pos;
  const ana = world.players[0].pos;
  const elite = world.enemies.find((e) => e.id === "e3");
  const grunt = world.enemies.find((e) => e.id === "e4");
  const turret = world.structures.find((s) => s.id === "b5");
  const shots: RenderedProjectile[] = [];
  // Two thirds of the way across, which is well clear of both ends and of the bloodling running
  // between them: a streak has to be judged on bare paper, not over a sprite.
  if (elite) shots.push(flight("s1", cy, elite.pos, 190));
  // A third of a streak out: the mark a bullet has for its first two frames, and the only one that
  // is not a full dash.
  if (grunt) shots.push(flight("s2", ana, grunt.pos, SHOT_STREAK / 3));
  if (turret && grunt) {
    const spec = BUILDABLES[turret.kind];
    const from = footprintCenter(turret.tile, spec?.footprint ?? 2);
    shots.push(flight("s3", from, grunt.pos, 90));
  }
  return shots;
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

// The blood on the floor (#140): the trail behind the bloodling that is still running, and the
// stain where one that got there went off.
//
// The trail is *derived* from the creature, for `demoFloats`'s reason — a trail with nothing at the
// head of it is the one way this drawing can be wrong — and laid behind it at the spacing the game
// drips at, so the frame shows the real grain rather than a decorative dotted line. Its drips are
// spread across the whole of `BLOOD_FADE_MS`, because the fade is banded and a single age would show
// one band of the four: whether blood still reads as blood at a quarter alpha over white paper is
// exactly what this picture is for.
//
// The stain is placed rather than derived, the mirror of `demoPuffs`: it stands where a bloodling
// *no longer is*, and `demo-world.test` holds it clear of everything standing and inside the frame.
const DEMO_STAIN: Vec2 = { x: 15_780, y: 15_560 };
const DEMO_DRIPS = 8;

export function demoBlood(world: WorldSnapshot, now: number): BloodMark[] {
  const marks: BloodMark[] = stainMarks(DEMO_STAIN, now);
  const runner = world.enemies.find((e) => e.kind === "bloodling");
  if (!runner) return marks;
  for (let i = 1; i <= DEMO_DRIPS; i++) {
    marks.push({
      pos: { x: runner.pos.x + i * DRIP_SPACING, y: runner.pos.y },
      at: now - Math.round(((i - 1) / DEMO_DRIPS) * BLOOD_FADE_MS),
      radius: DROP_RADIUS,
    });
  }
  return marks;
}

// Where the scene's pointer is (#154), and so which tile the aim mark is struck around.
//
// **Inside a metal patch, which is the harder of the two floors the mark has to read over.** On bare
// paper a grey outline has the whole sheet to itself and there is little to judge; over ore it is
// grey ruled across black stipple, which is where the three earlier ink cuts of this mark were lost
// by blind readers. A frame carries exactly one pointer, so the paper case is a second render —
// `bun run sprite:frame --aim x,y` moves it there — and `demo-world.test` is what holds this one
// over ore, clear of everything else the scene draws, and off the corner map's plate.
//
// Not on its tile's middle, on purpose: the mark snaps to the grid, so a pointer standing off-centre
// is what shows in the picture that it snapped rather than followed.
export const DEMO_AIM: Vec2 = { x: 15_930, y: 15_706 };

// The ore tile the scene's own player is digging by hand (#136). Placed rather than derived, and
// that is the mirror of the miners below: a miner carries the tile it stands on, while a hand
// carries nothing the snapshot can be asked about — the button is held on a client and this scene
// has no client. What keeps it honest is a check instead, in `demo-world.test`: metal ore, nothing
// standing on it, and inside `INTERACT_REACH` of `DEMO_SELF`, which is exactly the tile the game
// would fire the event for.
export const DEMO_MINED: Tile = { tx: 1057, ty: 1049 };

// A `+1` over every miner in the scene, and one more over the tile a hand is digging — the same
// number from the game's two sources, in one picture, over the two backgrounds it has to read on:
// a building's ink, and bare ore. Spread across the life of a float so the frame carries the whole
// fade at once.
//
// The miners' are derived from the structures rather than hand-placed, so a number can never end up
// over a miner that is not there — which is the one way that half of this drawing can be wrong.
export function demoFloats(world: WorldSnapshot, now: number): MetalFloat[] {
  const miners = world.structures.filter((s) => s.kind === "miner");
  return [
    ...miners.map((s, i) => ({
      id: s.id,
      pos: minerFloatOrigin(s.tile),
      at: now - Math.round((i / miners.length) * FLOAT_MS),
    })),
    // Half way through its life: the fade is what the miners' spread already shows, so the hand's
    // is the one that has to be legible mid-rise over the ore it came out of.
    { id: null, pos: oreFloatOrigin(DEMO_MINED), at: now - Math.round(FLOAT_MS / 2) },
  ];
}

// The turret the tutorial's prompt 5 is raised over, and the power ore its cursor tooltip is
// hovering (#134). Both are chosen rather than derived, and both are checked in `demo-world.test`:
// `DEMO_TURRET` is the scene's *unpowered* turret, which is the one the sentence is actually about,
// and `DEMO_HOVER` is a power tile with nothing standing on it — exactly the two cases the shipped
// prompts would fire on.
export const DEMO_TURRET: Tile = { tx: 1066, ty: 1054 };
export const DEMO_HOVER: Vec2 = { x: 1046 * TILE + TILE / 2, y: 1039 * TILE + TILE / 2 };

// What the mini-tutorial has on screen in this frame (#134) — the game's own answer rather than a
// hand-placed one. The build state is assembled from the very structures above, so the ore the mark
// lands on is the one the shipped rule picks and the tooltip over the turret is the one it raises.
// Three of the six prompts at once: the highlight and its words on an ore tile, a hover tooltip at
// the cursor, and the wrapped sentence with its two inline icons over a turret.
export function demoTutorial(world: WorldSnapshot): TutorialMarks {
  const build = freshBuildState(world.arena);
  for (const s of world.structures) insertStructure(build, s);
  const tutorial = freshTutorial();
  observe(tutorial, { did: "build", kind: "turret", tile: DEMO_TURRET });
  return stepTutorial(tutorial, {
    metal: 0,
    enemies: 0,
    ore: world.ore,
    build,
    self: world.players.find((p) => p.id === DEMO_SELF)?.pos ?? null,
    camera: DEMO_CAMERA,
    viewport: DEMO_VIEWPORT,
    cursor: DEMO_HOVER,
  });
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

// The scene with a crowd of spiders standing on it: `count` of them scattered over `viewport` from
// the camera, so **none is culled** and the frame is the worst one the enemy cap can be asked for
// (#92). The scene's own enemies stay where they are — they are the ones the sort, the flash, the
// burst and the puff are read off — and this is filler behind them.
//
// Here rather than in the entry that renders it, because the two instruments that want it
// (`sprite:frame` for the picture, and anything asking what a zoomed-out screen holds) must draw
// the same crowd. `viewport` is the **world** the screen reaches, so a 0.5× frame is filled to its
// own wider extent rather than to the screen's.
//
// Deterministic, so two runs of a script compare to each other, and damaged, so every one of them
// carries a health bar — the same reasoning `frame-budget.ts` builds its own fixture on.
export function demoCrowd(
  world: WorldSnapshot,
  count: number,
  viewport: { width: number; height: number },
): WorldSnapshot {
  const rng = mulberry32(4_242);
  const crowd = [...world.enemies];
  for (let i = crowd.length; i < count; i++) {
    const elite = i % 5 === 0;
    const kind = elite ? "elite" : i % 7 === 3 ? "bloodling" : "grunt";
    crowd.push({
      id: `crowd${i}`,
      kind,
      pos: {
        x: DEMO_CAMERA.x + rng() * viewport.width,
        y: DEMO_CAMERA.y + rng() * viewport.height,
      },
      facing: Math.floor(rng() * 8),
      frame: Math.floor(rng() * 2),
      radius: elite ? 24 : kind === "bloodling" ? BLOODLING_RADIUS : 16,
      hp: elite ? ELITE_HP - 1 : kind === "bloodling" ? BLOODLING_HP - 1 : 17,
      flashing: false,
    });
  }
  return { ...world, enemies: crowd };
}

// The squad standing in the escape door (#152). The sign is up only for a player who is themselves
// in it, and this scene is staged 15,400 u away from one — so, like the reveal latch `--door` sets,
// there is no arrangement of the scene as it stands that can produce the frame.
//
// The door is the west wall's: x 0..98, y 15,000..15,936. Two of the three stand inside it and the
// third is still out on the floor, so the count the frame states is **2 of 3** and not a whole
// squad — a sign that only ever read `3 of 3` would say nothing about whether it reads as a count.
// `DEMO_SELF` is one of the two inside, because that is the only player the sign is drawn for.
const DEMO_ESCAPE_POSITIONS: Vec2[] = [
  { x: 62, y: 15_360 }, // p1, in
  { x: 46, y: 15_440 }, // p2 — DEMO_SELF — in
  { x: 320, y: 15_540 }, // p3, still walking
];

// Where the camera lands with `DEMO_SELF` standing there: `computeCamera` clamped against the west
// wall, which is exactly what the game does for a player pressed up against the edge of the arena.
export const DEMO_ESCAPE_CAMERA = { x: 0, y: 15_140 };

export function demoEscape(world: WorldSnapshot): WorldSnapshot {
  return {
    ...world,
    players: world.players.map((p, i) => ({ ...p, pos: { ...DEMO_ESCAPE_POSITIONS[i] } })),
  };
}

// The roster the sign is counted against (#152) — everyone at the keyboard. A render input the game
// always has and this script has always withheld, so it rides with the escape frame rather than with
// every frame: handed over unconditionally it would put #94's off-screen arrows into the zoomed
// frames, which is a change to somebody else's review channel.
export function demoConnected(world: WorldSnapshot): Set<string> {
  return new Set(world.players.map((p) => p.id));
}
