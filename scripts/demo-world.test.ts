import { describe, expect, test } from "bun:test";
import {
  freshBuildState,
  INTERACT_REACH,
  insertStructure,
  oreUnder,
  resolveHarvest,
  tileCenter,
  tileKey,
  tileOf,
} from "../src/game/build";
import { FLOAT_RISE, oreFloatOrigin } from "../src/game/floats";
import { PUFF_REACH } from "../src/game/fx";
import { MINIMAP_COVERAGES, minimapWindow, oreCells, oreDensity } from "../src/game/minimap";
import { POWER_WORDS } from "../src/game/tutorial";
import {
  DEMO_CAMERA,
  DEMO_HOVER,
  DEMO_MINED,
  DEMO_NOW,
  DEMO_SELF,
  DEMO_TURRET,
  DEMO_VIEWPORT,
  demoBursts,
  demoFloats,
  demoPuffs,
  demoTutorial,
  demoWorld,
} from "./demo-world";

// The scene has to be able to *show* a difference between the map's zoom levels, or a run at each
// of them draws the same picture three times and says nothing (#110). The map's ore layer is
// bounded to its window, so that means ore beyond the closest window and beyond the middle one —
// the only layer in the scene that the level can add to or take away.
describe("the scene the harness paints", () => {
  const cellsAt = (coverage: number) => {
    const world = demoWorld();
    const self = world.players.find((p) => p.id === DEMO_SELF);
    if (!self) throw new Error(`the scene has no ${DEMO_SELF} for the map to centre on`);
    const win = minimapWindow(self.pos, DEMO_CAMERA, DEMO_VIEWPORT, coverage);
    return oreCells(win, oreDensity(world.ore, world.arena)).length;
  };

  test("puts ore in every zoom level's window, and more of it in each wider one", () => {
    const [wide, middle, close] = MINIMAP_COVERAGES.map(cellsAt);
    expect(close).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(close);
    expect(wide).toBeGreaterThan(middle);
  });

  // A burst and #107's white spider are one event told twice — same `EnemyHit`, same delayed clock,
  // and now the same lifetime — so the picture that answers "what does a hit look like" has to carry
  // both together on the same spider. A burst placed anywhere else would be a scene the game cannot
  // produce, and the harness would be answering a question nobody asked.
  test("strikes its bursts on exactly the spiders the frame has flashing", () => {
    const world = demoWorld();
    const flashing = world.enemies.filter((e) => e.flashing).map((e) => e.pos);
    expect(flashing.length).toBeGreaterThan(1); // a grunt and an elite; neither says much alone
    expect(demoBursts(world, DEMO_NOW).map((b) => b.pos)).toEqual(flashing);
  });

  // A puff stands where a spider *was*, so the one way this scene can be wrong is the mirror of the
  // burst's: a cloud drawn over a spider that is still standing is a frame the game cannot produce,
  // and it would also be the frame where nobody could tell whether the mark reads on bare paper.
  test("strikes its puffs clear of every spider still standing", () => {
    const world = demoWorld();
    const puffs = demoPuffs(DEMO_NOW);
    expect(puffs.length).toBeGreaterThan(0);
    for (const puff of puffs) {
      for (const enemy of world.enemies) {
        const apart = Math.hypot(puff.pos.x - enemy.pos.x, puff.pos.y - enemy.pos.y);
        expect(apart).toBeGreaterThan(PUFF_REACH + enemy.radius);
      }
    }
  });

  // A hand's `+1` (#136) goes over the tile it was dug out of, so the one way this drawing can be
  // wrong is a number over a tile nobody could be mining. Checked rather than derived, as the puffs
  // are: the game's own `resolveHarvest` is what says the tile is a mine, and the scene has no
  // player-held button for the picture to read.
  test("floats its hand-mined +1 over a tile the scene's own player could be digging", () => {
    const world = demoWorld();
    const self = world.players.find((p) => p.id === DEMO_SELF);
    if (!self) throw new Error(`the scene has no ${DEMO_SELF} to be doing the digging`);
    expect(resolveHarvest(DEMO_MINED, world.ore, null)).toEqual({ kind: "mine", tile: DEMO_MINED });
    expect(world.structures.some((s) => tileKey(s.tile) === tileKey(DEMO_MINED))).toBe(false);
    const centre = tileCenter(DEMO_MINED);
    expect(Math.hypot(centre.x - self.pos.x, centre.y - self.pos.y)).toBeLessThan(INTERACT_REACH);
  });

  // Inside the frame the harness paints, with room above it for the whole rise, or the picture
  // answers nothing about a mark that leaves the top of it half way through its life.
  test("floats its hand-mined +1 inside the viewport the harness captures", () => {
    const origin = oreFloatOrigin(DEMO_MINED);
    expect(origin.x).toBeGreaterThan(DEMO_CAMERA.x);
    expect(origin.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width);
    expect(origin.y).toBeGreaterThan(DEMO_CAMERA.y + FLOAT_RISE);
    expect(origin.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height);
  });

  // One number per miner and exactly one more for the hand, so the frame carries both sources at
  // once — a mark that reads over a building says nothing about one that reads over bare ore.
  test("floats a number for every miner standing and one the hand earned", () => {
    const world = demoWorld();
    const floats = demoFloats(world, DEMO_NOW);
    const miners = world.structures.filter((s) => s.kind === "miner");
    expect(miners.length).toBeGreaterThan(1);
    expect(floats.filter((f) => f.id !== null).map((f) => f.id)).toEqual(miners.map((m) => m.id));
    expect(floats.filter((f) => f.id === null).map((f) => f.pos)).toEqual([
      oreFloatOrigin(DEMO_MINED),
    ]);
  });

  // The tutorial's three world-anchored prompts (#134). Each has to be on a case the shipped rule
  // would actually fire on, or the picture shows a frame the game cannot produce.
  test("raises its turret prompt over a turret that is standing in the scene", () => {
    const turret = demoWorld().structures.find(
      (s) => s.kind === "turret" && s.tile.tx === DEMO_TURRET.tx && s.tile.ty === DEMO_TURRET.ty,
    );
    expect(turret).toBeDefined();
    // The unpowered one, which is what the sentence is about — and the only one drawing lightning.
    expect(turret?.turret?.powered).toBe(false);
  });

  test("hovers a power tile with nothing standing on it", () => {
    const world = demoWorld();
    const build = freshBuildState(world.arena);
    for (const s of world.structures) insertStructure(build, s);
    expect(oreUnder(tileOf(DEMO_HOVER), world.ore, build)).toBe("power");
  });

  test("marks an ore tile and writes over one inside the viewport the harness captures", () => {
    const marks = demoTutorial(demoWorld());
    expect(marks.ore).not.toBeNull();
    expect(marks.cursor?.words).toBe(POWER_WORDS);
    for (const at of [tileCenter(marks.ore?.tile ?? DEMO_TURRET), marks.cursor?.at ?? DEMO_HOVER]) {
      expect(at.x).toBeGreaterThan(DEMO_CAMERA.x);
      expect(at.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width);
      expect(at.y).toBeGreaterThan(DEMO_CAMERA.y);
      expect(at.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height);
    }
  });

  // Inside the frame the harness paints, or the picture answers nothing about a mark nobody sees.
  test("strikes its puffs inside the viewport the harness captures", () => {
    for (const puff of demoPuffs(DEMO_NOW)) {
      expect(puff.pos.x).toBeGreaterThan(DEMO_CAMERA.x + PUFF_REACH);
      expect(puff.pos.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width - PUFF_REACH);
      expect(puff.pos.y).toBeGreaterThan(DEMO_CAMERA.y + PUFF_REACH);
      expect(puff.pos.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height - PUFF_REACH);
    }
  });
});
