import { describe, expect, test } from "bun:test";
import { ENEMY_CAP } from "../src/game/enemies";
import { measure, worstCaseTick } from "./delta-size";

describe("the worst case is the one the game actually supports", () => {
  test("drives the sim to ENEMY_CAP rather than asserting against a hand-written fixture", () => {
    const { enemies, trimmed } = worstCaseTick();
    expect(enemies).toBe(ENEMY_CAP);
    expect(trimmed.moves).toHaveLength(ENEMY_CAP);
  });

  test("every player's shot rides the measured tick, so `shots` is at its per-tick maximum", () => {
    const { trimmed } = worstCaseTick();
    expect(trimmed.shots).toHaveLength(6);
  });

  // Turret aims stream as transitions, not per tick (#74), so a settled tick carries none. That
  // is the honest steady state to budget against — it is the cost paid 20 times a second.
  test("a settled tick carries no turret aims", () => {
    expect(worstCaseTick().trimmed.aims).toBeUndefined();
  });

  test("`moves` always rides; an empty array is absent from the wire, never present and empty", () => {
    const { trimmed } = worstCaseTick();
    expect(trimmed.moves.length).toBeGreaterThan(0);
    for (const key of [
      "spawns",
      "hits",
      "deaths",
      "nests",
      "structHits",
      "aims",
      "shots",
    ] as const) {
      expect(trimmed[key]?.length ?? 1).toBeGreaterThan(0);
    }
  });
});

describe("what the trim buys", () => {
  test("the trimmed delta is materially smaller, and both compress further", () => {
    const { full, trimmed, deflateMsPerTick } = measure();
    expect(trimmed.raw).toBeLessThan(full.raw * 0.6); // the ticket's target was ~half
    expect(trimmed.compressed).toBeLessThan(trimmed.raw);
    expect(deflateMsPerTick).toBeGreaterThan(0);
  });

  test("trimming does not simply move the cost into the compressor", () => {
    const { full, trimmed } = measure();
    expect(trimmed.compressed).toBeLessThan(full.compressed);
  });
});
