import type { Arena, Vec2 } from "../lobby/protocol";

// The fullscreen camera (Milestone 2 refinement). Pure geometry: where the viewport sits
// in world space, and whether an entity falls inside it. Both are unit-tested and drive
// the render loop so cost stays independent of the (huge) world size.

// The rectangle of **world** on screen, which is not the screen's own size once the player can zoom
// (#92). Everything that asks how far the camera reaches — the wall clamp, the cull, both floor
// passes, the room's wall run, the tutorial's tile walk — asks in world units, so the zoom reaches
// all of them through `worldViewport` and none of them has ever to name it.
export interface Viewport {
  width: number;
  height: number;
}

export interface Camera {
  x: number;
  y: number;
}

// How much world a screen of `viewport` CSS pixels shows at `zoom`.
//
// `zoom` is **CSS pixels per world unit** — the scale the caller paints through — so 0.5× shows
// four times the area and 3× magnifies threefold, which is #92's stated range read literally.
export function worldViewport(viewport: Viewport, zoom: number): Viewport {
  return { width: viewport.width / zoom, height: viewport.height / zoom };
}

// Where a pointer sitting `pointer` CSS px inside the canvas is standing in the world — the inverse
// of the transform the frame is painted through, and the one conversion the game has from a pixel
// to a place. The aim, the build ghost, the mine and the hover tooltip all read it here, because a
// second copy would eventually disagree and the frame it disagreed on is the one where the ghost
// draws on one tile and the placement lands on another.
export function pointerWorld(pointer: Vec2, camera: Camera, zoom: number): Vec2 {
  return { x: pointer.x / zoom + camera.x, y: pointer.y / zoom + camera.y };
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
