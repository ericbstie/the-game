import { describe, expect, test } from "bun:test";
import { BLOOD_FADE_MS, DROP_RADIUS, STAIN_RADIUS } from "../src/game/blood";
import {
  INTERACT_REACH,
  oreAt,
  resolveHarvest,
  tileCenter,
  tileKey,
  tileOf,
} from "../src/game/build";
import { AIM_PAPER_WIDTH } from "../src/game/draw";
import { BLOODLING_HP } from "../src/game/enemies";
import { FLOAT_RISE, oreFloatOrigin } from "../src/game/floats";
import { AIM_REACH, PUFF_REACH } from "../src/game/fx";
import {
  MINIMAP_COVERAGE_U,
  MINIMAP_COVERAGES,
  minimapWindow,
  oreCells,
  oreDensity,
} from "../src/game/minimap";
import {
  DEMO_AIM,
  DEMO_CAMERA,
  DEMO_MINED,
  DEMO_NOW,
  DEMO_SELF,
  DEMO_VIEWPORT,
  demoBlood,
  demoBursts,
  demoFloats,
  demoPuffs,
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

  // #154's mark is struck under the pointer, and the one question about it a spy cannot answer is
  // whether ink rimmed in paper still reads over a floor that is already black. That is what this
  // scene's pointer is for: it stands on the densest ore in the frame, which is the case the mark is
  // at risk in — the white floor needs no picture, because there the rim is the floor's own colour.
  test("aims its pointer into an ore patch, which is the floor the aim mark is at risk on", () => {
    const world = demoWorld();
    expect(oreAt(world.ore, tileOf(DEMO_AIM))).toBe("metal");
    // And a patch rather than one tile in open ground. What the mark has to survive is a floor that
    // is already black under the whole of it, so the claim is about the box the mark covers and not
    // about the tile its middle happens to land on — a lone tile would leave most of it on paper.
    const step = AIM_REACH / 3;
    let covered = 0;
    let sampled = 0;
    for (let dy = -AIM_REACH; dy <= AIM_REACH; dy += step) {
      for (let dx = -AIM_REACH; dx <= AIM_REACH; dx += step) {
        sampled++;
        if (oreAt(world.ore, tileOf({ x: DEMO_AIM.x + dx, y: DEMO_AIM.y + dy }))) covered++;
      }
    }
    expect(covered / sampled).toBeGreaterThan(0.7);
  });

  // Clear of everything else the scene draws, the corner map's own plate included, and inside the
  // frame. A mark half behind a spider — or over the map's white plate — says nothing about the
  // floor, which is the only thing this picture is asked about.
  //
  // Measured to the paper rather than to the ink: what the mark takes out of whatever it crosses is
  // its widest stroke, and the rim is that. Held to `AIM_REACH` alone, the pointer could sit a rim's
  // width onto the map and cut a gap in the plate's rule — which is the drawing behaving correctly
  // (`drawAim` is struck over the map on purpose) in the one picture that must not show it.
  test("stands its pointer clear of everything else in the scene, and inside the frame", () => {
    const world = demoWorld();
    const struck = AIM_REACH + AIM_PAPER_WIDTH / 2;
    for (const enemy of world.enemies) {
      expect(Math.hypot(DEMO_AIM.x - enemy.pos.x, DEMO_AIM.y - enemy.pos.y)).toBeGreaterThan(
        struck + enemy.radius,
      );
    }
    for (const player of world.players) {
      expect(Math.hypot(DEMO_AIM.x - player.pos.x, DEMO_AIM.y - player.pos.y)).toBeGreaterThan(
        struck + player.radius,
      );
    }
    expect(DEMO_AIM.x).toBeGreaterThan(DEMO_CAMERA.x + struck);
    expect(DEMO_AIM.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width - struck);
    expect(DEMO_AIM.y).toBeGreaterThan(DEMO_CAMERA.y + struck);
    expect(DEMO_AIM.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height - struck);
    const self = demoWorld().players.find((p) => p.id === DEMO_SELF);
    if (!self) throw new Error(`the scene has no ${DEMO_SELF} for the map to centre on`);
    const plate = minimapWindow(self.pos, DEMO_CAMERA, DEMO_VIEWPORT, MINIMAP_COVERAGE_U);
    const overPlate =
      DEMO_AIM.x + struck > plate.x &&
      DEMO_AIM.x - struck < plate.x + plate.size &&
      DEMO_AIM.y + struck > plate.y &&
      DEMO_AIM.y - struck < plate.y + plate.size;
    expect(overPlate).toBe(false);
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

// #140. The blood is the first thing the game leaves on the ground, and the only colour in a frame
// that is otherwise black ink on white paper — so what this scene has to show is a trail with the
// creature that laid it at the head, a stain standing where nothing is, and the whole of the fade in
// one picture. None of that can be judged by a spy; the frame is the channel (ADR 0002 §5).
describe("the blood the scene lays", () => {
  const world = demoWorld();
  const marks = demoBlood(world, DEMO_NOW);
  const runner = world.enemies.find((e) => e.kind === "bloodling");

  test("puts a bloodling in the frame for the trail to belong to", () => {
    expect(runner).toBeDefined();
    expect(runner?.hp).toBe(BLOODLING_HP); // unbarred, so its art is judged at real size
  });

  test("lays the trail behind the creature, at the spacing the game drips at", () => {
    const drips = marks.filter((m) => m.radius === DROP_RADIUS);
    expect(drips.length).toBeGreaterThan(4);
    for (const drip of drips) {
      expect(drip.pos.x).toBeGreaterThan(runner?.pos.x ?? 0); // behind it, never under it
      expect(drip.pos.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width);
      expect(drip.pos.y).toBeGreaterThan(DEMO_CAMERA.y);
      expect(drip.pos.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height);
    }
  });

  // A single age would put every drip in one of the four bands and answer nothing about the other
  // three — and the faintest is where a red decal on white paper is at risk of vanishing.
  test("spreads the trail across the whole fade, so every band of it is in the picture", () => {
    const ages = marks.filter((m) => m.radius === DROP_RADIUS).map((m) => DEMO_NOW - m.at);
    expect(Math.min(...ages)).toBe(0);
    expect(Math.max(...ages)).toBeGreaterThan(BLOOD_FADE_MS * 0.8);
  });

  test("stands its stain clear of everything still standing, and inside the frame", () => {
    // Every lobe of it, laid by the game's own `stainMarks` rather than a disc of the fixture's —
    // a hand-built splat here would be a picture of a mark the game does not draw.
    const stains = marks.filter((m) => m.radius > DROP_RADIUS);
    expect(stains.length).toBeGreaterThan(1);
    for (const stain of stains) {
      for (const enemy of world.enemies) {
        const apart = Math.hypot(stain.pos.x - enemy.pos.x, stain.pos.y - enemy.pos.y);
        expect(apart).toBeGreaterThan(STAIN_RADIUS + enemy.radius);
      }
      expect(stain.pos.x).toBeGreaterThan(DEMO_CAMERA.x + STAIN_RADIUS);
      expect(stain.pos.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width - STAIN_RADIUS);
      expect(stain.pos.y).toBeGreaterThan(DEMO_CAMERA.y + STAIN_RADIUS);
      expect(stain.pos.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height - STAIN_RADIUS);
    }
  });
});
