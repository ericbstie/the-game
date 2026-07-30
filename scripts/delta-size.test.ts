import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { DEFAULT_WORLD_SETTINGS } from "../src/game/worldSettings";
import { measure, worstCaseTick } from "./delta-size";

// Every test here drives the sim to `enemyCap` itself, which is ~1.4 s apiece — comfortable alone,
// and about 5.3 s under a full suite's CPU contention, against bun's 5 s default. That is #126's
// shape a second time, and the same answer applies: the work is the point (a hand-written fixture is
// exactly what these tests exist not to trust), so the timeout moves rather than the tests.
//
// Per-file rather than global: a raised default everywhere would hide a real hang, and every test in
// *this* file shares the one expensive step.
setDefaultTimeout(30_000);

describe("the worst case is the one the game actually supports", () => {
  test("drives the sim to the enemy cap rather than asserting against a hand-written fixture", () => {
    const { enemies, trimmed } = worstCaseTick();
    expect(enemies).toBe(DEFAULT_WORLD_SETTINGS.enemyCap);
    expect(trimmed.moves).toHaveLength(DEFAULT_WORLD_SETTINGS.enemyCap);
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

// #102 put `ammo` on the delta as a sparse field, and the benchmark could not see it: the tick
// measured here is a settled one, which by construction carries no economy field at all. A budget
// that structurally cannot observe a field is the rot the header warns about, so each is measured
// on a tick that does carry it and reported against the settled one.
describe("what a sparse economy field costs", () => {
  test("the settled tick carries neither, which is exactly why they are measured apart", () => {
    const { trimmed } = worstCaseTick();
    expect(trimmed.bank).toBeUndefined();
    expect(trimmed.ammo).toBeUndefined();
  });

  test("each is measured on a tick that really does carry its own field", () => {
    const { bankTick, ammoTick } = worstCaseTick();
    expect(bankTick.bank).toBeDefined();
    expect(ammoTick.ammo).toBeDefined();
  });

  test("and each therefore reads as bytes the settled tick does not pay", () => {
    const { trimmed, bankTick, ammoTick } = measure();
    expect(bankTick.raw).toBeGreaterThan(trimmed.raw);
    expect(ammoTick.raw).toBeGreaterThan(trimmed.raw);
  });
});
