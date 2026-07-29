import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TURRET_CADENCE_MS } from "../src/game/build";
import { PUFF_MS } from "../src/game/draw";
import { RANGED_CADENCE_MS } from "../src/game/enemies";
import { concurrentBursts } from "./burst-ink";
import { concurrentPuffs, entrySource, format, parseArgs, type Reading } from "./puff-ink";

describe("parseArgs", () => {
  // #116 asks for the ink at dpr 1, 2 and 3, so a plain run has to answer at all three or the
  // posted figure is one resolution reported as if it held at every one.
  test("measures all three resolutions when it is not told which", () => {
    const request = parseArgs([]);
    expect(request.dprs).toEqual([1, 2, 3]);
    expect(request.out).toBe(join(process.cwd(), "puff-ink.png"));
  });

  test("takes as many resolutions as it is given, rather than the last one", () => {
    expect(parseArgs(["--dpr", "1", "--dpr", "2.5"]).dprs).toEqual([1, 2.5]);
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/--dpr/);
    expect(() => parseArgs(["--puffs", "-1"])).toThrow(/--puffs/);
    expect(() => parseArgs(["--scale", "2"])).toThrow(/--scale/);
  });

  test("defaults the screen's puff count to what the cadences actually put up", () => {
    expect(parseArgs([]).puffs).toBe(concurrentPuffs());
  });
});

// The count the "wall of ink" question is asked at, derived from the cadences that fire and the
// damage they do rather than picked — the same arithmetic `concurrentBursts` does, taken from the
// other side of `reapDamage`.
describe("concurrentPuffs", () => {
  test("is bounded by the puff's life against the rate deaths arrive at", () => {
    const everyShot = (6 * 1_000) / RANGED_CADENCE_MS + (5 * 1_000) / TURRET_CADENCE_MS;
    expect(concurrentPuffs()).toBeLessThanOrEqual(Math.ceil((everyShot * PUFF_MS) / 1_000));
    expect(concurrentPuffs()).toBeGreaterThan(0);
  });

  // The whole reason this scales more gently than #115: a grunt takes many connects and dies once,
  // so the death rate is the hit rate divided by the shots it takes to kill. The two counts come off
  // the same fire and the same `reapDamage` split, so this is a claim about that split and not about
  // the two lifetimes — which is why it is stated per second rather than as a count.
  test("counts deaths far under the hits the same fire lands", () => {
    const perSecond = (n: number, lifeMs: number) => (n * 1_000) / lifeMs;
    expect(perSecond(concurrentPuffs(), PUFF_MS)).toBeLessThan(
      perSecond(concurrentBursts(), 90) / 4,
    );
  });
});

describe("entrySource", () => {
  // The failure this exists to stop is the one #110 named and b71f155 fixed in the frame harness: a
  // probe that draws something other than the thing it is asked about.
  test("strikes the shipped mark, not a copy of it", () => {
    const source = entrySource(1, 4);
    expect(source).toContain("src/game/fx.ts");
    expect(source).toContain("const one = inkPuff(");
    expect(source).toContain("scattered.push(inkPuff(at))");
    expect(source).toContain("src/game/draw.ts");
    expect(source).toContain("ctx.lineWidth = SHOT_WIDTH");
  });

  // A puff is arcs where every other mark in this frame is segments, and the scallops only join if
  // the path is opened once per cloud — struck any other way this probe would be counting a
  // different drawing's ink.
  test("chains the lobes the way `drawPuffs` chains them", () => {
    const source = entrySource(1, 4);
    expect(source).toContain("ctx.moveTo(");
    expect(source).toContain("ctx.arc(l.at.x, l.at.y, l.radius, l.from, l.to)");
    expect(source).toContain("ctx.closePath()");
  });

  // A puff's ink means nothing on its own. The shot's mark is what `docs/frame-budget.md` prices
  // every other mark against, so it is the yardstick here too — one scale for all three.
  test("strikes a shot's mark beside it, for scale", () => {
    expect(entrySource(1, 4)).toContain("speedLines(");
  });

  test("measures at the resolution and the puff count it was asked for", () => {
    expect(entrySource(3, 40)).toContain("const DPR = 3;");
    expect(entrySource(3, 40)).toContain("const PUFFS = 40;");
  });

  // Anti-aliasing is most of the question for this mark: a puff is six arcs, and a curve has no
  // axis-aligned stretch anywhere on it, so the answer cannot be read off one pixel being on or off.
  test("counts a partly covered pixel as the part of it that is inked", () => {
    expect(entrySource(1, 4)).toContain("(255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255");
  });

  // The wall-of-ink question is about a screen, so it is asked on the viewport the frame budget
  // measures — a puff count on some other canvas is a share of the wrong thing.
  test("asks the screen question on the frame budget's own viewport", () => {
    expect(entrySource(2, 4)).toContain("const VIEW = { width: 800, height: 600 }");
  });
});

describe("format", () => {
  const readings: Reading[] = [
    {
      dpr: 2,
      puff: { ink: 506.5, inked: 900, solid: 260, length: 129, arcs: 6 },
      shot: { ink: 2_531, inked: 3_040, solid: 2_100, length: 719.36, strokes: 9 },
      screen: { puffs: 1, ink: 506, inked: 900, solid: 260, pixels: 1_920_000 },
    },
  ];

  test("reports the puff against the mark the budget already prices", () => {
    expect(format(readings)).toContain("20.0%");
  });

  // The whole question the ticket asks: what share of the screen the puffs at density actually
  // cover. A report that gives the ink without the paper it is on cannot answer it.
  test("says what share of the screen the puffs at density ink", () => {
    expect(format(readings)).toContain("0.03%");
  });
});
