import type { Arena } from "../lobby/protocol";

// The knobs a world is built and simulated from (#127): one object, threaded through
// `generateWorld`, `generateOre` and the enemy sim, in place of the private module constants each
// of them used to read. Nobody chooses these yet — `DEFAULT_WORLD_SETTINGS` is exactly the world
// the game ships with; putting them on the wire is #128 and letting the host pick them is #129.
//
// Its own module rather than a corner of `world.ts` because it is the one shape all three
// generators and both sides of the wire share, the way `protocol.ts` is — and because a settings
// object in `world.ts` would make that module name the enemy sim's knobs, which #93 deliberately
// keeps it from doing.
//
// Every number here is **provisional** balance (#123/#124/#125): a later change to one is a
// retune, not a correction.
export interface WorldSettings {
  // One giant box: ~2 minutes to walk end-to-end at PLAYER_SPEED (≈60 s centre → perimeter).
  arena: Arena;
  // Ore density. Power ore is smaller and sparser than metal, per the spec.
  metalPatches: number;
  powerPatches: number;
  // Ore distribution: the radial fraction of a patch centre is drawn as u ** (1 / oreEdgeBias), so
  // areal density grows toward the wall instead of thinning as the rings get longer.
  oreEdgeBias: number;
  nestCount: number;
  // The nests' own bias, deliberately not the ore's (`docs/adr/0005`). The same curve at the same
  // 3.5 today, but sampled over the nest band rather than the whole arena, and a retune of ore
  // generation must not move all fifty nests.
  nestEdgeBias: number;
  // Hard concurrency governor; a nest holds its remainder at the cap. It binds within a couple of
  // minutes of the wave-size cap, so from mid-match on it is this — not the curves below — that
  // sets how full the arena feels. It also governs frame cost, and is the one knob a measurement
  // rather than a played match can veto: `docs/frame-budget.md` and `docs/map-delta-budget.md` are
  // both characterised at 500.
  enemyCap: number;
  // The three escalation curves (#124), each anchored at the end of the spawn grace. How long a
  // nest waits between waves, how many enemies a wave carries, and how many of them are elites.
  nestPeriod: { startMs: number; fallMs: number; floorMs: number };
  waveSize: { start: number; growth: number; max: number };
  eliteShare: { ptsPerMin: number; max: number }; // whole percentage points per minute, and a share
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  arena: { width: 31_200, height: 31_200 },
  metalPatches: 140,
  powerPatches: 40,
  oreEdgeBias: 3.5,
  nestCount: 50,
  nestEdgeBias: 3.5,
  enemyCap: 500,
  nestPeriod: { startMs: 60_000, fallMs: 5_000, floorMs: 10_000 },
  waveSize: { start: 1, growth: 1, max: 5 },
  eliteShare: { ptsPerMin: 5, max: 0.3 },
};
