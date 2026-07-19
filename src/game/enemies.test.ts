import { describe, expect, test } from "bun:test";
import type { WorldInit } from "../lobby/protocol";
import { type EnemyState, GRUNT_HP, GRUNT_SPEED, spawnEnemyState, stepEnemies } from "./enemies";
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
