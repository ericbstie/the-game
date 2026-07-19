import { describe, expect, test } from "bun:test";
import type { WorldSnapshot } from "../lobby/protocol";
import type { Camera, Viewport } from "./camera";
import { drawWorld } from "./draw";

// happy-dom returns null from getContext('2d'), so the draw path is exercised against a
// spy that records the calls and lets any property be assigned.
interface Call {
  fn: string;
  args: unknown[];
}
function spyCtx() {
  const calls: Call[] = [];
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  const ctx = {
    calls,
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    beginPath: record("beginPath"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillText: record("fillText"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

const world: WorldSnapshot = {
  arena: { width: 31_200, height: 31_200 },
  players: [
    { id: "p1", slot: 1, name: "Ana", pos: { x: 1100, y: 1100 }, radius: 14 },
    { id: "p2", slot: 2, name: "Ben", pos: { x: 1200, y: 1150 }, radius: 14 },
  ],
  monsters: [
    { id: "m1", pos: { x: 1090, y: 1090 }, radius: 16 },
    { id: "m2", pos: { x: 20_000, y: 20_000 }, radius: 16 }, // far off-screen
  ],
  enemies: [],
  exit: { x: 0, y: 1100, width: 98, height: 936 },
};

const viewport: Viewport = { width: 800, height: 600 };
const camera: Camera = { x: 1000, y: 1000 }; // shows the two avatars + m1, not m2

describe("drawWorld", () => {
  test("clears and fills only the viewport region, not the whole arena", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    const clear = ctx.calls.find((c) => c.fn === "clearRect");
    expect(clear?.args).toEqual([1000, 1000, 800, 600]);
    // the background fill covers the viewport, never the 31,200² arena
    expect(
      ctx.calls.some((c) => c.fn === "fillRect" && c.args[2] === 800 && c.args[3] === 600),
    ).toBe(true);
  });

  test("draws the exit rectangle in world coordinates", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    expect(
      ctx.calls.some((c) => c.fn === "fillRect" && c.args[0] === 0 && c.args[1] === 1100),
    ).toBe(true);
  });

  test("culls entities outside the viewport", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    // Both avatars + m1 are on screen; m2 (20,000, 20,000) is culled.
    const arcs = ctx.calls.filter((c) => c.fn === "arc").length;
    expect(arcs).toBe(3);
  });

  test("labels each on-screen avatar with its name", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { camera, viewport });
    const labels = ctx.calls.filter((c) => c.fn === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("Ana");
    expect(labels).toContain("Ben");
  });

  test("rings the self avatar", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world, { selfId: "p1", camera, viewport });
    // self ring adds a stroke() beyond the arena wall's strokeRect
    expect(ctx.calls.filter((c) => c.fn === "stroke").length).toBeGreaterThan(0);
  });

  test("draws on-screen enemies and culls off-screen ones", () => {
    const ctx = spyCtx();
    const withEnemies: WorldSnapshot = {
      ...world,
      enemies: [
        { id: "e1", kind: "grunt", pos: { x: 1150, y: 1150 }, radius: 16, hp: 30 }, // on screen
        { id: "e2", kind: "grunt", pos: { x: 25_000, y: 25_000 }, radius: 16, hp: 30 }, // culled
      ],
    };
    drawWorld(ctx, withEnemies, { camera, viewport });
    // 2 avatars + m1 + one on-screen enemy = 4 arcs; the far enemy is culled.
    expect(ctx.calls.filter((c) => c.fn === "arc").length).toBe(4);
  });
});
