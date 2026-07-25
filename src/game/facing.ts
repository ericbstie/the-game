import type { Vec2 } from "../lobby/protocol";

// Which way a character is drawn, and where it is in its walk cycle — both derived on the
// client from the position stream it already has. Nothing new rides the wire, and `drawWorld`
// stays pure: it reads `facing` and `frame` off the snapshot it is handed.
//
// Two measured failures this exists to prevent (#73):
//   - A stationary entity's position delta is *exactly* zero, not noisy — 100% of samples at
//     the front line. `Math.atan2(0, 0) === 0`, so the naive rule silently pins the whole
//     field East (1 distinct facing across 240 enemies) rather than twitching. Below the speed
//     gate we hold the last facing instead, which restores all 8 approach directions.
//   - A bearing sitting on a sector edge flips two frames in three (38.1 reversals/s).
//     Switching sectors costs an overshoot, which takes that to zero.
//
// The smoothing is applied to the velocity *vector*, never to the angle. That is what lets one
// filter solve both: incoherent jitter cancels vectorially, so the magnitude collapses and the
// speed gate fires on exactly the frames whose direction is meaningless.

export const SECTOR_DEG = 45; // 8 facings, so 45° wide — 22.5° is the half-sector, centre to edge

// Overshoot required past a sector edge before the facing switches: ~2x the measured p95
// per-tick bearing swing, and the largest value that still turns within 76 ms. At 0° the
// boundary case still runs at 28 reversals/s, so the EMA alone does not fix it.
export const HYSTERESIS_DEG = 9;

export const TAU_MS = 70; // velocity EMA time constant; must exceed one 50 ms server tick

// The speed, in u/s, below which nothing is moving. Every stationary regime measures exactly 0
// and every sustained walk >= 154, so the band between is empty and the value is not delicate.
// It buys independence from that exact zero, which is an accident of how a blocked step returns:
// the moment anything introduces sub-unit jitter, a zero threshold decays into noise-driven
// facing. Costs 30 ms on a peer's standing start.
export const MOVE_EPS = 40;

export const SEED_FACING = 2; // South, until the first suprathreshold motion
export const WALK_FRAME_MS = 150; // one frame of the 2-frame cycle; #76 fixes 2 frames, not a rate

const WALK_CYCLE_MS = WALK_FRAME_MS * 2;
const SWITCH_DEG = SECTOR_DEG / 2 + HYSTERESIS_DEG;

// One entity's derived pose plus the state needed to derive it. Lives on the `ClientWorld`
// record that already owns the entity, so it is evicted with it and cannot leak.
export interface Gait {
  facing: number; // 0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW, 6 = N, 7 = NE (src/sprite/calibration.ts)
  frame: number; // 0 = the stance frame
  vx: number;
  vy: number;
  lastPos: Vec2;
  lastAt: number;
  seeded: boolean;
  phaseMs: number;
}

export function freshGait(id: string, pos: Vec2): Gait {
  return {
    facing: SEED_FACING,
    frame: 0,
    vx: 0,
    vy: 0,
    lastPos: { x: pos.x, y: pos.y },
    // An infinitely long gap has zero average velocity, so the first update only seeds the
    // sample — no caller has to supply a creation time.
    lastAt: Number.NEGATIVE_INFINITY,
    seeded: false,
    phaseMs: phaseOf(id),
  };
}

// Advance one entity's pose from its newly rendered position. Idempotent for a repeated `now`,
// so calling `snapshot()` twice in a frame cannot double-advance the EMA.
export function updateFacing(g: Gait, pos: Vec2, now: number): void {
  const dtMs = now - g.lastAt;
  if (dtMs <= 0) return;

  const dt = dtMs / 1000;
  const alpha = 1 - Math.exp(-dtMs / TAU_MS); // frame-rate independent
  g.vx += ((pos.x - g.lastPos.x) / dt - g.vx) * alpha;
  g.vy += ((pos.y - g.lastPos.y) / dt - g.vy) * alpha;
  g.lastPos = { x: pos.x, y: pos.y };
  g.lastAt = now;

  if (Math.hypot(g.vx, g.vy) < MOVE_EPS) {
    g.frame = 0; // park on the stance frame rather than freeze mid-stride (#81)
    return; // and hold the last facing rather than snap East
  }
  g.frame = Math.floor((now + g.phaseMs) / WALK_FRAME_MS) % 2;

  const bearing = (Math.atan2(g.vy, g.vx) * 180) / Math.PI;
  if (!g.seeded) {
    g.seeded = true;
    g.facing = quantize(bearing);
  } else if (Math.abs(wrapDeg(bearing - g.facing * SECTOR_DEG)) > SWITCH_DEG) {
    g.facing = quantize(bearing);
  }
}

// A bearing landing exactly on an edge resolves to the higher sector: `Math.round` breaks ties
// toward +Infinity. Only reachable on an entity's first suprathreshold sample.
const quantize = (deg: number) => ((Math.round(deg / SECTOR_DEG) % 8) + 8) % 8;

const wrapDeg = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

// A stable per-entity offset into the walk cycle, so a wave does not step in lockstep (#76).
// FNV-1a: enemy ids are allocated sequentially (`e1`, `e2`, …), so the hash has to avalanche or
// a whole wave lands within a few ms of the same phase.
function phaseOf(id: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16_777_619);
  }
  return (h >>> 0) % WALK_CYCLE_MS;
}
