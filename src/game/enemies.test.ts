import { describe, expect, test } from "bun:test";
import type { Tile, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILDABLES,
  type BuildableSpec,
  type BuildState,
  freshBuildState,
  placeStructure,
  removeStructure,
  structureBlocking,
  structureCenter,
  TILE,
  TURRET_CADENCE_MS,
  TURRET_DAMAGE,
  TURRET_RANGE,
  tileOf,
} from "./build";
import {
  ATTACK_POS_TOLERANCE,
  type Attack,
  admitAttack,
  angleOf,
  ELITE_HP,
  ENEMY_CAP,
  type Enemy,
  type EnemyState,
  enemyContactCadenceMs,
  enemyContactDamage,
  enemyRadius,
  freshGuard,
  GRUNT_HP,
  GRUNT_RADIUS,
  GRUNT_SPEED,
  NEST_COUNT,
  NEST_HP,
  type Nest,
  nestLayout,
  RANGED_CADENCE_MS,
  RANGED_DAMAGE,
  RANGED_HALFWIDTH,
  RANGED_RANGE,
  SECTORS,
  sectorOf,
  spawnEnemyState,
  stepEnemies,
  WAVE_PERIOD_MS,
} from "./enemies";
import { ARENA } from "./world";

const C = { x: ARENA.width / 2, y: ARENA.height / 2 };
const HALF = (ARENA.width / 2) * (1 - 0.08); // mid-band inset used for the east cardinal nest

const worldInit = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [],
  oreSeed: 1,
});

const grunt = (id: string, pos: Vec2, hp = GRUNT_HP, sector = 0): Enemy => ({
  id,
  kind: "grunt",
  pos,
  hp,
  sector,
  biteMs: 0,
});
const stateWith = (enemies: Enemy[]): EnemyState => ({
  arena: ARENA,
  enemies: new Map(enemies.map((e) => [e.id, e])),
  nests: [],
  waveIndex: 0,
  msUntilWave: WAVE_PERIOD_MS, // no wave fires during these targeted tests
  rng: () => 0.5,
  nextId: enemies.length + 1,
});
const only = (state: EnemyState) => [...state.enemies.values()][0];
const at = (state: EnemyState, id: string) => state.enemies.get(id);
const player = (pos: Vec2) => [{ id: "p1", pos }];
const shot = (pos: Vec2, dir: Vec2): Attack => ({ pos, dir });
const step = (state: EnemyState, attacks: Attack[]) => stepEnemies(state, [], attacks, 0).events;

describe("spawnEnemyState", () => {
  test("places NEST_COUNT nests, no enemies, and arms the wave clock at 0:30", () => {
    const s = spawnEnemyState(worldInit(), () => 0);
    expect(s.nests).toHaveLength(NEST_COUNT);
    expect(s.enemies.size).toBe(0);
    expect(s.waveIndex).toBe(0);
    expect(s.msUntilWave).toBe(WAVE_PERIOD_MS);
  });

  test("every nest is alive at full HP, one per sector, seated in the danger band", () => {
    const s = spawnEnemyState(worldInit(), () => 0);
    expect(s.nests.every((n) => n.alive && n.hp === NEST_HP)).toBe(true);
    expect(s.nests.map((n) => n.sector).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const band = 0.08 * Math.min(ARENA.width, ARENA.height);
    for (const n of s.nests) {
      const nearestWall = Math.min(n.pos.x, ARENA.width - n.pos.x, n.pos.y, ARENA.height - n.pos.y);
      expect(nearestWall).toBeLessThanOrEqual(band + 1e-6); // inside the danger band
    }
  });
});

describe("sector math", () => {
  test("sectorOf(nest_k) === k for every nest (the placement invariant)", () => {
    for (const nest of nestLayout(ARENA)) {
      expect(sectorOf(nest.pos, ARENA)).toBe(nest.sector);
    }
  });

  test("the east cardinal nest sits on the +x axis at the mid-band inset", () => {
    const east = nestLayout(ARENA).find((n) => n.sector === 0);
    expect(east?.pos.x).toBeCloseTo(C.x + HALF, 6);
    expect(east?.pos.y).toBeCloseTo(C.y, 6);
  });

  test("tiles 360° into SECTORS wedges with no gap or overlap", () => {
    const seen = new Set<number>();
    for (let deg = 0; deg < 360; deg++) {
      const rad = (deg * Math.PI) / 180;
      const p = { x: C.x + Math.cos(rad) * 1000, y: C.y + Math.sin(rad) * 1000 };
      const sec = sectorOf(p, ARENA);
      expect(sec).toBeGreaterThanOrEqual(0);
      expect(sec).toBeLessThan(SECTORS);
      seen.add(sec);
    }
    expect(seen.size).toBe(SECTORS);
  });

  test("just past a boundary lands in the higher sector (half-open)", () => {
    const angle = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return { x: C.x + Math.cos(rad) * 1000, y: C.y + Math.sin(rad) * 1000 };
    };
    expect(sectorOf(angle(22), ARENA)).toBe(0); // just before the 22.5° boundary
    expect(sectorOf(angle(23), ARENA)).toBe(1); // just after → the higher sector
  });

  test("angleOf normalizes to [0, 360) (screen space: +y is 90°)", () => {
    expect(angleOf({ x: C.x + 100, y: C.y }, ARENA)).toBeCloseTo(0, 6);
    expect(angleOf({ x: C.x, y: C.y + 100 }, ARENA)).toBeCloseTo(90, 6);
    expect(angleOf({ x: C.x - 100, y: C.y }, ARENA)).toBeCloseTo(180, 6);
  });
});

describe("waves (the ~30 s escalating drumbeat)", () => {
  test("no wave before 0:30; the first wave spawns 2+1 grunts per nest", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const calm = stepEnemies(s, [], [], WAVE_PERIOD_MS - 1).events;
    expect(calm.spawns).toEqual([]);
    expect(calm.wave).toBeNull();

    const fire = stepEnemies(s, [], [], 1).events; // crosses 0:30
    expect(fire.wave?.index).toBe(1);
    expect(fire.spawns).toHaveLength(NEST_COUNT * (2 + 1)); // 8 × 3 = 24
    expect(fire.spawns.every((sp) => sp.kind === "grunt")).toBe(true);
  });

  test("each nest emits 2+w grunts into its own sector, evenly across all sectors", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const fire = stepEnemies(s, [], [], WAVE_PERIOD_MS).events;
    const perSector = new Map<number, number>();
    for (const sp of fire.spawns) perSector.set(sp.sector, (perSector.get(sp.sector) ?? 0) + 1);
    expect(perSector.size).toBe(NEST_COUNT);
    expect([...perSector.values()].every((c) => c === 2 + 1)).toBe(true);
  });

  test("wave 2 escalates to 2+2 per nest and advances the wave index", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    stepEnemies(s, [], [], WAVE_PERIOD_MS); // wave 1
    const w2 = stepEnemies(s, [], [], WAVE_PERIOD_MS).events; // wave 2
    expect(w2.wave?.index).toBe(2);
    expect(w2.spawns).toHaveLength(NEST_COUNT * (2 + 2)); // 32
  });

  test("ENEMY_CAP governs concurrency: waves hold their remainder at the cap", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    for (let i = 0; i < 12; i++) stepEnemies(s, [], [], WAVE_PERIOD_MS);
    expect(s.enemies.size).toBe(ENEMY_CAP); // reached and held, never breached
  });

  test("elites appear from wave 3: counts are 0/0/1/2/3 for waves 1–5", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const eliteCounts: number[] = [];
    for (let w = 1; w <= 5; w++) {
      const spawns = stepEnemies(s, [], [], WAVE_PERIOD_MS).events.spawns;
      eliteCounts.push(spawns.filter((sp) => sp.kind === "elite").length);
    }
    expect(eliteCounts).toEqual([0, 0, 1, 2, 3]);
  });

  test("an elite spawns at ELITE_HP", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    let wave3: ReturnType<typeof stepEnemies>["events"] | undefined;
    for (let w = 1; w <= 3; w++) wave3 = stepEnemies(s, [], [], WAVE_PERIOD_MS).events;
    expect(wave3?.spawns.find((sp) => sp.kind === "elite")?.hp).toBe(ELITE_HP);
  });
});

const HOLD_EDGE = Math.min(ARENA.width, ARENA.height) * (0.5 - 0.08); // 13,104 u from center

describe("stepEnemies AI (ENGAGED / MARCH / HOLD)", () => {
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

  test("MARCH: an un-aggroed enemy advances toward center and parks on the hold edge", () => {
    const s = stateWith([grunt("e1", { x: C.x + HALF, y: C.y })]); // in the band, past the edge
    for (let i = 0; i < 2000; i++) stepEnemies(s, [], [], 100); // no players anywhere
    const dist = Math.hypot(only(s).pos.x - C.x, only(s).pos.y - C.y);
    expect(dist).toBeCloseTo(HOLD_EDGE, 0); // parked on the front line…
    expect(dist).toBeGreaterThanOrEqual(HOLD_EDGE - 1e-6); // …never crossing into the safe center
  });

  test("HOLD: an un-aggroed enemy at the hold edge stays put", () => {
    const onEdge = { x: C.x + HOLD_EDGE, y: C.y };
    const s = stateWith([grunt("e1", { ...onEdge })]);
    stepEnemies(s, [], [], 100);
    expect(only(s).pos).toEqual(onEdge);
    expect(only(s).target).toBeUndefined();
  });

  test("peels to chase when a player enters aggro, reverts to holding when they retreat", () => {
    const onEdge = { x: C.x + HOLD_EDGE, y: C.y };
    const s = stateWith([grunt("e1", { ...onEdge })]);
    stepEnemies(s, [{ id: "p1", pos: { x: onEdge.x + 500, y: onEdge.y } }], [], 100); // within aggro
    expect(only(s).target).toEqual({ kind: "player", id: "p1" });
    expect(only(s).pos.x).toBeGreaterThan(onEdge.x); // peeled outward toward the player

    const peeledOut = Math.hypot(only(s).pos.x - C.x, only(s).pos.y - C.y);
    stepEnemies(s, [{ id: "p1", pos: { ...C } }], [], 100); // player retreats far beyond aggro
    expect(only(s).target).toBeUndefined(); // un-aggroed again
    expect(Math.hypot(only(s).pos.x - C.x, only(s).pos.y - C.y)).toBeLessThan(peeledOut); // marching back
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

describe("stepEnemies shot resolution (hitscan ray)", () => {
  test("hits the nearest enemy along the ray, not the ones behind it", () => {
    const s = stateWith([grunt("far", { x: 400, y: 100 }), grunt("near", { x: 200, y: 100 })]);
    const events = step(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - RANGED_DAMAGE }]);
    expect(at(s, "far")?.hp).toBe(GRUNT_HP); // single-target, no cleave
  });

  test("misses an enemy off the ray line (beyond the half-width)", () => {
    const offLine = { x: 300, y: 100 + RANGED_HALFWIDTH + GRUNT_RADIUS + 1 };
    const s = stateWith([grunt("e1", offLine)]);
    expect(step(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("misses an enemy beyond the ray's range", () => {
    const s = stateWith([grunt("e1", { x: 100 + RANGED_RANGE + 50, y: 100 })]);
    expect(step(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("does not hit an enemy behind the shooter", () => {
    const s = stateWith([grunt("e1", { x: 50, y: 100 })]);
    expect(step(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("a lethal hit kills the enemy: reported in deaths, removed, absent from moves", () => {
    const s = stateWith([grunt("e1", { x: 200, y: 100 }, RANGED_DAMAGE)]);
    const events = step(s, [shot({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
    expect(s.enemies.has("e1")).toBe(false);
    expect(events.moves).toEqual([]);
  });

  test("there is only one weapon — the melee cleave is gone, so no arc spares a target", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 90 }), grunt("e2", { x: 100, y: 110 })]);
    // Both sat inside the old 120° wedge and would both have been cleaved. A shot takes one.
    expect(step(s, [shot({ x: 50, y: 100 }, { x: 1, y: 0 })]).hits).toHaveLength(1);
  });
});

describe("nests are attackable, and silencing one carves a safe lane", () => {
  const nestAt = (s: EnemyState, sector: number): Nest => {
    const n = s.nests.find((x) => x.sector === sector);
    if (!n) throw new Error(`no nest in sector ${sector}`);
    return n;
  };

  test("a shot on a nest lowers its HP (still alive)", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = nestAt(s, 0);
    const origin = { x: nest.pos.x - 100, y: nest.pos.y };
    const events = stepEnemies(s, [], [shot(origin, { x: 1, y: 0 })], 0).events;
    expect(events.nests).toEqual([{ id: nest.id, hp: NEST_HP - RANGED_DAMAGE, alive: true }]);
  });

  test("fire to 0 HP silences the nest (alive:false, hp clamped to 0)", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = nestAt(s, 0);
    nest.hp = RANGED_DAMAGE; // one shot away from death
    const origin = { x: nest.pos.x - 100, y: nest.pos.y };
    const events = stepEnemies(s, [], [shot(origin, { x: 1, y: 0 })], 0).events;
    expect(events.nests).toEqual([{ id: nest.id, hp: 0, alive: false }]);
    expect(nestAt(s, 0).alive).toBe(false);
  });

  test("a silenced nest emits nothing into its sector next wave; the others still do", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    nestAt(s, 0).alive = false; // silence sector 0
    const spawns = stepEnemies(s, [], [], WAVE_PERIOD_MS).events.spawns; // fire wave 1
    expect(spawns.some((sp) => sp.sector === 0)).toBe(false); // the wedge is quiet
    expect(spawns.some((sp) => sp.sector === 1)).toBe(true); // neighbours still spawn
    expect(spawns).toHaveLength((NEST_COUNT - 1) * (2 + 1)); // exactly the 7 live nests
  });

  test("a partially-damaged nest still emits its full wave", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    nestAt(s, 0).hp = 1; // damaged but alive
    const spawns = stepEnemies(s, [], [], WAVE_PERIOD_MS).events.spawns;
    expect(spawns.filter((sp) => sp.sector === 0)).toHaveLength(2 + 1);
  });
});

describe("admitAttack (server-side attack admission)", () => {
  const report = (seq: number, pos: Vec2 = { x: 0, y: 0 }) => ({ pos, seq });

  test("accepts a fresh in-cadence attack and records its seq + timestamp", () => {
    const g = freshGuard();
    expect(admitAttack(g, report(1), null, 1000)).toBe(true);
    expect(g.seq).toBe(1);
    expect(g.lastAt).toBe(1000);
  });

  test("drops a stale or duplicate seq", () => {
    const g = freshGuard();
    admitAttack(g, report(5), null, 1000);
    expect(admitAttack(g, report(5), null, 5000)).toBe(false); // equal seq
    expect(admitAttack(g, report(3), null, 9000)).toBe(false); // older seq
  });

  test("rate-limits a too-soon second shot, then allows once the cadence elapses", () => {
    const g = freshGuard();
    admitAttack(g, report(1), null, 1000);
    expect(admitAttack(g, report(2), null, 1000 + RANGED_CADENCE_MS - 1)).toBe(false);
    expect(admitAttack(g, report(3), null, 1000 + RANGED_CADENCE_MS)).toBe(true);
  });

  test("rejects a teleport-far origin, accepts one within tolerance", () => {
    const last = { x: 0, y: 0 };
    const far = report(1, { x: ATTACK_POS_TOLERANCE + 1, y: 0 });
    const near = report(1, { x: ATTACK_POS_TOLERANCE - 1, y: 0 });
    expect(admitAttack(freshGuard(), far, last, 1000)).toBe(false);
    expect(admitAttack(freshGuard(), near, last, 1000)).toBe(true);
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
    const s = stateWith([grunt("e1", { x: C.x + HOLD_EDGE, y: C.y })]);
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
    const nest = s.nests[0]; //                            spawns exactly on the nest
    const { build } = walls([tileOf({ x: nest.pos.x - TILE, y: nest.pos.y - TILE })]);

    const spawns = stepEnemies(s, [], [], WAVE_PERIOD_MS, build).events.spawns;
    const onNest = spawns.filter((sp) => sp.sector === nest.sector);
    expect(onNest.length).toBeGreaterThan(0);
    for (const sp of onNest) {
      expect(structureBlocking(build, sp.pos, enemyRadius(sp.kind))).toBeNull();
    }
  });

  test("a nest sealed on all sides still emits — the sim never fails a spawn", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = s.nests[0];
    // Blanket the nest's whole spawn scatter, so every spawn point starts inside a footprint.
    const tiles: Tile[] = [];
    const origin = tileOf({ x: nest.pos.x - 360, y: nest.pos.y - 360 });
    for (let dy = 0; dy < 48; dy += 2) {
      for (let dx = 0; dx < 48; dx += 2) tiles.push({ tx: origin.tx + dx, ty: origin.ty + dy });
    }
    const { build } = walls(tiles);

    const spawns = stepEnemies(s, [], [], WAVE_PERIOD_MS, build).events.spawns;
    // Deep inside a solid field one push lands in the neighbouring wall, and that is the
    // deliberate trade: the sim pushes once and never searches for a free tile. What it must
    // never do is drop the spawn — the enemies are there, and they will chew their way out.
    expect(spawns.filter((sp) => sp.sector === nest.sector).length).toBe(2 + 1);
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
    return { build, turret: placeStructure(build, "turret", tile, TURRET) };
  };
  const fire = (s: EnemyState, build: BuildState, dtMs = TURRET_CADENCE_MS) =>
    stepEnemies(s, [], [], dtMs, build).events;

  test("the turret is a 2×2 placeable anywhere", () => {
    expect(TURRET).toEqual({ footprint: 2, cost: 120, hp: 250, requires: null });
  });

  test("it picks the nearest of several enemies", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    const s = stateWith([
      grunt("far", { x: from.x + 600, y: from.y }),
      grunt("near", { x: from.x + 200, y: from.y }),
    ]);

    const events = fire(s, build, 0);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - TURRET_DAMAGE }]);
    expect(at(s, "far") === undefined || at(s, "far")?.hp === GRUNT_HP).toBe(true);
  });

  test("a wall between turret and target changes nothing — no line of sight is needed", () => {
    const spot = tileOf({ x: C.x + 5_000, y: C.y });
    const { build, turret } = withTurret(spot);
    const from = structureCenter(turret);
    placeStructure(build, "wall", tileOf({ x: from.x + 100, y: from.y - TILE }), WALL);
    const s = stateWith([grunt("e1", { x: from.x + 300, y: from.y })]);

    expect(fire(s, build, 0).hits).toEqual([{ id: "e1", hp: GRUNT_HP - TURRET_DAMAGE }]);
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

    fire(s, build, 0); // the first shot: the cooldown starts at zero
    expect(at(s, "e1")?.hp).toBe(10_000 - TURRET_DAMAGE);
    fire(s, build, TURRET_CADENCE_MS - 1); // still cooling down
    expect(at(s, "e1")?.hp).toBe(10_000 - TURRET_DAMAGE);
    fire(s, build, 1); // cadence elapsed
    expect(at(s, "e1")?.hp).toBe(10_000 - 2 * TURRET_DAMAGE);
  });

  test("a turret line left in front of a nest brings it down unattended", () => {
    const s = spawnEnemyState(worldInit(), () => 0.5);
    const nest = s.nests[0];
    s.msUntilWave = Number.POSITIVE_INFINITY; // no waves; the turret is alone with the nest
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
    const events = fire(s, build, 0);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
  });
});
