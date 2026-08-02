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
    // At the governor, give or take what the warm-up's own fire has just killed: since #80 the
    // fixture spends thirty ticks shooting before it measures, so the population sits against the
    // cap rather than pinned to it. Anything materially below it is a fixture that stopped working.
    expect(enemies).toBeGreaterThan(DEFAULT_WORLD_SETTINGS.enemyCap - 10);
    expect(enemies).toBeLessThanOrEqual(DEFAULT_WORLD_SETTINGS.enemyCap);
    expect(trimmed.moves).toHaveLength(enemies);
  });

  test("every player's shot rides the measured tick, so the launches are at their maximum", () => {
    const { trimmed } = worstCaseTick();
    // Six players' launches plus whichever turrets came round on this tick — the point is that
    // none of the six is missing, not that nothing else fired.
    expect((trimmed.projectiles ?? []).length).toBeGreaterThanOrEqual(6);
  });

  // #80. A shot lives ~8 ticks in the air, so a tick taken cold would carry only the launches
  // fired on it — the budget has to be against a sky that is already full.
  test("the measured tick is taken with shots already in flight, not on a cold sim", () => {
    const { inFlight } = worstCaseTick();
    expect(inFlight).toBeGreaterThan(6);
  });

  // The decision #80 had to remake (#74 chose transitions over per-shot streaming). Both shapes are
  // built from the same tick so the comparison is a measurement rather than an argument.
  test("streaming every shot's position is measured beside deriving it, on one tick", () => {
    const { trimmed, streamed } = worstCaseTick();
    expect(streamed.spent).toBeUndefined();
    expect(streamed.projectiles).toBeUndefined();
    expect(streamed.moves.length).toBe(trimmed.moves.length + (worstCaseTick().inFlight ?? 0));
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
      "projectiles",
      "spent",
    ] as const) {
      expect(trimmed[key]?.length ?? 1).toBeGreaterThan(0);
    }
  });
});

// #80 had to remake #74's turret-wire decision, and this is the property that settled it: what a
// derived flight costs is set by how often the game *fires*, which its cadences fix, while what a
// streamed one costs is set by how long a shot is *in the air*, which is a provisional speed.
describe("what deriving a flight buys over streaming it", () => {
  test("streaming is charged per shot in the air; deriving is charged per shot fired", () => {
    const { streamed, streamedBare, inFlightCeiling } = measure();
    expect(streamed.inFlight).toBeGreaterThan(0);
    const perShot = (streamed.raw - streamedBare.raw) / streamed.inFlight;
    expect(perShot).toBeGreaterThan(0); // linear in the count, which is the whole finding
    expect(inFlightCeiling).toBeGreaterThan(streamed.inFlight);
  });

  test("and at the ceiling the cadences allow, streaming costs more than what ships", () => {
    const { trimmed, streamed, streamedBare, inFlightCeiling } = measure();
    const perShot = (streamed.raw - streamedBare.raw) / streamed.inFlight;
    expect(streamedBare.raw + perShot * inFlightCeiling).toBeGreaterThan(trimmed.raw);
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
