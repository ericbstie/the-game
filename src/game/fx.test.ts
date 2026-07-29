import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../lobby/protocol";
import { SHOT_DASH, SHOT_GAP, type Strand, speedLines, TRAIL_MIN_LENGTH } from "./fx";

const ORIGIN: Vec2 = { x: 0, y: 0 };
const along = (angle: number, length: number): Vec2 => ({
  x: Math.cos(angle) * length,
  y: Math.sin(angle) * length,
});

// How far a point stands off the line the shot was fired along, and how far up that line it sits.
// Every claim below is one of these two numbers, because the shot's own direction is the only frame
// the strokes are laid out in — nothing here is measured against the world's axes.
const frame = (p: Vec2, from: Vec2, to: Vec2) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return {
    at: ((p.x - from.x) * dx + (p.y - from.y) * dy) / length,
    off: ((p.x - from.x) * -dy + (p.y - from.y) * dx) / length,
  };
};

// The strokes struck along the shot's own line, and the ones struck beside it.
const onLine = (struck: Strand[], from: Vec2, to: Vec2) =>
  struck.filter((s) => Math.abs(frame(s.from, from, to).off) < 1e-6);
const beside = (struck: Strand[], from: Vec2, to: Vec2) =>
  struck.filter((s) => Math.abs(frame(s.from, from, to).off) >= 1e-6);

const ANGLES = [0, 0.7, Math.PI / 2, 2.5, -1.2, Math.PI];
const REACH = 700; // a player's own shot always runs the weapon's full range (ADR 0003 §3)

describe("speed lines trailing a shot", () => {
  test("the shot's own line is broken rather than ruled, and starts at the shooter", () => {
    const to = { x: REACH, y: 0 };
    const line = onLine(speedLines(ORIGIN, to), ORIGIN, to);
    expect(line.length).toBeGreaterThan(1);
    expect(line[0].from).toEqual(ORIGIN);
  });

  test("its ink and its paper come out even, whatever the shot's length", () => {
    for (const length of [REACH, 641, 317, 194, 121]) {
      const to = { x: length, y: 0 };
      const line = onLine(speedLines(ORIGIN, to), ORIGIN, to);
      const inks = line.map((s) => +(s.to.x - s.from.x).toFixed(6));
      const papers = line.slice(1).map((s, i) => +(s.from.x - line[i].to.x).toFixed(6));
      expect(new Set(inks).size).toBe(1);
      expect(new Set(papers).size).toBe(1);
    }
  });

  // Two shots whose fitted break does not multiply back out to the far end. Fitting divides by the
  // shot's length and multiplies it back, and about 0.7% of shots across the arena come back a bit
  // short — found by sweeping it. Without a case that actually drifts, this passes on arithmetic
  // that happens to land right, and the mark quietly stops short of what it struck.
  const DRIFTS: [Vec2, Vec2][] = [
    [
      { x: 9695.431837812066, y: 2445.1548820361495 },
      { x: 9280.288627414026, y: 1937.6692353292626 },
    ],
    [
      { x: 1274.5359230786562, y: 29072.683252952993 },
      { x: 706.6268608178717, y: 28901.103794718652 },
    ],
  ];

  test("the mark begins at the shooter and ends at the target exactly", () => {
    const straight = [REACH, 641, 317, 194, 121, 59, 7].map((length): [Vec2, Vec2] => [
      { x: 1100, y: 1100 },
      { x: 1100 + length, y: 1100 },
    ]);
    for (const [start, to] of [...straight, ...DRIFTS]) {
      const struck = speedLines(start, to);
      expect(struck[0].from).toEqual(start);
      expect(onLine(struck, start, to).at(-1)?.to).toEqual(to);
    }
  });

  // Fitting a whole number of breaks to the shot stretches both, so neither comes out at the figure
  // asked for. What has to survive the stretch is their ratio — that is what the break looks like.
  test("its ink and paper hold the ratio asked for, however the fit stretches them", () => {
    for (const length of [REACH, 641, 317, 194]) {
      const to = { x: length, y: 0 };
      const line = onLine(speedLines(ORIGIN, to), ORIGIN, to);
      const ink = line[0].to.x - line[0].from.x;
      const paper = line[1].from.x - line[0].to.x;
      expect(ink / paper).toBeCloseTo(SHOT_DASH / SHOT_GAP, 6);
      expect(ink).toBeGreaterThan(SHOT_DASH * 0.6);
      expect(ink).toBeLessThan(SHOT_DASH * 1.4);
    }
  });

  test("the trail stands off that line to either side of it", () => {
    const to = { x: REACH, y: 0 };
    const sides = beside(speedLines(ORIGIN, to), ORIGIN, to).map((s) =>
      Math.sign(frame(s.from, ORIGIN, to).off),
    );
    expect(new Set(sides)).toEqual(new Set([1, -1]));
  });

  test("it stands off by the same distances whichever way the shot points", () => {
    const spread = (angle: number) => {
      const to = along(angle, REACH);
      return beside(speedLines(ORIGIN, to), ORIGIN, to).map(
        (s) => +frame(s.from, ORIGIN, to).off.toFixed(6),
      );
    };
    for (const angle of ANGLES) expect(spread(angle)).toEqual(spread(0));
  });

  // A trail belongs behind the head, not along the whole flight.
  test("the trail is struck in the far part of the shot, never beside the muzzle", () => {
    const to = along(0.7, REACH);
    for (const strand of beside(speedLines(ORIGIN, to), ORIGIN, to)) {
      expect(frame(strand.from, ORIGIN, to).at).toBeGreaterThan(REACH / 2);
    }
  });

  test("each strand closes back onto the shot's own line before the head", () => {
    const to = along(0.7, REACH);
    const strands = beside(speedLines(ORIGIN, to), ORIGIN, to);
    const closes = strands.filter((s) => Math.abs(frame(s.to, ORIGIN, to).off) < 1e-6);
    expect(closes.length).toBe(2); // one per strand, and none of them at the head
    for (const strand of closes) expect(frame(strand.to, ORIGIN, to).at).toBeLessThan(REACH);
  });

  // Symmetrical strands would close on one point and stamp an arrowhead at the far end of the line.
  test("no two strands close at the same point", () => {
    const to = along(0.7, REACH);
    const closes = beside(speedLines(ORIGIN, to), ORIGIN, to)
      .filter((s) => Math.abs(frame(s.to, ORIGIN, to).off) < 1e-6)
      .map((s) => +frame(s.to, ORIGIN, to).at.toFixed(6));
    expect(new Set(closes).size).toBe(closes.length);
  });

  test("nothing is struck past either end of the shot", () => {
    for (const angle of ANGLES) {
      const to = along(angle, REACH);
      for (const strand of speedLines(ORIGIN, to)) {
        for (const end of [strand.from, strand.to]) {
          const at = frame(end, ORIGIN, to).at;
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThanOrEqual(REACH);
        }
      }
    }
  });

  // A strand shorter than a single dash lands as a blot at the muzzle rather than reading as motion,
  // and a point-blank shot is short enough to do it.
  test("a shot too short to carry a trail is its own broken line alone", () => {
    const under = { x: TRAIL_MIN_LENGTH - 1, y: 0 };
    const over = { x: TRAIL_MIN_LENGTH, y: 0 };
    expect(beside(speedLines(ORIGIN, under), ORIGIN, under)).toEqual([]);
    expect(beside(speedLines(ORIGIN, over), ORIGIN, over).length).toBeGreaterThan(0);
  });

  test("a shot with no length at all is struck as nothing, not as a division by zero", () => {
    expect(speedLines(ORIGIN, ORIGIN)).toEqual([]);
  });
});
