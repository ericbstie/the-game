import { describe, expect, test } from "bun:test";
import { keyToDirection, movesEqual, NO_MOVE } from "./input";

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
