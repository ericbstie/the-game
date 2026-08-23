import type { Tile } from "../lobby/protocol";
import { HAND_MINE_RATE, type HarvestTarget } from "./build";

// Harvest progress: how much of the thing under the cursor is left to take, and the event that
// fires when there is none left (#130). Ore and buildables both carry it — mining and demolishing are
// one verb with two answers, which is what `resolveHarvest` already says (`build.ts`).
//
// **Client-local, and a separate statistic from HP.** Nothing here rides the wire and nothing here
// touches a structure's HP: an enemy chewing a wall to 10% leaves the wall exactly as quick to
// demolish, and a teammate digging the same tile as you is digging their own progress. What crosses
// the wire is only what this module emits — one `game/mine` per Metal, one `game/demolish` per
// building — so the server is told about completed harvests rather than about held buttons.
//
// Geometry-free and clock-free, in the idiom `floats.ts` and `damageFx.ts` already use: the caller
// supplies the frame's delta and what its cursor is over, and gets back the harvest that finished.
// That return value is the seam — a consumer that wants to float a `+1` (#136) or throw sparks
// (#107, #78) reads it beside the two that report it, and nothing in here has to learn about them.

// How long a hold takes to earn one Metal out of an ore tile. Derived, not chosen: a completed
// harvest banks exactly one whole Metal (`admitMine`), so at HAND_MINE_RATE Metal a second the tile
// must take this long — the same rate the hand paid before it had progress to show for it.
export const ORE_HARVEST_MS = 1_000 / HAND_MINE_RATE;

// And how long a building takes to pull down. This is the hold demolish has always had: a stray
// right-click while running over your own wall must not delete it. Provisional, like every balance
// number — it is now a quantity of progress rather than a delay before one request, and the same
// 350 ms of holding still ends with the building gone.
export const STRUCTURE_HARVEST_MS = 350;

// What one harvester is working on, and how much of it is left. One pair, not a map: progress
// belongs to the current target and is dropped the moment the button comes up or the cursor moves
// on, so there is nothing to evict and nothing to regenerate. `remainingMs` says nothing at all
// without a `target` beside it — a released hold leaves its last figure behind rather than
// pretending to a progress it no longer has.
export interface Harvest {
  target: HarvestTarget;
  remainingMs: number;
}

export function freshHarvest(): Harvest {
  return { target: null, remainingMs: 0 };
}

// Work `target` for one frame and return the harvest that reached zero on it, or null. Handing in a
// different target than last frame — or none at all — starts the next one from full.
export function stepHarvest(harvest: Harvest, target: HarvestTarget, dtMs: number): HarvestTarget {
  if (!target) {
    harvest.target = null;
    return null;
  }
  if (!sameTarget(harvest.target, target)) harvest.remainingMs = fullHarvestMs(target);
  harvest.target = target;
  // Floored at zero because `dtMs` is wall-clock elsewhere in the client: a clock stepped backwards
  // must not hand a harvest back the progress it has already made.
  harvest.remainingMs -= Math.max(0, dtMs);
  if (harvest.remainingMs > 0) return null;
  // Replenished rather than left at zero, so a held button digs the same tile again. The overshoot
  // is carried the way `stepForge` re-arms the next bullet, so a hand is paid the rate it held for
  // rather than the rate its frames happened to land on...
  harvest.remainingMs += fullHarvestMs(target);
  // ...but never more than one harvest of it: a frame that swallowed several completes one and
  // drops the rest, for the reason `stepMetalFloats` bounds its own step — a tab that was not
  // drawing owes nothing on the frame it comes back.
  if (harvest.remainingMs <= 0) harvest.remainingMs = fullHarvestMs(target);
  return target;
}

function fullHarvestMs(target: NonNullable<HarvestTarget>): number {
  return target.kind === "mine" ? ORE_HARVEST_MS : STRUCTURE_HARVEST_MS;
}

function sameTarget(a: HarvestTarget, b: HarvestTarget): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "mine") {
    return b.kind === "mine" && a.tile.tx === b.tile.tx && a.tile.ty === b.tile.ty;
  }
  return b.kind === "demolish" && a.id === b.id;
}

// The mine in progress this frame, as the tile it is on and how much of it is done in [0, 1], or
// null when nothing is being mined. What the bar over the tile is drawn from — demolishing is not
// reported, because the bar is about the Metal a hold is earning.
export function minePreview(harvest: Harvest): { tile: Tile; filled: number } | null {
  if (harvest.target?.kind !== "mine") return null;
  const filled = 1 - harvest.remainingMs / ORE_HARVEST_MS;
  return { tile: harvest.target.tile, filled: Math.min(1, Math.max(0, filled)) };
}
