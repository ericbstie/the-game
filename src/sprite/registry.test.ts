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
});
