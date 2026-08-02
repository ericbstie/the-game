import { describe, expect, test } from "bun:test";
import {
  type Camera,
  computeCamera,
  isVisible,
  pointerWorld,
  type Viewport,
  worldViewport,
} from "./camera";

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

// #92. A `Viewport` is the world rectangle on screen, so the zoom reaches every consumer of one —
// the wall clamp, the cull, both floor passes and the room's wall run — through this one function.
describe("worldViewport", () => {
  const zooms = [0.5, 0.75, 1, 1.5, 2, 3];

  test("is the screen itself at 1×", () => {
    expect(worldViewport(vp, 1)).toEqual(vp);
  });

  test("zooming out to 0.5× shows four times the area through the same screen", () => {
    const wide = worldViewport(vp, 0.5);
    expect(wide).toEqual({ width: 1600, height: 1200 });
    expect((wide.width * wide.height) / (vp.width * vp.height)).toBe(4);
  });

  test("zooming in to 3× shows a ninth of it", () => {
    const close = worldViewport(vp, 3);
    expect((close.width * close.height) / (vp.width * vp.height)).toBeCloseTo(1 / 9, 12);
  });

  test("an entity is culled at the same world distance the screen actually reaches", () => {
    // 900 u right of the camera: off a 1× screen, on a 0.5× one, and the boundary is w / z exactly.
    const cam: Camera = { x: 0, y: 0 };
    expect(isVisible({ x: 900, y: 100 }, 0, cam, worldViewport(vp, 1))).toBe(false);
    expect(isVisible({ x: 900, y: 100 }, 0, cam, worldViewport(vp, 0.5))).toBe(true);
    for (const zoom of zooms) {
      const world = worldViewport(vp, zoom);
      expect(isVisible({ x: vp.width / zoom, y: 100 }, 0, cam, world)).toBe(true);
      expect(isVisible({ x: vp.width / zoom + 1, y: 100 }, 0, cam, world)).toBe(false);
    }
  });

  test("a body reaching into the screen is kept at every scale, by its world extent", () => {
    // The same spider, 16 u of body past the same world point: visible whenever its box overlaps
    // the screen and culled when it does not, and the answer never depends on the zoom.
    const cam: Camera = { x: 1000, y: 1000 };
    for (const zoom of zooms) {
      const world = worldViewport(vp, zoom);
      const edge = cam.x + world.width;
      expect(isVisible({ x: edge + 15, y: 1100 }, 16, cam, world)).toBe(true);
      expect(isVisible({ x: edge + 17, y: 1100 }, 16, cam, world)).toBe(false);
    }
  });

  test("the wall clamp holds on a 31,200² arena at 0.5×, so no frame is part black", () => {
    // A 1920 × 1080 screen at 0.5× is a 3,840 × 2,160 window on the world — four times the area
    // #92 opens with, and still under a thousandth of the arena.
    const screen: Viewport = { width: 1920, height: 1080 };
    const world = worldViewport(screen, 0.5);
    for (const self of [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 15_600, y: 15_600 },
      { x: 31_190, y: 31_190 },
      { x: 31_200, y: 31_200 },
    ]) {
      const cam = computeCamera(self, world, arena);
      expect(cam.x).toBeGreaterThanOrEqual(0);
      expect(cam.y).toBeGreaterThanOrEqual(0);
      expect(cam.x + world.width).toBeLessThanOrEqual(arena.width);
      expect(cam.y + world.height).toBeLessThanOrEqual(arena.height);
    }
    // Standing in the far corner, the far wall is exactly on the screen edge — the wall, not black.
    expect(computeCamera({ x: 31_200, y: 31_200 }, world, arena)).toEqual({
      x: arena.width - world.width,
      y: arena.height - world.height,
    });
    expect(computeCamera({ x: 0, y: 0 }, world, arena)).toEqual({ x: 0, y: 0 });
  });
});

// The inverse of the paint transform, and the only conversion in the game from a pointer to a place
// (#92). Miss the zoom here and the build ghost draws on the tile the cursor is over while the
// placement lands on another one.
describe("pointerWorld", () => {
  const cam: Camera = { x: 12_345, y: 6_789 };
  const zooms = [0.5, 0.75, 1, 1.5, 2, 2.5, 3];

  test("is pointer + camera at 1×", () => {
    expect(pointerWorld({ x: 200, y: 150 }, cam, 1)).toEqual({ x: 12_545, y: 6_939 });
  });

  test("round-trips the point the frame painted at that pixel, at every scale", () => {
    for (const zoom of zooms) {
      for (const at of [
        { x: cam.x, y: cam.y },
        { x: cam.x + 15, y: cam.y + 30 },
        { x: cam.x + 400, y: cam.y + 300 },
        { x: cam.x + 799, y: cam.y + 599 },
      ]) {
        // Where `drawWorld` puts that world point on the canvas, in CSS px.
        const pointer = { x: (at.x - cam.x) * zoom, y: (at.y - cam.y) * zoom };
        const back = pointerWorld(pointer, cam, zoom);
        expect(back.x).toBeCloseTo(at.x, 9);
        expect(back.y).toBeCloseTo(at.y, 9);
      }
    }
  });
});
