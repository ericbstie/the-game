import { describe, expect, test } from "bun:test";
import type { Vec2, Weapon, WorldInit } from "../lobby/protocol";
import {
  ATTACK_POS_TOLERANCE,
  type Attack,
  admitAttack,
  type Enemy,
  type EnemyState,
  freshGuard,
  GRUNT_HP,
  GRUNT_RADIUS,
  GRUNT_SPEED,
  MELEE_CADENCE_MS,
  MELEE_DAMAGE,
  RANGED_DAMAGE,
  RANGED_HALFWIDTH,
  RANGED_RANGE,
  spawnEnemyState,
  stepEnemies,
} from "./enemies";
import { ARENA } from "./world";

const C = { x: ARENA.width / 2, y: ARENA.height / 2 };
const BAND_INNER = 13_104; // distance from C to the inner edge of the danger band

const worldInit = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  monsters: [],
  spawns: [],
});

const center = () => [{ id: "p1", pos: { ...C } }];
const only = (state: EnemyState) => [...state.enemies.values()][0];

describe("spawnEnemyState (tracer)", () => {
  test("seeds exactly one grunt out in the danger band, not the safe center", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    expect(state.enemies.size).toBe(1);
    const g = only(state);
    expect(g.kind).toBe("grunt");
    expect(g.hp).toBe(GRUNT_HP);
    expect(Math.hypot(g.pos.x - C.x, g.pos.y - C.y)).toBeGreaterThan(BAND_INNER);
  });
});

describe("stepEnemies (tracer: ENGAGED chase-nearest-player)", () => {
  test("the grunt advances toward the nearest player, capped by GRUNT_SPEED×dt", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    const before = { ...only(state).pos };
    stepEnemies(state, center(), [], 100);
    const after = only(state).pos;
    const closer = Math.hypot(after.x - C.x, after.y - C.y);
    const wasFrom = Math.hypot(before.x - C.x, before.y - C.y);
    expect(closer).toBeLessThan(wasFrom); // moved toward the center player
    const stepDist = Math.hypot(after.x - before.x, after.y - before.y);
    expect(stepDist).toBeGreaterThan(0);
    expect(stepDist).toBeLessThanOrEqual((GRUNT_SPEED * 100) / 1000 + 1e-6);
  });

  test("emits every enemy in `moves` each tick", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    const { events } = stepEnemies(state, center(), [], 100);
    const g = only(state);
    expect(events.moves).toEqual([[g.id, g.pos.x, g.pos.y]]);
  });

  test("emits a new enemy in `spawns` once, then never again", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    const first = stepEnemies(state, center(), [], 100).events;
    expect(first.spawns.map((s) => s.id)).toEqual([only(state).id]);
    expect(first.spawns[0]).toMatchObject({ kind: "grunt", hp: GRUNT_HP });
    const second = stepEnemies(state, center(), [], 100).events;
    expect(second.spawns).toEqual([]);
  });

  test("with no players the grunt holds position (nothing to chase yet)", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    const before = { ...only(state).pos };
    stepEnemies(state, [], [], 100);
    expect(only(state).pos).toEqual(before);
  });

  test("motion is frame-rate independent (2×dt ≈ 2× the distance)", () => {
    const a = spawnEnemyState(worldInit(), () => 0);
    const b = spawnEnemyState(worldInit(), () => 0);
    const a0 = { ...only(a).pos };
    const b0 = { ...only(b).pos };
    stepEnemies(a, center(), [], 100);
    stepEnemies(b, center(), [], 200);
    const da = Math.hypot(only(a).pos.x - a0.x, only(a).pos.y - a0.y);
    const db = Math.hypot(only(b).pos.x - b0.x, only(b).pos.y - b0.y);
    expect(db).toBeCloseTo(2 * da, 3);
  });

  test("does not mutate the players input", () => {
    const state = spawnEnemyState(worldInit(), () => 0);
    const players = center();
    stepEnemies(state, players, [], 100);
    expect(players).toEqual(center());
  });
});

const grunt = (id: string, pos: Vec2, hp = GRUNT_HP): Enemy => ({ id, kind: "grunt", pos, hp });
const stateWith = (enemies: Enemy[]): EnemyState => ({
  arena: ARENA,
  enemies: new Map(enemies.map((e) => [e.id, e])),
  pending: [],
  rng: () => 0,
  nextId: enemies.length + 1,
});
const melee = (pos: Vec2, dir: Vec2): Attack => ({ weapon: "melee", pos, dir });
const step = (state: EnemyState, attacks: Attack[]) => stepEnemies(state, [], attacks, 0).events;

describe("stepEnemies melee resolution (cleave wedge)", () => {
  test("a swing damages an enemy within reach and inside the arc", () => {
    const state = stateWith([grunt("e1", { x: 100, y: 100 })]);
    const events = step(state, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "e1", hp: GRUNT_HP - MELEE_DAMAGE }]);
    expect(state.enemies.get("e1")?.hp).toBe(GRUNT_HP - MELEE_DAMAGE);
  });

  test("an enemy beyond reach is not hit", () => {
    const state = stateWith([grunt("e1", { x: 300, y: 100 })]);
    const events = step(state, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([]);
    expect(state.enemies.get("e1")?.hp).toBe(GRUNT_HP);
  });

  test("an enemy behind the swing (outside the arc) is not hit", () => {
    const state = stateWith([grunt("e1", { x: 100, y: 100 })]);
    const events = step(state, [melee({ x: 50, y: 100 }, { x: -1, y: 0 })]); // aiming away
    expect(events.hits).toEqual([]);
    expect(state.enemies.get("e1")?.hp).toBe(GRUNT_HP);
  });

  test("cleaves every enemy in the wedge", () => {
    const state = stateWith([grunt("e1", { x: 100, y: 90 }), grunt("e2", { x: 100, y: 110 })]);
    const events = step(state, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits.map((h) => h.id).sort()).toEqual(["e1", "e2"]);
  });

  test("a lethal hit kills the enemy: reported in deaths, removed, absent from moves", () => {
    const state = stateWith([grunt("e1", { x: 100, y: 100 }, MELEE_DAMAGE)]);
    const events = step(state, [melee({ x: 50, y: 100 }, { x: 1, y: 0 })]);
    expect(events.deaths).toEqual(["e1"]);
    expect(events.hits).toEqual([]);
    expect(state.enemies.has("e1")).toBe(false);
    expect(events.moves).toEqual([]);
  });
});

const ranged = (pos: Vec2, dir: Vec2): Attack => ({ weapon: "ranged", pos, dir });

describe("stepEnemies ranged resolution (hitscan ray)", () => {
  test("hits the nearest enemy along the ray, not the ones behind it", () => {
    const state = stateWith([grunt("far", { x: 400, y: 100 }), grunt("near", { x: 200, y: 100 })]);
    const events = step(state, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([{ id: "near", hp: GRUNT_HP - RANGED_DAMAGE }]);
    expect(state.enemies.get("far")?.hp).toBe(GRUNT_HP); // only one target, no cleave
  });

  test("misses an enemy off the ray line (beyond the half-width)", () => {
    const offLine = { x: 300, y: 100 + RANGED_HALFWIDTH + GRUNT_RADIUS + 1 };
    const state = stateWith([grunt("e1", offLine)]);
    const events = step(state, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([]);
  });

  test("misses an enemy beyond the ray's range", () => {
    const state = stateWith([grunt("e1", { x: 100 + RANGED_RANGE + 50, y: 100 })]);
    const events = step(state, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]);
    expect(events.hits).toEqual([]);
  });

  test("does not hit an enemy behind the shooter", () => {
    const state = stateWith([grunt("e1", { x: 50, y: 100 })]);
    const events = step(state, [ranged({ x: 100, y: 100 }, { x: 1, y: 0 })]); // aiming +x, enemy at −x
    expect(events.hits).toEqual([]);
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
