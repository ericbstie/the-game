import { describe, expect, test } from "bun:test";
import { aimDir, keyToDirection, movesEqual, NO_MOVE } from "./input";

describe("keyToDirection", () => {
  test("maps WASD and arrow keys to directions (case-insensitive)", () => {
    expect(keyToDirection("w")).toBe("up");
    expect(keyToDirection("W")).toBe("up");
    expect(keyToDirection("ArrowUp")).toBe("up");
    expect(keyToDirection("s")).toBe("down");
    expect(keyToDirection("ArrowDown")).toBe("down");
    expect(keyToDirection("a")).toBe("left");
    expect(keyToDirection("ArrowLeft")).toBe("left");
    expect(keyToDirection("d")).toBe("right");
    expect(keyToDirection("ArrowRight")).toBe("right");
  });

  test("returns null for non-movement keys", () => {
    expect(keyToDirection("q")).toBeNull();
    expect(keyToDirection(" ")).toBeNull();
    expect(keyToDirection("Enter")).toBeNull();
  });
});

describe("movesEqual", () => {
  test("compares all four flags", () => {
    expect(movesEqual(NO_MOVE, { up: false, down: false, left: false, right: false })).toBe(true);
    expect(movesEqual(NO_MOVE, { ...NO_MOVE, right: true })).toBe(false);
  });
});

describe("aimDir", () => {
  test("aims from the self avatar toward the pointer's world position (unit vector)", () => {
    // Pointer 100 px right of self on screen (self at world 500,500; camera 400,400 → self screen 100,100).
    const dir = aimDir({ x: 200, y: 100 }, { x: 500, y: 500 }, { x: 400, y: 400 });
    expect(dir).toEqual({ x: 1, y: 0 });
  });

  test("accounts for the camera offset (pointer world = pointer + camera)", () => {
    // Pointer at screen (0,0) with camera (400,400) is world (400,400); self at (400,300) → straight down.
    const dir = aimDir({ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 400, y: 400 });
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(1, 6);
  });

  test("a pointer exactly on self defaults to aiming right (never a zero vector)", () => {
    expect(aimDir({ x: 100, y: 100 }, { x: 500, y: 500 }, { x: 400, y: 400 })).toEqual({
      x: 1,
      y: 0,
    });
  });
});
