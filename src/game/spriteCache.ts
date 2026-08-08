import { createSpriteCache } from "../sprite/cache";
import { SPRITES } from "../sprite/registry";

// One cache for the app: a baked sprite depends on the display, not on which screen is mounted.
// It bakes nothing until something asks, so importing this costs nothing under `bun test`, where
// there is no canvas to bake into.
//
// It lives here rather than in `GameScreen` because two screens need it now (#162): the game draws
// from it, and the lobby warms it before the game is mounted.
export const spriteCache = createSpriteCache(SPRITES);

// What the warm-up bakes at. ADR 0008 keys a bake on `dpr × zoom` and a bake covers one scale, so
// the scale to cover is the one every match opens at and stays at until somebody turns the wheel.
export const warmScale = (dpr: number, zoomDefault: number): number => dpr * zoomDefault;

// How long one warming turn may spend. Provisional (#162): it is a slice of a lobby the player is
// already sitting in, not a frame anyone is waiting on, and nothing is drawn from it. Wide enough
// that the whole non-tiled cast lands in the first turn or two, short enough not to make the lobby
// feel stuck.
export const WARM_BUDGET_MS = 12;

// Whether there is anything to bake into. Under `bun test` happy-dom returns null for a 2d context
// — `bakeOne` says so and throws — so a warm-up has to ask before it starts rather than throw its
// way out of a lobby that renders perfectly well without one.
export function canBake(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}
