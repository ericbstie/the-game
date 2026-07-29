import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, format, parseArgs, type Reading } from "./shot-ink";

describe("parseArgs", () => {
  // #114 asks for the ink at dpr 1, 2 and 3, so a plain run has to answer at all three or the
  // published figure is one resolution reported as if it held at every one.
  test("measures all three resolutions when it is not told which", () => {
    const request = parseArgs([]);
    expect(request.dprs).toEqual([1, 2, 3]);
    expect(request.out).toBe(join(process.cwd(), "shot-ink.png"));
  });

  test("takes as many resolutions as it is given, rather than the last one", () => {
    expect(parseArgs(["--dpr", "1", "--dpr", "2.5"]).dprs).toEqual([1, 2.5]);
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/--dpr/);
    expect(() => parseArgs(["--dpr", "retina"])).toThrow(/--dpr/);
    expect(() => parseArgs(["--scale", "2"])).toThrow(/--scale/);
  });
});

describe("entrySource", () => {
  // The failure this exists to stop is the one #110 named and b71f155 fixed in the frame harness:
  // a probe that draws something other than the thing it is asked about. Every number the budget
  // quotes for ink has to come off the mark the game strikes and the width it strikes it at.
  test("strokes the shipped mark, not a copy of it", () => {
    const source = entrySource(1);
    expect(source).toContain("src/game/fx.ts");
    expect(source).toContain("speedLines(from, to)");
    expect(source).toContain("src/game/draw.ts");
    expect(source).toContain("ctx.lineWidth = SHOT_WIDTH");
  });

  // The comparison is the whole point, and the treatment it compares against is gone from the code,
  // so the one thing that can go unnoticed is the plain line quietly becoming something else.
  test("compares against one segment, shooter to target, at the same width", () => {
    expect(entrySource(1)).toContain("plain: stroke([{ from, to }])");
  });

  test("measures at the resolution it was asked for", () => {
    expect(entrySource(3)).toContain("const DPR = 3;");
  });

  // Anti-aliasing is half the question, so the answer cannot be read off one pixel being on or off.
  test("counts a partly covered pixel as the part of it that is inked", () => {
    expect(entrySource(1)).toContain("(255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255");
  });

  // The threshold is sampled from both sides because the ink steps there — above it a shot carries
  // a trail and below it does not, and a ladder that straddles nothing would report the step as a
  // smooth slope.
  test("samples both sides of the length the trail switches on at", () => {
    const source = entrySource(1);
    expect(source).toContain("TRAIL_MIN_LENGTH,");
    expect(source).toContain("TRAIL_MIN_LENGTH - 1,");
  });
});

describe("format", () => {
  const reading: Reading[] = [
    {
      dpr: 2,
      cases: [
        {
          length: 700,
          angle: 0,
          trail: true,
          plain: { ink: 5600, inked: 5600, solid: 5600, length: 700, strokes: 1 },
          speed: { ink: 5476, inked: 6566, solid: 5476, length: 719.36, strokes: 14 },
        },
      ],
    },
  ];

  // A mark that lays less ink than the one it replaced is the finding, so a report that cannot say
  // "less" is not a report.
  test("says which way the ink went, not only how much of it there is", () => {
    expect(format(reading)).toContain("-2.2%");
  });

  test("reports the geometry beside the pixels, since they disagree", () => {
    expect(format(reading)).toContain("+2.8%");
  });
});
