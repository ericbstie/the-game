import { describe, expect, test } from "bun:test";
import type { Vec2, Weapon, WorldInit } from "../lobby/protocol";
import {
  ATTACK_POS_TOLERANCE,
  type Attack,
  admitAttack,
  angleOf,
  ENEMY_CAP,
  type Enemy,
  type EnemyState,
  freshGuard,
  GRUNT_HP,
  GRUNT_RADIUS,
  GRUNT_SPEED,
  MELEE_CADENCE_MS,
  MELEE_DAMAGE,
  NEST_COUNT,
  NEST_HP,
  nestLayout,
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
});

const grunt = (id: string, pos: Vec2, hp = GRUNT_HP, sector = 0): Enemy => ({
  id,
  kind: "grunt",
  pos,
  hp,
  sector,
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
const melee = (pos: Vec2, dir: Vec2): Attack => ({ weapon: "melee", pos, dir });
const ranged = (pos: Vec2, dir: Vec2): Attack => ({ weapon: "ranged", pos, dir });
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
});

describe("stepEnemies chase (ENGAGED: toward the nearest player)", () => {
  const east = { x: C.x + HALF, y: C.y };

  test("a grunt advances toward the nearest player, capped by GRUNT_SPEED×dt", () => {
    const s = stateWith([grunt("e1", { ...east })]);
    const before = { ...only(s).pos };
    stepEnemies(s, player({ ...C }), [], 100);
    const after = only(s).pos;
    expect(Math.hypot(after.x - C.x, after.y - C.y)).toBeLessThan(
      Math.hypot(before.x - C.x, before.y - C.y),
    );
    const d = Math.hypot(after.x - before.x, after.y - before.y);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual((GRUNT_SPEED * 100) / 1000 + 1e-6);
  });

  test("emits every enemy in `moves` each tick", () => {
    const s = stateWith([grunt("e1", { ...east })]);
    const { events } = stepEnemies(s, player({ ...C }), [], 100);
    expect(events.moves).toEqual([["e1", only(s).pos.x, only(s).pos.y]]);
  });

  test("with no players the grunt holds position", () => {
    const s = stateWith([grunt("e1", { ...east })]);
    const before = { ...only(s).pos };
    stepEnemies(s, [], [], 100);
    expect(only(s).pos).toEqual(before);
  });

  test("motion is frame-rate independent (2×dt ≈ 2× the distance)", () => {
    const a = stateWith([grunt("e1", { ...east })]);
    const b = stateWith([grunt("e1", { ...east })]);
    stepEnemies(a, player({ ...C }), [], 100);
    stepEnemies(b, player({ ...C }), [], 200);
    const da = east.x - only(a).pos.x;
    const db = east.x - only(b).pos.x;
    expect(db).toBeCloseTo(2 * da, 3);
  });

  test("does not mutate the players input", () => {
    const s = stateWith([grunt("e1", { ...east })]);
    const players = player({ ...C });
    stepEnemies(s, players, [], 100);
    expect(players).toEqual(player({ ...C }));
  });
});

describe("stepEnemies melee resolution (cleave wedge)", () => {
  test("a swing damages an enemy within reach and inside the arc", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 100 })]);
    const events = step(s, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "e1", hp: GRUNT_HP - MELEE_DAMAGE }]);
    expect(at(s, "e1")?.hp).toBe(GRUNT_HP - MELEE_DAMAGE);
  });

  test("an enemy beyond reach is not hit", () => {
    const s = stateWith([grunt("e1", { x: 300, y: 100 })]);
    expect(step(s, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
    expect(at(s, "e1")?.hp).toBe(GRUNT_HP);
  });

  test("an enemy behind the swing (outside the arc) is not hit", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 100 })]);
    expect(step(s, [melee({ x: 50, y: 100 }, { x: -1, y: 0 })]).hits).toEqual([]);
    expect(at(s, "e1")?.hp).toBe(GRUNT_HP);
  });

  test("cleaves every enemy in the wedge", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 90 }), grunt("e2", { x: 100, y: 110 })]);
    const events = step(s, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits.map((h) => h.id).sort()).toEqual(["e1", "e2"]);
  });

  test("a lethal hit kills the enemy: reported in deaths, removed, absent from moves", () => {
    const s = stateWith([grunt("e1", { x: 100, y: 100 }, MELEE_DAMAGE)]);
    const events = step(s, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
    expect(s.enemies.has("e1")).toBe(false);
    expect(events.moves).toEqual([]);
  });
});

describe("stepEnemies ranged resolution (hitscan ray)", () => {
  test("hits the nearest enemy along the ray, not the ones behind it", () => {
    const s = stateWith([grunt("far", { x: 400, y: 100 }), grunt("near", { x: 200, y: 100 })]);
    const events = step(s, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - RANGED_DAMAGE }]);
    expect(at(s, "far")?.hp).toBe(GRUNT_HP); // single-target, no cleave
  });

  test("misses an enemy off the ray line (beyond the half-width)", () => {
    const offLine = { x: 300, y: 100 + RANGED_HALFWIDTH + GRUNT_RADIUS + 1 };
    const s = stateWith([grunt("e1", offLine)]);
    expect(step(s, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("misses an enemy beyond the ray's range", () => {
    const s = stateWith([grunt("e1", { x: 100 + RANGED_RANGE + 50, y: 100 })]);
    expect(step(s, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });

  test("does not hit an enemy behind the shooter", () => {
    const s = stateWith([grunt("e1", { x: 50, y: 100 })]);
    expect(step(s, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]).hits).toEqual([]);
  });
});

describe("admitAttack (server-side attack admission)", () => {
  const report = (seq: number, weapon: Weapon = "melee", pos: Vec2 = { x: 0, y: 0 }) => ({
    weapon,
    pos,
    seq,
  });

  test("accepts a fresh in-cadence attack and records its seq + timestamp", () => {
    const g = freshGuard();
    expect(admitAttack(g, report(1), null, 1000)).toBe(true);
    expect(g.seq).toBe(1);
    expect(g.meleeAt).toBe(1000);
  });

  test("drops a stale or duplicate seq", () => {
    const g = freshGuard();
    admitAttack(g, report(5), null, 1000);
    expect(admitAttack(g, report(5), null, 5000)).toBe(false); // equal seq
    expect(admitAttack(g, report(3), null, 9000)).toBe(false); // older seq
  });

  test("rate-limits a too-soon second swing, then allows once the cadence elapses", () => {
    const g = freshGuard();
    admitAttack(g, report(1), null, 1000);
    expect(admitAttack(g, report(2), null, 1000 + MELEE_CADENCE_MS - 1)).toBe(false);
    expect(admitAttack(g, report(3), null, 1000 + MELEE_CADENCE_MS)).toBe(true);
  });

  test("rejects a teleport-far origin, accepts one within tolerance", () => {
    const last = { x: 0, y: 0 };
    expect(
      admitAttack(
        freshGuard(),
        report(1, "melee", { x: ATTACK_POS_TOLERANCE + 1, y: 0 }),
        last,
        1000,
      ),
    ).toBe(false);
    expect(
      admitAttack(
        freshGuard(),
        report(1, "melee", { x: ATTACK_POS_TOLERANCE - 1, y: 0 }),
        last,
        1000,
      ),
    ).toBe(true);
  });

  test("melee and ranged cadences are tracked independently", () => {
    const g = freshGuard();
    expect(admitAttack(g, report(1, "melee"), null, 1000)).toBe(true);
    expect(admitAttack(g, report(2, "ranged"), null, 1000)).toBe(true); // not blocked by the melee gap
  });
});
