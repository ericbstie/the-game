import { describe, expect, test } from "bun:test";
import { BLOOD_FADE_MS, DROP_RADIUS, STAIN_RADIUS } from "../src/game/blood";
import {
  freshBuildState,
  INTERACT_REACH,
  insertStructure,
  oreAt,
  oreUnder,
  resolveHarvest,
  TILE,
  tileCenter,
  tileKey,
  tileOf,
} from "../src/game/build";
import { computeCamera } from "../src/game/camera";
import { BLOODLING_HP } from "../src/game/enemies";
import { FLOAT_RISE, oreFloatOrigin } from "../src/game/floats";
import { AIM_REACH, AIM_TILES, PUFF_REACH } from "../src/game/fx";
import {
  MINIMAP_COVERAGE_U,
  MINIMAP_COVERAGES,
  minimapWindow,
  oreCells,
  oreDensity,
} from "../src/game/minimap";
import { POWER_WORDS } from "../src/game/tutorial";
import { escapeTally, insideExit, squadEscaped } from "../src/game/world";
import {
  DEMO_AIM,
  DEMO_CAMERA,
  DEMO_ESCAPE_CAMERA,
  DEMO_HOVER,
  DEMO_MINED,
  DEMO_NOW,
  DEMO_SELF,
  DEMO_TURRET,
  DEMO_VIEWPORT,
  demoBlood,
  demoBursts,
  demoConnected,
  demoEscape,
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

  // #154's mark is struck around the tile the pointer is in, and the one question about it a spy
  // cannot answer is whether a grey outline still reads over a floor that is already black. That is
  // what this scene's pointer is for: it stands in the densest metal in the frame, which is the case
  // the mark is at risk in — bare paper needs no picture, because there a grey rule has the sheet to
  // itself.
  test("aims its pointer into an ore patch, which is the floor the aim mark is at risk on", () => {
    const world = demoWorld();
    const tile = tileOf(DEMO_AIM);
    expect(oreAt(world.ore, tile)).toBe("metal");
    // And a patch rather than one tile in open ground. The outline runs on the *edge* of the block
    // around that tile, so what has to be ore is the block, not only the tile in the middle of it.
    const half = (AIM_TILES - 1) / 2;
    let covered = 0;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (oreAt(world.ore, { tx: tile.tx + dx, ty: tile.ty + dy })) covered++;
      }
    }
    expect(covered / AIM_TILES ** 2).toBeGreaterThan(0.7);
  });

  // Clear of everything else the scene draws, the corner map's own plate included, and inside the
  // frame. A mark half behind a spider — or over the map's white plate — says nothing about the
  // floor, which is the only thing this picture is asked about.
  test("stands its pointer clear of everything else in the scene, and inside the frame", () => {
    const world = demoWorld();
    // Measured from the middle of the tile the mark snaps to rather than from the pointer, because
    // that is what the outline is actually built around, plus a tile of slack for the stroke.
    const middle = tileCenter(tileOf(DEMO_AIM));
    const struck = AIM_REACH + TILE;
    for (const enemy of world.enemies) {
      expect(Math.hypot(middle.x - enemy.pos.x, middle.y - enemy.pos.y)).toBeGreaterThan(
        struck + enemy.radius,
      );
    }
    for (const player of world.players) {
      expect(Math.hypot(middle.x - player.pos.x, middle.y - player.pos.y)).toBeGreaterThan(
        struck + player.radius,
      );
    }
    expect(middle.x).toBeGreaterThan(DEMO_CAMERA.x + struck);
    expect(middle.x).toBeLessThan(DEMO_CAMERA.x + DEMO_VIEWPORT.width - struck);
    expect(middle.y).toBeGreaterThan(DEMO_CAMERA.y + struck);
    expect(middle.y).toBeLessThan(DEMO_CAMERA.y + DEMO_VIEWPORT.height - struck);
    const self = world.players.find((p) => p.id === DEMO_SELF);
    if (!self) throw new Error(`the scene has no ${DEMO_SELF} for the map to centre on`);
    const plate = minimapWindow(self.pos, DEMO_CAMERA, DEMO_VIEWPORT, MINIMAP_COVERAGE_U);
    const overPlate =
      middle.x + struck > plate.x &&
      middle.x - struck < plate.x + plate.size &&
      middle.y + struck > plate.y &&
      middle.y - struck < plate.y + plate.size;
    expect(overPlate).toBe(false);
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

// #140. The blood is the first thing the game leaves on the ground, and the only colour in a frame
// that is otherwise black ink on white paper — so what this scene has to show is a trail with the
// creature that laid it at the head, a stain standing where nothing is, and the whole of the fade in
// one picture. None of that can be judged by a spy; the frame is the channel (ADR 0002 §5).
// `--escape` is the only way to a frame with #152's count in it, and everything about that frame is
// staged rather than arranged: a sign drawn for the wrong player, or a squad that turns out to be
// standing beside the door rather than in it, would read as a fault in the mark instead of in this.
describe("the squad standing in the escape door (#152)", () => {
  const staged = demoEscape(demoWorld());
  const self = staged.players.find((p) => p.id === DEMO_SELF);

  test("puts the scene's own player in the door, which is the only one it is drawn for", () => {
    expect(self).toBeDefined();
    expect(self && insideExit(self.pos, staged.exit)).toBe(true);
  });

  test("leaves one of the three out of it, so the frame states a count and not a whole squad", () => {
    const squad = staged.players.map((p) => ({ pos: p.pos, hp: p.hp }));
    expect(escapeTally(squad, staged.exit)).toEqual({ inside: 2, needed: 3 });
    expect(squadEscaped(squad, staged.exit)).toBe(false);
  });

  test("holds the whole squad inside the frame the harness captures", () => {
    for (const p of staged.players) {
      expect(p.pos.x).toBeGreaterThanOrEqual(DEMO_ESCAPE_CAMERA.x);
      expect(p.pos.x).toBeLessThanOrEqual(DEMO_ESCAPE_CAMERA.x + DEMO_VIEWPORT.width);
      expect(p.pos.y).toBeGreaterThanOrEqual(DEMO_ESCAPE_CAMERA.y);
      expect(p.pos.y).toBeLessThanOrEqual(DEMO_ESCAPE_CAMERA.y + DEMO_VIEWPORT.height);
    }
  });

  test("stands the camera where the game would put it for a player pressed against that wall", () => {
    expect(self).toBeDefined();
    if (self) {
      expect(computeCamera(self.pos, DEMO_VIEWPORT, staged.arena)).toEqual(DEMO_ESCAPE_CAMERA);
    }
  });

  test("counts everyone on the roster, because everyone in the scene is at the keyboard", () => {
    expect([...demoConnected(staged)].sort()).toEqual(staged.players.map((p) => p.id).sort());
  });
});

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
