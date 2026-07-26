import { describe, expect, test } from "bun:test";
import { SPRITE_BOX, SPRITES, type SpriteName } from "./registry";

// Fifteen agents draw fifteen sprites in parallel, each against the contract in README.md and
// none of them able to see the others' work. These are the two things about that contract a test
// can hold: that the boxes stay derived from the simulation rather than chosen for the art, and
// that a landed sprite actually fills the box the game will blit it into. They pass vacuously
// until the first sprite lands, and stop passing the moment one lands the wrong size.

describe("SPRITE_BOX", () => {
  test("is the size the entity already is in the simulation, not a number picked for the art", () => {
    expect(SPRITE_BOX).toMatchObject({
      player: 28, // PLAYER_RADIUS × 2
      grunt: 32, // GRUNT_RADIUS × 2
      elite: 48, // ELITE_RADIUS × 2
      nest: 96, // NEST_RADIUS × 2
      miner: 30, // footprint 2 × TILE
      wall: 30,
      turret: 30,
      generator: 75, // footprint 5 × TILE
      "ore-metal": 15, // TILE
      "ore-power": 15,
      room: 30, // TILE × 2, the perimeter band
    });
  });
});

describe("SPRITES", () => {
  const landed = Object.entries(SPRITES) as [SpriteName, (typeof SPRITES)[SpriteName]][];

  test("every landed sprite draws in the box the game blits it into", () => {
    for (const [name, subject] of landed) {
      const box = SPRITE_BOX[name];
      if (!subject || box === undefined) continue;
      // Reported as a pair so a failure names the sprite rather than just the wrong number.
      expect({ name, size: subject.size }).toEqual({ name, size: box });
    }
  });

  test("every landed sprite calls itself what the game calls it", () => {
    for (const [name, subject] of landed) {
      if (subject) expect(subject.name).toBe(name);
    }
  });

  // A sprite module with no registry entry resolves to null, and `drawWorld` then quietly falls
  // back to the M2 shape — which during M5 is indistinguishable from a sprite nobody has drawn
  // yet. So an agent could finish its work, merge green, and never appear in the game. This is
  // what makes that state loud instead: the file existing is the claim, and the entry is the
  // proof. Infrastructure modules are excluded by name because they are not sprites.
  test("every sprite module in this directory is wired into the game", () => {
    const infrastructure = new Set(["sheet", "cache", "registry", "calibration"]);
    const modules = [...new Bun.Glob("*.ts").scanSync({ cwd: import.meta.dir })]
      .map((file) => file.replace(/\.ts$/, ""))
      .filter((name) => !name.endsWith(".test") && !infrastructure.has(name));

    for (const name of modules) {
      expect({ name, wired: SPRITES[name as SpriteName] !== undefined }).toEqual({
        name,
        wired: true,
      });
    }
    expect(modules.length).toBeGreaterThan(0); // the glob itself has to be finding something
  });
});
