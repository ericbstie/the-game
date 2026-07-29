import { describe, expect, test } from "bun:test";
import { PUFF_REACH } from "../src/game/fx";
import { MINIMAP_COVERAGES, minimapWindow, oreCells, oreDensity } from "../src/game/minimap";
import {
  DEMO_CAMERA,
  DEMO_NOW,
  DEMO_SELF,
  DEMO_VIEWPORT,
  demoBursts,
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
