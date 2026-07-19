import { describe, expect, test } from "bun:test";
import type { WorldSnapshot } from "../lobby/protocol";
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
  arena: { width: 960, height: 600 },
  players: [
    { id: "p1", slot: 1, name: "Ana", pos: { x: 100, y: 100 }, radius: 14 },
    { id: "p2", slot: 2, name: "Ben", pos: { x: 200, y: 150 }, radius: 14 },
  ],
  monsters: [
    { id: "m1", pos: { x: 90, y: 90 }, radius: 16 },
    { id: "m2", pos: { x: 870, y: 90 }, radius: 16 },
  ],
  exit: { x: 400, y: 0, width: 96, height: 18 },
};

describe("drawWorld", () => {
  test("clears the frame and draws the exit rectangle", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world);
    expect(ctx.calls.some((c) => c.fn === "clearRect")).toBe(true);
    expect(ctx.calls.some((c) => c.fn === "fillRect" && c.args[0] === 400 && c.args[1] === 0)).toBe(
      true,
    );
  });

  test("draws a circle for every avatar and every monster", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world);
    const arcs = ctx.calls.filter((c) => c.fn === "arc").length;
    expect(arcs).toBe(world.players.length + world.monsters.length);
  });

  test("labels each avatar with its name", () => {
    const ctx = spyCtx();
    drawWorld(ctx, world);
    const labels = ctx.calls.filter((c) => c.fn === "fillText").map((c) => c.args[0]);
    expect(labels).toContain("Ana");
    expect(labels).toContain("Ben");
  });
});
