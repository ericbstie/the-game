import type { BuildableKind, Tile, Vec2 } from "../lobby/protocol";
import { accrueMetal, BUILDABLES, type MetalAccrual, MINER_TRICKLE, TILE } from "./build";
import { type Camera, isVisible, type Viewport } from "./camera";

// The `+1` a miner throws up as it mines (#99). Client-derived and nothing else: no float, no
// lifetime and no count rides the wire, so two screens may show the same beat a frame or two apart.
//
// The beat is the whole-Metal crossing `accrueMetal` decides, run here once per standing miner
// rather than once for the squad. That is what lets a number belong to the structure that earned it
// while still summing to what the bank is paid: at MINER_TRICKLE whole Metal a second, each miner's
// remainder is an exact count of thousandths, so N miners float exactly N × MINER_TRICKLE a second —
// the same figure `stepBuild` banks from `metalRate`, with nothing rounded away in between.
//
// Two things follow from the accrual being *per miner* where the bank's is pooled, and both are
// deliberate:
//
//   - **The running totals lag, but never drift.** Every accumulator may be holding up to a whole
//     Metal it has not completed — one per standing miner, plus the orphan pool — so at any instant
//     the squad has usually floated fewer numbers than it has banked. That gap is deliberately *not*
//     bounded by the miners standing: wipe a line of 64 out in one tick and the pool carries nearly a
//     Metal for each of them with nothing left to drain it — up to 63 whole Metal outstanding with no
//     miner alive at all, frozen there until one is rebuilt. The guarantee is the one that matters —
//     **no thousandth is ever discarded, only delayed.** A dying miner's remainder is *reattributed*
//     rather than dropped — see `orphanedThousandths` — because per-miner accumulators otherwise lose
//     a fraction on every death, and miners die constantly.
//   - **Metal earned off screen is never floated at all.** Accrual runs for every miner, so one that
//     scrolls into view resumes on its true beat rather than dumping a backlog — but the crossings it
//     completed while culled are dropped outright, not banked up for later. The reconciliation this
//     holds to is therefore over *visible* miners, not the whole squad. It is a camera-culled
//     cosmetic: what nobody was looking at is not owed a number.

// How long one number stays up. A miner completes a Metal every 1000/MINER_TRICKLE ms — 500 at the
// trickle as it stands — so a life a little longer than that keeps a working miner continuously
// marked without stacking a column of numbers over it. Provisional: the ask fixes no duration.
export const FLOAT_MS = 600;
// How far it climbs over that life, in world units. A touch under a miner's own 30 px height, so
// the number clears the building it came from and stops. Provisional: the ask fixes no distance.
export const FLOAT_RISE = 24;

// The most Metal a single step may float for. A tab that was not drawing banked its Metal all the
// same, but it has nothing to show for frames it never drew — and without this bound a minimised
// tab resumes into a stack of thousands. It matches the cap `GameScreen` puts on a frame's movement,
// for the same reason.
const MAX_STEP_MS = 100;

const MINER_FOOTPRINT = BUILDABLES.miner?.footprint ?? 1;
const MINER_HALF = (MINER_FOOTPRINT * TILE) / 2;

// Where a miner's number starts: centred on its footprint, at the top edge of it. From the middle
// it would spend its first frames inside the building that earned it.
export function minerFloatOrigin(tile: Tile): Vec2 {
  return { x: tile.tx * TILE + MINER_HALF, y: tile.ty * TILE };
}

// One rising number. `id` is the miner it came from, so the miner's death takes it with it rather
// than leaving a figure hanging over bare ground.
export interface MetalFloat {
  id: string;
  pos: Vec2;
  at: number;
}

// Everything the render layer needs of a standing building to decide whether it floats. Narrower
// than `Structure` on purpose, so both the mirrored sim state and a `WorldSnapshot`'s structures fit.
interface Standing {
  id: string;
  kind: BuildableKind;
  tile: Tile;
}

export interface MetalFloats {
  accruals: Map<string, MetalAccrual>;
  // What the miners that have since been destroyed had part-earned, waiting to be reattributed to
  // one still standing. The bank has no equivalent because it never needed one: its single pooled
  // accumulator outlives every producer paying into it.
  orphanedThousandths: number;
  live: MetalFloat[];
  lastAt: number | null;
}

export function freshMetalFloats(): MetalFloats {
  return { accruals: new Map(), orphanedThousandths: 0, live: [], lastAt: null };
}

// Advance every standing miner and return the floats currently in the air. A command as much as a
// query, like `ClientWorld.snapshot`: the render loop is the single caller, once a frame, and
// calling it twice on one clock accrues nothing the second time.
export function stepMetalFloats(
  floats: MetalFloats,
  structures: readonly Standing[],
  camera: Camera,
  viewport: Viewport,
  now: number,
): readonly MetalFloat[] {
  // Bounded below as well as above: `now` is wall-clock, and a clock stepped backwards would
  // otherwise hand the accrual a negative payment and unwind a remainder it had already earned.
  const dtMs = floats.lastAt === null ? 0 : Math.max(0, Math.min(now - floats.lastAt, MAX_STEP_MS));
  floats.lastAt = now;

  const miners = new Set<string>();
  for (const s of structures) {
    if (s.kind !== "miner") continue;
    miners.add(s.id);
    let accrual = floats.accruals.get(s.id);
    if (!accrual) {
      accrual = { metalThousandths: 0 };
      floats.accruals.set(s.id, accrual);
    }
    // Whatever the dead left behind goes to the first miner stepped after them. A fraction of one
    // Metal lands on a neighbour rather than on the structure that literally earned it, which is the
    // price of attribution — and the alternative is discarding it, which is how a per-miner accrual
    // falls permanently behind a pooled one.
    accrual.metalThousandths += floats.orphanedThousandths;
    floats.orphanedThousandths = 0;
    const whole = accrueMetal(accrual, (MINER_TRICKLE * dtMs) / 1_000);
    if (whole === 0) continue;
    const pos = minerFloatOrigin(s.tile);
    // A crossing completed off screen is dropped here, not carried: see the header. It has already
    // left the accrual, so nothing accumulates behind the camera.
    if (!isVisible({ x: pos.x, y: pos.y + MINER_HALF }, MINER_HALF, camera, viewport)) continue;
    // One `+1` per whole Metal, never a batched total — a frame long enough to complete two owes
    // two numbers.
    for (let i = 0; i < whole; i++) floats.live.push({ id: s.id, pos: { ...pos }, at: now });
  }

  for (const [id, accrual] of floats.accruals) {
    if (miners.has(id)) continue;
    floats.orphanedThousandths += accrual.metalThousandths;
    floats.accruals.delete(id);
  }
  floats.live = floats.live.filter((f) => miners.has(f.id) && now - f.at < FLOAT_MS);
  return floats.live;
}
