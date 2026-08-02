import { clamp } from "./world";

// The player's zoom (#92): how much of the arena one screen shows, and — separately — what the
// sprites on it are currently baked at.
//
// `zoom` is **CSS pixels per world unit** throughout, which is the scale `GameScreen` folds into the
// paint transform. At 1 the world is drawn 1:1, as it has been since M2; at 0.5 a screen shows four
// times the area, and at 3 everything is three times as wide.
//
// Client-local and per player, like the corner map's own zoom (#110): nothing about it rides the
// wire, nothing about it reaches the simulation, and two players in one match can be looking at the
// arena at different scales.

// The range, exactly as #92 states it.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
// What a match opens at, and what it stays at until somebody turns the wheel — so a player who never
// does sees the game M2 drew.
export const ZOOM_DEFAULT = 1;

// How fast the wheel zooms, in e-folds per pixel of wheel travel. **Provisional**: at this rate one
// Chromium notch (100 px) is ×1.16 and the whole 0.5–3 range is twelve of them, which is a spin
// rather than a scroll.
//
// Multiplied rather than added, and that is not provisional: zoom is read logarithmically, so a
// fixed step of 0.25 would be a third of the picture at 0.75× and a twelfth of it at 3×. This way a
// notch is the same fraction of the picture wherever in the range it is turned.
const ZOOM_RATE = 0.0015;

// What one line of a line-reporting wheel is worth in pixels. Firefox on Windows and Linux reports
// `DOM_DELTA_LINE` with three lines to a notch where Chromium reports a hundred pixels, so without
// this the identical wheel would zoom a fifteenth as far on one browser as on the other.
const PX_PER_LINE = 16;

// How long the zoom has to hold still before the sprites are re-baked at it (ADR 0008).
//
// **Its floor is derived and its exact value is provisional.** The floor is `MAX_FRAME_MS`
// (`GameScreen.tsx`, 100): a gesture is sampled event by event, and 100 ms is the longest gap the
// render loop itself still treats as one continuous step — under that, one flick of the wheel would
// settle several times and pay a re-bake for each. This is the first round figure above it.
//
// **It is deliberately not derived from the burst it hides**, which `bun run frame:budget` measures
// at 92 ms at 3× and 315 ms at 0.5× (`docs/frame-budget.md`). No settle short of a second would make
// a one-notch-then-pause gesture cheap, because a zoom that genuinely moved *owes* a re-bake; what a
// settle can do is stop one continuous gesture paying several, and that is all this number is for.
//
// Nor is it what stops that burst being a freeze — `cache.ts` spends a fixed bake budget per frame
// and hands back the bakes in hand for the rest, so the settle is a second of sharpening rather than
// a stopped thread. The two are independent: without the settle a gesture would re-bake toward a
// scale it is about to leave, on every frame of the turn.
//
// What it trades is how long resampled ink stands after the hand stops, and only a played match can
// judge that — so the value is provisional and a later change to it is a retune.
export const ZOOM_SETTLE_MS = 150;

// What the world is drawn at, what its sprites were baked at, and when the two last diverged.
//
// Two numbers rather than one because ADR 0008 keys the bake on `dpr × zoom` and a continuum cannot
// be re-keyed per frame. `drawn` moves with the wheel and the transform follows it immediately;
// `baked` lags, so during a gesture the frame blits the bakes it already has — resampled, which is
// what every candidate the ADR rejected did on every frame — and re-bakes once, when the hand stops.
export interface Zoom {
  drawn: number;
  baked: number;
  movedAt: number;
}

export function freshZoom(): Zoom {
  return { drawn: ZOOM_DEFAULT, baked: ZOOM_DEFAULT, movedAt: Number.NEGATIVE_INFINITY };
}

// Take one wheel event. `deltaMode` is the event's own, so the two units a browser may report in are
// reconciled here rather than at the listener.
//
// A delta that is not a finite number leaves the zoom exactly where it was: `clamp` would carry a
// `NaN` straight through, and a `NaN` zoom is a frame with no camera, no cull and no cursor.
export function wheelZoom(zoom: Zoom, deltaY: number, deltaMode: number, now: number): void {
  const px = deltaMode === 1 ? deltaY * PX_PER_LINE : deltaY;
  if (!Number.isFinite(px)) return;
  const next = clamp(zoom.drawn * Math.exp(-px * ZOOM_RATE), ZOOM_MIN, ZOOM_MAX);
  if (next === zoom.drawn) return; // already against a stop: the gesture has not moved anything
  zoom.drawn = next;
  zoom.movedAt = now;
}

// What this frame's sprites are baked at — the scale the cache is asked for, once the device ratio
// is folded in. Held at the previous value until the gesture has been still for `ZOOM_SETTLE_MS`,
// and then taken whole.
export function bakeZoom(zoom: Zoom, now: number): number {
  if (now - zoom.movedAt >= ZOOM_SETTLE_MS) zoom.baked = zoom.drawn;
  return zoom.baked;
}
