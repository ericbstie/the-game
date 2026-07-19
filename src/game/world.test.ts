import { describe, expect, test } from "bun:test";
import { ARENA, PLAYER_RADIUS, PLAYER_SPEED, World } from "./world";

const STILL = { up: false, down: false, left: false, right: false };
const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, slot: i + 1, name: `P${i + 1}` }));

describe("World spawn", () => {
  test("seeds one avatar per player near the arena center", () => {
    const snap = new World(players(3)).snapshot();
    expect(snap.players).toHaveLength(3);
    expect(snap.players.map((p) => p.slot)).toEqual([1, 2, 3]);
    for (const a of snap.players) {
      expect(Math.abs(a.pos.x - ARENA.width / 2)).toBeLessThan(120);
      expect(Math.abs(a.pos.y - ARENA.height / 2)).toBeLessThan(120);
      expect(a.radius).toBe(PLAYER_RADIUS);
    }
  });

  test("places monsters and a wall-flush exit inside the arena; tick starts at 0", () => {
    const snap = new World(players(1)).snapshot();
    expect(snap.monsters.length).toBeGreaterThan(0);
    for (const m of snap.monsters) {
      expect(m.pos.x).toBeGreaterThanOrEqual(0);
      expect(m.pos.x).toBeLessThanOrEqual(ARENA.width);
      expect(m.pos.y).toBeGreaterThanOrEqual(0);
      expect(m.pos.y).toBeLessThanOrEqual(ARENA.height);
    }
    const e = snap.exit;
    const onWall =
      e.x === 0 || e.y === 0 || e.x + e.width === ARENA.width || e.y + e.height === ARENA.height;
    expect(onWall).toBe(true);
    expect(snap.tick).toBe(0);
  });

  test("exit placement is driven by an injectable rng", () => {
    const a = new World(players(1), { rng: () => 0 }).snapshot().exit;
    const b = new World(players(1), { rng: () => 0.99 }).snapshot().exit;
    expect(a).not.toEqual(b);
  });
});

describe("World movement", () => {
  test("integrates held input in the right direction and advances the tick", () => {
    const w = new World(players(1));
    const start = w.snapshot().players[0].pos.x;
    w.setInput("p1", { up: false, down: false, left: false, right: true });
    w.step(100);
    const snap = w.snapshot();
    expect(snap.players[0].pos.x).toBeGreaterThan(start);
    expect(snap.tick).toBe(1);
  });

  test("no input means no movement", () => {
    const w = new World(players(1));
    const before = w.snapshot().players[0].pos;
    w.step(100);
    expect(w.snapshot().players[0].pos).toEqual(before);
  });

  test("speed is frame-rate independent (distance ≤ speed × dt)", () => {
    const w = new World(players(1));
    w.setInput("p1", { up: false, down: false, left: false, right: true });
    const x0 = w.snapshot().players[0].pos.x;
    w.step(1000);
    const dx = w.snapshot().players[0].pos.x - x0;
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBeLessThanOrEqual(PLAYER_SPEED + 1e-6);
  });

  test("diagonal movement is normalized (no speed boost)", () => {
    const w = new World(players(1));
    const p = w.snapshot().players[0].pos;
    w.setInput("p1", { up: true, down: false, left: false, right: true });
    w.step(100);
    const q = w.snapshot().players[0].pos;
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo((PLAYER_SPEED * 100) / 1000, 3);
  });

  test("clamps avatars inside the arena walls", () => {
    const w = new World(players(1));
    w.setInput("p1", { up: false, down: false, left: false, right: true });
    for (let i = 0; i < 200; i++) w.step(100);
    expect(w.snapshot().players[0].pos.x).toBeCloseTo(ARENA.width - PLAYER_RADIUS, 3);
  });
});

describe("World roster", () => {
  test("removeAvatar drops the player from the snapshot", () => {
    const w = new World(players(2));
    w.removeAvatar("p1");
    expect(w.snapshot().players.map((p) => p.id)).toEqual(["p2"]);
  });

  test("addAvatar seats a new player", () => {
    const w = new World(players(1));
    w.addAvatar({ id: "p2", slot: 2, name: "P2" });
    expect(
      w
        .snapshot()
        .players.map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
  });

  test("setInput on an unknown id is a no-op", () => {
    const w = new World(players(1));
    expect(() => w.setInput("ghost", STILL)).not.toThrow();
  });
});
