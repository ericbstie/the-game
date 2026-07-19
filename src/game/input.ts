import type { MoveInput } from "../lobby/protocol";

// Pure keyboard→intent mapping, kept out of the component so it is trivially testable.
// The server owns movement; this only reports which directions are held.

export const NO_MOVE: MoveInput = { up: false, down: false, left: false, right: false };

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
