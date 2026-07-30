import { describe, expect, test } from "bun:test";
import {
  aimDir,
  GUN_TOGGLE_KEY,
  isGunToggleKey,
  isMinimapZoomKey,
  keyToBuildSlot,
  keyToDirection,
  MINIMAP_ZOOM_KEY,
  movesEqual,
  NO_MOVE,
} from "./input";

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

describe("keyToBuildSlot", () => {
  test("1–4 select their slot, zero-indexed", () => {
    expect(keyToBuildSlot("1", 4)).toBe(0);
    expect(keyToBuildSlot("4", 4)).toBe(3);
  });

  // #100 moved Escape to the menu, so it is no longer the build bar's cancel — right-click is.
  test("Escape is not a build key", () => {
    expect(keyToBuildSlot("Escape", 4)).toBeNull();
  });

  test("a number past the last slot is not a build key", () => {
    expect(keyToBuildSlot("5", 4)).toBeNull();
    expect(keyToBuildSlot("0", 4)).toBeNull();
  });

  test("movement and other keys pass through untouched", () => {
    for (const key of ["w", "a", "s", "d", "ArrowUp", " ", "", "g"]) {
      expect(keyToBuildSlot(key, 4)).toBeNull();
    }
  });
});

describe("isMinimapZoomKey", () => {
  test("cycles the map's zoom whatever the shift state", () => {
    expect(isMinimapZoomKey(MINIMAP_ZOOM_KEY)).toBe(true);
    expect(isMinimapZoomKey(MINIMAP_ZOOM_KEY.toUpperCase())).toBe(true);
  });

  test("takes a key nothing else in the match is bound to", () => {
    expect(keyToDirection(MINIMAP_ZOOM_KEY)).toBeNull();
    expect(keyToBuildSlot(MINIMAP_ZOOM_KEY, 4)).toBeNull();
    expect(MINIMAP_ZOOM_KEY).not.toBe("Escape");
  });

  test("no other key cycles the map", () => {
    // `g` among them: #120 takes it for the gun toggle (#132 moved it there), and the zoom must
    // not answer to it.
    for (const key of ["w", "a", "s", "d", "ArrowUp", "1", "4", "g", "Escape", " ", ""]) {
      expect(isMinimapZoomKey(key)).toBe(false);
    }
  });
});

describe("isGunToggleKey", () => {
  test("toggles the gun whatever the shift state", () => {
    expect(isGunToggleKey(GUN_TOGGLE_KEY)).toBe(true);
    expect(isGunToggleKey(GUN_TOGGLE_KEY.toUpperCase())).toBe(true);
  });

  test("takes a key nothing else in the match is bound to", () => {
    expect(keyToDirection(GUN_TOGGLE_KEY)).toBeNull();
    expect(keyToBuildSlot(GUN_TOGGLE_KEY, 4)).toBeNull();
    expect(isMinimapZoomKey(GUN_TOGGLE_KEY)).toBe(false);
    expect(GUN_TOGGLE_KEY).not.toBe("Escape");
  });

  test("no other key toggles the gun", () => {
    for (const key of [
      "w",
      "a",
      "s",
      "d",
      "ArrowUp",
      "1",
      "4",
      MINIMAP_ZOOM_KEY,
      "Escape",
      " ",
      "",
      // The key #120 shipped and #132 moved off. Listed so a revert to it is a red test rather than
      // a silent re-binding of a key the match no longer uses.
      "e",
    ]) {
      expect(isGunToggleKey(key)).toBe(false);
    }
  });
});
