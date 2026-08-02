import { describe, expect, test } from "bun:test";
import type { EnemySpawn, Tile, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILDABLES,
  type BuildableSpec,
  type BuildState,
  buildCost,
  demolishStructure,
  freshBuildState,
  mulberry32,
  placeStructure,
  removeStructure,
  type Structure,
  structureBlocking,
  structureCenter,
  TILE,
  TURRET_ACTIVE_DRAW,
  TURRET_CADENCE_MS,
  TURRET_DAMAGE,
  TURRET_IDLE_DRAW,
  TURRET_RANGE,
  tileOf,
} from "./build";
import {
  AGGRO_RADIUS,
  ATTACK_POS_TOLERANCE,
  type Attack,
  admitAttack,
  BLAST_RADIUS,
  BLAST_TRIGGER,
  BLOODLING_HP,
  BLOODLING_RADIUS,
  BLOODLING_SHARE,
  BLOODLING_SPEED,
  ELITE_HP,
  ELITE_SPEED,
  type Enemy,
  type EnemyEvents,
  type EnemyState,
  eliteShare,
  enemyContactCadenceMs,
  enemyContactDamage,
  enemyRadius,
  freshGuard,
  GRUNT_HP,
  GRUNT_RADIUS,
  GRUNT_SPEED,
  NEST_BAND_INNER,
  NEST_HP_INNER,
  NEST_HP_OUTER,
  NEST_RADIUS,
  type Nest,
  type NestKind,
  nestBandOuter,
  nestLayout,
  nestPeriodMs,
  type PlayerRef,
  PROJECTILE_SPEED,
  RANGED_CADENCE_MS,
  RANGED_DAMAGE,
  RANGED_HALFWIDTH,
  RANGED_RANGE,
  SPAWN_GRACE_MS,
  spawnEnemyState,
  stepEnemies,
  WANDER_LEG_MS,
  WANDERER_CHANCE_OUTER,
  waveSize,
} from "./enemies";
import { ARENA, PLAYER_RADIUS, PLAYER_SPEED } from "./world";
import { DEFAULT_WORLD_SETTINGS as DEFAULTS } from "./worldSettings";

const C = { x: ARENA.width / 2, y: ARENA.height / 2 };
const HALF = (ARENA.width / 2) * (1 - 0.08); // the mid-band inset: the nest band's outer bound

const worldInit = (nestSeed = 1): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [],
  oreSeed: 1,
  nestSeed,
  settings: DEFAULTS,
});

const grunt = (id: string, pos: Vec2, hp = GRUNT_HP): Enemy => ({
  id,
  kind: "grunt",
  pos,
  hp,
  biteMs: 0,
});
const stateWith = (enemies: Enemy[], rng: () => number = () => 0.5): EnemyState => ({
  arena: ARENA,
  enemies: new Map(enemies.map((e) => [e.id, e])),
  projectiles: new Map(),
  nests: [], // and so nothing spawns during these targeted tests
  elapsedMs: 0,
  nestTimers: new Map(),
  rng,
  settings: DEFAULTS,
  nextId: enemies.length + 1,
  nextShotId: 1,
});
// Take every nest off its timer, for the tests that want the nests standing there without spawning.
const silence = (state: EnemyState): EnemyState => {
  for (const nest of state.nests) state.nestTimers.set(nest.id, Number.POSITIVE_INFINITY);
  return state;
};
// And arm every nest to fire on the next tick, for the tests that do not want to spend the grace.
const armed = (state: EnemyState, minutes = 0): EnemyState => {
  state.elapsedMs = SPAWN_GRACE_MS + minutes * 60_000;
  for (const nest of state.nests) state.nestTimers.set(nest.id, 0);
  return state;
};
const only = (state: EnemyState) => [...state.enemies.values()][0];
// A spawn point keyed exactly, so a wave can be attributed to the nest that emitted it now that
// nests carry no sector. With the sim's rng at 0.5 the jitter is zero, so a grunt spawns on its
// nest to the last bit.
const where = (pos: Vec2) => `${pos.x},${pos.y}`;
// Cut the layout down to one nest, for the tests that are about what a single nest emits rather
// than about fifty of them.
const onlyNestState = (state: EnemyState): EnemyState => {
  state.nests = state.nests.slice(0, 1);
  return state;
};
const onlyNest = (state: EnemyState): Nest => onlyNestState(state).nests[0];
const at = (state: EnemyState, id: string) => state.enemies.get(id);
const player = (pos: Vec2) => [{ id: "p1", pos }];
const shot = (pos: Vec2, dir: Vec2, by = "p1"): Attack => ({ pos, dir, by });
// The tick a shot is fired on, and nothing after it. A projectile leaves on this tick and travels
// on the ones that follow (#80), so this reports the launch and never the blow.
const step = (state: EnemyState, attacks: Attack[]) => stepEnemies(state, [], attacks, 0).events;

// The sim's own tick, which every flight test has to run at: a projectile advances by the injected
// `dtMs`, so a test that steps at 0 never moves one.
const DT = 50;

// Fire, then run the sim on until nothing is left in the air, reporting every tick's events
// merged. This is what "damage applies on impact" costs a test — the launch and the blow are on
// different ticks now, and most of this file does not care which.
//
// Every enemy is put back where it started after each tick, which is the other half of that cost:
// a shot takes several ticks to arrive, and an enemy with nobody to chase wanders in the meantime,
// so a geometry assertion left to run would be a statement about the sim's wander heading. The
// tests that are *about* a target moving move it themselves.
const settle = (
  state: EnemyState,
  attacks: Attack[],
  players: PlayerRef[] = [],
  build: BuildState | null = null,
): EnemyEvents => {
  const merged: EnemyEvents = {
    moves: [],
    spawns: [],
    hits: [],
    deaths: [],
    nests: [],
    structHits: [],
    removals: [],
    aims: [],
    projectiles: [],
    spent: [],
  };
  const held = new Map([...state.enemies].map(([id, e]) => [id, { ...e.pos }]));
  // Long enough for a full-reach shot to expire — 700 u at PROJECTILE_SPEED is 8 ticks — with room
  // to spare, and bounded so a flight that never ends fails a test rather than hanging it.
  for (let i = 0; i < 40; i++) {
    const { events } = stepEnemies(state, players, i === 0 ? attacks : [], DT, build);
    for (const [id, pos] of held) {
      const enemy = state.enemies.get(id);
      if (enemy) enemy.pos = { ...pos };
    }
    merged.moves = events.moves;
    merged.spawns.push(...events.spawns);
    merged.hits.push(...events.hits);
    merged.deaths.push(...events.deaths);
    merged.nests.push(...events.nests);
    merged.structHits.push(...events.structHits);
    merged.removals.push(...events.removals);
    merged.aims.push(...events.aims);
    merged.projectiles.push(...events.projectiles);
    merged.spent.push(...events.spent);
    if (i > 0 && state.projectiles.size === 0) break;
  }
  return merged;
};

// Step until a shot lands, holding the enemies still while it flies — `settle` for the shooters
// that fire themselves. `dtMs` is what the first tick is given, because a turret's cadence is
// charged in milliseconds and several of these tests are about exactly that.
const land = (state: EnemyState, build: BuildState, dtMs = 0): EnemyEvents => {
  const held = new Map([...state.enemies].map(([id, e]) => [id, { ...e.pos }]));
  let events = stepEnemies(state, [], [], dtMs, build).events;
  for (let i = 0; i < 20 && events.hits.length === 0 && events.deaths.length === 0; i++) {
    for (const [id, pos] of held) {
      const enemy = state.enemies.get(id);
      if (enemy) enemy.pos = { ...pos };
    }
    events = stepEnemies(state, [], [], DT, build).events;
  }
  return events;
};

describe("spawnEnemyState", () => {
  test("places `nestCount` nests, no enemies, and starts the match clock at zero", () => {
    const s = spawnEnemyState(worldInit(), () => 0);
    expect(s.nests).toHaveLength(DEFAULTS.nestCount);
    expect(s.enemies.size).toBe(0);
    expect(s.elapsedMs).toBe(0);
    expect([...s.nestTimers.values()]).toEqual(Array(DEFAULTS.nestCount).fill(SPAWN_GRACE_MS));
  });

  test("every nest starts alive at its own full HP", () => {
    const s = spawnEnemyState(worldInit(), () => 0);
    expect(s.nests.every((n) => n.alive && n.hp === n.maxHp)).toBe(true);
  });

  test("the layout comes off the world's nestSeed, not the sim's rng", () => {
    const world = worldInit(4_242);
    expect(spawnEnemyState(world, () => 0).nests).toEqual(spawnEnemyState(world, () => 0.9).nests);
    expect(spawnEnemyState(world, () => 0).nests).toEqual(nestLayout(ARENA, 4_242));
  });
});

// #123. Fifty nests placed at random in a band, biased hard toward the wall, each one a hunter or a
// wanderer nest and each one worth more HP the further out it sits. Every number asserted here is
// provisional: a retune moves these expectations, and that is not a regression.
describe("nest layout (#123)", () => {
  // A fixed seed set, so every statistical assertion below is a fixed number rather than a sample.
  // These tests pass always or fail always; none of them can flake.
  const SEEDS = 1_000; // 50,000 nests: enough that every tolerance below is a wide margin
  const many = (): Nest[] =>
    Array.from({ length: SEEDS }, (_, i) => nestLayout(ARENA, i + 1)).flat();
  const radiusOf = (n: Nest) => Math.hypot(n.pos.x - C.x, n.pos.y - C.y);
  // Where a nest sits in the band: 0 at the inner bound, 1 at the outer. Distance is the layout's
  // only dial — placement, HP and type all read off this one number.
  const outward = (n: Nest) =>
    (radiusOf(n) - NEST_BAND_INNER) / (nestBandOuter(ARENA) - NEST_BAND_INNER);

  test("the band runs from two aggro radii out to the mid-band inset — 3,600 u to 14,352 u", () => {
    expect(NEST_BAND_INNER).toBe(3_600);
    expect(NEST_BAND_INNER).toBe(2 * AGGRO_RADIUS);
    expect(nestBandOuter(ARENA)).toBeCloseTo(14_352, 6);
    expect(nestBandOuter(ARENA)).toBeCloseTo(HALF, 6);
  });

  test("there are fifty of them", () => {
    expect(DEFAULTS.nestCount).toBe(50);
    expect(nestLayout(ARENA, 1)).toHaveLength(DEFAULTS.nestCount);
  });

  test("none lands inside 3,600 u of centre or beyond 14,352 u, on any seed", () => {
    const radii = many().map(radiusOf);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(3_600);
    expect(Math.max(...radii)).toBeLessThanOrEqual(14_352);
  });

  test("nests may cluster or overlap — no minimum separation is enforced", () => {
    const closest = (nests: Nest[]) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < nests.length; i++) {
        for (let j = i + 1; j < nests.length; j++) {
          const gap = Math.hypot(nests[i].pos.x - nests[j].pos.x, nests[i].pos.y - nests[j].pos.y);
          best = Math.min(best, gap);
        }
      }
      return best;
    };
    const tightest = Math.min(
      ...Array.from({ length: SEEDS }, (_, i) => closest(nestLayout(ARENA, i + 1))),
    );
    expect(tightest).toBeLessThan(2 * NEST_RADIUS); // two of them touching, somewhere in the set
  });

  test("density rises toward the wall on u ** (1 / 3.5)", () => {
    expect(DEFAULTS.nestEdgeBias).toBe(3.5);
    const all = many();
    const bins = new Array(10).fill(0);
    for (const n of all) bins[Math.min(9, Math.floor(outward(n) * 10))]++;
    // Sampling the radial fraction as u ** (1 / 3.5) makes its CDF u ** 3.5, so a decile of the band
    // holds ((i+1)/10) ** 3.5 − (i/10) ** 3.5 of the nests. Spelled as the literal the ticket asked
    // for, not as `nestEdgeBias`, so retuning the exponent cannot move the expectation with it.
    for (let i = 0; i < 10; i++) {
      const share = bins[i] / all.length;
      const expected = ((i + 1) / 10) ** 3.5 - (i / 10) ** 3.5;
      expect(Math.abs(share - expected)).toBeLessThan(0.002);
    }
    const outerHalf = bins.slice(5).reduce((a, b) => a + b, 0) / all.length;
    expect(outerHalf).toBeGreaterThan(0.9); // which is what puts ~91% of them in the outer half
  });

  // Radius bins of equal *count*, not equal width: the edge bias leaves an equal-width inner bin
  // holding a handful of nests out of 50,000, too few to read a share off.
  const byRadiusBins = (all: Nest[]): { meanOut: number; wandererShare: number }[] => {
    const sorted = all.sort((a, b) => outward(a) - outward(b));
    const perBin = Math.floor(sorted.length / 10);
    return Array.from({ length: 10 }, (_, b) => {
      const bin = sorted.slice(b * perBin, (b + 1) * perBin);
      return {
        meanOut: bin.reduce((sum, n) => sum + outward(n), 0) / bin.length,
        wandererShare: bin.filter((n) => n.kind === "wanderer").length / bin.length,
      };
    });
  };

  test("wanderer share in a radius bin is 0.9 × how far out that bin sits", () => {
    expect(WANDERER_CHANCE_OUTER).toBe(0.9);
    for (const bin of byRadiusBins(many())) {
      expect(Math.abs(bin.wandererShare - WANDERER_CHANCE_OUTER * bin.meanOut)).toBeLessThan(0.02);
    }
  });

  test("that line reads 0% at 3,600 u and 90% at 14,352 u", () => {
    // Fitted rather than sampled at the ends. The inner bound is the one place the layout puts
    // nothing — the edge bias is what makes it empty — so the 0% end is only ever an intercept.
    const bins = byRadiusBins(many());
    const meanX = bins.reduce((sum, b) => sum + b.meanOut, 0) / bins.length;
    const meanY = bins.reduce((sum, b) => sum + b.wandererShare, 0) / bins.length;
    const slope =
      bins.reduce((sum, b) => sum + (b.meanOut - meanX) * (b.wandererShare - meanY), 0) /
      bins.reduce((sum, b) => sum + (b.meanOut - meanX) ** 2, 0);
    const intercept = meanY - slope * meanX;
    // The ticket's two numbers as literals, so retuning `WANDERER_CHANCE_OUTER` cannot move them.
    expect(Math.abs(intercept)).toBeLessThan(0.02); // 0% at the inner bound
    expect(Math.abs(intercept + slope - 0.9)).toBeLessThan(0.03); // 90% at the outer
  });

  test("out at the wall the share really is 0.9 — read off the outermost 1% of the band", () => {
    const outermost = many().filter((n) => outward(n) > 0.99);
    expect(outermost.length).toBeGreaterThan(1_000); // enough of them to read a share off
    const share = outermost.filter((n) => n.kind === "wanderer").length / outermost.length;
    expect(Math.abs(share - WANDERER_CHANCE_OUTER)).toBeLessThan(0.03);
  });

  test("HP scales linearly with distance: 150 at the inner bound, 600 at the outer", () => {
    expect([NEST_HP_INNER, NEST_HP_OUTER]).toEqual([150, 600]);
    const all = many();
    for (const n of all) {
      const line = NEST_HP_INNER + outward(n) * (NEST_HP_OUTER - NEST_HP_INNER);
      expect(n.maxHp).toBe(Math.round(line)); // whole HP, so it rides the wire as one (#84)
    }
    expect(Math.min(...all.map((n) => n.maxHp))).toBeGreaterThanOrEqual(NEST_HP_INNER);
    expect(Math.max(...all.map((n) => n.maxHp))).toBe(NEST_HP_OUTER);
  });

  test("the same seed derives the same layout; a different seed a different one", () => {
    expect(nestLayout(ARENA, 99)).toEqual(nestLayout(ARENA, 99));
    expect(nestLayout(ARENA, 99)).not.toEqual(nestLayout(ARENA, 100));
  });

  test("a nest's type is fixed at world gen and survives a whole match", () => {
    const s = spawnEnemyState(worldInit(7), () => 0.5);
    const typed = s.nests.map((n) => `${n.id}:${n.kind}`);
    const doomed = s.nests[0];
    const origin = { x: doomed.pos.x - 100, y: doomed.pos.y };
    let spawned = 0;
    for (let i = 0; i < 1_500; i++) {
      if (i === 5) doomed.hp = RANGED_DAMAGE; // one shot from silence…
      const attacks = i === 6 ? [shot(origin, { x: 1, y: 0 })] : []; // …and that shot lands
      spawned += stepEnemies(s, player({ ...C }), attacks, 200).events.spawns.length; // 5 min
      s.enemies.clear(); // so the cap never swallows a later wave
    }
    expect(s.nests.filter((n) => !n.alive)).toHaveLength(1); // one really was silenced
    expect(spawned).toBeGreaterThan(DEFAULTS.nestCount); // and waves really did fire
    expect(s.nests.map((n) => `${n.id}:${n.kind}`)).toEqual(typed);
  });
});

// #124. Three curves, each one a pure function of the match clock and each one anchored at the end
// of the one-minute grace: the first wave a squad ever meets is the curves' starting value. Every
// number here is provisional — a retune moves these expectations, and that is not a regression.
describe("the escalation curves (#124)", () => {
  const MIN = 60_000;
  const at = (minutes: number) => SPAWN_GRACE_MS + minutes * MIN;

  describe("period", () => {
    test("is its starting 60 s for the whole first minute of spawning", () => {
      expect(nestPeriodMs(at(0))).toBe(DEFAULTS.nestPeriod.startMs);
      expect(nestPeriodMs(at(1) - 1)).toBe(DEFAULTS.nestPeriod.startMs);
    });

    test("falls one step per minute after that", () => {
      expect(nestPeriodMs(at(1))).toBe(55_000);
      expect(nestPeriodMs(at(2))).toBe(50_000);
      expect(nestPeriodMs(at(3))).toBe(45_000);
    });

    test("floors at 10 s and never falls through it", () => {
      expect(nestPeriodMs(at(9))).toBe(15_000);
      expect(nestPeriodMs(at(10))).toBe(DEFAULTS.nestPeriod.floorMs);
      expect(nestPeriodMs(at(11))).toBe(DEFAULTS.nestPeriod.floorMs);
      expect(nestPeriodMs(at(600))).toBe(DEFAULTS.nestPeriod.floorMs);
    });

    test("reads as its starting value through the grace, when no nest is armed anyway", () => {
      expect(nestPeriodMs(0)).toBe(DEFAULTS.nestPeriod.startMs);
      expect(nestPeriodMs(SPAWN_GRACE_MS - 1)).toBe(DEFAULTS.nestPeriod.startMs);
    });
  });

  describe("wave size", () => {
    test("is one for the whole first minute of spawning", () => {
      expect(waveSize(at(0))).toBe(DEFAULTS.waveSize.start);
      expect(waveSize(at(1) - 1)).toBe(DEFAULTS.waveSize.start);
    });

    test("grows by one per minute after that", () => {
      expect(waveSize(at(1))).toBe(2);
      expect(waveSize(at(2))).toBe(3);
      expect(waveSize(at(3))).toBe(4);
    });

    test("caps at five and never grows past it", () => {
      expect(waveSize(at(4))).toBe(DEFAULTS.waveSize.max);
      expect(waveSize(at(5))).toBe(DEFAULTS.waveSize.max);
      expect(waveSize(at(600))).toBe(DEFAULTS.waveSize.max);
    });

    test("is one through the grace", () => {
      expect(waveSize(0)).toBe(DEFAULTS.waveSize.start);
    });
  });

  describe("elite share", () => {
    test("is nothing for the whole first minute of spawning — the first waves are all grunts", () => {
      expect(eliteShare(at(0))).toBe(0);
      expect(eliteShare(at(1) - 1)).toBe(0);
    });

    test("grows five points per minute after that", () => {
      expect(eliteShare(at(1))).toBe(0.05);
      expect(eliteShare(at(2))).toBe(0.1);
      expect(eliteShare(at(3))).toBe(0.15);
    });

    test("caps at thirty points and never grows past it", () => {
      expect(eliteShare(at(6))).toBe(DEFAULTS.eliteShare.max);
      expect(eliteShare(at(7))).toBe(DEFAULTS.eliteShare.max);
      expect(eliteShare(at(600))).toBe(DEFAULTS.eliteShare.max);
    });

    test("is nothing through the grace", () => {
      expect(eliteShare(0)).toBe(0);
    });
  });
});

// #124. Every nest keeps its own timer: one minute of grace, then a wave on that nest's own
// period, escalating on the curves above. There is no global wave clock and no wave index.
describe("per-nest spawning (#124)", () => {
  const DT = 50; // the real tick, so a timer is read at the resolution the sim runs at
  const ticks = (state: EnemyState, count: number, players: PlayerRef[] = []) => {
    const spawns: EnemySpawn[][] = [];
    for (let i = 0; i < count; i++) spawns.push(stepEnemies(state, players, [], DT).events.spawns);
    return spawns;
  };

  test("nothing spawns for the first minute, whatever phases the rng deals", () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      const s = spawnEnemyState(worldInit(seed), mulberry32(seed));
      const before = ticks(s, SPAWN_GRACE_MS / DT - 1).flat();
      expect(before).toEqual([]);
      expect(s.elapsedMs).toBe(SPAWN_GRACE_MS - DT);
    }
  });

  test("and the grace really does end: every nest has fired by the end of the first period", () => {
    const s = spawnEnemyState(worldInit(5), mulberry32(5));
    // The phases stay as the seed dealt them; only the jitter is stood down, so a spawn point is its
    // nest's position exactly. Seed 5 puts two nests 458 u apart, and nothing forbids that (#111
    // asks for no minimum separation), so attributing a jittered spawn by proximity can pick the
    // wrong one of the pair.
    s.rng = () => 0.5;
    const fired = new Set<string>();
    for (let i = 0; i < (SPAWN_GRACE_MS + DEFAULTS.nestPeriod.startMs) / DT; i++) {
      s.enemies.clear(); // the cap is not what this test is about
      for (const sp of stepEnemies(s, [], [], DT).events.spawns) fired.add(where(sp.pos));
    }
    expect(fired.size).toBe(DEFAULTS.nestCount);
  });

  test("every nest is armed inside the first period after the grace, never before it", () => {
    const s = spawnEnemyState(worldInit(3), mulberry32(3));
    expect(s.nestTimers.size).toBe(DEFAULTS.nestCount);
    for (const nest of s.nests) {
      const armedAt = s.nestTimers.get(nest.id) as number;
      expect(armedAt).toBeGreaterThanOrEqual(SPAWN_GRACE_MS);
      expect(armedAt).toBeLessThan(SPAWN_GRACE_MS + DEFAULTS.nestPeriod.startMs);
    }
  });

  test("the timers are independent — fifty nests do not fire on one tick", () => {
    const s = spawnEnemyState(worldInit(11), mulberry32(11));
    const window = ticks(s, (SPAWN_GRACE_MS + DEFAULTS.nestPeriod.startMs) / DT);
    const firing = window.filter((spawns) => spawns.length > 0);
    expect(firing.length).toBeGreaterThan(DEFAULTS.nestCount / 2); // spread across many ticks, not one
    expect(Math.max(...firing.map((spawns) => spawns.length))).toBeLessThan(DEFAULTS.nestCount / 5);
  });

  test("a nest re-arms on the period the curve gives, not on a global clock", () => {
    const one = (minutes: number) => {
      const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => 0.5)), minutes);
      s.nestTimers.set(s.nests[0].id, DT); // due exactly on the next tick, so the gap is the period
      let gap = 0;
      stepEnemies(s, [], [], DT); // the armed wave
      do {
        gap += DT;
      } while (stepEnemies(s, [], [], DT).events.spawns.length === 0);
      return gap;
    };
    expect(one(0)).toBe(DEFAULTS.nestPeriod.startMs);
    expect(one(2)).toBe(50_000);
  });

  test("a wave carries what the size curve says, from one nest", () => {
    const sizes = [0, 1, 2, 3, 4, 5, 9].map((minutes) => {
      const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => 0.5)), minutes);
      return stepEnemies(s, [], [], DT).events.spawns.length;
    });
    expect(sizes).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });

  test("a wave spawns at its own nest", () => {
    const s = armed(spawnEnemyState(worldInit(), () => 0.5)); // rng 0.5 → zero jitter
    const spawns = stepEnemies(s, [], [], DT).events.spawns;
    expect(spawns).toHaveLength(DEFAULTS.nestCount * DEFAULTS.waveSize.start);
    expect(spawns.map((sp) => where(sp.pos)).sort()).toEqual(
      s.nests.map((n) => where(n.pos)).sort(),
    );
  });

  test("the elite share decides each enemy in the wave, and 0% means all grunts", () => {
    const mix = (minutes: number, roll: number) => {
      const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => roll)), minutes);
      return stepEnemies(s, [], [], DT).events.spawns.map((sp) => sp.kind);
    };
    expect(mix(0, 0)).toEqual(["grunt"]); // a 0% share admits nothing, however low the roll
    expect(mix(6, 0.29)).toEqual(Array(DEFAULTS.waveSize.max).fill("elite")); // under 30% — every one
    expect(mix(6, 0.31)).toEqual(Array(DEFAULTS.waveSize.max).fill("grunt")); // over it — none
  });

  test("an elite spawns at ELITE_HP", () => {
    const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => 0)), 6);
    const spawns = stepEnemies(s, [], [], DT).events.spawns;
    expect(spawns.find((sp) => sp.kind === "elite")?.hp).toBe(ELITE_HP);
  });

  test("the enemy cap governs concurrency: a nest holds its remainder at the cap", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    for (let i = 0; i < 8_000 && s.enemies.size < DEFAULTS.enemyCap; i++)
      stepEnemies(s, [], [], DT);
    expect(s.enemies.size).toBe(DEFAULTS.enemyCap);
    ticks(s, 200);
    expect(s.enemies.size).toBe(DEFAULTS.enemyCap); // reached and held, never breached
  });

  test("a silenced nest never fires again; its neighbours keep their timers", () => {
    const s = armed(spawnEnemyState(worldInit(), () => 0.5));
    const doomed = s.nests[0];
    doomed.alive = false;
    const spawns = stepEnemies(s, [], [], DT).events.spawns;
    expect(spawns).toHaveLength((DEFAULTS.nestCount - 1) * DEFAULTS.waveSize.start);
    expect(spawns.map((sp) => where(sp.pos))).not.toContain(where(doomed.pos));
  });

  test("a partially-damaged nest still fires its full wave", () => {
    const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => 0.5)), 4);
    s.nests[0].hp = 1;
    expect(stepEnemies(s, [], [], DT).events.spawns).toHaveLength(DEFAULTS.waveSize.max);
  });

  // The purity claim in the module's own header, asserted the only way that can catch shared
  // module state: two sims of the same world stepped alternately. A module-level `let` anywhere in
  // the spawn path — a timer, a clock, a wave counter — would make one of them read the other's.
  test("two sims of one world step identically even interleaved", () => {
    const a = spawnEnemyState(worldInit(8), mulberry32(8));
    const b = spawnEnemyState(worldInit(8), mulberry32(8));
    const squad = player({ ...C });
    for (let i = 0; i < 4_000; i++) {
      const sa = stepEnemies(a, squad, [], DT).events.spawns;
      const sb = stepEnemies(b, squad, [], DT).events.spawns;
      expect(sa).toEqual(sb);
    }
    expect(a.enemies.size).toBeGreaterThan(0);
    expect([...a.enemies.values()]).toEqual([...b.enemies.values()]);
  });
});

// #124. A hunter nest sends its wave at the nearest player at any distance, and the wave commits to
// that player for life — while still breaking off for anything that comes inside AGGRO_RADIUS.
describe("hunter waves (#124)", () => {
  const DT = 50;
  const nestAt = (pos: Vec2, kind: NestKind): Nest => ({
    id: "n0",
    pos,
    hp: NEST_HP_INNER,
    maxHp: NEST_HP_INNER,
    alive: true,
    kind,
  });
  // One nest of a chosen kind, armed to fire on the next tick with nothing else in the world.
  const oneNest = (pos: Vec2, kind: NestKind): EnemyState => ({
    arena: ARENA,
    enemies: new Map(),
    projectiles: new Map(),
    nests: [nestAt(pos, kind)],
    elapsedMs: SPAWN_GRACE_MS,
    nestTimers: new Map([["n0", 0]]),
    rng: () => 0.5, // zero jitter, so the wave spawns on the nest to the last bit
    settings: DEFAULTS,
    nextId: 1,
    nextShotId: 1,
  });
  const fire = (state: EnemyState, players: PlayerRef[]) =>
    stepEnemies(state, players, [], DT).events.spawns;
  const distTo = (from: Vec2, to: Vec2) => Math.hypot(to.x - from.x, to.y - from.y);
  const EDGE = { x: C.x + HALF, y: C.y }; // the outer bound of the nest band: as far out as a nest gets

  test("a nest at the far edge sends its wave at a player standing at centre", () => {
    const s = oneNest(EDGE, "hunter");
    const squad = player({ ...C });
    expect(fire(s, squad)).toHaveLength(1);
    const hunter = only(s);
    expect(hunter.hunt).toBe("p1");
    expect(distTo(hunter.pos, C)).toBeGreaterThan(AGGRO_RADIUS); // committed from far outside aggro

    let closing = distTo(hunter.pos, C);
    for (let i = 0; i < 40_000 && closing > 100; i++) {
      stepEnemies(s, squad, [], DT);
      const now = distTo(hunter.pos, C);
      expect(now).toBeLessThan(closing); // never stalls, and stops at no radius at all
      closing = now;
    }
    expect(closing).toBeLessThanOrEqual(100);
  });

  test("a wanderer nest's wave hunts nobody, and walks past the squad rather than at it", () => {
    // Off the axis the squad stands on, so a due-west leg never brings it inside AGGRO_RADIUS of
    // the player — a hunter out of this nest would close on him from any distance.
    const s = oneNest({ x: C.x + 10_000, y: C.y + 4_000 }, "wanderer");
    const squad = player({ ...C });
    expect(fire(s, squad)).toHaveLength(1);
    const drifter = only(s);
    expect(drifter.hunt).toBeUndefined();
    for (let i = 0; i < 40_000; i++) stepEnemies(s, squad, [], DT);
    expect(drifter.pos.x).toBeCloseTo(GRUNT_RADIUS, 6); // crossed the arena, on its own heading
    expect(distTo(drifter.pos, C)).toBeGreaterThan(AGGRO_RADIUS); // and never noticed him
  });

  test("the wave commits to the nearest player at spawn, at any distance", () => {
    const nest = { x: C.x + 10_000, y: C.y };
    const far = { id: "far", pos: { ...C } };
    const near = { id: "near", pos: { x: C.x + 4_000, y: C.y } };
    const s = oneNest(nest, "hunter");
    fire(s, [far, near]);
    expect(only(s).hunt).toBe("near"); // 6,000 u away against 10,000 — both far outside aggro
  });

  test("and holds that commitment when another player becomes the nearest", () => {
    const nest = { x: C.x + 10_000, y: C.y };
    const far = { id: "far", pos: { ...C } };
    const near = { id: "near", pos: { x: C.x + 4_000, y: C.y } };
    const s = oneNest(nest, "hunter");
    fire(s, [far, near]);
    const hunter = only(s);

    near.pos = { x: C.x - 14_000, y: C.y }; // the committed one runs clear across the arena
    const before = { ...hunter.pos };
    for (let i = 0; i < 200; i++) stepEnemies(s, [far, near], [], DT);
    expect(hunter.hunt).toBe("near");
    expect(distTo(hunter.pos, near.pos)).toBeLessThan(distTo(before, near.pos)); // still chasing it
    expect(distTo(hunter.pos, far.pos)).toBeLessThan(distTo(before, far.pos)); // (which leads past far)
    expect(hunter.pos.x).toBeLessThan(before.x);
  });

  test("but breaks off for anything that comes inside AGGRO_RADIUS on the way", () => {
    const nest = { x: C.x + 10_000, y: C.y };
    const hunted = { id: "hunted", pos: { ...C } };
    const s = oneNest(nest, "hunter");
    fire(s, [hunted]);
    const hunter = only(s);
    for (let i = 0; i < 200; i++) stepEnemies(s, [hunted], [], DT); // marching inward
    expect(hunter.pos.x).toBeLessThan(nest.x);

    // A squadmate steps out in front of it, off the line to the hunted player.
    const stray = { id: "stray", pos: { x: hunter.pos.x, y: hunter.pos.y + AGGRO_RADIUS - 100 } };
    const before = { ...hunter.pos };
    for (let i = 0; i < 40; i++) stepEnemies(s, [hunted, stray], [], DT);
    expect(hunter.target).toEqual({ kind: "player", id: "stray" });
    expect(hunter.pos.y).toBeGreaterThan(before.y); // it turned off its line
    expect(hunter.hunt).toBe("hunted"); // the commitment is not spent, only interrupted
  });

  test("a hunter whose player is gone wanders like anything else", () => {
    const s = oneNest(EDGE, "hunter");
    fire(s, player({ ...C }));
    const orphan = only(s);
    expect(orphan.hunt).toBe("p1");
    for (let i = 0; i < 40_000; i++) stepEnemies(s, [], [], DT); // the squad disconnected
    expect(orphan.pos.x).toBeCloseTo(GRUNT_RADIUS, 6); // walked its own heading to the far wall
  });

  test("a hunter nest with no squad to aim at commits to nobody", () => {
    const s = oneNest(EDGE, "hunter");
    expect(fire(s, [])).toHaveLength(1);
    expect(only(s).hunt).toBeUndefined();
  });
});

// Where the front line used to be, kept only so #125 can assert that nothing stops there any more.
const OLD_HOLD_EDGE = Math.min(ARENA.width, ARENA.height) * (0.5 - 0.08); // 13,104 u from center

describe("stepEnemies AI (ENGAGED / HUNTING / WANDER)", () => {
  // The other half of #93's independence check, which lives in `world.test.ts`. The two numbers
  // agree today, so only a retune can tell them apart — and a retune that moves this one has to
  // change this line and leave the other alone, which is the whole of what was asked.
  test("AGGRO_RADIUS is its own number, not the door's reveal distance", () => {
    expect(AGGRO_RADIUS).toBe(1_800);
  });

  test("ENGAGED: a player within AGGRO_RADIUS pulls the nearest enemy into a chase", () => {
    const near = { x: C.x + 1000, y: C.y };
    const s = stateWith([grunt("e1", { ...near })]);
    const prey = { x: near.x + 500, y: near.y }; // 500 < AGGRO_RADIUS
    stepEnemies(s, [{ id: "p1", pos: prey }], [], 100);
    expect(only(s).pos.x).toBeGreaterThan(near.x); // moved toward the player
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
    const d = only(s).pos.x - near.x;
    expect(d).toBeLessThanOrEqual((GRUNT_SPEED * 100) / 1000 + 1e-6); // capped by speed
  });

  // #125. There is no march and no hold edge left: an un-aggroed enemy walks a heading of its own,
  // re-rolled out of the sim's rng every WANDER_LEG_MS. A constant rng pins that heading exactly —
  // 0 is due east, 0.5 is due west — so a wander is asserted to the unit rather than to a tendency.
  const EAST = () => 0;
  const WEST = () => 0.5;
  const WALK = (seconds: number) => GRUNT_SPEED * seconds;

  test("WANDER: an un-aggroed enemy walks outward, so nothing marches it toward centre", () => {
    const start = { x: C.x + 3_000, y: C.y };
    const s = stateWith([grunt("e1", { ...start })], EAST);
    for (let i = 0; i < 40; i++) stepEnemies(s, [], [], 100); // 4 s, no players anywhere
    expect(only(s).pos.x - start.x).toBeCloseTo(WALK(4), 6);
    expect(only(s).pos.y).toBeCloseTo(start.y, 6);
  });

  test("WANDER: nothing stops an enemy at the radius the hold edge used to be", () => {
    const s = stateWith([grunt("e1", { x: C.x + OLD_HOLD_EDGE, y: C.y })], WEST);
    for (let i = 0; i < 40; i++) stepEnemies(s, [], [], 100);
    const dist = Math.hypot(only(s).pos.x - C.x, only(s).pos.y - C.y);
    expect(dist).toBeCloseTo(OLD_HOLD_EDGE - WALK(4), 6); // walked straight through it
  });

  test("WANDER: the heading is re-rolled every leg, so it turns instead of walking one line", () => {
    const s = stateWith([grunt("e1", { ...C })], mulberry32(5));
    const heading = () => {
      const from = { ...only(s).pos };
      stepEnemies(s, [], [], 50);
      return Math.atan2(only(s).pos.y - from.y, only(s).pos.x - from.x);
    };
    const first = heading();
    for (let i = 0; i < WANDER_LEG_MS / 50; i++) stepEnemies(s, [], [], 50); // the leg runs out
    expect(heading()).not.toBeCloseTo(first, 6);
  });

  test("WANDER: the walk is bounded by the arena walls, so nothing leaves for good", () => {
    const s = stateWith([grunt("e1", { x: ARENA.width - 1_000, y: C.y })], EAST);
    for (let i = 0; i < 400; i++) stepEnemies(s, [], [], 100); // 40 s of due-east walking
    expect(only(s).pos.x).toBeCloseTo(ARENA.width - GRUNT_RADIUS, 6);
  });

  test("a wandering enemy inside AGGRO_RADIUS stops wandering and chases", () => {
    const start = { x: C.x + 5_000, y: C.y };
    const s = stateWith([grunt("e1", { ...start })], WEST);
    for (let i = 0; i < 10; i++) stepEnemies(s, [], [], 100);
    const wandered = { ...only(s).pos };
    expect(wandered.x).toBeLessThan(start.x); // on a westward leg, and nobody in the world

    const prey = { x: wandered.x, y: wandered.y + AGGRO_RADIUS - 100 };
    stepEnemies(s, [{ id: "p1", pos: prey }], [], 100);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
    expect(only(s).pos.y).toBeGreaterThan(wandered.y); // turned off its heading, onto the player
  });

  test("peels to chase when a player enters aggro, and wanders again when they retreat", () => {
    const start = { x: C.x + 10_000, y: C.y };
    const s = stateWith([grunt("e1", { ...start })], WEST);
    stepEnemies(s, [{ id: "p1", pos: { x: start.x + 500, y: start.y } }], [], 100); // within aggro
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
    expect(only(s).pos.x).toBeGreaterThan(start.x); // peeled outward toward the player

    const peeled = { ...only(s).pos };
    stepEnemies(s, [{ id: "p1", pos: { ...C } }], [], 100); // player retreats far beyond aggro
    expect(only(s).target).toBeUndefined(); // un-aggroed again
    expect(only(s).pos.x).toBeCloseTo(peeled.x - WALK(0.1), 6); // and away on a heading of its own
  });

  test("motion is frame-rate independent while ENGAGED (2×dt ≈ 2× the distance)", () => {
    const start = { x: C.x + 1000, y: C.y };
    const prey = { x: start.x + 500, y: start.y };
    const a = stateWith([grunt("e1", { ...start })]);
    const b = stateWith([grunt("e1", { ...start })]);
    stepEnemies(a, [{ id: "p1", pos: prey }], [], 100);
    stepEnemies(b, [{ id: "p1", pos: prey }], [], 200);
    expect(only(b).pos.x - start.x).toBeCloseTo(2 * (only(a).pos.x - start.x), 3);
  });

  test("does not mutate the players input", () => {
    const s = stateWith([grunt("e1", { x: C.x + 1000, y: C.y })]);
    const players = player({ x: C.x + 1200, y: C.y });
    const snapshot = player({ x: C.x + 1200, y: C.y });
    stepEnemies(s, players, [], 100);
    expect(players).toEqual(snapshot);
  });
});

// #131. An enemy steers at the *lead point* — where the player ends up if they hold the heading
// their last two position samples describe, half the current gap ahead of them — rather than at the
// body itself. The lead is navigation only: aggro, the lock and contact all still read the body.
describe("#131: an enemy chases the lead point, not the player", () => {
  const DT = 100;
  const TRAVEL = (GRUNT_SPEED * DT) / 1000;
  // A lead is a place the player could be, so it is bounded exactly where `stepPos` bounds them.
  const WALL = ARENA.width - PLAYER_RADIUS;

  // Where an enemy at `from` lands after one step straight at `to`.
  const stepped = (from: Vec2, to: Vec2): Vec2 => {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    return {
      x: from.x + ((to.x - from.x) / len) * TRAVEL,
      y: from.y + ((to.y - from.y) / len) * TRAVEL,
    };
  };
  const landsOn = (at: Vec2, expected: Vec2) => {
    expect(at.x).toBeCloseTo(expected.x, 6);
    expect(at.y).toBeCloseTo(expected.y, 6);
  };

  test("the chase point is half the gap ahead of the player, along their heading", () => {
    const from = { ...C };
    const s = stateWith([grunt("e1", { ...from })]);
    const pos = { x: C.x + 1_000, y: C.y };
    const running = { id: "p1", pos, prev: { x: pos.x, y: pos.y - 10 } }; // due south
    stepEnemies(s, [running], [], DT);
    landsOn(only(s).pos, stepped(from, { x: pos.x, y: pos.y + 500 })); // gap 1,000 → led by 500
  });

  test("and it is half of *this* gap, so a nearer player is led less", () => {
    const from = { ...C };
    const s = stateWith([grunt("e1", { ...from })]);
    const pos = { x: C.x + 200, y: C.y };
    const running = { id: "p1", pos, prev: { x: pos.x, y: pos.y - 10 } };
    stepEnemies(s, [running], [], DT);
    landsOn(only(s).pos, stepped(from, { x: pos.x, y: pos.y + 100 })); // gap 200 → led by 100
  });

  test("a lead that would fall outside the arena is clamped to its bounds", () => {
    const from = { x: C.x, y: C.y - 3_000 }; // off his line, so the clamped heading is visible
    const hunter: Enemy = { ...grunt("e1", { ...from }), hunt: "p1" }; // no aggro radius at all
    const s = stateWith([hunter]);
    const pos = { x: WALL - 5, y: C.y }; // running south-east, a stride short of the east wall
    const running = { id: "p1", pos, prev: { x: pos.x - 10, y: pos.y - 10 } };
    stepEnemies(s, [running], [], DT); // chased from ~15,900 u back: the lead runs 5,600 u of wall
    const lead = (Math.hypot(pos.x - from.x, pos.y - from.y) / 2) * Math.SQRT1_2; // split evenly
    landsOn(only(s).pos, stepped(from, { x: WALL, y: pos.y + lead })); // x clamped, y untouched
  });

  test("a stationary player is chased at their raw position", () => {
    const from = { ...C };
    const s = stateWith([grunt("e1", { ...from })]);
    const standing = { x: C.x + 800, y: C.y + 600 };
    stepEnemies(s, [{ id: "p1", pos: standing, prev: { ...standing } }], [], DT);
    landsOn(only(s).pos, stepped(from, standing));
  });

  test("and so is one the sim has seen only once — there is no earlier sample to lead from", () => {
    const from = { ...C };
    const s = stateWith([grunt("e1", { ...from })]);
    const first = { x: C.x + 800, y: C.y + 600 };
    stepEnemies(s, [{ id: "p1", pos: first }], [], DT);
    landsOn(only(s).pos, stepped(from, first));
  });

  // The lead is a phantom, and a phantom cannot be noticed or lost: a fleeing player is led to a
  // point ~2,550 u out, well past AGGRO_RADIUS, while his body stands 1,700 u away.
  const fleeing = () => {
    const pos = { x: C.x + AGGRO_RADIUS - 100, y: C.y };
    return { id: "p1", pos, prev: { x: pos.x - 10, y: pos.y } };
  };

  test("aggro is acquired on the player: one inside AGGRO_RADIUS whose lead is outside it is seen", () => {
    const s = stateWith([grunt("e1", { ...C })]);
    stepEnemies(s, [fleeing()], [], DT);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
  });

  test("and the lock breaks on the player leaving AGGRO_RADIUS, never on the lead leaving it", () => {
    const locked: Enemy = { ...grunt("e1", { ...C }), target: { kind: "player", id: "p1" } };
    const s = stateWith([locked]);
    for (let i = 0; i < 10; i++) stepEnemies(s, [fleeing()], [], DT);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
  });

  // The mirror of `fleeing`, and the half the lock is actually decided on: a body 2,000 u out —
  // past AGGRO_RADIUS — charging straight in, so its lead sits 1,000 u out, well inside.
  const charging = () => {
    const pos = { x: C.x + AGGRO_RADIUS + 200, y: C.y };
    return { id: "p1", pos, prev: { x: pos.x + 10, y: pos.y } };
  };

  test("a lead back inside AGGRO_RADIUS does not hold a lock the player has run out of", () => {
    const locked: Enemy = { ...grunt("e1", { ...C }), target: { kind: "player", id: "p1" } };
    const s = stateWith([locked]);
    stepEnemies(s, [charging()], [], DT);
    expect(only(s).target).toBeUndefined();
  });
});

// #125. What removing the hold edge is for: the arena reads as a gradient — hunter waves early,
// ambient wanderers accumulating as the squad pushes outward — and there is no circle around spawn
// that nothing can enter.
//
// Every figure below is taken over a fixed seed set, #123's precedent: the sim's only entropy is an
// injected rng, so each count is a fixed number that passes always or fails always rather than a
// tendency that passes most of the time.
//
// They are counts of a shaped field, so they move when the shape does: the enemy cap and
// `WANDER_LEG_MS` are both provisional, and a retune of either will red some of these. That is the
// price of asserting a gradient rather than describing one, and re-reading the counts is the fix.
describe("#125: no safe centre, and the gradient it produces", () => {
  const DT = 50;
  const MINUTE = 60_000;

  // A real world of fifty nests driven for `minutes` of virtual time. Virtual only: no clock is read
  // anywhere in the sim, so this is arithmetic and not a wait.
  const runFor = (seed: number, minutes: number, squad: PlayerRef[] = []): EnemyState => {
    const s = spawnEnemyState(worldInit(seed), mulberry32(seed));
    for (let i = 0; i < (minutes * MINUTE) / DT; i++) stepEnemies(s, squad, [], DT);
    return s;
  };
  const advance = (s: EnemyState, minutes: number, squad: PlayerRef[] = []): EnemyState => {
    for (let i = 0; i < (minutes * MINUTE) / DT; i++) stepEnemies(s, squad, [], DT);
    return s;
  };
  // How many enemies are close enough to `at` to be an encounter. `wanderersOnly` drops everything a
  // hunter nest committed to a player, so what is left is the ambient walk rather than a wave aimed
  // at the squad — the only discriminator needed, since a hunter's commitment is set at spawn.
  const near = (s: EnemyState, at: Vec2, radius = AGGRO_RADIUS, wanderersOnly = false): number =>
    [...s.enemies.values()].filter(
      (e) =>
        Math.hypot(e.pos.x - at.x, e.pos.y - at.y) <= radius &&
        (!wanderersOnly || e.hunt === undefined),
    ).length;

  test("the cap is the density dial, and it is 500", () => {
    // Provisional (#111). A retune of this line moves `docs/frame-budget.md` and
    // `docs/map-delta-budget.md` with it, which is why it is pinned here rather than left implicit.
    expect(DEFAULTS.enemyCap).toBe(500);
  });

  // ADR 0004: a nest's kind must never become visible to the client, which is the whole reason the
  // layout derives from a seed instead of riding the wire. Two fields on `Enemy` would give it away —
  // the hunt a hunter nest's wave was committed to (#124) and the leg a wanderer walks (#125) — and
  // announcing either would put the kind one JSON field away from the renderer.
  test("a spawn announcement carries the wire fields and nothing server-only", () => {
    const s = armed(spawnEnemyState(worldInit(), () => 0.5));
    const spawns = stepEnemies(s, player({ ...C }), [], 50).events.spawns;
    for (const spawn of spawns) {
      expect(Object.keys(spawn).sort()).toEqual(["hp", "id", "kind", "pos"]);
    }
    // Not vacuous: this world holds nests of both kinds, so both server-only fields are in play.
    const live = [...s.enemies.values()];
    expect(live.some((e) => e.hunt !== undefined)).toBe(true);
    expect(live.some((e) => e.wander !== undefined)).toBe(true);
  });

  // A squad that never leaves spawn is fought there, and what fights it changes over the match:
  // hunter waves commit at any distance and arrive at once, while wanderers arrive by diffusion,
  // which takes minutes from 14,000 u out. Observed at 5:00 for seeds 1, 2, 3: 149/121/131 hunters
  // inside AGGRO_RADIUS of centre and not one wanderer.
  test("a player standing at spawn is fought at spawn from the first waves", () => {
    for (const seed of [1, 2, 3]) {
      const s = runFor(seed, 5, player({ ...C }));
      expect(near(s, C) - near(s, C, AGGRO_RADIUS, true)).toBeGreaterThan(0); // hunter waves
      expect(near(s, C, AGGRO_RADIUS, true)).toBe(0); // and the walk has not got there yet
    }
  });

  // The other half of it, and the slower half: an undirected walk does reach spawn, it just takes a
  // long match to. Observed inside AGGRO_RADIUS of centre at 12:00: 6 for seed 1, 11 for seed 2.
  // Two twelve-minute matches at 20 Hz is ~4.8 s of real work, against bun's 5 s default — a 3%
  // margin that CPU contention from a parallel suite eats, which is #126. The cost is the point
  // here (a shorter match cannot show a slow walk arriving), so the timeout moves, not the test.
  test("and wanderers reach spawn too, late, without anything aiming them there", () => {
    for (const seed of [1, 2]) {
      const s = runFor(seed, 12, player({ ...C }));
      expect(near(s, C, AGGRO_RADIUS, true)).toBeGreaterThan(0);
    }
  }, 30_000);

  test("and wanderers are denser further out, so a squad that pushes outward meets more", () => {
    // Nobody in the world, so nothing is aimed at anybody and the only thing shaping the field is
    // the walk itself against where the nests are.
    //
    // Observed at 8:00 within 4,000 u, centre against 12,000 u out: 8 against 42, and 5 against 53.
    for (const seed of [1, 2]) {
      const s = runFor(seed, 8);
      expect(near(s, { x: C.x + 12_000, y: C.y }, 4_000)).toBeGreaterThan(near(s, C, 4_000));
    }
  });

  // Measured at 4:00, before the cap binds. That is the honest window: the enemy cap is a population
  // governor, so once it is binding the other forty-nine nests refill whatever a silenced one stops
  // sending and the local reduction narrows to noise. Standing against silenced within 4,000 u of the
  // nest, seeds 1–4: 6/1, 18/11, 11/6, 40/31.
  test("killing a nest reduces the pressure in its area", () => {
    for (const seed of [1, 2, 3, 4]) {
      const standing = spawnEnemyState(worldInit(seed), mulberry32(seed));
      const silenced = spawnEnemyState(worldInit(seed), mulberry32(seed));
      const at = { ...standing.nests[0].pos };
      silenced.nests[0].alive = false;
      advance(standing, 4);
      advance(silenced, 4);
      expect(near(silenced, at, 4_000)).toBeLessThan(near(standing, at, 4_000));
    }
  });
});

describe("stepEnemies shot resolution (a travelling projectile)", () => {
  test("hits the nearest enemy along the line, not the ones behind it", () => {
    const s = stateWith([grunt("far", { x: 400, y: 100 }), grunt("near", { x: 200, y: 100 })]);
    const events = settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - RANGED_DAMAGE }]);
    expect(at(s, "far")?.hp).toBe(GRUNT_HP); // single-target, no cleave and no pass-through
  });

  // #103: auto-fire paced the weapon at `RANGED_CADENCE_MS`, and RANGED_DAMAGE went 1 → 3 to
  // hold sustained DPS roughly where clicking already had it. #119 doubled the rate of fire and
  // left the damage where it was. #80 leaves it where it is again — see the file's own record.
  test("a grunt takes ten connects to die at RANGED_DAMAGE 3", () => {
    expect(RANGED_DAMAGE).toBe(3);
    const s = stateWith([grunt("e1", { x: 200, y: 100 })]);
    const fire = () => settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    for (let i = 1; i < 10; i++) {
      expect(fire().hits).toEqual([{ id: "e1", hp: GRUNT_HP - i * RANGED_DAMAGE }]);
    }
    expect(fire().deaths).toEqual(["e1"]);
  });

  test("misses an enemy off the line (beyond the half-width)", () => {
    const offLine = { x: 300, y: 100 + RANGED_HALFWIDTH + GRUNT_RADIUS + 1 };
    const s = stateWith([grunt("e1", offLine)]);
    expect(settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("misses an enemy beyond the shot's range", () => {
    const s = stateWith([grunt("e1", { x: 100 + RANGED_RANGE + 50, y: 100 })]);
    expect(settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("does not hit an enemy behind the shooter", () => {
    const s = stateWith([grunt("e1", { x: 50, y: 100 })]);
    expect(settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("a lethal hit kills the enemy: reported in deaths, removed, absent from moves", () => {
    const s = stateWith([grunt("e1", { x: 200, y: 100 }, RANGED_DAMAGE)]);
    const events = settle(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
    expect(s.enemies.has("e1")).toBe(false);
    expect(events.moves).toEqual([]);
  });

  test("there is only one weapon — the melee cleave is gone, so no arc spares a target", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 90 }), grunt("e2", { x: 100, y: 110 })]);
    // Both sat inside the old 120° wedge and would both have been cleaved. A shot takes one.
    expect(settle(s, [shot({ x: 50, y: 100 }, { x: 1, y: 0 })]).hits).toHaveLength(1);
  });
});

// #80. The shot travels, and the whole of the flight is here: the client reports a heading and
// nothing else about it.
describe("a shot travels, and the damage lands where it arrives (#80)", () => {
  const oneGrunt = (distance: number, hp = 10_000) =>
    stateWith([grunt("e1", { x: 100 + distance, y: 100 }, hp)]);
  const fire = (s: EnemyState) =>
    stepEnemies(s, [], [shot({ x: 100, y: 100 }, { x: 1, y: 0 })], DT).events;

  test("the tick a shot is admitted applies no damage at all — it only puts one in the air", () => {
    const s = oneGrunt(200);
    const events = fire(s);
    expect(events.hits).toEqual([]);
    expect(at(s, "e1")?.hp).toBe(10_000);
    expect(events.projectiles).toHaveLength(1);
    expect(s.projectiles.size).toBe(1);
  });

  test("it advances PROJECTILE_SPEED × dt a tick, and the blow lands on the tick it arrives", () => {
    const perTick = (PROJECTILE_SPEED * DT) / 1000;
    // Three whole ticks of travel away, so the tick it lands on is arithmetic and not a guess.
    const s = oneGrunt(3 * perTick);
    expect(fire(s).hits).toEqual([]); // launched
    expect(stepEnemies(s, [], [], DT).events.hits).toEqual([]); // one tick of flight
    expect(stepEnemies(s, [], [], DT).events.hits).toEqual([]); // two
    expect(stepEnemies(s, [], [], DT).events.hits).toEqual([
      { id: "e1", hp: 10_000 - RANGED_DAMAGE },
    ]);
  });

  test("a shot that connects is spent on the tick it connects, and named on the wire", () => {
    const s = oneGrunt(100);
    const [[id]] = fire(s).projectiles;
    const events = stepEnemies(s, [], [], DT).events;
    expect(events.spent).toEqual([id]);
    expect(s.projectiles.size).toBe(0);
  });

  test("a shot that hits nothing is spent at the far end of its reach, not left in the air", () => {
    const s = stateWith([]);
    fire(s);
    let ticks = 0;
    const spent: string[] = [];
    while (s.projectiles.size > 0 && ticks < 40) {
      ticks++;
      spent.push(...stepEnemies(s, [], [], DT).events.spent);
    }
    expect(spent).toHaveLength(1);
    // Whole ticks to cover RANGED_RANGE at PROJECTILE_SPEED, rounded up: the last one is short.
    expect(ticks).toBe(Math.ceil(RANGED_RANGE / ((PROJECTILE_SPEED * DT) / 1000)));
  });

  test("it does not tunnel: a body inside one tick's travel is struck, not stepped over", () => {
    const perTick = (PROJECTILE_SPEED * DT) / 1000;
    expect(perTick).toBeGreaterThan(2 * GRUNT_RADIUS); // or there would be nothing to tunnel
    const s = oneGrunt(perTick / 2);
    fire(s);
    expect(stepEnemies(s, [], [], DT).events.hits).toHaveLength(1);
  });

  test("enemy HP is written on impact and by nothing else — a spent shot cannot hit twice", () => {
    const s = oneGrunt(100);
    fire(s);
    stepEnemies(s, [], [], DT);
    const struck = at(s, "e1")?.hp;
    for (let i = 0; i < 10; i++) stepEnemies(s, [], [], DT);
    expect(at(s, "e1")?.hp).toBe(struck);
  });

  // The ticket's own box, and the control that gives it its meaning. An elite is put at maximum
  // range and fired at straight — the shot hitscan would have landed outright — and then walked
  // along `drift` per tick for as long as the shot is in the air. What comes back is the damage it
  // took.
  //
  // Its position is set each tick rather than left to the sim: an enemy with nobody to chase
  // wanders, and this is a test about the shot's flight time and not about where a spider strolls.
  const flightAgainst = (drift: Vec2): number => {
    const from = { x: 100, y: 100 };
    const start = { x: from.x + RANGED_RANGE, y: from.y };
    const elite: Enemy = { id: "e1", kind: "elite", pos: { ...start }, hp: 10_000, biteMs: 0 };
    const s = stateWith([elite]);
    stepEnemies(s, [], [shot(from, { x: 1, y: 0 })], DT); // launched; nothing has flown yet
    for (let t = 1; s.projectiles.size > 0 && t <= 40; t++) {
      elite.pos = { x: start.x + drift.x * t, y: start.y + drift.y * t };
      stepEnemies(s, [], [], DT);
    }
    return 10_000 - elite.hp;
  };
  const ELITE_STEP = (ELITE_SPEED * DT) / 1000;

  test("a target crossing at elite speed at maximum range outruns the shot", () => {
    expect(flightAgainst({ x: 0, y: ELITE_STEP })).toBe(0);
  });

  test("standing at that same range it is hit — the crossing is the whole of what saved it", () => {
    expect(flightAgainst({ x: 0, y: 0 })).toBe(RANGED_DAMAGE);
  });
});

// #84: the wire carries far more coordinate precision than the fixed M4 zoom can show. Trimming
// it is a serialisation concern only — the sim keeps every bit it had.
describe("#84: the delta ships display precision, not float64", () => {
  test("move coordinates ride as whole world units", () => {
    const s = stateWith([grunt("e1", { x: C.x + 1_000.418_23, y: C.y + 12.900_1 })]);
    const [move] = stepEnemies(s, [], [], 100).events.moves;
    expect(move).toEqual(["e1", Math.round(only(s).pos.x), Math.round(only(s).pos.y)]);
    expect(Number.isInteger(move[1])).toBe(true);
    expect(Number.isInteger(move[2])).toBe(true);
  });

  test("but the sim keeps its own sub-unit position — rounding is the wire's, not the world's", () => {
    const start = { x: C.x + 1_000.418_23, y: C.y };
    const s = stateWith([grunt("e1", { ...start })]);
    // A chase step of 100 ms cannot land on a whole number from this start.
    stepEnemies(s, [{ id: "p1", pos: { x: start.x + 500, y: start.y } }], [], 100);
    expect(Number.isInteger(only(s).pos.x)).toBe(false);
  });

  test("a launched shot rides as whole units and a three-decimal heading", () => {
    const s = stateWith([grunt("e1", { x: 300, y: 100 })]);
    const dir = { x: 0.987_654_321, y: 0.156_789_012 };
    const [fired] = step(s, [shot({ x: 100.418_23, y: 100.9 }, dir)]).projectiles;
    expect(fired).toEqual(["s1", 100, 101, 0.988, 0.157]);
  });

  test("and the sim still flies the shot on the heading it was given, not the rounded one", () => {
    // A grunt placed just inside the half-width for the *exact* aim. Flown on the rounded heading
    // instead, this shot would drift past it.
    const dir = { x: 0.999_999, y: 0.001_414 };
    const s = stateWith([grunt("e1", { x: 100 + 600 * dir.x, y: 100 + 600 * dir.y })]);
    expect(settle(s, [shot({ x: 100, y: 100 }, dir)]).hits).toEqual([
      { id: "e1", hp: GRUNT_HP - RANGED_DAMAGE },
    ]);
    expect(s.projectiles.size).toBe(0);
  });
});

describe("nests are attackable, and silencing one quietens the ground around it", () => {
  test("a shot on a nest lowers its HP (still alive)", () => {
    const s = silence(spawnEnemyState(worldInit(), () => 0.5));
    const nest = s.nests[0];
    const origin = { x: nest.pos.x - 100, y: nest.pos.y };
    expect(settle(s, [shot(origin, { x: 1, y: 0 })]).nests).toEqual([
      { id: nest.id, hp: nest.maxHp - RANGED_DAMAGE, alive: true },
    ]);
  });

  test("fire to 0 HP silences the nest (alive:false, hp clamped to 0)", () => {
    const s = silence(spawnEnemyState(worldInit(), () => 0.5));
    const nest = s.nests[0];
    nest.hp = RANGED_DAMAGE; // one connect away from death
    const origin = { x: nest.pos.x - 100, y: nest.pos.y };
    expect(settle(s, [shot(origin, { x: 1, y: 0 })]).nests).toEqual([
      { id: nest.id, hp: 0, alive: false },
    ]);
    expect(s.nests[0].alive).toBe(false);
  });
});

describe("admitAttack (server-side attack admission)", () => {
  const report = (seq: number, pos: Vec2 = { x: 0, y: 0 }, dir: Vec2 = { x: 1, y: 0 }) => ({
    pos,
    dir,
    seq,
  });

  test("accepts a fresh in-cadence attack and records its seq + timestamp", () => {
    const g = freshGuard();
    expect(admitAttack(g, report(1), null, 1000)).toEqual({ x: 1, y: 0 });
    expect(g.seq).toBe(1);
    expect(g.lastAt).toBe(1000);
  });

  test("drops a stale or duplicate seq", () => {
    const g = freshGuard();
    admitAttack(g, report(5), null, 1000);
    expect(admitAttack(g, report(5), null, 5000)).toBeNull(); // equal seq
    expect(admitAttack(g, report(3), null, 9000)).toBeNull(); // older seq
  });

  test("rate-limits a too-soon second shot, then allows once the cadence elapses", () => {
    const g = freshGuard();
    admitAttack(g, report(1), null, 1000);
    expect(admitAttack(g, report(2), null, 1000 + RANGED_CADENCE_MS - 1)).toBeNull();
    expect(admitAttack(g, report(3), null, 1000 + RANGED_CADENCE_MS)).not.toBeNull();
  });

  test("rejects a teleport-far origin, accepts one within tolerance", () => {
    const last = { x: 0, y: 0 };
    const far = report(1, { x: ATTACK_POS_TOLERANCE + 1, y: 0 });
    const near = report(1, { x: ATTACK_POS_TOLERANCE - 1, y: 0 });
    expect(admitAttack(freshGuard(), far, last, 1000)).toBeNull();
    expect(admitAttack(freshGuard(), near, last, 1000)).not.toBeNull();
  });

  test("normalizes the reported aim rather than trusting its magnitude", () => {
    const aim = admitAttack(
      freshGuard(),
      report(1, { x: 0, y: 0 }, { x: 0, y: 9_000 }),
      null,
      1000,
    );
    expect(aim).toEqual({ x: 0, y: 1 });
  });

  test("an absurd magnitude normalizes rather than reaching the wire", () => {
    const huge = report(1, { x: 0, y: 0 }, { x: 1e300, y: 0 });
    expect(admitAttack(freshGuard(), huge, null, 1000)).toEqual({ x: 1, y: 0 });
  });

  test("a zero-length aim is refused — it points nowhere and would relay as NaN", () => {
    const none = report(1, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(admitAttack(freshGuard(), none, null, 1000)).toBeNull();
  });

  test("an aim that overflows to a non-finite length is refused", () => {
    const overflow = report(1, { x: 0, y: 0 }, { x: 1.5e308, y: 1.5e308 });
    expect(admitAttack(freshGuard(), overflow, null, 1000)).toBeNull();
  });

  test("a refused aim still costs its cadence, so it is not a free retry", () => {
    const g = freshGuard();
    admitAttack(g, report(1, { x: 0, y: 0 }, { x: 0, y: 0 }), null, 1000);
    expect(g.lastAt).toBe(1000);
    expect(admitAttack(g, report(2), null, 1000 + RANGED_CADENCE_MS - 1)).toBeNull();
  });
});

describe("M4-T3: enemies leave the front line to chew on your structures", () => {
  const MINER = BUILDABLES.miner as BuildableSpec;
  // A build state holding one miner whose footprint centre sits at `pos`.
  const withMiner = (pos: Vec2) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 10_000;
    const tile = tileOf({ x: pos.x - TILE, y: pos.y - TILE }); // centre the 2×2 on `pos`
    return { build, miner: placeStructure(build, "miner", tile, MINER) };
  };
  const stepWith = (s: EnemyState, players: Vec2[], build: BuildState, dtMs = 100) =>
    stepEnemies(
      s,
      players.map((pos, i) => ({ id: `p${i + 1}`, pos })),
      [],
      dtMs,
      build,
    ).events;

  test("with no player in range, an enemy locks the miner and closes on it", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 1_000, y: minerAt.y })]);

    stepWith(s, [], build);
    expect(only(s).target).toEqual({ kind: "structure", id: miner.id });
    expect(only(s).pos.x).toBeLessThan(minerAt.x + 1_000); // closing in
  });

  test("a player in range always outranks a structure", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 100, y: minerAt.y })]);

    stepWith(s, [], build); // locks the miner first…
    expect(only(s).target?.kind).toBe("structure");
    stepWith(s, [{ x: minerAt.x + 400, y: minerAt.y }], build); // …then a player walks in
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
  });

  // #75: a player who drops out of the squad list must break the lock the same tick. Without
  // this, lock-and-commit is what makes the bug bite — an enemy holds a target that neither
  // dies nor leaves range, so it stands on an empty patch of floor until grace expires.
  test("a player who leaves the squad list breaks the lock and the enemy re-targets", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 300, y: minerAt.y })]);
    const standing = { x: minerAt.x + 700, y: minerAt.y };

    stepWith(s, [standing], build);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });

    stepWith(s, [], build); // that player is gone from the list; the miner is still there
    expect(only(s).target).toEqual({ kind: "structure", id: miner.id });
  });

  test("an enemy locked on a player ignores a closer teammate and a closer miner", () => {
    const start = { x: C.x + 5_000, y: C.y };
    const { build } = withMiner({ x: start.x + 60, y: start.y }); // a miner right on top of it
    const s = stateWith([grunt("e1", { ...start })]);
    const chased = { x: start.x + 1_500, y: start.y };

    stepWith(s, [chased], build);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
    // p2 is far closer, and so is the miner — lock and commit means neither steals the chase.
    stepWith(s, [chased, { x: start.x + 100, y: start.y }], build);
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
  });

  test("a locked structure is dropped only when it dies or leaves range", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 500, y: minerAt.y })]);
    stepWith(s, [], build);
    expect(only(s).target).toEqual({ kind: "structure", id: miner.id });

    removeStructure(build, miner.id); // demolished out from under it
    stepWith(s, [], build);
    expect(only(s).target).toBeUndefined();
  });

  test("an undefended miner is chewed down and removed exactly once", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 200, y: minerAt.y })]);

    let hitTotal = 0;
    let removals: string[] = [];
    for (let i = 0; i < 600 && removals.length === 0; i++) {
      const events = stepWith(s, [], build);
      hitTotal += events.structHits.length;
      removals = events.removals;
    }
    expect(removals).toEqual([miner.id]);
    // Every bite but the lethal one reports as a hit; the last reports as a removal.
    expect(hitTotal).toBe(Math.ceil(MINER.hp / enemyContactDamage("grunt")) - 1);
    expect(build.structures.has(miner.id)).toBe(false);
    expect(build.occupancy.size).toBe(0); // its tiles freed
  });

  // #101: the turret price is read off the live structure map, so the sim removing a chewed-down
  // turret has to move it exactly as demolishing one does — no bookkeeping of its own.
  test("a turret chewed down by an enemy drops the next turret's price by one step", () => {
    const spec = BUILDABLES.turret as BuildableSpec;
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000_000;
    const spot = { x: C.x + 5_000, y: C.y };
    const tile = tileOf({ x: spot.x - TILE, y: spot.y - TILE });
    const turret = placeStructure(build, "turret", tile, spec);
    placeStructure(build, "turret", { tx: tile.tx + 40, ty: tile.ty }, spec); // well out of the way
    expect(buildCost("turret", build)).toBe(101); // two standing

    const s = stateWith([grunt("e1", { x: spot.x + 200, y: spot.y })]);
    let removals: string[] = [];
    for (let i = 0; i < 600 && removals.length === 0; i++) {
      removals = stepWith(s, [], build).removals; // no generation, so neither turret fires back
    }
    expect(removals).toEqual([turret.id]);
    expect(buildCost("turret", build)).toBe(78); // one standing
  });

  test("damage lands on the enemy's own contact cadence, not once per tick", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    // Stand the grunt just inside contact range of the miner's true (tile-snapped) centre.
    const centre = structureCenter(miner);
    const s = stateWith([grunt("e1", { x: centre.x + GRUNT_RADIUS + TILE - 1, y: centre.y })]);
    const cadence = enemyContactCadenceMs("grunt");

    stepWith(s, [], build, 0); // first bite: the cooldown starts at zero
    expect(build.structures.get(miner.id)?.hp).toBe(MINER.hp - enemyContactDamage("grunt"));
    stepWith(s, [], build, cadence - 1); // still cooling down
    expect(build.structures.get(miner.id)?.hp).toBe(MINER.hp - enemyContactDamage("grunt"));
    stepWith(s, [], build, 1); // cadence elapsed
    expect(build.structures.get(miner.id)?.hp).toBe(MINER.hp - 2 * enemyContactDamage("grunt"));
  });

  test("an enemy out of reach of its target does not damage it", () => {
    const minerAt = { x: C.x + 5_000, y: C.y };
    const { build, miner } = withMiner(minerAt);
    const s = stateWith([grunt("e1", { x: minerAt.x + 1_500, y: minerAt.y })]);
    expect(stepWith(s, [], build, 0).structHits).toEqual([]);
    expect(build.structures.get(miner.id)?.hp).toBe(MINER.hp);
  });

  test("with no build state at all the sim behaves exactly as it did in M3", () => {
    const s = stateWith([grunt("e1", { x: C.x + 10_000, y: C.y })]);
    const events = stepEnemies(s, [], [], 100).events;
    expect(events.structHits).toEqual([]);
    expect(events.removals).toEqual([]);
    expect(only(s).target).toBeUndefined();
  });
});

describe("M4-T4: structures are solid to the sim too", () => {
  const WALL = BUILDABLES.wall as BuildableSpec;
  const walls = (tiles: Tile[]) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 100_000;
    return { build, placed: tiles.map((t) => placeStructure(build, "wall", t, WALL)) };
  };

  test("a wall between an enemy and its prey stops it dead — and it bashes the wall", () => {
    const start = { x: C.x + 5_000, y: C.y };
    const wallTile = tileOf({ x: start.x + 60, y: start.y - TILE }); // squarely in the path east
    const { build, placed } = walls([wallTile]);
    const s = stateWith([grunt("e1", { ...start })]);
    const prey = [{ id: "p1", pos: { x: start.x + 800, y: start.y } }];

    let last = only(s).pos.x;
    for (let i = 0; i < 40; i++) {
      stepEnemies(s, prey, [], 100, build);
      last = only(s).pos.x;
    }
    expect(last).toBeLessThan(structureCenter(placed[0]).x); // never got through
    expect(build.structures.get(placed[0].id)?.hp).toBeLessThan(WALL.hp); // chewed on it instead
  });

  test("a wave spawning on top of a wall is pushed clear of it", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5); // rng 0.5 → zero jitter, so every grunt
    const nest = onlyNest(s); //                           spawns exactly on the nest
    armed(s, 4); // a full wave of five, so the push is asserted on more than one spawn
    const { build } = walls([tileOf({ x: nest.pos.x - TILE, y: nest.pos.y - TILE })]);

    const spawns = stepEnemies(s, [], [], 50, build).events.spawns;
    expect(spawns.length).toBe(DEFAULTS.waveSize.max);
    for (const sp of spawns) {
      expect(structureBlocking(build, sp.pos, enemyRadius(sp.kind))).toBeNull();
    }
  });

  test("a nest sealed on all sides still emits — the sim never fails a spawn", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = onlyNest(s);
    armed(s, 4);
    // Blanket the nest's whole spawn scatter, so every spawn point starts inside a footprint.
    const tiles: Tile[] = [];
    const origin = tileOf({ x: nest.pos.x - 360, y: nest.pos.y - 360 });
    for (let dy = 0; dy < 48; dy += 2) {
      for (let dx = 0; dx < 48; dx += 2) tiles.push({ tx: origin.tx + dx, ty: origin.ty + dy });
    }
    const { build } = walls(tiles);

    const spawns = stepEnemies(s, [], [], 50, build).events.spawns;
    // Deep inside a solid field one push lands in the neighbouring wall, and that is the
    // deliberate trade: the sim pushes once and never searches for a free tile. What it must
    // never do is drop the spawn — the enemies are there, and they will chew their way out.
    expect(spawns.length).toBe(DEFAULTS.waveSize.max);
  });

  test("with nothing built, enemy motion is byte-for-byte what M3 produced", () => {
    const start = { x: C.x + 5_000, y: C.y };
    const prey = [{ id: "p1", pos: { x: start.x + 800, y: start.y } }];
    const withEmptyBuild = stateWith([grunt("e1", { ...start })]);
    const withNoBuild = stateWith([grunt("e1", { ...start })]);
    for (let i = 0; i < 20; i++) {
      stepEnemies(withEmptyBuild, prey, [], 100, freshBuildState(ARENA));
      stepEnemies(withNoBuild, prey, [], 100);
    }
    expect(only(withEmptyBuild).pos).toEqual(only(withNoBuild).pos);
  });
});

describe("M4-T8: a turret shoots the nearest enemy, through walls, and sieges nests", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const WALL = BUILDABLES.wall as BuildableSpec;
  // A build state with one turret whose footprint sits at `tile`.
  const withTurret = (tile: Tile) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 100_000;
    build.power.generation = 10_000; // ample headroom; the budget itself is #65's subject
    build.ammo.bullets = 100_000; // likewise: the pool is #102's subject, not this block's
    return { build, turret: placeStructure(build, "turret", tile, TURRET) };
  };
  const fire = (s: EnemyState, build: BuildState, dtMs = TURRET_CADENCE_MS) =>
    stepEnemies(s, [], [], dtMs, build).events;

  test("the turret is a 2×2 placeable anywhere", () => {
    expect(TURRET).toEqual({ footprint: 2, cost: 60, hp: 250, requires: null });
  });

  test("it picks the nearest of several enemies", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    const s = stateWith([
      grunt("far", { x: from.x + 600, y: from.y }),
      grunt("near", { x: from.x + 200, y: from.y }),
    ]);

    const events = land(s, build);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - TURRET_DAMAGE }]);
    expect(at(s, "far") === undefined || at(s, "far")?.hp === GRUNT_HP).toBe(true);
  });

  test("a wall between turret and target changes nothing — no line of sight is needed", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    placeStructure(build, "wall", tileOf({ x: from.x + 100, y: from.y - TILE }), WALL);
    const s = stateWith([grunt("e1", { x: from.x + 300, y: from.y })]);

    expect(land(s, build).hits).toEqual([{ id: "e1", hp: GRUNT_HP - TURRET_DAMAGE }]);
  });

  test("nothing in range is left alone", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    const s = stateWith([grunt("e1", { x: from.x + TURRET_RANGE + 100, y: from.y })]);
    expect(fire(s, build, 0).hits).toEqual([]);
  });

  test("fire holds to its cadence rather than firing every tick", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    const s = stateWith([grunt("e1", { x: from.x + 200, y: from.y }, 10_000)]);

    // Counted in shots leaving rather than in damage arriving: a cadence paces the firing, and
    // since #80 the two are on different ticks (`land` is what runs a flight out).
    expect(fire(s, build, 0).projectiles).toHaveLength(1); // the cooldown starts at zero
    expect(fire(s, build, TURRET_CADENCE_MS - 1).projectiles).toEqual([]); // still cooling down
    expect(fire(s, build, 1).projectiles).toHaveLength(1); // cadence elapsed
  });

  test("a turret line left in front of a nest brings it down unattended", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = s.nests[0];
    silence(s); // no waves; the turret is alone with the nest
    const { build } = withTurret(tileOf({ x: nest.pos.x - 300, y: nest.pos.y }));

    let silenced = false;
    for (let i = 0; i < 5_000 && !silenced; i++) {
      const events = fire(s, build, TURRET_CADENCE_MS);
      silenced = events.nests.some((n) => n.id === nest.id && !n.alive);
    }
    expect(silenced).toBe(true);
    expect(s.nests[0].hp).toBe(0);
  });

  test("with no turret standing, nothing fires", () => {
    const build = freshBuildState(ARENA);
    const s = stateWith([grunt("e1", { x: C.x + 5_000, y: C.y })]);
    expect(fire(s, build, TURRET_CADENCE_MS).hits).toEqual([]);
    expect(at(s, "e1")?.hp).toBe(GRUNT_HP);
  });

  test("a turret kill reports as a death, not a hit", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    const s = stateWith([grunt("e1", { x: from.x + 200, y: from.y }, TURRET_DAMAGE)]);
    const events = land(s, build);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
  });
});

// #102 stage 4. A turret's shot is a bullet out of the squad's pool, not a free one — the same
// pool a player shoots from, taken by whichever shot is admitted first.
describe("#102: a turret spends the squad's bullets", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const ORIGIN = { x: C.x + 5_000, y: C.y };

  // `count` turrets in range of the same spot, on an ample grid, over a pool of `bullets`.
  const armed = (bullets: number, count = 1) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000_000;
    build.power.generation = 1_000_000;
    build.ammo.bullets = bullets;
    const turrets = Array.from({ length: count }, (_, i) =>
      placeStructure(build, "turret", tileOf({ x: ORIGIN.x + i * TILE * 3, y: ORIGIN.y }), TURRET),
    );
    return { build, turrets };
  };
  // A sponge in range of every turret, so nothing dies and the pool is the only variable.
  const sponge = () => stateWith([grunt("e1", { x: ORIGIN.x + 100, y: ORIGIN.y }, 1_000_000)]);
  const fire = (s: EnemyState, build: BuildState, dtMs = TURRET_CADENCE_MS) =>
    stepEnemies(s, [], [], dtMs, build).events;

  test("a shot takes one bullet out of the pool", () => {
    const { build } = armed(3);
    fire(sponge(), build, 0);
    expect(build.ammo.bullets).toBe(2);
  });

  test("an empty pool holds the turret's fire rather than letting it shoot free", () => {
    const { build } = armed(0);
    const s = sponge();
    expect(fire(s, build, 0).projectiles).toEqual([]);
    expect(only(s).hp).toBe(1_000_000);
    expect(build.ammo.bullets).toBe(0); // and the pool is not driven negative
  });

  test("the held fire is not a spent shot — a bullet arriving is fired at once", () => {
    const { build } = armed(0);
    const s = sponge();
    fire(s, build, 0);
    build.ammo.bullets = 1;
    expect(fire(s, build, 0).projectiles).toHaveLength(1);
  });

  test("one bullet between two ready turrets is fired by exactly one of them", () => {
    const { build } = armed(1, 2);
    expect(fire(sponge(), build, 0).projectiles).toHaveLength(1);
    expect(build.ammo.bullets).toBe(0);
  });

  test("a turret with nothing to shoot at spends nothing", () => {
    const { build } = armed(3);
    fire(stateWith([grunt("e1", { x: ORIGIN.x + TURRET_RANGE + 100, y: ORIGIN.y })]), build, 0);
    expect(build.ammo.bullets).toBe(3);
  });

  test("a turret cooling down spends nothing either", () => {
    const { build } = armed(3);
    const s = sponge();
    fire(s, build, 0);
    fire(s, build, TURRET_CADENCE_MS - 1);
    expect(build.ammo.bullets).toBe(2);
  });
});

describe("M4-T9: the power budget decides which turrets get to fire", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const ORIGIN = { x: C.x + 5_000, y: C.y };

  // `count` turrets in a row, all within range of the same spot, on a grid of `generation` energy.
  function grid(count: number, generation: number) {
    const build = freshBuildState(ARENA);
    build.bank.metal = 1_000_000;
    build.power.generation = generation;
    build.ammo.bullets = 1_000_000; // energy is this block's variable; the pool is #102's

    const turrets = Array.from({ length: count }, (_, i) =>
      placeStructure(build, "turret", tileOf({ x: ORIGIN.x + i * TILE * 3, y: ORIGIN.y }), TURRET),
    );
    return { build, turrets };
  }
  const firing = (turrets: Structure[]) => turrets.filter((t) => t.turret?.powered).length;
  // A sponge parked in range of every turret, so nothing dies and the budget is the only variable.
  const sponge = () => stateWith([grunt("e1", { x: ORIGIN.x + 100, y: ORIGIN.y }, 1_000_000)]);

  // Exactly two of three fit: 3 × idle 10 = 30, plus 2 × active 100 = 230; a third would need 330.
  const FITS_TWO = 3 * TURRET_IDLE_DRAW + 2 * TURRET_ACTIVE_DRAW;

  test("idle draw is charged for merely existing, before anything activates", () => {
    const { build } = grid(3, 0); // no generation at all, so nothing can activate
    stepEnemies(sponge(), [], [], 50, build);
    expect(build.power.consumption).toBe(0); // clamped at a zero ceiling
  });

  test("with a ceiling that fits N−1 of N turrets, exactly N−1 fire", () => {
    const { build, turrets } = grid(3, FITS_TWO);
    stepEnemies(sponge(), [], [], 50, build);
    expect(firing(turrets)).toBe(2);
    expect(build.power.consumption).toBe(FITS_TWO);
  });

  test("the odd turret out stays idle across many ticks without flickering", () => {
    const { build, turrets } = grid(3, FITS_TWO);
    const s = sponge();
    const powered: string[] = [];
    for (let i = 0; i < 200; i++) {
      stepEnemies(s, [], [], 50, build);
      powered.push(turrets.map((t) => (t.turret?.powered ? "1" : "0")).join(""));
    }
    // One stable pattern for the whole run: a flickering budget would show several.
    expect(new Set(powered).size).toBe(1);
    expect(firing(turrets)).toBe(2);
  });

  test("an already-firing turret keeps its power when a new turret asks for it", () => {
    const { build, turrets } = grid(2, 2 * TURRET_IDLE_DRAW + TURRET_ACTIVE_DRAW);
    const s = sponge();
    stepEnemies(s, [], [], 50, build);
    const first = turrets.findIndex((t) => t.turret?.powered);
    expect(first).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 50; i++) stepEnemies(s, [], [], 50, build);
    expect(turrets[first].turret?.powered).toBe(true); // never bumped
    expect(firing(turrets)).toBe(1);
  });

  test("power is released when the target dies", () => {
    const { build, turrets } = grid(1, 1_000);
    const s = stateWith([grunt("e1", { x: ORIGIN.x + 100, y: ORIGIN.y }, TURRET_DAMAGE)]);
    stepEnemies(s, [], [], 50, build);
    expect(turrets[0].turret?.powered).toBe(true);
    stepEnemies(s, [], [], 50, build); // the grunt died to that first shot
    expect(turrets[0].turret?.powered).toBe(false);
    expect(build.power.consumption).toBe(TURRET_IDLE_DRAW);
  });

  test("power is released when the target leaves range", () => {
    const { build, turrets } = grid(1, 1_000);
    const s = stateWith([grunt("e1", { x: ORIGIN.x + 100, y: ORIGIN.y }, 1_000_000)]);
    stepEnemies(s, [], [], 50, build);
    expect(turrets[0].turret?.powered).toBe(true);

    const runaway = only(s);
    runaway.pos = { x: ORIGIN.x + TURRET_RANGE + 5_000, y: ORIGIN.y };
    stepEnemies(s, [], [], 50, build);
    expect(turrets[0].turret?.powered).toBe(false);
  });

  test("over-building clamps the display and blocks every activation — then a demolish recovers it", () => {
    const generation = 4 * TURRET_IDLE_DRAW + TURRET_ACTIVE_DRAW; // one turret's worth of headroom
    const { build, turrets } = grid(20, generation); // idle alone (200) exceeds the ceiling
    const s = sponge();
    stepEnemies(s, [], [], 50, build);
    expect(firing(turrets)).toBe(0); // no headroom left for anything to activate
    expect(build.power.consumption).toBe(generation); // clamped, not a runaway number

    // Recoverable, and self-inflicted rather than a failure: tear turrets down and it comes back.
    for (const t of turrets.slice(0, 17)) demolishStructure(build, t);
    stepEnemies(s, [], [], 50, build);
    expect(firing(turrets.slice(17))).toBe(1);
  });

  test("the activation queue serves several simultaneous requests against one free slot", () => {
    // Five turrets, all unpowered, all with a target, and headroom for exactly one.
    const { build, turrets } = grid(5, 5 * TURRET_IDLE_DRAW + TURRET_ACTIVE_DRAW);
    stepEnemies(sponge(), [], [], 50, build);
    // Check-and-reserve is one indivisible step, so exactly one wins — never two seeing the
    // same free slot, never zero.
    expect(firing(turrets)).toBe(1);
    expect(turrets[0].turret?.powered).toBe(true); // whoever asked first
  });

  test("an unpowered turret does not fire, however long it stands there", () => {
    const { build } = grid(1, 0);
    const s = stateWith([grunt("e1", { x: ORIGIN.x + 100, y: ORIGIN.y })]);
    for (let i = 0; i < 100; i++) stepEnemies(s, [], [], 50, build);
    expect(at(s, "e1")?.hp).toBe(GRUNT_HP); // still untouched
  });

  test("with no turrets standing, consumption is zero", () => {
    const build = freshBuildState(ARENA);
    build.power.generation = 1_000;
    stepEnemies(sponge(), [], [], 50, build);
    expect(build.power.consumption).toBe(0);
  });
});

describe("M5-I5: a turret's aim streams as a transition, a player's shot as an event", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const SPOT = tileOf({ x: C.x + 5_000, y: C.y });
  // One turret on a grid of `generation` energy, so the powered flag can be starved on demand.
  const withTurret = (generation: number) => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 100_000;
    build.power.generation = generation;
    const turret = placeStructure(build, "turret", SPOT, TURRET);
    return { build, turret, from: structureCenter(turret) };
  };
  // A sponge parked in range, so the target is held rather than killed between ticks.
  const inRange = (from: Vec2) => stateWith([grunt("e1", { x: from.x + 200, y: from.y }, 10_000)]);

  test("acquiring a target emits one aim, and holding it emits none", () => {
    const { build, turret, from } = withTurret(10_000);
    const s = inRange(from);
    expect(stepEnemies(s, [], [], 0, build).events.aims).toEqual([[turret.id, "e1", 1]]);
    expect(stepEnemies(s, [], [], TURRET_CADENCE_MS, build).events.aims).toEqual([]);
  });

  test("losing the target emits the release that takes the line down", () => {
    const { build, turret, from } = withTurret(10_000);
    const s = inRange(from);
    stepEnemies(s, [], [], 0, build);
    s.enemies.delete("e1");
    expect(stepEnemies(s, [], [], 0, build).events.aims).toEqual([[turret.id, null, 0]]);
  });

  test("power is never held without a target, which is why an idle turret needs no aim", () => {
    const { build, turret, from } = withTurret(10_000);
    const s = inRange(from);
    stepEnemies(s, [], [], 0, build);
    expect(turret.turret).toMatchObject({ powered: true, targetId: "e1" });
    s.enemies.delete("e1");
    stepEnemies(s, [], [], 0, build);
    // The invariant `snapshotAims` leans on: losing the target is what releases the slot, so a
    // turret omitted from the keyframe is always an unpowered one.
    expect(turret.turret).toMatchObject({ powered: false, targetId: null });
  });

  test("a turret holding a target on a starved grid reports powered 0 — the lightning case", () => {
    const { build, turret, from } = withTurret(0);
    expect(stepEnemies(inRange(from), [], [], 0, build).events.aims).toEqual([
      [turret.id, "e1", 0],
    ]);
  });

  test("winning power later is its own transition, on the tick the grid can carry it", () => {
    const { build, turret, from } = withTurret(0);
    const s = inRange(from);
    stepEnemies(s, [], [], 0, build);
    build.power.generation = 10_000;
    expect(stepEnemies(s, [], [], 0, build).events.aims).toEqual([[turret.id, "e1", 1]]);
  });

  // #80 made a turret's fire per-shot state, which #74 had deliberately kept off the wire. The
  // transition survives it — the unpowered lightning still reads off `(target, powered)` — but it
  // is no longer what draws the fire.
  test("a turret's fire is now an event per shot, on the same shape a player's rides", () => {
    const { build, from } = withTurret(10_000);
    build.ammo.bullets = 1;
    const events = stepEnemies(inRange(from), [], [], TURRET_CADENCE_MS, build).events;
    expect(events.projectiles).toHaveLength(1);
    const [id, x, y] = events.projectiles[0];
    expect(id).toMatch(/^s\d+$/);
    expect({ x, y }).toEqual({ x: Math.round(from.x), y: Math.round(from.y) });
  });

  test("an admitted shot launches from the origin the hub handed the sim, on its aim", () => {
    const s = stateWith([grunt("e1", { x: C.x + 200, y: C.y }, 10_000)]);
    expect(step(s, [shot({ ...C }, { x: 1, y: 0 }, "ana")]).projectiles).toEqual([
      ["s1", C.x, C.y, 1, 0],
    ]);
  });

  test("a shot into empty air is launched exactly like one at a target", () => {
    expect(step(stateWith([]), [shot({ ...C }, { x: 1, y: 0 })]).projectiles).toEqual([
      ["s1", C.x, C.y, 1, 0],
    ]);
  });

  test("a shot at a nest damages it when it arrives, like anything else", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    silence(s); // no wave; the nest is the only thing on the line
    const nest = s.nests[0];
    const events = settle(s, [shot({ x: nest.pos.x - 300, y: nest.pos.y }, { x: 1, y: 0 })]);
    expect(events.nests).toEqual([{ id: nest.id, hp: nest.maxHp - RANGED_DAMAGE, alive: true }]);
  });

  test("a killing shot rides its `spent` on the same tick that reports the death", () => {
    const s = stateWith([grunt("e1", { x: C.x + 200, y: C.y }, RANGED_DAMAGE)]);
    const [[id]] = step(s, [shot({ ...C }, { x: 1, y: 0 })]).projectiles;
    let landed = { spent: [] as string[], deaths: [] as string[] };
    for (let i = 0; i < 10 && landed.spent.length === 0; i++) {
      const { events } = stepEnemies(s, [], [], DT);
      landed = { spent: events.spent, deaths: events.deaths };
    }
    expect(landed.spent).toEqual([id]);
    expect(landed.deaths).toEqual(["e1"]);
  });
});

// #80's other half: a turret's shot travels on exactly the terms a player's does, and misses on
// them too. A turret does not lead, so its miss is the plain geometric one.
describe("a turret's fire travels, and can miss (#80)", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const armed = () => {
    const build = freshBuildState(ARENA);
    build.bank.metal = 100_000;
    build.ammo.bullets = 10_000;
    build.power.generation = 10_000;
    const turret = placeStructure(build, "turret", tileOf({ x: C.x, y: C.y }), TURRET);
    return { build, from: structureCenter(turret) };
  };

  test("the tick a turret fires applies no damage — the shot has to get there first", () => {
    const { build, from } = armed();
    const s = stateWith([grunt("e1", { x: from.x + 400, y: from.y }, 10_000)]);
    expect(stepEnemies(s, [], [], DT, build).events.hits).toEqual([]);
    expect(at(s, "e1")?.hp).toBe(10_000);
    expect(s.projectiles.size).toBe(1);
  });

  test("and the damage lands on the tick the shot arrives", () => {
    const { build, from } = armed();
    const s = stateWith([grunt("e1", { x: from.x + 400, y: from.y }, 10_000)]);
    let hp = 10_000;
    for (let i = 0; i < 10 && hp === 10_000; i++) {
      stepEnemies(s, [], [], DT, build);
      hp = at(s, "e1")?.hp ?? 0;
    }
    expect(hp).toBe(10_000 - TURRET_DAMAGE);
  });

  // The mirror of the player-side box, and asserted the same way: an elite crossing at its own
  // speed at the far end of the turret's reach is not hit, and standing there it is.
  const turretAgainst = (drift: Vec2): number => {
    const { build, from } = armed();
    const start = { x: from.x + TURRET_RANGE, y: from.y };
    const elite: Enemy = { id: "e1", kind: "elite", pos: { ...start }, hp: 10_000, biteMs: 0 };
    const s = stateWith([elite]);
    stepEnemies(s, [], [], DT, build); // acquired, powered, and one shot already away
    // The pool is emptied so the turret cannot take a second shot while the first is still in the
    // air: this is a test about one flight, and `TURRET_CADENCE_MS` is shorter than a full-reach
    // one. Cutting the *grid* would not do it — power is sticky to the target, not to the ceiling.
    build.ammo.bullets = 0;
    for (let t = 1; s.projectiles.size > 0 && t <= 40; t++) {
      elite.pos = { x: start.x + drift.x * t, y: start.y + drift.y * t };
      stepEnemies(s, [], [], DT, build);
    }
    return 10_000 - elite.hp;
  };

  test("a target crossing at elite speed at maximum range outruns a turret's shot too", () => {
    expect(turretAgainst({ x: 0, y: (ELITE_SPEED * DT) / 1000 })).toBe(0);
  });

  test("standing at that same range it is hit — the crossing is what saved it", () => {
    expect(turretAgainst({ x: 0, y: 0 })).toBe(TURRET_DAMAGE);
  });
});

// #140. The Bloodling: it runs at you and goes off when it gets there. The blast itself is the
// client's to apply — it owns its health — so what the sim owes is the trigger and the death.
describe("the bloodling (#140)", () => {
  const DT = 50;
  const bloodling = (id: string, pos: Vec2, hp = BLOODLING_HP): Enemy => ({
    id,
    kind: "bloodling",
    pos,
    hp,
    biteMs: 0,
  });
  const stepWith = (s: EnemyState, players: PlayerRef[], build: BuildState | null = null) =>
    stepEnemies(s, players, [], DT, build).events;

  test("it is the one enemy a player cannot outrun", () => {
    expect(BLOODLING_SPEED).toBeGreaterThan(PLAYER_SPEED);
    expect(GRUNT_SPEED).toBeLessThan(PLAYER_SPEED); // and the other two still can be
  });

  test("the blast reaches wider than the fuse, so whoever set it off is inside it", () => {
    // The sim triggers on the position the hub relayed; the client judges the blast on its own
    // true one. The gap between them is a round trip — 52 u at 200 ms of sprinting — and the
    // blast has to cover it, or a player could set one off and stand outside it.
    expect(BLAST_RADIUS).toBeGreaterThan(BLAST_TRIGGER + PLAYER_SPEED * 0.2);
  });

  test("one within the fuse of a player goes off: it dies, and the death rides `deaths`", () => {
    const s = stateWith([bloodling("e1", { x: C.x + BLAST_TRIGGER - 1, y: C.y })]);
    const events = stepWith(s, player({ ...C }));
    expect(events.deaths).toEqual(["e1"]);
    expect(s.enemies.size).toBe(0);
    expect(events.moves).toEqual([]); // gone before the tick reports where anything is
  });

  test("it goes off on arrival, in the tick it closes the last of the gap", () => {
    const travel = (BLOODLING_SPEED * DT) / 1_000;
    const s = stateWith([bloodling("e1", { x: C.x + BLAST_TRIGGER + travel - 1, y: C.y })]);
    expect(stepWith(s, player({ ...C })).deaths).toEqual(["e1"]);
  });

  test("out of range it closes like anything else, and reports its move", () => {
    const from = { x: C.x + 400, y: C.y };
    const s = stateWith([bloodling("e1", { ...from })]);
    const events = stepWith(s, player({ ...C }));
    expect(events.deaths).toEqual([]);
    expect(only(s).pos.x).toBeLessThan(from.x);
    expect(events.moves).toHaveLength(1);
  });

  test("the fuse is the player's body, never the lead it is steered at (#131)", () => {
    // A player sprinting away: the lead sits half the gap ahead of them, well outside the fuse,
    // while the body is inside it. The blast is about the body.
    const s = stateWith([bloodling("e1", { x: C.x + BLAST_TRIGGER - 1, y: C.y })]);
    const running: PlayerRef[] = [{ id: "p1", pos: { ...C }, prev: { x: C.x + 500, y: C.y } }];
    expect(stepWith(s, running).deaths).toEqual(["e1"]);
  });

  test("a fuse is not a lock: any player near enough sets it off, chased or not", () => {
    const far = { x: C.x + 1_500, y: C.y };
    const s = stateWith([bloodling("e1", { x: C.x + 900, y: C.y })]);
    stepWith(s, [{ id: "chased", pos: far }]); // locks on the far one
    expect(only(s).target).toEqual({ kind: "player", id: "chased" });
    const events = stepWith(s, [
      { id: "chased", pos: far },
      { id: "bystander", pos: { x: only(s).pos.x + BLAST_TRIGGER - 1, y: C.y } },
    ]);
    expect(events.deaths).toEqual(["e1"]);
  });

  test("nothing but a player sets it off — it chews a structure like any other enemy", () => {
    const MINER = BUILDABLES.miner as BuildableSpec;
    const build = freshBuildState(ARENA);
    build.bank.metal = 10_000;
    const at = { x: C.x + 5_000, y: C.y };
    const miner = placeStructure(build, "miner", tileOf({ x: at.x - TILE, y: at.y - TILE }), MINER);
    const s = stateWith([bloodling("e1", { x: at.x + 30, y: at.y })]);
    for (let i = 0; i < 20; i++) stepWith(s, [], build);
    expect(s.enemies.size).toBe(1);
    expect(build.structures.get(miner.id)?.hp).toBeLessThan(MINER.hp);
  });

  test("a nest's wave carries them, drawn off the same roll the elite share is", () => {
    const mix = (roll: number) => {
      const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => roll)), 6);
      return stepEnemies(s, [], [], DT).events.spawns.map((sp) => sp.kind);
    };
    // The bloodling share sits at the top of the draw and the elite share at the bottom, so the
    // two are independent bands of one uniform and the grunt is what is left between them.
    expect(mix(0.99)).toEqual(Array(DEFAULTS.waveSize.max).fill("bloodling"));
    expect(mix(1 - BLOODLING_SHARE - 0.01)).toEqual(Array(DEFAULTS.waveSize.max).fill("grunt"));
    expect(mix(0.29)).toEqual(Array(DEFAULTS.waveSize.max).fill("elite"));
  });

  test("one spawns at BLOODLING_HP, and its radius rides the same record as the rest", () => {
    const s = armed(onlyNestState(spawnEnemyState(worldInit(), () => 0.99)), 6);
    const spawns = stepEnemies(s, [], [], DT).events.spawns;
    expect(spawns[0]).toMatchObject({ kind: "bloodling", hp: BLOODLING_HP });
    expect(enemyRadius("bloodling")).toBe(BLOODLING_RADIUS);
  });
});
