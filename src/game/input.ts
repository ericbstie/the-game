import type { MoveInput, Vec2 } from "../lobby/protocol";
import { type Camera, pointerWorld } from "./camera";

// Pure player-input mapping, kept out of the component so it is trivially testable. The
// keyboard drives movement (which directions are held); the pointer drives aim.

export const NO_MOVE: MoveInput = { up: false, down: false, left: false, right: false };

// The unit aim vector from the self avatar toward the pointer. `pointer` is in CSS pixels within
// the canvas, and `pointerWorld` is what turns those into a place — the same conversion the build
// ghost and the hand-mine read the cursor through, so a shot can never leave along a line the
// cursor was not on. `zoom` defaults to the 1:1 the game opened its life at.
//
// A pointer exactly on self defaults to aiming right, so a swing always has a direction.
export function aimDir(pointer: Vec2, self: Vec2, camera: Camera, zoom = 1): Vec2 {
  const at = pointerWorld(pointer, camera, zoom);
  const dx = at.x - self.x;
  const dy = at.y - self.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

export function keyToDirection(key: string): keyof MoveInput | null {
  switch (key) {
    case "w":
    case "W":
    case "ArrowUp":
      return "up";
    case "s":
    case "S":
    case "ArrowDown":
      return "down";
    case "a":
    case "A":
    case "ArrowLeft":
      return "left";
    case "d":
    case "D":
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

export function movesEqual(a: MoveInput, b: MoveInput): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right;
}

// The key that steps the corner map's zoom (#110). `m` for the map, chosen because it is free: the
// match binds `WASD` and the arrows to movement, `1`–`4` to the build bar, `Escape` to the menu, and
// `g` is the gun's (#120, moved there by #132). **Provisional**, like the levels it steps through.
export const MINIMAP_ZOOM_KEY = "m";

export function isMinimapZoomKey(key: string): boolean {
  return key === MINIMAP_ZOOM_KEY || key === MINIMAP_ZOOM_KEY.toUpperCase();
}

// The key that equips and stows the gun (#120), which is what decides whether left-click shoots or
// mines. `g` for the gun — #120 named `e` and #132 moved it here.
export const GUN_TOGGLE_KEY = "g";

export function isGunToggleKey(key: string): boolean {
  return key === GUN_TOGGLE_KEY || key === GUN_TOGGLE_KEY.toUpperCase();
}

// The build bar's keys: `1`–`4` pick a slot, returned zero-indexed. Anything else is not a build
// key, so movement and the rest of the game keep it — Escape included, which cancels the selected
// buildable and opens the menu only when there is none (#117).
export function keyToBuildSlot(key: string, slots: number): number | null {
  const slot = Number(key);
  if (!Number.isInteger(slot) || key.trim() === "") return null;
  return slot >= 1 && slot <= slots ? slot - 1 : null;
}
