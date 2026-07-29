import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TURRET_CADENCE_MS } from "../src/game/build";
import { BURST_MS } from "../src/game/draw";
import { RANGED_CADENCE_MS } from "../src/game/enemies";
import { concurrentBursts, entrySource, format, parseArgs, type Reading } from "./burst-ink";

describe("parseArgs", () => {
  // #115 asks for the ink at dpr 1, 2 and 3, so a plain run has to answer at all three or the
  // posted figure is one resolution reported as if it held at every one.
  test("measures all three resolutions when it is not told which", () => {
    const request = parseArgs([]);
    expect(request.dprs).toEqual([1, 2, 3]);
    expect(request.out).toBe(join(process.cwd(), "burst-ink.png"));
  });

  test("takes as many resolutions as it is given, rather than the last one", () => {
    expect(parseArgs(["--dpr", "1", "--dpr", "2.5"]).dprs).toEqual([1, 2.5]);
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/--dpr/);
    expect(() => parseArgs(["--bursts", "-1"])).toThrow(/--bursts/);
    expect(() => parseArgs(["--scale", "2"])).toThrow(/--scale/);
  });

  test("defaults the screen's burst count to what the cadences actually put up", () => {
    expect(parseArgs([]).bursts).toBe(concurrentBursts());
  });
});

// The count the "wall of ink" question is asked at. Derived from the cadences that fire and the
// damage they do rather than picked, so a retune of either moves it instead of leaving a stale
// number in a document.
describe("concurrentBursts", () => {
  test("is bounded by the burst's life against the rate hits arrive at", () => {
    const perSecond = (6 * 1000) / RANGED_CADENCE_MS + (5 * 1000) / TURRET_CADENCE_MS;
    expect(concurrentBursts()).toBeLessThanOrEqual(Math.ceil((perSecond * BURST_MS) / 1000));
    expect(concurrentBursts()).toBeGreaterThan(0);
  });

  // A connect that kills reports a death and not a hit (`enemies.ts` `reapDamage`), so the rate the
  // count comes off is strictly under the rate shots land at. A count that ignored it would be the
  // upper bound of a different effect — #116's, which fires on exactly the connects this one skips.
  test("counts only the connects that are not the killing one", () => {
    const everyShot = (6 * 1000) / RANGED_CADENCE_MS + (5 * 1000) / TURRET_CADENCE_MS;
    expect(concurrentBursts()).toBeLessThan((everyShot * BURST_MS) / 1000);
  });
});

describe("entrySource", () => {
  // The failure this exists to stop is the one #110 named and b71f155 fixed in the frame harness: a
  // probe that draws something other than the thing it is asked about.
  test("strokes the shipped mark, not a copy of it", () => {
    const source = entrySource(1, 4);
    expect(source).toContain("src/game/fx.ts");
    expect(source).toContain("const one = starburst(");
    expect(source).toContain("for (const s of starburst(at))");
    expect(source).toContain("src/game/draw.ts");
    expect(source).toContain("ctx.lineWidth = SHOT_WIDTH");
  });

  // A burst's ink means nothing on its own. The shot's mark is the thing in the frame the budget
  // already prices, so it is what the burst is reported against.
  test("strikes a shot's mark beside it, for scale", () => {
    expect(entrySource(1, 4)).toContain("speedLines(");
  });

  test("measures at the resolution and the burst count it was asked for", () => {
    expect(entrySource(3, 40)).toContain("const DPR = 3;");
    expect(entrySource(3, 40)).toContain("const BURSTS = 40;");
  });

  // Anti-aliasing is half the question, so the answer cannot be read off one pixel being on or off.
  test("counts a partly covered pixel as the part of it that is inked", () => {
    expect(entrySource(1, 4)).toContain("(255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255");
  });

  // The wall-of-ink question is about a screen, so it is asked on the viewport the frame budget
  // measures — a burst count on some other canvas is a share of the wrong thing.
  test("asks the screen question on the frame budget's own viewport", () => {
    const source = entrySource(2, 4);
    expect(source).toContain("const VIEW = { width: 800, height: 600 }");
  });
});

describe("format", () => {
  const readings: Reading[] = [
    {
      dpr: 2,
      burst: { ink: 456.5, inked: 812, solid: 233, length: 124, strokes: 8 },
      shot: { ink: 2_531, inked: 3_040, solid: 2_100, length: 719.36, strokes: 9 },
      screen: { bursts: 4, ink: 1_826, inked: 3_248, solid: 932, pixels: 1_920_000 },
    },
  ];

  test("reports the burst against the mark the budget already prices", () => {
    expect(format(readings)).toContain("18.0%");
  });

  // The whole question the ticket asks: what share of the screen the bursts at density actually
  // cover. A report that gives the ink without the paper it is on cannot answer it.
  test("says what share of the screen the bursts at density ink", () => {
    expect(format(readings)).toContain("0.10%");
  });
});
