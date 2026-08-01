import { describe, expect, test } from "bun:test";
import { HAND_MINE_RATE } from "./build";
import { freshHarvest, ORE_HARVEST_MS, STRUCTURE_HARVEST_MS, stepHarvest } from "./harvest";

const TILE_A = { tx: 4, ty: 7 };
const TILE_B = { tx: 5, ty: 7 };
const mine = (tile = TILE_A) => ({ kind: "mine", tile }) as const;
const demolish = (id = "b1") => ({ kind: "demolish", id }) as const;

// Hold `target` for `ms`, in frame-sized slices, and return every harvest that completed.
function hold(
  harvest: ReturnType<typeof freshHarvest>,
  target: Parameters<typeof stepHarvest>[1],
  ms: number,
  frameMs = 16,
): ReturnType<typeof stepHarvest>[] {
  const done: ReturnType<typeof stepHarvest>[] = [];
  for (let held = 0; held < ms; held += frameMs) {
    const event = stepHarvest(harvest, target, Math.min(frameMs, ms - held));
    if (event) done.push(event);
  }
  return done;
}

describe("harvest progress", () => {
  test("ore is harvested for as long as a hand takes to earn one Metal", () => {
    expect(ORE_HARVEST_MS).toBe(1_000 / HAND_MINE_RATE);
  });

  test("ore yields nothing until its progress reaches zero", () => {
    expect(hold(freshHarvest(), mine(), ORE_HARVEST_MS - 1)).toEqual([]);
  });

  test("ore at zero emits the tile that was harvested", () => {
    expect(hold(freshHarvest(), mine(), ORE_HARVEST_MS)).toEqual([mine()]);
  });

  test("ore replenishes at zero, so a held button harvests it again", () => {
    expect(hold(freshHarvest(), mine(), 3 * ORE_HARVEST_MS)).toHaveLength(3);
  });

  test("a building yields nothing until its own progress reaches zero", () => {
    expect(hold(freshHarvest(), demolish(), STRUCTURE_HARVEST_MS - 1)).toEqual([]);
  });

  test("a building at zero emits the id that was harvested", () => {
    expect(hold(freshHarvest(), demolish(), STRUCTURE_HARVEST_MS)).toEqual([demolish()]);
  });

  // The hold is what makes demolish safe: a stray right-click while running over your own wall must
  // not delete it, so no single frame may take a building's progress to zero.
  test("no single frame demolishes a building", () => {
    expect(stepHarvest(freshHarvest(), demolish(), STRUCTURE_HARVEST_MS - 1)).toBeNull();
  });

  test("releasing the button mid-harvest starts the next one from full", () => {
    const harvest = freshHarvest();
    hold(harvest, mine(), ORE_HARVEST_MS - 100);
    stepHarvest(harvest, null, 16); // the button comes up
    expect(hold(harvest, mine(), ORE_HARVEST_MS - 100)).toEqual([]);
  });

  test("moving onto another tile mid-hold starts that tile from full", () => {
    const harvest = freshHarvest();
    hold(harvest, mine(TILE_A), ORE_HARVEST_MS - 100);
    expect(hold(harvest, mine(TILE_B), ORE_HARVEST_MS - 100)).toEqual([]);
  });

  test("a tile is not a building: switching between them starts over", () => {
    const harvest = freshHarvest();
    hold(harvest, demolish(), STRUCTURE_HARVEST_MS - 16);
    expect(hold(harvest, mine(), STRUCTURE_HARVEST_MS)).toEqual([]);
  });

  // Two clients each hold their own progress and never see each other's, so two players digging one
  // tile each earn a whole Metal rather than halving one between them.
  test("one harvester's progress does not advance another's", () => {
    const ana = freshHarvest();
    const ben = freshHarvest();
    hold(ana, mine(), ORE_HARVEST_MS - 100);
    expect(hold(ben, mine(), ORE_HARVEST_MS - 100)).toEqual([]);
    expect(hold(ana, mine(), 100)).toEqual([mine()]);
  });

  // Asserted on the frames *after* the huge one, because the frame itself cannot tell the two
  // behaviours apart: one call returns one event either way. What the clamp decides is how much
  // overshoot the harvest carries out of it — unbounded, the three harvests that frame swallowed
  // would come due on the three ordinary frames behind it, one each.
  test("a frame longer than the whole harvest completes it once, and carries no backlog", () => {
    const harvest = freshHarvest();
    expect(stepHarvest(harvest, mine(), 4 * ORE_HARVEST_MS)).toEqual(mine());
    expect(hold(harvest, mine(), ORE_HARVEST_MS - 1)).toEqual([]);
  });

  test("a clock stepped backwards neither completes a harvest nor unwinds one", () => {
    const harvest = freshHarvest();
    hold(harvest, mine(), ORE_HARVEST_MS - 100);
    expect(stepHarvest(harvest, mine(), -10_000)).toBeNull();
    expect(hold(harvest, mine(), 100)).toEqual([mine()]);
  });
});
