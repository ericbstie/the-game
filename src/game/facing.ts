import type { Vec2 } from "../lobby/protocol";

// Which way a character is drawn, and where it is in its 2-frame walk cycle — both derived
// client-side from the position stream it already has (#73, #76). Nothing new rides the wire,
// and `drawWorld` stays pure: it reads `facing` and `frame` off the snapshot it is handed.

export const FACINGS = 8; // matches `angle = facing / FACINGS * 2π` in src/sprite/calibration.ts
const SECTOR_DEG = 360 / FACINGS; // 45° wide; 22.5° is the half-sector, centre to edge

// Overshoot required past a sector edge before the facing switches: ~2x the measured p95
// per-tick bearing swing, and the largest value that still turns within 76 ms. At 0° a bearing
// sitting on an edge flips two frames in three (38 reversals/s) — the EMA alone does not fix it.
export const HYSTERESIS_DEG = 9;

const TAU_MS = 70; // velocity EMA time constant; must exceed one 50 ms server tick

// The speed a character starts walking at, and the lower speed it stops at. Two thresholds
// rather than one, for the reason the facing gets 9° of hysteresis: a bare threshold chatters
// the stance frame whenever the EMA speed rides the boundary. Every stationary regime measures
// exactly 0 u/s and every sustained walk >= 154, so both sit in an empty band and neither is
// delicate. The gate exists at all because that exact zero is an accident of how a blocked step
// returns — the moment anything introduces sub-unit jitter, no gate at all decays into
// noise-driven facing. Costs 30 ms on a peer's standing start.
export const MOVE_EPS = 40;
export const STOP_EPS = 24;

export const SEED_FACING = 2; // South, until the first suprathreshold motion

// Distance travelled per walk frame. Driving the cycle by distance rather than by a wall clock
// is what stops a fast character skating: one rate in milliseconds cannot serve player (260),
// elite (234) and grunt (182) across a 43% speed spread. At 1 world unit = 1 CSS px this is one
// player body width (2 × PLAYER_RADIUS) — the number sprite agents draw a stride to.
export const STRIDE_PX = 28;

const CYCLE_PX = STRIDE_PX * 2;
const SWITCH_DEG = SECTOR_DEG / 2 + HYSTERESIS_DEG;

// One entity's derived pose plus the state needed to derive it. Lives on the `ClientWorld`
// record that already owns the entity, so it is evicted with it and cannot leak.
export interface Gait {
  facing: number; // 0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW, 6 = N, 7 = NE
  frame: number; // 0 = the stance frame
  vx: number;
  vy: number;
  lastPos: Vec2;
  lastAt: number;
  seeded: boolean;
  moving: boolean;
  phasePx: number; // distance into the walk cycle
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
    moving: false,
    phasePx: phaseOf(id),
  };
}

// Advance one entity's pose from its newly rendered position. A *repeated* `now` is a no-op, so
// a second `snapshot()` at the same instant cannot double-advance the EMA. Two calls with
// different `now` in one frame would split the step instead and bias the speed ~1% low; there is
// one caller per frame today.
export function updateFacing(g: Gait, pos: Vec2, now: number): void {
  const dtMs = now - g.lastAt;
  if (dtMs <= 0) return;

  // Smoothing the velocity *vector*, never the angle, is what lets one filter solve both
  // failures: incoherent jitter cancels vectorially, so the magnitude collapses and the gate
  // fires on exactly the frames whose direction is meaningless.
  const dt = dtMs / 1000;
  const alpha = 1 - Math.exp(-dtMs / TAU_MS); // frame-rate independent
  g.vx += ((pos.x - g.lastPos.x) / dt - g.vx) * alpha;
  g.vy += ((pos.y - g.lastPos.y) / dt - g.vy) * alpha;
  g.lastPos = { x: pos.x, y: pos.y };
  g.lastAt = now;

  const speed = Math.hypot(g.vx, g.vy);
  g.moving = g.moving ? speed > STOP_EPS : speed >= MOVE_EPS;
  if (!g.moving) {
    g.frame = 0; // park on the stance frame rather than freeze mid-stride (#81)
    return; // and hold the last facing rather than snap East on `atan2(0, 0)`
  }

  g.phasePx = (g.phasePx + speed * dt) % CYCLE_PX;
  g.frame = g.phasePx < STRIDE_PX ? 0 : 1;

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
const quantize = (deg: number) => ((Math.round(deg / SECTOR_DEG) % FACINGS) + FACINGS) % FACINGS;

const wrapDeg = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

// A stable per-entity offset into the walk cycle, so a wave does not step in lockstep (#76).
// FNV-1a: enemy ids are allocated sequentially (`e1`, `e2`, …), so the hash has to avalanche or
// a whole wave lands within a few pixels of the same phase.
function phaseOf(id: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16_777_619);
  }
  return (h >>> 0) % CYCLE_PX;
}
