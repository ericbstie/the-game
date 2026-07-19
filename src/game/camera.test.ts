import { describe, expect, test } from "bun:test";
import { type Camera, computeCamera, isVisible, type Viewport } from "./camera";

const arena = { width: 31_200, height: 31_200 };
const vp: Viewport = { width: 800, height: 600 };

describe("computeCamera", () => {
  test("centers the viewport on self in open space", () => {
    const cam = computeCamera({ x: 15_600, y: 15_600 }, vp, arena);
    expect(cam.x).toBe(15_600 - 400);
    expect(cam.y).toBe(15_600 - 300);
  });

  test("clamps at the near walls so you see the wall, not black", () => {
    expect(computeCamera({ x: 10, y: 10 }, vp, arena)).toEqual({ x: 0, y: 0 });
  });

  test("clamps at the far walls", () => {
    const cam = computeCamera({ x: 31_200, y: 31_200 }, vp, arena);
    expect(cam).toEqual({ x: arena.width - vp.width, y: arena.height - vp.height });
  });

  test("a viewport larger than the arena clamps to the origin", () => {
    expect(computeCamera({ x: 100, y: 100 }, { width: 40_000, height: 40_000 }, arena)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("isVisible", () => {
  const cam: Camera = { x: 1000, y: 1000 };

  test("includes an entity inside the viewport", () => {
    expect(isVisible({ x: 1400, y: 1300 }, 16, cam, vp)).toBe(true);
  });

  test("excludes an entity well outside the viewport", () => {
    expect(isVisible({ x: 5000, y: 5000 }, 16, cam, vp)).toBe(false);
  });

  test("a just-off-edge entity is kept while within its radius+margin", () => {
    expect(isVisible({ x: 970, y: 1200 }, 16, cam, vp, 40)).toBe(true); // 30 left of the edge < 16+40
    expect(isVisible({ x: 930, y: 1200 }, 16, cam, vp, 40)).toBe(false); // 70 left of the edge > 16+40
  });

  test("culls the vast majority of spread-out entities (render cost independent of world size)", () => {
    const origin: Camera = { x: 0, y: 0 };
    const N = 50;
    let visible = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const pos = { x: (i / N) * arena.width, y: (j / N) * arena.height };
        if (isVisible(pos, 16, origin, vp, 44)) visible++;
      }
    }
    expect(visible / (N * N)).toBeLessThan(0.01); // under 1% on screen at any moment
  });
});
