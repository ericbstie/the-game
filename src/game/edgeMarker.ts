import type { Vec2 } from "../lobby/protocol";
import type { Camera, Viewport } from "./camera";
import { ARENA } from "./world";

// Where a teammate the camera has left behind is marked, and how faint that mark is (#94). Pure
// geometry, like `camera.ts` and for the same reason: a point, a bearing and an opacity are the
// whole of the decision, and none of them needs a canvas to be checked.
//
// *Which* teammates get one is not decided here. That is the same cull that decides whether their
// body draws (`isVisible` in `drawWorld`), and it is asked once there — a second copy of the test
// would eventually disagree with the first, and the frame it disagreed on is exactly the frame a
// player crosses the edge and sees either two of themselves or none.

// The arrowhead, in world units, small enough to read as a mark on the edge of the screen rather
// than as a HUD: 18 u against a player's 28 u width, so it never competes with a body. The notch
// is what makes it a drawn arrowhead instead of an isoceles triangle — the tail is cut in toward
// the tip, which is how the period's printed arrows were struck.
export const MARKER_LENGTH = 18;
export const MARKER_WIDTH = 14;
export const MARKER_NOTCH = 6;
// The outline's weight. Thinner than a shot line (2), because this is a small mark and not an event.
export const MARKER_STROKE = 1.5;

// How far in from the viewport edge the arrow's centre sits. It has to clear the arrow's own reach
// — 11.4 u from centre to a barb, plus half the outline — or the drawing would spill off the screen
// it is marking the edge of.
export const MARKER_INSET = 16;

// Distance reads as opacity, and this is where it bottoms out: half the arena, so a teammate on the
// far side of the box is at the faint end wherever you are standing. Derived rather than restated,
// because "half the arena" is the thing that was asked for and 15,600 is only its current value.
export const MARKER_FADE_UNITS = ARENA.width / 2;

// The faintest an arrow ever gets. Read off a rendered frame rather than picked (#94): the floor is
// white paper with no greys (#72), so a faded outline lands as a grey over white and the only
// honest question is how light that grey is allowed to be. At 0.45 the outline composites to
// #8c8c8c — measured, not derived — which is 3.36:1 against paper, clear of the 3:1 WCAG 1.4.11
// asks of a non-text graphic. The ladder either side is what fixes it here: 0.40 lands #999999 at
// 2.85:1 and 0.42 lands #949494 at 3.03:1, so this is the first round value with any margin.
//
// It survives the resolution too, which is the part a contrast figure alone would miss — the
// outline is 1.5 u wide, so at dpr 1 it is thinner than a device pixel and nearly all of it is
// anti-aliased away from its solid value. Measured over the worst of the six slot colours
// (#f2c14e, 1.7:1 against paper even at full opacity): 166 / 590 / 1254 device pixels carrying ink
// at dpr 1 / 2 / 3, of which 49 / 271 / 613 are at or past 3:1.
export const MARKER_MIN_ALPHA = 0.45;

// One arrow: where it sits, which way it points, and how faint it is. World coordinates, because
// `drawWorld` paints in world space and never sees the camera transform.
export interface EdgeMarker {
  x: number;
  y: number;
  angle: number; // radians, from the viewport centre out toward the teammate
  alpha: number;
}

// The arrowhead pointing along +x, to be rotated onto its bearing. Tip first, so a caller can find
// the leading point without knowing the shape.
const SHAPE: readonly Vec2[] = [
  { x: MARKER_LENGTH / 2, y: 0 },
  { x: -MARKER_LENGTH / 2, y: MARKER_WIDTH / 2 },
  { x: -MARKER_LENGTH / 2 + MARKER_NOTCH, y: 0 },
  { x: -MARKER_LENGTH / 2, y: -MARKER_WIDTH / 2 },
];

// Where the ray from the middle of the screen to `pos` leaves the inset viewport rect, and how far
// past that point the teammate actually is.
//
// The origin is the viewport centre rather than the player, because the camera clamps at the walls:
// standing in a corner your own avatar is well off centre, and an arrow struck from you would leave
// the rect on the wrong side of the screen from the one the teammate is beyond.
export function edgeMarker(pos: Vec2, camera: Camera, viewport: Viewport): EdgeMarker {
  const cx = camera.x + viewport.width / 2;
  const cy = camera.y + viewport.height / 2;
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  // Whichever axis the ray runs out of first is the edge it leaves through. `Infinity` from a zero
  // component is the right answer and not a hazard: a ray with no run in x never crosses a side.
  const scale = Math.min(
    (viewport.width / 2 - MARKER_INSET) / Math.abs(dx),
    (viewport.height / 2 - MARKER_INSET) / Math.abs(dy),
  );
  const x = cx + dx * scale;
  const y = cy + dy * scale;
  // Measured from the arrow to its teammate, so the ramp starts at zero the moment they cross off
  // screen and does not depend on which edge they left by — a corner is further from the middle of
  // the screen than a side is, and that is a fact about the viewport, not about the distance asked
  // to be read.
  const away = Math.hypot(pos.x - x, pos.y - y);
  return {
    x,
    y,
    angle: Math.atan2(dy, dx),
    alpha: 1 - Math.min(1, away / MARKER_FADE_UNITS) * (1 - MARKER_MIN_ALPHA),
  };
}

// The arrowhead's four corners in world space, tip first.
export function markerPoints(marker: EdgeMarker): Vec2[] {
  const cos = Math.cos(marker.angle);
  const sin = Math.sin(marker.angle);
  return SHAPE.map((p) => ({
    x: marker.x + p.x * cos - p.y * sin,
    y: marker.y + p.x * sin + p.y * cos,
  }));
}
