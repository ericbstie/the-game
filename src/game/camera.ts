import type { Arena, Vec2 } from "../lobby/protocol";

// The fullscreen camera (Milestone 2 refinement). Pure geometry: where the viewport sits
// in world space, and whether an entity falls inside it. Both are unit-tested and drive
// the render loop so cost stays independent of the (huge) world size.

export interface Viewport {
  width: number;
  height: number;
}

export interface Camera {
  x: number;
  y: number;
}

// Center the viewport on `self`, clamped so it never scrolls past a wall — you see the
// wall, not black. A viewport bigger than the arena clamps to the origin.
export function computeCamera(self: Vec2, viewport: Viewport, arena: Arena): Camera {
  return {
    x: clamp(self.x - viewport.width / 2, 0, Math.max(0, arena.width - viewport.width)),
    y: clamp(self.y - viewport.height / 2, 0, Math.max(0, arena.height - viewport.height)),
  };
}

// Does an entity at `pos` reach into the camera's viewport? Off-screen entities are culled.
//
// `halfExtent` is how far the entity's *drawing* reaches from `pos`, which is not its radius once
// it is a sprite: an upright sprite is anchored at its feet and stands a whole box-height above
// them, so a caller passes the sprite's box rather than the circle it replaced. `margin` covers
// anything drawn further out still, like the name label above an avatar.
export function isVisible(
  pos: Vec2,
  halfExtent: number,
  camera: Camera,
  viewport: Viewport,
  margin = 0,
): boolean {
  const pad = halfExtent + margin;
  return (
    pos.x + pad >= camera.x &&
    pos.x - pad <= camera.x + viewport.width &&
    pos.y + pad >= camera.y &&
    pos.y - pad <= camera.y + viewport.height
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
