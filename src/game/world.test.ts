import { describe, expect, test } from "bun:test";
import { ARENA, generateWorld, PLAYER_RADIUS, PLAYER_SPEED, stepPos } from "./world";

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, slot: i + 1, name: `P${i + 1}` }));

describe("generateWorld", () => {
  test("seeds one spawn per player near the arena center, slot-ordered", () => {
    const init = generateWorld(players(3));
    expect(init.spawns).toHaveLength(3);
    expect(init.spawns.map((s) => s.slot)).toEqual([1, 2, 3]);
    for (const s of init.spawns) {
      expect(Math.abs(s.pos.x - ARENA.width / 2)).toBeLessThan(120);
      expect(Math.abs(s.pos.y - ARENA.height / 2)).toBeLessThan(120);
      expect(s).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    }
  });

  test("places a wall-flush exit inside the arena", () => {
    const e = generateWorld(players(1)).exit;
    const onWall =
      e.x === 0 || e.y === 0 || e.x + e.width === ARENA.width || e.y + e.height === ARENA.height;
    expect(onWall).toBe(true);
  });

  test("exit placement is driven by an injectable rng", () => {
    const a = generateWorld(players(1), { rng: () => 0 }).exit;
    const b = generateWorld(players(1), { rng: () => 0.99 }).exit;
    expect(a).not.toEqual(b);
  });
});

describe("generateWorld at the ~2-minute scale", () => {
  test("the arena is the big square; speed reads as ~2 minutes edge-to-edge", () => {
    expect(ARENA.width).toBe(31_200);
    expect(ARENA.height).toBe(31_200);
    expect(ARENA.width / PLAYER_SPEED).toBeCloseTo(120, 0); // ~120 s to cross
    expect(ARENA.width / 2 / PLAYER_SPEED).toBeCloseTo(60, 0); // ~60 s center → perimeter
  });

  test("the exit is a wall-flush door ~936 u long and ~98 u deep, fully in bounds", () => {
    const { exit, arena } = generateWorld(players(1), { rng: () => 0.5 });
    expect(Math.max(exit.width, exit.height)).toBeCloseTo(0.03 * arena.width, 6); // 936 long
    expect(Math.min(exit.width, exit.height)).toBeCloseTo(98, 6); // 3.5× player diameter deep
    const onWall =
      exit.x === 0 ||
      exit.y === 0 ||
      exit.x + exit.width === arena.width ||
      exit.y + exit.height === arena.height;
    expect(onWall).toBe(true);
    expect(exit.x).toBeGreaterThanOrEqual(0);
    expect(exit.y).toBeGreaterThanOrEqual(0);
    expect(exit.x + exit.width).toBeLessThanOrEqual(arena.width);
    expect(exit.y + exit.height).toBeLessThanOrEqual(arena.height);
  });
});

const STILL = { up: false, down: false, left: false, right: false };
const held = (dir: keyof typeof STILL) => ({ ...STILL, [dir]: true });

describe("stepPos", () => {
  test("integrates held input in the right direction", () => {
    const start = { x: 100, y: 100 };
    const next = stepPos(start, held("right"), 100, ARENA);
    expect(next.x).toBeGreaterThan(start.x);
    expect(next.y).toBe(start.y);
  });

  test("no input means no movement", () => {
    const start = { x: 100, y: 100 };
    expect(stepPos(start, STILL, 100, ARENA)).toEqual(start);
  });

  test("speed is frame-rate independent (distance ≤ speed × dt)", () => {
    const start = { x: 100, y: 100 };
    const next = stepPos(start, held("right"), 1000, ARENA);
    const dx = next.x - start.x;
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBeLessThanOrEqual(PLAYER_SPEED + 1e-6);
  });

  test("diagonal movement is normalized (no speed boost)", () => {
    const start = { x: 100, y: 100 };
    const next = stepPos(start, { up: true, down: false, left: false, right: true }, 100, ARENA);
    expect(Math.hypot(next.x - start.x, next.y - start.y)).toBeCloseTo(
      (PLAYER_SPEED * 100) / 1000,
      3,
    );
  });

  test("clamps the avatar inside the arena walls", () => {
    let pos = { x: ARENA.width / 2, y: ARENA.height / 2 };
    for (let i = 0; i < 2000; i++) pos = stepPos(pos, held("right"), 100, ARENA);
    expect(pos.x).toBeCloseTo(ARENA.width - PLAYER_RADIUS, 3);
  });

  test("does not mutate the input position", () => {
    const start = { x: 100, y: 100 };
    stepPos(start, held("right"), 100, ARENA);
    expect(start).toEqual({ x: 100, y: 100 });
  });
});
