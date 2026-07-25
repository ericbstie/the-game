import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../lobby/protocol";
import {
  freshGait,
  type Gait,
  HYSTERESIS_DEG,
  MOVE_EPS,
  SEED_FACING,
  updateFacing,
  WALK_FRAME_MS,
} from "./facing";

const E = 0;
const SE = 1;
const S = 2;
const SW = 3;
const W = 4;
const NW = 5;
const N = 6;
const NE = 7;

const FRAME_MS = 16; // ~60 Hz, the rate `snapshot` is called at
const T0 = 1_000;

// Walk a gait from `start` along `deg` at `speed` u/s, one render frame at a time, and return
// every facing it showed. `t0` continues a previous leg so one entity can turn mid-run.
function walk(
  g: Gait,
  opts: { start: Vec2; deg: number; speed: number; ms: number; t0?: number },
): { facings: number[]; frames: number[]; end: Vec2; endAt: number } {
  const { start, deg, speed, ms, t0 = T0 } = opts;
  const rad = (deg * Math.PI) / 180;
  const facings: number[] = [];
  const frames: number[] = [];
  const pos = { ...start };
  let t = t0;
  for (let elapsed = FRAME_MS; elapsed <= ms; elapsed += FRAME_MS) {
    pos.x += (Math.cos(rad) * speed * FRAME_MS) / 1000;
    pos.y += (Math.sin(rad) * speed * FRAME_MS) / 1000;
    t = t0 + elapsed;
    updateFacing(g, pos, t);
    facings.push(g.facing);
    frames.push(g.frame);
  }
  return { facings, frames, end: { ...pos }, endAt: t };
}

// Hold a gait perfectly still — the exact-zero position delta every stationary regime produces.
function stand(g: Gait, pos: Vec2, ms: number, t0: number): number[] {
  const facings: number[] = [];
  for (let elapsed = FRAME_MS; elapsed <= ms; elapsed += FRAME_MS) {
    updateFacing(g, pos, t0 + elapsed);
    facings.push(g.facing);
  }
  return facings;
}

const changes = (xs: number[]) => xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;

describe("facing — the stationary case", () => {
  test("seeds South, so an entity that has never moved is not drawn facing East", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    stand(g, { x: 0, y: 0 }, 2_000, T0);
    expect(g.facing).toBe(SEED_FACING);
  });

  test("SEED_FACING is South", () => {
    expect(SEED_FACING).toBe(S);
  });

  test("a stopped entity holds its last facing instead of snapping East", () => {
    // The naive rule's real failure: a stopped entity's delta is exactly zero and
    // `Math.atan2(0, 0) === 0`, which pins the whole front line East.
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: 180, speed: 200, ms: 600 });
    expect(leg.facings.at(-1)).toBe(W);
    stand(g, leg.end, 5_000, leg.endAt);
    expect(g.facing).toBe(W);
  });

  test("a stopped entity never changes facing while it stands", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: -90, speed: 200, ms: 600 });
    expect(changes(stand(g, leg.end, 5_000, leg.endAt))).toBe(0);
  });

  test("creeping below MOVE_EPS does not steer the facing", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: -90, speed: 200, ms: 600 });
    expect(leg.facings.at(-1)).toBe(N);
    // Now drift East at a tenth of the threshold — movement, but not enough to mean anything.
    const creep = walk(g, {
      start: leg.end,
      deg: 0,
      speed: MOVE_EPS / 10,
      ms: 5_000,
      t0: leg.endAt,
    });
    expect(creep.facings.at(-1)).toBe(N);
  });
});

describe("facing — the sector boundary", () => {
  test("a bearing drifting along a sector edge does not oscillate", () => {
    // 22.5° is the E/SE edge. Jittering either side of it is what measured 38 reversals/s
    // without hysteresis — a flip roughly two frames in three.
    const g = freshGait("e1", { x: 0, y: 0 });
    const pos = { x: 0, y: 0 };
    const facings: number[] = [];
    for (let i = 0; i < 600; i++) {
      const rad = ((22.5 + (i % 2 === 0 ? 3 : -3)) * Math.PI) / 180;
      pos.x += (Math.cos(rad) * 200 * FRAME_MS) / 1000;
      pos.y += (Math.sin(rad) * 200 * FRAME_MS) / 1000;
      updateFacing(g, pos, T0 + i * FRAME_MS);
      facings.push(g.facing);
    }
    expect(changes(facings.slice(30))).toBe(0);
  });

  test("a turn short of the edge plus the hysteresis is ignored", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: 0, speed: 200, ms: 600 });
    expect(leg.facings.at(-1)).toBe(E);
    const nudged = walk(g, {
      start: leg.end,
      deg: 22.5 + HYSTERESIS_DEG - 1,
      speed: 200,
      ms: 2_000,
      t0: leg.endAt,
    });
    expect(nudged.facings.at(-1)).toBe(E); // past the 22.5° edge, inside the deadband
  });

  test("a turn past the edge plus the hysteresis switches", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: 0, speed: 200, ms: 600 });
    const turned = walk(g, {
      start: leg.end,
      deg: 22.5 + HYSTERESIS_DEG + 1,
      speed: 200,
      ms: 2_000,
      t0: leg.endAt,
    });
    expect(turned.facings.at(-1)).toBe(SE);
  });

  test("a full lap of genuine turns steps through the eight sectors once each", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    let leg = walk(g, { start: { x: 0, y: 0 }, deg: 0, speed: 260, ms: 900 });
    const facings = [...leg.facings];
    for (const deg of [45, 90, 135, 180, -135, -90, -45]) {
      leg = walk(g, { start: leg.end, deg, speed: 260, ms: 900, t0: leg.endAt });
      facings.push(...leg.facings);
    }
    const distinct = facings.filter((f, i) => i === 0 || f !== facings[i - 1]);
    // One change per turn and no reversals; the leading SEED_FACING is the frame before the
    // EMA first crosses MOVE_EPS.
    expect(distinct).toEqual([SEED_FACING, E, SE, S, SW, W, NW, N, NE]);
  });
});

describe("facing — the 8 sectors", () => {
  const cases: [string, number, number][] = [
    ["east", 0, E],
    ["south-east", 45, SE],
    ["south", 90, S],
    ["south-west", 135, SW],
    ["west", 180, W],
    ["north-west", -135, NW],
    ["north", -90, N],
    ["north-east", -45, NE],
  ];
  for (const [name, deg, expected] of cases) {
    test(`moving ${name} faces ${expected}`, () => {
      const g = freshGait("e1", { x: 0, y: 0 });
      const leg = walk(g, { start: { x: 0, y: 0 }, deg, speed: 200, ms: 600 });
      expect(leg.facings.at(-1)).toBe(expected);
    });
  }
});

describe("updateFacing idempotence", () => {
  test("a repeated `now` cannot double-advance the EMA", () => {
    const once = freshGait("e1", { x: 0, y: 0 });
    const twice = freshGait("e1", { x: 0, y: 0 });
    const pos = { x: 0, y: 0 };
    for (let i = 1; i <= 60; i++) {
      pos.x += 3;
      pos.y += 1;
      const now = T0 + i * FRAME_MS;
      updateFacing(once, pos, now);
      updateFacing(twice, pos, now);
      updateFacing(twice, pos, now);
    }
    expect(twice).toEqual(once);
  });

  test("a `now` that goes backwards is ignored", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: 180, speed: 200, ms: 600 });
    const before = { ...g };
    updateFacing(g, { x: 9_000, y: 9_000 }, leg.endAt - 100);
    expect(g).toEqual(before);
  });
});

describe("the walk cycle", () => {
  test("parks on the stance frame while stopped", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const leg = walk(g, { start: { x: 0, y: 0 }, deg: 0, speed: 200, ms: 900 });
    expect(new Set(leg.frames).size).toBe(2); // it was cycling while it walked
    stand(g, leg.end, 1_000, leg.endAt);
    expect(g.frame).toBe(0);
  });

  test("alternates both frames while walking", () => {
    const g = freshGait("e1", { x: 0, y: 0 });
    const { frames } = walk(g, {
      start: { x: 0, y: 0 },
      deg: 0,
      speed: 200,
      ms: WALK_FRAME_MS * 6,
    });
    expect(changes(frames)).toBeGreaterThanOrEqual(2);
  });

  test("a wave is not in lockstep — entities are offset into the cycle by id", () => {
    const ids = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];
    const gaits = ids.map((id) => freshGait(id, { x: 0, y: 0 }));
    const perId = gaits.map(
      (g) => walk(g, { start: { x: 0, y: 0 }, deg: 0, speed: 200, ms: WALK_FRAME_MS * 4 }).frames,
    );
    const columns = perId[0].map((_, i) => new Set(perId.map((frames) => frames[i])));
    expect(columns.some((c) => c.size === 2)).toBe(true);
  });
});
