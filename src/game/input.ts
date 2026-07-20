import type { MoveInput, Vec2 } from "../lobby/protocol";
import type { Camera } from "./camera";

// Pure player-input mapping, kept out of the component so it is trivially testable. The
// keyboard drives movement (which directions are held); the pointer drives aim.

export const NO_MOVE: MoveInput = { up: false, down: false, left: false, right: false };

// The unit aim vector from the self avatar toward the pointer. `pointer` is in CSS pixels
// within the canvas; `camera` maps the canvas to world space (1 world unit = 1 CSS px), so
// `pointer + camera` is the pointer's world position. A pointer exactly on self defaults to
// aiming right, so a swing always has a direction.
export function aimDir(pointer: Vec2, self: Vec2, camera: Camera): Vec2 {
  const dx = pointer.x + camera.x - self.x;
  const dy = pointer.y + camera.y - self.y;
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
