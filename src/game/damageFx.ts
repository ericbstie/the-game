import type { Vec2 } from "../lobby/protocol";

// What the screen does when *you* are hit (#142) — the player-side counterpart of the white spider
// #107 puts up, inverted to black and thrown at the view rather than at a sprite.
//
// Geometry and one alpha, in the idiom `fx.ts` and `floats.ts` already use: this module says how far
// the view is thrown and how black the veil over it is, and `GameScreen` and `draw.ts` put it there.
// That is what lets every claim about the effect be checked without a canvas, a frame or a clock.
//
// **Nothing here ages and nothing here is stateful.** The one fact the effect needs is the instant
// the blow landed, and `ClientWorld` already keeps that for the owner exactly as it keeps
// `lastHitAt` for a spider. It has to live there rather than here because the trigger is the owner's
// own health, which that class is the sole authority on — which is also what makes "a teammate's
// damage never reaches your screen" a property of where the stamp is written rather than a check.

// How long the view keeps swinging, and how far it is thrown at the first swing. World units, which
// the reach is in world units, so a zoomed-out screen swings by proportionally less of itself (#92).
// **Provisional**:
// the ask fixes neither, and only a played match can judge them.
export const SHAKE_MS = 220;
export const SHAKE_REACH = 7;

// How long the veil is up, and how black it goes at the instant of the blow. **Provisional** for the
// same reason, and picked rather than derived: nothing else in the game is timed off the *player*
// being hit, so unlike the burst (`BURST_MS`) there is no second channel for it to agree with.
//
// Shorter than the swing on purpose. The veil is the blow itself and the swing is what the blow left
// behind, so a veil outlasting the swing would read as the two being one flat event.
//
// Held well short of solid: at 1 the screen is a black rectangle and the fight is gone for the
// duration, which is a worse thing to do to a player mid-swarm than under-selling the hit.
export const FLASH_MS = 120;
export const FLASH_ALPHA = 0.5;

// How many times the view swings back and forth along its wider axis over the shake's life. Three is
// enough to read as a shake rather than as a single lurch, and few enough that each swing is several
// frames at 60 Hz rather than a strobe.
const SWINGS = 3;

// The screen `sinceMs` after the blow: how far the view is thrown off the camera, and how black the
// veil over it is. Both are **exactly** zero once their own life has run out — the frame returns to
// the camera itself and to no alpha at all, with nothing left for a later frame to round away.
export interface DamageFx {
  shake: Vec2;
  flash: number;
}

export function damageFx(sinceMs: number): DamageFx {
  return { shake: swing(sinceMs), flash: veil(sinceMs) };
}

// Written as `!(sinceMs >= 0)` rather than `sinceMs < 0`, here and below, so a NaN is refused with
// the rest. Wall-clock is what this is measured on, and a clock stepped backwards by a correction is
// the one way a frame can ask about a blow that has not landed yet.
function swing(sinceMs: number): Vec2 {
  if (!(sinceMs >= 0) || sinceMs >= SHAKE_MS) return { x: 0, y: 0 };
  const life = sinceMs / SHAKE_MS;
  // Linear, so the swing closes on exactly zero at the end rather than on a fraction of a pixel that
  // some later frame would have to be trusted to round away.
  const reach = SHAKE_REACH * (1 - life);
  const phase = life * SWINGS * 2 * Math.PI;
  // Struck from rest at full reach — a cosine and not a sine — because the blow is the impulse and
  // the frame it lands on is where the view is furthest from where it was.
  //
  // Twice around one axis for every once around the other, so the view traces a figure of eight
  // rather than sliding up and down a single diagonal. A diagonal reads as the camera having been
  // dragged; the eight reads as it having been knocked.
  return { x: Math.cos(phase) * reach, y: Math.sin(phase * 2) * reach };
}

function veil(sinceMs: number): number {
  if (!(sinceMs >= 0) || sinceMs >= FLASH_MS) return 0;
  return FLASH_ALPHA * (1 - sinceMs / FLASH_MS);
}
