import { describe, expect, test } from "bun:test";
import {
  ARENA,
  EXIT_REVEAL_RADIUS,
  generateWorld,
  insideExit,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  pushOutOfBodies,
  revealsExit,
  stepPos,
} from "./world";

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

describe("pushOutOfBodies (M4-T6: player↔enemy soft-push)", () => {
  const body = (x: number, y: number, radius = 16) => ({ pos: { x, y }, radius });
  const R = PLAYER_RADIUS;

  test("a player pressed into an enemy ends outside it", () => {
    const enemy = body(1_000, 1_000);
    const inside = { x: 1_005, y: 1_000 }; // well inside the combined radii
    const out = pushOutOfBodies(inside, R, [enemy], ARENA);
    expect(Math.hypot(out.x - enemy.pos.x, out.y - enemy.pos.y)).toBeCloseTo(R + enemy.radius, 6);
  });

  test("a player clear of every body is left exactly where it was", () => {
    const pos = { x: 1_000, y: 1_000 };
    expect(pushOutOfBodies(pos, R, [body(2_000, 2_000)], ARENA)).toEqual(pos);
  });

  test("exactly co-located resolves deterministically instead of dividing by zero", () => {
    const at = { x: 1_000, y: 1_000 };
    const out = pushOutOfBodies(at, R, [body(at.x, at.y)], ARENA);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true);
    expect(out).not.toEqual(at);
  });

  test("surrounded on three sides, the pushes sum to an escape along the fourth", () => {
    const at = { x: 1_000, y: 1_000 };
    const near = R + 16 - 5; // just inside contact on each side
    const out = pushOutOfBodies(
      at,
      R,
      [body(at.x - near, at.y), body(at.x, at.y - near), body(at.x, at.y + near)],
      ARENA,
    );
    expect(out.x).toBeGreaterThan(at.x); // shoved out the open east side

    // Pushes accumulate one body at a time, so a single frame need not clear all three at once.
    // What matters is that repeated frames converge out of the pocket rather than trapping you.
    let p = at;
    const bodies = [body(at.x - near, at.y), body(at.x, at.y - near), body(at.x, at.y + near)];
    for (let i = 0; i < 20; i++) p = pushOutOfBodies(p, R, bodies, ARENA);
    for (const b of bodies) {
      expect(Math.hypot(p.x - b.pos.x, p.y - b.pos.y)).toBeGreaterThanOrEqual(R + b.radius - 1e-6);
    }
  });

  test("a shove never puts the avatar through an arena wall", () => {
    const atWall = { x: PLAYER_RADIUS, y: 1_000 };
    const out = pushOutOfBodies(atWall, R, [body(atWall.x + 5, atWall.y)], ARENA);
    expect(out.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
  });

  test("does not mutate the position it was given", () => {
    const at = { x: 1_000, y: 1_000 };
    pushOutOfBodies(at, R, [body(1_005, 1_000)], ARENA);
    expect(at).toEqual({ x: 1_000, y: 1_000 });
  });
});

describe("insideExit (M4-T11: standing in the door)", () => {
  const exit = { x: 100, y: 200, width: 936, height: 98 };

  test("a point inside the door rect is in", () => {
    expect(insideExit({ x: 500, y: 250 }, exit)).toBe(true);
  });

  test("the rect's own corners and edges count as in", () => {
    expect(insideExit({ x: 100, y: 200 }, exit)).toBe(true);
    expect(insideExit({ x: 1036, y: 298 }, exit)).toBe(true);
  });

  test("a point just outside on any side is out", () => {
    expect(insideExit({ x: 99, y: 250 }, exit)).toBe(false);
    expect(insideExit({ x: 1037, y: 250 }, exit)).toBe(false);
    expect(insideExit({ x: 500, y: 199 }, exit)).toBe(false);
    expect(insideExit({ x: 500, y: 299 }, exit)).toBe(false);
  });

  test("the door a real world generates is somewhere a player can actually stand", () => {
    const { exit: placed } = generateWorld(players(1), { rng: () => 0.5 });
    const centre = { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 };
    expect(insideExit(centre, placed)).toBe(true);
  });
});

describe("revealsExit (#93: coming close enough to find the door)", () => {
  // A door on the left wall: 98 deep, 936 long, so the face it presents to the arena is x = 98.
  const exit = { x: 0, y: 1_000, width: 98, height: 936 };
  const face = exit.x + exit.width;
  const midY = exit.y + exit.height / 2;

  test("standing in the door is as close as it gets", () => {
    expect(revealsExit({ x: 50, y: midY }, exit)).toBe(true);
  });

  test("1,800 u from the door reveals it and 1,801 u does not", () => {
    expect(revealsExit({ x: face + 1_800, y: midY }, exit)).toBe(true);
    expect(revealsExit({ x: face + 1_801, y: midY }, exit)).toBe(false);
  });

  test("distance is to the nearest point of the door, not to its centre", () => {
    // Level with the door's near end and 1,800 u out from its face. The door's centre is 1,907 u
    // from here and its face's midpoint 1,860 u, so either of those measures would leave it
    // hidden; against the door itself it is exactly 1,800.
    expect(revealsExit({ x: face + 1_800, y: exit.y }, exit)).toBe(true);
  });

  test("running past the far end of the door counts the length of the wall too", () => {
    // Diagonally off the door's far corner, so both axes carry distance. Every other case here
    // sits square to the face with nothing in the along-wall term — which is exactly the term a
    // player sprinting the length of a wall 1,800 u out is judged on, and the one that would let
    // a door 13,000 u away announce itself if it were dropped.
    const corner = { x: face, y: exit.y + exit.height };
    expect(revealsExit({ x: corner.x + 1_272, y: corner.y + 1_272 }, exit)).toBe(true);
    expect(revealsExit({ x: corner.x + 1_273, y: corner.y + 1_273 }, exit)).toBe(false);
  });

  test("the reveal distance is its own number, not AGGRO_RADIUS", () => {
    // The requirement is about a future retune: move `AGGRO_RADIUS` and this must not follow. That
    // is what pinning the value catches — write `EXIT_REVEAL_RADIUS = AGGRO_RADIUS`, retune aggro,
    // and this line fails. Its twin in `enemies.test.ts` pins the other end, so a retune shows up
    // as one file changing and not the other. Reading the source for an import instead would fail
    // on a type-only one, which carries no value at all, and would still miss a shared third
    // module — a weaker test that looks stronger.
    expect(EXIT_REVEAL_RADIUS).toBe(1_800);
  });
});
