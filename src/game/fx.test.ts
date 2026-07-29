import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../lobby/protocol";
import { ELITE_RADIUS, GRUNT_RADIUS } from "./enemies";
import {
  BURST_REACH,
  SHOT_DASH,
  SHOT_GAP,
  type Strand,
  speedLines,
  starburst,
  TRAIL_MIN_LENGTH,
} from "./fx";

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

  // The threshold is derived from the dash rather than picked, so a retune of `SHOT_DASH` or of a
  // strand's stretch carries it instead of silently breaking it. The tie is what this holds: at the
  // shortest shot that carries a trail, the longest strand runs exactly one dash beside the line.
  test("the shortest shot that carries a trail runs one whole dash beside it", () => {
    const to = { x: TRAIL_MIN_LENGTH, y: 0 };
    const runs = beside(speedLines(ORIGIN, to), ORIGIN, to).map(
      (s) => frame(s.to, ORIGIN, to).at - frame(s.from, ORIGIN, to).at,
    );
    expect(Math.max(...runs)).toBeCloseTo(SHOT_DASH, 6);
  });

  test("a shot with no length at all is struck as nothing, not as a division by zero", () => {
    expect(speedLines(ORIGIN, ORIGIN)).toEqual([]);
  });
});

// Where a strand's two ends sit relative to the point the burst was struck at: how far out, and at
// what bearing. Every claim below is one of those two, because a starburst has no direction of its
// own — unlike a shot, nothing about it is laid out in a frame the world gave it.
const radial = (p: Vec2, at: Vec2) => ({
  out: Math.hypot(p.x - at.x, p.y - at.y),
  bearing: Math.atan2(p.y - at.y, p.x - at.x),
});

// Points along a strand, ends included. A spike is straight, but the claims about what it may reach
// over are about the whole of it and not about where it stops.
const walk = (s: Strand, steps = 32): Vec2[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    x: s.from.x + (s.to.x - s.from.x) * (i / steps),
    y: s.from.y + (s.to.y - s.from.y) * (i / steps),
  }));

describe("the starburst struck where a shot connects", () => {
  const AT: Vec2 = { x: 1_240, y: 8_611 };

  test("every spike runs straight out from the point, and none of them through it", () => {
    const struck = starburst(AT);
    expect(struck.length).toBeGreaterThan(3);
    for (const spike of struck) {
      const from = radial(spike.from, AT);
      const to = radial(spike.to, AT);
      expect(to.out).toBeGreaterThan(from.out);
      expect(from.out).toBeGreaterThan(0); // the middle is left open, so the spider shows through
      expect(to.bearing).toBeCloseTo(from.bearing, 9);
    }
  });

  test("the spikes alternate long and short, so it reads as a star and not as a wheel", () => {
    const reaches = starburst(AT).map((s) => +radial(s.to, AT).out.toFixed(6));
    expect(new Set(reaches).size).toBe(2);
    const long = Math.max(...reaches);
    for (let i = 1; i < reaches.length; i++) {
      expect(reaches[i] === long).toBe(reaches[i - 1] !== long);
    }
  });

  // `drawBursts` culls a mark on `BURST_REACH` alone, so a spike standing further out than that is
  // a burst dropped from the frame while part of it was still on screen.
  test("nothing it strikes stands further out than the reach it is culled on", () => {
    for (const spike of starburst(AT)) {
      for (const p of walk(spike)) {
        expect(radial(p, AT).out).toBeLessThanOrEqual(BURST_REACH + 1e-9);
      }
    }
  });

  // A spider's bar is drawn directly over its sprite and is exactly as wide as that sprite is tall
  // (`paintEnemy`), and the burst paints over the Y-sort — so a spike standing above the sprite has
  // to stand wider than it too, or it strikes through the one damage readout the game has (#81) at
  // the very moment the player is reading it.
  test("no spike reaches over the health bar of the spider it marks", () => {
    for (const radius of [GRUNT_RADIUS, ELITE_RADIUS]) {
      for (const spike of starburst(ORIGIN)) {
        for (const p of walk(spike)) {
          if (-p.y > radius) expect(Math.abs(p.x)).toBeGreaterThan(radius);
        }
      }
    }
  });

  test("it is the same mark wherever in the arena it is struck", () => {
    // Rounded, and the sign taken off a zero with it: an axial spike comes out at -0 once it has
    // been shifted back off `AT` and at 0 struck at the origin, and those are the same point.
    const round = (n: number) => +n.toFixed(9) || 0;
    const shape = (struck: Strand[], at: Vec2) =>
      struck.map((s) => ({
        from: { x: round(s.from.x - at.x), y: round(s.from.y - at.y) },
        to: { x: round(s.to.x - at.x), y: round(s.to.y - at.y) },
      }));
    expect(shape(starburst(AT), AT)).toEqual(shape(starburst(ORIGIN), ORIGIN));
  });
});
